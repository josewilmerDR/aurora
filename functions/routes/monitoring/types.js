// Monitoring — plantillas (`tipos_monitoreo`).
//
// Sub-archivo del split de routes/monitoring.js. CRUD de tipos de monitoreo:
// el catálogo de plantillas que define qué campos personalizados (texto /
// número / fecha) se capturan al hacer un muestreo. Cada tipo es reusable
// y se referencia desde paquetes de muestreo.
//
// Endpoints:
//   - GET    /api/monitoreo/tipos
//   - POST   /api/monitoreo/tipos        crea (campos opcionales)
//   - GET    /api/monitoreo/tipos/:id
//   - PUT    /api/monitoreo/tipos/:id    actualiza nombre / campos / activo
//   - DELETE /api/monitoreo/tipos/:id

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { sanitizeNombre, sanitizeCampos } = require('./helpers');

const router = Router();

router.get('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('tipos_monitoreo').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoreo types.', 500);
  }
});

router.post('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const nombreRes = sanitizeNombre(req.body?.nombre);
    if (!nombreRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, nombreRes.message, 400);
    const camposRes = sanitizeCampos(req.body?.campos);
    if (!camposRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, camposRes.message, 400);
    const ref = await db.collection('tipos_monitoreo').add({
      nombre: nombreRes.value,
      activo: true,
      fincaId: req.fincaId,
      campos: camposRes.value,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create type.', 500);
  }
});

router.get('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id: req.params.id, ...ownership.doc.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch template.', 500);
  }
});

router.put('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const update = {};
    if (req.body?.nombre !== undefined) {
      const nombreRes = sanitizeNombre(req.body.nombre);
      if (!nombreRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, nombreRes.message, 400);
      update.nombre = nombreRes.value;
    }
    if (req.body?.campos !== undefined) {
      const camposRes = sanitizeCampos(req.body.campos);
      if (!camposRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, camposRes.message, 400);
      update.campos = camposRes.value;
    }
    if (req.body?.activo !== undefined) {
      update.activo = !!req.body.activo;
    }
    if (Object.keys(update).length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No changes.', 400);
    }
    await db.collection('tipos_monitoreo').doc(req.params.id).update(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update type.', 500);
  }
});

router.delete('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('tipos_monitoreo').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete type.', 500);
  }
});

module.exports = router;
