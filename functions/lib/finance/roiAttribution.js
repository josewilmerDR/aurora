// Atribución pura de ingresos a lotes. Sin Firestore.
//
// Prioridad de atribución por cada income_record:
//   1. `loteId` explícito → ese lote.
//   2. `despachoIds[]` → lotes de cada despacho, prorrateado por cantidad.
//   3. `despachoId` (legacy) → lote del despacho (vía despachoToLoteMap).
//   4. Sin referencia → se marca como "unattributed" para prorrateo posterior.
//
// Registros con `collectionStatus === 'anulado'` se ignoran completamente
// (no son ingresos reales). Registros con monto ≤ 0 también se ignoran.

function attributeFromDispatches(amount, despachoIds, despachoToLoteMap) {
  const weights = {};
  let totalWeight = 0;
  let unknownCount = 0;
  for (const item of despachoIds) {
    const lote = despachoToLoteMap[item?.id];
    if (!lote) { unknownCount += 1; continue; }
    const w = Number(item?.cantidad) > 0 ? Number(item.cantidad) : 1;
    weights[lote] = (weights[lote] || 0) + w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return { perLote: {}, unattributed: amount };
  const perLote = {};
  for (const [lote, w] of Object.entries(weights)) {
    perLote[lote] = (w / totalWeight) * amount;
  }
  // Si algunos despachos no mapean, esa fracción se pierde en "unattributed".
  const knownFraction = totalWeight / (totalWeight + unknownCount);
  const unattributed = amount * (1 - knownFraction);
  return { perLote, unattributed };
}

function attributeIncome(incomeRecords, despachoToLoteMap = {}) {
  const perLote = {};
  let unattributedAmount = 0;
  const unattributedRecords = [];

  for (const rec of incomeRecords) {
    if (rec?.collectionStatus === 'anulado') continue;
    const amount = Number(rec?.totalAmount) || 0;
    if (amount <= 0) continue;

    const explicitLote = typeof rec.loteId === 'string' && rec.loteId ? rec.loteId : null;
    if (explicitLote) {
      perLote[explicitLote] = (perLote[explicitLote] || 0) + amount;
      continue;
    }

    if (Array.isArray(rec.despachoIds) && rec.despachoIds.length > 0) {
      const split = attributeFromDispatches(amount, rec.despachoIds, despachoToLoteMap);
      for (const [lote, val] of Object.entries(split.perLote)) {
        perLote[lote] = (perLote[lote] || 0) + val;
      }
      if (split.unattributed > 0) {
        unattributedAmount += split.unattributed;
        unattributedRecords.push(rec);
      }
      continue;
    }

    const legacyLote = rec.despachoId ? (despachoToLoteMap[rec.despachoId] || null) : null;
    if (legacyLote) {
      perLote[legacyLote] = (perLote[legacyLote] || 0) + amount;
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
