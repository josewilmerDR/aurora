// Claude-backed reasoner for a debt simulation output. Given the "with" vs
// "without" scenarios and the delta, asks Claude to pick one of three
// verdicts (tomar / no_tomar / tomar_condicional) with a short rationale.
//
// Same robust pattern as eligibilityReasoner: any failure returns null and
// the caller falls back to a deterministic heuristic.

const { getAnthropicClient } = require('../clients');
const {
  thinkingConfig,
  MAX_TOKENS_WITH_THINKING,
  buildReasoning,
} = require('../autopilotReasoning');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Eres un analista financiero agrícola que interpreta escenarios Monte Carlo sobre la decisión de contratar un crédito.

Recibes dos simulaciones (sin deuda / con deuda) con tres escenarios cada una (Pesimista, Base, Optimista) y los deltas de margen y caja final entre ambas corridas.

Tu tarea es emitir una recomendación defendible entre:
  - tomar: el crédito mejora el margen medio con probabilidad aceptable y no quiebra la caja en escenarios adversos.
  - no_tomar: el costo del crédito supera el beneficio esperado, o genera riesgo de caja negativa.
  - tomar_condicional: conviene solo bajo ciertas condiciones explícitas (p. ej. "esperar a que suba el flujo base 15% antes de tomarlo").

Reglas:
- Fundamenta en los números que recibes. No inventes cifras.
- En español, 2-4 oraciones.
- Sé conservador: si el escenario pesimista cae a caja negativa, no recomiendes "tomar".
- Si flagged TRUNCATED_AT_HORIZON, menciona que la simulación no cubre el plazo completo.

Invoca siempre la herramienta \`emit_debt_recommendation\`. No respondas en texto plano.`;

const RECOMMENDATION_TOOL = Object.freeze({
  name: 'emit_debt_recommendation',
  description: 'Emite la recomendación final sobre tomar o no el crédito.',
  input_schema: {
    type: 'object',
    properties: {
      recommendation: {
        type: 'string',
        enum: ['tomar', 'no_tomar', 'tomar_condicional'],
      },
      razon: {
        type: 'string',
        description: 'Justificación en español, 2-4 oraciones, referenciando percentiles concretos.',
      },
      condiciones: {
        type: 'array',
        items: { type: 'string' },
        description: 'Condiciones necesarias si la recomendación es "tomar_condicional".',
      },
      riesgoPrincipal: {
        type: 'string',
        description: 'El riesgo más importante a monitorear si se toma el crédito.',
      },
    },
    required: ['recommendation', 'razon'],
  },
});

// Pure formatters ─────────────────────────────────────────────────────────

function formatScenarioLine(scenario) {
  const pct = scenario.percentiles;
  return [
    `  Margen mediano: ${scenario.margenProyectado}`,
    `  Caja final p10/p50/p90: ${pct.cajaFinal.p10} / ${pct.cajaFinal.p50} / ${pct.cajaFinal.p90}`,
    `  Margen p10/p50/p90: ${pct.margen.p10} / ${pct.margen.p50} / ${pct.margen.p90}`,
  ].join('\n');
}

function formatDelta(delta) {
  const lines = [];
  for (const [name, d] of Object.entries(delta.byScenario || {})) {
    lines.push(`  ${name}: margen Δ${d.margen.delta} (sin=${d.margen.without} → con=${d.margen.withDebt}); caja Δ${d.cajaFinal.delta}`);
  }
  if (delta.resumen) {
    lines.push(`  Resumen: margen medio Δ${delta.resumen.margenMedio.delta}; caja final media Δ${delta.resumen.cajaFinalMedia.delta}`);
  }
  return lines.join('\n');
}

