const { Router } = require('express');
const { db, Timestamp, FieldValue, FieldPath } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, sendNotificationWithLink, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

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
// Todos los endpoints requieren rol `encargado` o superior. Sin este gate, un
// trabajador autenticado podía enumerar/crear/modificar/borrar grupos vía API
// directa, saltándose el RoleRoute del frontend. Alineado con `/api/siembras`
// que ya tenía el mismo gate explícito.
router.get('/api/grupos', authenticate, async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read grupos.', 403);
        }
        const snapshot = await db.collection('grupos').where('fincaId', '==', req.fincaId).get();
        const grupos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(grupos);
    } catch (error) {
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch grupos.', 500);
    }
});

router.post('/api/grupos', authenticate, async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create grupos.', 403);
        }
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
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update grupos.', 403);
        }
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
            const tasksDeletedCount = tasksSnapshot.size;
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            // Audit del cambio destructivo: wipe + regen de scheduled_tasks por
            // cambio de paquete/fecha. Forensic value alto: si una cédula se
            // pierde porque el grupo cambió de paquete, queda el rastro de
            // quién y cuándo. Routine renames/cosecha/etapa changes NO entran
            // acá, alineado con la política del audit log.
            writeAuditEvent({
                fincaId: req.fincaId,
                actor: req,
                action: ACTIONS.GRUPO_PACKAGE_CHANGE,
                target: { type: 'grupo', id },
                metadata: {
                    nombreGrupo: originalData.nombreGrupo || null,
                    packageChange: hasPackageChanged ? {
                        from: originalData.paqueteId || null,
                        to: grupoData.paqueteId || null,
                    } : null,
                    muestreoPackageChange: hasMuestreoPackageChanged ? {
                        from: originalData.paqueteMuestreoId || null,
                        to: grupoData.paqueteMuestreoId || null,
                    } : null,
                    dateChange: hasDateChanged ? {
                        fromMs: originalData.fechaCreacion?.toMillis?.() || null,
                        toMs: grupoData.fechaCreacion?.toMillis?.() || null,
                    } : null,
                    tasksDeleted: tasksDeletedCount,
                },
                severity: SEVERITY.WARNING,
            });

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

// Listado de aplicaciones pendientes del grupo — usado por el moveModal del
// form de Grupos cuando se mueve un bloque desde un grupo "en aplicación
// activa". Permite mostrar el impacto concreto ("Quedarán pendientes:
// APL-4 (12 mar), APL-5 (19 mar)…") en vez del genérico "dejará de recibir
// las aplicaciones pendientes". Filtra tasks tipo REMINDER_DUE_DAY con
// status='pending', ordenadas por executeAt ascendente. Devuelve también
// los conteos completed/total por contexto, aunque el frontend ya los
// tiene de /api/siembras/disponibles, así el modal no tiene que cruzar
// dos fuentes.
router.get('/api/grupos/:id/aplicaciones-pendientes', authenticate, async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read grupo applications.', 403);
        }
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        const tasksSnap = await db.collection('scheduled_tasks')
            .where('grupoId', '==', id)
            .where('type', '==', 'REMINDER_DUE_DAY')
            .get();

        let completadas = 0;
        const pendientes = [];
        for (const doc of tasksSnap.docs) {
            const d = doc.data();
            if (d.status === 'completed_by_user' || d.status === 'skipped') {
                completadas++;
                continue;
            }
            if (d.status !== 'pending') continue;
            const activity = d.activity || {};
            pendientes.push({
                id: doc.id,
                activityName: activity.name || 'Aplicación',
                day: typeof activity.day === 'number' || typeof activity.day === 'string'
                    ? activity.day
                    : null,
                executeAt: d.executeAt?.toDate?.()?.toISOString() ?? null,
            });
        }
        // Orden cronológico: el usuario quiere ver primero lo que vence antes.
        pendientes.sort((a, b) => {
            if (!a.executeAt) return 1;
            if (!b.executeAt) return -1;
            return a.executeAt.localeCompare(b.executeAt);
        });

        res.json({
            pendientes,
            completadas,
            totales: completadas + pendientes.length,
        });
    } catch (error) {
        console.error('Error fetching aplicaciones pendientes:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch pending applications.', 500);
    }
});

