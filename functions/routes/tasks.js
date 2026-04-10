const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, enrichTask, writeFeedEvent, sendNotificationWithLink } = require('../lib/helpers');

const router = Router();

// --- TASKS ---

router.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const tasksSnapshot = await db.collection('scheduled_tasks').where('fincaId', '==', req.fincaId).get();
    let enrichedTasks = (await Promise.all(
        tasksSnapshot.docs.map(doc => enrichTask(doc).catch(err => { console.error(`enrichTask failed for ${doc.id}:`, err); return null; }))
    )).filter(t => t !== null);

    // Trabajadores solo ven las tareas asignadas a ellos
    if (req.userRole === 'trabajador') {
      const userSnap = await db.collection('users')
        .where('uid', '==', req.uid)
        .where('fincaId', '==', req.fincaId)
        .limit(1)
        .get();
      const userId = userSnap.empty ? null : userSnap.docs[0].id;
      enrichedTasks = enrichedTasks.filter(t => t.activity?.responsableId === userId);
    }

    res.status(200).json(enrichedTasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: 'Error al obtener las tareas.' });
  }
});

router.post('/api/tasks', authenticate, async (req, res) => {
  if (req.userRole === 'trabajador') {
    return res.status(403).json({ message: 'No tienes permisos para crear actividades.' });
  }
  try {
    const { nombre, loteId, responsableId, fecha, productos } = req.body;
    if (!nombre || !loteId || !responsableId || !fecha) {
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    }
    const prodList = Array.isArray(productos) ? productos : [];
    const newTask = {
      type: 'MANUAL_APLICACION',
      executeAt: Timestamp.fromDate(new Date(fecha + 'T08:00:00')),
      status: 'pending',
      loteId,
      fincaId: req.fincaId,
      activity: {
        name: nombre,
        type: prodList.length > 0 ? 'aplicacion' : 'notificacion',
        responsableId,
        productos: prodList.map(p => ({
          productoId: p.productoId,
          nombreComercial: p.nombreComercial,
          cantidad: parseFloat(p.cantidad) || 0,
          unidad: p.unidad,
          periodoReingreso: p.periodoReingreso || 0,
          periodoACosecha: p.periodoACosecha || 0,
        })),
      },
    };
    const docRef = await db.collection('scheduled_tasks').add(newTask);
    const enriched = await enrichTask(await docRef.get());
    res.status(201).json(enriched);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Error al crear la tarea.' });
  }
});

router.get('/api/tasks/overdue-count', authenticate, async (req, res) => {
  try {
    const now = Timestamp.now();
    const snapshot = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('type', '==', 'REMINDER_DUE_DAY')
      .where('executeAt', '<', now)
      .get();

    let docs = snapshot.docs.filter(doc => !['completed_by_user', 'skipped'].includes(doc.data().status));

    // Trabajadores solo cuentan sus propias tareas vencidas
    if (req.userRole === 'trabajador') {
      const userSnap = await db.collection('users')
        .where('uid', '==', req.uid)
        .where('fincaId', '==', req.fincaId)
        .limit(1)
        .get();
      const userId = userSnap.empty ? null : userSnap.docs[0].id;
      docs = docs.filter(doc => doc.data().activity?.responsableId === userId);
    }

    res.status(200).json({ count: docs.length });
  } catch (error) {
    console.error('Error counting overdue tasks:', error);
    res.status(500).json({ message: 'Error al contar tareas vencidas.' });
  }
});

