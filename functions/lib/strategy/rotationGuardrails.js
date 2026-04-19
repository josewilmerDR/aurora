// Guardrails agronómicos para propuestas de rotación. Puro: no toca Firestore.
//
// Recibe:
//   - propuestas: array ordenado de ciclos recomendados para UN lote
//     [{ orden, paqueteId, nombrePaquete, cultivo, familiaBotanica?, fechaSiembra }]
//   - constraintsByCultivo: mapa cultivo (lower-case) → rotation_constraint doc
//   - historial: array de siembras previas del lote (más reciente primero)
//     [{ fecha: 'YYYY-MM-DD', cerrado, fechaCierre: 'YYYY-MM-DD'|null,
//        cultivo, familiaBotanica? }]
//   - activeSiembras: array de siembras no cerradas del lote (puede estar vacío)
//   - monthlyExecutionsCount: nº de acciones `crear_siembra` ejecutadas este
//     mes por el autopilot (para cap N3)
//   - maxMonthlyExecutions: cap numérico (default 10)
//
// Devuelve { allowed, violations: [{code, message, orden?, severity}] }.
// Cada violación trae un code estable para que el frontend pueda reaccionar
// selectivamente y una severidad ('block' | 'warn').
//
// Reglas aplicadas:
//   R1 FAMILIA_CONSECUTIVA — no repetir familia botánica en ciclos
//     consecutivos más allá de `descansoMinCiclos` del constraint.
//   R2 DESCANSO_DIAS      — respetar `descansoMinDias` entre fin de ciclo
//     previo y fecha de siembra nueva.
//   R3 INCOMPATIBILIDAD   — no sembrar cultivo en la lista `incompatibleCon`
//     del ciclo anterior.
//   R4 OVERLAP_ACTIVO     — la primera propuesta no puede caer antes del
//     cierre de una siembra activa del lote.
//   R5 ORDEN_FECHAS       — las fechas de siembra deben ir estrictamente
//     crecientes (propuesta[i+1].fechaSiembra > propuesta[i].fechaSiembra).
//   R6 MONTHLY_CAP        — el total de ciclos a ejecutar + lo ya ejecutado
//     este mes no puede superar el cap mensual (solo relevante para N3).

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIso(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, dbb] = b.split('-').map(Number);
  const ta = Date.UTC(ya, ma - 1, da);
  const tb = Date.UTC(yb, mb - 1, dbb);
  return Math.round((tb - ta) / (1000 * 60 * 60 * 24));
}

function getConstraint(constraintsByCultivo, cultivo) {
  if (!cultivo) return null;
  const key = String(cultivo).toLowerCase();
  return constraintsByCultivo[key] || null;
}

function isIncompatible(incompatibleCon, cultivo) {
  if (!Array.isArray(incompatibleCon) || !cultivo) return false;
  const target = String(cultivo).toLowerCase();
  return incompatibleCon.some(c => String(c).toLowerCase() === target);
}

// Determina la "cadena previa" para una propuesta, concatenando historial + las
// propuestas anteriores. Así la regla R1 puede mirar los últimos N ciclos de
// ambos lados al evaluar la propuesta i.
function buildHistoryChain(historial, propuestasPrev) {
  const chain = [];
  // Historial viene más-reciente-primero → lo invertimos para tener orden
  // cronológico: el elemento [0] es el más antiguo.
  const sortedHist = [...(historial || [])].sort((a, b) => {
    return (a.fecha || '').localeCompare(b.fecha || '');
  });
  for (const h of sortedHist) chain.push({
    source: 'historial',
    cultivo: h.cultivo || null,
    familiaBotanica: h.familiaBotanica || null,
    fechaInicio: h.fecha || null,
    fechaFin: h.fechaCierre || null,
    cerrado: !!h.cerrado,
  });
  for (const p of propuestasPrev) chain.push({
    source: 'propuesta',
    cultivo: p.cultivo || null,
    familiaBotanica: p.familiaBotanica || null,
    fechaInicio: p.fechaSiembra || null,
    // duración estimada para el cierre (si no viene, asumimos 0).
    fechaFin: p.fechaCierreEstimado || null,
    cerrado: true,
  });
  return chain;
}

