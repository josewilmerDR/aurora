const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { getAnthropicClient } = require('../lib/clients');
const {
  hasMinRoleBE,
  executeAutopilotAction,
  validateGuardrails,
  writeFeedEvent,
  sendPushToFincaRoles,
  sendWhatsAppToFincaRoles,
} = require('../lib/helpers');

const router = Router();

// Build per-user feedback context: hard directives + soft few-shot examples.
// Directives are rules the user explicitly opted in; feedback is a style signal only.
async function buildFeedbackContext(fincaId, userId) {
  try {
    const [feedbackSnap, directivesSnap] = await Promise.all([
      db.collection('copilot_feedback')
        .where('fincaId', '==', fincaId)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get(),
      db.collection('copilot_directives')
        .where('fincaId', '==', fincaId)
        .where('userId', '==', userId)
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get(),
    ]);

    const directives = directivesSnap.docs
      .map(d => String(d.data().text || '').trim())
      .filter(Boolean);
    const feedback = feedbackSnap.docs.map(d => d.data());

    const directivesBlock = directives.length
      ? [
          '<reglas_del_usuario>',
          'Reglas firmes establecidas explícitamente por este usuario. Respétalas sin excepciones:',
          ...directives.map((t, i) => `${i + 1}. ${t}`),
          '</reglas_del_usuario>',
        ].join('\n')
      : '';

    const positive = feedback.filter(f => f.signal === 'up').slice(0, 5);
    const negative = feedback.filter(f => f.signal === 'down').slice(0, 5);

    let examplesBlock = '';
    if (positive.length || negative.length) {
      const lines = ['<feedback_previo>'];
      lines.push('Historial de feedback de este usuario. Úsalo como guía de ESTILO — qué tipo de sugerencias valora y cuáles no. NO lo uses como filtro de temas: un 👎 no significa "evitar este tema", solo "esta sugerencia específica no sirvió". Sigue proponiendo en todas las categorías a menos que una regla explícita en <reglas_del_usuario> lo prohíba.');
      if (positive.length) {
        lines.push('');
        lines.push('Marcadas como útiles (👍):');
        positive.forEach(f => {
          const titulo = f.targetTitle || '(sin título)';
          const cat = f.categoria || 'general';
          const c = f.comment ? ` — comentario: "${f.comment}"` : '';
          lines.push(`- [${cat}] "${titulo}"${c}`);
        });
      }
      if (negative.length) {
        lines.push('');
        lines.push('Marcadas como NO útiles (👎):');
        negative.forEach(f => {
          const titulo = f.targetTitle || '(sin título)';
          const cat = f.categoria || 'general';
          const c = f.comment ? ` — comentario: "${f.comment}"` : '';
          lines.push(`- [${cat}] "${titulo}"${c}`);
        });
      }
      lines.push('</feedback_previo>');
      examplesBlock = lines.join('\n');
    }

    return { directivesBlock, examplesBlock };
  } catch (err) {
    console.error('[AUTOPILOT] Error al construir contexto de feedback:', err);
    return { directivesBlock: '', examplesBlock: '' };
  }
}

// GET /api/autopilot/config
router.get('/api/autopilot/config', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('autopilot_config').doc(req.fincaId).get();
    if (!doc.exists) {
      return res.json({ fincaId: req.fincaId, mode: 'off', objectives: '', guardrails: {} });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('[AUTOPILOT] Error al obtener config:', err);
    res.status(500).json({ message: 'Error al obtener configuración del Piloto Automático.' });
  }
});

// PUT /api/autopilot/config  (minRole: supervisor)
router.put('/api/autopilot/config', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return res.status(403).json({ message: 'Se requiere rol de Supervisor o superior.' });
  }
  try {
    const { mode, objectives, guardrails } = req.body;
    const VALID_MODES = ['off', 'nivel1', 'nivel2', 'nivel3'];
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      return res.status(400).json({ message: 'Modo inválido.' });
    }
    const ref = db.collection('autopilot_config').doc(req.fincaId);
    const existing = await ref.get();
    const now = Timestamp.now();
    const payload = {
      fincaId: req.fincaId,
      ...(mode !== undefined && { mode }),
      ...(objectives !== undefined && { objectives }),
      updatedAt: now,
    };
    if (guardrails !== undefined && typeof guardrails === 'object') {
      const VALID_ACTION_TYPES = ['crear_tarea', 'reprogramar_tarea', 'reasignar_tarea', 'ajustar_inventario', 'enviar_notificacion', 'crear_solicitud_compra', 'crear_orden_compra'];
      const g = {};
      if (typeof guardrails.maxActionsPerSession === 'number') {
        g.maxActionsPerSession = Math.max(1, Math.min(20, Math.round(guardrails.maxActionsPerSession)));
      }
      if (typeof guardrails.maxStockAdjustPercent === 'number') {
        g.maxStockAdjustPercent = Math.max(1, Math.min(100, Math.round(guardrails.maxStockAdjustPercent)));
      }
      if (Array.isArray(guardrails.allowedActionTypes)) {
        g.allowedActionTypes = guardrails.allowedActionTypes.filter(t => VALID_ACTION_TYPES.includes(t));
      }
      if (Array.isArray(guardrails.blockedLotes)) {
        g.blockedLotes = guardrails.blockedLotes.filter(id => typeof id === 'string' && id.length > 0);
      }
      payload.guardrails = g;
    }
    if (!existing.exists) payload.createdAt = now;
    await ref.set(payload, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al guardar config:', err);
    res.status(500).json({ message: 'Error al guardar la configuración.' });
  }
});

