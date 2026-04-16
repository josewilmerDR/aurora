const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

const MAX_CODIGO = 30;
const MAX_DESCRIPCION = 200;
const MAX_OBSERVACION = 1000;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function buildLaborDoc(body) {
  const descripcion = str(body.descripcion, MAX_DESCRIPCION);
  if (!descripcion) return { error: 'Description is required.' };
  return {
    data: {
      codigo: str(body.codigo, MAX_CODIGO),
      descripcion,
      observacion: str(body.observacion, MAX_OBSERVACION),
    },
  };
}

// ── Labores ────────────────────────────────────────────────────────────────
router.get('/api/labores', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('labores')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true, sensitivity: 'base' }));
    res.json(items);
  } catch (error) {
    console.error('Error fetching labores:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch labores.', 500);
  }
});

router.post('/api/labores', authenticate, async (req, res) => {
  try {
    const { error, data } = buildLaborDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    // Upsert by código if provided (scoped to finca)
    if (data.codigo) {
      const existing = await db.collection('labores')
        .where('fincaId', '==', req.fincaId)
        .where('codigo', '==', data.codigo)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        await doc.ref.update({ ...data, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    const doc = await db.collection('labores').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: doc.id, merged: false });
  } catch (error) {
    console.error('Error creating labor:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create labor.', 500);
  }
});

router.put('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildLaborDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    await db.collection('labores').doc(req.params.id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating labor:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update labor.', 500);
  }
});

router.delete('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('labores').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting labor:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete labor.', 500);
  }
});

module.exports = router;
