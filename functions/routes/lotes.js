const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, writeFeedEvent, sendNotificationWithLink } = require('../lib/helpers');

const router = Router();

// --- API ENDPOINTS: LOTES ---
router.get('/api/lotes', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('lotes').where('fincaId', '==', req.fincaId).get();
    const lotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lotes);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener lotes.' });
  }
});

router.post('/api/lotes', authenticate, async (req, res) => {
    const { nombreLote, codigoLote, fechaCreacion, paqueteId, hectareas } = req.body;
    if (!codigoLote || !fechaCreacion) {
        return res.status(400).json({ message: 'Faltan datos para crear el lote.' });
    }

    // Si no hay paquete, crear el lote vacío (sin tareas)
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
            return res.status(201).json({ id: loteRef.id, message: 'Lote creado sin paquete técnico.' });
        } catch (error) {
            console.error("[ERROR] Creando lote sin paquete:", error);
            return res.status(500).json({ message: 'Error al crear el lote.' });
        }
    }

    try {
        const loteRef = await db.collection('lotes').add({ codigoLote, ...(nombreLote ? { nombreLote } : {}), fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)), paqueteId, hectareas: parseFloat(hectareas) || 1, fincaId: req.fincaId });
        const paqueteDoc = await db.collection('packages').doc(paqueteId).get();
        if (!paqueteDoc.exists) throw new Error('Paquete no encontrado');
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
        res.status(201).json({ id: loteRef.id, message: 'Lote y tareas programadas con éxito. Se enviaron notificaciones inmediatas.' });

    } catch (error) {
        console.error("[ERROR] Creando lote y tareas:", error);
        res.status(500).json({ message: 'Error al procesar el lote.' });
    }
});

router.put('/api/lotes/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
        const loteData = pick(req.body, ['codigoLote', 'nombreLote', 'fechaCreacion', 'paqueteId', 'hectareas']);
        const originalDoc = ownership.doc;
        const originalData = originalDoc.data();

        if (loteData.fechaCreacion && typeof loteData.fechaCreacion === 'string') {
             loteData.fechaCreacion = Timestamp.fromDate(new Date(loteData.fechaCreacion));
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
        console.error("Error updating lote: ", error);
        res.status(500).json({ message: 'Error al actualizar el lote.' });
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
        res.status(500).json({ message: 'Error al contar tareas.' });
    }
});

router.delete('/api/lotes/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
        const tasksQuery = db.collection('scheduled_tasks').where('loteId', '==', id);
        const tasksSnapshot = await tasksQuery.get();
        const batch = db.batch();
        tasksSnapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        const loteRef = db.collection('lotes').doc(id);
        batch.delete(loteRef);
        await batch.commit();
        res.status(200).json({ message: 'Lote y tareas asociadas eliminados correctamente.' });
    } catch (error) {
        console.error("Error deleting lote: ", error);
        res.status(500).json({ message: 'Error al eliminar el lote.' });
    }
});

module.exports = router;
