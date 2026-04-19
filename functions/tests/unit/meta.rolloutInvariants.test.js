// Cross-cutting architectural invariants for Fase 6 — Fase 6.6.
//
// These tests enforce contracts that SPAN multiple modules of the
// meta-agency stack. They exist so that a single accidental edit in
// one file cannot silently weaken the defense-in-depth built across
// Fases 3 (HR), 5 (financing), and 6 (meta).
//
// When any of these tests fail the failure is structural, not
// behavioural — the fix is to restore the invariant, not to relax
// the test.

const path = require('path');
const fs = require('fs');

const {
  ALLOWED_CHAIN_ACTIONS,
  FORBIDDEN_CHAIN_ACTIONS,
} = require('../../lib/meta/chains/chainValidator');
const { HR_ACTION_TYPES, FORBIDDEN_AT_NIVEL3 } = require('../../lib/hr/hrActionCaps');
const { FORBIDDEN_ACTION_TYPES, FINANCING_MAX_LEVEL } = require('../../lib/financing/financingDomainGuards');
const { CORRIDOR, CORRIDOR_KEYS, FORBIDDEN_CORRIDOR_KEYS } = require('../../lib/meta/trust/corridor');
const { ALL_ACTION_TYPES } = require('../../lib/autopilotGuardrails');
const { DOMAIN_KEYS: TRUST_DOMAIN_KEYS } = require('../../lib/meta/trust/trustScorer');

// ── INVARIANT 1: Chain allowlist cannot include HR or financing ────────────

describe('Rollout invariant 1: chain allowlist is clean', () => {
  test('ALLOWED_CHAIN_ACTIONS does not overlap with HR_ACTION_TYPES', () => {
    const allowed = new Set(ALLOWED_CHAIN_ACTIONS);
    for (const hr of HR_ACTION_TYPES) {
      expect(allowed.has(hr)).toBe(false);
    }
  });

  test('ALLOWED_CHAIN_ACTIONS does not overlap with financing FORBIDDEN_ACTION_TYPES', () => {
    const allowed = new Set(ALLOWED_CHAIN_ACTIONS);
    for (const fin of FORBIDDEN_ACTION_TYPES) {
      expect(allowed.has(fin)).toBe(false);
    }
  });

  test('ALLOWED_CHAIN_ACTIONS does not contain enviar_notificacion', () => {
    // Non-compensable actions cannot participate in a chain because the
    // rollback cascade has no way to un-send them.
    expect(ALLOWED_CHAIN_ACTIONS).not.toContain('enviar_notificacion');
  });

  test('FORBIDDEN_CHAIN_ACTIONS covers every HR type explicitly', () => {
    const forbidden = new Set(FORBIDDEN_CHAIN_ACTIONS);
    for (const hr of HR_ACTION_TYPES) {
      expect(forbidden.has(hr)).toBe(true);
    }
  });

  test('FORBIDDEN_CHAIN_ACTIONS covers the full financing prefix', () => {
    const forbidden = new Set(FORBIDDEN_CHAIN_ACTIONS);
    for (const fin of FORBIDDEN_ACTION_TYPES) {
      expect(forbidden.has(fin)).toBe(true);
    }
  });
});

// ── INVARIANT 2: Autopilot action dispatcher has zero financing handlers ──

describe('Rollout invariant 2: dispatcher has no financing handlers', () => {
  test('ALL_ACTION_TYPES contains no financing action type', () => {
    const all = new Set(ALL_ACTION_TYPES);
    for (const fin of FORBIDDEN_ACTION_TYPES) {
      expect(all.has(fin)).toBe(false);
    }
  });

  test('autopilotActions.js source does NOT declare a case for any financing type', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'lib', 'autopilotActions.js'),
      'utf-8',
    );
    for (const fin of FORBIDDEN_ACTION_TYPES) {
      // Defensive regex: require the exact case label, so substring matches
      // in comments don't produce false negatives.
      const pattern = new RegExp(`case\\s+['"]${fin}['"]\\s*:`);
      expect(src).not.toMatch(pattern);
    }
  });
});

// ── INVARIANT 3: Financing level is frozen at nivel1 ──────────────────────

describe('Rollout invariant 3: financing stays at nivel1', () => {
  test('FINANCING_MAX_LEVEL is nivel1', () => {
    expect(FINANCING_MAX_LEVEL).toBe('nivel1');
  });
});

// ── INVARIANT 4: HR forbidden-at-nivel3 list is non-empty and frozen ─────

describe('Rollout invariant 4: HR N3 cap is populated', () => {
  test('FORBIDDEN_AT_NIVEL3 contains at least one HR action type', () => {
    expect(FORBIDDEN_AT_NIVEL3.size).toBeGreaterThan(0);
    for (const t of FORBIDDEN_AT_NIVEL3) {
      expect(HR_ACTION_TYPES).toContain(t);
    }
  });
});

// ── INVARIANT 5: Trust corridor never touches architectural caps ─────────

describe('Rollout invariant 5: trust corridor is clean', () => {
  test('no corridor key appears in FORBIDDEN_CORRIDOR_KEYS (case-insensitive)', () => {
    const lower = CORRIDOR_KEYS.map(k => k.toLowerCase());
    for (const f of FORBIDDEN_CORRIDOR_KEYS) {
      expect(lower).not.toContain(f.toLowerCase());
    }
  });

  test('no corridor entry lists financing as a driving domain', () => {
    for (const key of CORRIDOR_KEYS) {
      expect(CORRIDOR[key].domains).not.toContain('financing');
    }
  });

  test('TRUST_DOMAIN_KEYS does NOT include financing', () => {
    // financing trust is never measured because financing has no autopilot
    // actions to observe — so there can be no domain bucket for it.
    expect(TRUST_DOMAIN_KEYS).not.toContain('financing');
  });
});

// ── INVARIANT 6: Cron registry exports the three meta crons ──────────────

describe('Rollout invariant 6: meta crons registered', () => {
  const indexSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf-8',
  );

  test('metaKpiSweep is exported', () => {
    expect(indexSrc).toMatch(/exports\.metaKpiSweep\s*=\s*require/);
  });

  test('metaTrustRecompute is exported', () => {
    expect(indexSrc).toMatch(/exports\.metaTrustRecompute\s*=\s*require/);
  });

  test('metaOrchestratorTick is exported', () => {
    expect(indexSrc).toMatch(/exports\.metaOrchestratorTick\s*=\s*require/);
  });
});
