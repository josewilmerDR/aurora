// Agregador de rendimiento histórico.
//
// Cruza tres fuentes para producir filas con métricas físicas + económicas
// agrupadas por distintas dimensiones estratégicas:
//   - lote      → una fila por lote activo con cosecha en rango
//   - paquete   → agrega los lotes que comparten paqueteId
//   - cultivo   → agrega por `packages.tipoCosecha`
//   - temporada → una fila por temporada (documento en `temporadas`) cuya
//                 ventana [fechaInicio, fechaFin] intersecte [desde, hasta].
//                 Cada temporada se evalúa con su propia ventana (intersección),
//                 no con el rango global del query — así no se mezclan
//                 cosechas de distintas temporadas aunque el usuario consulte
//                 un rango amplio.
//
// Métricas devueltas por fila:
//   kg, hectareas, kgPorHa, ingreso, ingresoPorHa, costo, costoPorHa,
//   margen, margenPorHa, margenPct, diasCiclo, nAplicaciones, nCosechas
//
// Reuso:
//   - `computeLoteCostTotals` para costos y kg por lote.
//   - `attributeIncome` + `prorateByKg` + `mergeLoteAmounts` +
//     `buildDespachoToLoteMap` para ingresos por lote (misma lógica que ROI).
//
// Observaciones:
//   - `nAplicaciones` cuenta documentos `cedulas` aplicadas cuyo snapshot
//     toca un lote del bucket dentro del rango. Es el mismo criterio de
//     atribución que `loteCostTotals.js`.
//   - `diasCiclo` se calcula como `ultimaCosecha - primeraCosecha` dentro del
//     bucket, en días. Es una proxy simple; refinar en fases posteriores
//     cuando siembra/cosecha estén 100% trazadas.
//   - Filas con hectáreas 0 emiten `*PorHa = null` para no dividir por cero.

const { db } = require('../firebase');
const { computeLoteCostTotals } = require('../finance/loteCostTotals');
const {
  attributeIncome,
  prorateByKg,
  mergeLoteAmounts,
  buildDespachoToLoteMap,
} = require('../finance/roiAttribution');

// ─── Helpers puros ─────────────────────────────────────────────────────────

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

function perHa(value, hectareas) {
  if (!Number.isFinite(value)) return null;
  if (!Number.isFinite(hectareas) || hectareas <= 0) return null;
  return round2(value / hectareas);
}

function marginPct(margen, ingreso) {
  if (!Number.isFinite(ingreso) || ingreso <= 0) return null;
  return round2((margen / ingreso) * 100);
}

function daysBetweenIso(a, b) {
  if (!a || !b) return null;
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  const ta = Date.UTC(ya, ma - 1, da);
  const tb = Date.UTC(yb, mb - 1, db);
  return Math.round((tb - ta) / (1000 * 60 * 60 * 24));
}

function intersectRange(rangeA, rangeB) {
  const desde = rangeA.desde > rangeB.desde ? rangeA.desde : rangeB.desde;
  const hasta = rangeA.hasta < rangeB.hasta ? rangeA.hasta : rangeB.hasta;
  if (desde > hasta) return null;
  return { desde, hasta };
}

// ─── Fuentes de datos ──────────────────────────────────────────────────────

