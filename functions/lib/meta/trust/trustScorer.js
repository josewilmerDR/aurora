// Trust scorer — Fase 6.3. Pure.
//
// Computes a 0..1 "trust score" per domain based on `meta_kpi_observations`
// rows. The score answers: "how often did Aurora's decisions in this
// domain produce the expected outcome?" It is the primary input for the
// dynamic guardrail adjustment (`guardrailDelta.js`).
//
// Scoring model:
//
//   - Each observation contributes a value in {0, 0.5, 1} (miss, partial,
//     match). `undetermined` and `pending` are skipped entirely (they are
//     not evidence about the decision, just absence of evidence).
//   - Each observation carries a weight that decays with age:
//       weight = exp(-ageDays / HALF_LIFE_DAYS), clamped to [0.01, 1]
//     HALF_LIFE_DAYS = 90: observations older than 90 days count for
//     ~half of a fresh one, observations older than 180 days for ~quarter.
//   - score = Σ (value * weight) / Σ weight              (domain-specific)
//   - confidence = min(1, Σ weight / MIN_EFFECTIVE_SAMPLES)
//     MIN_EFFECTIVE_SAMPLES = 10. Below that, the score is directionally
//     useful but the corridor only nudges gently.
//
// Domain mapping (how observations attribute to domains):
//
//   - actionType ∈ {reasignar_presupuesto} → 'finance'
//   - actionType ∈ {crear_orden_compra, crear_solicitud_compra} → 'procurement'
//   - actionType ∈ {sugerir_*} → 'hr'
//   - actionType ∈ {crear_siembra, crear_tarea} → 'strategy'
//   - actionType ∈ {orchestrator_run} → 'meta' (its own bucket)
//
// The scorer never fails: missing fields produce `null` for that domain's
// score and `sampleSize=0`.

const HALF_LIFE_DAYS = 90;
const MIN_EFFECTIVE_SAMPLES = 10;
const WEIGHT_FLOOR = 0.01;

// Map actionType → analytic domain. Orchestrator runs get their own
// bucket because their metric (urgency resolution) spans domains; it
// should not be folded into any single domain's trust.
const ACTION_TYPE_TO_DOMAIN = Object.freeze({
  reasignar_presupuesto: 'finance',
  crear_orden_compra: 'procurement',
  crear_solicitud_compra: 'procurement',
  crear_siembra: 'strategy',
  crear_tarea: 'strategy',
  sugerir_contratacion: 'hr',
  sugerir_despido: 'hr',
  sugerir_sancion: 'hr',
  sugerir_memorando: 'hr',
  sugerir_revision_desempeno: 'hr',
  orchestrator_run: 'meta',
});

const OUTCOME_VALUES = Object.freeze({
  match: 1,
  partial: 0.5,
  miss: 0,
});

const DOMAIN_KEYS = Object.freeze(['finance', 'procurement', 'hr', 'strategy', 'meta']);

function domainForObservation(row) {
  if (!row) return null;
  if (row.category && typeof row.category === 'string') {
    // Legacy: some autopilot_actions persist `categoria` for HR ('hr') or
    // finance ('financiera'). Respect those first.
    const c = row.category;
    if (c === 'financiera' || c === 'finance') return 'finance';
    if (c === 'procurement') return 'procurement';
    if (c === 'hr' || c === 'rrhh') return 'hr';
    if (c === 'strategy') return 'strategy';
  }
  const at = row.actionType;
  return ACTION_TYPE_TO_DOMAIN[at] || null;
}

function toMillis(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  return null;
}

function decayWeight(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays < 0) return 0;
  const w = Math.exp(-ageDays / HALF_LIFE_DAYS);
  return Math.max(WEIGHT_FLOOR, Math.min(1, w));
}

// Main scoring function. Input: array of meta_kpi_observations rows (or
// equivalent shape — only the fields `outcome`, `actionType`, `category`,
// `evaluatedAt`, `t1` are read). Returns one entry per domain in
// DOMAIN_KEYS plus an 'overall' rollup.
function computeTrustScores(observations, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const rows = Array.isArray(observations) ? observations : [];

  const buckets = {};
  for (const d of DOMAIN_KEYS) buckets[d] = emptyBucket();
  const overall = emptyBucket();

  for (const row of rows) {
    const outcome = row?.outcome;
    const value = OUTCOME_VALUES[outcome];
    if (value == null) continue; // undetermined/pending/unknown → skip entirely

    const domain = domainForObservation(row);
    const anchorMs = toMillis(row?.t1) || toMillis(row?.evaluatedAt);
    const ageDays = anchorMs != null ? Math.max(0, (now - anchorMs) / 86400000) : 0;
    const weight = decayWeight(ageDays);

    overall.weightedValue += value * weight;
    overall.totalWeight += weight;
    overall.count += 1;

    if (domain && buckets[domain]) {
      buckets[domain].weightedValue += value * weight;
      buckets[domain].totalWeight += weight;
      buckets[domain].count += 1;
    }
  }

  const decorate = (b) => {
    if (b.totalWeight <= 0) {
      return {
        score: null,
        confidence: 0,
        sampleSize: b.count,
        effectiveSample: 0,
      };
    }
    return {
      score: Math.round((b.weightedValue / b.totalWeight) * 1000) / 1000,
      confidence: Math.min(1, b.totalWeight / MIN_EFFECTIVE_SAMPLES),
      sampleSize: b.count,
      effectiveSample: Math.round(b.totalWeight * 100) / 100,
    };
  };

  const out = {
    overall: decorate(overall),
    byDomain: {},
    computedAt: new Date(now).toISOString(),
    halfLifeDays: HALF_LIFE_DAYS,
    minEffectiveSamples: MIN_EFFECTIVE_SAMPLES,
  };
  for (const d of DOMAIN_KEYS) out.byDomain[d] = decorate(buckets[d]);
  return out;
}

function emptyBucket() {
  return { weightedValue: 0, totalWeight: 0, count: 0 };
}

module.exports = {
  computeTrustScores,
  HALF_LIFE_DAYS,
  MIN_EFFECTIVE_SAMPLES,
  DOMAIN_KEYS,
  ACTION_TYPE_TO_DOMAIN,
  OUTCOME_VALUES,
  // For tests
  _internals: { decayWeight, domainForObservation, toMillis, emptyBucket },
};