// POST /api/autopilot/analyze  (minRole: encargado)
router.post('/api/autopilot/analyze', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return res.status(403).json({ message: 'Se requiere rol de Encargado o superior.' });
  }
  try {
    // 1. Leer configuración
    const configDoc = await db.collection('autopilot_config').doc(req.fincaId).get();
    const config = configDoc.exists ? configDoc.data() : { mode: 'off', objectives: '' };
    if (config.mode === 'off') {
      return res.status(400).json({ message: 'El Piloto Automático está desactivado. Actívalo en Configuración.' });
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

    // Contexto de feedback/directivas del usuario que ejecuta el análisis
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

      const systemPrompt = `Eres el analizador estratégico de Aurora, una plataforma de gestión agrícola inteligente.
Tu tarea es analizar el estado actual de la finca y los objetivos del productor, y generar un conjunto de recomendaciones priorizadas, concretas y accionables.

Reglas de respuesta:
- Responde ÚNICAMENTE con un array JSON válido (sin texto adicional, sin markdown, sin bloques de código).
- El array puede contener de 3 a 10 recomendaciones.
- Ordena las recomendaciones de mayor a menor prioridad.
- Sé específico: menciona los nombres de productos, tareas o lotes relevantes del contexto.
- Evita recomendaciones genéricas; todas deben basarse en los datos reales proporcionados.
- Si el estado es bueno en un área, puedes omitirla o generar una recomendación de baja prioridad.

Reglas específicas para BAJO STOCK:
- La recomendación NUNCA debe ser "ajustar inventario" ni "actualizar stock" para reponer faltantes. "Ajustar inventario" es solo para corregir discrepancias con la realidad física (conteo, merma, pérdida documentada).
- Si el producto tiene "Proveedor habitual" identificado → recomienda **emitir una orden de compra** a ese proveedor.
- Si el producto no tiene proveedor habitual claro → recomienda **generar una solicitud de compra** para que proveeduría cotice.
- Cantidad a reponer sugerida: al menos 2× el stockMinimo o lo suficiente para 30-60 días.

Esquema de cada recomendación (JSON estricto):
{
  "id": "rec_1",
  "categoria": "inventario | tareas | aplicaciones | monitoreo | general",
  "prioridad": "alta | media | baja",
  "titulo": "máx 60 caracteres, imperativo (ej: Reponer stock de Mancozeb)",
  "descripcion": "1-2 oraciones explicando el problema detectado",
  "contexto": "dato específico del snapshot que motivó esta recomendación",
  "accionSugerida": "paso concreto a tomar, comenzando con un verbo"
}`;

      const userMessage = `${feedbackPrefix ? feedbackPrefix + '\n\n' : ''}**Objetivos del productor para este ciclo:**
${config.objectives?.trim() || 'No se han definido objetivos específicos.'}

${snapshotText}

Genera las recomendaciones en formato JSON array.`;

      const claudeResponse = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const rawText = claudeResponse.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const VALID_CATS = ['inventario', 'tareas', 'aplicaciones', 'monitoreo', 'general'];
      const VALID_PRIS = ['alta', 'media', 'baja'];
      let recommendations = [];
      try {
        const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        recommendations = (Array.isArray(parsed) ? parsed : [])
          .filter(r => r && typeof r === 'object')
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
      } catch (parseErr) {
        console.error('[AUTOPILOT] Error al parsear respuesta de Claude:', parseErr.message, rawText.slice(0, 200));
        await db.collection('autopilot_sessions').add({
          fincaId: req.fincaId, timestamp: Timestamp.now(),
          triggeredBy: req.uid, triggeredByName: req.userEmail,
          snapshot, recommendations: [], status: 'error',
          errorMessage: 'No se pudo interpretar la respuesta del modelo.',
        });
        return res.status(500).json({ message: 'Error al procesar las recomendaciones. Por favor intenta de nuevo.' });
      }

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
    //  NIVEL 2 — Agencia Supervisada (tool_use → cola de aprobación)
    // ════════════════════════════════════════════════════════════════
    if (config.mode === 'nivel2') {
      const nivel2Tools = [
        {
          name: 'proponer_crear_tarea',
          description: 'Propone la creación de una nueva tarea programada. Se guardará como propuesta para aprobación del supervisor.',
          input_schema: {
            type: 'object',
            properties: {
              nombre:            { type: 'string', description: 'Nombre descriptivo de la tarea/actividad.' },
              loteId:            { type: 'string', description: 'ID del lote (del catálogo).' },
              loteNombre:        { type: 'string', description: 'Nombre del lote (para visualización).' },
              responsableId:     { type: 'string', description: 'ID del usuario responsable (del catálogo).' },
              responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
              fecha:             { type: 'string', description: 'Fecha de ejecución YYYY-MM-DD.' },
              productos:         { type: 'array', items: { type: 'object', properties: { productoId: { type: 'string' }, nombreComercial: { type: 'string' }, cantidad: { type: 'number' }, unidad: { type: 'string' } } }, description: 'Productos a aplicar (opcional, solo para tareas de tipo aplicación).' },
              razon:             { type: 'string', description: 'Razón clara por la cual se propone esta tarea, basada en los datos.' },
              prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['nombre', 'loteId', 'responsableId', 'fecha', 'razon', 'prioridad'],
          },
        },
        {
          name: 'proponer_reprogramar_tarea',
          description: 'Propone reprogramar una tarea existente a una nueva fecha.',
          input_schema: {
            type: 'object',
            properties: {
              taskId:    { type: 'string', description: 'ID de la tarea existente (del snapshot).' },
              taskName:  { type: 'string', description: 'Nombre de la tarea (para visualización).' },
              oldDate:   { type: 'string', description: 'Fecha actual de la tarea YYYY-MM-DD.' },
              newDate:   { type: 'string', description: 'Nueva fecha propuesta YYYY-MM-DD.' },
              razon:     { type: 'string', description: 'Razón de la reprogramación.' },
              prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['taskId', 'taskName', 'newDate', 'razon', 'prioridad'],
          },
        },
        {
          name: 'proponer_reasignar_tarea',
          description: 'Propone reasignar una tarea a un usuario diferente.',
          input_schema: {
            type: 'object',
            properties: {
              taskId:      { type: 'string', description: 'ID de la tarea existente.' },
              taskName:    { type: 'string', description: 'Nombre de la tarea.' },
              oldUserId:   { type: 'string', description: 'ID del responsable actual.' },
              oldUserName: { type: 'string', description: 'Nombre del responsable actual.' },
              newUserId:   { type: 'string', description: 'ID del nuevo responsable (del catálogo).' },
              newUserName: { type: 'string', description: 'Nombre del nuevo responsable.' },
              razon:       { type: 'string', description: 'Razón de la reasignación.' },
              prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['taskId', 'taskName', 'newUserId', 'newUserName', 'razon', 'prioridad'],
          },
        },
        {
          name: 'proponer_ajustar_inventario',
          description: 'Propone CORREGIR el stock registrado para reflejar la realidad física (por conteo físico, pérdida, merma o error de captura). NO usar para reponer inventario bajo — para eso existen proponer_solicitud_compra y proponer_orden_compra.',
          input_schema: {
            type: 'object',
            properties: {
              productoId:     { type: 'string', description: 'ID del producto (del catálogo).' },
              productoNombre: { type: 'string', description: 'Nombre del producto.' },
              stockActual:    { type: 'number', description: 'Stock actual registrado.' },
              stockNuevo:     { type: 'number', description: 'Nuevo valor de stock propuesto.' },
              unidad:         { type: 'string', description: 'Unidad de medida.' },
              nota:           { type: 'string', description: 'Razón concreta del ajuste: conteo físico, merma, pérdida, error de captura, etc.' },
              prioridad:      { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['productoId', 'productoNombre', 'stockNuevo', 'nota', 'prioridad'],
          },
        },
        {
          name: 'proponer_solicitud_compra',
          description: 'Propone crear una solicitud interna de compra (request interno para que proveeduría cotice/compre). Úsalo cuando hay bajo stock y no hay proveedor habitual claro, o cuando el productor decide la cotización antes de emitir la orden formal.',
          input_schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: 'Productos que se solicitan.',
                items: {
                  type: 'object',
                  properties: {
                    productoId:         { type: 'string', description: 'ID del producto (del catálogo).' },
                    nombreComercial:    { type: 'string', description: 'Nombre comercial del producto.' },
                    cantidadSolicitada: { type: 'number', description: 'Cantidad a solicitar (en la misma unidad del producto).' },
                    unidad:             { type: 'string', description: 'Unidad del producto.' },
                    stockActual:        { type: 'number', description: 'Stock actual del producto al momento de la solicitud.' },
                    stockMinimo:        { type: 'number', description: 'Stock mínimo configurado para el producto.' },
                  },
                  required: ['productoId', 'nombreComercial', 'cantidadSolicitada', 'unidad'],
                },
              },
              responsableId:     { type: 'string', description: 'ID del usuario responsable de la solicitud (del catálogo); omitir para default "proveeduria".' },
              responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
              notas:             { type: 'string', description: 'Justificación y contexto de la solicitud.' },
              razon:             { type: 'string', description: 'Razón clara que el supervisor pueda evaluar.' },
              prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['items', 'razon', 'prioridad'],
          },
        },
        {
          name: 'proponer_orden_compra',
          description: 'Propone emitir una orden de compra formal a un proveedor específico. Úsalo cuando el producto tiene un proveedor habitual identificado o el productor ya tiene decidido a quién comprar. Si el proveedor habitual no está claro, prefiere proponer_solicitud_compra.',
          input_schema: {
            type: 'object',
            properties: {
              proveedor:          { type: 'string', description: 'Nombre del proveedor (del catálogo de proveedores si existe, o del campo producto.proveedor).' },
              direccionProveedor: { type: 'string', description: 'Dirección del proveedor (opcional).' },
              fecha:              { type: 'string', description: 'Fecha de la orden YYYY-MM-DD (opcional; por defecto hoy).' },
              fechaEntrega:       { type: 'string', description: 'Fecha esperada de entrega YYYY-MM-DD (opcional).' },
              items: {
                type: 'array',
                description: 'Productos a ordenar con cantidad y precio estimado.',
                items: {
                  type: 'object',
                  properties: {
                    productoId:       { type: 'string', description: 'ID del producto (del catálogo).' },
                    nombreComercial:  { type: 'string', description: 'Nombre comercial.' },
                    ingredienteActivo:{ type: 'string', description: 'Ingrediente activo (si aplica).' },
                    cantidad:         { type: 'number', description: 'Cantidad a ordenar.' },
                    unidad:           { type: 'string', description: 'Unidad (kg, L, etc).' },
                    precioUnitario:   { type: 'number', description: 'Precio unitario estimado (0 si no se conoce).' },
                    iva:              { type: 'number', description: 'Porcentaje de IVA (0 si no se conoce).' },
                    moneda:           { type: 'string', description: 'Moneda (USD/CRC). Default USD.' },
                  },
                  required: ['nombreComercial', 'cantidad', 'unidad'],
                },
              },
              solicitudId: { type: 'string', description: 'ID de la solicitud de compra asociada (opcional).' },
              notas:       { type: 'string', description: 'Notas adicionales de la orden.' },
              razon:       { type: 'string', description: 'Razón clara que el supervisor pueda evaluar.' },
              prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['proveedor', 'items', 'razon', 'prioridad'],
          },
        },
        {
          name: 'proponer_notificacion',
          description: 'Propone enviar una notificación WhatsApp a un trabajador.',
          input_schema: {
            type: 'object',
            properties: {
              userId:   { type: 'string', description: 'ID del usuario destinatario (del catálogo).' },
              userName: { type: 'string', description: 'Nombre del usuario.' },
              telefono: { type: 'string', description: 'Teléfono del usuario.' },
              mensaje:  { type: 'string', description: 'Contenido del mensaje WhatsApp.' },
              razon:    { type: 'string', description: 'Razón de la notificación.' },
              prioridad:{ type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['userId', 'userName', 'mensaje', 'razon', 'prioridad'],
          },
        },
      ];

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
          max_tokens: 4096,
          system: nivel2SystemPrompt,
          tools: nivel2Tools,
          messages,
        });

        // Extraer texto de resumen de esta iteración
        const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (textBlocks) summaryText += (summaryText ? '\n' : '') + textBlocks;

        if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
          break;
        }

        // Procesar tool_use blocks
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        const ACTION_TYPE_MAP = {
          proponer_crear_tarea: 'crear_tarea',
          proponer_reprogramar_tarea: 'reprogramar_tarea',
          proponer_reasignar_tarea: 'reasignar_tarea',
          proponer_ajustar_inventario: 'ajustar_inventario',
          proponer_notificacion: 'enviar_notificacion',
          proponer_solicitud_compra: 'crear_solicitud_compra',
          proponer_orden_compra: 'crear_orden_compra',
        };

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const actionType = ACTION_TYPE_MAP[block.name];
          if (!actionType) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'Herramienta desconocida' }) });
            continue;
          }

          const { prioridad, razon, ...params } = block.input;
          const catMap = {
            crear_tarea: 'tareas', reprogramar_tarea: 'tareas', reasignar_tarea: 'tareas',
            ajustar_inventario: 'inventario', enviar_notificacion: 'general',
            crear_solicitud_compra: 'inventario', crear_orden_compra: 'inventario',
          };

          proposedActions.push({
            type: actionType,
            params,
            titulo: String(razon || '').slice(0, 120),
            descripcion: String(razon || ''),
            prioridad: ['alta', 'media', 'baja'].includes(prioridad) ? prioridad : 'media',
            categoria: catMap[actionType] || 'general',
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ ok: true, mensaje: `Propuesta de ${actionType} registrada para revisión del supervisor.` }),
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Guardar sesión
      const sessionRef = await db.collection('autopilot_sessions').add({
        fincaId: req.fincaId, timestamp: Timestamp.now(),
        triggeredBy: req.uid, triggeredByName: req.userEmail,
        snapshot, recommendations: [], summaryText,
        proposedActionsCount: proposedActions.length,
        status: 'completed', errorMessage: null,
      });

      // Guardar cada acción propuesta
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
          proposedBy: req.uid,
          proposedByName: req.userEmail,
          createdAt: nowTs,
          reviewedBy: null,
          reviewedByName: null,
          reviewedAt: null,
          rejectionReason: null,
          executedAt: null,
          executionResult: null,
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
        proposedActions: actionRefs,
        summaryText,
        snapshot,
        timestamp: new Date().toISOString(),
      });
    }

    // ════════════════════════════════════════════════════════════════
    //  NIVEL 3 — Agencia Total (ejecución directa con barandillas)
    // ════════════════════════════════════════════════════════════════
    if (config.mode === 'nivel3') {
      const guardrails = config.guardrails || {};

      // Lookup maps para validación de barandillas
      const taskLoteMap = {};
      tasksSnap.docs.forEach(doc => { taskLoteMap[doc.id] = doc.data().loteId || null; });
      const productStockMap = {};
      productosSnap.docs.forEach(doc => { productStockMap[doc.id] = doc.data().stockActual ?? 0; });

      const nivel3Tools = [
        {
          name: 'ejecutar_crear_tarea',
          description: 'Crea una nueva tarea programada directamente. Se ejecuta de inmediato si cumple las barandillas de seguridad.',
          input_schema: {
            type: 'object',
            properties: {
              nombre:            { type: 'string', description: 'Nombre descriptivo de la tarea/actividad.' },
              loteId:            { type: 'string', description: 'ID del lote (del catálogo).' },
              loteNombre:        { type: 'string', description: 'Nombre del lote (para visualización).' },
              responsableId:     { type: 'string', description: 'ID del usuario responsable (del catálogo).' },
              responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
              fecha:             { type: 'string', description: 'Fecha de ejecución YYYY-MM-DD.' },
              productos:         { type: 'array', items: { type: 'object', properties: { productoId: { type: 'string' }, nombreComercial: { type: 'string' }, cantidad: { type: 'number' }, unidad: { type: 'string' } } }, description: 'Productos a aplicar (opcional, solo para tareas de tipo aplicación).' },
              razon:             { type: 'string', description: 'Razón clara por la cual se ejecuta esta tarea, basada en los datos.' },
              prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['nombre', 'loteId', 'responsableId', 'fecha', 'razon', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_reprogramar_tarea',
          description: 'Reprograma una tarea existente a una nueva fecha directamente.',
          input_schema: {
            type: 'object',
            properties: {
              taskId:    { type: 'string', description: 'ID de la tarea existente (del snapshot).' },
              taskName:  { type: 'string', description: 'Nombre de la tarea (para visualización).' },
              oldDate:   { type: 'string', description: 'Fecha actual de la tarea YYYY-MM-DD.' },
              newDate:   { type: 'string', description: 'Nueva fecha YYYY-MM-DD.' },
              razon:     { type: 'string', description: 'Razón de la reprogramación.' },
              prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['taskId', 'taskName', 'newDate', 'razon', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_reasignar_tarea',
          description: 'Reasigna una tarea a un usuario diferente directamente.',
          input_schema: {
            type: 'object',
            properties: {
              taskId:      { type: 'string', description: 'ID de la tarea existente.' },
              taskName:    { type: 'string', description: 'Nombre de la tarea.' },
              oldUserId:   { type: 'string', description: 'ID del responsable actual.' },
              oldUserName: { type: 'string', description: 'Nombre del responsable actual.' },
              newUserId:   { type: 'string', description: 'ID del nuevo responsable (del catálogo).' },
              newUserName: { type: 'string', description: 'Nombre del nuevo responsable.' },
              razon:       { type: 'string', description: 'Razón de la reasignación.' },
              prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['taskId', 'taskName', 'newUserId', 'newUserName', 'razon', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_ajustar_inventario',
          description: 'CORRIGE el stock registrado para reflejar la realidad física (por conteo físico, merma, pérdida documentada, error de captura). NO usar para reponer inventario bajo — para eso existen ejecutar_solicitud_compra y ejecutar_orden_compra.',
          input_schema: {
            type: 'object',
            properties: {
              productoId:     { type: 'string', description: 'ID del producto (del catálogo).' },
              productoNombre: { type: 'string', description: 'Nombre del producto.' },
              stockActual:    { type: 'number', description: 'Stock actual registrado.' },
              stockNuevo:     { type: 'number', description: 'Nuevo valor de stock.' },
              unidad:         { type: 'string', description: 'Unidad de medida.' },
              nota:           { type: 'string', description: 'Razón concreta del ajuste: conteo físico, merma, pérdida, error de captura.' },
              prioridad:      { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['productoId', 'productoNombre', 'stockNuevo', 'nota', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_solicitud_compra',
          description: 'Crea una solicitud interna de compra directamente. Úsalo cuando hay bajo stock y no hay proveedor habitual claro, o cuando se necesita que proveeduría cotice antes de emitir la orden formal.',
          input_schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: 'Productos que se solicitan.',
                items: {
                  type: 'object',
                  properties: {
                    productoId:         { type: 'string' },
                    nombreComercial:    { type: 'string' },
                    cantidadSolicitada: { type: 'number' },
                    unidad:             { type: 'string' },
                    stockActual:        { type: 'number' },
                    stockMinimo:        { type: 'number' },
                  },
                  required: ['productoId', 'nombreComercial', 'cantidadSolicitada', 'unidad'],
                },
              },
              responsableId:     { type: 'string' },
              responsableNombre: { type: 'string' },
              notas:             { type: 'string' },
              razon:             { type: 'string', description: 'Razón clara de la solicitud.' },
              prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['items', 'razon', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_orden_compra',
          description: 'Emite una orden de compra formal a un proveedor específico directamente. Úsalo cuando el producto tiene un proveedor habitual identificado y conocido.',
          input_schema: {
            type: 'object',
            properties: {
              proveedor:          { type: 'string', description: 'Nombre del proveedor.' },
              direccionProveedor: { type: 'string' },
              fecha:              { type: 'string', description: 'YYYY-MM-DD (opcional).' },
              fechaEntrega:       { type: 'string', description: 'YYYY-MM-DD (opcional).' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    productoId:        { type: 'string' },
                    nombreComercial:   { type: 'string' },
                    ingredienteActivo: { type: 'string' },
                    cantidad:          { type: 'number' },
                    unidad:            { type: 'string' },
                    precioUnitario:    { type: 'number' },
                    iva:               { type: 'number' },
                    moneda:            { type: 'string' },
                  },
                  required: ['nombreComercial', 'cantidad', 'unidad'],
                },
              },
              solicitudId: { type: 'string' },
              notas:       { type: 'string' },
              razon:       { type: 'string', description: 'Razón clara de la orden.' },
              prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['proveedor', 'items', 'razon', 'prioridad'],
          },
        },
        {
          name: 'ejecutar_notificacion',
          description: 'Envía una notificación WhatsApp a un trabajador directamente.',
          input_schema: {
            type: 'object',
            properties: {
              userId:   { type: 'string', description: 'ID del usuario destinatario (del catálogo).' },
              userName: { type: 'string', description: 'Nombre del usuario.' },
              telefono: { type: 'string', description: 'Teléfono del usuario.' },
              mensaje:  { type: 'string', description: 'Contenido del mensaje WhatsApp.' },
              razon:    { type: 'string', description: 'Razón de la notificación.' },
              prioridad:{ type: 'string', enum: ['alta', 'media', 'baja'] },
            },
            required: ['userId', 'userName', 'mensaje', 'razon', 'prioridad'],
          },
        },
      ];

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

      // Agentic loop con ejecución gated por barandillas
      const allActions = [];
      let executedCount = 0;
      const messages = [{ role: 'user', content: userMessageN3 }];
      let summaryText = '';
      let iterations = 0;

      const ACTION_TYPE_MAP_N3 = {
        ejecutar_crear_tarea: 'crear_tarea',
        ejecutar_reprogramar_tarea: 'reprogramar_tarea',
        ejecutar_reasignar_tarea: 'reasignar_tarea',
        ejecutar_ajustar_inventario: 'ajustar_inventario',
        ejecutar_notificacion: 'enviar_notificacion',
        ejecutar_solicitud_compra: 'crear_solicitud_compra',
        ejecutar_orden_compra: 'crear_orden_compra',
      };
      const catMap = {
        crear_tarea: 'tareas', reprogramar_tarea: 'tareas', reasignar_tarea: 'tareas',
        ajustar_inventario: 'inventario', enviar_notificacion: 'general',
        crear_solicitud_compra: 'inventario', crear_orden_compra: 'inventario',
      };

      while (iterations < 4) {
        iterations++;
        const response = await anthropicClient.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: nivel3SystemPrompt,
          tools: nivel3Tools,
          messages,
        });

        const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (textBlocks) summaryText += (summaryText ? '\n' : '') + textBlocks;

        if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
          break;
        }

        messages.push({ role: 'assistant', content: response.content });
        const toolResults = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const actionType = ACTION_TYPE_MAP_N3[block.name];
          if (!actionType) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'Herramienta desconocida' }) });
            continue;
          }

          const { prioridad, razon, ...params } = block.input;

          // Resolver loteId para barandilla de lotes bloqueados
          let resolvedLoteId = params.loteId || null;
          if (!resolvedLoteId && (actionType === 'reprogramar_tarea' || actionType === 'reasignar_tarea')) {
            resolvedLoteId = taskLoteMap[params.taskId] || null;
          }

          // Enriquecer stockActual para barandilla de inventario
          const enrichedParams = { ...params, loteId: resolvedLoteId };
          if (actionType === 'ajustar_inventario' && params.productoId) {
            enrichedParams.stockActual = productStockMap[params.productoId] ?? params.stockActual ?? 0;
          }

          // Validar barandillas
          const guardrailResult = validateGuardrails(actionType, enrichedParams, guardrails, executedCount);

          const actionRecord = {
            type: actionType,
            params,
            titulo: String(razon || '').slice(0, 120),
            descripcion: String(razon || ''),
            prioridad: ['alta', 'media', 'baja'].includes(prioridad) ? prioridad : 'media',
            categoria: catMap[actionType] || 'general',
            autonomous: true,
          };

          if (guardrailResult.allowed) {
            // EJECUTAR DIRECTAMENTE
            try {
              const execResult = await executeAutopilotAction(actionType, params, req.fincaId, { level: 'Nivel 3' });
              actionRecord.status = 'executed';
              actionRecord.executionResult = execResult;
              actionRecord.executedAt = Timestamp.now();
              executedCount++;
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: JSON.stringify({ ok: true, mensaje: 'Acción ejecutada exitosamente.', resultado: execResult }),
              });
            } catch (execErr) {
              actionRecord.status = 'failed';
              actionRecord.executionResult = { error: execErr.message };
              actionRecord.executedAt = Timestamp.now();
              toolResults.push({
                type: 'tool_result', tool_use_id: block.id,
                content: JSON.stringify({ ok: false, error: execErr.message }),
              });
            }
          } else {
            // ESCALAR — guardar como propuesta para supervisor
            actionRecord.status = 'proposed';
            actionRecord.escalated = true;
            actionRecord.guardrailViolations = guardrailResult.violations;
            toolResults.push({
              type: 'tool_result', tool_use_id: block.id,
              content: JSON.stringify({
                ok: false, escalada: true,
                mensaje: `Acción escalada a supervisor: ${guardrailResult.violations.join('; ')}`,
              }),
            });
          }

          allActions.push(actionRecord);
        }

        messages.push({ role: 'user', content: toolResults });
      }

      // Guardar sesión
      const executedActions = allActions.filter(a => a.status === 'executed');
      const escalatedActions = allActions.filter(a => a.escalated);
      const failedActions = allActions.filter(a => a.status === 'failed');

      const sessionRef = await db.collection('autopilot_sessions').add({
        fincaId: req.fincaId, timestamp: Timestamp.now(),
        triggeredBy: req.uid, triggeredByName: req.userEmail,
        snapshot, recommendations: [], summaryText,
        executedActionsCount: executedActions.length,
        escalatedActionsCount: escalatedActions.length,
        totalActionsCount: allActions.length,
        mode: 'nivel3',
        status: 'completed', errorMessage: null,
      });

      // Guardar cada acción
      const nowTs = Timestamp.now();
      const actionRefs = [];
      for (const action of allActions) {
        const ref = await db.collection('autopilot_actions').add({
          fincaId: req.fincaId,
          sessionId: sessionRef.id,
          type: action.type,
          params: action.params,
          titulo: action.titulo,
          descripcion: action.descripcion,
          prioridad: action.prioridad,
          categoria: action.categoria,
          status: action.status,
          autonomous: true,
          escalated: action.escalated || false,
          guardrailViolations: action.guardrailViolations || null,
          proposedBy: req.uid,
          proposedByName: req.userEmail,
          createdAt: nowTs,
          reviewedBy: null,
          reviewedByName: null,
          reviewedAt: null,
          rejectionReason: null,
          executedAt: action.executedAt || null,
          executionResult: action.executionResult || null,
        });
        actionRefs.push({ id: ref.id, ...action });
      }

      // Feed events — cada acción ejecutada + resumen de sesión
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
        proposedActions: actionRefs.filter(a => a.status === 'proposed'),
        executedActions: actionRefs.filter(a => a.status === 'executed'),
        failedActions: actionRefs.filter(a => a.status === 'failed'),
        summaryText,
        snapshot,
        timestamp: new Date().toISOString(),
      });
    }

    // Modo no reconocido
    return res.status(400).json({ message: 'Modo del Piloto Automático no soportado.' });

  } catch (err) {
    console.error('[AUTOPILOT] Error en analyze:', err);
    res.status(500).json({ message: 'Error interno al ejecutar el análisis.' });
  }
});

