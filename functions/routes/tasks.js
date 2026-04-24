const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, enrichTask, writeFeedEvent, sendNotificationWithLink, hasMinRoleBE, getUserIdForUid } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { taskTypeToModule, isModuleAllowed } = require('../lib/moduleClassifier');
const { rateLimit, rateLimitByIp } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { verifyTaskLink, TASK_LINK_MODE } = require('../lib/taskLinkToken');

// Hard cap on GET /api/tasks response size. 500 is high enough to cover
// the largest fincas we've seen in production plus ~3 months of backlog,
// low enough that a single request can't pull 10k docs in one shot.
// Ordering by executeAt desc keeps the most recent and upcoming tasks
// visible when the cap truncates — old completed tasks drop first.
const LIST_HARD_LIMIT = 500;

// Validation helpers shared by POST /api/tasks and PUT /api/tasks/:id
// (the completion path inspects stored products too, but those were
// validated at write time).
const MAX_PRODUCTOS = 24;
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const isDocId = (s) => typeof s === 'string' && DOC_ID_RE.test(s);

// Correlation fields appended to every error log in this router so Cloud
// Logging queries can pivot on uid/fincaId without grep'ing request bodies.
const logCtx = (req, extra = {}) => ({ uid: req.uid, fincaId: req.fincaId, ...extra });

const router = Router();

// --- TASKS ---

router.get('/api/tasks', authenticate, async (req, res) => {
  try {
    // Hard cap — sorted newest-first so when a finca crosses the limit
    // we truncate the oldest completed/skipped tasks first, not the
    // upcoming work the user actually needs to see.
    const tasksSnapshot = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .orderBy('executeAt', 'desc')
      .limit(LIST_HARD_LIMIT)
      .get();
    let enrichedTasks = (await Promise.all(
        tasksSnapshot.docs.map(doc => enrichTask(doc).catch(err => {
          console.error('enrichTask failed', logCtx(req, { taskId: doc.id, err: err?.message }));
          return null;
        }))
    )).filter(t => t !== null);

    // Workers can only see tasks assigned to them
    if (req.userRole === 'trabajador') {
      const userId = await getUserIdForUid(req.uid, req.fincaId);
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

    if (tasksSnapshot.size === LIST_HARD_LIMIT) {
      res.set('X-Task-List-Truncated', 'true');
    }
    res.status(200).json(enrichedTasks);
  } catch (error) {
    console.error('Error fetching tasks', logCtx(req, { err: error?.message }));
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch tasks.', 500);
  }
});

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidYmd = (s) => typeof s === 'string' && YMD_RE.test(s)
  && Number.isFinite(new Date(s).getTime());

router.post('/api/tasks', authenticate, rateLimit('tasks_write', 'write'), async (req, res) => {
  if (req.userRole === 'trabajador') {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to create tasks.', 403);
  }
  try {
    const { nombre, loteId, responsableId, fecha, productos } = req.body;
    if (!nombre || !fecha) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'nombre and fecha are required.', 400);
    }
    if (typeof nombre !== 'string' || nombre.length > 200) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'nombre must be a string up to 200 chars.', 400);
    }
    if (!isValidYmd(fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'fecha must be a valid YYYY-MM-DD date.', 400);
    }

    // loteId and responsableId are optional, but when present they must
    // point to a doc in the caller's finca — otherwise the task lives
    // with a cross-finca reference that enrichTask hides but still
    // corrupts the data at rest.
    if (loteId !== undefined && loteId !== '' && loteId !== null) {
      if (!isDocId(loteId)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'loteId must be a valid doc id.', 400);
      }
      const loteDoc = await db.collection('lotes').doc(loteId).get();
      if (!loteDoc.exists || loteDoc.data().fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'loteId not found in this finca.', 400);
      }
    }
    if (responsableId !== undefined && responsableId !== '' && responsableId !== null) {
      if (!isDocId(responsableId)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'responsableId must be a valid doc id.', 400);
      }
      const userDoc = await db.collection('users').doc(responsableId).get();
      if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'responsableId not found in this finca.', 400);
      }
    }

    const prodList = Array.isArray(productos) ? productos : [];
    if (prodList.length > MAX_PRODUCTOS) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, `productos array exceeds ${MAX_PRODUCTOS} entries.`, 400);
    }
    const mappedProductos = [];
    for (const p of prodList) {
      if (!p || typeof p !== 'object') {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Each productos[] entry must be an object.', 400);
      }
      if (!isDocId(p.productoId)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'productos[].productoId must be a valid doc id.', 400);
      }
      if (typeof p.nombreComercial !== 'string' || p.nombreComercial.length > 200) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'productos[].nombreComercial must be a string up to 200 chars.', 400);
      }
      if (typeof p.unidad !== 'string' || p.unidad.length > 32) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'productos[].unidad must be a string up to 32 chars.', 400);
      }
      const cantidad = parseFloat(p.cantidad);
      if (!Number.isFinite(cantidad) || cantidad < 0) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'productos[].cantidad must be a non-negative number.', 400);
      }
      mappedProductos.push({
        productoId: p.productoId,
        nombreComercial: p.nombreComercial,
        cantidad,
        unidad: p.unidad,
        periodoReingreso: p.periodoReingreso || 0,
        periodoACosecha: p.periodoACosecha || 0,
      });
    }
    const newTask = {
      type: 'MANUAL_APLICACION',
      executeAt: Timestamp.fromDate(new Date(fecha + 'T08:00:00')),
      status: 'pending',
      loteId: loteId || '',
      fincaId: req.fincaId,
      activity: {
        name: nombre,
        type: mappedProductos.length > 0 ? 'aplicacion' : 'notificacion',
        responsableId: responsableId || '',
        productos: mappedProductos,
      },
    };
    const docRef = await db.collection('scheduled_tasks').add(newTask);
    const enriched = await enrichTask(await docRef.get());
    res.status(201).json(enriched);
  } catch (error) {
    console.error('Error creating task', logCtx(req, { err: error?.message }));
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
      const userId = await getUserIdForUid(req.uid, req.fincaId);
      docs = docs.filter(doc => doc.data().activity?.responsableId === userId);
    }

    // Module restriction: exclude tasks from non-allowed modules so the
    // overdue badge in the sidebar matches what the user can actually open.
    if (Array.isArray(req.userRestrictedTo) && req.userRestrictedTo.length > 0) {
      docs = docs.filter(doc => isModuleAllowed(taskTypeToModule(doc.data().type), req.userRestrictedTo));
    }

    res.status(200).json({ count: docs.length });
  } catch (error) {
    console.error('Error counting overdue tasks', logCtx(req, { err: error?.message }));
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to count overdue tasks.', 500);
  }
});

