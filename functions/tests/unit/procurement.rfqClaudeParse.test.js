// Unit tests for the Claude RFQ winner parser. Pure.

const { parseClaudeWinner } = require('../../lib/procurement/rfqClaudeParse');

const mkResponse = (content) => ({ content, model: 'claude-sonnet-4-6' });
const toolUse = (input) => ({ type: 'tool_use', name: 'select_rfq_winner', id: 't1', input });

const eligible = [
  { supplierId: 'S1', supplierName: 'Uno', precioUnitario: 100, leadTimeDays: 5 },
  { supplierId: 'S2', supplierName: 'Dos', precioUnitario: 90,  leadTimeDays: 10 },
];

describe('parseClaudeWinner', () => {
  test('returns the matching eligible entry plus rationale', () => {
    const response = mkResponse([
      { type: 'thinking', thinking: 'historic supplier...' },
      toolUse({ supplierId: 'S1', razon: 'Mejor historial.' }),
    ]);
    const out = parseClaudeWinner(response, eligible);
    expect(out.winner.supplierId).toBe('S1');
    expect(out.rationale).toBe('Mejor historial.');
    expect(out.toolBlock.name).toBe('select_rfq_winner');
  });

  test('returns null when Claude did not invoke the tool', () => {
    const response = mkResponse([
      { type: 'text', text: 'Prefiero a S1 porque...' },
    ]);
    expect(parseClaudeWinner(response, eligible)).toBeNull();
  });

  test('returns null when Claude picked a supplierId not in eligible list', () => {
    const response = mkResponse([toolUse({ supplierId: 'S99', razon: 'inventado' })]);
    expect(parseClaudeWinner(response, eligible)).toBeNull();
  });

  test('returns null when supplierId is empty or missing', () => {
    expect(parseClaudeWinner(mkResponse([toolUse({ supplierId: '', razon: 'x' })]), eligible)).toBeNull();
    expect(parseClaudeWinner(mkResponse([toolUse({ razon: 'x' })]), eligible)).toBeNull();
  });

  test('handles non-response input safely', () => {
    expect(parseClaudeWinner(null, eligible)).toBeNull();
    expect(parseClaudeWinner({}, eligible)).toBeNull();
    expect(parseClaudeWinner({ content: 'not-an-array' }, eligible)).toBeNull();
  });

  test('trims whitespace around supplierId and rationale', () => {
    const response = mkResponse([toolUse({ supplierId: '  S2  ', razon: '   razón   ' })]);
    const out = parseClaudeWinner(response, eligible);
    expect(out.winner.supplierId).toBe('S2');
    expect(out.rationale).toBe('razón');
  });
});
