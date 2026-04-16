const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ── Monthly fuel closing ─────────────────────────────────────────────────────
// GET /api/cierres-combustible — list the finca's closings
router.get('/api/cierres-combustible', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('cierres_combustible')
      .where('fincaId', '==', req.fincaId)
      .orderBy('creadoEn', 'desc')
      .limit(36)
      .get();
    res.json(snap.docs.map(d => ({
      id: d.id, ...d.data(),
      creadoEn: d.data().creadoEn?.toDate?.()?.toISOString(),
    })));
  } catch (err) {
    console.error('[cierres-combustible GET]', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch closings.', 500);
  }
});

// POST /api/cierres-combustible
// body: { periodo: "2026-03", bodegaId, preview?: true }
// preview=true  → returns the calculation without saving
// preview=false → saves the closing and updates the affected horimeter records
router.post('/api/cierres-combustible', authenticate, async (req, res) => {
  try {
    const { periodo, bodegaId, preview = false } = req.body;
    if (!periodo || !/^\d{4}-\d{2}$/.test(periodo))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Period must be in YYYY-MM format.', 400);
    if (!bodegaId)
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'bodegaId is required.', 400);

    const bodegaCheck = await verifyOwnership('bodegas', bodegaId, req.fincaId);
    if (!bodegaCheck.ok) return sendApiError(res, bodegaCheck.code, bodegaCheck.message, bodegaCheck.status);

    // Block double closing for the same period + bodega
    if (!preview) {
      const dup = await db.collection('cierres_combustible')
        .where('fincaId',  '==', req.fincaId)
        .where('periodo',  '==', periodo)
        .where('bodegaId', '==', bodegaId)
        .where('estado',   '==', 'cerrado')
        .limit(1).get();
      if (!dup.empty)
        return sendApiError(res, ERROR_CODES.CONFLICT, `A closing already exists for ${periodo}. Reopen it before closing again.`, 409);
    }

    // Period date range
    const [year, month] = periodo.split('-').map(Number);
    const periodoStart  = new Date(year, month - 1, 1);
    const periodoEnd    = new Date(year, month, 1);          // first day of next month
    const fechaIni      = `${periodo}-01`;
    const lastDay       = new Date(year, month, 0).getDate();
    const fechaFin      = `${periodo}-${String(lastDay).padStart(2, '0')}`;

    // ── 1. Horímetro records for the period ───────────────────────────────
    const horimSnap = await db.collection('horimetro')
      .where('fincaId', '==', req.fincaId)
      .where('fecha',   '>=', fechaIni)
      .where('fecha',   '<=', fechaFin)
      .get();
    const horimetros = horimSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!horimetros.length)
      return sendApiError(res, ERROR_CODES.NOT_FOUND, `No horímetro records found for ${periodo}.`, 400);

    // ── 2. Fuel outflows for the period, grouped by activoId ──────────────
    const movsSnap = await db.collection('bodega_movimientos')
      .where('bodegaId',  '==', bodegaId)
      .where('tipo',      '==', 'salida')
      .where('timestamp', '>=', Timestamp.fromDate(periodoStart))
      .where('timestamp', '<',  Timestamp.fromDate(periodoEnd))
      .get();
    const salidasPorActivo = {};
    movsSnap.docs.forEach(d => {
      const { activoId, cantidad = 0, totalSalida = 0 } = d.data();
      if (!activoId) return;
      if (!salidasPorActivo[activoId]) salidasPorActivo[activoId] = { litros: 0, costo: 0 };
      salidasPorActivo[activoId].litros += cantidad;
      salidasPorActivo[activoId].costo  += totalSalida;
    });

    // ── 3. Group horímetro records by tractorId ───────────────────────────
    const horimPorTractor = {};
    horimetros.forEach(h => {
      if (!h.tractorId) return;
      if (!horimPorTractor[h.tractorId]) horimPorTractor[h.tractorId] = [];
      horimPorTractor[h.tractorId].push(h);
    });

    // ── 4. Compute closing per machine ────────────────────────────────────
    const maquinas  = [];
    const ajustes   = []; // { horimetroId, costoReal, ajuste }

    const tractorIds = new Set([...Object.keys(salidasPorActivo), ...Object.keys(horimPorTractor)]);
    for (const tractorId of tractorIds) {
      const sal      = salidasPorActivo[tractorId] || { litros: 0, costo: 0 };
      const registros = horimPorTractor[tractorId] || [];

      let totalHoras = 0, totalEstimado = 0;
      const detalles = [];
      registros.forEach(h => {
        const ini   = parseFloat(h.horimetroInicial);
        const fin   = parseFloat(h.horimetroFinal);
        const horas = (!isNaN(ini) && !isNaN(fin) && fin > ini) ? parseFloat((fin - ini).toFixed(1)) : 0;
        const cEst  = h.combustible?.costoEstimado ?? 0;
        totalHoras    += horas;
        totalEstimado += cEst;
        detalles.push({
          horimetroId: h.id,
          fecha:       h.fecha,
          loteId:      h.loteId    || '',
          loteNombre:  h.loteNombre || '',
          labor:       h.labor      || '',
          horas,
          costoEstimado: parseFloat(cEst.toFixed(2)),
        });
      });

      const costoReal  = parseFloat(sal.costo.toFixed(2));
      const litros     = parseFloat(sal.litros.toFixed(2));
      const variacion  = parseFloat((costoReal - totalEstimado).toFixed(2));
      const tasaReal   = totalHoras > 0 ? parseFloat((litros / totalHoras).toFixed(3)) : null;
      const precioMed  = litros > 0 ? parseFloat((costoReal / litros).toFixed(2)) : 0;

      // Distribute costoReal proportional to hours
      const detallesConReal = detalles.map(d => {
        const real  = totalHoras > 0
          ? parseFloat((costoReal * (d.horas / totalHoras)).toFixed(2))
          : 0;
        const ajuste = parseFloat((real - d.costoEstimado).toFixed(2));
        const pct    = totalHoras > 0 ? parseFloat(((d.horas / totalHoras) * 100).toFixed(1)) : 0;
        return { ...d, costoReal: real, ajuste, pct };
      });

      maquinas.push({
        maquinaId:     tractorId,
        maquinaNombre: registros[0]?.tractorNombre || tractorId,
        litros,
        totalHoras:    parseFloat(totalHoras.toFixed(1)),
        tasaReal,
        precioMedio:   precioMed,
        costoReal,
        costoEstimado: parseFloat(totalEstimado.toFixed(2)),
        variacion,
        detalles:      detallesConReal,
      });
      ajustes.push(...detallesConReal);
    }

    if (preview) return res.json({ preview: true, periodo, bodegaId, maquinas });

    // ── 5. Persist the closing document ──────────────────────────────────
    const bodegaNombre = (await db.collection('bodegas').doc(bodegaId).get()).data()?.nombre || '';
    const cierreData = {
      fincaId: req.fincaId, periodo, bodegaId, bodegaNombre,
      maquinas, estado: 'cerrado',
      creadoEn: Timestamp.now(), creadoPor: req.uid,
    };
    const cierreRef = await db.collection('cierres_combustible').add(cierreData);

    // ── 6. Update horímetro records with costoReal, ajuste, cierrePeriodo ─
    const BATCH = 500;
    for (let i = 0; i < ajustes.length; i += BATCH) {
      const batch = db.batch();
      ajustes.slice(i, i + BATCH).forEach(a => {
        batch.update(db.collection('horimetro').doc(a.horimetroId), {
          'combustible.costoReal':     a.costoReal,
          'combustible.ajuste':        a.ajuste,
          'combustible.cierrePeriodo': periodo,
          actualizadoEn: Timestamp.now(),
        });
      });
      await batch.commit();
    }

    res.status(201).json({
      id: cierreRef.id, ...cierreData,
      creadoEn: cierreData.creadoEn.toDate().toISOString(),
    });
  } catch (err) {
    console.error('[cierres-combustible POST]', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process closing.', 500);
  }
});

module.exports = router;
