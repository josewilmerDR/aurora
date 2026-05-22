// CRUD del recurso siembras (registro de campo + cierre de bloque).
// Las mutaciones requieren encargado+. Reabrir un bloque cerrado y borrar
// un registro requieren supervisor (op privilegiada/destructiva) y emiten
// audit events para forense.

const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const {
  STR_LIMITS,
  isValidISODate,
  getResponsableFromUid,
  readSiembra,
} = require('./helpers');

const router = Router();

router.get('/api/siembras', authenticate, async (req, res) => {
  try {
    const { loteId, desde, hasta } = req.query;
    if (desde !== undefined && !isValidISODate(desde)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid "desde" date.', 400);
    if (hasta !== undefined && !isValidISODate(hasta)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid "hasta" date.', 400);
    if (loteId !== undefined && (typeof loteId !== 'string' || loteId.length > 64)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid loteId.', 400);
    let query = db.collection('siembras').where('fincaId', '==', req.fincaId);
    if (loteId) query = query.where('loteId', '==', loteId);
    if (desde)  query = query.where('fecha', '>=', Timestamp.fromDate(new Date(desde)));
    if (hasta)  query = query.where('fecha', '<=', Timestamp.fromDate(new Date(hasta)));
    const snap = await query.orderBy('fecha', 'desc').limit(300).get();
    const data = snap.docs.map(d => {
      const raw = d.data();
      return { id: d.id, ...raw, fecha: raw.fecha.toDate().toISOString(), fechaCierre: raw.fechaCierre ? raw.fechaCierre.toDate().toISOString() : null };
    });
    res.status(200).json(data);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch siembras.', 500);
  }
});

router.post('/api/siembras', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register siembras.', 403);
    }
    const { loteId, loteNombre, bloque, plantas, densidad, materialId, materialNombre, rangoPesos, variedad, cerrado, fecha } = req.body;
    if (!loteId || !fecha) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Lote and fecha are required.', 400);

    const plantCount = parseInt(plantas) || 0;
    const density = parseFloat(densidad) || 0;
    if (plantCount < 0 || plantCount > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Plants out of valid range.', 400);
    if (density < 0 || density > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Density out of valid range.', 400);
    for (const [field, max] of Object.entries(STR_LIMITS)) {
      const v = req.body[field];
      if (typeof v === 'string' && v.length > max) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `${field} too long.`, 400);
    }
    if (!isValidISODate(fecha)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid fecha.', 400);
    const loteSnap = await db.collection('lotes').doc(loteId).get();
    if (!loteSnap.exists || loteSnap.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Lote does not belong to this finca.', 400);
    }
    const bloqueNorm = (bloque || '').slice(0, 4);

    // Block invariant: cannot add a siembra to a (lote, bloque) pair that has
    // already been closed. The frontend guards this but a direct API call
    // would otherwise bypass it and corrupt historical records.
    if (bloqueNorm) {
      const closedSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloqueNorm)
        .where('cerrado', '==', true)
        .limit(1)
        .get();
      if (!closedSnap.empty) {
        return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot add a siembra to a closed bloque. Reopen it first.', 409);
      }
    }

    // Derive responsable from req.uid — never trust body-supplied values, which
    // would let a worker attribute records to a supervisor.
    const responsable = await getResponsableFromUid(req.uid, req.fincaId);

    const areaCalculada = density > 0 ? parseFloat((plantCount / density).toFixed(4)) : 0;
    const isClosed = cerrado === true || cerrado === 'true';
    const inputFechaCierre = req.body.fechaCierre;
    const fechaCierre = isClosed
      ? (inputFechaCierre && String(inputFechaCierre).trim()
          ? Timestamp.fromDate(new Date(String(inputFechaCierre).trim() + 'T12:00:00'))
          : Timestamp.now())
      : null;

    const ref = await db.collection('siembras').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      bloque: bloqueNorm,
      plantas: plantCount, densidad: density,
      areaCalculada,
      materialId: materialId || '',
      materialNombre: materialNombre || '',
      rangoPesos: rangoPesos || '',
      variedad: variedad || '',
      cerrado: isClosed,
      ...(fechaCierre && { fechaCierre }),
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      responsableId: responsable.id,
      responsableNombre: responsable.nombre,
      createdAt: Timestamp.now(),
    });

    if (isClosed) {
      const siblingsSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloqueNorm)
        .get();
      const batch = db.batch();
      siblingsSnap.docs.forEach(d => {
        if (d.id !== ref.id) batch.update(d.ref, { cerrado: true, fechaCierre });
      });
      await batch.commit();
    }

    res.status(201).json({ id: ref.id, areaCalculada });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register siembra.', 500);
  }
});

