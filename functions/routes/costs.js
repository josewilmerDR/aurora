const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ██  COST CENTER — live aggregation, indirects, snapshots
// ═══════════════════════════════════════════════════════════════════════════

// Depreciation per hour for an asset
function depPerHora(asset) {
  if (!asset) return 0;
  const a = parseFloat(asset.valorAdquisicion);
  const r = parseFloat(asset.valorResidual);
  const h = parseFloat(asset.vidaUtilHoras);
  return (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) ? (a - r) / h : 0;
}

// Hours from a horimetro record
function horasFromRec(rec) {
  const i = parseFloat(rec.horimetroInicial);
  const f = parseFloat(rec.horimetroFinal);
  return (!isNaN(i) && !isNaN(f) && f >= i) ? f - i : 0;
}

// GET /api/costos/live — Live aggregation
router.get('/api/costos/live', authenticate, async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Query params "desde" and "hasta" are required (YYYY-MM-DD).', 400);
    }

    const fincaId = req.fincaId;

    // Parallelized queries
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

    // Build lookup maps
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

    // Siembras (bloques) lookup by id → { loteId, bloque, areaCalculada }
    const siembrasMap = {};
    siembrasSnap.docs.forEach(d => {
      const data = d.data();
      siembrasMap[d.id] = { loteId: data.loteId, loteNombre: data.loteNombre, bloque: data.bloque, area: parseFloat(data.areaCalculada) || 0 };
    });

    // Accumulator: nested map loteId → grupo → bloqueKey → {categories}
    const acc = {}; // loteId → { nombre, ha, grupos: { grupo → { bloques: { bloqueKey → costs } } } }

    function ensure(loteId, loteNombre, grupo, bloqueKey) {
      if (!acc[loteId]) acc[loteId] = { nombre: loteNombre || lotesMap[loteId]?.nombre || loteId, ha: lotesMap[loteId]?.hectareas || 0, grupos: {} };
      const g = grupo || '_sin_grupo';
      if (!acc[loteId].grupos[g]) acc[loteId].grupos[g] = { bloques: {} };
      const bk = bloqueKey || '_sin_bloque';
      if (!acc[loteId].grupos[g].bloques[bk]) acc[loteId].grupos[g].bloques[bk] = { combustible: 0, depreciacion: 0, planilla: 0, insumos: 0, indirectos: 0, kg: 0 };
      return acc[loteId].grupos[g].bloques[bk];
    }

    // 1. Combustible + depreciation (horimetro)
    horSnap.docs.forEach(d => {
      const rec = d.data();
      const fecha = rec.fecha || '';
      if (fecha < desde || fecha > hasta) return;
      if (!rec.loteId) return;

      const hours = horasFromRec(rec);
      const fuelCost = parseFloat(rec.combustible?.costoEstimado) || 0;
      const depTractor = hours * depPerHora(maqMap[rec.tractorId]);
      const depImplemento = hours * depPerHora(maqMap[rec.implementoId]);
      const depTotal = depTractor + depImplemento;

      const bloques = Array.isArray(rec.bloques) && rec.bloques.length > 0 ? rec.bloques : null;
      if (bloques) {
        // Distribute proportionally by area
        let totalArea = 0;
        const bloqueAreas = bloques.map(bId => {
          const area = siembrasMap[bId]?.area || 0;
          totalArea += area;
          return { id: bId, area };
        });
        bloqueAreas.forEach(({ id: bId, area }) => {
          const ratio = totalArea > 0 ? area / totalArea : 1 / bloques.length;
          const bucket = ensure(rec.loteId, rec.loteNombre, rec.grupo, bId);
          bucket.combustible += fuelCost * ratio;
          bucket.depreciacion += depTotal * ratio;
        });
      } else {
        const bucket = ensure(rec.loteId, rec.loteNombre, rec.grupo, null);
        bucket.combustible += fuelCost;
        bucket.depreciacion += depTotal;
      }
    });

    // 2. Direct payroll (planilla unidad historial)
    planHistSnap.docs.forEach(d => {
      const rec = d.data();
      const fecha = rec.fecha?.toDate?.()?.toISOString?.()?.split('T')[0] || rec.fecha || '';
      if (fecha < desde || fecha > hasta) return;

      const total = parseFloat(rec.totalGeneral) || 0;
      if (!total) return;

      // Try to find loteId from loteNombre
      let loteId = null;
      const loteNombre = rec.loteNombre || '';
      for (const [id, info] of Object.entries(lotesMap)) {
        if (info.nombre === loteNombre) { loteId = id; break; }
      }
      if (!loteId) loteId = loteNombre || '_sin_lote';

      const bucket = ensure(loteId, loteNombre, rec.grupo || null, null);
      bucket.planilla += total;
    });

    // 3. Insumos (applied cédulas)
    cedulasSnap.docs.forEach(d => {
      const rec = d.data();
      if (rec.status !== 'aplicada_en_campo') return;
      const fecha = rec.aplicadaAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '';
      if (fecha < desde || fecha > hasta) return;

      const productos = rec.snap_productos || [];
      let totalCost = 0;
      productos.forEach(p => {
        const quantity = parseFloat(p.total) || 0;
        // Use frozen price if available, fallback to current catalog price
        const price = parseFloat(p.precioUnitario) || parseFloat(prodMap[p.productoId]?.precioUnitario) || 0;
        totalCost += quantity * price;
      });

      if (!totalCost) return;

      // Associate to lote/bloque from snap_bloques
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
          // Find loteId from bloque's loteNombre
          let loteId = siembrasMap[bId]?.loteId || null;
          if (!loteId) {
            for (const [id, info] of Object.entries(lotesMap)) {
              if (info.nombre === loteNombre) { loteId = id; break; }
            }
          }
          loteId = loteId || loteNombre || '_sin_lote';
          const grupo = rec.snap_grupo || null;
          const bucket = ensure(loteId, loteNombre, grupo, bId);
          bucket.insumos += totalCost * ratio;
        });
      } else {
        // Fallback: use splitLoteNombre or snap_loteNombre
        const loteNombre = rec.splitLoteNombre || rec.snap_loteNombre || '_sin_lote';
        let loteId = null;
        for (const [id, info] of Object.entries(lotesMap)) {
          if (info.nombre === loteNombre) { loteId = id; break; }
        }
        loteId = loteId || loteNombre;
        const bucket = ensure(loteId, loteNombre, rec.snap_grupo || null, null);
        bucket.insumos += totalCost;
      }
    });

    // 4. Production — harvested kg
    cosechaSnap.docs.forEach(d => {
      const rec = d.data();
      const fecha = rec.fecha || '';
      if (fecha < desde || fecha > hasta) return;

      const kg = parseFloat(rec.cantidad) || 0;
      if (!kg || !rec.loteId) return;

      const bucket = ensure(rec.loteId, rec.loteNombre, rec.grupo || null, rec.bloqueId || null);
      bucket.kg += kg;
    });

    // 5. Indirect costs
    let totalIndirectosManuales = 0;
    indSnap.docs.forEach(d => {
      const rec = d.data();
      const fecha = rec.fecha || '';
      if (fecha < desde || fecha > hasta) return;
      totalIndirectosManuales += parseFloat(rec.monto) || 0;
    });

    // Fixed payroll (administrative salaries) = indirect
    let totalPlanillaFija = 0;
    planFijoSnap.docs.forEach(d => {
      const rec = d.data();
      // Use periodoInicio for date filtering
      const fecha = rec.periodoInicio?.toDate?.()?.toISOString?.()?.split('T')[0] || '';
      if (fecha < desde || fecha > hasta) return;
      totalPlanillaFija += parseFloat(rec.totalGeneral) || 0;
    });

    const totalIndirectos = totalIndirectosManuales + totalPlanillaFija;

    // Distribute indirect costs by area (hectares)
    if (totalIndirectos > 0 && totalAreaFinca > 0) {
      for (const [loteId, loteData] of Object.entries(acc)) {
        const ratio = loteData.ha / totalAreaFinca;
        const indirectoLote = totalIndirectos * ratio;
        // Distribute evenly across all existing grupo→bloque buckets in this lote
        const allBuckets = [];
        for (const gData of Object.values(loteData.grupos)) {
          for (const bucket of Object.values(gData.bloques)) {
            allBuckets.push(bucket);
          }
        }
        if (allBuckets.length > 0) {
          const perBucket = indirectoLote / allBuckets.length;
          allBuckets.forEach(b => { b.indirectos += perBucket; });
        } else {
          // Lote has area but no direct cost records → create a bucket
          const bucket = ensure(loteId, loteData.nombre, null, null);
          bucket.indirectos += indirectoLote;
        }
      }
      // Allocate to lotes that have area but no records yet
      for (const [loteId, info] of Object.entries(lotesMap)) {
        if (!acc[loteId] && info.hectareas > 0) {
          const ratio = info.hectareas / totalAreaFinca;
          const bucket = ensure(loteId, info.nombre, null, null);
          bucket.indirectos += totalIndirectos * ratio;
        }
      }
    }

    // 6. Build response
    const round2 = n => parseFloat(n.toFixed(2));
    const costoPorKg = (costo, kg) => kg > 0 ? round2(costo / kg) : null;

    let totalCosto = 0, totalKg = 0;
    let totalCombustible = 0, totalPlanilla = 0, totalInsumos = 0, totalDepreciacion = 0, totalIndirectosAcc = 0;
    const porLote = [];
    const porGrupo = [];
    const porBloque = [];

    for (const [loteId, loteData] of Object.entries(acc)) {
      let loteCosto = 0, loteKg = 0;
      let loteComb = 0, lotePlan = 0, loteIns = 0, loteDep = 0, loteInd = 0;

      for (const [grupoName, gData] of Object.entries(loteData.grupos)) {
        let grupoCosto = 0, grupoKg = 0;
        let grupoComb = 0, grupoPlan = 0, grupoIns = 0, grupoDep = 0, grupoInd = 0;

        for (const [bloqueKey, b] of Object.entries(gData.bloques)) {
          const bCosto = b.combustible + b.depreciacion + b.planilla + b.insumos + b.indirectos;
          grupoComb += b.combustible; grupoPlan += b.planilla; grupoIns += b.insumos;
          grupoDep += b.depreciacion; grupoInd += b.indirectos;
          grupoCosto += bCosto; grupoKg += b.kg;

          if (bloqueKey !== '_sin_bloque') {
            porBloque.push({
              loteId, loteNombre: loteData.nombre,
              grupo: grupoName !== '_sin_grupo' ? grupoName : null,
              bloqueId: bloqueKey,
              bloque: siembrasMap[bloqueKey]?.bloque || bloqueKey,
              desglose: { combustible: round2(b.combustible), planilla: round2(b.planilla), insumos: round2(b.insumos), depreciacion: round2(b.depreciacion), indirectos: round2(b.indirectos) },
              costoTotal: round2(bCosto), kg: round2(b.kg), costoPorKg: costoPorKg(bCosto, b.kg),
            });
          }
        }

        loteComb += grupoComb; lotePlan += grupoPlan; loteIns += grupoIns;
        loteDep += grupoDep; loteInd += grupoInd;
        loteCosto += grupoCosto; loteKg += grupoKg;

        if (grupoName !== '_sin_grupo') {
          porGrupo.push({
            loteId, loteNombre: loteData.nombre, grupo: grupoName,
            desglose: { combustible: round2(grupoComb), planilla: round2(grupoPlan), insumos: round2(grupoIns), depreciacion: round2(grupoDep), indirectos: round2(grupoInd) },
            costoTotal: round2(grupoCosto), kg: round2(grupoKg), costoPorKg: costoPorKg(grupoCosto, grupoKg),
          });
        }
      }

      totalCombustible += loteComb; totalPlanilla += lotePlan; totalInsumos += loteIns;
      totalDepreciacion += loteDep; totalIndirectosAcc += loteInd;
      totalCosto += loteCosto; totalKg += loteKg;

      porLote.push({
        loteId, nombre: loteData.nombre,
        desglose: { combustible: round2(loteComb), planilla: round2(lotePlan), insumos: round2(loteIns), depreciacion: round2(loteDep), indirectos: round2(loteInd) },
        costoTotal: round2(loteCosto), kg: round2(loteKg), costoPorKg: costoPorKg(loteCosto, loteKg),
      });
    }

    res.json({
      rangoFechas: { desde, hasta },
      resumen: {
        costoTotal: round2(totalCosto), kgTotal: round2(totalKg), costoPorKg: costoPorKg(totalCosto, totalKg),
        combustible: round2(totalCombustible), planilla: round2(totalPlanilla),
        insumos: round2(totalInsumos), depreciacion: round2(totalDepreciacion),
        indirectos: round2(totalIndirectosAcc),
      },
      porLote: porLote.sort((a, b) => b.costoTotal - a.costoTotal),
      porGrupo: porGrupo.sort((a, b) => b.costoTotal - a.costoTotal),
      porBloque: porBloque.sort((a, b) => b.costoTotal - a.costoTotal),
    });
  } catch (error) {
    console.error('[costos/live]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute live costs.', 500);
  }
});

