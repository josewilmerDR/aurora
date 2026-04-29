const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ─── CALIBRACIONES ────────────────────────────────────────────────────────────

router.get('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('calibraciones')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .get();
    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(items);
  } catch (err) {
    console.error('Error fetching calibraciones:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch calibraciones.', 500);
  }
});

router.post('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    if (!data.nombre?.trim()) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    }
    const doc = { ...data, fincaId: req.fincaId, creadoEn: Timestamp.now() };
    const ref = await db.collection('calibraciones').add(doc);
    res.status(201).json({ id: ref.id, ...doc });
  } catch (err) {
    console.error('Error creating calibración:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create calibración.', 500);
  }
});

router.put('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    await db.collection('calibraciones').doc(req.params.id).update(data);
    res.status(200).json({ id: req.params.id, ...data });
  } catch (err) {
    console.error('Error updating calibración:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update calibración.', 500);
  }
});

router.delete('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('calibraciones').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error deleting calibración:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete calibración.', 500);
  }
});

module.exports = router;
