// Monitoring — registros de monitoreo (`monitoreos`).
//
// Sub-archivo del split de routes/monitoring.js. Los "monitoreos" son los
// instances reales: cada vez que un técnico llena un formulario, se guarda
// un documento aquí con sus datos y observaciones. Pueden venir de una
// orden de muestreo (sampling.js los crea automáticamente) o registrarse
// directamente con POST.
//
// Endpoints:
//   - GET    /api/monitoreo                       lista con filtros lote/desde/hasta
//   - POST   /api/monitoreo                       registro manual
//   - GET    /api/monitoreo/:id                   detalle
//   - DELETE /api/monitoreo/:id/registros/:regIdx borra una fila individual del
//                                                  array formularioData.registros;
//                                                  si era la única, borra el doc
//   - DELETE /api/monitoreo/:id                   hard delete

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  DATE_ISO_RE, MAX_MONITOREO_STR, MAX_MONITOREO_OBS, parseIsoDate,
} = require('./helpers');

const router = Router();

router.get('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, desde, hasta } = req.query;
    if (desde !== undefined && desde !== '' && !DATE_ISO_RE.test(desde)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid "desde" format (YYYY-MM-DD).', 400);
    }
    if (hasta !== undefined && hasta !== '' && !DATE_ISO_RE.test(hasta)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid "hasta" format (YYYY-MM-DD).', 400);
    }

    let query = db.collection('monitoreos').where('fincaId', '==', req.fincaId);
    if (loteId && typeof loteId === 'string') query = query.where('loteId', '==', loteId.slice(0, 80));
    if (desde) {
      const d = parseIsoDate(desde);
      if (d) query = query.where('fecha', '>=', Timestamp.fromDate(d));
    }
    if (hasta) {
      const d = parseIsoDate(hasta);
      if (d) query = query.where('fecha', '<=', Timestamp.fromDate(d));
    }
    const snap = await query.orderBy('fecha', 'desc').limit(200).get();
    const data = snap.docs.map(d => {
      const doc = d.data();
      return {
        id: d.id,
        ...doc,
        fecha: doc.fecha?.toDate?.()?.toISOString() ?? null,
        createdAt: doc.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    res.status(200).json(data);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring records.', 500);
  }
});

router.post('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const loteId = typeof body.loteId === 'string' ? body.loteId.trim() : '';
    const tipoId = typeof body.tipoId === 'string' ? body.tipoId.trim() : '';
    const fecha = body.fecha;
    if (!loteId || !tipoId || !fecha) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Lote, type and date are required.', 400);
    }
    if (!DATE_ISO_RE.test(fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format (YYYY-MM-DD).', 400);
    }
    const fechaDate = parseIsoDate(fecha);
    if (!fechaDate) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date.', 400);

    // Verifica que el lote pertenezca a la finca del usuario.
    const loteOwn = await verifyOwnership('lotes', loteId, req.fincaId);
    if (!loteOwn.ok) return res.status(loteOwn.status).json({ message: loteOwn.message });

    const trimStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const observaciones = trimStr(body.observaciones, MAX_MONITOREO_OBS);
    const ref = await db.collection('monitoreos').add({
      fincaId: req.fincaId,
      loteId,
      loteNombre: trimStr(body.loteNombre, MAX_MONITOREO_STR),
      tipoId: tipoId.slice(0, MAX_MONITOREO_STR),
      tipoNombre: trimStr(body.tipoNombre, MAX_MONITOREO_STR),
      bloque: trimStr(body.bloque, MAX_MONITOREO_STR),
      fecha: Timestamp.fromDate(fechaDate),
      responsableId: trimStr(body.responsableId, MAX_MONITOREO_STR),
      responsableNombre: trimStr(body.responsableNombre, MAX_MONITOREO_STR),
      datos: (body.datos && typeof body.datos === 'object' && !Array.isArray(body.datos)) ? body.datos : {},
      observaciones,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register monitoring record.', 500);
  }
});

router.get('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('monitoreos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    res.status(200).json({
      id: req.params.id,
      ...data,
      fecha: data.fecha?.toDate?.()?.toISOString() ?? null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring record.', 500);
  }
});

// Elimina un registro individual del array formularioData.registros.
// If it was the only one, deletes the entire document.
router.delete('/api/monitoreo/:id/registros/:regIdx', authenticate, async (req, res) => {
  try {
    const { id, regIdx } = req.params;
    const idx = Number.parseInt(regIdx, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid record index.', 400);
    }
    const ownership = await verifyOwnership('monitoreos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const registros = ownership.doc.data().formularioData?.registros;
    if (!Array.isArray(registros) || registros.length <= 1) {
      await db.collection('monitoreos').doc(id).delete();
      return res.status(200).json({ deleted: 'monitoreo' });
    }
    if (idx >= registros.length) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Index out of range.', 400);
    }
    const updated = registros.filter((_, i) => i !== idx);
    await db.collection('monitoreos').doc(id).update({ 'formularioData.registros': updated });
    return res.status(200).json({ deleted: 'registro', registros: updated });
  } catch (error) {
    console.error('Error eliminando registro individual:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

router.delete('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('monitoreos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('monitoreos').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete monitoring record.', 500);
  }
});

module.exports = router;