router.get('/api/grupos/:id/delete-check', authenticate, async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can check grupo dependencies.', 403);
        }
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
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can delete grupos.', 403);
        }
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        // verifyOwnership ya nos dio el doc; reutilizamos prevData para metadata
        // del audit event y evitamos un segundo get() redundante.
        const prevData = ownership.doc.data();
        const snap_grupoNombre = prevData.nombreGrupo || '';

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
        let pendingCedulasDeleted = 0;

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
                pendingCedulasDeleted += cSnap.size;
            }
            pendingTasks.forEach(doc => batch.delete(doc.ref));
        }

        batch.delete(db.collection('grupos').doc(id));
        await batch.commit();

        // Audit del delete: operación irreversible que libera bloques al pool
        // "Sin grupo", borra cedulas pendientes y scheduled_tasks pendientes,
        // y deja tareas históricas con snap_grupoNombre apuntando a un grupo
        // que ya no existe. Mismo patrón que LOTE_DELETE en plots.js.
        writeAuditEvent({
            fincaId: req.fincaId,
            actor: req,
            action: ACTIONS.GRUPO_DELETE,
            target: { type: 'grupo', id },
            metadata: {
                nombreGrupo: prevData.nombreGrupo || null,
                cosecha: prevData.cosecha || null,
                etapa: prevData.etapa || null,
                bloquesCount: Array.isArray(prevData.bloques) ? prevData.bloques.length : 0,
                paqueteId: prevData.paqueteId || null,
                paqueteMuestreoId: prevData.paqueteMuestreoId || null,
                pendingTasksDeleted: pendingTasks.length,
                pendingCedulasDeleted,
                completedTasksKept: completedTasks.length,
            },
            severity: SEVERITY.WARNING,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error deleting grupo:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete grupo.', 500);
    }
});