router.get('/api/tasks/:id', rateLimitByIp('tasks_public_read', 'public_read'), async (req, res) => {
  try {
    const { id } = req.params;

    // Capability-URL check (see lib/taskLinkToken.js). In 'warn' mode
    // (default) we log invalid/missing tokens but still serve — so
    // WhatsApp links sent before this code was deployed keep working.
    // Flip TASK_LINK_TOKEN_MODE=enforce after the TTL window elapses.
    const linkCheck = verifyTaskLink(id, req.query.t);
    if (!linkCheck.ok && linkCheck.mode === 'enforce') {
      return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Invalid or missing task link token.', 401);
    }
    if (!linkCheck.ok && linkCheck.mode === 'warn') {
      const ip = (req.ip || req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
      console.warn('[taskLink] unverified access (warn mode)', {
        taskId: id,
        reason: linkCheck.reason,
        ip: ip.slice(0, 64),
      });
    }

    const taskDoc = await db.collection('scheduled_tasks').doc(id).get();
    if (!taskDoc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Task not found.', 404);
    }
    const enrichedTask = await enrichTask(taskDoc);
    res.status(200).json(enrichedTask);
  } catch (error) {
    console.error('Error fetching task', { taskId: req.params.id, err: error?.message });
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch task.', 500);
  }
});

router.put('/api/tasks/:id', authenticate, rateLimit('tasks_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const VALID_STATUSES = ['pending', 'completed_by_user', 'skipped', 'notified'];
    const updateData = pick(req.body, ['status', 'notas']);
    if (updateData.status && !VALID_STATUSES.includes(updateData.status)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid task status.', 400);
    }
    if (updateData.notas !== undefined) {
      if (typeof updateData.notas !== 'string' || updateData.notas.length > 2000) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'notas must be a string up to 2000 chars.', 400);
      }
    }
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const taskDoc = ownership.doc;
    const taskData = taskDoc.data();

    // RBAC: a trabajador can only mutate tasks assigned to them. Other
    // roles (encargado+) can update any task in the finca.
    if (req.userRole === 'trabajador') {
      const userId = await getUserIdForUid(req.uid, req.fincaId);
      if (!userId || taskData.activity?.responsableId !== userId) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You can only update tasks assigned to you.', 403);
      }
    }

    if (updateData.status === 'completed_by_user') {
      const productos = taskData.activity?.productos;
      if (taskData.activity?.type === 'aplicacion' && Array.isArray(productos) && productos.length > 0) {
        const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
        // Defense in depth — if somehow the task points at a lote in
        // another finca, never deduct stock cross-tenant. verifyOwnership
        // above already guards the task itself.
        if (loteDoc.exists && loteDoc.data().fincaId !== req.fincaId) {
          console.error('Cross-finca lote in task completion', logCtx(req, { taskId: id, loteId: taskData.loteId }));
          return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Task references a lote in another finca.', 400);
        }
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
        writeAuditEvent({
          fincaId: req.fincaId,
          actor: req,
          action: ACTIONS.TASK_COMPLETE,
          target: { type: 'scheduled_task', id },
          metadata: { activityName: taskData.activity.name, activityType: 'aplicacion', productosCount: productos.length, loteId: taskData.loteId },
          severity: SEVERITY.INFO,
        });
        return res.status(200).json({ id, ...updateData });
      }

      // Non-aplicacion task completed: fetch lote for the feed event
      const loteDoc = taskData.loteId ? await db.collection('lotes').doc(taskData.loteId).get() : null;
      const loteNombre = loteDoc?.exists ? (loteDoc.data().nombreLote || '') : '';
      writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'task_completed', activityType: taskData.activity?.type || 'notificacion', title: taskData.activity?.name || 'Task completed', loteNombre });
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.TASK_COMPLETE,
        target: { type: 'scheduled_task', id },
        metadata: { activityName: taskData.activity?.name, activityType: taskData.activity?.type || 'notificacion' },
        severity: SEVERITY.INFO,
      });
    }

    await db.collection('scheduled_tasks').doc(id).update(updateData);
    res.status(200).json({ id, ...updateData });
  } catch (error) {
    console.error('Error updating task', logCtx(req, { taskId: req.params.id, err: error?.message }));
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update task.', 500);
  }
});

