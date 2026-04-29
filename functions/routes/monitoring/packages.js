// Monitoring — paquetes de muestreo (`monitoreo_paquetes`).
//
// Sub-archivo del split de routes/monitoring.js. CRUD de paquetes que
// agrupan actividades de muestreo programadas (cada actividad referencia
// uno o más tipos de monitoreo y un día relativo). Sirven para que el
// supervisor le asigne a un grupo un programa completo de muestreos en
// vez de tarea por tarea.
//
// Endpoints:
//   - GET    /api/monitoreo/paquetes
//   - GET    /api/monitoreo/paquetes/:id
//   - POST   /api/monitoreo/paquetes
//   - PUT    /api/monitoreo/paquetes/:id
//   - DELETE /api/monitoreo/paquetes/:id

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { sanitizePaquete } = require('./helpers');

const router = Router();

router.get('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('monitoreo_paquetes').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring packages.', 500);
  }
});

router.get('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id, ...ownership.doc.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring package.', 500);
  }
});

router.post('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const parsed = sanitizePaquete(req.body);
    if (!parsed.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.message, 400);
    const pkg = { ...parsed.value, fincaId: req.fincaId };
    const docRef = await db.collection('monitoreo_paquetes').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create monitoring package.', 500);
  }
});

router.put('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const parsed = sanitizePaquete(req.body);
    if (!parsed.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.message, 400);
    await db.collection('monitoreo_paquetes').doc(id).update(parsed.value);
    res.status(200).json({ id, ...parsed.value });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update monitoring package.', 500);
  }
});

router.delete('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('monitoreo_paquetes').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete monitoring package.', 500);
  }
});

module.exports = router;
