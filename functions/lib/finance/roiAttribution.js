// Atribución pura de ingresos a lotes. Sin Firestore.
//
// Prioridad de atribución por cada income_record:
//   1. `loteId` explícito → ese lote.
//   2. `despachoId` → lote del despacho (vía despachoToLoteMap).
//   3. Sin referencia → se marca como "unattributed" para prorrateo posterior.
//
// Registros con `collectionStatus === 'anulado'` se ignoran completamente
// (no son ingresos reales). Registros con monto ≤ 0 también se ignoran.

function attributeIncome(incomeRecords, despachoToLoteMap = {}) {
  const perLote = {};
  let unattributedAmount = 0;
  const unattributedRecords = [];

  for (const rec of incomeRecords) {
    if (rec?.collectionStatus === 'anulado') continue;
    const amount = Number(rec?.totalAmount) || 0;
    if (amount <= 0) continue;

    let loteId = typeof rec.loteId === 'string' && rec.loteId ? rec.loteId : null;
    if (!loteId && rec.despachoId) {
      loteId = despachoToLoteMap[rec.despachoId] || null;
    }

    if (loteId) {
      perLote[loteId] = (perLote[loteId] || 0) + amount;
    } else {
      unattributedAmount += amount;
      unattributedRecords.push(rec);
    }
  }

  return { perLote, unattributedAmount, unattributedRecords };
}

// Distribuye `amount` entre lotes proporcional a `kgByLote`. Si la suma de
// kg es 0, se devuelve `{}` (no se puede prorratear sin kg de referencia).
function prorateByKg(amount, kgByLote) {
  if (!Number.isFinite(Number(amount)) || amount <= 0) return {};
  const entries = Object.entries(kgByLote || {}).filter(([, kg]) => Number(kg) > 0);
  const totalKg = entries.reduce((s, [, kg]) => s + Number(kg), 0);
  if (totalKg <= 0) return {};
  const out = {};
  for (const [loteId, kg] of entries) {
    out[loteId] = (Number(kg) / totalKg) * amount;
  }
  return out;
}

// Suma dos mapas `{ loteId: amount }` en uno nuevo.
function mergeLoteAmounts(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] || 0) + v;
  }
  return out;
}

// Construye el mapa despachoId → loteId desde docs de despachos.
function buildDespachoToLoteMap(despachoDocs) {
  const map = {};
  for (const d of despachoDocs || []) {
    if (d?.id && d?.loteId) map[d.id] = d.loteId;
  }
  return map;
}

module.exports = {
  attributeIncome,
  prorateByKg,
  mergeLoteAmounts,
  buildDespachoToLoteMap,
};
