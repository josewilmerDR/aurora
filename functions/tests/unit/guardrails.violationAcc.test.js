// Unit tests for the violation accumulator. Pure.

const { createViolationAccumulator } = require('../../lib/autopilotGuardrails');

describe('createViolationAccumulator', () => {
  test('empty accumulator returns empty arrays', () => {
    const acc = createViolationAccumulator();
    const snap = acc.snapshot();
    expect(snap.violations).toEqual([]);
    expect(snap.violationsByCategory).toEqual({ financial: [], general: [] });
  });

  test('defaults to general category', () => {
    const acc = createViolationAccumulator();
    acc.push('limite general');
    const snap = acc.snapshot();
    expect(snap.violations).toEqual(['limite general']);
    expect(snap.violationsByCategory.general).toEqual(['limite general']);
    expect(snap.violationsByCategory.financial).toEqual([]);
  });

  test('routes financial category correctly', () => {
    const acc = createViolationAccumulator();
    acc.push('OC excede presupuesto', 'financial');
    const snap = acc.snapshot();
    expect(snap.violations).toEqual(['OC excede presupuesto']);
    expect(snap.violationsByCategory.financial).toEqual(['OC excede presupuesto']);
    expect(snap.violationsByCategory.general).toEqual([]);
  });

  test('preserves insertion order across categories in the flat array', () => {
    const acc = createViolationAccumulator();
    acc.push('a', 'general');
    acc.push('b', 'financial');
    acc.push('c', 'general');
    expect(acc.snapshot().violations).toEqual(['a', 'b', 'c']);
  });

  test('pushMany adds multiple with same category', () => {
    const acc = createViolationAccumulator();
    acc.pushMany(['x', 'y', 'z'], 'financial');
    const snap = acc.snapshot();
    expect(snap.violations).toEqual(['x', 'y', 'z']);
    expect(snap.violationsByCategory.financial).toEqual(['x', 'y', 'z']);
  });

  test('unknown category falls back to general', () => {
    const acc = createViolationAccumulator();
    acc.push('huh', 'nonsense');
    const snap = acc.snapshot();
    expect(snap.violationsByCategory.general).toEqual(['huh']);
  });

  test('snapshot returns copies (mutations do not leak back)', () => {
    const acc = createViolationAccumulator();
    acc.push('a');
    const snap1 = acc.snapshot();
    snap1.violations.push('injected');
    snap1.violationsByCategory.general.push('injected');
    const snap2 = acc.snapshot();
    expect(snap2.violations).toEqual(['a']);
    expect(snap2.violationsByCategory.general).toEqual(['a']);
  });
});
