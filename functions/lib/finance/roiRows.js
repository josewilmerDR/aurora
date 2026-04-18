// Combinación pura de costos + ingresos → filas de ROI. Sin Firestore.
//
// Entradas:
//   - costTotals: salida de `loteCostTotals.computeLoteCostTotals`
//       { resumen: {cost, kg}, porLote[], porGrupo[], porBloque[] }
//   - incomePerLote: { [loteId]: montoTotal } — ya atribuido/prorrateado
//
// Salida:
//   { resumen, porLote[], porGrupo[], porBloque[] } con columnas de ROI.

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function marginPct(margen, costos) {
  if (!Number.isFinite(costos) || costos <= 0) return null;
  return round2((margen / costos) * 100);
}

function precioPromedio(ingresos, kg) {
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return round2(ingresos / kg);
}

function costoPorKg(costos, kg) {
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return round2(costos / kg);
}

// Construye una fila ROI. El `key` es solo para ordenamiento/lookup y no
// aparece en la salida — se eliminan las claves de identidad del row origen.
function buildRow(row, ingresos) {
  const costos = Number(row.cost) || 0;
  const kg = Number(row.kg) || 0;
  const ing = Number(ingresos) || 0;
  const margen = ing - costos;
  return {
    ...row,
    // Renombramos `cost` → `costos` para claridad en la capa ROI.
    cost: undefined,
    costos: round2(costos),
    ingresos: round2(ing),
    margen: round2(margen),
    margenPct: marginPct(margen, costos),
    kg: round2(kg),
    precioPromedio: precioPromedio(ing, kg),
    costoPorKg: costoPorKg(costos, kg),
  };
}

// El ingreso a nivel grupo/bloque lo derivamos del lote al que pertenecen,
// repartiendo proporcional al kg cosechado (mismo principio que el prorrateo
// del prorateByKg). Si el lote no cosechó en el período, el ingreso del lote
// se queda a nivel lote y los grupos/bloques muestran 0.
function distributeByKg(totalIncome, children) {
  if (!Number.isFinite(totalIncome) || totalIncome <= 0 || !Array.isArray(children) || children.length === 0) {
    return new Map();
  }
  const totalKg = children.reduce((s, c) => s + (Number(c.kg) || 0), 0);
  const out = new Map();
  if (totalKg <= 0) return out;
  for (const c of children) {
    const kg = Number(c.kg) || 0;
    out.set(c, (kg / totalKg) * totalIncome);
  }
  return out;
}

function buildRoiReport(costTotals, incomePerLote = {}) {
  const cost = costTotals || { resumen: { cost: 0, kg: 0 }, porLote: [], porGrupo: [], porBloque: [] };

  // Índices para repartir ingreso del lote entre sus grupos y bloques.
  const grupoByLote = {};
  for (const g of cost.porGrupo || []) {
    if (!grupoByLote[g.loteId]) grupoByLote[g.loteId] = [];
    grupoByLote[g.loteId].push(g);
  }
  const bloqueByLote = {};
  for (const b of cost.porBloque || []) {
    if (!bloqueByLote[b.loteId]) bloqueByLote[b.loteId] = [];
    bloqueByLote[b.loteId].push(b);
  }

  // 1. porLote
  const loteIdsFromCost = new Set((cost.porLote || []).map(l => l.loteId));
  const loteIdsFromIncome = Object.keys(incomePerLote);
  // Lotes con ingreso pero sin costo registrado: creamos filas sintéticas.
  const porLote = (cost.porLote || []).slice();
  for (const id of loteIdsFromIncome) {
    if (!loteIdsFromCost.has(id)) {
      porLote.push({ loteId: id, loteNombre: id, hectareas: 0, cost: 0, kg: 0 });
    }
  }
  const porLoteRoi = porLote.map(row => buildRow(row, incomePerLote[row.loteId] || 0));
  porLoteRoi.sort((a, b) => b.margen - a.margen);

  // 2. porGrupo — ingreso del grupo = proporción kg del grupo / kg total del lote × ingreso del lote
  const porGrupoRoi = (cost.porGrupo || []).map(g => {
    const loteIncome = incomePerLote[g.loteId] || 0;
    const children = grupoByLote[g.loteId] || [];
    const dist = distributeByKg(loteIncome, children);
    const ingresos = dist.get(g) || 0;
    return buildRow(g, ingresos);
  });
  porGrupoRoi.sort((a, b) => b.margen - a.margen);

  // 3. porBloque — mismo principio dentro del lote.
  const porBloqueRoi = (cost.porBloque || []).map(b => {
    const loteIncome = incomePerLote[b.loteId] || 0;
    const children = bloqueByLote[b.loteId] || [];
    const dist = distributeByKg(loteIncome, children);
    const ingresos = dist.get(b) || 0;
    return buildRow(b, ingresos);
  });
  porBloqueRoi.sort((a, b) => b.margen - a.margen);

  // 4. Resumen
  const totalIngresos = porLoteRoi.reduce((s, r) => s + r.ingresos, 0);
  const totalCostos = Number(cost.resumen?.cost) || 0;
  const totalKg = Number(cost.resumen?.kg) || 0;
  const margen = totalIngresos - totalCostos;

  return {
    resumen: {
      ingresos: round2(totalIngresos),
      costos: round2(totalCostos),
      margen: round2(margen),
      margenPct: marginPct(margen, totalCostos),
      kg: round2(totalKg),
      precioPromedio: precioPromedio(totalIngresos, totalKg),
      costoPorKg: costoPorKg(totalCostos, totalKg),
    },
    porLote: porLoteRoi,
    porGrupo: porGrupoRoi,
    porBloque: porBloqueRoi,
  };
}

module.exports = {
  buildRoiReport,
  // Expuesto para tests unitarios.
  _internals: { buildRow, distributeByKg, marginPct, precioPromedio, costoPorKg },
};
