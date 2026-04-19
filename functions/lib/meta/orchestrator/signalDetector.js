// Signal detector — Fase 6.1. Pure.
//
// Given a FincaState (the output of `buildFincaState` from Fase 6.0),
// classifies urgency per domain. Urgency tiers, lowest→highest:
//
//   none < low < medium < high < critical
//
// The `callPlanner` downstream converts these tiers into an ordered call
// plan. Anything at `none` is omitted from the plan; `critical` is always
// emitted first.
//
// Rules are deliberately conservative and parameterizable via `thresholds`
// — the orchestrator can be tuned without editing this file. Each rule
// returns a short, human-readable reason, so the final plan's rationale
// is auditable (no "urgent because the code said so").

const URGENCY_RANK = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

const URGENCY_TIERS = Object.freeze(['none', 'low', 'medium', 'high', 'critical']);

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = Object.freeze({
  // Finance
  cashFloor: 0,                  // minBalance below this → critical
  cashLowFraction: 0.1,          // minBalance < fraction * startingBalance → high
  overBudgetCritical: 5,         // #categories over budget → critical
  overBudgetHigh: 3,             // → high
  overBudgetMedium: 1,           // → medium
  overallPctHigh: 100,           // overallPercent > this → medium (already spent all)
  overallPctMedium: 90,          // → low

  // Procurement
  procCriticalGapCount: 1,       // any critical gap → critical
  procHighGapCount: 2,           // ≥ this many 'high' gaps → high
  procMediumHighGapCount: 1,     // ≥ this many 'high' gaps → medium
  procMediumMediumGapCount: 2,   // ≥ this many 'medium' gaps → medium
  procLowMediumGapCount: 1,      // ≥ this many 'medium' gaps → low
  procLowLowGapCount: 3,         // ≥ this many 'low' gaps → low

  // HR
  hrRatioCritical: 1.5,          // peak/baseline ratio ≥ this → critical
  hrRatioHigh: 1.2,              // → high
  hrRatioMedium: 1.0,            // → medium (peak exceeds baseline)
  hrTrendHigh: -10,              // delta ≤ this → high (sharp drop)
  hrTrendMedium: -5,             // → medium
  hrTrendLow: -2,                // → low

  // Strategy
  strategyMissingPlanMonth: 3,   // no active plan and month ≥ this → high
  strategySignalConfidenceHigh: 0.8,  // recent signal above → medium
  strategySignalConfidenceLow: 0.6,   // → low

  // Financing
  financingFollowUpDays: 14,     // recent debt sim "tomar" without follow-up → medium
});

// Small helper so our reasons are always short and grammatical.
function r(msg) { return msg; }

function highestUrgency(candidates) {
  // candidates: [{ urgency, reason }, ...]
  let best = { urgency: 'none', reason: null };
  for (const c of candidates) {
    if (!c) continue;
    if (URGENCY_RANK[c.urgency] > URGENCY_RANK[best.urgency]) best = c;
  }
  return best;
}

function collectReasons(candidates) {
  return candidates.filter(c => c && c.urgency !== 'none' && c.reason).map(c => c.reason);
}

// ── Finance ─────────────────────────────────────────────────────────────────

function detectFinance(state, t) {
  const finance = state?.finance;
  if (!finance) return { urgency: 'none', reasons: [] };

  const cash = finance.cashProjection || {};
  const exec = finance.budgetExecution?.summary || {};
  const negativeWeeks = Number(cash.negativeWeeks) || 0;
  const minBalance = Number.isFinite(Number(cash.minBalance)) ? Number(cash.minBalance) : null;
  const startingBalance = Number(cash.startingBalance) || 0;
  const overBudgetCount = Number(exec.overBudgetCount) || 0;
  const overallPercent = Number.isFinite(Number(exec.overallPercent)) ? Number(exec.overallPercent) : null;

  const candidates = [];

  // Cash-based
  if (minBalance != null && minBalance < t.cashFloor) {
    candidates.push({ urgency: 'critical', reason: r(`Caja proyectada (${minBalance}) cae por debajo del piso (${t.cashFloor}).`) });
  } else if (negativeWeeks > 0) {
    candidates.push({ urgency: 'critical', reason: r(`Caja proyectada negativa durante ${negativeWeeks} semana(s).`) });
  } else if (minBalance != null && startingBalance > 0 && minBalance < startingBalance * t.cashLowFraction) {
    candidates.push({ urgency: 'high', reason: r(`Caja proyectada (${minBalance}) cae a <${Math.round(t.cashLowFraction * 100)}% del saldo inicial (${startingBalance}).`) });
  }

  // Budget-based
  if (overBudgetCount >= t.overBudgetCritical) {
    candidates.push({ urgency: 'critical', reason: r(`${overBudgetCount} categorías presupuestarias excedidas.`) });
  } else if (overBudgetCount >= t.overBudgetHigh) {
    candidates.push({ urgency: 'high', reason: r(`${overBudgetCount} categorías excedidas sobre el presupuesto.`) });
  } else if (overBudgetCount >= t.overBudgetMedium) {
    candidates.push({ urgency: 'medium', reason: r(`${overBudgetCount} categoría(s) excedida(s) sobre el presupuesto.`) });
  }

  // Overall % (only when no over-budget signal)
  if (overBudgetCount === 0 && overallPercent != null) {
    if (overallPercent > t.overallPctHigh) {
      candidates.push({ urgency: 'medium', reason: r(`Ejecución presupuestaria global en ${overallPercent}%.`) });
    } else if (overallPercent > t.overallPctMedium) {
      candidates.push({ urgency: 'low', reason: r(`Ejecución presupuestaria global en ${overallPercent}%.`) });
    }
  }

  const best = highestUrgency(candidates);
  return { urgency: best.urgency, reasons: collectReasons(candidates) };
}