router.get('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const taskDoc = await db.collection('scheduled_tasks').doc(id).get();
    if (!taskDoc.exists) {
      return res.status(404).json({ message: 'Tarea no encontrada.' });
    }
    const enrichedTask = await enrichTask(taskDoc);
    res.status(200).json(enrichedTask);
  } catch (error) {
    console.error(`Error fetching task ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al obtener la tarea.' });
  }
});

router.put('/api/tasks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const STATUSES_VALIDOS = ['pending', 'completed_by_user', 'skipped', 'notified'];
    const updateData = pick(req.body, ['status', 'notas']);
    if (updateData.status && !STATUSES_VALIDOS.includes(updateData.status)) {
      return res.status(400).json({ message: 'Estado de tarea inválido.' });
    }
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    if (updateData.status === 'completed_by_user') {
      const taskDoc = ownership.doc;
      if (taskDoc.exists) {
        const taskData = taskDoc.data();
        const productos = taskData.activity?.productos;
        if (taskData.activity?.type === 'aplicacion' && Array.isArray(productos) && productos.length > 0) {
          const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
          const hectareas = loteDoc.exists ? (loteDoc.data().hectareas || 1) : 1;
          const loteNombre = loteDoc.exists ? (loteDoc.data().nombreLote || '') : '';
          const batch = db.batch();
          batch.update(db.collection('scheduled_tasks').doc(id), updateData);
          for (const prod of productos) {
            const deduccion = prod.cantidad !== undefined
              ? prod.cantidad
              : prod.cantidadPorHa * hectareas;
            const prodRef = db.collection('productos').doc(prod.productoId);
            batch.update(prodRef, { stockActual: FieldValue.increment(-deduccion) });
            batch.set(db.collection('movimientos').doc(), {
              tipo: 'egreso',
              productoId: prod.productoId,
              nombreComercial: prod.nombreComercial || '',
              cantidad: deduccion,
              unidad: prod.unidad || '',
              fecha: Timestamp.now(),
              motivo: taskData.activity.name,
              tareaId: id,
              loteId: taskData.loteId,
              loteNombre,
              fincaId: taskData.fincaId,
            });
          }
          await batch.commit();
          writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'task_completed', activityType: 'aplicacion', title: taskData.activity.name, loteNombre });
          return res.status(200).json({ id, ...updateData });
        }

        // Tarea completada no-aplicacion: buscar lote para el feed
        if (updateData.status === 'completed_by_user') {
          const loteDoc = taskData.loteId ? await db.collection('lotes').doc(taskData.loteId).get() : null;
          const loteNombre = loteDoc?.exists ? (loteDoc.data().nombreLote || '') : '';
          writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'task_completed', activityType: taskData.activity?.type || 'notificacion', title: taskData.activity?.name || 'Tarea completada', loteNombre });
        }
      }
    }

    await db.collection('scheduled_tasks').doc(id).update(updateData);
    res.status(200).json({ id, ...updateData });
  } catch (error) {
    console.error(`Error updating task ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al actualizar la tarea.' });
  }
});

// --- TASK ACTIONS ---

router.post('/api/tasks/:id/reschedule', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { newDate } = req.body;
        if (!newDate) return res.status(400).json({ message: 'Falta la nueva fecha.' });
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
        const newTimestamp = Timestamp.fromDate(new Date(newDate));
        await db.collection('scheduled_tasks').doc(id).update({ executeAt: newTimestamp });
        res.status(200).json({ message: 'Tarea reprogramada correctamente.' });
    } catch (error) {
        console.error('Error rescheduling task:', error);
        res.status(500).json({ message: 'Error al reprogramar la tarea.' });
    }
});

router.post('/api/tasks/:id/reassign', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { newUserId } = req.body;
        if (!newUserId) return res.status(400).json({ message: 'Falta el nuevo responsable.' });

        const taskRef = db.collection('scheduled_tasks').doc(id);
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
        const taskDoc = ownership.doc;

        const taskData = taskDoc.data();
        const updatedActivity = { ...taskData.activity, responsableId: newUserId };
        await taskRef.update({ activity: updatedActivity, status: 'pending' });

        const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
        const loteNombre = loteDoc.exists ? loteDoc.data().nombreLote : 'Lote desconocido';
        const updatedTaskData = { ...taskData, activity: updatedActivity };
        await sendNotificationWithLink(taskRef, updatedTaskData, loteNombre);

        res.status(200).json({ message: 'Tarea reasignada y notificación enviada.' });
    } catch (error) {
        console.error('Error reassigning task:', error);
        res.status(500).json({ message: 'Error al reasignar la tarea.' });
    }
});

module.exports = router;
