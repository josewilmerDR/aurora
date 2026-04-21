// Colecta los eventos (inflow/outflow) que alimentan la proyección de caja.
// Separado de projection.js para que la lógica de Firestore viva en un
// archivo y la lógica pura en otro.

const { db } = require('../firebase');
const { parseISO, toISO, addDays } = require('./weekRanges');

// Formato de evento (ver projection.js):
//   { date, amount, type, source, label }

// ───────────────────────────────────────────────────────────────────────────
// Fuentes individuales
// ───────────────────────────────────────────────────────────────────────────

// Ingresos pendientes de cobro, dentro del horizonte.
// Usa `totalAmountCRC` si está presente (registros nuevos); fallback a
// `totalAmount` para legacy.
async function fetchIncomeInflows(fincaId, { fromISO, toISO: toStr }) {
  const snap = await db.collection('income_records')
    .where('fincaId', '==', fincaId)
    .where('collectionStatus', '==', 'pendiente')
    .get();

  const events = [];
  for (const doc of snap.docs) {
    const rec = doc.data();
    const date = rec.expectedCollectionDate || rec.date;
    if (!date || date < fromISO || date > toStr) continue;
    const amountCRC = Number.isFinite(Number(rec.totalAmountCRC))
      ? Number(rec.totalAmountCRC)
      : Number(rec.totalAmount) || 0;
    events.push({
      date,
      amount: amountCRC,
      type: 'inflow',
      source: 'income',
      label: rec.buyerName ? `Cobro — ${rec.buyerName}` : 'Cobro pendiente',
    });
  }
  return events;
}

// OCs no pagadas/canceladas → salida en `fechaEntrega + diasCredito`.
async function fetchPurchaseOrderOutflows(fincaId, { fromISO, toISO: toStr }) {
  const [ocSnap, provSnap] = await Promise.all([
    db.collection('ordenes_compra').where('fincaId', '==', fincaId).get(),
    db.collection('proveedores').where('fincaId', '==', fincaId).get(),
  ]);

  const supplierMap = {};
  provSnap.docs.forEach(d => { supplierMap[d.id] = d.data(); });

  const events = [];
  for (const doc of ocSnap.docs) {
    const oc = doc.data();
    const estado = oc.estado || '';
    // Solo OCs que todavía representan una obligación de pago futura.
    if (['pagada', 'cancelada', 'anulada'].includes(estado)) continue;

    const deliveryISO = oc.fechaEntrega;
    if (!deliveryISO) continue;

    // Intento resolver proveedor por ID; si no, asumimos contado (0 días).
    const prov = (oc.proveedor && typeof oc.proveedor === 'object' && oc.proveedor.id)
      ? supplierMap[oc.proveedor.id]
      : null;
    const creditDays = prov?.tipoPago === 'credito' ? (Number(prov.diasCredito) || 30) : 0;

    const delivery = parseISO(deliveryISO);
    if (!delivery) continue;
    const paymentDt = addDays(delivery, creditDays);
    const paymentISO = toISO(paymentDt);
    if (paymentISO < fromISO || paymentISO > toStr) continue;

    // Monto total en CRC: usa `totalCRC` si existe (OCs nuevas con FX
    // congelado); si no, suma items × precioUnitario (legacy, asume CRC).
    let totalCRC;
    if (Number.isFinite(Number(oc.totalCRC))) {
      totalCRC = Number(oc.totalCRC);
    } else {
      const items = Array.isArray(oc.items) ? oc.items : [];
      const fx = Number.isFinite(Number(oc.exchangeRateToCRC)) ? Number(oc.exchangeRateToCRC) : 1;
      totalCRC = items.reduce((s, it) => {
        const qty = Number(it.cantidad) || 0;
        const price = Number(it.precioUnitario) || 0;
        const moneda = (typeof it.moneda === 'string' ? it.moneda.toUpperCase() : 'CRC');
        const line = qty * price;
        return s + (moneda !== 'CRC' ? line * fx : line);
      }, 0);
    }
    if (totalCRC <= 0) continue;

    events.push({
      date: paymentISO,
      amount: totalCRC,
      type: 'outflow',
      source: 'ordenes_compra',
      label: oc.poNumber ? `OC ${oc.poNumber}` : 'OC pendiente',
    });
  }
  return events;
}