// ── Procurement ─────────────────────────────────────────────────────────────

function detectProcurement(state, t) {
  const proc = state?.procurement;
  if (!proc) return { urgency: 'none', reasons: [] };

  const by = proc.gapsByUrgency || {};
  const critical = Number(by.critical) || 0;
  const high = Number(by.high) || 0;
  const medium = Number(by.medium) || 0;
  const low = Number(by.low) || 0;
  const total = Number(proc.gapCount) || 0;

  if (total === 0) return { urgency: 'none', reasons: [] };

  const candidates = [];
  if (critical >= t.procCriticalGapCount) {
    candidates.push({ urgency: 'critical', reason: r(`${critical} producto(s) en déficit crítico de stock.`) });
  }
  if (high >= t.procHighGapCount) {
    candidates.push({ urgency: 'high', reason: r(`${high} producto(s) con déficit alto de stock.`) });
  } else if (high >= t.procMediumHighGapCount) {
    candidates.push({ urgency: 'medium', reason: r(`${high} producto(s) con déficit alto de stock.`) });
  }
  if (medium >= t.procMediumMediumGapCount && critical === 0 && high === 0) {
    candidates.push({ urgency: 'medium', reason: r(`${medium} producto(s) con déficit medio.`) });
  } else if (medium >= t.procLowMediumGapCount && critical === 0 && high === 0) {
    candidates.push({ urgency: 'low', reason: r(`${medium} producto(s) con déficit medio.`) });
  }
  if (low >= t.procLowLowGapCount && critical === 0 && high === 0 && medium === 0) {
    candidates.push({ urgency: 'low', reason: r(`${low} producto(s) con déficit bajo.`) });
  }

  const best = highestUrgency(candidates);
  if (best.urgency === 'none' && total > 0) {
    // A small number of low gaps still deserves a ping.
    return { urgency: 'low', reasons: [r(`${total} producto(s) bajo el stock objetivo.`)] };
  }
  return { urgency: best.urgency, reasons: collectReasons(candidates) };
}

// ── HR ──────────────────────────────────────────────────────────────────────

function detectHr(state, t) {
  const hr = state?.hr;
  if (!hr) return { urgency: 'none', reasons: [] };

  const workload = hr.workloadProjection || {};
  const capacity = hr.capacity || {};
  const trend = hr.performanceTrend || {};

  const baselineWeekly = Number(capacity.baselineWeeklyHours) || 0;
  const peakHours = Number(workload.peakWeek?.estimatedPersonHours) || 0;
  const delta = Number.isFinite(Number(trend.delta)) ? Number(trend.delta) : null;

  const candidates = [];

  // Workload vs capacity (at peak)
  if (baselineWeekly > 0 && peakHours > 0) {
    const ratio = peakHours / baselineWeekly;
    if (ratio >= t.hrRatioCritical) {
      candidates.push({ urgency: 'critical', reason: r(`Pico de carga (${peakHours}h/sem) es ${ratio.toFixed(2)}× la capacidad (${baselineWeekly}h/sem).`) });
    } else if (ratio >= t.hrRatioHigh) {
      candidates.push({ urgency: 'high', reason: r(`Pico de carga (${peakHours}h/sem) excede en ${Math.round((ratio - 1) * 100)}% la capacidad (${baselineWeekly}h/sem).`) });
    } else if (ratio >= t.hrRatioMedium) {
      candidates.push({ urgency: 'medium', reason: r(`Pico de carga iguala o supera la capacidad (ratio ${ratio.toFixed(2)}).`) });
    }
  }

  // Performance trend
  if (delta != null) {
    if (delta <= t.hrTrendHigh) {
      candidates.push({ urgency: 'high', reason: r(`Caída marcada en desempeño mes vs mes anterior (Δ ${delta}).`) });
    } else if (delta <= t.hrTrendMedium) {
      candidates.push({ urgency: 'medium', reason: r(`Descenso en desempeño mes vs mes anterior (Δ ${delta}).`) });
    } else if (delta <= t.hrTrendLow) {
      candidates.push({ urgency: 'low', reason: r(`Leve descenso en desempeño (Δ ${delta}).`) });
    }
  }

  const best = highestUrgency(candidates);
  return { urgency: best.urgency, reasons: collectReasons(candidates) };
}

