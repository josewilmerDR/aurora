// Agregación de costos por lote/grupo/bloque — versión simplificada de la
// lógica de `routes/costos.js` /live, sin desglose por categoría.
//
// Esta función produce totales de costo + kg por nivel jerárquico (lote,
// grupo, bloque). Es consumida por el endpoint de ROI. La versión con
// desglose de categorías vive en costos.js y no se toca.
//
// La lógica de asignación replica la de costos.js:
//   - Combustible + depreciación: desde horimetro, prorrateados por área de
//     bloque si la tarea toca varios bloques.
//   - Planilla directa: desde hr_planilla_unidad_historial por loteNombre.
//   - Insumos: desde cédulas aplicadas (snap_productos * precio),
//     prorrateados por área de bloque.
//   - Indirectos: costos_indirectos + hr_planilla_fijo, distribuidos por
//     hectáreas entre todos los lotes.
//   - Producción (kg): desde cosecha_registros.

const { db } = require('../firebase');

// ─── Helpers puros ─────────────────────────────────────────────────────────

function depPerHora(asset) {
  if (!asset) return 0;
  const a = parseFloat(asset.valorAdquisicion);
  const r = parseFloat(asset.valorResidual);
  const h = parseFloat(asset.vidaUtilHoras);
  return (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) ? (a - r) / h : 0;
}

function horasFromRec(rec) {
  const i = parseFloat(rec.horimetroInicial);
  const f = parseFloat(rec.horimetroFinal);
  return (!isNaN(i) && !isNaN(f) && f >= i) ? f - i : 0;
}

function round2(n) { return parseFloat(n.toFixed(2)); }

// ─── Agregación principal ──────────────────────────────────────────────────

