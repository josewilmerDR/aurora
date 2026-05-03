const { Router } = require('express');
const { db, Timestamp, FieldValue, FieldPath } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, sendNotificationWithLink } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ─── Block transitions ───────────────────────────────────────────────────────
// When a grupo is created or updated with bloques (siembraIds) that currently
// belong to another grupo, we (a) remove them from their origin grupos and
// (b) write a `block_transitions` record per origin → destination pair for
// traceability. Computed BEFORE the destination grupo is written so we can
// stage everything in a single Firestore batch where possible.

async function findBlockOrigins(fincaId, newBloques, destinationGrupoId) {
  if (!Array.isArray(newBloques) || newBloques.length === 0) return [];
  const gruposSnap = await db.collection('grupos').where('fincaId', '==', fincaId).get();
  const transitions = [];
  for (const g of gruposSnap.docs) {
    if (g.id === destinationGrupoId) continue;
    const data = g.data();
    const owned = Array.isArray(data.bloques) ? data.bloques : [];
    const moved = owned.filter(id => newBloques.includes(id));
    if (moved.length > 0) {
      transitions.push({
        origenGrupoId: g.id,
        origenGrupoNombre: data.nombreGrupo || '',
        siembraIds: moved,
      });
    }
  }
  return transitions;
}

async function applyBlockTransitions({ fincaId, transitions, destGrupoId, destGrupoNombre, req }) {
  if (transitions.length === 0) return;

  // Resolve user identity for the audit trail.
  let usuarioId = null;
  let usuarioNombre = req.userEmail || 'Sistema';
  try {
    const userSnap = await db.collection('users')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', fincaId)
      .limit(1).get();
    if (!userSnap.empty) {
      usuarioId = userSnap.docs[0].id;
      usuarioNombre = userSnap.docs[0].data().nombre || usuarioNombre;
    }
  } catch (err) {
    console.warn('[transitions] Could not resolve user for audit:', err.message);
  }

  // Fetch siembra metadata so each transition record carries
  // human-readable lote/bloque descriptions (Firestore "in" caps at 30).
  const allSiembraIds = transitions.flatMap(t => t.siembraIds);
  const siembraMap = new Map();
  for (let i = 0; i < allSiembraIds.length; i += 30) {
    const chunk = allSiembraIds.slice(i, i + 30);
    const snap = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
    snap.docs.forEach(d => siembraMap.set(d.id, d.data()));
  }

  const batch = db.batch();
  const now = Timestamp.now();

  for (const t of transitions) {
    // Remove blocks from origin grupo's bloques[].
    batch.update(db.collection('grupos').doc(t.origenGrupoId), {
      bloques: FieldValue.arrayRemove(...t.siembraIds),
    });

    // Build de-duplicated lote+bloque description list for this transition.
    const bloqueMap = new Map();
    for (const sid of t.siembraIds) {
      const sdata = siembraMap.get(sid);
      if (!sdata) continue;
      const key = `${sdata.loteId}__${sdata.bloque}`;
      if (!bloqueMap.has(key)) {
        bloqueMap.set(key, {
          loteId: sdata.loteId || '',
          loteNombre: sdata.loteNombre || '',
          bloque: sdata.bloque || '',
        });
      }
    }

    const transitionRef = db.collection('block_transitions').doc();
    batch.set(transitionRef, {
      fincaId,
      siembraIds: t.siembraIds,
      bloquesDescritos: [...bloqueMap.values()],
      origenGrupoId: t.origenGrupoId,
      origenGrupoNombre: t.origenGrupoNombre,
      destinoGrupoId: destGrupoId,
      destinoGrupoNombre: destGrupoNombre,
      fecha: now,
      usuarioId,
      usuarioUid: req.uid,
      usuarioNombre,
      usuarioEmail: req.userEmail || '',
    });
  }

  await batch.commit();
}