router.put('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update siembras.', 403);
    }
    const ALLOWED = ['fecha', 'loteId', 'loteNombre', 'bloque', 'plantas', 'densidad', 'materialId', 'materialNombre', 'rangoPesos', 'variedad', 'cerrado'];
    const updates = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.plantas !== undefined) {
      updates.plantas = parseInt(updates.plantas) || 0;
      if (updates.plantas < 0 || updates.plantas > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Plants out of valid range.', 400);
    }
    if (updates.densidad !== undefined) {
      updates.densidad = parseFloat(updates.densidad) || 0;
      if (updates.densidad < 0 || updates.densidad > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Density out of valid range.', 400);
    }
    for (const [field, max] of Object.entries(STR_LIMITS)) {
      const v = updates[field];
      if (typeof v === 'string' && v.length > max) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `${field} too long.`, 400);
    }
    if (updates.fecha !== undefined) {
      if (!isValidISODate(updates.fecha)) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid fecha.', 400);
      updates.fecha = Timestamp.fromDate(new Date(updates.fecha));
    }

    const needsDoc = updates.plantas !== undefined || updates.densidad !== undefined || updates.cerrado !== undefined;
    const doc = await db.collection('siembras').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Record not found.', 404);

    // P0: reopening a closed block requires supervisor (mirrors the UI gate so
    // a worker cannot bypass it via direct API call).
    const isReopening = updates.cerrado === false && doc.data().cerrado === true;
    if (isReopening) {
      if (!hasMinRoleBE(req.userRole, 'supervisor')) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only a supervisor can reopen a closed block.', 403);
      }
      const prev = doc.data();
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.SIEMBRA_BLOCK_REOPEN,
        target: { type: 'siembra', id: req.params.id },
        metadata: {
          loteId: prev.loteId || null,
          loteNombre: prev.loteNombre || null,
          bloque: prev.bloque || null,
          previousFechaCierre: prev.fechaCierre?.toDate ? prev.fechaCierre.toDate().toISOString() : null,
        },
        severity: SEVERITY.WARNING,
      });
    }

    // P2: if loteId is being changed, verify the new lote belongs to the same
    // finca (the existing fincaId check on the doc covers ownership of the
    // siembra record but not of the target lote).
    if (updates.loteId !== undefined && updates.loteId !== doc.data().loteId) {
      const newLoteSnap = await db.collection('lotes').doc(updates.loteId).get();
      if (!newLoteSnap.exists || newLoteSnap.data().fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Lote does not belong to this finca.', 400);
      }
    }
    if (needsDoc) {
      const current = doc.data();

      if (updates.plantas !== undefined || updates.densidad !== undefined) {
        const plantCount = parseInt(updates.plantas ?? current.plantas) || 0;
        const density = parseFloat(updates.densidad ?? current.densidad) || 0;
        updates.areaCalculada = density > 0 ? parseFloat((plantCount / density).toFixed(4)) : 0;
      }

      if (updates.cerrado !== undefined) {
        const fechaCierreUpdate = updates.cerrado === true ? Timestamp.now() : FieldValue.delete();
        const siblingsSnap = await db.collection('siembras')
          .where('fincaId', '==', current.fincaId)
          .where('loteId', '==', current.loteId)
          .where('bloque', '==', current.bloque)
          .get();
        const batch = db.batch();
        const thisId = req.params.id;
        siblingsSnap.docs.forEach(d => {
          const sibUpdates = d.id === thisId
            ? { ...updates, fechaCierre: fechaCierreUpdate }
            : { cerrado: updates.cerrado, fechaCierre: fechaCierreUpdate };
          batch.update(d.ref, sibUpdates);
        });
        await batch.commit();
        return res.status(200).json({ ok: true, record: await readSiembra(req.params.id) });
      }
    }

    await db.collection('siembras').doc(req.params.id).update(updates);
    res.status(200).json({ ok: true, record: await readSiembra(req.params.id) });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update siembra.', 500);
  }
});

router.delete('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('siembras').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Record not found.', 404);
    // P3: destructive op — require supervisor (mirrors the implicit expectation
    // that a worker shouldn't be able to wipe historical records via the API).
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only a supervisor can delete siembra records.', 403);
    }
    const prev = doc.data();
    await doc.ref.delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.SIEMBRA_DELETE,
      target: { type: 'siembra', id: req.params.id },
      metadata: {
        loteId: prev.loteId || null,
        loteNombre: prev.loteNombre || null,
        bloque: prev.bloque || null,
        plantas: prev.plantas || 0,
        densidad: prev.densidad || 0,
        materialId: prev.materialId || null,
        fecha: prev.fecha?.toDate ? prev.fecha.toDate().toISOString() : null,
        cerrado: prev.cerrado === true,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete siembra.', 500);
  }
});

module.exports = router;
