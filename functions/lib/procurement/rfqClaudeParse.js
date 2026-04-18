// Pure parser for Claude's RFQ winner response.
//
// Reads a messages.create() response, finds the `select_rfq_winner` tool-use
// block, validates that the selected supplierId exists in the eligible list,
// and returns the enriched winner entry + rationale.
//
// Returns null when Claude didn't invoke the tool or picked an invalid
// supplier — the caller falls back to the deterministic winner.

const TOOL_NAME = 'select_rfq_winner';

function parseClaudeWinner(response, eligibleResponses = []) {
  if (!response || !Array.isArray(response.content)) return null;

  const toolBlock = response.content.find(
    b => b.type === 'tool_use' && b.name === TOOL_NAME
  );
  if (!toolBlock) return null;

  const input = toolBlock.input || {};
  const supplierId = typeof input.supplierId === 'string' ? input.supplierId.trim() : '';
  const razon = typeof input.razon === 'string' ? input.razon.trim() : '';
  if (!supplierId) return null;

  const match = eligibleResponses.find(r => r.supplierId === supplierId);
  if (!match) return null;

  return {
    winner: match,
    rationale: razon,
    toolBlock,
  };
}

module.exports = {
  parseClaudeWinner,
  TOOL_NAME,
};