const MAX_NOMBRE_LEN    = 16;
const MAX_CATALOG_LEN   = 32;
const MAX_FUTURE_DAYS   = 15;
const MAX_BLOQUES       = 500;

function validateGrupoBody(body, { requireFields = false } = {}) {
    const errors = [];
    const { nombreGrupo, cosecha, etapa, fechaCreacion, bloques, paqueteId, paqueteMuestreoId } = body;

    if (requireFields) {
        if (typeof nombreGrupo !== 'string' || !nombreGrupo.trim()) errors.push('nombreGrupo is required.');
        if (!fechaCreacion) errors.push('fechaCreacion is required.');
    }

    if (nombreGrupo !== undefined) {
        if (typeof nombreGrupo !== 'string') errors.push('nombreGrupo must be a string.');
        else if (nombreGrupo.trim().length > MAX_NOMBRE_LEN) errors.push(`nombreGrupo max ${MAX_NOMBRE_LEN} characters.`);
    }

    if (cosecha !== undefined && cosecha !== '') {
        if (typeof cosecha !== 'string') errors.push('cosecha must be a string.');
        else if (cosecha.length > MAX_CATALOG_LEN) errors.push(`cosecha max ${MAX_CATALOG_LEN} characters.`);
    }

    if (etapa !== undefined && etapa !== '') {
        if (typeof etapa !== 'string') errors.push('etapa must be a string.');
        else if (etapa.length > MAX_CATALOG_LEN) errors.push(`etapa max ${MAX_CATALOG_LEN} characters.`);
    }

    if (fechaCreacion !== undefined) {
        const d = new Date(fechaCreacion);
        if (isNaN(d.getTime())) {
            errors.push('fechaCreacion is not a valid date.');
        } else {
            const limit = new Date();
            limit.setDate(limit.getDate() + MAX_FUTURE_DAYS);
            limit.setHours(23, 59, 59, 999);
            if (d > limit) errors.push(`fechaCreacion cannot exceed ${MAX_FUTURE_DAYS} days in the future.`);
        }
    }

    if (bloques !== undefined) {
        if (!Array.isArray(bloques)) errors.push('bloques must be an array.');
        else if (bloques.length > MAX_BLOQUES) errors.push(`bloques cannot exceed ${MAX_BLOQUES} elements.`);
        else if (bloques.some(b => typeof b !== 'string')) errors.push('Each bloque must be a string ID.');
    }

    if (paqueteId !== undefined && paqueteId !== '' && typeof paqueteId !== 'string') errors.push('paqueteId must be a string.');
    if (paqueteMuestreoId !== undefined && paqueteMuestreoId !== '' && typeof paqueteMuestreoId !== 'string') errors.push('paqueteMuestreoId must be a string.');

    return errors;
}

// --- API ENDPOINTS: GRUPOS ---
router.get('/api/grupos', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('grupos').where('fincaId', '==', req.fincaId).get();
        const grupos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(grupos);
    } catch (error) {
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch grupos.', 500);
    }
});

