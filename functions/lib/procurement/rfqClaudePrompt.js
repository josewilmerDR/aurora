// Pure prompt + tool schema builder for Claude-driven RFQ winner selection.
//
// Claude is asked to choose a winner among the ELIGIBLE responses (the
// deterministic filter already removed unavailable / malformed entries).
// The deterministic cheapest-wins pick is included so Claude can either
// confirm it or override with reasoning about lead-time, supplier history,
// etc. Tight scope — no purchase-order creation, just the decision.

const SYSTEM_PROMPT = `Eres un asesor de compras agrícolas que ayuda a seleccionar el proveedor ganador de una cotización (RFQ).

Recibes el contexto de la cotización y las respuestas ya filtradas como elegibles (sin no-disponibles, sin precios inválidos, dentro del lead-time máximo si aplica). Tu tarea es recomendar un ganador, ponderando:

- Precio unitario
- Tiempo de entrega (lead time)
- Historial del proveedor (órdenes previas, fill rate, lead time histórico)
- Score compuesto del proveedor si se provee

Reglas:
- El ganador DEBE ser uno de los supplierId que aparecen en la lista de elegibles.
- Si el proveedor más barato es también el de mejor historial, ratifícalo.
- Si un proveedor un poco más caro (≤15%) tiene mucho mejor historial o lead time dramáticamente más corto, puedes recomendarlo explicando el trade-off.
- Sé conciso en la razón: 1-2 oraciones en español.

Invoca siempre la herramienta \`select_rfq_winner\` con tu elección final. No respondas en texto plano.`;

const WINNER_TOOL = Object.freeze({
  name: 'select_rfq_winner',
  description: 'Selecciona el proveedor ganador del RFQ y da la razón.',
  input_schema: {
    type: 'object',
    properties: {
      supplierId: {
        type: 'string',
        description: 'ID del proveedor ganador — debe coincidir con uno de los elegibles.',
      },
      razon: {
        type: 'string',
        description: 'Explicación breve (1-2 oraciones) en español del motivo de la elección.',
      },
    },
    required: ['supplierId', 'razon'],
  },
});

// Builds the user-message context for Claude. Eligible entries should
// already include any supplier-history signals the caller wants considered.
function buildUserContext({ rfq, deterministicWinner, eligibleWithSignals }) {
  const product = rfq?.nombreComercial || rfq?.productoId || '(sin nombre)';
  const qty = `${rfq?.cantidad ?? '?'} ${rfq?.unidad || ''}`.trim();
  const currency = rfq?.currency || 'USD';
  const deadline = rfq?.deadline || 'sin plazo';
  const maxLead = rfq?.maxLeadTimeDays != null ? `${rfq.maxLeadTimeDays} días` : 'sin tope';

  const detLine = deterministicWinner
    ? `Elección determinista (precio ascendente, tiebreak lead time): ${deterministicWinner.supplierName} (${deterministicWinner.supplierId}) a ${deterministicWinner.precioUnitario} ${deterministicWinner.moneda || currency}, lead ${formatLead(deterministicWinner.leadTimeDays)}.`
    : 'No hay elección determinista (sin elegibles).';

  const supplierLines = (eligibleWithSignals || []).map(entry => formatSupplierLine(entry, currency));

  const sections = [
    `Producto: ${product}`,
    `Cantidad: ${qty}`,
    `Moneda solicitada: ${currency}`,
    `Plazo respuesta: ${deadline}`,
    `Lead time máximo: ${maxLead}`,
    '',
    detLine,
    '',
    'Respuestas elegibles:',
    ...supplierLines,
    '',
    'Invoca select_rfq_winner con el supplierId ganador y una razón breve.',
  ];
  return sections.join('\n');
}

function formatSupplierLine(entry, currency) {
  const r = entry.response || entry;
  const sig = entry.signals || {};
  const hist = [];
  if (sig.orderCount != null) hist.push(`${sig.orderCount} OCs hist.`);
  if (sig.avgLeadTimeDays != null) hist.push(`lead hist. ${sig.avgLeadTimeDays.toFixed?.(1) || sig.avgLeadTimeDays}d`);
  if (sig.fillRate != null) hist.push(`fill ${(sig.fillRate * 100).toFixed(0)}%`);
  if (entry.score != null) hist.push(`score ${entry.score.toFixed?.(0) || entry.score}`);
  const histStr = hist.length ? ` — ${hist.join(', ')}` : ' — sin historial en este finca';
  return `- ${r.supplierName} (id: ${r.supplierId}): ${r.precioUnitario} ${r.moneda || currency}, lead ${formatLead(r.leadTimeDays)}${histStr}`;
}

function formatLead(days) {
  if (days == null) return 'no indicado';
  return `${days}d`;
}

module.exports = {
  SYSTEM_PROMPT,
  WINNER_TOOL,
  buildUserContext,
};
