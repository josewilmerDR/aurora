// Unit tests + architectural invariants for the trust corridor — Fase 6.3.

const {
  CORRIDOR,
  CORRIDOR_KEYS,
  DOMAIN_KEYS,
  FORBIDDEN_CORRIDOR_KEYS,
  clampToCorridor,
  readGuardrailValue,
} = require('../../lib/meta/trust/corridor');

describe('corridor structure', () => {
  test('every entry declares floor ≤ default ≤ ceiling', () => {
    for (const key of CORRIDOR_KEYS) {
      const e = CORRIDOR[key];
      expect(e.floor).toBeLessThanOrEqual(e.default);
      expect(e.default).toBeLessThanOrEqual(e.ceiling);
    }
  });

  test('every entry declares at least one domain', () => {
    for (const key of CORRIDOR_KEYS) {
      expect(Array.isArray(CORRIDOR[key].domains)).toBe(true);
      expect(CORRIDOR[key].domains.length).toBeGreaterThan(0);
    }
  });

  test('every domain referenced by corridor entries exists in DOMAIN_KEYS', () => {
    for (const key of CORRIDOR_KEYS) {
      for (const d of CORRIDOR[key].domains) {
        expect(DOMAIN_KEYS).toContain(d);
      }
    }
  });

  test('every entry has a direction ∈ {relax_is_higher, relax_is_lower}', () => {
    for (const key of CORRIDOR_KEYS) {
      expect(['relax_is_higher', 'relax_is_lower']).toContain(CORRIDOR[key].direction);
    }
  });

  test('corridor config is frozen (deep-ish)', () => {
    expect(Object.isFrozen(CORRIDOR)).toBe(true);
    for (const key of CORRIDOR_KEYS) {
      expect(Object.isFrozen(CORRIDOR[key])).toBe(true);
    }
  });
});

// ── ARCHITECTURAL INVARIANT ─────────────────────────────────────────────────
// The corridor must NOT contain structural caps:
//   - Financing N1-only policy (Fase 5.5)
//   - HR forbidden-at-nivel3 (Fase 3.0)
//   - Kill switches / domain levels / domain mode
// Violating any of these would let the trust manager escalate autonomy past
// architectural limits. The test below is the last guardrail against such a
// mistake sneaking in.
describe('architectural invariant: forbidden keys NEVER in corridor', () => {
  test('no corridor key matches (case-insensitive) a forbidden key', () => {
    const lower = CORRIDOR_KEYS.map(k => k.toLowerCase());
    for (const forbidden of FORBIDDEN_CORRIDOR_KEYS) {
      expect(lower).not.toContain(forbidden.toLowerCase());
    }
  });

  test('no corridor key contains words "financing", "nivel", "activo"', () => {
    // Regex belt: even partial matches are forbidden. Prevents creative
    // workarounds like `financingMaxMonto` or `activoHr`.
    const bad = /(financing|nivel|activo|kill_switch|escalation|allowHr)/i;
    for (const key of CORRIDOR_KEYS) {
      expect(key).not.toMatch(bad);
    }
  });

  test('domains referenced by corridor NEVER include financing', () => {
    // Financing is N1-only permanently. Trust on financing is not even
    // measured in Fase 6.3 (financing actions don't exist in the
    // autonomous registry), so its domain key must never drive the corridor.
    for (const key of CORRIDOR_KEYS) {
      expect(CORRIDOR[key].domains).not.toContain('financing');
    }
  });
});

describe('clampToCorridor', () => {
  test('clamps to ceiling when value exceeds', () => {
    const e = CORRIDOR.maxOrdenCompraMonto;
    expect(clampToCorridor('maxOrdenCompraMonto', e.ceiling + 1000)).toEqual({ ok: true, value: e.ceiling });
  });

  test('clamps to floor when value is below', () => {
    const e = CORRIDOR.maxOrdenCompraMonto;
    expect(clampToCorridor('maxOrdenCompraMonto', e.floor - 500)).toEqual({ ok: true, value: e.floor });
  });

  test('passes through values inside the corridor', () => {
    const e = CORRIDOR.maxOrdenCompraMonto;
    expect(clampToCorridor('maxOrdenCompraMonto', e.default)).toEqual({ ok: true, value: e.default });
  });

  test('rejects non-numeric values', () => {
    expect(clampToCorridor('maxOrdenCompraMonto', 'abc').ok).toBe(false);
    expect(clampToCorridor('maxOrdenCompraMonto', null).ok).toBe(false);
  });

  test('rejects unknown keys', () => {
    expect(clampToCorridor('bogusKey', 100).ok).toBe(false);
  });
});

describe('readGuardrailValue', () => {
  test('returns the current value when present and numeric', () => {
    expect(readGuardrailValue({ maxOrdenCompraMonto: 7000 }, 'maxOrdenCompraMonto')).toBe(7000);
  });

  test('falls back to corridor default when missing', () => {
    expect(readGuardrailValue({}, 'maxOrdenCompraMonto')).toBe(CORRIDOR.maxOrdenCompraMonto.default);
  });

  test('falls back to default when stored value is non-numeric', () => {
    expect(readGuardrailValue({ maxOrdenCompraMonto: 'oops' }, 'maxOrdenCompraMonto'))
      .toBe(CORRIDOR.maxOrdenCompraMonto.default);
  });

  test('returns null for unknown keys', () => {
    expect(readGuardrailValue({}, 'bogus')).toBeNull();
  });
});
