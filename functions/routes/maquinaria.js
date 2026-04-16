const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

const VALID_TYPES = new Set([
  'CARRETA DE SEMILLA',
  'CARRETA DE COSECHA',
  'IMPLEMENTO',
  'MAQUINARIA DE APLICACIONES',
  'MAQUINARIA DE PREPARACIÓN DE TERRENO',
  'MONTACARGA',
  'MOTOCICLETA',
  'TRACTOR DE LLANTAS',
  'VEHÍCULO CARGA LIVIANA',
  'OTRO MAQUINARIA DE CAMPO',
]);

const MAX_ID       = 50;
const MAX_CODIGO   = 50;
const MAX_DESC     = 200;
const MAX_UBIC     = 150;
const MAX_OBS      = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const floatInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const intInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const validDate = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
};

function buildMaquinariaDoc(body) {
  const descripcion = str(body.descripcion, MAX_DESC);
  if (!descripcion) return { error: 'Description is required.' };

  const tipoRaw = typeof body.tipo === 'string' ? body.tipo.trim() : '';
  const tipo = tipoRaw && VALID_TYPES.has(tipoRaw) ? tipoRaw : '';

  const fecha = validDate(body.fechaRevisionResidual);
  if (fecha === null) return { error: 'Invalid residual review date.' };

  return {
    data: {
      idMaquina:             str(body.idMaquina, MAX_ID),
      codigo:                str(body.codigo, MAX_CODIGO),
      descripcion,
      tipo,
      ubicacion:             str(body.ubicacion, MAX_UBIC),
      observacion:           str(body.observacion, MAX_OBS),
      capacidad:             floatInRange(body.capacidad, 0, 1e6),
      valorAdquisicion:      floatInRange(body.valorAdquisicion, 0, 1e12),
      valorResidual:         floatInRange(body.valorResidual, 0, 1e12),
      vidaUtilHoras:         intInRange(body.vidaUtilHoras, 0, 1e6),
      fechaRevisionResidual: fecha,
    },
  };
}

// --- API ENDPOINTS: MAQUINARIA ---
router.get('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('maquinaria')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''));
    res.json(items);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch maquinaria.', 500);
  }
});

router.post('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const { error, data } = buildMaquinariaDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    // Upsert: if idMaquina is provided and already exists for this finca, update it
    if (data.idMaquina) {
      const existing = await db.collection('maquinaria')
        .where('fincaId', '==', req.fincaId)
        .where('idMaquina', '==', data.idMaquina)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        await doc.ref.update({ ...data, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    const doc = await db.collection('maquinaria').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: doc.id, merged: false });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create maquinaria.', 500);
  }
});

router.put('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('maquinaria', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildMaquinariaDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    await db.collection('maquinaria').doc(req.params.id).update({
      ...data,
      actualizadoEn: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update maquinaria.', 500);
  }
});

router.delete('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('maquinaria', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('maquinaria').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete maquinaria.', 500);
  }
});

// ── Fuel rates per machine ───────────────────────────────────────────────────
// GET /api/maquinaria/tasas-combustible?bodegaId=xxx&dias=30
// Returns an object keyed by maquinaId with:
//   { litros, horas, tasaLH, precioUnitario, costoEstimadoPorHora }
// tasaLH = null if no hours are registered in the period.
// precioUnitario = actual weighted cost of the period (totalSalida/litros),
//   or the item's current weighted cost if no movements occurred.
router.get('/api/maquinaria/tasas-combustible', authenticate, async (req, res) => {
  try {
    const bodegaId = typeof req.query.bodegaId === 'string' ? req.query.bodegaId.trim().slice(0, 128) : '';
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 90);

    const cutoff     = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const cutoffTs   = Timestamp.fromDate(cutoff);

    // ── 1. Current fuel price ─────────────────────────────────────────────────
    // weighted cost = item.total / item.stockActual  (moving average cost)
    let precioActual = 0;
    if (bodegaId) {
      const bodegaCheck = await verifyOwnership('bodegas', bodegaId, req.fincaId);
      if (!bodegaCheck.ok) return sendApiError(res, bodegaCheck.code, bodegaCheck.message, bodegaCheck.status);

      const itemsSnap = await db.collection('bodega_items')
        .where('bodegaId', '==', bodegaId)
        .get();
      let totalCosto = 0, totalStock = 0;
      itemsSnap.docs.forEach(d => {
        const { stockActual = 0, total = 0 } = d.data();
        if (stockActual > 0 && total > 0) { totalCosto += total; totalStock += stockActual; }
      });
      precioActual = totalStock > 0 ? totalCosto / totalStock : 0;
    }

    // ── 2. Fuel outflows for the period, grouped by activoId ──────────────────
    const litrosPorActivo = {}; // { [activoId]: { litros, costo } }
    if (bodegaId) {
      const movsSnap = await db.collection('bodega_movimientos')
        .where('bodegaId',  '==', bodegaId)
        .where('tipo',      '==', 'salida')
        .where('timestamp', '>=', cutoffTs)
        .get();
      movsSnap.docs.forEach(d => {
        const { activoId, cantidad = 0, totalSalida = 0 } = d.data();
        if (!activoId) return;
        if (!litrosPorActivo[activoId]) litrosPorActivo[activoId] = { litros: 0, costo: 0 };
        litrosPorActivo[activoId].litros += cantidad;
        litrosPorActivo[activoId].costo  += totalSalida;
      });
    }

    // ── 3. Horimeter hours for the period, grouped by tractorId ───────────────
    const horasPorTractor = {}; // { [tractorId]: horas }
    const horimSnap = await db.collection('horimetro')
      .where('fincaId', '==', req.fincaId)
      .where('fecha',   '>=', cutoffDate)
      .get();
    horimSnap.docs.forEach(d => {
      const { tractorId, horimetroInicial, horimetroFinal } = d.data();
      if (!tractorId) return;
      const hi = parseFloat(horimetroInicial);
      const hf = parseFloat(horimetroFinal);
      if (!isNaN(hi) && !isNaN(hf) && hf > hi) {
        horasPorTractor[tractorId] = (horasPorTractor[tractorId] || 0) + (hf - hi);
      }
    });

    // ── 4. Combine: one entry per maquinaId with activity ─────────────────────
    const allIds = new Set([...Object.keys(litrosPorActivo), ...Object.keys(horasPorTractor)]);
    const tasas = {};
    allIds.forEach(id => {
      const litros = litrosPorActivo[id]?.litros || 0;
      const costo  = litrosPorActivo[id]?.costo  || 0;
      const horas  = horasPorTractor[id] || 0;
      const tasaLH = horas > 0 ? litros / horas : null;
      // Price: actual period cost if there were movements, otherwise current item price
      const precio = litros > 0 && costo > 0 ? costo / litros : precioActual;
      tasas[id] = {
        litros:               parseFloat(litros.toFixed(2)),
        horas:                parseFloat(horas.toFixed(1)),
        tasaLH:               tasaLH !== null ? parseFloat(tasaLH.toFixed(3)) : null,
        precioUnitario:       parseFloat(precio.toFixed(2)),
        costoEstimadoPorHora: tasaLH !== null ? parseFloat((tasaLH * precio).toFixed(2)) : null,
      };
    });

    res.json({ tasas, dias, bodegaId: bodegaId || null });
  } catch (error) {
    console.error('[tasas-combustible GET]', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to calculate fuel rates.', 500);
  }
});

module.exports = router;