// --- TASK ACTIONS ---

router.post('/api/tasks/:id/reschedule', authenticate, rateLimit('tasks_write', 'write'), async (req, res) => {
    try {
        // RBAC: reschedule changes a deadline that affects others' work —
        // restrict to encargado+ so a trabajador cannot push off his own
        // tasks (or anyone else's) silently.
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
          return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to reschedule tasks.', 403);
        }
        const { id } = req.params;
        const { newDate } = req.body;
        if (!newDate) {
          return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'New date is required.', 400);
        }
        if (!isValidYmd(newDate)) {
          return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'newDate must be a valid YYYY-MM-DD date.', 400);
        }
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) {
          return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const previousExecuteAt = ownership.doc.data().executeAt?.toDate?.()?.toISOString() ?? null;
        const newTimestamp = Timestamp.fromDate(new Date(newDate));
        await db.collection('scheduled_tasks').doc(id).update({ executeAt: newTimestamp });

        writeAuditEvent({
          fincaId: req.fincaId,
          actor: req,
          action: ACTIONS.TASK_RESCHEDULE,
          target: { type: 'scheduled_task', id },
          metadata: { from: previousExecuteAt, to: newDate },
          severity: SEVERITY.INFO,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error rescheduling task', logCtx(req, { taskId: req.params.id, err: error?.message }));
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reschedule task.', 500);
    }
});

router.post('/api/tasks/:id/reassign', authenticate, rateLimit('tasks_notify', 'notify'), async (req, res) => {
    try {
        // RBAC: reassign fans out to Twilio and changes accountability —
        // encargado+ only, matching the same bar as reschedule.
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
          return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to reassign tasks.', 403);
        }
        const { id } = req.params;
        const { newUserId } = req.body;
        if (!newUserId || typeof newUserId !== 'string') {
          return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'New assignee is required.', 400);
        }
        if (!isDocId(newUserId)) {
          return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'newUserId must be a valid doc id.', 400);
        }

        const taskRef = db.collection('scheduled_tasks').doc(id);
        const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
        if (!ownership.ok) {
          return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const taskDoc = ownership.doc;

        // Verify the assignee exists and belongs to the same finca to avoid
        // orphan responsableIds and cross-finca assignments.
        const newUserDoc = await db.collection('users').doc(newUserId).get();
        if (!newUserDoc.exists || newUserDoc.data().fincaId !== req.fincaId) {
          return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Assignee not found in this finca.', 400);
        }

        const taskData = taskDoc.data();
        const previousResponsableId = taskData.activity?.responsableId || null;
        const updatedActivity = { ...taskData.activity, responsableId: newUserId };
        await taskRef.update({ activity: updatedActivity, status: 'pending' });

        const loteDoc = taskData.loteId ? await db.collection('lotes').doc(taskData.loteId).get() : null;
        const loteNombre = loteDoc?.exists ? loteDoc.data().nombreLote : 'Unknown lote';
        const updatedTaskData = { ...taskData, activity: updatedActivity };
        await sendNotificationWithLink(taskRef, updatedTaskData, loteNombre);

        writeAuditEvent({
          fincaId: req.fincaId,
          actor: req,
          action: ACTIONS.TASK_REASSIGN,
          target: { type: 'scheduled_task', id },
          metadata: { from: previousResponsableId, to: newUserId, activityName: taskData.activity?.name },
          severity: SEVERITY.INFO,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error reassigning task', logCtx(req, { taskId: req.params.id, err: error?.message }));
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reassign task.', 500);
    }
});

module.exports = router;