// GET /api/autopilot/sessions
router.get('/api/autopilot/sessions', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('autopilot_sessions')
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();
    const sessions = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        timestamp: d.timestamp?.toDate?.()?.toISOString() ?? null,
        triggeredByName: d.triggeredByName || '',
        snapshot: d.snapshot || {},
        recommendationsCount: (d.recommendations || []).length,
        status: d.status || 'completed',
      };
    });
    res.json(sessions);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar sesiones:', err);
    res.status(500).json({ message: 'Error al obtener sesiones.' });
  }
});

// GET /api/autopilot/sessions/:id
router.get('/api/autopilot/sessions/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('autopilot_sessions').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Sesión no encontrada.' });
    const d = doc.data();
    if (d.fincaId !== req.fincaId) return res.status(403).json({ message: 'Acceso no autorizado.' });
    res.json({
      id: doc.id,
      timestamp: d.timestamp?.toDate?.()?.toISOString() ?? null,
      triggeredByName: d.triggeredByName || '',
      snapshot: d.snapshot || {},
      recommendations: d.recommendations || [],
      status: d.status || 'completed',
      errorMessage: d.errorMessage || null,
    });
  } catch (err) {
    console.error('[AUTOPILOT] Error al obtener sesión:', err);
    res.status(500).json({ message: 'Error al obtener la sesión.' });
  }
});

