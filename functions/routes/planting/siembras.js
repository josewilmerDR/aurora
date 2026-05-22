// CRUD del recurso siembras (registro de campo + cierre de bloque).
// Las mutaciones requieren encargado+. Reabrir un bloque cerrado y borrar
// un registro requieren supervisor (op privilegiada/destructiva) y emiten
// audit events para forense.

const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { getResponsableFromUid, readSiembra } = require('./helpers');
const {
  buildSiembraCreateDoc,
  buildSiembraUpdateDoc,
  buildSiembraListFilters,
} = require('./schemas');

const router = Router();

router.get('/api/siembras', authenticate, async (req, res) => {
  try {
    const { error, data: filters } = buildSiembraListFilters(req.query);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const { loteId, desde, hasta } = filters;
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

router.post('/api/siembras', authenticate, rateLimit('siembras_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register siembras.', 403);
    }
    const { error, data: input } = buildSiembraCreateDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    const loteSnap = await db.collection('lotes').doc(input.loteId).get();
    if (!loteSnap.exists || loteSnap.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Lote does not belong to this finca.', 400);
    }

    // Block invariant: cannot add a siembra to a (lote, bloque) pair that has
    // already been closed. The frontend guards this but a direct API call
    // would otherwise bypass it and corrupt historical records.
    if (input.bloque) {
      const closedSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', input.loteId)
        .where('bloque', '==', input.bloque)
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

    const areaCalculada = input.densidad > 0
      ? parseFloat((input.plantas / input.densidad).toFixed(4))
      : 0;
    const inputFechaCierre = req.body.fechaCierre;
    const fechaCierre = input.cerrado
      ? (inputFechaCierre && String(inputFechaCierre).trim()
          ? Timestamp.fromDate(new Date(String(inputFechaCierre).trim() + 'T12:00:00'))
          : Timestamp.now())
      : null;

    const ref = await db.collection('siembras').add({
      fincaId: req.fincaId,
      loteId: input.loteId,
      loteNombre: input.loteNombre,
      bloque: input.bloque,
      plantas: input.plantas,
      densidad: input.densidad,
      areaCalculada,
      materialId: input.materialId,
      materialNombre: input.materialNombre,
      rangoPesos: input.rangoPesos,
      variedad: input.variedad,
      cerrado: input.cerrado,
      ...(fechaCierre && { fechaCierre }),
      fecha: Timestamp.fromDate(new Date(input.fecha + 'T12:00:00')),
      responsableId: responsable.id,
      responsableNombre: responsable.nombre,
      createdAt: Timestamp.now(),
    });

    if (input.cerrado) {
      const siblingsSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', input.loteId)
        .where('bloque', '==', input.bloque)
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
    const { error, data: updates } = buildSiembraUpdateDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    if (updates.fecha !== undefined) {
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