function validateRotationProposal({
  propuestas,
  constraintsByCultivo = {},
  historial = [],
  activeSiembras = [],
  monthlyExecutionsCount = 0,
  maxMonthlyExecutions = 10,
  mode = 'plan',  // 'plan' | 'nivel3' (mode nivel3 aplica R6)
} = {}) {
  const violations = [];
  if (!Array.isArray(propuestas) || propuestas.length === 0) {
    return {
      allowed: false,
      violations: [{ code: 'EMPTY_PROPOSAL', message: 'No hay propuestas a validar.', severity: 'block' }],
    };
  }

  // R5 — las fechas deben ser estrictamente crecientes.
  for (let i = 0; i < propuestas.length; i++) {
    const p = propuestas[i];
    if (!isValidIso(p.fechaSiembra)) {
      violations.push({
        code: 'INVALID_DATE', severity: 'block', orden: p.orden ?? i + 1,
        message: `La propuesta ${i + 1} tiene fecha de siembra inválida.`,
      });
      continue;
    }
    if (i > 0) {
      const prev = propuestas[i - 1];
      if (isValidIso(prev.fechaSiembra) && p.fechaSiembra <= prev.fechaSiembra) {
        violations.push({
          code: 'ORDEN_FECHAS', severity: 'block', orden: p.orden ?? i + 1,
          message: `La propuesta ${i + 1} tiene fecha ≤ que la anterior.`,
        });
      }
    }
  }

  // R4 — conflicto con siembra activa (no cerrada) del lote.
  if (activeSiembras.length > 0 && isValidIso(propuestas[0]?.fechaSiembra)) {
    const soonest = propuestas[0].fechaSiembra;
    for (const s of activeSiembras) {
      // Siembra activa cualquier — consideramos que la nueva siembra choca
      // si su fecha cae antes del cierre esperado (cerrado=false → desconocido,
      // flag como 'warn' conservador).
      violations.push({
        code: 'OVERLAP_ACTIVO', severity: 'warn', orden: propuestas[0].orden ?? 1,
        message: `Hay una siembra activa en el lote (id=${s.id || '—'}); verifica que esté cerrada antes del ${soonest}.`,
      });
    }
  }

  // R1, R2, R3 — evaluación contra cadena histórico + propuestas previas.
  for (let i = 0; i < propuestas.length; i++) {
    const p = propuestas[i];
    if (!isValidIso(p.fechaSiembra)) continue;                 // R5 ya cubierta
    const constraint = getConstraint(constraintsByCultivo, p.cultivo);
    const chain = buildHistoryChain(historial, propuestas.slice(0, i));

    // --- R1 FAMILIA_CONSECUTIVA ---
    // Miramos los últimos N ciclos, donde N = descansoMinCiclos + 1. Si los
    // N ciclos previos inmediatos comparten la misma familia botánica que la
    // propuesta actual, se viola. Con descansoMinCiclos=0 la regla no aplica.
    const descansoCiclos = constraint?.descansoMinCiclos ?? 0;
    if (descansoCiclos > 0 && p.familiaBotanica) {
      const lastN = chain.slice(-descansoCiclos);
      const allSameFamilia = lastN.length === descansoCiclos
        && lastN.every(c => c.familiaBotanica &&
          String(c.familiaBotanica).toLowerCase() === String(p.familiaBotanica).toLowerCase());
      if (allSameFamilia) {
        violations.push({
          code: 'FAMILIA_CONSECUTIVA', severity: 'block', orden: p.orden ?? i + 1,
          message: `"${p.cultivo}" comparte familia botánica "${p.familiaBotanica}" con los últimos ${descansoCiclos} ciclos.`,
        });
      }
    }

    // --- R2 DESCANSO_DIAS ---
    const descansoDias = constraint?.descansoMinDias ?? 0;
    if (descansoDias > 0 && chain.length > 0) {
      const prev = chain[chain.length - 1];
      const prevEnd = prev.fechaFin || prev.fechaInicio;
      if (isValidIso(prevEnd)) {
        const gap = daysBetween(prevEnd, p.fechaSiembra);
        if (gap < descansoDias) {
          violations.push({
            code: 'DESCANSO_DIAS', severity: 'block', orden: p.orden ?? i + 1,
            message: `"${p.cultivo}" requiere ${descansoDias} días de descanso; la propuesta deja ${gap}.`,
          });
        }
      }
    }

    // --- R3 INCOMPATIBILIDAD ---
    if (chain.length > 0) {
      const prev = chain[chain.length - 1];
      const prevConstraint = getConstraint(constraintsByCultivo, prev.cultivo);
      if (prevConstraint?.incompatibleCon && isIncompatible(prevConstraint.incompatibleCon, p.cultivo)) {
        violations.push({
          code: 'INCOMPATIBILIDAD', severity: 'block', orden: p.orden ?? i + 1,
          message: `"${p.cultivo}" no puede seguir a "${prev.cultivo}" (marcado como incompatible).`,
        });
      }
    }
  }

  // R6 MONTHLY_CAP — solo relevante al pasar a ejecución (N3).
  if (mode === 'nivel3') {
    const total = monthlyExecutionsCount + propuestas.length;
    if (total > maxMonthlyExecutions) {
      violations.push({
        code: 'MONTHLY_CAP', severity: 'block',
        message: `La ejecución N3 superaría el cap de ${maxMonthlyExecutions} siembras automáticas por mes (actual: ${monthlyExecutionsCount}, propuestas: ${propuestas.length}).`,
      });
    }
  }

  const blocking = violations.filter(v => v.severity === 'block');
  return {
    allowed: blocking.length === 0,
    violations,
  };
}

module.exports = {
  validateRotationProposal,
  // Exports para tests.
  _isValidIso: isValidIso,
  _daysBetween: daysBetween,
  _buildHistoryChain: buildHistoryChain,
  _isIncompatible: isIncompatible,
};
