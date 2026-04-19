// Recomendador de rotación de cultivos — orquesta una llamada a Claude con
// thinking blocks y una tool `proponer_rotacion` que obliga al modelo a
// estructurar su salida.
//
// Diseño:
//   1. La ruta reúne el contexto (lote, histórico, paquetes disponibles,
//      constraints, rendimiento reciente 4.1) y lo pasa a este módulo.
//   2. Claude piensa (`thinking` habilitado) y responde con un único uso de
//      la tool `proponer_rotacion` con un array `propuestas`.
//   3. Este módulo parsea la respuesta, persiste el `reasoning` (siguiendo
//      el contrato de autopilotReasoning.js) y devuelve las propuestas
//      normalizadas para que la ruta corra los guardrails.
//
// NO llama a executeAutopilotAction. Eso es decisión de la ruta según el
// nivel (N1/N2/N3).

const { getAnthropicClient } = require('../clients');
const {
  MAX_TOKENS_WITH_THINKING,
  thinkingConfig,
  buildReasoning,
} = require('../autopilotReasoning');

const CLAUDE_MODEL = 'claude-sonnet-4-6';

// ─── Tool definition ───────────────────────────────────────────────────────

const TOOL_PROPONER_ROTACION = {
  name: 'proponer_rotacion',
  description:
    'Propone una secuencia de cultivos para un lote a lo largo de los próximos N ciclos. ' +
    'Cada propuesta debe referenciar un paqueteId del catálogo existente y una fechaSiembra en formato YYYY-MM-DD. ' +
    'Explica el razonamiento agronómico/económico por cada ciclo en el campo "razon".',
  input_schema: {
    type: 'object',
    properties: {
      propuestas: {
        type: 'array',
        description: 'Secuencia ordenada de ciclos recomendados.',
        items: {
          type: 'object',
          properties: {
            orden: { type: 'integer', description: 'Posición del ciclo en la secuencia (1..N).' },
            paqueteId: { type: 'string', description: 'ID del paquete recomendado (debe existir en el catálogo suministrado).' },
            fechaSiembra: { type: 'string', description: 'Fecha estimada de siembra YYYY-MM-DD.' },
            duracionEstimadaDias: { type: 'integer', description: 'Duración estimada del ciclo en días.' },
            razon: { type: 'string', description: 'Justificación breve de la elección (agronómica + económica).' },
          },
          required: ['orden', 'paqueteId', 'fechaSiembra', 'razon'],
        },
      },
      comentarioGeneral: {
        type: 'string',
        description: 'Síntesis de la estrategia global (ej. "rotación orientada a reducir plaga X manteniendo margen").',
      },
    },
    required: ['propuestas'],
  },
};

// ─── System prompt ─────────────────────────────────────────────────────────

function buildSystemPrompt() {
  return [
    'Eres el agente estratégico agrícola de Aurora, especializado en rotación de cultivos.',
    'Tu tarea: recomendar una secuencia de siembras para un lote dado, optimizando rendimiento y respetando restricciones agronómicas.',
    '',
    'Reglas duras que SIEMPRE debes respetar:',
    '  - Usa únicamente paquetes presentes en el catálogo suministrado.',
    '  - Respeta el descanso mínimo entre ciclos de la misma familia botánica según los constraints.',
    '  - No propongas un cultivo marcado como incompatible tras el cultivo previo.',
    '  - Las fechas de siembra deben ir en orden cronológico estricto.',
    '',
    'Criterios de preferencia:',
    '  - Prefiere paquetes con mejor margen histórico cuando todo lo demás es equivalente.',
    '  - Prefiere alternar familias botánicas cuando el lote lo permite.',
    '  - Ajusta la fecha de siembra a las temporadas inferidas si existen.',
    '',
    'Siempre invocas exactamente UNA vez la tool `proponer_rotacion` con tu plan completo. No respondas con texto libre fuera de la tool.',
  ].join('\n');
}