// Anular cédulas en tránsito y eliminar el grupo en un solo round-trip.
//
// Reemplaza el flujo previo del cliente que iteraba PUT /api/cedulas/:id/anular
// por cada cédula y luego llamaba DELETE /api/grupos/:id. Ese flujo dejaba
// el estado parcialmente mutado ante cualquier fallo intermedio (cédulas
// anuladas + inventario revertido + grupo intacto), sin rollback.
//
// Reglas:
//  - Si hay alguna cédula 'aplicada_en_campo' bajo este grupo, 409 — igual
//    que el DELETE estándar. El cliente debe haber chequeado /delete-check
//    antes; este guard es defensa en profundidad contra races.
//  - Cada cédula 'en_transito' revierte inventario como en void.js: suma
//    stockActual por producto e inserta un movimiento 'ingreso' compensatorio
//    por cada egreso original (preservación del ledger).
//  - No se persiste status='anulada' en las cédulas porque inmediatamente
//    después se borran junto con sus pending tasks (mismo comportamiento
//    que DELETE estándar — borra todo lo que cuelga de pending tasks).
//  - Audit: 1 CEDULA_VOID por cédula con inventario revertido +
//    1 GRUPO_DELETE final con metadata extendida.
//
// Chunking: Firestore limita 500 ops por batch. Las ops se acumulan en una
// lista plana y se comitean en grupos de 450 (margen). Cross-chunk no es
// atómico, pero el endpoint es idempotente: si una segunda corrida ve las
// mismas cédulas ya con status='en_transito' false (porque ya no existen),
// el flujo se completa sin re-revertir inventario.
router.post('/api/grupos/:id/anular-y-eliminar', authenticate, async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can delete grupos.', 403);
        }
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

        const prevData = ownership.doc.data();
        const snap_grupoNombre = prevData.nombreGrupo || '';

        // ── 1. Read: tasks del grupo ───────────────────────────────────
        const allTasksSnap = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
        const pendingTasks    = allTasksSnap.docs.filter(d => d.data().status === 'pending');
        const completedTasks  = allTasksSnap.docs.filter(d => d.data().status !== 'pending');
        const pendingTaskIds  = pendingTasks.map(d => d.id);

        // ── 2. Read: cédulas asociadas + bloqueo si hay aplicada_en_campo
        const cedulasAsociadas  = [];        // todas se borran junto con sus tasks
        const cedulasEnTransito = [];        // subset que necesita reversión de inventario

        if (pendingTaskIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < pendingTaskIds.length; i += 10) chunks.push(pendingTaskIds.slice(i, i + 10));
            for (const chunk of chunks) {
                const cSnap = await db.collection('cedulas').where('taskId', 'in', chunk).get();
                for (const doc of cSnap.docs) {
                    const d = doc.data();
                    if (d.status === 'aplicada_en_campo') {
                        return sendApiError(res, 'CEDULA_APLICADA',
                            `Cannot delete: cedula ${d.consecutivo || doc.id} already applied in field.`, 409);
                    }
                    cedulasAsociadas.push(doc);
                    if (d.status === 'en_transito') cedulasEnTransito.push({ doc, data: d });
                }
            }
        }

        // ── 3. Read: movimientos por cada cédula a revertir ────────────
        const cedulaMovs = new Map();
        for (const { doc } of cedulasEnTransito) {
            const movSnap = await db.collection('movimientos')
                .where('cedulaId', '==', doc.id)
                .where('fincaId', '==', req.fincaId)
                .get();
            cedulaMovs.set(doc.id, movSnap.docs);
        }

        // ── 4. Build ops + audit events diferidos ──────────────────────
        const ops = [];
        const cedulaAuditEvents = [];

        for (const { doc: cedDoc, data: cedData } of cedulasEnTransito) {
            const movs = cedulaMovs.get(cedDoc.id) || [];
            const reversalPorProducto = {};
            for (const mov of movs) {
                const d = mov.data();
                if (d.tipo === 'egreso' && d.productoId) {
                    reversalPorProducto[d.productoId] = (reversalPorProducto[d.productoId] || 0) + d.cantidad;
                }
            }
            for (const [productoId, total] of Object.entries(reversalPorProducto)) {
                const ref = db.collection('productos').doc(productoId);
                ops.push(b => b.update(ref, { stockActual: FieldValue.increment(total) }));
            }
            for (const mov of movs) {
                const d = mov.data();
                if (d.tipo !== 'egreso') continue;
                const newRef = db.collection('movimientos').doc();
                ops.push(b => b.set(newRef, {
                    tipo: 'ingreso',
                    productoId: d.productoId,
                    nombreComercial: d.nombreComercial,
                    cantidad: d.cantidad,
                    unidad: d.unidad,
                    fecha: Timestamp.now(),
                    motivo: `Anulación cédula ${cedData.consecutivo} (eliminación de grupo)`,
                    tareaId: cedData.taskId,
                    cedulaId: cedDoc.id,
                    cedulaConsecutivo: cedData.consecutivo,
                    loteId: d.loteId || null,
                    grupoId: d.grupoId || null,
                    loteNombre: d.loteNombre || '',
                    fincaId: req.fincaId,
                }));
            }
            cedulaAuditEvents.push({
                action: ACTIONS.CEDULA_VOID,
                target: { type: 'cedula', id: cedDoc.id },
                metadata: {
                    consecutivo: cedData.consecutivo || null,
                    taskId: cedData.taskId,
                    previousStatus: 'en_transito',
                    reversalCount: Object.keys(reversalPorProducto).length,
                    taskClosedAs: null,
                    context: 'grupo_anular_y_eliminar',
                },
                severity: SEVERITY.WARNING,
            });
        }

        // Snap nombre del grupo en tasks históricas
        for (const t of completedTasks) {
            ops.push(b => b.update(t.ref, { snap_grupoNombre }));
        }
        // Borrar todas las cédulas asociadas a pending tasks
        for (const c of cedulasAsociadas) {
            ops.push(b => b.delete(c.ref));
        }
        // Borrar pending tasks
        for (const t of pendingTasks) {
            ops.push(b => b.delete(t.ref));
        }
        // Borrar el grupo
        ops.push(b => b.delete(db.collection('grupos').doc(id)));

        // ── 5. Commit en chunks de 450 ops ─────────────────────────────
        const BATCH_SIZE = 450;
        for (let i = 0; i < ops.length; i += BATCH_SIZE) {
            const batch = db.batch();
            for (const op of ops.slice(i, i + BATCH_SIZE)) op(batch);
            await batch.commit();
        }

        // ── 6. Audit ───────────────────────────────────────────────────
        for (const ev of cedulaAuditEvents) {
            writeAuditEvent({ fincaId: req.fincaId, actor: req, ...ev });
        }
        writeAuditEvent({
            fincaId: req.fincaId,
            actor: req,
            action: ACTIONS.GRUPO_DELETE,
            target: { type: 'grupo', id },
            metadata: {
                nombreGrupo: prevData.nombreGrupo || null,
                cosecha: prevData.cosecha || null,
                etapa: prevData.etapa || null,
                bloquesCount: Array.isArray(prevData.bloques) ? prevData.bloques.length : 0,
                paqueteId: prevData.paqueteId || null,
                paqueteMuestreoId: prevData.paqueteMuestreoId || null,
                pendingTasksDeleted: pendingTasks.length,
                pendingCedulasDeleted: cedulasAsociadas.length,
                cedulasAnuladas: cedulasEnTransito.length,
                completedTasksKept: completedTasks.length,
                context: 'anular_y_eliminar',
            },
            severity: SEVERITY.WARNING,
        });

        res.status(200).json({
            ok: true,
            cedulasAnuladas: cedulasEnTransito.length,
            pendingCedulasDeleted: cedulasAsociadas.length,
            pendingTasksDeleted: pendingTasks.length,
        });
    } catch (error) {
        console.error('Error en anular-y-eliminar grupo:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to void cedulas and delete grupo.', 500);
    }
});

module.exports = router;
