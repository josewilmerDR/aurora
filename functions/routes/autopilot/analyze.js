// Autopilot — POST /api/autopilot/analyze.
//
// Sub-archivo del split de routes/autopilot.js. Es el endpoint más complejo
// del dominio: dispatcher de tres "modos" de autonomía configurables:
//
//   - nivel1 (recomendaciones)        — texto, no actúa.
//   - nivel2 (agencia supervisada)    — propone acciones para aprobar.
//   - nivel3 (agencia total)          — ejecuta directo, escala si rompe
//                                       guardrails.
//
// Comparte el snapshot inicial de la finca (6 queries paralelas) entre los
// tres modos. Los prompts y tools de cada nivel son distintos y cada uno
// tiene su propio agentic loop con extended thinking.
//
// Sigue siendo un archivo grande (~750 LOC tras extraer tools.js). Una
// reducción adicional requeriría partir cada nivel en su propio sub-archivo,
// lo cual es scope para una migración posterior — este PR es split mecánico
// sin cambio de comportamiento.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { getAnthropicClient } = require('../../lib/clients');
const {
  hasMinRoleBE,
  writeFeedEvent,
  sendPushToFincaRoles,
  sendWhatsAppToFincaRoles,
} = require('../../lib/helpers');
const { validateGuardrails } = require('../../lib/autopilotGuardrails');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { assertAutopilotActive } = require('../../lib/autopilotMiddleware');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
  stripReasoning,
} = require('../../lib/autopilotReasoning');
const { rateLimit } = require('../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  AUTOPILOT_PROPOSE_TOOLS,
  AUTOPILOT_EXECUTE_TOOLS,
  PROPOSE_ACTION_MAP,
  EXECUTE_ACTION_MAP,
  ACTION_CATEGORY_MAP,
} = require('./tools');
const { buildFeedbackContext } = require('./helpers');

const router = Router();