router.post('/api/grupos', authenticate, async (req, res) => {
    try {
        const validationErrors = validateGrupoBody(req.body, { requireFields: true });
        if (validationErrors.length) {
            return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationErrors.join(' '), 400);
        }

        const { nombreGrupo, cosecha, etapa, fechaCreacion, bloques, paqueteId, paqueteMuestreoId } = req.body;
        const incomingBloques = Array.isArray(bloques) ? bloques : [];

        // Detect blocks that currently belong to another grupo so we can
        // remove them from their origin and audit the transition.
        const transitions = await findBlockOrigins(req.fincaId, incomingBloques, null);

        const grupoRef = await db.collection('grupos').add({
            nombreGrupo: nombreGrupo.trim(),
            cosecha: (cosecha || '').trim(),
            etapa: (etapa || '').trim(),
            fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
            bloques: incomingBloques,
            paqueteId: paqueteId || '',
            paqueteMuestreoId: paqueteMuestreoId || '',
            fincaId: req.fincaId,
        });

        if (transitions.length > 0) {
            await applyBlockTransitions({
                fincaId: req.fincaId,
                transitions,
                destGrupoId: grupoRef.id,
                destGrupoNombre: nombreGrupo.trim(),
                req,
            });
        }

        // If a package is assigned, create tasks (same logic as lotes)
        if (paqueteId) {
            const paqueteDoc = await db.collection('packages').doc(paqueteId).get();
            if (paqueteDoc.exists) {
                const paqueteData = paqueteDoc.data();
                const grupoCreationDate = new Date(fechaCreacion);
                const tasksBatch = db.batch();
                const tasksForImmediateNotification = [];

                for (const activity of paqueteData.activities) {
                    const activityDay = parseInt(activity.day);
                    const activityDate = new Date(grupoCreationDate);
                    activityDate.setDate(grupoCreationDate.getDate() + activityDay);

                    const reminderDate = new Date(activityDate);
                    reminderDate.setDate(reminderDate.getDate() - 3);

                    const reminderTaskRef = db.collection('scheduled_tasks').doc();
                    tasksBatch.set(reminderTaskRef, {
                        type: 'REMINDER_3_DAY',
                        executeAt: Timestamp.fromDate(reminderDate),
                        grupoId: grupoRef.id,
                        activity,
                        status: 'pending',
                        fincaId: req.fincaId,
                    });

                    const dueTaskRef = db.collection('scheduled_tasks').doc();
                    const dueTaskData = {
                        type: 'REMINDER_DUE_DAY',
                        executeAt: Timestamp.fromDate(activityDate),
                        grupoId: grupoRef.id,
                        activity,
                        status: 'pending',
                        fincaId: req.fincaId,
                    };
                    tasksBatch.set(dueTaskRef, dueTaskData);

                    if (activityDay >= 0 && activityDay <= 3) {
                        tasksForImmediateNotification.push({ ref: dueTaskRef, data: dueTaskData });
                    }
                }

                await tasksBatch.commit();

                for (const taskToNotify of tasksForImmediateNotification) {
                    await sendNotificationWithLink(taskToNotify.ref, taskToNotify.data, nombreGrupo);
                }

            }
        }

        // If a monitoring package is assigned, create monitoring orders
        if (paqueteMuestreoId) {
            const muestreoDoc = await db.collection('monitoreo_paquetes').doc(paqueteMuestreoId).get();
            if (muestreoDoc.exists) {
                const muestreoData = muestreoDoc.data();
                const grupoCreationDate = new Date(fechaCreacion);
                const muestreoBatch = db.batch();
                for (const activity of muestreoData.activities || []) {
                    const activityDate = new Date(grupoCreationDate);
                    activityDate.setDate(grupoCreationDate.getDate() + parseInt(activity.day));
                    const taskRef = db.collection('scheduled_tasks').doc();
                    muestreoBatch.set(taskRef, {
                        type: 'MUESTREO',
                        executeAt: Timestamp.fromDate(activityDate),
                        grupoId: grupoRef.id,
                        paqueteMuestreoId,
                        activity,
                        nota: '',
                        status: 'pending',
                        fincaId: req.fincaId,
                    });
                }
                await muestreoBatch.commit();
            }
        }

        res.status(201).json({ id: grupoRef.id, code: 'GRUPO_CREATED' });
    } catch (error) {
        console.error('[ERROR] Creating grupo:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create grupo.', 500);
    }
});