// CRUD costos_indirectos
router.get('/api/costos/indirectos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('costos_indirectos')
      .where('fincaId', '==', req.fincaId)
      .get();
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data(), creadoAt: d.data().creadoAt?.toDate?.()?.toISOString() || null }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.json(data);
  } catch (error) {
    console.error('[costos/indirectos:get]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch indirect costs.', 500);
  }
});

router.post('/api/costos/indirectos', authenticate, async (req, res) => {
  try {
    const { fecha, categoria, descripcion, monto } = req.body;
    if (!fecha || !categoria || monto == null) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fecha, categoria and monto are required.', 400);
    }
    const data = {
      fecha, categoria, descripcion: descripcion || '',
      monto: parseFloat(monto) || 0,
      fincaId: req.fincaId, creadoPor: req.uid, creadoAt: Timestamp.now(),
    };
    const ref = await db.collection('costos_indirectos').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (error) {
    console.error('[costos/indirectos:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create indirect cost.', 500);
  }
});

router.put('/api/costos/indirectos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_indirectos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { fecha, categoria, descripcion, monto } = req.body;
    const data = {};
    if (fecha !== undefined)       data.fecha = fecha;
    if (categoria !== undefined)   data.categoria = categoria;
    if (descripcion !== undefined) data.descripcion = descripcion;
    if (monto !== undefined)       data.monto = parseFloat(monto) || 0;
    data.actualizadoEn = Timestamp.now();
    await db.collection('costos_indirectos').doc(req.params.id).update(data);
    res.json({ id: req.params.id, ...data });
  } catch (error) {
    console.error('[costos/indirectos:put]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update indirect cost.', 500);
  }
});

