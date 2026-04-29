// Autopilot/analyze — Nivel 1 (recomendaciones de texto).
//
// Sub-archivo del split de routes/autopilot/analyze.js. Modo de menor
// autonomía: el modelo recibe el snapshot plano y devuelve recomendaciones
// estructuradas vía tool-forced output (`generar_recomendaciones`). NO
// ejecuta ni propone acciones — el productor lee y decide manualmente.
//
// El switch a tool_use con `tool_choice: { type: 'tool', ... }` reemplaza
// el approach previo de free-text JSON, que ocasionalmente fallaba al
// parsear cuando Claude prependía comentario o se cortaba mid-array.

const { db, Timestamp } = require('../../../lib/firebase');
const { writeFeedEvent } = require('../../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');

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

async function runNivel1({ req, res, anthropicClient, config, snapshot, snapshotText, feedbackPrefix }) {
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

module.exports = { runNivel1 };
