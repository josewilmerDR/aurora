// Invariant test — Fase 5.5.
//
// The financing domain is Nivel 1 by policy. That's enforced in three layers:
//   1. resolveFinancingLevel always returns 'nivel1'.
//   2. assertNivelAllowed blocks anything else.
//   3. The action registry (autopilotActions.js) must not contain any handler
//      that executes debt-related decisions.
//
// This test asserts layer (3) by scanning the source file for every name in
// FORBIDDEN_ACTION_TYPES plus a generic regex for "execute*Credit" handlers.
// Failing this test means someone added a financing action — which must go
// through an explicit policy revision (see docs/financing-autonomy.md) and
// remove the guard entries here.

const fs = require('fs');
const path = require('path');

const {
  FORBIDDEN_ACTION_TYPES,
} = require('../../lib/financing/financingDomainGuards');

const ACTIONS_PATH = path.join(__dirname, '..', '..', 'lib', 'autopilotActions.js');

function readSource() {
  return fs.readFileSync(ACTIONS_PATH, 'utf8');
}

describe('autopilotActions.js — financing invariant', () => {
  test('source file is readable', () => {
    const src = readSource();
    expect(src.length).toBeGreaterThan(100);
  });

  test('none of FORBIDDEN_ACTION_TYPES appears in the source', () => {
    const src = readSource();
    const found = FORBIDDEN_ACTION_TYPES.filter(name => src.includes(name));
    expect(found).toEqual([]);
  });

  test('no handler named executeAplicar/SolicitarCredito/TomarPrestamo', () => {
    const src = readSource();
    const bannedHandlerPatterns = [
      /execute(?:Aplicar|Solicitar)Credito/i,
      /executeTomarPrestamo/i,
      /executeContratarDeuda/i,
      /executeFirmarPagare/i,
    ];
    for (const re of bannedHandlerPatterns) {
      expect(src.match(re)).toBeNull();
    }
  });

  test('the action registry switch does not route any credit action', () => {
    const src = readSource();
    // Extract "case 'xxx':" lines to enumerate recognized action types.
    const caseMatches = Array.from(src.matchAll(/case\s+'([a-z_]+)'\s*:/g));
    const actionNames = caseMatches.map(m => m[1]);
    const offenders = actionNames.filter(n => FORBIDDEN_ACTION_TYPES.includes(n));
    expect(offenders).toEqual([]);
  });
});