async function fetchIncomeInRange(fincaId, { desde, hasta }) {
  const snap = await db.collection('income_records')
    .where('fincaId', '==', fincaId)
    .where('date', '>=', desde)
    .where('date', '<=', hasta)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchAllDispatches(fincaId) {
  const snap = await db.collection('cosecha_despachos')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchLotes(fincaId) {
  const snap = await db.collection('lotes')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchPackages(fincaId) {
  const snap = await db.collection('packages')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchCosechaInRange(fincaId, { desde, hasta }) {
  // Sin filtro de fecha en el query: `cosecha_registros.fecha` es string
  // YYYY-MM-DD y el volumen esperado por finca es manejable en memoria
  // (mismo patrón que usa `loteCostTotals.js`). Cuando crezca mucho se puede
  // mover a `.where('fecha', ...)` sin romper el contrato.
  const snap = await db.collection('cosecha_registros')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => {
      const f = r.fecha || '';
      return f >= desde && f <= hasta;
    });
}

async function fetchCedulasInRange(fincaId, { desde, hasta }) {
  const snap = await db.collection('cedulas')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => {
      if (r.status !== 'aplicada_en_campo') return false;
      const iso = r.aplicadaAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '';
      return iso >= desde && iso <= hasta;
    });
}

async function fetchTemporadas(fincaId) {
  const snap = await db.collection('temporadas')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.status !== 'archived');
}

// ─── Núcleo: base por lote en un rango ─────────────────────────────────────
//
// Devuelve para un rango dado una base indexada por loteId con kg, costo,
// ingreso, hectáreas, primera/última cosecha y nAplicaciones. Todos los demás
// modos de agrupación se construyen a partir de esta base.

async function computeLoteBase(fincaId, { desde, hasta }, context) {
  const [costTotals, incomeRecords, cosechaRecords, cedulas] = await Promise.all([
    computeLoteCostTotals(fincaId, { desde, hasta }),
    fetchIncomeInRange(fincaId, { desde, hasta }),
    fetchCosechaInRange(fincaId, { desde, hasta }),
    fetchCedulasInRange(fincaId, { desde, hasta }),
  ]);

  const { despachoToLote, lotesById } = context;

  const { perLote: directPerLote, unattributedAmount } = attributeIncome(
    incomeRecords,
    despachoToLote,
  );
  const kgByLote = {};
  for (const l of costTotals.porLote) kgByLote[l.loteId] = l.kg;
  const proratedPerLote = prorateByKg(unattributedAmount, kgByLote);
  const incomePerLote = mergeLoteAmounts(directPerLote, proratedPerLote);

  // Inicializamos con los lotes que aparecen en costos.
  const base = {};
  for (const l of costTotals.porLote) {
    base[l.loteId] = {
      loteId: l.loteId,
      loteNombre: l.loteNombre || lotesById[l.loteId]?.nombreLote || l.loteId,
      hectareas: Number(l.hectareas) || Number(lotesById[l.loteId]?.hectareas) || 0,
      paqueteId: lotesById[l.loteId]?.paqueteId || null,
      kg: l.kg || 0,
      costo: l.cost || 0,
      ingreso: 0,
      primeraCosecha: null,
      ultimaCosecha: null,
      nAplicaciones: 0,
      nCosechas: 0,
    };
  }
  // Ingresos: añadimos al acumulador, creando entrada si el lote tuvo
  // ingreso sin costo registrado en el rango (caso raro pero posible).
  for (const [loteId, amount] of Object.entries(incomePerLote)) {
    if (!base[loteId]) {
      base[loteId] = {
        loteId,
        loteNombre: lotesById[loteId]?.nombreLote || loteId,
        hectareas: Number(lotesById[loteId]?.hectareas) || 0,
        paqueteId: lotesById[loteId]?.paqueteId || null,
        kg: 0,
        costo: 0,
        ingreso: 0,
        primeraCosecha: null,
        ultimaCosecha: null,
        nAplicaciones: 0,
        nCosechas: 0,
      };
    }
    base[loteId].ingreso += amount;
  }

  // Primera/última cosecha + conteo por lote.
  for (const rec of cosechaRecords) {
    const loteId = rec.loteId;
    if (!loteId || !base[loteId]) continue;
    const f = rec.fecha || '';
    if (!f) continue;
    base[loteId].nCosechas += 1;
    if (!base[loteId].primeraCosecha || f < base[loteId].primeraCosecha) {
      base[loteId].primeraCosecha = f;
    }
    if (!base[loteId].ultimaCosecha || f > base[loteId].ultimaCosecha) {
      base[loteId].ultimaCosecha = f;
    }
  }

  // nAplicaciones: 1 por cédula aplicada que toque el lote (vía snap_bloques
  // o splitLoteNombre/snap_loteNombre). Una cédula puede tocar varios lotes;
  // cuenta 1 por lote distinto.
  for (const ced of cedulas) {
    const lotesTocados = new Set();
    const bloques = Array.isArray(ced.snap_bloques) ? ced.snap_bloques : [];
    for (const b of bloques) {
      // Resolvemos loteId por nombre cuando el bloque sólo trae loteNombre.
      if (b.loteId && base[b.loteId]) {
        lotesTocados.add(b.loteId);
      } else if (b.loteNombre) {
        const match = Object.values(base).find(L => L.loteNombre === b.loteNombre);
        if (match) lotesTocados.add(match.loteId);
      }
    }
    if (lotesTocados.size === 0) {
      const loteNombre = ced.splitLoteNombre || ced.snap_loteNombre || '';
      if (loteNombre) {
        const match = Object.values(base).find(L => L.loteNombre === loteNombre);
        if (match) lotesTocados.add(match.loteId);
      }
    }
    for (const loteId of lotesTocados) {
      base[loteId].nAplicaciones += 1;
    }
  }

  return base;
}

// ─── Rollup: convierte un objeto de acumulador en una fila ─────────────────

function rowFromBucket(bucket) {
  const ingreso = round2(bucket.ingreso);
  const costo = round2(bucket.costo);
  const margen = round2(ingreso - costo);
  const hectareas = round2(bucket.hectareas);
  const diasCiclo = daysBetweenIso(bucket.primeraCosecha, bucket.ultimaCosecha);
  return {
    key: bucket.key,
    label: bucket.label,
    hectareas,
    kg: round2(bucket.kg),
    kgPorHa: perHa(bucket.kg, hectareas),
    ingreso,
    ingresoPorHa: perHa(ingreso, hectareas),
    costo,
    costoPorHa: perHa(costo, hectareas),
    margen,
    margenPorHa: perHa(margen, hectareas),
    margenPct: marginPct(margen, ingreso),
    diasCiclo: diasCiclo != null && diasCiclo >= 0 ? diasCiclo : null,
    nAplicaciones: bucket.nAplicaciones,
    nCosechas: bucket.nCosechas,
  };
}

function emptyBucket(key, label) {
  return {
    key,
    label,
    hectareas: 0,
    kg: 0,
    costo: 0,
    ingreso: 0,
    primeraCosecha: null,
    ultimaCosecha: null,
    nAplicaciones: 0,
    nCosechas: 0,
  };
}

function mergeIntoBucket(bucket, loteData) {
  bucket.hectareas += loteData.hectareas || 0;
  bucket.kg += loteData.kg || 0;
  bucket.costo += loteData.costo || 0;
  bucket.ingreso += loteData.ingreso || 0;
  bucket.nAplicaciones += loteData.nAplicaciones || 0;
  bucket.nCosechas += loteData.nCosechas || 0;
  if (loteData.primeraCosecha) {
    if (!bucket.primeraCosecha || loteData.primeraCosecha < bucket.primeraCosecha) {
      bucket.primeraCosecha = loteData.primeraCosecha;
    }
  }
  if (loteData.ultimaCosecha) {
    if (!bucket.ultimaCosecha || loteData.ultimaCosecha > bucket.ultimaCosecha) {
      bucket.ultimaCosecha = loteData.ultimaCosecha;
    }
  }
}

function rollupByDimension(base, groupBy, context) {
  const rows = [];
  const buckets = {};
  const { packagesById } = context;

  if (groupBy === 'lote') {
    for (const loteData of Object.values(base)) {
      const bucket = emptyBucket(loteData.loteId, loteData.loteNombre);
      mergeIntoBucket(bucket, loteData);
      rows.push(rowFromBucket(bucket));
    }
  } else if (groupBy === 'paquete') {
    for (const loteData of Object.values(base)) {
      const key = loteData.paqueteId || '_sin_paquete';
      const label = loteData.paqueteId
        ? (packagesById[loteData.paqueteId]?.nombrePaquete || loteData.paqueteId)
        : 'Sin paquete';
      if (!buckets[key]) buckets[key] = emptyBucket(key, label);
      mergeIntoBucket(buckets[key], loteData);
    }
    for (const b of Object.values(buckets)) rows.push(rowFromBucket(b));
  } else if (groupBy === 'cultivo') {
    for (const loteData of Object.values(base)) {
      const tipo = loteData.paqueteId
        ? (packagesById[loteData.paqueteId]?.tipoCosecha || 'Sin clasificar')
        : 'Sin clasificar';
      if (!buckets[tipo]) buckets[tipo] = emptyBucket(tipo, tipo);
      mergeIntoBucket(buckets[tipo], loteData);
    }
    for (const b of Object.values(buckets)) rows.push(rowFromBucket(b));
  }

  // Ordenamos por margen descendente (top performers primero).
  rows.sort((a, b) => (b.margen || 0) - (a.margen || 0));
  return rows;
}

function resumenFromRows(rows) {
  const kg = rows.reduce((s, r) => s + (r.kg || 0), 0);
  const ingreso = rows.reduce((s, r) => s + (r.ingreso || 0), 0);
  const costo = rows.reduce((s, r) => s + (r.costo || 0), 0);
  const hectareasTotal = rows.reduce((s, r) => s + (r.hectareas || 0), 0);
  const margen = round2(ingreso - costo);
  return {
    kg: round2(kg),
    ingreso: round2(ingreso),
    costo: round2(costo),
    margen,
    margenPct: marginPct(margen, ingreso),
    hectareasTotal: round2(hectareasTotal),
    nGrupos: rows.length,
  };
}

// ─── Entrada principal ─────────────────────────────────────────────────────

async function computeYieldAggregate(fincaId, params) {
  const { desde, hasta, groupBy } = params;
  if (!desde || !hasta) {
    throw new Error('desde and hasta are required (YYYY-MM-DD).');
  }
  if (!['lote', 'paquete', 'cultivo', 'temporada'].includes(groupBy)) {
    throw new Error(`Invalid groupBy: ${groupBy}`);
  }

  // Contexto compartido: lotes, paquetes, mapa de despachos. Una sola lectura
  // aunque el modo `temporada` recalcule la base múltiples veces.
  const [lotes, packages, despachos] = await Promise.all([
    fetchLotes(fincaId),
    fetchPackages(fincaId),
    fetchAllDispatches(fincaId),
  ]);
  const lotesById = Object.fromEntries(lotes.map(l => [l.id, l]));
  const packagesById = Object.fromEntries(packages.map(p => [p.id, p]));
  const despachoToLote = buildDespachoToLoteMap(despachos);
  const context = { lotesById, packagesById, despachoToLote };

  if (groupBy === 'temporada') {
    const temporadas = await fetchTemporadas(fincaId);
    // Sólo temporadas que intersectan el rango del query.
    const relevantes = [];
    for (const t of temporadas) {
      const inter = intersectRange(
        { desde: t.fechaInicio, hasta: t.fechaFin },
        { desde, hasta },
      );
      if (inter) relevantes.push({ temporada: t, intersection: inter });
    }
    const rows = [];
    // Evaluamos la base con la ventana propia de cada temporada para no
    // mezclar cosechas de temporadas distintas.
    for (const { temporada, intersection } of relevantes) {
      const base = await computeLoteBase(fincaId, intersection, context);
      const bucket = emptyBucket(temporada.id, temporada.nombre);
      for (const loteData of Object.values(base)) {
        mergeIntoBucket(bucket, loteData);
      }
      const row = rowFromBucket(bucket);
      // Inyectamos las fechas de la ventana para contexto en UI.
      row.ventanaDesde = intersection.desde;
      row.ventanaHasta = intersection.hasta;
      rows.push(row);
    }
    rows.sort((a, b) => (b.margen || 0) - (a.margen || 0));
    return {
      groupBy,
      range: { desde, hasta },
      rows,
      resumen: resumenFromRows(rows),
    };
  }

  const base = await computeLoteBase(fincaId, { desde, hasta }, context);
  const rows = rollupByDimension(base, groupBy, context);
  return {
    groupBy,
    range: { desde, hasta },
    rows,
    resumen: resumenFromRows(rows),
  };
}

module.exports = {
  computeYieldAggregate,
  // Exportados para tests.
  _rowFromBucket: rowFromBucket,
  _emptyBucket: emptyBucket,
  _mergeIntoBucket: mergeIntoBucket,
  _rollupByDimension: rollupByDimension,
  _resumenFromRows: resumenFromRows,
  _intersectRange: intersectRange,
};