// ── Strategy ────────────────────────────────────────────────────────────────

function detectStrategy(state, t, now) {
  const s = state?.strategy;
  if (!s) return { urgency: 'none', reasons: [] };

  const d = now instanceof Date ? now : new Date();
  const monthUTC = d.getUTCMonth() + 1;

  const candidates = [];

  // No active annual plan and we're past the configured month threshold.
  if (!s.activeAnnualPlan && monthUTC >= t.strategyMissingPlanMonth) {
    candidates.push({ urgency: 'high', reason: r(`No hay plan anual activo (mes ${monthUTC}).`) });
  } else if (!s.activeAnnualPlan) {
    candidates.push({ urgency: 'low', reason: r('Aún no se ha activado el plan anual.') });
  }

  // Recent external signals with high confidence.
  const signals = Array.isArray(s.recentSignals) ? s.recentSignals : [];
  const maxConfidence = signals.reduce((m, sig) => {
    const c = Number(sig?.confidence);
    return Number.isFinite(c) && c > m ? c : m;
  }, 0);
  if (maxConfidence >= t.strategySignalConfidenceHigh) {
    candidates.push({ urgency: 'medium', reason: r(`Señal externa reciente con alta confianza (${maxConfidence.toFixed(2)}).`) });
  } else if (maxConfidence >= t.strategySignalConfidenceLow) {
    candidates.push({ urgency: 'low', reason: r(`Señal externa reciente (confianza ${maxConfidence.toFixed(2)}).`) });
  }

  const best = highestUrgency(candidates);
  return { urgency: best.urgency, reasons: collectReasons(candidates) };
}

// ── Financing ───────────────────────────────────────────────────────────────

function detectFinancing(state, t, now) {
  const f = state?.financing;
  if (!f) return { urgency: 'none', reasons: [] };
  const last = f.lastDebtSimulation;
  if (!last) return { urgency: 'none', reasons: [] };

  const recommendation = last.recommendation || null;
  const createdAtIso = typeof last.createdAt === 'string' ? last.createdAt : null;
  const ageDays = createdAtIso
    ? Math.max(0, Math.round(((now?.getTime?.() ?? Date.now()) - Date.parse(createdAtIso)) / 86400000))
    : null;

  // A recent "tomar" recommendation that hasn't been acted upon in a reasonable
  // follow-up window deserves a soft ping. Financing is N1 forever, so this is
  // a reminder — never an auto-action.
  if (recommendation === 'tomar' && ageDays != null && ageDays <= t.financingFollowUpDays) {
    return {
      urgency: 'medium',
      reasons: [r(`Última simulación de deuda recomienda "tomar" (hace ${ageDays} día(s)) — pendiente de revisión.`)],
    };
  }

  if (recommendation === 'tomar_condicional' && ageDays != null && ageDays <= t.financingFollowUpDays) {
    return {
      urgency: 'low',
      reasons: [r(`Última simulación de deuda sugiere condicional (hace ${ageDays} día(s)).`)],
    };
  }

  return { urgency: 'none', reasons: [] };
}

// ── Main ────────────────────────────────────────────────────────────────────

function detectSignals(fincaState, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const now = options.now instanceof Date ? options.now : new Date();

  const finance = detectFinance(fincaState, thresholds);
  const procurement = detectProcurement(fincaState, thresholds);
  const hr = detectHr(fincaState, thresholds);
  const strategy = detectStrategy(fincaState, thresholds, now);
  const financing = detectFinancing(fincaState, thresholds, now);

  return {
    finance,
    procurement,
    hr,
    strategy,
    financing,
    // Flat summary for quick display.
    urgencyRank: {
      finance: URGENCY_RANK[finance.urgency],
      procurement: URGENCY_RANK[procurement.urgency],
      hr: URGENCY_RANK[hr.urgency],
      strategy: URGENCY_RANK[strategy.urgency],
      financing: URGENCY_RANK[financing.urgency],
    },
  };
}

module.exports = {
  detectSignals,
  URGENCY_RANK,
  URGENCY_TIERS,
  DEFAULT_THRESHOLDS,
  // For tests
  _internals: {
    detectFinance,
    detectProcurement,
    detectHr,
    detectStrategy,
    detectFinancing,
    highestUrgency,
  },
};