// GET /api/autopilot/actions — lista acciones propuestas/ejecutadas
router.get('/api/autopilot/actions', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('autopilot_actions')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    let actions = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        type: d.type,
        params: d.params,
        titulo: d.titulo,
        descripcion: d.descripcion,
        prioridad: d.prioridad,
        categoria: d.categoria,
        status: d.status,
        sessionId: d.sessionId,
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
        reviewedByName: d.reviewedByName || null,
        reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() ?? null,
        rejectionReason: d.rejectionReason || null,
        executedAt: d.executedAt?.toDate?.()?.toISOString() ?? null,
        executionResult: d.executionResult || null,
        autonomous: d.autonomous || false,
        escalated: d.escalated || false,
        guardrailViolations: d.guardrailViolations || null,
      };
    });
    const { status, sessionId } = req.query;
    if (status) actions = actions.filter(a => a.status === status);
    if (sessionId) actions = actions.filter(a => a.sessionId === sessionId);
    res.json(actions);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar acciones:', err);
    res.status(500).json({ message: 'Error al obtener acciones.' });
  }
});

// PUT /api/autopilot/actions/:id/approve — aprueba y ejecuta una acción (supervisor+)
router.put('/api/autopilot/actions/:id/approve', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return res.status(403).json({ message: 'Se requiere rol de Supervisor o superior.' });
  }
  try {
    const docRef = db.collection('autopilot_actions').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Acción no encontrada.' });
    const action = doc.data();
    if (action.fincaId !== req.fincaId) return res.status(403).json({ message: 'Acceso no autorizado.' });
    if (action.status !== 'proposed') {
      return res.status(400).json({ message: `La acción ya fue procesada (${action.status}).` });
    }

    await docRef.update({
      status: 'approved',
      reviewedBy: req.uid,
      reviewedByName: req.userEmail,
      reviewedAt: Timestamp.now(),
    });

    let executionResult;
    try {
      executionResult = await executeAutopilotAction(action.type, action.params, req.fincaId);
      await docRef.update({
        status: 'executed',
        executedAt: Timestamp.now(),
        executionResult,
      });
    } catch (execErr) {
      console.error('[AUTOPILOT] Error al ejecutar acción:', execErr);
      await docRef.update({
        status: 'failed',
        executedAt: Timestamp.now(),
        executionResult: { error: execErr.message },
      });
      return res.json({ ok: true, status: 'failed', error: execErr.message });
    }

    writeFeedEvent({
      fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail,
      eventType: 'autopilot_action_executed',
      title: `Acción aprobada y ejecutada: ${action.titulo}`,
    });

    res.json({ ok: true, status: 'executed', executionResult });
  } catch (err) {
    console.error('[AUTOPILOT] Error al aprobar acción:', err);
    res.status(500).json({ message: 'Error al aprobar la acción.' });
  }
});