router.put('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const validationErrors = validateGrupoBody(req.body);
        if (validationErrors.length) {
            return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationErrors.join(' '), 400);
        }

        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        const grupoData = pick(req.body, ['nombreGrupo', 'cosecha', 'etapa', 'fechaCreacion', 'bloques', 'paqueteId', 'paqueteMuestreoId']);
        const originalData = ownership.doc.data();

        if (grupoData.nombreGrupo !== undefined) grupoData.nombreGrupo = grupoData.nombreGrupo.trim();
        if (grupoData.cosecha !== undefined) grupoData.cosecha = (grupoData.cosecha || '').trim();
        if (grupoData.etapa !== undefined) grupoData.etapa = (grupoData.etapa || '').trim();

        if (grupoData.fechaCreacion && typeof grupoData.fechaCreacion === 'string') {
            grupoData.fechaCreacion = Timestamp.fromDate(new Date(grupoData.fechaCreacion));
        }

        // If the bloques array changed, detect transitions from other grupos
        // BEFORE we write our own update — applyBlockTransitions runs after
        // and uses arrayRemove, so it works regardless of write order, but
        // we want the transition records to reference the new destination
        // name if it was renamed in the same request.
        let transitions = [];
        if (Array.isArray(grupoData.bloques)) {
            transitions = await findBlockOrigins(req.fincaId, grupoData.bloques, id);
        }

        await db.collection('grupos').doc(id).update(grupoData);

        if (transitions.length > 0) {
            const destNombre = grupoData.nombreGrupo !== undefined
                ? grupoData.nombreGrupo
                : (originalData.nombreGrupo || '');
            await applyBlockTransitions({
                fincaId: req.fincaId,
                transitions,
                destGrupoId: id,
                destGrupoNombre: destNombre,
                req,
            });
        }

        const hasDateChanged = grupoData.fechaCreacion != null
            && originalData.fechaCreacion?.toMillis() !== grupoData.fechaCreacion?.toMillis();
        const hasPackageChanged = grupoData.paqueteId != null
            && originalData.paqueteId !== grupoData.paqueteId;
        const hasMuestreoPackageChanged = grupoData.paqueteMuestreoId != null
            && originalData.paqueteMuestreoId !== grupoData.paqueteMuestreoId;

        if (hasDateChanged || hasPackageChanged || hasMuestreoPackageChanged) {
            // Delete previous tasks for this grupo
            const tasksSnapshot = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            // Create new application tasks if there is a technical package
            if (grupoData.paqueteId) {
                const paqueteDoc = await db.collection('packages').doc(grupoData.paqueteId).get();
                if (paqueteDoc.exists) {
                    const paqueteData = paqueteDoc.data();
                    const grupoCreationDate = grupoData.fechaCreacion.toDate();
                    const tasksBatch = db.batch();

                    for (const activity of paqueteData.activities) {
                        const activityDate = new Date(grupoCreationDate);
                        activityDate.setDate(grupoCreationDate.getDate() + parseInt(activity.day));
                        const reminderDate = new Date(activityDate);
                        reminderDate.setDate(reminderDate.getDate() - 3);

                        const reminderRef = db.collection('scheduled_tasks').doc();
                        tasksBatch.set(reminderRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), grupoId: id, activity, status: 'pending', fincaId: req.fincaId });

                        const dueRef = db.collection('scheduled_tasks').doc();
                        tasksBatch.set(dueRef, { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), grupoId: id, activity, status: 'pending', fincaId: req.fincaId });
                    }
                    await tasksBatch.commit();
                }
            }

            // Create new monitoring orders if there is a monitoring package
            if (grupoData.paqueteMuestreoId) {
                const muestreoDoc = await db.collection('monitoreo_paquetes').doc(grupoData.paqueteMuestreoId).get();
                if (muestreoDoc.exists) {
                    const muestreoData = muestreoDoc.data();
                    const grupoCreationDate = grupoData.fechaCreacion.toDate();
                    const muestreoBatch = db.batch();
                    for (const activity of muestreoData.activities || []) {
                        const activityDate = new Date(grupoCreationDate);
                        activityDate.setDate(grupoCreationDate.getDate() + parseInt(activity.day));
                        const taskRef = db.collection('scheduled_tasks').doc();
                        muestreoBatch.set(taskRef, {
                            type: 'MUESTREO',
                            executeAt: Timestamp.fromDate(activityDate),
                            grupoId: id,
                            paqueteMuestreoId: grupoData.paqueteMuestreoId,
                            activity,
                            nota: '',
                            status: 'pending',
                            fincaId: req.fincaId,
                        });
                    }
                    await muestreoBatch.commit();
                }
            }
        }

        res.status(200).json({ id, ...grupoData });
    } catch (error) {
        console.error('Error updating grupo:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update grupo.', 500);
    }
});

