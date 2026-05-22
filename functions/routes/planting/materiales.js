// CRUD de materiales de siembra (colección Firestore: materiales_siembra).
// Catálogo compartido por finca; lectura y mutaciones requieren encargado+ y
// DELETE requiere supervisor (op destructiva). El gate de GET refleja que
// todas las rutas que consumen este endpoint (/siembra, /siembra/historial,
// /siembra/materiales, InitialSetup) ya están abiertas solo a encargado+;
// no hay caller legítimo con rol `trabajador`.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { buildMaterialDoc } = require('./schemas');

const router = Router();

router.get('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read materials.', 403);
    }
    const snap = await db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).orderBy('nombre').get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    console.error('[materiales] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch materials.', 500);
  }
});

router.post('/api/materiales-siembra', authenticate, rateLimit('materiales_siembra_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create materials.', 403);
    }
    const { error, data } = buildMaterialDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const ref = await db.collection('materiales_siembra').add({
      ...data,
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    console.error('[materiales] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create material.', 500);
  }
});

router.put('/api/materiales-siembra/:id', authenticate, rateLimit('materiales_siembra_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update materials.', 403);
    }
    const { error, data } = buildMaterialDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    const prev = doc.data();
    await doc.ref.update(data);
    // Audit renames/edits of shared catalog so a malicious encargado can't
    // silently corrupt historical reporting that joins on materialNombre.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.MATERIAL_SIEMBRA_UPDATE,
      target: { type: 'material_siembra', id: req.params.id },
      metadata: {
        before: {
          nombre: prev.nombre || null,
          variedad: prev.variedad || null,
          rangoPesos: prev.rangoPesos || null,
          densidadDefault: prev.densidadDefault || 0,
        },
        after: {
          nombre: data.nombre,
          variedad: data.variedad || null,
          rangoPesos: data.rangoPesos || null,
          densidadDefault: data.densidadDefault,
        },
      },
      severity: SEVERITY.INFO,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[materiales] update failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update material.', 500);
  }
});

router.delete('/api/materiales-siembra/:id', authenticate, rateLimit('materiales_siembra_write', 'write'), async (req, res) => {
  try {
    // Destructive op on a shared catalog — only supervisor or above.
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can delete materials.', 403);
    }
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    // FK guard: block delete if any siembra in this finca still references
    // this material. Without it, deletion leaves orphan materialId in
    // historical siembras and breaks pickers/filters that match by id.
    // Query on materialId alone (single-field auto-index — no composite
    // index needed) then double-check fincaId on the match for defense in depth.
    const refSnap = await db.collection('siembras')
      .where('materialId', '==', req.params.id)
      .limit(1)
      .get();
    if (!refSnap.empty && refSnap.docs[0].data().fincaId === req.fincaId) {
      return sendApiError(res, ERROR_CODES.RESOURCE_REFERENCED, 'Material is referenced by existing siembras.', 409);
    }
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
    console.error('[materiales] delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete material.', 500);
  }
});

module.exports = router;
