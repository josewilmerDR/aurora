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
  BULK_MAX_ROWS,
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

// POST /bulk — escribe N siembras en un solo batch atómico (todas o ninguna).
// Devuelve { results: [{ index, ok, id?, areaCalculada?, code?, message? }] }
// para que la UI sepa exactamente qué filas fallaron y las pueda mantener
// en el form para reintento. Las filas que no pasan validación pre-batch
// (Zod, ownership, bloque cerrado) marcan a la fila como falló pero no
// abortan el resto; el batch solo contiene las filas válidas.
//
// Nota de "transaccionalidad": Firestore batch.commit() es write-atomic
// (todas las writes del batch suceden o ninguna). El check de bloque cerrado
// se hace antes del batch (read-then-write), así que existe una ventana
// teórica donde otro user cierra el bloque entre el read y el commit.
// Para Aurora a la escala actual ese riesgo es aceptable; un upgrade futuro
// puede envolver todo en runTransaction si la concurrencia se vuelve tema.
router.post('/api/siembras/bulk', authenticate, rateLimit('siembras_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register siembras.', 403);
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'rows must be a non-empty array.', 400);
    }
    if (rows.length > BULK_MAX_ROWS) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Too many rows (max ${BULK_MAX_ROWS}).`, 400);
    }

    // Per-row validation. Failed rows carry their reason; valid rows carry
    // normalized data for the batch step below.
    const results = rows.map((row, index) => {
      const { error, data } = buildSiembraCreateDoc(row);
      if (error) return { index, ok: false, code: ERROR_CODES.VALIDATION_FAILED, message: error };
      return { index, ok: true, data, fechaCierreInput: row?.fechaCierre };
    });

    // Verify each unique loteId belongs to this finca (single read per lote).
    const uniqueLoteIds = [...new Set(results.filter(r => r.ok).map(r => r.data.loteId))];
    const loteSnaps = await Promise.all(
      uniqueLoteIds.map(id => db.collection('lotes').doc(id).get()),
    );
    const loteData = new Map();
    loteSnaps.forEach(snap => loteData.set(snap.id, snap.exists ? snap.data() : null));
    for (const r of results) {
      if (!r.ok) continue;
      const lote = loteData.get(r.data.loteId);
      if (!lote || lote.fincaId !== req.fincaId) {
        r.ok = false;
        r.code = ERROR_CODES.VALIDATION_FAILED;
        r.message = 'Lote does not belong to this finca.';
      }
    }

    // Check closed (lote, bloque) pairs. Group by key so we issue one query
    // per unique pair instead of one per row.
    const bloqueKeys = new Set();
    for (const r of results) {
      if (r.ok && r.data.bloque) bloqueKeys.add(`${r.data.loteId}__${r.data.bloque}`);
    }
    for (const key of bloqueKeys) {
      const [loteId, bloque] = key.split('__');
      const closedSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloque)
        .where('cerrado', '==', true)
        .limit(1)
        .get();
      if (!closedSnap.empty) {
        for (const r of results) {
          if (r.ok && r.data.loteId === loteId && r.data.bloque === bloque) {
            r.ok = false;
            r.code = ERROR_CODES.CONFLICT;
            r.message = 'Cannot add a siembra to a closed bloque. Reopen it first.';
          }
        }
      }
    }

    const valid = results.filter(r => r.ok);
    if (valid.length === 0) {
      return res.status(200).json({ results: results.map(stripInternalFields) });
    }

    // Derive responsable once (single read regardless of batch size).
    const responsable = await getResponsableFromUid(req.uid, req.fincaId);

    // Build the atomic batch.
    const batch = db.batch();
    const cascadeWork = []; // { loteId, bloque, newRefIds: Set, fechaCierre }
    const cascadeIndex = new Map();
    for (const r of valid) {
      const d = r.data;
      const areaCalculada = d.densidad > 0 ? parseFloat((d.plantas / d.densidad).toFixed(4)) : 0;
      const fechaCierre = d.cerrado
        ? (r.fechaCierreInput && String(r.fechaCierreInput).trim()
            ? Timestamp.fromDate(new Date(String(r.fechaCierreInput).trim() + 'T12:00:00'))
            : Timestamp.now())
        : null;
      const ref = db.collection('siembras').doc();
      batch.set(ref, {
        fincaId: req.fincaId,
        loteId: d.loteId,
        loteNombre: d.loteNombre,
        bloque: d.bloque,
        plantas: d.plantas,
        densidad: d.densidad,
        areaCalculada,
        materialId: d.materialId,
        materialNombre: d.materialNombre,
        rangoPesos: d.rangoPesos,
        variedad: d.variedad,
        cerrado: d.cerrado,
        ...(fechaCierre && { fechaCierre }),
        fecha: Timestamp.fromDate(new Date(d.fecha + 'T12:00:00')),
        responsableId: responsable.id,
        responsableNombre: responsable.nombre,
        createdAt: Timestamp.now(),
      });
      r.id = ref.id;
      r.areaCalculada = areaCalculada;

      if (d.cerrado && d.bloque) {
        const key = `${d.loteId}__${d.bloque}`;
        if (!cascadeIndex.has(key)) {
          const entry = { loteId: d.loteId, bloque: d.bloque, newRefIds: new Set(), fechaCierre };
          cascadeIndex.set(key, entry);
          cascadeWork.push(entry);
        }
        cascadeIndex.get(key).newRefIds.add(ref.id);
      }
    }

    await batch.commit();

    // Cascade-close siblings of any (lote, bloque) that has at least one
    // new cerrado=true row. Best-effort: an error here doesn't roll back
    // the primary batch (it already committed) but is logged.
    for (const entry of cascadeWork) {
      try {
        const siblingsSnap = await db.collection('siembras')
          .where('fincaId', '==', req.fincaId)
          .where('loteId', '==', entry.loteId)
          .where('bloque', '==', entry.bloque)
          .get();
        const cascadeBatch = db.batch();
        siblingsSnap.docs.forEach(d => {
          if (!entry.newRefIds.has(d.id)) {
            cascadeBatch.update(d.ref, { cerrado: true, fechaCierre: entry.fechaCierre });
          }
        });
        await cascadeBatch.commit();
      } catch (err) {
        console.error('[siembras/bulk] cascade-close failed', entry.loteId, entry.bloque, err);
      }
    }

    res.status(200).json({ results: results.map(stripInternalFields) });
  } catch (error) {
    console.error('[siembras/bulk] failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register siembras.', 500);
  }
});

// Don't leak internal scratch fields (data, fechaCierreInput) to the client.
function stripInternalFields(r) {
  if (r.ok) return { index: r.index, ok: true, id: r.id, areaCalculada: r.areaCalculada };
  return { index: r.index, ok: false, code: r.code, message: r.message };
}

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
