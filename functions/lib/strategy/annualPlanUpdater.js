// Llama a Claude con thinking blocks y una tool forzada para que proponga
// un diff completo del plan anual. El tool devuelve las secciones
// actualizadas + una `razon` para el changelog.
//
// La ruta es responsable de:
//   - Correr `diffSections` entre el plan actual y la propuesta
//   - Correr `validateVersionCreation` + `checkForbiddenSideEffects`
//   - Decidir el status resultante según el nivel

const { getAnthropicClient } = require('../clients');
const {
  MAX_TOKENS_WITH_THINKING,
  thinkingConfig,
  buildReasoning,
} = require('../autopilotReasoning');

const CLAUDE_MODEL = 'claude-sonnet-4-6';

const TOOL_PROPONER_PLAN = {
  name: 'proponer_plan_diff',
  description:
    'Propone una nueva versión del plan anual. Devuelve las secciones completas ' +
    '(no patches parciales) + una razón corta para el changelog. Nunca incluyas ' +
    'secciones reservadas a otras fases (contrataciones, compras).',
  input_schema: {
    type: 'object',
    properties: {
      razon: { type: 'string', description: 'Motivo del cambio, 1-2 oraciones.' },
      sections: {
        type: 'object',
        description: 'Versión completa de las secciones del plan (las que no devuelvas se mantienen).',
        properties: {
          cultivos: { type: 'array', items: { type: 'object' } },
          rotaciones: { type: 'array', items: { type: 'object' } },
          presupuesto: { type: 'object' },
          hitos: { type: 'array', items: { type: 'object' } },
          supuestos: { type: 'array', items: { type: 'string' } },
          escenarioBase: { type: 'object' },
        },
      },
    },
    required: ['razon', 'sections'],
  },
};

function buildSystemPrompt(level = 'nivel1') {
  const common = [
    'Eres el mantenedor del plan anual de Aurora. Tu única salida es una invocación de la tool `proponer_plan_diff`.',
    '',
    'Reglas duras:',
    '  - Nunca modifiques "contrataciones" ni "compras" — esas secciones pertenecen a otras fases del autopilot.',
    '  - Si no hay razón suficiente para actualizar una sección, no la incluyas en tu respuesta; se mantiene sin cambios.',
    '  - Justifica cada cambio en `razon` (texto narrativo, 1-2 oraciones).',
    '  - Usa las referencias del contexto: rotaciones recientes, último escenario, señales externas, rendimiento histórico.',
  ];
  if (level === 'nivel1') {
    common.push('  - Modo N1: propones libremente; el humano decide si aplicar.');
  } else if (level === 'nivel2') {
    common.push('  - Modo N2: tus cambios en secciones "seguras" (supuestos, hitos, escenarioBase) se aplican directo.');
    common.push('    Los cambios en secciones sensibles (cultivos, rotaciones, presupuesto) quedarán como propuesta.');
  } else if (level === 'nivel3') {
    common.push('  - Modo N3: tus cambios se aplican tras un delay de 24h (ventana de cancelación humana).');
    common.push('    Evita cambios agresivos sin evidencia clara.');
  }
  return common.join('\n');
}

