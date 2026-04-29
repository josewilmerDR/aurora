// Autopilot/analyze — Nivel 3 (agencia total con guardrails).
//
// Sub-archivo del split de routes/autopilot/analyze.js. El modelo más
// autónomo: ejecuta acciones directamente vía las tools `ejecutar_*`.
// Cada tool_use pasa por validateGuardrails ANTES de ejecutar; si rompe
// alguna barandilla (lotes bloqueados, presupuesto, stock máximo, etc.)
// la acción se ESCALA a status='proposed' para que un supervisor decida.
//
// Diseño transaccional importante: executeAutopilotAction recibe la
// docRef y el initial doc, y commitea el side-effect + el write del action
// doc en una sola transacción. Si falla la ejecución, el doc queda en
// status='failed' con el error. Las escalations se escriben directo (no
// hay side effect que proteger).

const { db, Timestamp } = require('../../../lib/firebase');
const { writeFeedEvent, sendPushToFincaRoles, sendWhatsAppToFincaRoles } = require('../../../lib/helpers');
const { validateGuardrails } = require('../../../lib/autopilotGuardrails');
const { executeAutopilotAction } = require('../../../lib/autopilotActions');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
  stripReasoning,
} = require('../../../lib/autopilotReasoning');
const {
  AUTOPILOT_EXECUTE_TOOLS,
  EXECUTE_ACTION_MAP,
  ACTION_CATEGORY_MAP,
} = require('../tools');

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

async function runNivel3({
  req, res, anthropicClient, config, snapshot, snapshotTextEnriched, feedbackPrefix,
  taskLoteMap, productStockMap,
}) {
  const guardrails = config.guardrails || {};
  const nivel3Tools = AUTOPILOT_EXECUTE_TOOLS;

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

module.exports = { runNivel3 };
