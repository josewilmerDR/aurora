// Autopilot/analyze — Nivel 2 (agencia supervisada).
//
// Sub-archivo del split de routes/autopilot/analyze.js. El modelo recibe
// el snapshot enriquecido con IDs y propone acciones vía las tools
// `proponer_*`. Cada propuesta se persiste con status='proposed' y aparece
// en la cola del supervisor para aprobación manual.
//
// Loop agéntico de hasta 4 iteraciones con extended thinking. No ejecuta
// nada — sólo registra propuestas.

const { db, Timestamp } = require('../../../lib/firebase');
const { writeFeedEvent, sendPushToFincaRoles, sendWhatsAppToFincaRoles } = require('../../../lib/helpers');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
  stripReasoning,
} = require('../../../lib/autopilotReasoning');
const {
  AUTOPILOT_PROPOSE_TOOLS,
  PROPOSE_ACTION_MAP,
  ACTION_CATEGORY_MAP,
} = require('../tools');

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

async function runNivel2({ req, res, anthropicClient, config, snapshot, snapshotTextEnriched, feedbackPrefix }) {
  const nivel2Tools = AUTOPILOT_PROPOSE_TOOLS;

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

module.exports = { runNivel2 };
