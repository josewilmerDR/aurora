const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, sendNotificationWithLink } = require('../lib/helpers');

const router = Router();

// --- API ENDPOINTS: GRUPOS ---
router.get('/api/grupos', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('grupos').where('fincaId', '==', req.fincaId).get();
        const grupos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(grupos);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener grupos.' });
    }
});

router.post('/api/grupos', authenticate, async (req, res) => {
    try {
        const { nombreGrupo, cosecha, etapa, fechaCreacion, bloques, paqueteId, paqueteMuestreoId } = req.body;
        if (!nombreGrupo || !fechaCreacion) {
            return res.status(400).json({ message: 'Faltan datos para crear el grupo.' });
        }

        const grupoRef = await db.collection('grupos').add({
            nombreGrupo,
            cosecha: cosecha || '',
            etapa: etapa || '',
            fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
            bloques: Array.isArray(bloques) ? bloques : [],
            paqueteId: paqueteId || '',
            paqueteMuestreoId: paqueteMuestreoId || '',
            fincaId: req.fincaId,
        });

        // Si hay paquete asociado, crear tareas igual que en lotes
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

        // Si hay paquete de muestreo, crear órdenes de muestreo
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

        res.status(201).json({ id: grupoRef.id, message: 'Grupo creado exitosamente.' });
    } catch (error) {
        console.error('[ERROR] Creando grupo:', error);
        res.status(500).json({ message: 'Error al crear el grupo.' });
    }
});

router.put('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

        const grupoData = pick(req.body, ['nombreGrupo', 'cosecha', 'etapa', 'fechaCreacion', 'bloques', 'paqueteId', 'paqueteMuestreoId']);
        const originalData = ownership.doc.data();

        if (grupoData.fechaCreacion && typeof grupoData.fechaCreacion === 'string') {
            grupoData.fechaCreacion = Timestamp.fromDate(new Date(grupoData.fechaCreacion));
        }

        await db.collection('grupos').doc(id).update(grupoData);

        const hasDateChanged = originalData.fechaCreacion?.toMillis() !== grupoData.fechaCreacion?.toMillis();
        const hasPackageChanged = originalData.paqueteId !== grupoData.paqueteId;
        const hasMuestreoPackageChanged = originalData.paqueteMuestreoId !== grupoData.paqueteMuestreoId;

        if (hasDateChanged || hasPackageChanged || hasMuestreoPackageChanged) {
            // Eliminar tareas anteriores del grupo
            const tasksSnapshot = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            // Crear nuevas tareas de aplicación si hay paquete técnico
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

            // Crear nuevas órdenes de muestreo si hay paquete de muestreo
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
        res.status(500).json({ message: 'Error al actualizar el grupo.' });
    }
});

router.get('/api/grupos/:id/delete-check', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

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
        res.status(500).json({ message: 'Error al verificar dependencias.' });
    }
});

router.delete('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

        const grupoDoc = await db.collection('grupos').doc(id).get();
        const snap_grupoNombre = grupoDoc.data()?.nombreGrupo || '';

        const allTasksSnap = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
        const pendingTasks    = allTasksSnap.docs.filter(d => d.data().status === 'pending');
        const completedTasks  = allTasksSnap.docs.filter(d => d.data().status !== 'pending');
        const pendingTaskIds  = pendingTasks.map(d => d.id);

        // Rechazar si hay cédulas en estado bloqueante
        if (pendingTaskIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < pendingTaskIds.length; i += 10) chunks.push(pendingTaskIds.slice(i, i + 10));
            for (const chunk of chunks) {
                const cSnap = await db.collection('cedulas').where('taskId', 'in', chunk).get();
                for (const doc of cSnap.docs) {
                    const s = doc.data().status;
                    if (s === 'aplicada_en_campo') return res.status(409).json({ code: 'CEDULA_APLICADA', message: 'Hay cédulas aplicadas en campo.' });
                    if (s === 'en_transito')      return res.status(409).json({ code: 'CEDULA_EN_TRANSITO', message: 'Hay cédulas en estado Mezcla lista.' });
                }
            }
        }

        const batch = db.batch();

        // Snapshot del nombre del grupo en las tareas completadas/skipped (historial)
        completedTasks.forEach(doc => {
            batch.update(doc.ref, { snap_grupoNombre });
        });

        // Eliminar cédulas pendientes/anuladas de las tareas pending, luego las tareas pending
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

        res.status(200).json({ message: 'Grupo eliminado correctamente.' });
    } catch (error) {
        console.error('Error deleting grupo:', error);
        res.status(500).json({ message: 'Error al eliminar el grupo.' });
    }
});

module.exports = router;
