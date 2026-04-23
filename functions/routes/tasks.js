const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, enrichTask, writeFeedEvent, sendNotificationWithLink } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { taskTypeToModule, isModuleAllowed } = require('../lib/moduleClassifier');

const router = Router();

// --- TASKS ---

router.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const tasksSnapshot = await db.collection('scheduled_tasks').where('fincaId', '==', req.fincaId).get();
    let enrichedTasks = (await Promise.all(
        tasksSnapshot.docs.map(doc => enrichTask(doc).catch(err => { console.error(`enrichTask failed for ${doc.id}:`, err); return null; }))
    )).filter(t => t !== null);

    // Workers can only see tasks assigned to them
    if (req.userRole === 'trabajador') {
      const userSnap = await db.collection('users')
        .where('uid', '==', req.uid)
        .where('fincaId', '==', req.fincaId)
        .limit(1)
        .get();
      const userId = userSnap.empty ? null : userSnap.docs[0].id;
      enrichedTasks = enrichedTasks.filter(t => t.activity?.responsableId === userId);
    }

    // Module restriction: hide tasks whose type maps to a non-allowed module.
    // Unknown types default to 'campo' (see moduleClassifier) so unfamiliar
    // data does not silently leak; flip that default if a future module adds
    // task types we should show to everyone.
    if (Array.isArray(req.userRestrictedTo) && req.userRestrictedTo.length > 0) {
      enrichedTasks = enrichedTasks.filter(
        t => isModuleAllowed(taskTypeToModule(t.type), req.userRestrictedTo)
      );
    }

    res.status(200).json(enrichedTasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch tasks.', 500);
  }
});

router.post('/api/tasks', authenticate, async (req, res) => {
  if (req.userRole === 'trabajador') {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to create tasks.', 403);
  }
  try {
    const { nombre, loteId, responsableId, fecha, productos } = req.body;
    if (!nombre || !loteId || !responsableId || !fecha) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'nombre, loteId, responsableId and fecha are required.', 400);
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create task.', 500);
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

    // Workers can only count their own overdue tasks
    if (req.userRole === 'trabajador') {
      const userSnap = await db.collection('users')
        .where('uid', '==', req.uid)
        .where('fincaId', '==', req.fincaId)
        .limit(1)
        .get();
      const userId = userSnap.empty ? null : userSnap.docs[0].id;
      docs = docs.filter(doc => doc.data().activity?.responsableId === userId);
    }

    // Module restriction: exclude tasks from non-allowed modules so the
    // overdue badge in the sidebar matches what the user can actually open.
    if (Array.isArray(req.userRestrictedTo) && req.userRestrictedTo.length > 0) {
      docs = docs.filter(doc => isModuleAllowed(taskTypeToModule(doc.data().type), req.userRestrictedTo));
    }

    res.status(200).json({ count: docs.length });
  } catch (error) {
    console.error('Error counting overdue tasks:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to count overdue tasks.', 500);
  }
});

router.get('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const taskDoc = await db.collection('scheduled_tasks').doc(id).get();
    if (!taskDoc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Task not found.', 404);
    }
    const enrichedTask = await enrichTask(taskDoc);
    res.status(200).json(enrichedTask);
  } catch (error) {
    console.error(`Error fetching task ${req.params.id}:`, error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch task.', 500);
  }
});

router.put('/api/tasks/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const VALID_STATUSES = ['pending', 'completed_by_user', 'skipped', 'notified'];
    const updateData = pick(req.body, ['status', 'notas']);
    if (updateData.status && !VALID_STATUSES.includes(updateData.status)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid task status.', 400);
    }
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }

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
            const deduction = prod.cantidad !== undefined
              ? prod.cantidad
              : prod.cantidadPorHa * hectareas;
            const prodRef = db.collection('productos').doc(prod.productoId);
            batch.update(prodRef, { stockActual: FieldValue.increment(-deduction) });
            batch.set(db.collection('movimientos').doc(), {
              tipo: 'egreso',
              productoId: prod.productoId,
              nombreComercial: prod.nombreComercial || '',
              cantidad: deduction,
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

        // Non-aplicacion task completed: fetch lote for the feed event
        if (updateData.status === 'completed_by_user') {
          const loteDoc = taskData.loteId ? await db.collection('lotes').doc(taskData.loteId).get() : null;
          const loteNombre = loteDoc?.exists ? (loteDoc.data().nombreLote || '') : '';
          writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'task_completed', activityType: taskData.activity?.type || 'notificacion', title: taskData.activity?.name || 'Task completed', loteNombre });
        }
      }
    }

    await db.collection('scheduled_tasks').doc(id).update(updateData);
    res.status(200).json({ id, ...updateData });
  } catch (error) {
    console.error(`Error updating task ${req.params.id}:`, error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update task.', 500);
  }
});

// --- TASK ACTIONS ---

router.post('/api/tasks/:id/reschedule', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { newDate } = req.body;
        if (!newDate) {
          return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'New date is required.', 400);
        }
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) {
          return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const newTimestamp = Timestamp.fromDate(new Date(newDate));
        await db.collection('scheduled_tasks').doc(id).update({ executeAt: newTimestamp });
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error rescheduling task:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reschedule task.', 500);
    }
});

router.post('/api/tasks/:id/reassign', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const { newUserId } = req.body;
        if (!newUserId) {
          return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'New assignee is required.', 400);
        }

        const taskRef = db.collection('scheduled_tasks').doc(id);
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) {
          return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const taskDoc = ownership.doc;

        const taskData = taskDoc.data();
        const updatedActivity = { ...taskData.activity, responsableId: newUserId };
        await taskRef.update({ activity: updatedActivity, status: 'pending' });

        const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
        const loteNombre = loteDoc.exists ? loteDoc.data().nombreLote : 'Unknown lote';
        const updatedTaskData = { ...taskData, activity: updatedActivity };
        await sendNotificationWithLink(taskRef, updatedTaskData, loteNombre);

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error reassigning task:', error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reassign task.', 500);
    }
});

module.exports = router;
