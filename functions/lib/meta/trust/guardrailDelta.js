// Guardrail delta proposer — Fase 6.3. Pure.
//
// Given current guardrails + per-domain trust scores + the static corridor,
// emits an array of proposed changes. Each proposal is bounded inside the
// corridor by construction — no output ever exceeds [floor, ceiling].
//
// The proposer is shrinkage-aware: when trust confidence is low (few
// samples), proposed changes are pulled toward the default. This avoids
// over-reacting to a handful of observations.
//
// Interpolation (for `direction: 'relax_is_higher'`):
//
//   - Let t ∈ [0, 1] = effective trust (see below).
//   - If t >= 0.5: target = default + (ceiling - default) * (2 * (t - 0.5))
//   - If t < 0.5:  target = default - (default - floor)   * (2 * (0.5 - t))
//
// So t=1 → ceiling, t=0.5 → default, t=0 → floor — continuous monotone.
//
// "Effective trust" bakes in confidence:
//
//   effectiveTrust = 0.5 + (trust - 0.5) * confidence
//
// With confidence=0 it stays at 0.5 (no change). With confidence=1 it
// equals trust. In between, proposals shrink toward default.

const { CORRIDOR, CORRIDOR_KEYS, readGuardrailValue } = require('./corridor');

const SMALL_CHANGE_THRESHOLD = 0.02; // 2% of default — skip proposals below this

// Given trust per domain, compute the trust input for a single guardrail.
// Current rule: average of relevant domain trust scores weighted by their
// confidence. Domains with null score (no data) are ignored. If all
// relevant domains are null, returns null (no proposal emitted).
function aggregateTrustForGuardrail(guardrailEntry, trustByDomain) {
  const relevant = guardrailEntry.domains || [];
  let sumWeighted = 0;
  let sumWeight = 0;
  let sumConfidence = 0;
  let contributingCount = 0;
  for (const d of relevant) {
    const t = trustByDomain?.byDomain?.[d];
    if (!t || t.score == null) continue;
    const c = Number(t.confidence) || 0;
    if (c <= 0) continue;
    sumWeighted += t.score * c;
    sumWeight += c;
    sumConfidence += c;
    contributingCount += 1;
  }
  if (sumWeight <= 0) {
    return { trust: null, confidence: 0, contributingDomains: 0 };
  }
  return {
    trust: sumWeighted / sumWeight,
    // Average confidence across contributing domains — more domains with
    // data → higher confidence up to a cap at 1.
    confidence: Math.min(1, sumConfidence / Math.max(1, contributingCount)),
    contributingDomains: contributingCount,
  };
}

// Effective trust after applying confidence shrinkage.
function effectiveTrust(trust, confidence) {
  if (trust == null) return null;
  const c = Math.max(0, Math.min(1, Number(confidence) || 0));
  return 0.5 + (trust - 0.5) * c;
}

// Interpolate a target value within [floor, ceiling] based on effective trust.
function interpolate(entry, effTrust) {
  if (effTrust == null) return entry.default;
  const { floor, default: def, ceiling, direction } = entry;
  const t = Math.max(0, Math.min(1, effTrust));
  // Normalize direction: compute the "relax" value first, then invert if
  // the guardrail uses inverted semantics (no such guardrail yet but this
  // keeps the code future-proof).
  let target;
  if (t >= 0.5) {
    target = def + (ceiling - def) * (2 * (t - 0.5));
  } else {
    target = def - (def - floor) * (2 * (0.5 - t));
  }
  if (direction === 'relax_is_lower') {
    target = floor + (ceiling - target); // mirror across the midpoint
  }
  return target;
}

// Sensible rounding per guardrail unit. Percent → integer. USD ≥ 1000 → round
// to 100. USD < 1000 → round to 10. Counts → integer.
function roundForUnit(value, entry) {
  if (!Number.isFinite(value)) return value;
  if (entry.unit === 'percent') return Math.round(value);
  if (entry.unit === 'count') return Math.round(value);
  // currency (USD or others)
  if (Math.abs(value) >= 1000) return Math.round(value / 100) * 100;
  return Math.round(value / 10) * 10;
}

// Classifies the change as 'tighten' (more restrictive) or 'relax' (more
// permissive) based on the guardrail's direction.
function classifyChange(entry, currentValue, proposedValue) {
  if (proposedValue === currentValue) return 'unchanged';
  const higher = proposedValue > currentValue;
  if (entry.direction === 'relax_is_higher') return higher ? 'relax' : 'tighten';
  return higher ? 'tighten' : 'relax';
}

function proposeGuardrailDelta(currentGuardrails, trustScores, options = {}) {
  const proposals = [];
  const skipKeys = new Set(options.skipKeys || []);

  for (const key of CORRIDOR_KEYS) {
    if (skipKeys.has(key)) continue;
    const entry = CORRIDOR[key];
    const current = readGuardrailValue(currentGuardrails, key);
    const agg = aggregateTrustForGuardrail(entry, trustScores);
    if (agg.trust == null) {
      // No evidence yet for any of the relevant domains; skip.
      continue;
    }
    const effTrust = effectiveTrust(agg.trust, agg.confidence);
    const raw = interpolate(entry, effTrust);
    const rounded = roundForUnit(raw, entry);
    const clamped = Math.max(entry.floor, Math.min(entry.ceiling, rounded));

    // Skip infinitesimal changes to avoid noise.
    if (Math.abs(clamped - current) / Math.max(1, Math.abs(entry.default)) < SMALL_CHANGE_THRESHOLD) {
      continue;
    }

    const direction = classifyChange(entry, current, clamped);
    if (direction === 'unchanged') continue;

    proposals.push({
      key,
      currentValue: current,
      proposedValue: clamped,
      corridor: { floor: entry.floor, default: entry.default, ceiling: entry.ceiling },
      direction,
      trustInput: {
        trust: Math.round(agg.trust * 1000) / 1000,
        confidence: Math.round(agg.confidence * 1000) / 1000,
        contributingDomains: agg.contributingDomains,
        effectiveTrust: Math.round(effTrust * 1000) / 1000,
      },
      domains: entry.domains,
      unit: entry.unit,
    });
  }

  return {
    proposals,
    summary: {
      total: proposals.length,
      relax: proposals.filter(p => p.direction === 'relax').length,
      tighten: proposals.filter(p => p.direction === 'tighten').length,
    },
  };
}

module.exports = {
  proposeGuardrailDelta,
  // Exposed for tests
  aggregateTrustForGuardrail,
  effectiveTrust,
  interpolate,
  roundForUnit,
  classifyChange,
  SMALL_CHANGE_THRESHOLD,
};
