const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, writeFeedEvent, sendNotificationWithLink } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: LOTES ---
router.get('/api/lotes', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('lotes').where('fincaId', '==', req.fincaId).get();
    const lotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lotes);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch lotes.', 500);
  }
});

router.post('/api/lotes', authenticate, async (req, res) => {
    const codigoLote = typeof req.body.codigoLote === 'string' ? req.body.codigoLote.trim() : '';
    const nombreLote = typeof req.body.nombreLote === 'string' ? req.body.nombreLote.trim() : '';
    const { fechaCreacion, paqueteId, hectareas } = req.body;

    if (!codigoLote || !fechaCreacion) {
        return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'codigoLote and fechaCreacion are required.', 400);
    }
    if (codigoLote.length > 16) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'codigoLote cannot exceed 16 characters.', 400);
    }
    if (nombreLote.length > 32) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'nombreLote cannot exceed 32 characters.', 400);
    }
    const parsedDate = new Date(fechaCreacion);
    if (isNaN(parsedDate.getTime())) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid creation date.', 400);
    }
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (parsedDate > today) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Creation date cannot be in the future.', 400);
    }

    // If no package, create an empty lote (without tasks)
    if (!paqueteId) {
        try {
            const loteRef = await db.collection('lotes').add({
                codigoLote,
                ...(nombreLote ? { nombreLote } : {}),
                fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
                hectareas: parseFloat(hectareas) || 0,
                fincaId: req.fincaId,
            });
            writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'lote_created', title: nombreLote || codigoLote, loteNombre: nombreLote || codigoLote });
            return res.status(201).json({ id: loteRef.id, code: 'LOTE_CREATED' });
        } catch (error) {
            console.error("[ERROR] Creating lote without package:", error);
            return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create lote.', 500);
        }
    }

    try {
        const loteRef = await db.collection('lotes').add({ codigoLote, ...(nombreLote ? { nombreLote } : {}), fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)), paqueteId, hectareas: parseFloat(hectareas) || 1, fincaId: req.fincaId });
        const paqueteDoc = await db.collection('packages').doc(paqueteId).get();
        if (!paqueteDoc.exists) throw new Error('Package not found');
        const paqueteData = paqueteDoc.data();

        const loteCreationDate = new Date(fechaCreacion);
        const tasksBatch = db.batch();
        const tasksForImmediateNotification = [];

        for (const activity of paqueteData.activities) {
            const activityDay = parseInt(activity.day);
            const activityDate = new Date(loteCreationDate);
            activityDate.setDate(loteCreationDate.getDate() + activityDay);

            const reminderDate = new Date(activityDate);
            reminderDate.setDate(reminderDate.getDate() - 3);

            const reminderTaskRef = db.collection('scheduled_tasks').doc();
            tasksBatch.set(reminderTaskRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), loteId: loteRef.id, activity, status: 'pending', fincaId: req.fincaId });

            const dueTaskRef = db.collection('scheduled_tasks').doc();
            const dueTaskData = { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), loteId: loteRef.id, activity, status: 'pending', fincaId: req.fincaId };
            tasksBatch.set(dueTaskRef, dueTaskData);

            if (activityDay >= 0 && activityDay <= 3) {
                tasksForImmediateNotification.push({ ref: dueTaskRef, data: dueTaskData });
            }
        }

        await tasksBatch.commit();

        for (const taskToNotify of tasksForImmediateNotification) {
            await sendNotificationWithLink(taskToNotify.ref, taskToNotify.data, nombreLote);
        }

        writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'lote_created', title: nombreLote || codigoLote, loteNombre: nombreLote || codigoLote });
        res.status(201).json({ id: loteRef.id, code: 'LOTE_CREATED' });

    } catch (error) {
        console.error("[ERROR] Creating lote and tasks:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create lote.', 500);
    }
});