router.get('/api/grupos/:id/delete-check', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        const tasksSnap = await db.collection('scheduled_tasks')
            .where('grupoId', '==', id)
            .where('status', '==', 'pending')
            .get();

        const pendingTaskIds = tasksSnap.docs.map(d => d.id);
        const cedulasAplicadas = [];
        const cedulasEnTransito = [];

        if (pendingTaskIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < pendingTaskIds.length; i += 10) chunks.push(pendingTaskIds.slice(i, i + 10));
            for (const chunk of chunks) {
                const cSnap = await db.collection('cedulas').where('taskId', 'in', chunk).get();
                cSnap.docs.forEach(doc => {
                    const d = doc.data();
                    if (d.status === 'aplicada_en_campo') {
                        cedulasAplicadas.push({ id: doc.id, consecutivo: d.consecutivo, lote: d.splitLoteNombre || null });
                    } else if (d.status === 'en_transito') {
                        cedulasEnTransito.push({ id: doc.id, consecutivo: d.consecutivo, lote: d.splitLoteNombre || null });
                    }
                });
            }
        }

        res.json({ cedulasAplicadas, cedulasEnTransito });
    } catch (error) {
        console.error('Error checking grupo delete:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to check dependencies.', 500);
    }
});

router.delete('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        const grupoDoc = await db.collection('grupos').doc(id).get();
        const snap_grupoNombre = grupoDoc.data()?.nombreGrupo || '';

        const allTasksSnap = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
        const pendingTasks    = allTasksSnap.docs.filter(d => d.data().status === 'pending');
        const completedTasks  = allTasksSnap.docs.filter(d => d.data().status !== 'pending');
        const pendingTaskIds  = pendingTasks.map(d => d.id);

        // Reject if there are cedulas in a blocking state
        if (pendingTaskIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < pendingTaskIds.length; i += 10) chunks.push(pendingTaskIds.slice(i, i + 10));
            for (const chunk of chunks) {
                const cSnap = await db.collection('cedulas').where('taskId', 'in', chunk).get();
                for (const doc of cSnap.docs) {
                    const s = doc.data().status;
                    if (s === 'aplicada_en_campo') return sendApiError(res, 'CEDULA_APLICADA', 'There are cedulas applied in the field.', 409);
                    if (s === 'en_transito')      return sendApiError(res, 'CEDULA_EN_TRANSITO', 'There are cedulas in "Mezcla lista" state.', 409);
                }
            }
        }

        const batch = db.batch();

        // Snapshot the grupo name in completed/skipped tasks (history)
        completedTasks.forEach(doc => {
            batch.update(doc.ref, { snap_grupoNombre });
        });

        // Delete pending cedulas for pending tasks, then the pending tasks themselves
        if (pendingTaskIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < pendingTaskIds.length; i += 10) chunks.push(pendingTaskIds.slice(i, i + 10));
            for (const chunk of chunks) {
                const cSnap = await db.collection('cedulas').where('taskId', 'in', chunk).get();
                cSnap.docs.forEach(doc => batch.delete(doc.ref));
            }
            pendingTasks.forEach(doc => batch.delete(doc.ref));
        }

        batch.delete(db.collection('grupos').doc(id));
        await batch.commit();

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error deleting grupo:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete grupo.', 500);
    }
});

module.exports = router;
