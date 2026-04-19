// Claude-backed reasoner for borderline eligibility cases.
//
// The deterministic matcher buckets products into `elegible` / `revisar` /
// `no_elegible`. The 'revisar' bucket is the one that benefits most from
// qualitative review — numbers are in the middle and context matters. For
// those products the route handler invokes this reasoner, which:
//
//   1. Builds a short, audit-friendly prompt with the finca snapshot summary
//      + the product + the deterministic breakdown.
//   2. Asks Claude (with extended thinking enabled) to return `tomar`,
//      `no_tomar`, or `tomar_condicional` plus a one-sentence reason and an
//      optional list of conditions.
//   3. Captures the thinking blocks so the analysis is auditable.
//
// Safe by design: any failure path (no API key, API error, malformed reply)
// returns null and the caller falls back to the deterministic recommendation.

const { getAnthropicClient } = require('../clients');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
} = require('../autopilotReasoning');

const MODEL = 'claude-sonnet-4-6';

// ─── Prompt + tool schema (pure) ──────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asesor financiero agrícola que refina decisiones de elegibilidad crediticia.

Recibes el perfil financiero resumido de una finca, un producto de crédito candidato, y el análisis determinista que ya se hizo (cada uno de los chequeos cuantitativos con su resultado).

Tu tarea es emitir una recomendación defendible entre:
  - tomar: el crédito es razonable bajo los supuestos mostrados
  - no_tomar: los riesgos superan los beneficios
  - tomar_condicional: conviene solo si se cumplen ciertas condiciones

Reglas:
- Justifica en español, 1-2 oraciones. Referencia el chequeo que pesó más en tu decisión.
- Si recomiendas "tomar_condicional", enumera las condiciones concretas (p. ej. "esperar 2 meses a que suba el flujo mensual", "incluir aval personal").
- No excedas las fronteras del análisis determinista: si el cashFloor falla, no recomiendes "tomar".
- Sé conservador. Tomar deuda es irreversible en horizonte multi-año.

Invoca siempre la herramienta \`emit_credit_recommendation\`. No respondas en texto plano.`;

const RECOMMENDATION_TOOL = Object.freeze({
  name: 'emit_credit_recommendation',
  description: 'Emite la recomendación final para el producto de crédito evaluado.',
  input_schema: {
    type: 'object',
    properties: {
      recommendation: {
        type: 'string',
        enum: ['tomar', 'no_tomar', 'tomar_condicional'],
        description: 'Veredicto final. "tomar_condicional" requiere poblar `condiciones`.',
      },
      razon: {
        type: 'string',
        description: 'Explicación breve en español (1-2 oraciones).',
      },
      condiciones: {
        type: 'array',
        items: { type: 'string' },
        description: 'Condiciones necesarias para tomar el crédito. Obligatorio si recommendation = tomar_condicional.',
      },
      puntosACorregir: {
        type: 'array',
        items: { type: 'string' },
        description: 'Riesgos o debilidades que el administrador debería atender antes de aplicar.',
      },
    },
    required: ['recommendation', 'razon'],
  },
});

// Formats the snapshot summary into a short human-readable block. Keeps
// numbers to two decimals to avoid overwhelming the model with precision
// that doesn't affect the decision.
function formatSummary(summary) {
  const lines = [
    `- Patrimonio: ${summary.totalEquity}`,
    `- Caja disponible: ${summary.cashAmount}`,
    `- Revenue 12m: ${summary.annualRevenue}`,
    `- Ingreso mensual promedio: ${summary.avgMonthlyInflow}`,
    `- Flujo neto mensual promedio: ${summary.avgMonthlyNet}`,
    `- Saldo mínimo proyectado (6m): ${summary.minProjectedBalance}`,
  ];
  return lines.join('\n');
}

function formatProduct(product) {
  const lines = [
    `- Proveedor: ${product.providerName || 'sin nombre'} (${product.providerType || 'sin tipo'})`,
    `- Tipo: ${product.tipo || 'sin categoría'}`,
    `- Esquema: ${product.esquemaAmortizacion || 'sin esquema'}`,
    `- Monto: ${product.monedaMin}-${product.monedaMax} ${product.moneda || 'USD'}`,
    `- Plazo: ${product.plazoMesesMin}-${product.plazoMesesMax} meses`,
    `- APR: ${(Number(product.aprMin) * 100).toFixed(1)}%-${(Number(product.aprMax) * 100).toFixed(1)}%`,
  ];
  if (Array.isArray(product.requisitos) && product.requisitos.length > 0) {
    const reqLine = product.requisitos
      .map(r => `${r.tipo}:${r.codigo}`)
      .join(', ');
    lines.push(`- Requisitos: ${reqLine}`);
  }
  return lines.join('\n');
}