router.put('/api/lotes/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) {
            return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const loteData = pick(req.body, ['codigoLote', 'nombreLote', 'fechaCreacion', 'paqueteId', 'hectareas']);
        if (loteData.codigoLote !== undefined) {
            loteData.codigoLote = typeof loteData.codigoLote === 'string' ? loteData.codigoLote.trim() : '';
            if (!loteData.codigoLote) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'codigoLote is required.', 400);
            if (loteData.codigoLote.length > 16) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'codigoLote cannot exceed 16 characters.', 400);
        }
        if (loteData.nombreLote !== undefined) {
            loteData.nombreLote = typeof loteData.nombreLote === 'string' ? loteData.nombreLote.trim() : '';
            if (loteData.nombreLote.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'nombreLote cannot exceed 32 characters.', 400);
        }
        const originalDoc = ownership.doc;
        const originalData = originalDoc.data();

        if (loteData.fechaCreacion && typeof loteData.fechaCreacion === 'string') {
             const parsedDate = new Date(loteData.fechaCreacion);
             if (isNaN(parsedDate.getTime())) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid creation date.', 400);
             const today = new Date(); today.setHours(23, 59, 59, 999);
             if (parsedDate > today) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Creation date cannot be in the future.', 400);
             loteData.fechaCreacion = Timestamp.fromDate(parsedDate);
        }

        delete loteData.id;
        await db.collection('lotes').doc(id).update(loteData);

        // Propagate nombreLote changes to related collections
        const originalNombre = originalData.nombreLote || '';
        const newNombre = loteData.nombreLote !== undefined ? (loteData.nombreLote || '') : originalNombre;
        if (originalNombre !== newNombre) {
            const [siembrasSnap, monitoreosSnap] = await Promise.all([
                db.collection('siembras').where('fincaId', '==', req.fincaId).where('loteId', '==', id).get(),
                db.collection('monitoreos').where('fincaId', '==', req.fincaId).where('loteId', '==', id).get(),
            ]);
            const allDocs = [...siembrasSnap.docs, ...monitoreosSnap.docs];
            if (allDocs.length > 0) {
                const propagateBatch = db.batch();
                allDocs.forEach(doc => propagateBatch.update(doc.ref, { loteNombre: newNombre }));
                await propagateBatch.commit();
            }
        }

        const hasDateChanged = originalData.fechaCreacion.toMillis() !== loteData.fechaCreacion.toMillis();
        const hasPackageChanged = (originalData.paqueteId || '') !== (loteData.paqueteId || '');

        if (hasDateChanged || hasPackageChanged) {
            const tasksQuery = db.collection('scheduled_tasks').where('loteId', '==', id);
            const tasksSnapshot = await tasksQuery.get();
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            if (!loteData.paqueteId) {
                res.status(200).json({ id, ...loteData });
                return;
            }

            const paqueteDoc = await db.collection('packages').doc(loteData.paqueteId).get();
            if (paqueteDoc.exists) {
                const paqueteData = paqueteDoc.data();
                const loteCreationDate = new Date(loteData.fechaCreacion.toDate());
                const tasksBatch = db.batch();

                for (const activity of paqueteData.activities) {
                    const activityDate = new Date(loteCreationDate);
                    activityDate.setDate(loteCreationDate.getDate() + parseInt(activity.day));
                    const reminderDate = new Date(activityDate);
                    reminderDate.setDate(reminderDate.getDate() - 3);

                    const reminderTaskRef = db.collection('scheduled_tasks').doc();
                    tasksBatch.set(reminderTaskRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), loteId: id, activity, status: 'pending', fincaId: req.fincaId });

                    const dueTaskRef = db.collection('scheduled_tasks').doc();
                    tasksBatch.set(dueTaskRef, { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), loteId: id, activity, status: 'pending', fincaId: req.fincaId });
                }
                await tasksBatch.commit();
            }
        }

        res.status(200).json({ id, ...loteData });
    } catch (error) {
        console.error("Error updating lote:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update lote.', 500);
    }
});

router.get('/api/lotes/:id/task-count', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const snapshot = await db.collection('scheduled_tasks')
            .where('loteId', '==', id)
            .get();
        const count = snapshot.docs.filter(doc => doc.data().type !== 'REMINDER_3_DAY').length;
        res.status(200).json({ count });
    } catch (error) {
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to count tasks.', 500);
    }
});

router.delete('/api/lotes/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) {
            return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const tasksQuery = db.collection('scheduled_tasks').where('loteId', '==', id);
        const tasksSnapshot = await tasksQuery.get();
        const batch = db.batch();
        tasksSnapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        const loteRef = db.collection('lotes').doc(id);
        batch.delete(loteRef);
        await batch.commit();
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error("Error deleting lote:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete lote.', 500);
    }
});

module.exports = router;