router.delete('/api/costos/indirectos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_indirectos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('costos_indirectos').doc(req.params.id).delete();
    res.json({ message: 'Deleted.' });
  } catch (error) {
    console.error('[costos/indirectos:delete]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete indirect cost.', 500);
  }
});

// CRUD costos_snapshots
router.get('/api/costos/snapshots', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('costos_snapshots')
      .where('fincaId', '==', req.fincaId)
      .get();
    const data = snap.docs
      .map(d => {
        const raw = d.data();
        return {
          id: d.id,
          nombre: raw.nombre,
          tipo: raw.tipo,
          rangoFechas: raw.rangoFechas,
          resumen: raw.resumen,
          fechaCreacion: raw.fechaCreacion?.toDate?.()?.toISOString() || null,
          creadoPor: raw.creadoPor,
        };
      })
      .sort((a, b) => (b.fechaCreacion || '').localeCompare(a.fechaCreacion || ''));
    res.json(data);
  } catch (error) {
    console.error('[costos/snapshots:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch snapshots.', 500);
  }
});

router.get('/api/costos/snapshots/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const raw = ownership.doc.data();
    res.json({
      id: ownership.doc.id, ...raw,
      fechaCreacion: raw.fechaCreacion?.toDate?.()?.toISOString() || null,
    });
  } catch (error) {
    console.error('[costos/snapshots:get]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch snapshot.', 500);
  }
});

router.post('/api/costos/snapshots', authenticate, async (req, res) => {
  try {
    const { nombre, tipo, rangoFechas, resumen, porLote, porGrupo, porBloque } = req.body;
    if (!nombre || !rangoFechas || !resumen) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'nombre, rangoFechas and resumen are required.', 400);
    }
    const data = {
      nombre, tipo: tipo || 'manual',
      rangoFechas, resumen,
      porLote: porLote || [], porGrupo: porGrupo || [], porBloque: porBloque || [],
      fincaId: req.fincaId, creadoPor: req.uid, fechaCreacion: Timestamp.now(),
    };
    const ref = await db.collection('costos_snapshots').add(data);
    res.status(201).json({ id: ref.id, nombre: data.nombre });
  } catch (error) {
    console.error('[costos/snapshots:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create snapshot.', 500);
  }
});

router.delete('/api/costos/snapshots/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('costos_snapshots').doc(req.params.id).delete();
    res.json({ message: 'Snapshot deleted.' });
  } catch (error) {
    console.error('[costos/snapshots:delete]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete snapshot.', 500);
  }
});

module.exports = router;
