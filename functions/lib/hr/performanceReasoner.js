// Performance alert reasoner — Claude opt-in, pattern from sub-fase 2.5.
//
// Produces a short Spanish paragraph a supervisor can read before
// deciding whether to have a conversation with the worker. Never
// suggests sanction, firing, or monetary action.
//
// Modes:
//   - enabled=false              → deterministic template, fallback=true
//   - enabled=true + success     → Claude draft, fallback=false, thinking captured
//   - enabled=true + any failure → deterministic template, fallback=true
//
// No part of this module is allowed to throw past its own try/catch.
// A failure in the reasoner must never block the alert from being
// persisted via the deterministic path.

const { thinkingConfig, MAX_TOKENS_WITH_THINKING, buildReasoning } = require('../autopilotReasoning');

const MODEL = 'claude-sonnet-4-6';

// System prompt emphasizes professional, non-accusatory language and
// explicitly forbids sanctions, firing, monetary figures, and naming.
const SYSTEM_PROMPT = [
  'Redactas notas breves en español para un supervisor agrícola sobre el desempeño de un trabajador.',
  'Tu propósito es sugerir una conversación, nunca una sanción.',
  'Reglas obligatorias:',
  '- Máximo 3 oraciones.',
  '- Voz impersonal ("se observa"), no imperativa.',
  '- Prohibido mencionar salarios, dinero, sanciones, despido o memorando.',
  '- Prohibido nombrar al trabajador; el prompt usa "[trabajador]".',
  '- Enfócate en los meses donde el score estuvo debajo del umbral y el patrón que eso sugiere.',
  '- Cierra con una recomendación de conversación constructiva, no de acción punitiva.',
].join('\n');

// Single-tool schema to force structured output.
const DRAFT_TOOL = {
  name: 'draft_review_note',
  description: 'Devuelve una nota breve para el supervisor en español.',
  input_schema: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'Nota de 1 a 3 oraciones. Nunca mencionar salarios ni sanciones.',
      },
    },
    required: ['note'],
  },
};

function deterministicTemplate(alert) {
  const periods = alert?.evidenceRefs?.periods || [];
  const scores = alert?.evidenceRefs?.scores || [];
  const periodsList = periods.join(', ');
  const scoresList = scores
    .filter(s => typeof s === 'number')
    .map(s => Math.round(s * 10) / 10)
    .join(' / ');
  const severityWord = alert?.severity === 'alta'
    ? 'varios meses en el decil inferior del equipo'
    : 'dos o más meses por debajo del p25 del equipo';
  return (
    `Se observa una tendencia sostenida debajo de los pares durante ${severityWord} ` +
    `(meses: ${periodsList}; scores: ${scoresList}). ` +
    `Se sugiere al supervisor conversar con el trabajador para entender el contexto ` +
    `antes de tomar cualquier decisión.`
  );
}

function buildUserContext(alert, context = {}) {
  const evidence = alert?.evidenceRefs || {};
  const lines = [
    `Alerta de desempeño (severidad: ${alert?.severity || 'desconocida'}).`,
    `Meses evaluados (más reciente primero): ${(evidence.periods || []).join(', ')}.`,
    `Scores del trabajador: ${(evidence.scores || []).map(s => typeof s === 'number' ? s.toFixed(1) : 'n/a').join(' / ')}.`,
    `Cutoffs usados (p25/p10 por mes):`,
    ...(evidence.cutoffsUsed || []).map(c => `  - ${c.period}: p25=${c.p25 ?? 'n/a'} / p10=${c.p10 ?? 'n/a'} (n reliable peers: ${c.reliableCount})`),
  ];
  if (context.subscoresSnapshot) {
    lines.push(`Subscores del último mes: ${JSON.stringify(context.subscoresSnapshot)}.`);
  }
  lines.push('');
  lines.push('Redacta la nota usando la herramienta draft_review_note.');
  return lines.join('\n');
}

function extractDraftFromResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const tool = response.content.find(b => b.type === 'tool_use' && b.name === 'draft_review_note');
  if (!tool || !tool.input || typeof tool.input.note !== 'string') return null;
  return { note: tool.input.note, toolBlock: tool };
}

async function reasonAboutAlert(alert, context = {}, { enabled = false, anthropicClient = null } = {}) {
  if (!enabled || !anthropicClient) {
    return {
      text: deterministicTemplate(alert),
      thinking: null,
      fallback: true,
    };
  }
  try {
    const response = await anthropicClient.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_WITH_THINKING,
      thinking: thinkingConfig(),
      system: SYSTEM_PROMPT,
      tools: [DRAFT_TOOL],
      messages: [{ role: 'user', content: buildUserContext(alert, context) }],
    });

    const parsed = extractDraftFromResponse(response);
    if (!parsed) {
      return {
        text: deterministicTemplate(alert),
        thinking: null,
        fallback: true,
      };
    }

    return {
      text: parsed.note,
      reasoning: buildReasoning(response, parsed.toolBlock),
      fallback: false,
    };
  } catch (err) {
    console.error('[HR-CLAUDE] alert reasoning failed:', err.message);
    return {
      text: deterministicTemplate(alert),
      thinking: null,
      fallback: true,
    };
  }
}

module.exports = {
  reasonAboutAlert,
  deterministicTemplate,
  buildUserContext,
  extractDraftFromResponse,
  SYSTEM_PROMPT,
  DRAFT_TOOL,
  MODEL,
};