function buildUserContext({ simulation, debt, useCase }) {
  const lines = [];
  lines.push('# Simulación de ROI de deuda');
  lines.push(`Trials: ${simulation.nTrials} · seed: ${simulation.seed} · horizonte: ${simulation.horizonteMeses} meses`);
  lines.push('');
  lines.push('## Crédito evaluado');
  lines.push(`Monto: ${debt.amount}`);
  lines.push(`Plazo: ${debt.plazoMeses} meses`);
  lines.push(`APR: ${debt.apr}`);
  lines.push(`Esquema: ${debt.esquemaAmortizacion || debt.esquema}`);
  lines.push(`Cuota mensual estimada: ${simulation.debtCashFlow.monthlyPayment}`);
  lines.push(`Total interés: ${simulation.debtCashFlow.totalInterest}`);
  if (simulation.debtCashFlow.truncated) {
    lines.push(`⚠️  TRUNCATED_AT_HORIZON: saldo al cierre=${simulation.debtCashFlow.remainingBalanceAtHorizon}`);
  }
  lines.push('');

  if (useCase) {
    lines.push('## Uso declarado');
    lines.push(`Tipo: ${useCase.tipo || 'sin tipo'}`);
    if (useCase.detalle) lines.push(`Detalle: ${useCase.detalle}`);
    if (useCase.expectedReturnModel) {
      lines.push(`Modelo de retorno: ${JSON.stringify(useCase.expectedReturnModel)}`);
    }
    lines.push('');
  }

  lines.push('## Escenarios SIN deuda');
  for (const s of simulation.withoutDebt.scenarios) {
    lines.push(`### ${s.name} (probabilidad ${Math.round(s.probabilidad * 100)}%)`);
    lines.push(formatScenarioLine(s));
    lines.push('');
  }
  lines.push(`Resumen SIN deuda: margenMedio=${simulation.withoutDebt.resumen.margenMedio}, cajaFinalMedia=${simulation.withoutDebt.resumen.cajaFinalMedia}`);
  lines.push('');

  lines.push('## Escenarios CON deuda');
  for (const s of simulation.withDebt.scenarios) {
    lines.push(`### ${s.name} (probabilidad ${Math.round(s.probabilidad * 100)}%)`);
    lines.push(formatScenarioLine(s));
    lines.push('');
  }
  lines.push(`Resumen CON deuda: margenMedio=${simulation.withDebt.resumen.margenMedio}, cajaFinalMedia=${simulation.withDebt.resumen.cajaFinalMedia}`);
  lines.push('');

  lines.push('## Deltas (con − sin)');
  lines.push(formatDelta(simulation.delta));
  lines.push('');

  if (Array.isArray(simulation.warnings) && simulation.warnings.length > 0) {
    lines.push('## Warnings');
    for (const w of simulation.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('Invoca emit_debt_recommendation con tu recomendación final.');
  return lines.join('\n');
}

// Parse ───────────────────────────────────────────────────────────────────

function parseClaudeResponse(response) {
  if (!response || !Array.isArray(response.content)) return null;
  const toolBlock = response.content.find(
    b => b?.type === 'tool_use' && b?.name === RECOMMENDATION_TOOL.name
  );
  if (!toolBlock || !toolBlock.input || typeof toolBlock.input !== 'object') return null;
  const input = toolBlock.input;
  const valid = new Set(['tomar', 'no_tomar', 'tomar_condicional']);
  if (!valid.has(input.recommendation)) return null;
  if (typeof input.razon !== 'string' || !input.razon.trim()) return null;
  if (input.recommendation === 'tomar_condicional') {
    if (!Array.isArray(input.condiciones) || input.condiciones.length === 0) return null;
  }
  return {
    parsed: {
      recommendation: input.recommendation,
      razon: input.razon.trim(),
      condiciones: Array.isArray(input.condiciones)
        ? input.condiciones.filter(c => typeof c === 'string')
        : [],
      riesgoPrincipal: typeof input.riesgoPrincipal === 'string'
        ? input.riesgoPrincipal.trim()
        : null,
    },
    toolBlock,
  };
}

// Deterministic fallback heuristic used when Claude is off or fails. Mirrors
// the conservative rule in the system prompt so behavior is consistent.
function heuristicRecommendation(simulation) {
  const pess = simulation.withDebt.scenarios.find(s => s.name === 'Pesimista');
  const deltaMargen = simulation.delta?.resumen?.margenMedio?.delta ?? 0;
  const pessCash = pess?.percentiles?.cajaFinal?.p50 ?? 0;

  if (pessCash < 0) {
    return {
      recommendation: 'no_tomar',
      razon: 'El escenario pesimista termina con caja mediana negativa al incorporar el crédito.',
    };
  }
  if (deltaMargen <= 0) {
    return {
      recommendation: 'no_tomar',
      razon: 'El margen medio empeora (o no mejora) al tomar la deuda.',
    };
  }
  return {
    recommendation: 'tomar_condicional',
    razon: `El margen medio mejora ${deltaMargen}, pero conviene monitorear el escenario pesimista antes de ejecutar.`,
    condiciones: ['Validar que el retorno esperado se materialice en los primeros 3 meses.'],
  };
}

// Glue ─────────────────────────────────────────────────────────────────────

async function refineWithClaude({ simulation, debt, useCase }) {
  try {
    const userContext = buildUserContext({ simulation, debt, useCase });
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
    console.error('[DEBT-CLAUDE] refine failed:', err.message);
    return null;
  }
}

module.exports = {
  refineWithClaude,
  heuristicRecommendation,
  // Pure exports for tests.
  SYSTEM_PROMPT,
  RECOMMENDATION_TOOL,
  buildUserContext,
  parseClaudeResponse,
  _internals: { formatScenarioLine, formatDelta },
};
