const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ── Units of Measure ───────────────────────────────────────────────────────
router.get('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch unidades de medida.', 500);
  }
});

router.post('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    const data = {
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      fincaId: req.fincaId,
    };
    // Upsert by nombre
    const existing = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .where('nombre', '==', data.nombre)
      .limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const { fincaId, ...updateData } = data;
      await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
      return res.status(200).json({ id: doc.id, merged: true });
    }
    data.creadoEn = Timestamp.now();
    const ref = await db.collection('unidades_medida').add(data);
    res.status(201).json({ id: ref.id, merged: false });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create unidad de medida.', 500);
  }
});

router.put('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    await db.collection('unidades_medida').doc(req.params.id).update({
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      actualizadoEn:    Timestamp.now(),
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update unidad de medida.', 500);
  }
});

router.delete('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('unidades_medida').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete unidad de medida.', 500);
  }
});

module.exports = router;