// PUT /api/autopilot/actions/:id/reject — rechaza una acción propuesta (supervisor+)
router.put('/api/autopilot/actions/:id/reject', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return res.status(403).json({ message: 'Se requiere rol de Supervisor o superior.' });
  }
  try {
    const docRef = db.collection('autopilot_actions').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ message: 'Acción no encontrada.' });
    const action = doc.data();
    if (action.fincaId !== req.fincaId) return res.status(403).json({ message: 'Acceso no autorizado.' });
    if (action.status !== 'proposed') {
      return res.status(400).json({ message: `La acción ya fue procesada (${action.status}).` });
    }

    const { reason } = req.body || {};
    await docRef.update({
      status: 'rejected',
      reviewedBy: req.uid,
      reviewedByName: req.userEmail,
      reviewedAt: Timestamp.now(),
      rejectionReason: reason || null,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al rechazar acción:', err);
    res.status(500).json({ message: 'Error al rechazar la acción.' });
  }
});

// POST /api/autopilot/feedback — save/update 👍/👎 on a recommendation or action
router.post('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId, targetId, targetType, targetTitle, categoria, nivel, signal, comment } = req.body || {};
    if (!sessionId || !targetId || !['recommendation', 'action'].includes(targetType)) {
      return res.status(400).json({ message: 'Parámetros inválidos (sessionId, targetId, targetType).' });
    }
    if (!['up', 'down'].includes(signal)) {
      return res.status(400).json({ message: 'signal debe ser "up" o "down".' });
    }
    const docId = `${req.uid}_${sessionId}_${targetId}`;
    const now = Timestamp.now();
    await db.collection('copilot_feedback').doc(docId).set({
      userId: req.uid,
      userName: req.userEmail,
      fincaId: req.fincaId,
      nivel: nivel || null,
      sessionId,
      targetId,
      targetType,
      targetTitle: targetTitle ? String(targetTitle).slice(0, 200) : '',
      categoria: categoria || 'general',
      signal,
      comment: comment ? String(comment).slice(0, 500) : '',
      updatedAt: now,
      createdAt: now,
    }, { merge: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al guardar feedback:', err);
    res.status(500).json({ message: 'Error al guardar feedback.' });
  }
});