// ─── User prompt (contexto) ────────────────────────────────────────────────

function fmtKgPerHa(r) {
  if (r?.kgPorHa == null) return 'N/A';
  return `${r.kgPorHa.toLocaleString('en-US', { maximumFractionDigits: 0 })} kg/ha`;
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(n) { return n == null ? 'N/A' : `${Number(n).toFixed(1)}%`; }

function buildUserPrompt({
  lote,
  horizonteCiclos,
  paquetes,
  constraints,
  historial,
  yieldRows,
  temporadas,
  today,
}) {
  const lines = [];
  lines.push(`# Contexto de recomendación`);
  lines.push(`Fecha actual: ${today}`);
  lines.push(`Lote: "${lote.nombreLote}" (id=${lote.id}) — ${lote.hectareas || 0} ha`);
  lines.push(`Horizonte solicitado: ${horizonteCiclos} ciclos.`);
  lines.push('');

  lines.push(`## Catálogo de paquetes disponibles (${paquetes.length})`);
  for (const p of paquetes) {
    lines.push(
      `- id=${p.id} — nombre="${p.nombrePaquete}" — tipoCosecha="${p.tipoCosecha || 'N/A'}" — etapa="${p.etapaCultivo || 'N/A'}"`
    );
  }
  lines.push('');

  lines.push(`## Restricciones agronómicas (constraints)`);
  if (constraints.length === 0) {
    lines.push('(vacío — el agrónomo aún no cargó reglas, usa criterio conservador)');
  } else {
    for (const c of constraints) {
      const incomp = Array.isArray(c.incompatibleCon) && c.incompatibleCon.length > 0
        ? ` · incompatibleCon=${c.incompatibleCon.join(',')}` : '';
      lines.push(
        `- cultivo="${c.cultivo}" · familia="${c.familiaBotanica}" · descansoCiclos=${c.descansoMinCiclos || 0} · descansoDias=${c.descansoMinDias || 0}${incomp}`
      );
    }
  }
  lines.push('');

  lines.push(`## Histórico de siembras en este lote (hasta 10 más recientes)`);
  if (historial.length === 0) {
    lines.push('(lote sin siembras previas registradas)');
  } else {
    for (const h of historial.slice(0, 10)) {
      lines.push(`- fecha=${h.fecha} · paquete="${h.paqueteNombre || h.paqueteId || '—'}" · cerrado=${h.cerrado} · cierre=${h.fechaCierre || '—'}`);
    }
  }
  lines.push('');

  lines.push(`## Rendimiento reciente por paquete (agregado)`);
  if (!yieldRows || yieldRows.length === 0) {
    lines.push('(sin datos agregados — el agregador 4.1 no devolvió filas)');
  } else {
    for (const r of yieldRows.slice(0, 12)) {
      lines.push(
        `- "${r.label}" · ${fmtKgPerHa(r)} · margen=${fmtMoney(r.margen)} (${fmtPct(r.margenPct)}) · nCosechas=${r.nCosechas}`
      );
    }
  }
  lines.push('');

  if (temporadas && temporadas.length > 0) {
    lines.push(`## Temporadas registradas (usar para alinear fechaSiembra)`);
    for (const t of temporadas.slice(0, 6)) {
      lines.push(`- ${t.nombre}: ${t.fechaInicio} → ${t.fechaFin}`);
    }
    lines.push('');
  }

  lines.push(`Produce ahora tu plan invocando la tool \`proponer_rotacion\` exactamente una vez.`);
  return lines.join('\n');
}

// ─── Parsing de la respuesta ───────────────────────────────────────────────

function findToolUseBlock(response, toolName) {
  if (!response || !Array.isArray(response.content)) return null;
  return response.content.find(b => b.type === 'tool_use' && b.name === toolName) || null;
}

function normalizeClaudePropuestas(rawPropuestas, { paquetesById }) {
  if (!Array.isArray(rawPropuestas)) return [];
  const out = [];
  for (let i = 0; i < rawPropuestas.length; i++) {
    const raw = rawPropuestas[i] || {};
    const paquete = paquetesById[raw.paqueteId];
    // Si el paquete sugerido no existe en el catálogo, conservamos la entrada
    // pero marcamos paqueteId/nombrePaquete como nulo. Los guardrails lo
    // detectarán (propuesta inválida) y el usuario podrá revisarlo.
    out.push({
      orden: Number.isInteger(raw.orden) ? raw.orden : i + 1,
      paqueteId: paquete ? paquete.id : null,
      nombrePaquete: paquete?.nombrePaquete || null,
      tipoCosecha: paquete?.tipoCosecha || null,
      cultivo: paquete?.tipoCosecha || null,  // usamos tipoCosecha como cultivo canonical
      familiaBotanica: paquete?.familiaBotanica || null, // raro que exista en packages; lo resuelve la ruta
      fechaSiembra: typeof raw.fechaSiembra === 'string' ? raw.fechaSiembra : null,
      duracionEstimadaDias: Number.isFinite(Number(raw.duracionEstimadaDias))
        ? Math.max(1, Math.min(365 * 5, Number(raw.duracionEstimadaDias)))
        : null,
      razon: typeof raw.razon === 'string' ? raw.razon.slice(0, 1024) : '',
    });
  }
  return out;
}

// Resuelve la `familiaBotanica` para cada propuesta mirando el constraint
// asociado al cultivo. Mantiene pureza (no toca DB).
function enrichWithFamilia(propuestas, constraintsByCultivo) {
  return propuestas.map(p => {
    if (p.familiaBotanica) return p;
    const key = String(p.cultivo || '').toLowerCase();
    const c = constraintsByCultivo[key];
    if (c?.familiaBotanica) return { ...p, familiaBotanica: c.familiaBotanica };
    return p;
  });
}

// ─── Función principal ─────────────────────────────────────────────────────

async function recommendRotation(context) {
  const {
    lote, horizonteCiclos, paquetes, constraints, historial,
    yieldRows, temporadas, today,
  } = context;

  const paquetesById = Object.fromEntries((paquetes || []).map(p => [p.id, p]));
  const constraintsByCultivo = {};
  for (const c of constraints || []) {
    if (c.cultivo) constraintsByCultivo[String(c.cultivo).toLowerCase()] = c;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    lote, horizonteCiclos, paquetes, constraints, historial,
    yieldRows, temporadas, today,
  });

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS_WITH_THINKING,
    thinking: thinkingConfig(),
    system: systemPrompt,
    tools: [TOOL_PROPONER_ROTACION],
    tool_choice: { type: 'tool', name: 'proponer_rotacion' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = findToolUseBlock(response, 'proponer_rotacion');
  if (!toolUse) {
    const err = new Error('Claude did not invoke proponer_rotacion.');
    err.code = 'NO_TOOL_USE';
    err.response = response;
    throw err;
  }

  const rawPropuestas = toolUse.input?.propuestas || [];
  let propuestas = normalizeClaudePropuestas(rawPropuestas, { paquetesById });
  propuestas = enrichWithFamilia(propuestas, constraintsByCultivo);

  const reasoning = buildReasoning(response, toolUse);
  const comentarioGeneral = typeof toolUse.input?.comentarioGeneral === 'string'
    ? toolUse.input.comentarioGeneral.slice(0, 1024)
    : null;

  return {
    propuestas,
    comentarioGeneral,
    reasoning,
    modelVersion: response.model || CLAUDE_MODEL,
  };
}

module.exports = {
  recommendRotation,
  // Exports puros para tests (no ejercitan la API).
  buildSystemPrompt,
  buildUserPrompt,
  normalizeClaudePropuestas,
  enrichWithFamilia,
  findToolUseBlock,
  TOOL_PROPONER_ROTACION,
  CLAUDE_MODEL,
};
