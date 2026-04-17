// Suma los costos ejecutados de la finca dentro de un rango [from, to], agrupados
// por categoría de budget. Versión simplificada de la agregación de costos.js:
// solo totales por categoría, sin jerarquía lote/grupo/bloque.
//
// Emite un objeto con keys de BUDGET_CATEGORIES y valores numéricos (montos).

const { db } = require('../firebase');

// Depreciación por hora para un activo de maquinaria.
function depPerHour(asset) {
  if (!asset) return 0;
  const a = parseFloat(asset.valorAdquisicion);
  const r = parseFloat(asset.valorResidual);
  const h = parseFloat(asset.vidaUtilHoras);
  return (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) ? (a - r) / h : 0;
}

function hoursFromRecord(rec) {
  const i = parseFloat(rec.horimetroInicial);
  const f = parseFloat(rec.horimetroFinal);
  return (!isNaN(i) && !isNaN(f) && f >= i) ? f - i : 0;
}

// Devuelve la fecha YYYY-MM-DD desde un Timestamp o string.
function toISODate(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v.toDate === 'function') {
    return v.toDate().toISOString().slice(0, 10);
  }
  return '';
}

function inRange(fecha, from, to) {
  return fecha >= from && fecha <= to;
}

async function computePeriodCosts(fincaId, { from, to }) {
  const [horSnap, planUnidadSnap, planFijoSnap, cedulasSnap, maqSnap, prodSnap, indSnap] = await Promise.all([
    db.collection('horimetro').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_unidad_historial').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_fijo').where('fincaId', '==', fincaId).get(),
    db.collection('cedulas').where('fincaId', '==', fincaId).get(),
    db.collection('maquinaria').where('fincaId', '==', fincaId).get(),
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    db.collection('costos_indirectos').where('fincaId', '==', fincaId).get(),
  ]);

  // Lookup maps.
  const maqMap = {};
  maqSnap.docs.forEach(d => { maqMap[d.id] = d.data(); });
  const prodMap = {};
  prodSnap.docs.forEach(d => { prodMap[d.id] = d.data(); });

  const totals = {
    combustible: 0,
    depreciacion: 0,
    planilla_directa: 0,
    planilla_fija: 0,
    insumos: 0,
    mantenimiento: 0,
    administrativo: 0,
    otro: 0,
  };

  // 1) Combustible + depreciación desde horímetro.
  horSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) return;
    const hours = hoursFromRecord(rec);
    totals.combustible += parseFloat(rec.combustible?.costoEstimado) || 0;
    totals.depreciacion += hours * depPerHour(maqMap[rec.tractorId]);
    totals.depreciacion += hours * depPerHour(maqMap[rec.implementoId]);
  });

  // 2) Planilla directa (por unidad).
  planUnidadSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) return;
    totals.planilla_directa += parseFloat(rec.totalGeneral) || 0;
  });

  // 3) Planilla fija (categorizada como indirecto en costos.js, pero aquí
  //    la separamos porque el budget la trata como su propia categoría).
  planFijoSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = toISODate(rec.periodoInicio);
    if (!inRange(fecha, from, to)) return;
    totals.planilla_fija += parseFloat(rec.totalGeneral) || 0;
  });

  // 4) Insumos (cédulas aplicadas).
  cedulasSnap.docs.forEach(d => {
    const rec = d.data();
    if (rec.status !== 'aplicada_en_campo') return;
    const fecha = toISODate(rec.aplicadaAt);
    if (!inRange(fecha, from, to)) return;

    const productos = rec.snap_productos || [];
    productos.forEach(p => {
      const quantity = parseFloat(p.total) || 0;
      const price = parseFloat(p.precioUnitario)
        || parseFloat(prodMap[p.productoId]?.precioUnitario)
        || 0;
      totals.insumos += quantity * price;
    });
  });

  // 5) Costos indirectos manuales — por sub-categoría.
  indSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = toISODate(rec.fecha);
    if (!inRange(fecha, from, to)) return;
    const cat = rec.categoria || 'otro';
    const amount = parseFloat(rec.monto) || 0;
    if (totals[cat] !== undefined) totals[cat] += amount;
    else totals.otro += amount;
  });

  return totals;
}

module.exports = {
  computePeriodCosts,
  // exports para tests unitarios
  _internals: { depPerHour, hoursFromRecord, toISODate, inRange },
};