function formatEvaluation(evaluation) {
  const lines = [
    `- Score determinista: ${evaluation.score}`,
    `- Recomendación determinista: ${evaluation.recommendation}`,
    `- Cuota mensual estimada (peor caso): ${evaluation.suggestedTerm?.monthlyPayment ?? '—'}`,
    `- Plazo simulado: ${evaluation.suggestedTerm?.plazoMeses ?? '—'} meses a APR ${evaluation.suggestedTerm?.apr ?? '—'}`,
    '',
    'Chequeos:',
  ];
  for (const c of evaluation.softChecks || []) {
    const tag = c.applicable === false ? 'N/A' : (c.passed ? 'OK' : 'FALLA');
    lines.push(`  - ${c.name}: ${tag} — ${c.detail}`);
  }
  if (Array.isArray(evaluation.manualChecks) && evaluation.manualChecks.length > 0) {
    lines.push('', 'Requisitos documentales (verificación manual):');
    for (const m of evaluation.manualChecks) {
      lines.push(`  - ${m.codigo}: ${m.descripcion}`);
    }
  }
  return lines.join('\n');
}

function buildUserContext({ summary, product, evaluation, targetAmount, targetUse }) {
  const sections = [
    `Monto solicitado: ${targetAmount}`,
    `Uso declarado: ${targetUse || '(no especificado)'}`,
    '',
    'Perfil financiero de la finca:',
    formatSummary(summary),
    '',
    'Producto de crédito candidato:',
    formatProduct(product),
    '',
    'Análisis determinista ya realizado:',
    formatEvaluation(evaluation),
    '',
    'Invoca emit_credit_recommendation con tu recomendación final.',
  ];
  return sections.join('\n');
}

// ─── Parse Claude output ──────────────────────────────────────────────────

function parseClaudeResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const toolBlock = response.content.find(b => b?.type === 'tool_use' && b?.name === RECOMMENDATION_TOOL.name);
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== 'object') return null;
  const input = toolBlock.input;
  const valid = new Set(['tomar', 'no_tomar', 'tomar_condicional']);
  if (!valid.has(input.recommendation)) return null;
  if (typeof input.razon !== 'string' || !input.razon.trim()) return null;
  // Condiciones required when conditional.
  if (input.recommendation === 'tomar_condicional') {
    if (!Array.isArray(input.condiciones) || input.condiciones.length === 0) return null;
  }
  return {
    parsed: {
      recommendation: input.recommendation,
      razon: input.razon.trim(),
      condiciones: Array.isArray(input.condiciones) ? input.condiciones.filter(c => typeof c === 'string') : [],
      puntosACorregir: Array.isArray(input.puntosACorregir) ? input.puntosACorregir.filter(c => typeof c === 'string') : [],
    },
    toolBlock,
  };
}

// ─── Glue (impure) ────────────────────────────────────────────────────────

async function refineWithClaude({ summary, product, evaluation, targetAmount, targetUse }) {
  try {
    const userContext = buildUserContext({ summary, product, evaluation, targetAmount, targetUse });
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS_WITH_THINKING,
      thinking: thinkingConfig(),
      system: SYSTEM_PROMPT,
      tools: [RECOMMENDATION_TOOL],
      messages: [{ role: 'user', content: userContext }],
    });
    const parsed = parseClaudeResponse(response);
    if (!parsed) return null;
    return {
      ...parsed.parsed,
      reasoning: buildReasoning(response, parsed.toolBlock),
    };
  } catch (err) {
    console.error('[ELIGIBILITY-CLAUDE] refine failed:', err.message);
    return null;
  }
}

module.exports = {
  refineWithClaude,
  // Pure exports for tests.
  SYSTEM_PROMPT,
  RECOMMENDATION_TOOL,
  buildUserContext,
  parseClaudeResponse,
  _internals: { formatSummary, formatProduct, formatEvaluation },
};