// DELETE /api/autopilot/feedback?sessionId=X&targetId=Y — clear feedback (toggle off)
router.delete('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId, targetId } = req.query;
    if (!sessionId || !targetId) {
      return res.status(400).json({ message: 'Parámetros requeridos: sessionId, targetId.' });
    }
    const docId = `${req.uid}_${sessionId}_${targetId}`;
    await db.collection('copilot_feedback').doc(docId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al borrar feedback:', err);
    res.status(500).json({ message: 'Error al borrar feedback.' });
  }
});

// GET /api/autopilot/feedback?sessionId=X — list current user's feedback (for UI pre-fill)
router.get('/api/autopilot/feedback', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.query;
    let query = db.collection('copilot_feedback')
      .where('fincaId', '==', req.fincaId)
      .where('userId', '==', req.uid);
    if (sessionId) query = query.where('sessionId', '==', sessionId);
    const snap = await query.limit(100).get();
    const items = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        sessionId: d.sessionId,
        targetId: d.targetId,
        targetType: d.targetType,
        signal: d.signal,
        comment: d.comment || '',
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });
    res.json(items);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar feedback:', err);
    res.status(500).json({ message: 'Error al listar feedback.' });
  }
});

// GET /api/autopilot/directives — list active directives for current user
router.get('/api/autopilot/directives', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('copilot_directives')
      .where('fincaId', '==', req.fincaId)
      .where('userId', '==', req.uid)
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const items = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        text: d.text,
        createdAt: d.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
    res.json(items);
  } catch (err) {
    console.error('[AUTOPILOT] Error al listar directivas:', err);
    res.status(500).json({ message: 'Error al listar directivas.' });
  }
});

// POST /api/autopilot/directives — create a new explicit directive
router.post('/api/autopilot/directives', authenticate, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ message: 'text es requerido.' });
    if (text.length > 300) return res.status(400).json({ message: 'text máximo 300 caracteres.' });
    const now = Timestamp.now();
    const ref = await db.collection('copilot_directives').add({
      userId: req.uid,
      userName: req.userEmail,
      fincaId: req.fincaId,
      text,
      active: true,
      createdAt: now,
    });
    res.json({ id: ref.id, text, createdAt: now.toDate().toISOString() });
  } catch (err) {
    console.error('[AUTOPILOT] Error al crear directiva:', err);
    res.status(500).json({ message: 'Error al crear directiva.' });
  }
});

// DELETE /api/autopilot/directives/:id — soft delete
router.delete('/api/autopilot/directives/:id', authenticate, async (req, res) => {
  try {
    const ref = db.collection('copilot_directives').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ message: 'Directiva no encontrada.' });
    const d = doc.data();
    if (d.fincaId !== req.fincaId || d.userId !== req.uid) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    await ref.update({ active: false });
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al eliminar directiva:', err);
    res.status(500).json({ message: 'Error al eliminar directiva.' });
  }
});

module.exports = router;