function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return 'N/A';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function buildUserPrompt(ctx, level) {
  const lines = [];
  lines.push(`# Contexto para actualización del plan anual ${ctx.year}`);
  lines.push(`Fecha: ${ctx.today} · Nivel: ${level} · Versiones creadas en últimos 7 días: ${ctx.weeklyCount}`);
  lines.push('');

  if (ctx.activePlan) {
    lines.push('## Plan activo actual');
    lines.push(`Versión ${ctx.activePlan.version} · creado ${new Date(ctx.activePlan.createdAt?._seconds * 1000 || 0).toISOString().slice(0, 10)}`);
    const secs = ctx.activePlan.sections || {};
    lines.push(`  cultivos: ${(secs.cultivos || []).length} lotes planeados`);
    lines.push(`  rotaciones: ${(secs.rotaciones || []).length} referenciadas`);
    lines.push(`  hitos: ${(secs.hitos || []).length}`);
    lines.push(`  supuestos: ${(secs.supuestos || []).length}`);
    if (secs.presupuesto?.margenEsperado != null) {
      lines.push(`  presupuesto.margenEsperado: ${fmtMoney(secs.presupuesto.margenEsperado)}`);
    }
    if (secs.escenarioBase?.name) {
      lines.push(`  escenarioBase: "${secs.escenarioBase.name}"`);
    }
  } else {
    lines.push('## Plan activo actual');
    lines.push('(no existe; esta generará la versión 1)');
  }
  lines.push('');

  lines.push('## Rendimiento histórico por paquete (12 meses)');
  if (ctx.yield?.rows?.length > 0) {
    for (const r of ctx.yield.rows.slice(0, 10)) {
      lines.push(`- "${r.label}" · margen ${fmtMoney(r.margen)} (${r.margenPct ?? 'N/A'}%) · ${r.nCosechas} cosechas`);
    }
  } else {
    lines.push('(sin datos)');
  }
  lines.push('');

  lines.push('## Rotaciones recientes aceptadas');
  if (ctx.rotations?.length > 0) {
    for (const r of ctx.rotations.slice(0, 10)) {
      lines.push(`- lote=${r.loteNombre || r.loteId} · ${r.propuestas?.length || 0} ciclos · status=${r.status}`);
    }
  } else {
    lines.push('(ninguna)');
  }
  lines.push('');

  if (ctx.latestScenario) {
    lines.push('## Último escenario Monte Carlo');
    const s = ctx.latestScenario;
    lines.push(`- "${s.name}" · margen mediano: ${fmtMoney(s.resumen?.margenMedio)}`);
    if (s.claudeAnalysis?.recomendacion?.escenarioPreferido) {
      lines.push(`  Recomendación previa: ${s.claudeAnalysis.recomendacion.escenarioPreferido}`);
    }
    lines.push('');
  }

  if (ctx.recentAlerts?.length > 0) {
    lines.push('## Alertas recientes de señales externas');
    for (const a of ctx.recentAlerts.slice(0, 5)) {
      lines.push(`- ${a.title}`);
    }
    lines.push('');
  }

  if (ctx.budgets?.length > 0) {
    lines.push('## Presupuestos actuales');
    for (const b of ctx.budgets.slice(0, 10)) {
      lines.push(`- ${b.categoria || b.id}: ${fmtMoney(b.assignedAmount || b.monto)} ${b.period ? `(${b.period})` : ''}`);
    }
    lines.push('');
  }

  if (ctx.warnings?.length > 0) {
    lines.push('## Warnings de carga');
    for (const w of ctx.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('Ahora invoca `proponer_plan_diff` con la versión actualizada del plan.');
  return lines.join('\n');
}

function findToolUse(response, toolName) {
  if (!response || !Array.isArray(response.content)) return null;
  return response.content.find(b => b.type === 'tool_use' && b.name === toolName) || null;
}

// Merge de secciones: las que Claude NO devolvió se mantienen del plan
// anterior (si existe). Así el tool `proponer_plan_diff` se convierte en
// patch parcial aunque el schema pida "secciones completas": si Claude
// omite una sección, es porque no quiere cambiarla.
function mergeWithActiveSections(activeSections, proposedSections) {
  const out = { ...(activeSections || {}) };
  for (const key of Object.keys(proposedSections || {})) {
    out[key] = proposedSections[key];
  }
  return out;
}

async function generatePlanUpdate({ context, level = 'nivel1' }) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_WITH_THINKING,
    thinking: thinkingConfig(),
    system: buildSystemPrompt(level),
    tools: [TOOL_PROPONER_PLAN],
    tool_choice: { type: 'tool', name: 'proponer_plan_diff' },
    messages: [{ role: 'user', content: buildUserPrompt(context, level) }],
  });
  const toolUse = findToolUse(response, 'proponer_plan_diff');
  if (!toolUse) {
    const err = new Error('Claude did not invoke proponer_plan_diff.');
    err.code = 'NO_TOOL_USE';
    throw err;
  }
  const input = toolUse.input || {};
  const razon = typeof input.razon === 'string' ? input.razon.slice(0, 1024) : '';
  const proposedSections = input.sections && typeof input.sections === 'object' ? input.sections : {};
  const mergedSections = mergeWithActiveSections(
    context.activePlan?.sections || {},
    proposedSections,
  );
  return {
    razon,
    proposedSections,         // lo que Claude envió tal cual
    mergedSections,           // active ⊕ proposed (para persistir)
    reasoning: buildReasoning(response, toolUse),
  };
}

module.exports = {
  generatePlanUpdate,
  // Puros para tests.
  buildSystemPrompt,
  buildUserPrompt,
  findToolUse,
  mergeWithActiveSections,
  TOOL_PROPONER_PLAN,
  CLAUDE_MODEL,
};
