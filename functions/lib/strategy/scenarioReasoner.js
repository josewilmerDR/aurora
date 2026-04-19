// Analiza un conjunto de 3 escenarios generados por el Monte Carlo y
// devuelve:
//   - comentario       (síntesis estratégica global)
//   - recomendacion    (qué escenario priorizar)
//   - tradeOffs[]      (comparación entre opciones)
//
// Usa una tool forzada para que Claude devuelva estructura. Con thinking
// habilitado para auditar el razonamiento igual que el resto de agentes.

const { getAnthropicClient } = require('../clients');
const {
  MAX_TOKENS_WITH_THINKING,
  thinkingConfig,
  buildReasoning,
} = require('../autopilotReasoning');

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const TOOL_ANALIZAR = {
  name: 'analizar_escenarios',
  description:
    'Sintetiza el set de escenarios Monte Carlo y entrega una recomendación ' +
    'para el administrador de la finca. Debe identificar el escenario más ' +
    'robusto (mejor margen mediano con caja final no-negativa) y el más ' +
    'agresivo (alto upside con mayor riesgo de caja negativa).',
  input_schema: {
    type: 'object',
    properties: {
      comentario: {
        type: 'string',
        description: 'Síntesis global en 2-4 oraciones sobre la salud del portafolio proyectado.',
      },
      recomendacion: {
        type: 'object',
        properties: {
          escenarioPreferido: { type: 'string', description: 'Pesimista | Base | Optimista' },
          razon: { type: 'string', description: 'Justificación de la elección.' },
          accionesSugeridas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Acciones concretas (p. ej. "ajustar rotación 4.2", "cargar presupuesto defensivo").',
          },
        },
        required: ['escenarioPreferido', 'razon'],
      },
      tradeOffs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Comparaciones explícitas entre escenarios (≤ 5 items).',
      },
    },
    required: ['comentario', 'recomendacion'],
  },
};

function buildSystemPrompt() {
  return [
    'Eres el analista estratégico de Aurora.',
    'Recibes un set de 3 escenarios Monte Carlo (Pesimista, Base, Optimista) con sus probabilidades, ingresos/costos/margenes mediana, caja proyectada mensual, percentiles p10/p50/p90 y riesgos listados.',
    'Produce una recomendación accionable invocando exactamente una vez la tool `analizar_escenarios`.',
    '',
    'Criterios:',
    '  - Prefiere robustez (margen positivo en ≥ 75% de trials) sobre upside puntual.',
    '  - Si la caja final mediana es negativa en un escenario, flaggea explícitamente el riesgo.',
    '  - Si el set degenera (escenarios indistinguibles), dilo en `comentario`.',
    '  - No inventes números — referencia los que aparecen en el input.',
  ].join('\n');
}

function buildUserPrompt({ simulationOutput, restrictions, warnings }) {
  const { scenarios, resumen, nTrials, seed, context } = simulationOutput;
  const lines = [];
  lines.push('# Resultado Monte Carlo');
  lines.push(`Trials: ${nTrials} · seed: ${seed} · horizonte: ${context.horizonteMeses} meses`);
  lines.push('');
  lines.push('## Resumen global');
  lines.push(`Ingreso mediano: ${resumen.ingresoMedio}`);
  lines.push(`Costo mediano: ${resumen.costoMedio}`);
  lines.push(`Margen mediano: ${resumen.margenMedio}`);
  lines.push(`Caja final mediana: ${resumen.cajaFinalMedia}`);
  lines.push('');

  for (const s of scenarios) {
    lines.push(`## Escenario "${s.name}" (probabilidad ${Math.round(s.probabilidad * 100)}%)`);
    lines.push(`  Ingreso proyectado: ${s.ingresoProyectado}`);
    lines.push(`  Costo proyectado: ${s.costoProyectado}`);
    lines.push(`  Margen proyectado: ${s.margenProyectado}`);
    lines.push(`  Caja final p10/p50/p90: ${s.percentiles.cajaFinal.p10} / ${s.percentiles.cajaFinal.p50} / ${s.percentiles.cajaFinal.p90}`);
    lines.push(`  Margen p10/p50/p90: ${s.percentiles.margen.p10} / ${s.percentiles.margen.p50} / ${s.percentiles.margen.p90}`);
    if (s.riesgos.length > 0) {
      lines.push(`  Riesgos:`);
      for (const r of s.riesgos) lines.push(`    - ${r}`);
    }
    lines.push('');
  }

  if (restrictions && Object.keys(restrictions).length > 0) {
    lines.push('## Restricciones del usuario');
    lines.push(JSON.stringify(restrictions));
    lines.push('');
  }
  if (Array.isArray(warnings) && warnings.length > 0) {
    lines.push('## Warnings del loader (datos faltantes o bumps)');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('Invoca `analizar_escenarios` ahora.');
  return lines.join('\n');
}

function findToolUse(response, toolName) {
  if (!response || !Array.isArray(response.content)) return null;
  return response.content.find(b => b.type === 'tool_use' && b.name === toolName) || null;
}

async function reasonOverScenarios({ simulationOutput, restrictions, warnings }) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_WITH_THINKING,
    thinking: thinkingConfig(),
    system: buildSystemPrompt(),
    tools: [TOOL_ANALIZAR],
    tool_choice: { type: 'tool', name: 'analizar_escenarios' },
    messages: [{
      role: 'user',
      content: buildUserPrompt({ simulationOutput, restrictions, warnings }),
    }],
  });
  const toolUse = findToolUse(response, 'analizar_escenarios');
  if (!toolUse) {
    const err = new Error('Claude did not invoke analizar_escenarios.');
    err.code = 'NO_TOOL_USE';
    throw err;
  }
  return {
    analysis: toolUse.input || {},
    reasoning: buildReasoning(response, toolUse),
  };
}

module.exports = {
  reasonOverScenarios,
  // Puros para tests.
  buildSystemPrompt,
  buildUserPrompt,
  findToolUse,
  TOOL_ANALIZAR,
  CLAUDE_MODEL,
};