// Planilla fija — se asume recurrencia mensual. Tomamos la entrada más
// reciente y la proyectamos mes a mes en el mismo día del mes.
async function fetchFixedPayrollOutflows(fincaId, { fromISO, toISO: toStr }) {
  const snap = await db.collection('hr_planilla_fijo')
    .where('fincaId', '==', fincaId)
    .get();

  if (snap.empty) return [];

  // Última entrada por periodoInicio.
  const docs = snap.docs.map(d => d.data());
  docs.sort((a, b) => toDateValue(b.periodoInicio) - toDateValue(a.periodoInicio));
  const latest = docs[0];
  const total = Number(latest.totalGeneral) || 0;
  if (total <= 0) return [];

  const latestDt = toDateSafe(latest.periodoInicio);
  if (!latestDt) return [];
  const payDay = latestDt.getUTCDate();

  const from = parseISO(fromISO);
  const to = parseISO(toStr);
  if (!from || !to) return [];

  const events = [];
  // Iteramos mes a mes desde el mes de `from` hasta el mes de `to`.
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  const endMarker = to.getUTCFullYear() * 12 + to.getUTCMonth();
  while ((year * 12 + month) <= endMarker) {
    // Si `payDay` excede los días del mes, caemos al último día.
    const lastDom = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(payDay, lastDom);
    const eventDt = new Date(Date.UTC(year, month, day));
    const eventISO = toISO(eventDt);
    if (eventISO >= fromISO && eventISO <= toStr) {
      events.push({
        date: eventISO,
        amount: total,
        type: 'outflow',
        source: 'planilla_fija',
        label: 'Planilla fija mensual',
      });
    }
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return events;
}

// Planilla por unidad (directa) — proyección ingenua: promedio semanal de las
// últimas 4 semanas, replicado cada lunes del horizonte.
async function fetchUnitPayrollOutflows(fincaId, { fromISO, toISO: toStr }) {
  const snap = await db.collection('hr_planilla_unidad_historial')
    .where('fincaId', '==', fincaId)
    .get();

  if (snap.empty) return [];

  // Tomamos las entradas de las últimas 28 días para estimar un promedio
  // semanal, usando la fecha del sistema (no `fromISO`, que puede estar en
  // el futuro).
  const todayDt = new Date();
  const todayISO = todayDt.toISOString().slice(0, 10);
  const cutoffDt = addDays(todayDt, -28);
  const cutoffISO = toISO(cutoffDt);

  let totalRecent = 0;
  for (const doc of snap.docs) {
    const rec = doc.data();
    const fecha = toDateSafeISO(rec.fecha);
    if (!fecha) continue;
    if (fecha < cutoffISO || fecha > todayISO) continue;
    totalRecent += Number(rec.totalGeneral) || 0;
  }
  if (totalRecent <= 0) return [];

  const weeklyAvg = totalRecent / 4;

  // Emitimos un evento por cada lunes dentro del horizonte.
  const events = [];
  const from = parseISO(fromISO);
  const to = parseISO(toStr);
  if (!from || !to) return [];
  let cursor = new Date(from.getTime());
  // Avanzamos al próximo lunes (o nos quedamos si ya lo es).
  const dow = cursor.getUTCDay();
  const diffToMonday = dow === 0 ? 1 : (dow === 1 ? 0 : 8 - dow);
  cursor.setUTCDate(cursor.getUTCDate() + diffToMonday);
  while (cursor <= to) {
    events.push({
      date: toISO(cursor),
      amount: weeklyAvg,
      type: 'outflow',
      source: 'planilla_unidad',
      label: 'Planilla por unidad (estimada)',
    });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return events;
}

// Último saldo de caja registrado ≤ fecha de referencia.
// El saldo se expresa en CRC (moneda funcional). Registros nuevos traen
// `amountCRC` pre-calculado; legacy sin ese campo caen al `amount` raw.
async function fetchLatestCashBalance(fincaId) {
  const snap = await db.collection('cash_balance')
    .where('fincaId', '==', fincaId)
    .get();
  if (snap.empty) return null;
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => (b.dateAsOf || '').localeCompare(a.dateAsOf || ''));
  const latest = docs[0];
  const amount = Number.isFinite(Number(latest.amountCRC)) ? Number(latest.amountCRC) : Number(latest.amount);
  return { ...latest, amount, currency: 'CRC' };
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function toDateValue(v) {
  const d = toDateSafe(v);
  return d ? d.getTime() : 0;
}

function toDateSafe(v) {
  if (!v) return null;
  if (typeof v === 'string') return parseISO(v.slice(0, 10));
  if (typeof v.toDate === 'function') return v.toDate();
  return null;
}

function toDateSafeISO(v) {
  const d = toDateSafe(v);
  return d ? toISO(d) : null;
}

// Agrega todas las fuentes en un solo arreglo de eventos.
async function collectProjectionEvents(fincaId, { fromISO, toISO: toStr }) {
  const [a, b, c, d] = await Promise.all([
    fetchIncomeInflows(fincaId, { fromISO, toISO: toStr }),
    fetchPurchaseOrderOutflows(fincaId, { fromISO, toISO: toStr }),
    fetchFixedPayrollOutflows(fincaId, { fromISO, toISO: toStr }),
    fetchUnitPayrollOutflows(fincaId, { fromISO, toISO: toStr }),
  ]);
  return [...a, ...b, ...c, ...d];
}

module.exports = {
  fetchIncomeInflows,
  fetchPurchaseOrderOutflows,
  fetchFixedPayrollOutflows,
  fetchUnitPayrollOutflows,
  fetchLatestCashBalance,
  collectProjectionEvents,
};