router.post('/api/autopilot/analyze', authenticate, assertAutopilotActive, rateLimit('autopilot_analyze', 'ai_heavy'), async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Encargado role or higher required.', 403);
  }
  try {
    // 1. Read configuration
    const configDoc = await db.collection('autopilot_config').doc(req.fincaId).get();
    const config = configDoc.exists ? configDoc.data() : { mode: 'off', objectives: '' };
    if (config.mode === 'off') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Autopilot is disabled. Enable it in Settings.', 400);
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // 2. Consultas paralelas al estado de la finca (users incluido para nivel2)
    const [tasksSnap, productosSnap, monitoreosSnap, lotesSnap, usersSnap, proveedoresSnap] = await Promise.all([
      db.collection('scheduled_tasks').where('fincaId', '==', req.fincaId).get(),
      db.collection('productos').where('fincaId', '==', req.fincaId).get(),
      db.collection('monitoreos')
        .where('fincaId', '==', req.fincaId)
        .where('fecha', '>=', Timestamp.fromDate(thirtyDaysAgo))
        .orderBy('fecha', 'desc')
        .limit(50)
        .get(),
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('users').where('fincaId', '==', req.fincaId).get(),
      db.collection('proveedores').where('fincaId', '==', req.fincaId).get(),
    ]);

    // 3. Procesar snapshot (enriched con IDs para nivel2)
    const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const overdueTasks = [];
    const upcomingTasks = [];
    tasksSnap.docs.forEach(doc => {
      const t = doc.data();
      if (['completed_by_user', 'skipped'].includes(t.status)) return;
      if (t.type === 'REMINDER_3_DAY') return;
      const due = t.executeAt?.toDate?.() || null;
      if (!due) return;
      const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const taskInfo = {
        id: doc.id,
        nombre: t.activity?.name || '—',
        dueDate: due.toISOString().split('T')[0],
        responsableId: t.activity?.responsableId || null,
        loteId: t.loteId || null,
      };
      if (dueDay < todayDay) {
        overdueTasks.push(taskInfo);
      } else if (due <= fourteenDaysAhead) {
        upcomingTasks.push(taskInfo);
      }
    });

    const lowStockProductos = productosSnap.docs
      .filter(doc => {
        const d = doc.data();
        return (d.stockActual ?? 0) <= (d.stockMinimo ?? 0);
      })
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          nombre: d.nombreComercial || '—',
          ingredienteActivo: d.ingredienteActivo || '',
          stockActual: d.stockActual ?? 0,
          stockMinimo: d.stockMinimo ?? 0,
          unidad: d.unidad || '',
          proveedor: d.proveedor || '',
        };
      });

    const recentMonitoreos = monitoreosSnap.docs.map(doc => {
      const d = doc.data();
      return {
        loteNombre: d.loteNombre || '—',
        tipoNombre: d.tipoNombre || '—',
        fecha: d.fecha?.toDate?.()?.toISOString().split('T')[0] || '—',
      };
    });

    const activeLotes = lotesSnap.docs.map(doc => {
      const d = doc.data();
      return { id: doc.id, codigo: d.codigoLote || '', nombre: d.nombreLote || '', hectareas: d.hectareas || null };
    });

    const catalogoUsers = usersSnap.docs.map(doc => {
      const d = doc.data();
      return { id: doc.id, nombre: d.nombre || '', rol: d.rol || '', telefono: d.telefono || '' };
    });

    const catalogoProveedores = proveedoresSnap.docs
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          nombre: d.nombre || '',
          direccion: d.direccion || '',
          tipoPago: d.tipoPago || '',
          moneda: d.moneda || '',
          estado: d.estado || 'activo',
          categoria: d.categoria || '',
        };
      })
      .filter(p => p.nombre && p.estado !== 'inactivo');

    const snapshot = {
      overdueTasksCount: overdueTasks.length,
      upcomingTasksCount: upcomingTasks.length,
      lowStockCount: lowStockProductos.length,
      recentMonitoreosCount: recentMonitoreos.length,
      activeLotesCount: activeLotes.length,
    };

    const anthropicClient = getAnthropicClient();

    // Feedback/directives context of the user running the analysis
    const { directivesBlock, examplesBlock } = await buildFeedbackContext(req.fincaId, req.uid);
    const feedbackPrefix = [directivesBlock, examplesBlock].filter(Boolean).join('\n\n');

    // Snapshot enriquecido con IDs (compartido por nivel2 y nivel3)
    const snapshotTextEnriched = `
## Estado actual de la finca (fecha: ${now.toISOString().split('T')[0]})

**Lotes activos (${activeLotes.length}):**
${activeLotes.length ? activeLotes.map(l => `  - [ID: ${l.id}] ${l.codigo ? l.codigo + ' ' : ''}"${l.nombre}"${l.hectareas ? ` | ${l.hectareas} ha` : ''}`).join('\n') : '  (sin lotes registrados)'}

**Tareas vencidas (${overdueTasks.length}):**
${overdueTasks.length ? overdueTasks.slice(0, 15).map(t => `  - [ID: ${t.id}] "${t.nombre}" — vencida el ${t.dueDate}${t.responsableId ? ` (responsable: ${t.responsableId})` : ''}`).join('\n') : '  (sin tareas vencidas)'}

**Tareas próximas — próximos 14 días (${upcomingTasks.length}):**
${upcomingTasks.length ? upcomingTasks.slice(0, 15).map(t => `  - [ID: ${t.id}] "${t.nombre}" — programada para ${t.dueDate}${t.responsableId ? ` (responsable: ${t.responsableId})` : ''}`).join('\n') : '  (sin tareas próximas)'}

**Productos con stock bajo o agotado (${lowStockProductos.length}):**
${lowStockProductos.length ? lowStockProductos.map(p => `  - [ID: ${p.id}] ${p.nombre}${p.ingredienteActivo ? ` (${p.ingredienteActivo})` : ''} | Stock actual: ${p.stockActual} ${p.unidad} | Mínimo: ${p.stockMinimo} ${p.unidad}${p.proveedor ? ` | Proveedor habitual: "${p.proveedor}"` : ' | Sin proveedor habitual'}`).join('\n') : '  (todos los productos tienen stock suficiente)'}

**Monitoreos recientes — últimos 30 días (${recentMonitoreos.length}):**
${recentMonitoreos.length ? recentMonitoreos.slice(0, 10).map(m => `  - ${m.tipoNombre} en ${m.loteNombre} el ${m.fecha}`).join('\n') : '  (sin monitoreos recientes)'}

**Usuarios / trabajadores disponibles (${catalogoUsers.length}):**
${catalogoUsers.length ? catalogoUsers.map(u => `  - [ID: ${u.id}] ${u.nombre} | Rol: ${u.rol}${u.telefono ? ` | Tel: ${u.telefono}` : ''}`).join('\n') : '  (sin usuarios registrados)'}

**Proveedores activos (${catalogoProveedores.length}):**
${catalogoProveedores.length ? catalogoProveedores.map(p => `  - [ID: ${p.id}] "${p.nombre}"${p.categoria ? ` | ${p.categoria}` : ''}${p.tipoPago ? ` | Pago: ${p.tipoPago}` : ''}${p.moneda ? ` | ${p.moneda}` : ''}`).join('\n') : '  (sin proveedores registrados)'}
`.trim();

    // ════════════════════════════════════════════════════════════════
    //  NIVEL 1 — Recomendaciones (texto)
    // ════════════════════════════════════════════════════════════════
    if (config.mode === 'nivel1') {
      const snapshotText = `
## Estado actual de la finca (fecha: ${now.toISOString().split('T')[0]})

**Lotes activos (${activeLotes.length}):**
${activeLotes.length ? activeLotes.map(l => `  - ${l.codigo ? l.codigo + ' ' : ''}"${l.nombre}"${l.hectareas ? ` | ${l.hectareas} ha` : ''}`).join('\n') : '  (sin lotes registrados)'}

**Tareas vencidas (${overdueTasks.length}):**
${overdueTasks.length ? overdueTasks.slice(0, 15).map(t => `  - "${t.nombre}" — vencida el ${t.dueDate}`).join('\n') : '  (sin tareas vencidas)'}

**Tareas próximas — próximos 14 días (${upcomingTasks.length}):**
${upcomingTasks.length ? upcomingTasks.slice(0, 15).map(t => `  - "${t.nombre}" — programada para ${t.dueDate}`).join('\n') : '  (sin tareas próximas)'}

**Productos con stock bajo o agotado (${lowStockProductos.length}):**
${lowStockProductos.length ? lowStockProductos.map(p => `  - ${p.nombre} | Stock actual: ${p.stockActual} ${p.unidad} | Mínimo: ${p.stockMinimo} ${p.unidad}${p.proveedor ? ` | Proveedor habitual: "${p.proveedor}"` : ' | Sin proveedor habitual'}`).join('\n') : '  (todos los productos tienen stock suficiente)'}

**Monitoreos recientes — últimos 30 días (${recentMonitoreos.length}):**
${recentMonitoreos.length ? recentMonitoreos.slice(0, 10).map(m => `  - ${m.tipoNombre} en ${m.loteNombre} el ${m.fecha}`).join('\n') : '  (sin monitoreos recientes)'}

**Proveedores activos (${catalogoProveedores.length}):**
${catalogoProveedores.length ? catalogoProveedores.slice(0, 15).map(p => `  - "${p.nombre}"${p.categoria ? ` | ${p.categoria}` : ''}`).join('\n') : '  (sin proveedores registrados)'}
`.trim();

      // Tool-forced structured output. Replaces the previous free-text JSON
      // approach, which occasionally failed to parse when Claude prepended
      // commentary or hit max_tokens mid-array. With tool_use the SDK returns
      // already-parsed JSON.
      const VALID_CATS = ['inventario', 'tareas', 'aplicaciones', 'monitoreo', 'general'];
      const VALID_PRIS = ['alta', 'media', 'baja'];
      const nivel1Tool = {
        name: 'generar_recomendaciones',
        description: 'Registra una lista priorizada de recomendaciones para el productor basadas en el análisis del estado actual de la finca.',
        input_schema: {
          type: 'object',
          properties: {
            recomendaciones: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: {
                type: 'object',
                properties: {
                  categoria: { type: 'string', enum: VALID_CATS, description: 'Categoría de la recomendación.' },
                  prioridad: { type: 'string', enum: VALID_PRIS, description: 'Prioridad de la recomendación.' },
                  titulo: { type: 'string', description: 'Título breve e imperativo (idealmente ≤ 60 caracteres, ej: "Reponer stock de Mancozeb").' },
                  descripcion: { type: 'string', description: '1-2 oraciones explicando el problema detectado.' },
                  contexto: { type: 'string', description: 'Dato específico del snapshot que motivó esta recomendación.' },
                  accionSugerida: { type: 'string', description: 'Paso concreto a tomar, comenzando con un verbo.' },
                },
                required: ['categoria', 'prioridad', 'titulo', 'descripcion', 'contexto', 'accionSugerida'],
              },
            },
          },
          required: ['recomendaciones'],
        },
      };

      const systemPrompt = `Eres el analizador estratégico de Aurora, una plataforma de gestión agrícola inteligente.
Tu tarea es analizar el estado actual de la finca y los objetivos del productor, y generar un conjunto de recomendaciones priorizadas, concretas y accionables.

Reglas de respuesta:
- Usa la herramienta **generar_recomendaciones** para entregar las recomendaciones. Es la única forma válida de responder.
- Entrega entre 3 y 10 recomendaciones, ordenadas de mayor a menor prioridad.
- Sé específico: menciona los nombres de productos, tareas o lotes relevantes del contexto.
- Evita recomendaciones genéricas; todas deben basarse en los datos reales proporcionados.
- Si el estado es bueno en un área, puedes omitirla o generar una recomendación de baja prioridad.

Reglas específicas para BAJO STOCK:
- La recomendación NUNCA debe ser "ajustar inventario" ni "actualizar stock" para reponer faltantes. "Ajustar inventario" es solo para corregir discrepancias con la realidad física (conteo, merma, pérdida documentada).
- Si el producto tiene "Proveedor habitual" identificado → recomienda **emitir una orden de compra** a ese proveedor.
- Si el producto no tiene proveedor habitual claro → recomienda **generar una solicitud de compra** para que proveeduría cotice.
- Cantidad a reponer sugerida: al menos 2× el stockMinimo o lo suficiente para 30-60 días.`;

      const userMessage = `${feedbackPrefix ? feedbackPrefix + '\n\n' : ''}**Objetivos del productor para este ciclo:**
${config.objectives?.trim() || 'No se han definido objetivos específicos.'}

${snapshotText}

Analiza el estado y entrega las recomendaciones usando la herramienta generar_recomendaciones.`;

      const claudeResponse = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-6',
        // 2048 was tight: 10 recomendaciones × ~6 fields × prose descriptions
        // can hit `stop_reason: 'max_tokens'` mid-tool-call. Tool input then
        // arrives truncated and our defensive guard rejects it as a 500.
        // 6000 is generous headroom and only costs whatever the model
        // actually generates.
        max_tokens: 6000,
        system: systemPrompt,
        tools: [nivel1Tool],
        tool_choice: { type: 'tool', name: 'generar_recomendaciones' },
        messages: [{ role: 'user', content: userMessage }],
      });

      const toolUse = claudeResponse.content.find(
        (b) => b.type === 'tool_use' && b.name === 'generar_recomendaciones'
      );
      const toolRecs = toolUse?.input?.recomendaciones;
      if (!toolUse || !Array.isArray(toolRecs)) {
        console.error(
          '[AUTOPILOT] Nivel 1: el modelo no llamó a generar_recomendaciones',
          { stop_reason: claudeResponse.stop_reason, content_types: claudeResponse.content.map(b => b.type) }
        );
        await db.collection('autopilot_sessions').add({
          fincaId: req.fincaId, timestamp: Timestamp.now(),
          triggeredBy: req.uid, triggeredByName: req.userEmail,
          snapshot, recommendations: [], status: 'error',
          errorMessage: 'El modelo no devolvió recomendaciones estructuradas.',
        });
        return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process recommendations. Please try again.', 500);
      }

      const recommendations = toolRecs
        .filter((r) => r && typeof r === 'object')
        .map((r, i) => ({
          id: `rec_${i + 1}`,
          categoria: VALID_CATS.includes(r.categoria) ? r.categoria : 'general',
          prioridad: VALID_PRIS.includes(r.prioridad) ? r.prioridad : 'baja',
          titulo: String(r.titulo || '').slice(0, 120),
          descripcion: String(r.descripcion || ''),
          contexto: String(r.contexto || ''),
          accionSugerida: String(r.accionSugerida || ''),
        }))
        .slice(0, 10);

      const sessionRef = await db.collection('autopilot_sessions').add({
        fincaId: req.fincaId, timestamp: Timestamp.now(),
        triggeredBy: req.uid, triggeredByName: req.userEmail,
        snapshot, recommendations, status: 'completed', errorMessage: null,
      });

      writeFeedEvent({
        fincaId: req.fincaId, userName: 'Aurora Copiloto',
        eventType: 'autopilot_analysis',
        title: `Análisis N1: ${recommendations.length} recomendaciones generadas`,
      });

      return res.json({
        sessionId: sessionRef.id, recommendations, snapshot,
        timestamp: new Date().toISOString(),
      });
    }

    // ════════════════════════════════════════════════════════════════
    //  LEVEL 2 — Supervised agency (tool_use → approval queue)
    // ════════════════════════════════════════════════════════════════
    if (config.mode === 'nivel2') {
      const nivel2Tools = AUTOPILOT_PROPOSE_TOOLS;

      const nivel2SystemPrompt = `Eres el piloto automático de Aurora (Nivel 2: Agencia Supervisada), una plataforma de gestión agrícola.
Tu tarea es analizar el estado actual de la finca y proponer acciones concretas usando las herramientas disponibles.

Cada herramienta "proponer_*" registra una propuesta que será revisada por un supervisor antes de ejecutarse.

Reglas generales:
- Propón entre 1 y 8 acciones, priorizando las más urgentes e impactantes.
- Solo propón acciones que tengan sustento claro en los datos proporcionados.
- Usa los IDs exactos del catálogo (lotes, usuarios, productos, proveedores) — no inventes IDs.
- Para cada propuesta, incluye una razón clara que el supervisor pueda evaluar rápidamente.
- Después de llamar a todas las herramientas necesarias, escribe un resumen breve (2-3 oraciones) de lo que propusiste y por qué.
- Si no hay acciones claras que proponer, escribe solo el resumen explicando que la finca está en buen estado.

Decisión para BAJO STOCK (sigue esta jerarquía estrictamente):
1. Si el producto tiene "Proveedor habitual" en el snapshot y ese proveedor aparece en el catálogo de proveedores activos → usa **proponer_orden_compra** (orden formal al proveedor). Referencia al proveedor por su nombre tal como aparece.
2. Si el producto tiene "Proveedor habitual" pero NO está en el catálogo activo de proveedores, o no tiene proveedor habitual → usa **proponer_solicitud_compra** (solicitud interna para que proveeduría cotice/compre).
3. **NUNCA uses proponer_ajustar_inventario para bajo stock.** Esa herramienta es exclusivamente para CORREGIR el stock registrado cuando hay discrepancia con la realidad física (conteo físico, merma, pérdida documentada, error de captura). Si usas ajustar_inventario sin evidencia de discrepancia física, el supervisor rechazará la propuesta.

Cantidad sugerida al comprar: busca reponer hasta al menos (stockMinimo × 2) si es razonable, o lo suficiente para cubrir 30-60 días de consumo estimado. Si no hay datos de consumo, propón 2× el stockMinimo.`;

      const userMessageN2 = `${feedbackPrefix ? feedbackPrefix + '\n\n' : ''}**Objetivos del productor para este ciclo:**
${config.objectives?.trim() || 'No se han definido objetivos específicos.'}

${snapshotTextEnriched}

Analiza el estado y propón acciones concretas usando las herramientas disponibles.`;

      // Agentic loop
      const proposedActions = [];
      const messages = [{ role: 'user', content: userMessageN2 }];
      let summaryText = '';
      let iterations = 0;

      while (iterations < 4) {
        iterations++;
        const response = await anthropicClient.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: MAX_TOKENS_WITH_THINKING,
          thinking: thinkingConfig(),
          system: nivel2SystemPrompt,
          tools: nivel2Tools,
          messages,
        });

        // Extract summary text from this iteration
        const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (textBlocks) summaryText += (summaryText ? '\n' : '') + textBlocks;

        if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
          break;
        }

        // Procesar tool_use blocks
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const actionType = PROPOSE_ACTION_MAP[block.name];
          if (!actionType) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'Herramienta desconocida' }) });
            continue;
          }

          const { prioridad, razon, ...params } = block.input;
          const catMap = ACTION_CATEGORY_MAP;

          proposedActions.push({
            type: actionType,
            params,
            titulo: String(razon || '').slice(0, 120),
            descripcion: String(razon || ''),
            prioridad: ['alta', 'media', 'baja'].includes(prioridad) ? prioridad : 'media',
            categoria: catMap[actionType] || 'general',
            reasoning: buildReasoning(response, block),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ ok: true, mensaje: `Propuesta de ${actionType} registrada para revisión del supervisor.` }),
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Save session
      const sessionRef = await db.collection('autopilot_sessions').add({
        fincaId: req.fincaId, timestamp: Timestamp.now(),
        triggeredBy: req.uid, triggeredByName: req.userEmail,
        snapshot, recommendations: [], summaryText,
        proposedActionsCount: proposedActions.length,
        status: 'completed', errorMessage: null,
      });

      // Save each proposed action
      const nowTs = Timestamp.now();
      const actionRefs = [];
      for (const action of proposedActions) {
        const ref = await db.collection('autopilot_actions').add({
          fincaId: req.fincaId,
          sessionId: sessionRef.id,
          type: action.type,
          params: action.params,
          titulo: action.titulo,
          descripcion: action.descripcion,
          prioridad: action.prioridad,
          categoria: action.categoria,
          status: 'proposed',
          // Mode that originated this action — used by the UI to decide if
          // approve/reject buttons should be enabled at the current level.
          // 'nivel2' here because we're inside the N2 analyze branch.
          sourceMode: 'nivel2',
          proposedBy: req.uid,
          proposedByName: req.userEmail,
          createdAt: nowTs,
          reviewedBy: null,
          reviewedByName: null,
          reviewedAt: null,
          rejectionReason: null,
          executedAt: null,
          executionResult: null,
          reasoning: action.reasoning || null,
        });
        actionRefs.push({ id: ref.id, ...action, status: 'proposed' });
      }

      writeFeedEvent({
        fincaId: req.fincaId, userName: 'Aurora Copiloto',
        eventType: 'autopilot_analysis',
        title: `Análisis N2: ${proposedActions.length} acciones propuestas esperan aprobación`,
      });

      // Push + WhatsApp — notificar a supervisores que hay acciones pendientes
      if (proposedActions.length > 0) {
        const notifRoles = ['supervisor', 'administrador'];
        const actionsList = proposedActions.map(a => `• ${a.titulo}`).join('\n');

        sendPushToFincaRoles(req.fincaId, notifRoles, {
          title: '🤖 Aurora Copiloto — Nivel 2',
          body: `${proposedActions.length} acción(es) propuestas esperan tu aprobación.`,
          url: '/autopilot',
        });

        sendWhatsAppToFincaRoles(req.fincaId, notifRoles, [
          '🤖 *Aurora Copiloto — Nivel 2*',
          '',
          `*${proposedActions.length} acciones propuestas:*`,
          actionsList,
          '',
          '_Ingresa a Aurora para aprobar o rechazar._',
        ].join('\n'));
      }

      return res.json({
        sessionId: sessionRef.id,
        recommendations: [],
        proposedActions: actionRefs.map(stripReasoning),
        summaryText,
        snapshot,
        timestamp: new Date().toISOString(),
      });
    }

    // ════════════════════════════════════════════════════════════════
    //  LEVEL 3 — Full agency (direct execution with guardrails)
    // ════════════════════════════════════════════════════════════════
    if (config.mode === 'nivel3') {
      const guardrails = config.guardrails || {};

      // Lookup maps for guardrail validation
      const taskLoteMap = {};
      tasksSnap.docs.forEach(doc => { taskLoteMap[doc.id] = doc.data().loteId || null; });
      const productStockMap = {};
      productosSnap.docs.forEach(doc => { productStockMap[doc.id] = doc.data().stockActual ?? 0; });

      const nivel3Tools = AUTOPILOT_EXECUTE_TOOLS;

      const nivel3SystemPrompt = `Eres el piloto automático de Aurora (Nivel 3: Agencia Total), una plataforma de gestión agrícola.
Tu tarea es analizar el estado actual de la finca y ejecutar acciones concretas usando las herramientas disponibles.

Cada herramienta "ejecutar_*" realiza la acción directamente. Si una acción excede las barandillas de seguridad configuradas por el productor, será escalada automáticamente a un supervisor para aprobación manual.

Reglas generales:
- Ejecuta entre 1 y 8 acciones, priorizando las más urgentes e impactantes.
- Solo ejecuta acciones que tengan sustento claro en los datos proporcionados.
- Usa los IDs exactos del catálogo (lotes, usuarios, productos, proveedores) — no inventes IDs.
- Para cada acción, incluye una razón clara que justifique la decisión.
- Después de llamar a todas las herramientas necesarias, escribe un resumen breve (2-3 oraciones) de las acciones ejecutadas y su impacto.
- Si una acción fue escalada (no ejecutada por barandilla), menciónalo en el resumen.
- Si no hay acciones claras que ejecutar, escribe solo el resumen explicando que la finca está en buen estado.

Decisión para BAJO STOCK (sigue esta jerarquía estrictamente):
1. Si el producto tiene "Proveedor habitual" en el snapshot y ese proveedor aparece en el catálogo de proveedores activos → usa **ejecutar_orden_compra**.
2. Si el producto tiene "Proveedor habitual" pero NO está en el catálogo, o no tiene proveedor habitual → usa **ejecutar_solicitud_compra**.
3. **NUNCA uses ejecutar_ajustar_inventario para bajo stock.** Esa herramienta es exclusivamente para CORREGIR el stock registrado cuando hay discrepancia con la realidad física (conteo físico, merma, pérdida documentada, error de captura).

Cantidad sugerida al comprar: busca reponer hasta al menos (stockMinimo × 2) si es razonable, o lo suficiente para cubrir 30-60 días de consumo estimado. Si no hay datos de consumo, usa 2× el stockMinimo.`;

      const userMessageN3 = `${feedbackPrefix ? feedbackPrefix + '\n\n' : ''}**Objetivos del productor para este ciclo:**
${config.objectives?.trim() || 'No se han definido objetivos específicos.'}

${snapshotTextEnriched}

Analiza el estado y ejecuta las acciones necesarias usando las herramientas disponibles.`;

      // Agentic loop with guardrail-gated execution.
      // Action docs are persisted inline by executeAutopilotAction so that the
      // side effect and the autopilot_actions write commit (or roll back) as
      // a single transaction. Escalations are written directly since they
      // produce no side effect.
      const sessionRef = db.collection('autopilot_sessions').doc();
      const sessionId = sessionRef.id;
      const actionRefs = []; // Each entry: action initial fields + id + final status
      let executedCount = 0;
      const messages = [{ role: 'user', content: userMessageN3 }];
      let summaryText = '';
      let iterations = 0;

      while (iterations < 4) {
        iterations++;
        const response = await anthropicClient.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: MAX_TOKENS_WITH_THINKING,
          thinking: thinkingConfig(),
          system: nivel3SystemPrompt,
          tools: nivel3Tools,
          messages,
        });

        const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (textBlocks) summaryText += (summaryText ? '\n' : '') + textBlocks;

        if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
          break;
        }

        // Preserve thinking blocks when echoing the assistant turn back in
        // the next request — required by the API to maintain extended-thinking
        // signatures across the agentic loop.
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const actionType = EXECUTE_ACTION_MAP[block.name];
          if (!actionType) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'Herramienta desconocida' }) });
            continue;
          }

          const { prioridad, razon, ...params } = block.input;

          // Resolve loteId for blocked-lotes guardrail
          let resolvedLoteId = params.loteId || null;
          if (!resolvedLoteId && (actionType === 'reprogramar_tarea' || actionType === 'reasignar_tarea')) {
            resolvedLoteId = taskLoteMap[params.taskId] || null;
          }

          // Enrich stockActual for the inventory guardrail
          const enrichedParams = { ...params, loteId: resolvedLoteId };
          if (actionType === 'ajustar_inventario' && params.productoId) {
            enrichedParams.stockActual = productStockMap[params.productoId] ?? params.stockActual ?? 0;
          }

          const guardrailResult = await validateGuardrails(actionType, enrichedParams, guardrails, {
            fincaId: req.fincaId,
            sessionExecutedCount: executedCount,
          });

          const actionDocRef = db.collection('autopilot_actions').doc();
          const actionInitialDoc = {
            fincaId: req.fincaId,
            sessionId,
            type: actionType,
            params,
            titulo: String(razon || '').slice(0, 120),
            descripcion: String(razon || ''),
            prioridad: ['alta', 'media', 'baja'].includes(prioridad) ? prioridad : 'media',
            categoria: ACTION_CATEGORY_MAP[actionType] || 'general',
            // N3 path. Even when guardrails escalate the action to 'proposed'
            // status, the source mode is still N3 — that's what the UI uses
            // to decide whether the current level can act on it.
            sourceMode: 'nivel3',
            autonomous: true,
            escalated: false,
            guardrailViolations: null,
            proposedBy: req.uid,
            proposedByName: req.userEmail,
            createdAt: Timestamp.now(),
            reviewedBy: null,
            reviewedByName: null,
            reviewedAt: null,
            rejectionReason: null,
            reasoning: buildReasoning(response, block),
          };

          if (guardrailResult.allowed) {
            try {
              const execResult = await executeAutopilotAction(actionType, params, req.fincaId, {
                level: 'Nivel 3',
                actionDocRef,
                actionInitialDoc,
              });
              executedCount++;
              actionRefs.push({ id: actionDocRef.id, ...actionInitialDoc, status: 'executed', executionResult: execResult });
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: JSON.stringify({ ok: true, mensaje: 'Acción ejecutada exitosamente.', resultado: execResult }),
              });
            } catch (execErr) {
              // executeAutopilotAction already recorded status='failed' on the action doc
              actionRefs.push({ id: actionDocRef.id, ...actionInitialDoc, status: 'failed', executionResult: { error: execErr.message } });
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: execErr.message }),
              });
            }
          } else {
            // Escalation — direct write, no transaction needed (no side effect)
            const escalatedDoc = {
              ...actionInitialDoc,
              status: 'proposed',
              escalated: true,
              guardrailViolations: guardrailResult.violations,
            };
            try {
              await actionDocRef.set(escalatedDoc);
            } catch (writeErr) {
              console.error('[AUTOPILOT] Failed to write escalated action:', writeErr);
            }
            actionRefs.push({ id: actionDocRef.id, ...escalatedDoc });
            toolResults.push({
              type: 'tool_result', tool_use_id: block.id,
              content: JSON.stringify({
                ok: false, escalada: true,
                mensaje: `Acción escalada a supervisor: ${guardrailResult.violations.join('; ')}`,
              }),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Aggregate counts and persist the session at the end (its ID was
      // pre-allocated above so action docs already reference it).
      const executedActions = actionRefs.filter(a => a.status === 'executed');
      const escalatedActions = actionRefs.filter(a => a.escalated);
      const failedActions = actionRefs.filter(a => a.status === 'failed');

      await sessionRef.set({
        fincaId: req.fincaId, timestamp: Timestamp.now(),
        triggeredBy: req.uid, triggeredByName: req.userEmail,
        snapshot, recommendations: [], summaryText,
        executedActionsCount: executedActions.length,
        escalatedActionsCount: escalatedActions.length,
        totalActionsCount: actionRefs.length,
        mode: 'nivel3',
        status: 'completed', errorMessage: null,
      });

      // Feed events — each executed action + session summary
      for (const action of executedActions) {
        writeFeedEvent({
          fincaId: req.fincaId, userName: 'Aurora Copiloto',
          eventType: 'autopilot_action_executed',
          title: action.titulo,
        });
      }
      for (const action of escalatedActions) {
        writeFeedEvent({
          fincaId: req.fincaId, userName: 'Aurora Copiloto',
          eventType: 'autopilot_action_escalated',
          title: `Escalada: ${action.titulo}`,
        });
      }
      writeFeedEvent({
        fincaId: req.fincaId, userName: 'Aurora Copiloto',
        eventType: 'autopilot_analysis',
        title: `Análisis N3 completado: ${executedActions.length} ejecutadas, ${escalatedActions.length} escaladas`,
      });

      // Push + WhatsApp — notificar a supervisores y administradores
      const notifRoles = ['supervisor', 'administrador'];

      if (executedActions.length > 0 || escalatedActions.length > 0) {
        const actionsList = executedActions.map(a => `✅ ${a.titulo}`).join('\n');
        const escalatedList = escalatedActions.map(a => `⚠️ ${a.titulo}`).join('\n');
        const pushBody = executedActions.length > 0
          ? `${executedActions.length} acción(es) ejecutadas autónomamente.${escalatedActions.length > 0 ? ` ${escalatedActions.length} escalada(s).` : ''}`
          : `${escalatedActions.length} acción(es) escaladas requieren aprobación.`;

        // Push inmediato
        sendPushToFincaRoles(req.fincaId, notifRoles, {
          title: '🤖 Aurora Copiloto — Nivel 3',
          body: pushBody,
          url: '/autopilot',
        });

        // WhatsApp resumen
        const whatsMsg = [
          '🤖 *Aurora Copiloto — Nivel 3*',
          '',
          executedActions.length > 0 ? `*Acciones ejecutadas (${executedActions.length}):*` : null,
          executedActions.length > 0 ? actionsList : null,
          escalatedActions.length > 0 ? '' : null,
          escalatedActions.length > 0 ? `*Acciones escaladas (${escalatedActions.length}):*` : null,
          escalatedActions.length > 0 ? escalatedList : null,
          escalatedActions.length > 0 ? '\n_Ingresa a Aurora para aprobar o rechazar las acciones escaladas._' : null,
          '',
          `Sesión: ${sessionRef.id}`,
        ].filter(Boolean).join('\n');

        sendWhatsAppToFincaRoles(req.fincaId, notifRoles, whatsMsg);
      }

      return res.json({
        sessionId: sessionRef.id,
        recommendations: [],
        proposedActions: actionRefs.filter(a => a.status === 'proposed').map(stripReasoning),
        executedActions: actionRefs.filter(a => a.status === 'executed').map(stripReasoning),
        failedActions: actionRefs.filter(a => a.status === 'failed').map(stripReasoning),
        summaryText,
        snapshot,
        timestamp: new Date().toISOString(),
      });
    }

    // Modo no reconocido
    return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported Autopilot mode.', 400);

  } catch (err) {
    console.error('[AUTOPILOT] Error en analyze:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Internal error running analysis.', 500);
  }
});

module.exports = router;
