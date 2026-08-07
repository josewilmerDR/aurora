// Pure builder for the RFQ (Request for Quotation) message que el operador
// envía manualmente al proveedor (el canal Twilio se eliminó). Spanish,
// intentionally short: lectura móvil breve. Maximum ~1500 chars — cabe en
// un mensaje de WhatsApp/SMS si el operador usa ese medio.

const MAX_MESSAGE = 1500;

function buildRfqMessage({
  supplierName,
  fincaName,
  productName,
  cantidad,
  unidad,
  deadline,
  rfqId,
  notas,
} = {}) {
  const lines = [];
  const greeting = supplierName ? `Hola ${trunc(supplierName, 60)},` : 'Hola,';
  lines.push(greeting, '');
  const farm = fincaName ? trunc(fincaName, 80) : 'Nuestra finca';
  lines.push(`${farm} solicita cotización para:`);
  lines.push(`• Producto: ${trunc(productName || '(sin nombre)', 120)}`);
  lines.push(`• Cantidad: ${formatQty(cantidad)} ${trunc(unidad || '', 20)}`.trimEnd());
  if (deadline) lines.push(`• Respuesta antes de: ${deadline}`);
  if (notas) lines.push(`• Notas: ${trunc(notas, 200)}`);
  lines.push('');
  lines.push('Por favor responde con: precio unitario, disponibilidad y tiempo de entrega.');
  if (rfqId) {
    lines.push('');
    lines.push(`Ref: ${rfqId}`);
  }
  lines.push('');
  lines.push('— Aurora (gestión agrícola)');

  const out = lines.join('\n');
  return out.length > MAX_MESSAGE ? out.slice(0, MAX_MESSAGE - 1) + '…' : out;
}

function trunc(value, max) {
  const s = typeof value === 'string' ? value : '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

module.exports = {
  buildRfqMessage,
  MAX_MESSAGE,
};
