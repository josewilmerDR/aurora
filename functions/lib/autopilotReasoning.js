/**
 * Autopilot reasoning capture — extended-thinking helpers for Claude.
 *
 * Pure utilities, no DB or HTTP coupling. Used by autopilot.js to:
 *   1. Build the `thinking` config passed to anthropic.messages.create()
 *   2. Extract thinking text from the response
 *   3. Compose the `reasoning` payload that gets persisted on each
 *      autopilot_actions doc
 *   4. Strip `reasoning` from outbound action payloads when the caller
 *      isn't authorized to see it
 *
 * Privacy note: reasoning content can include snapshot data (lote names,
 * stock figures, user names). Default to stripping it; only return when
 * the caller explicitly opts in AND has supervisor+ rights.
 */

// Default thinking budget — the model can think up to this many tokens
// before producing tool_use / text. Picked to give substantive reasoning
// for agricultural decisions without ballooning latency or cost.
const THINKING_BUDGET_TOKENS = 5000;

// max_tokens must accommodate thinking + response together. We default
// callers to this when they enable thinking.
const MAX_TOKENS_WITH_THINKING = 10000;

/**
 * Returns the `thinking` config block to pass to messages.create().
 * Callers should also bump `max_tokens` to MAX_TOKENS_WITH_THINKING.
 */
function thinkingConfig() {
  return { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS };
}

/**
 * Joins all thinking blocks from a Claude response into a single string.
 * Redacted thinking is replaced with a marker since the underlying text
 * isn't available to us.
 */
function extractThinking(response) {
  if (!response || !Array.isArray(response.content)) return '';
  const parts = [];
  for (const block of response.content) {
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push(block.thinking);
    } else if (block.type === 'redacted_thinking') {
      parts.push('[razonamiento redactado por seguridad del modelo]');
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * Builds the `reasoning` payload to attach to a proposed/executed action.
 * Pass the Claude `response` for this turn and the specific tool_use block
 * that produced this action.
 *
 *   {
 *     thinking: <combined thinking text from this turn>,
 *     toolName: <the tool the model invoked>,
 *     toolInput: <the input args the model passed to the tool>,
 *     modelVersion: <e.g. "claude-sonnet-4-6">,
 *     capturedAt: <ISO timestamp>
 *   }
 */
function buildReasoning(response, toolUseBlock) {
  return {
    thinking: extractThinking(response),
    toolName: toolUseBlock?.name || null,
    toolInput: toolUseBlock?.input || null,
    modelVersion: response?.model || null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Returns a copy of the action with the `reasoning` field removed.
 * Use when serializing actions for clients without supervisor+ rights.
 */
function stripReasoning(action) {
  if (!action || typeof action !== 'object') return action;
  const { reasoning, ...rest } = action;
  return rest;
}

module.exports = {
  THINKING_BUDGET_TOKENS,
  MAX_TOKENS_WITH_THINKING,
  thinkingConfig,
  extractThinking,
  buildReasoning,
  stripReasoning,
};
