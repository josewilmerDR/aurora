// CRUD de materiales de siembra (colección Firestore: materiales_siembra).
// Catálogo compartido por finca; mutaciones requieren encargado+ y DELETE
// requiere supervisor (op destructiva).

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { coerceDensidadDefault } = require('./helpers');

const router = Router();

router.get('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).orderBy('nombre').get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch materials.', 500);
  }
});

router.post('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create materials.', 403);
    }
    const { nombre, rangoPesos, variedad } = req.body;
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (nombre.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name too long.', 400);
    const densidadDefault = coerceDensidadDefault(req.body.densidadDefault);
    if (densidadDefault === null) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'densidadDefault must be 0–199999.', 400);
    const ref = await db.collection('materiales_siembra').add({
      nombre: nombre.trim(), rangoPesos: (rangoPesos || '').slice(0, 32), variedad: (variedad || '').slice(0, 32),
      densidadDefault,
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create material.', 500);
  }
});

router.put('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update materials.', 403);
    }
    const { nombre, rangoPesos, variedad } = req.body;
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (nombre.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name too long.', 400);
    const densidadDefault = coerceDensidadDefault(req.body.densidadDefault);
    if (densidadDefault === null) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'densidadDefault must be 0–199999.', 400);
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    await doc.ref.update({ nombre: nombre.trim(), rangoPesos: (rangoPesos || '').slice(0, 32), variedad: (variedad || '').slice(0, 32), densidadDefault });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update material.', 500);
  }
});

router.delete('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    // Destructive op on a shared catalog — only supervisor or above.
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can delete materials.', 403);
    }
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    const prev = doc.data();
    await doc.ref.delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.MATERIAL_SIEMBRA_DELETE,
      target: { type: 'material_siembra', id: req.params.id },
      metadata: {
        nombre: prev.nombre || null,
        variedad: prev.variedad || null,
        rangoPesos: prev.rangoPesos || null,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete material.', 500);
  }
});

module.exports = router;