async function computeLoteCostTotals(fincaId, { desde, hasta }) {
  const [horSnap, planHistSnap, planFijoSnap, cedulasSnap, cosechaSnap, lotesSnap, maqSnap, prodSnap, indSnap, siembrasSnap] = await Promise.all([
    db.collection('horimetro').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_unidad_historial').where('fincaId', '==', fincaId).get(),
    db.collection('hr_planilla_fijo').where('fincaId', '==', fincaId).get(),
    db.collection('cedulas').where('fincaId', '==', fincaId).get(),
    db.collection('cosecha_registros').where('fincaId', '==', fincaId).get(),
    db.collection('lotes').where('fincaId', '==', fincaId).get(),
    db.collection('maquinaria').where('fincaId', '==', fincaId).get(),
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    db.collection('costos_indirectos').where('fincaId', '==', fincaId).get(),
    db.collection('siembras').where('fincaId', '==', fincaId).get(),
  ]);

  const maqMap = {};
  maqSnap.docs.forEach(d => { maqMap[d.id] = d.data(); });

  const prodMap = {};
  prodSnap.docs.forEach(d => { prodMap[d.id] = d.data(); });

  const lotesMap = {};
  let totalAreaFinca = 0;
  lotesSnap.docs.forEach(d => {
    const data = d.data();
    const ha = parseFloat(data.hectareas) || 0;
    lotesMap[d.id] = { nombre: data.nombreLote || d.id, hectareas: ha };
    totalAreaFinca += ha;
  });

  const siembrasMap = {};
  siembrasSnap.docs.forEach(d => {
    const data = d.data();
    siembrasMap[d.id] = { loteId: data.loteId, bloque: data.bloque, area: parseFloat(data.areaCalculada) || 0 };
  });

  // Acumulador: loteId → { nombre, ha, grupos: { grupo → { bloques: { bloqueKey → { cost, kg } } } } }
  const acc = {};
  function ensure(loteId, loteNombre, grupo, bloqueKey) {
    if (!acc[loteId]) acc[loteId] = { nombre: loteNombre || lotesMap[loteId]?.nombre || loteId, ha: lotesMap[loteId]?.hectareas || 0, grupos: {} };
    const g = grupo || '_sin_grupo';
    if (!acc[loteId].grupos[g]) acc[loteId].grupos[g] = { bloques: {} };
    const bk = bloqueKey || '_sin_bloque';
    if (!acc[loteId].grupos[g].bloques[bk]) acc[loteId].grupos[g].bloques[bk] = { cost: 0, kg: 0 };
    return acc[loteId].grupos[g].bloques[bk];
  }

  // 1. Combustible + depreciación (horímetro).
  horSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = rec.fecha || '';
    if (fecha < desde || fecha > hasta) return;
    if (!rec.loteId) return;
    const hours = horasFromRec(rec);
    const fuelCost = parseFloat(rec.combustible?.costoEstimado) || 0;
    const depTotal = hours * (depPerHora(maqMap[rec.tractorId]) + depPerHora(maqMap[rec.implementoId]));
    const costEvent = fuelCost + depTotal;

    const bloques = Array.isArray(rec.bloques) && rec.bloques.length > 0 ? rec.bloques : null;
    if (bloques) {
      let totalArea = 0;
      const bloqueAreas = bloques.map(bId => {
        const area = siembrasMap[bId]?.area || 0;
        totalArea += area;
        return { id: bId, area };
      });
      bloqueAreas.forEach(({ id: bId, area }) => {
        const ratio = totalArea > 0 ? area / totalArea : 1 / bloques.length;
        ensure(rec.loteId, rec.loteNombre, rec.grupo, bId).cost += costEvent * ratio;
      });
    } else {
      ensure(rec.loteId, rec.loteNombre, rec.grupo, null).cost += costEvent;
    }
  });

  // 2. Planilla directa.
  planHistSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = rec.fecha?.toDate?.()?.toISOString?.()?.split('T')[0] || rec.fecha || '';
    if (fecha < desde || fecha > hasta) return;
    const total = parseFloat(rec.totalGeneral) || 0;
    if (!total) return;
    const loteNombre = rec.loteNombre || '';
    let loteId = null;
    for (const [id, info] of Object.entries(lotesMap)) {
      if (info.nombre === loteNombre) { loteId = id; break; }
    }
    if (!loteId) loteId = loteNombre || '_sin_lote';
    ensure(loteId, loteNombre, rec.grupo || null, null).cost += total;
  });

  // 3. Insumos (cédulas aplicadas).
  cedulasSnap.docs.forEach(d => {
    const rec = d.data();
    if (rec.status !== 'aplicada_en_campo') return;
    const fecha = rec.aplicadaAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '';
    if (fecha < desde || fecha > hasta) return;

    const productos = rec.snap_productos || [];
    let totalCost = 0;
    productos.forEach(p => {
      const quantity = parseFloat(p.total) || 0;
      const price = parseFloat(p.precioUnitario) || parseFloat(prodMap[p.productoId]?.precioUnitario) || 0;
      totalCost += quantity * price;
    });
    if (!totalCost) return;

    const bloques = rec.snap_bloques || [];
    if (bloques.length > 0) {
      let totalArea = 0;
      const bloqueAreas = bloques.map(b => {
        const area = parseFloat(b.areaCalculada) || siembrasMap[b.id]?.area || 0;
        totalArea += area;
        return { id: b.id, loteNombre: b.loteNombre, area };
      });
      bloqueAreas.forEach(({ id: bId, loteNombre, area }) => {
        const ratio = totalArea > 0 ? area / totalArea : 1 / bloques.length;
        let loteId = siembrasMap[bId]?.loteId || null;
        if (!loteId) {
          for (const [id, info] of Object.entries(lotesMap)) {
            if (info.nombre === loteNombre) { loteId = id; break; }
          }
        }
        loteId = loteId || loteNombre || '_sin_lote';
        ensure(loteId, loteNombre, rec.snap_grupo || null, bId).cost += totalCost * ratio;
      });
    } else {
      const loteNombre = rec.splitLoteNombre || rec.snap_loteNombre || '_sin_lote';
      let loteId = null;
      for (const [id, info] of Object.entries(lotesMap)) {
        if (info.nombre === loteNombre) { loteId = id; break; }
      }
      loteId = loteId || loteNombre;
      ensure(loteId, loteNombre, rec.snap_grupo || null, null).cost += totalCost;
    }
  });

  // 4. Producción (kg).
  cosechaSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = rec.fecha || '';
    if (fecha < desde || fecha > hasta) return;
    const kg = parseFloat(rec.cantidad) || 0;
    if (!kg || !rec.loteId) return;
    ensure(rec.loteId, rec.loteNombre, rec.grupo || null, rec.bloqueId || null).kg += kg;
  });

  // 5. Indirectos (manuales + planilla fija), distribuidos por hectáreas.
  let totalIndirectosManuales = 0;
  indSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = rec.fecha || '';
    if (fecha < desde || fecha > hasta) return;
    totalIndirectosManuales += parseFloat(rec.monto) || 0;
  });

  let totalPlanillaFija = 0;
  planFijoSnap.docs.forEach(d => {
    const rec = d.data();
    const fecha = rec.periodoInicio?.toDate?.()?.toISOString?.()?.split('T')[0] || '';
    if (fecha < desde || fecha > hasta) return;
    totalPlanillaFija += parseFloat(rec.totalGeneral) || 0;
  });

  const totalIndirectos = totalIndirectosManuales + totalPlanillaFija;

  if (totalIndirectos > 0 && totalAreaFinca > 0) {
    for (const [loteId, loteData] of Object.entries(acc)) {
      const indirectoLote = totalIndirectos * (loteData.ha / totalAreaFinca);
      const allBuckets = [];
      for (const gData of Object.values(loteData.grupos)) {
        for (const b of Object.values(gData.bloques)) allBuckets.push(b);
      }
      if (allBuckets.length > 0) {
        const perBucket = indirectoLote / allBuckets.length;
        allBuckets.forEach(b => { b.cost += perBucket; });
      } else {
        ensure(loteId, loteData.nombre, null, null).cost += indirectoLote;
      }
    }
    for (const [loteId, info] of Object.entries(lotesMap)) {
      if (!acc[loteId] && info.hectareas > 0) {
        const ratio = info.hectareas / totalAreaFinca;
        ensure(loteId, info.nombre, null, null).cost += totalIndirectos * ratio;
      }
    }
  }

  // ─── Rollup por niveles ────────────────────────────────────────────────
  const porBloque = [];
  const porGrupo = [];
  const porLote = [];
  let totalCost = 0, totalKg = 0;

  for (const [loteId, loteData] of Object.entries(acc)) {
    let loteCost = 0, loteKg = 0;
    for (const [grupoName, gData] of Object.entries(loteData.grupos)) {
      let grupoCost = 0, grupoKg = 0;
      for (const [bloqueKey, b] of Object.entries(gData.bloques)) {
        grupoCost += b.cost;
        grupoKg += b.kg;
        if (bloqueKey !== '_sin_bloque') {
          porBloque.push({
            loteId,
            loteNombre: loteData.nombre,
            grupo: grupoName !== '_sin_grupo' ? grupoName : null,
            bloqueId: bloqueKey,
            bloque: siembrasMap[bloqueKey]?.bloque || bloqueKey,
            cost: round2(b.cost),
            kg: round2(b.kg),
          });
        }
      }
      loteCost += grupoCost;
      loteKg += grupoKg;
      if (grupoName !== '_sin_grupo') {
        porGrupo.push({
          loteId,
          loteNombre: loteData.nombre,
          grupo: grupoName,
          cost: round2(grupoCost),
          kg: round2(grupoKg),
        });
      }
    }
    totalCost += loteCost;
    totalKg += loteKg;
    porLote.push({
      loteId,
      loteNombre: loteData.nombre,
      hectareas: loteData.ha,
      cost: round2(loteCost),
      kg: round2(loteKg),
    });
  }

  return {
    resumen: { cost: round2(totalCost), kg: round2(totalKg) },
    porLote,
    porGrupo,
    porBloque,
  };
}

module.exports = { computeLoteCostTotals };
