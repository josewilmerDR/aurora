
const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');

// --- DEFINICIÓN DE SECRETOS CON EL NUEVO SISTEMA "PARAMS" ---
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// --- INICIALIZACIÓN UNIVERSAL DE CLIENTES ---
// Se inicializa sin parámetros para que funcione tanto en el emulador como en producción.
admin.initializeApp();
const db = getFirestore(admin.app(), 'auroradatabase');

// Los clientes externos se inicializan "perezosamente" (lazy) para evitar
// errores de despliegue cuando los secretos aún no están disponibles.
let twilioClient;
let anthropicClient;

const app = express();
const ID_FINCA_ACTUAL = 'finca_aurora_test';

// URL de la app desplegada (¡IMPORTANTE!)
const APP_URL = 'https://aurora-7dc9b.web.app';

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '15mb' }));

// --- MIDDLEWARE DE LOGGING ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// --- FUNCIÓN DE ENRIQUECIMIENTO DE TAREA ---
const enrichTask = async (taskDoc) => {
  const task = taskDoc.data();
  if (!task) return null;

  const responsableId = task.activity?.responsableId;
  const hasRealUser = responsableId && responsableId !== 'proveeduria';

  const lotePromise = task.loteId
    ? db.collection('lotes').doc(task.loteId).get()
    : Promise.resolve(null);
  const userPromise = hasRealUser
    ? db.collection('users').doc(responsableId).get()
    : Promise.resolve(null);

  const [loteDoc, userDoc] = await Promise.all([lotePromise, userPromise]);

  const lote = loteDoc ? loteDoc.data() : null;
  const responsable = userDoc ? userDoc.data() : null;

  return {
    id: taskDoc.id,
    activityName: task.activity?.name,
    loteName: lote ? lote.nombreLote : (task.loteId ? 'Lote no encontrado' : '—'),
    loteHectareas: lote ? (lote.hectareas || 1) : 1,
    responsableName: responsable
      ? responsable.nombre
      : (task.activity?.responsableNombre || 'Proveeduría'),
    responsableTel: responsable ? responsable.telefono : '—',
    dueDate: task.executeAt.toDate().toISOString(),
    status: task.status,
    type: task.type,
    ...task,
  };
};

// --- API ENDPOINTS: TASKS ---
app.get('/api/tasks', async (req, res) => {
  try {
    const tasksSnapshot = await db.collection('scheduled_tasks').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const enrichedTasksPromises = tasksSnapshot.docs.map(enrichTask);
    const enrichedTasks = await Promise.all(enrichedTasksPromises);
    res.status(200).json(enrichedTasks.filter(t => t !== null));
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: 'Error al obtener las tareas.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { nombre, loteId, responsableId, fecha, productos } = req.body;
    if (!nombre || !loteId || !responsableId || !fecha || !Array.isArray(productos) || !productos.length) {
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    }
    const newTask = {
      type: 'MANUAL_APLICACION',
      executeAt: Timestamp.fromDate(new Date(fecha + 'T08:00:00')),
      status: 'pending',
      loteId,
      fincaId: ID_FINCA_ACTUAL,
      activity: {
        name: nombre,
        type: 'aplicacion',
        responsableId,
        productos: productos.map(p => ({
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

app.get('/api/tasks/overdue-count', async (_req, res) => {
  try {
    const now = Timestamp.now();
    const snapshot = await db.collection('scheduled_tasks')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .where('type', '==', 'REMINDER_DUE_DAY')
      .where('executeAt', '<', now)
      .get();
    const count = snapshot.docs.filter(doc => doc.data().status !== 'completed_by_user').length;
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error counting overdue tasks:', error);
    res.status(500).json({ message: 'Error al contar tareas vencidas.' });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
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

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    delete updateData.id;
    delete updateData.loteId;
    delete updateData.fincaId;

    if (updateData.status === 'completed_by_user') {
      const taskDoc = await db.collection('scheduled_tasks').doc(id).get();
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
            // Tareas ad-hoc usan `cantidad` absoluta; tareas de paquete usan `cantidadPorHa × hectareas`
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
              fincaId: ID_FINCA_ACTUAL,
            });
          }
          await batch.commit();
          return res.status(200).json({ id, ...updateData });
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

// --- API ENDPOINTS: TASK TEMPLATES ---
app.get('/api/task-templates', async (req, res) => {
  try {
    const snapshot = await db.collection('task_templates')
      .where('fincaId', '==', ID_FINCA_ACTUAL).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

app.post('/api/task-templates', async (req, res) => {
  try {
    const { nombre, responsableId, productos } = req.body;
    if (!nombre || !productos?.length)
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const template = {
      nombre,
      responsableId: responsableId || '',
      productos,
      fincaId: ID_FINCA_ACTUAL,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('task_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear plantilla.' });
  }
});

app.delete('/api/task-templates/:id', async (req, res) => {
  try {
    await db.collection('task_templates').doc(req.params.id).delete();
    res.json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

// --- API ENDPOINTS: USERS ---
app.get('/api/users', async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios.' });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const user = { ...req.body, fincaId: ID_FINCA_ACTUAL };
    delete user.id;
    const docRef = await db.collection('users').add(user);
    res.status(201).json({ id: docRef.id, ...user });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear usuario.' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userData = { ...req.body };
    delete userData.id;
    await db.collection('users').doc(id).update(userData);
    res.status(200).json({ id, ...userData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('users').doc(id).delete();
    res.status(200).json({ message: 'Usuario eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar usuario.' });
  }
});

// --- API ENDPOINTS: PRODUCTOS ---
app.get('/api/productos', async (req, res) => {
  try {
    const snapshot = await db.collection('productos').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(productos);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener productos.' });
  }
});

app.post('/api/productos', async (req, res) => {
  try {
    const producto = { ...req.body, fincaId: ID_FINCA_ACTUAL };
    delete producto.id;
    const docRef = await db.collection('productos').add(producto);
    res.status(201).json({ id: docRef.id, ...producto });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear producto.' });
  }
});

app.put('/api/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const productoData = { ...req.body };
    delete productoData.id;
    await db.collection('productos').doc(id).update(productoData);
    res.status(200).json({ id, ...productoData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar producto.' });
  }
});

app.delete('/api/productos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('productos').doc(id).delete();
    res.status(200).json({ message: 'Producto eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar producto.' });
  }
});

// --- API ENDPOINTS: PACKAGES (PLANTILLAS) ---
app.get('/api/packages', async (req, res) => {
  try {
    const snapshot = await db.collection('packages').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener paquetes.' });
  }
});

app.post('/api/packages', async (req, res) => {
  try {
    const pkg = { ...req.body, fincaId: ID_FINCA_ACTUAL };
    delete pkg.id;
    const docRef = await db.collection('packages').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear paquete.' });
  }
});

app.put('/api/packages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pkgData = { ...req.body };
    delete pkgData.id;
    await db.collection('packages').doc(id).update(pkgData);
    res.status(200).json({ id, ...pkgData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el paquete.' });
  }
});

app.delete('/api/packages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('packages').doc(id).delete();
    res.status(200).json({ message: 'Paquete eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el paquete.' });
  }
});

// --- API ENDPOINTS: LOTES ---
app.get('/api/lotes', async (req, res) => {
  try {
    const snapshot = await db.collection('lotes').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const lotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lotes);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener lotes.' });
  }
});

// LÓGICA DE NOTIFICACIÓN CON ENLACE
const sendNotificationWithLink = async (taskRef, taskData, loteNombre) => {
  try {
    // Se inicializa el cliente de Twilio aquí, solo cuando se va a usar.
    // Esto asegura que .value() se llama en tiempo de ejecución.
    if (!twilioClient) {
      twilioClient = twilio(twilioAccountSid.value(), twilioAuthToken.value());
    }

    const userDoc = await db.collection('users').doc(taskData.activity.responsableId).get();
    if (!userDoc.exists || !userDoc.data().telefono) return;

    const userData = userDoc.data();
    const cleanPhoneNumber = userData.telefono.replace(/\s+/g, '');
    const to = `whatsapp:${cleanPhoneNumber}`;
    const from = `whatsapp:${twilioWhatsappFrom.value()}`;

    let messageIntro;
    const activityDay = parseInt(taskData.activity.day);
    if (activityDay === 0) {
        messageIntro = `¡Nueva tarea para hoy!`;
    } else {
        const dateString = taskData.executeAt.toDate().toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long' });
        messageIntro = `¡Nueva tarea para el ${dateString}!`;
    }

    const taskUrl = `${APP_URL}/task/${taskRef.id}`;
    const body = `${messageIntro}\n*Actividad:* \"${taskData.activity.name}\"\n*Lote:* ${loteNombre}\n\n*Gestiona esta tarea aquí:*\n${taskUrl}`;
    
    await twilioClient.messages.create({ body, from, to });
    await taskRef.update({ status: 'notified' });
    console.log(`Notificación con ENLACE enviada para tarea ${taskRef.id} a ${cleanPhoneNumber}`);

  } catch (error) {
    console.error(`[ERROR] Fallo al enviar notificación con enlace para ${taskRef.id}:`, error);
  }
};


app.post('/api/lotes', async (req, res) => {
    const { nombreLote, fechaCreacion, paqueteId, hectareas } = req.body;
    if (!nombreLote || !fechaCreacion || !paqueteId) {
        return res.status(400).json({ message: 'Faltan datos para crear el lote.' });
    }

    try {
        const loteRef = await db.collection('lotes').add({ nombreLote, fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)), paqueteId, hectareas: parseFloat(hectareas) || 1, fincaId: ID_FINCA_ACTUAL });
        const paqueteDoc = await db.collection('packages').doc(paqueteId).get();
        if (!paqueteDoc.exists) throw new Error('Paquete no encontrado');
        const paqueteData = paqueteDoc.data();

        const loteCreationDate = new Date(fechaCreacion);
        const tasksBatch = db.batch();
        const tasksForImmediateNotification = [];

        for (const activity of paqueteData.activities) {
            if (!activity.responsableId) continue;

            const activityDay = parseInt(activity.day);
            const activityDate = new Date(loteCreationDate);
            activityDate.setDate(loteCreationDate.getDate() + activityDay);

            const reminderDate = new Date(activityDate);
            reminderDate.setDate(reminderDate.getDate() - 3);

            const reminderTaskRef = db.collection('scheduled_tasks').doc();
            tasksBatch.set(reminderTaskRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), loteId: loteRef.id, activity, status: 'pending', fincaId: ID_FINCA_ACTUAL });

            const dueTaskRef = db.collection('scheduled_tasks').doc();
            const dueTaskData = { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), loteId: loteRef.id, activity, status: 'pending', fincaId: ID_FINCA_ACTUAL };
            tasksBatch.set(dueTaskRef, dueTaskData);

            if (activityDay >= 0 && activityDay <= 3) {
                tasksForImmediateNotification.push({ ref: dueTaskRef, data: dueTaskData });
            }
        }

        await tasksBatch.commit();

        for (const taskToNotify of tasksForImmediateNotification) {
            await sendNotificationWithLink(taskToNotify.ref, taskToNotify.data, nombreLote);
        }

        res.status(201).json({ id: loteRef.id, message: 'Lote y tareas programadas con éxito. Se enviaron notificaciones inmediatas.' });

    } catch (error) {
        console.error("[ERROR] Creando lote y tareas:", error);
        res.status(500).json({ message: 'Error al procesar el lote.' });
    }
});

app.put('/api/lotes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const loteData = { ...req.body };
        const originalDoc = await db.collection('lotes').doc(id).get();
        const originalData = originalDoc.data();

        if (loteData.fechaCreacion && typeof loteData.fechaCreacion === 'string') {
             loteData.fechaCreacion = Timestamp.fromDate(new Date(loteData.fechaCreacion));
        }

        delete loteData.id;
        await db.collection('lotes').doc(id).update(loteData);

        const hasDateChanged = originalData.fechaCreacion.toMillis() !== loteData.fechaCreacion.toMillis();
        const hasPackageChanged = originalData.paqueteId !== loteData.paqueteId;

        if (hasDateChanged || hasPackageChanged) {
            const tasksQuery = db.collection('scheduled_tasks').where('loteId', '==', id);
            const tasksSnapshot = await tasksQuery.get();
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            const paqueteDoc = await db.collection('packages').doc(loteData.paqueteId).get();
            if (paqueteDoc.exists) {
                const paqueteData = paqueteDoc.data();
                const loteCreationDate = new Date(loteData.fechaCreacion.toDate());
                const tasksBatch = db.batch();

                for (const activity of paqueteData.activities) {
                    if (!activity.responsableId) continue;
                    const activityDate = new Date(loteCreationDate);
                    activityDate.setDate(loteCreationDate.getDate() + parseInt(activity.day));
                    const reminderDate = new Date(activityDate);
                    reminderDate.setDate(reminderDate.getDate() - 3);
                    
                    const reminderTaskRef = db.collection('scheduled_tasks').doc();
                    tasksBatch.set(reminderTaskRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), loteId: id, activity, status: 'pending', fincaId: ID_FINCA_ACTUAL });
                    
                    const dueTaskRef = db.collection('scheduled_tasks').doc();
                    tasksBatch.set(dueTaskRef, { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), loteId: id, activity, status: 'pending', fincaId: ID_FINCA_ACTUAL });
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

app.get('/api/lotes/:id/task-count', async (req, res) => {
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

app.delete('/api/lotes/:id', async (req, res) => {
    try {
        const { id } = req.params;
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

// --- API ENDPOINTS: TASK ACTIONS ---

app.post('/api/tasks/:id/reschedule', async (req, res) => {
    try {
        const { id } = req.params;
        const { newDate } = req.body;
        if (!newDate) return res.status(400).json({ message: 'Falta la nueva fecha.' });
        const newTimestamp = Timestamp.fromDate(new Date(newDate));
        await db.collection('scheduled_tasks').doc(id).update({ executeAt: newTimestamp });
        res.status(200).json({ message: 'Tarea reprogramada correctamente.' });
    } catch (error) {
        console.error('Error rescheduling task:', error);
        res.status(500).json({ message: 'Error al reprogramar la tarea.' });
    }
});

app.post('/api/tasks/:id/reassign', async (req, res) => {
    try {
        const { id } = req.params;
        const { newUserId } = req.body;
        if (!newUserId) return res.status(400).json({ message: 'Falta el nuevo responsable.' });

        const taskRef = db.collection('scheduled_tasks').doc(id);
        const taskDoc = await taskRef.get();
        if (!taskDoc.exists) return res.status(404).json({ message: 'Tarea no encontrada.' });

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

// --- API ENDPOINTS: COMPRAS (ESCANEO DE FACTURAS) ---

app.get('/api/compras', async (req, res) => {
  try {
    const snapshot = await db.collection('compras')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const compras = snapshot.docs.map(doc => {
      const data = doc.data();
      // No devolver la imagen en el listado (puede ser pesada)
      const { imageBase64, ...rest } = data;
      return { id: doc.id, tieneImagen: !!imageBase64, ...rest };
    });
    res.status(200).json(compras);
  } catch (error) {
    console.error("Error fetching compras:", error);
    res.status(500).json({ message: 'Error al obtener el historial de compras.' });
  }
});

app.post('/api/compras/escanear', async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ message: 'Se requiere imageBase64 y mediaType.' });
    }

    // Obtener catálogo de productos actual para que Claude pueda hacer el match
    const productosSnap = await db.collection('productos')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .get();
    const catalogo = productosSnap.docs.map(doc => ({
      id: doc.id,
      idProducto: doc.data().idProducto,
      nombreComercial: doc.data().nombreComercial,
      unidad: doc.data().unidad,
      stockActual: doc.data().stockActual,
    }));

    // Inicializar Anthropic de forma lazy
    if (!anthropicClient) {
      anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });
    }

    const catalogoTexto = catalogo.length > 0
      ? catalogo.map(p => `- ID: "${p.id}" | Código: ${p.idProducto} | Nombre: ${p.nombreComercial} | Unidad: ${p.unidad}`).join('\n')
      : '(catálogo vacío)';

    const prompt = `Eres un experto en inventario agrícola. Analiza esta imagen de factura de agroquímicos.

Catálogo de productos existente en nuestra bodega:
${catalogoTexto}

Extrae cada línea de producto de la factura y devuelve un arreglo JSON con este formato exacto:
[
  {
    "productoId": "ID del catálogo si hay coincidencia, o null si no hay",
    "nombreFactura": "nombre exacto como aparece en la factura",
    "cantidadFactura": 2.0,
    "unidadFactura": "unidad como aparece en factura (ej: Galón, Pichinga 5L, kg, L)",
    "cantidadCatalogo": 7.57,
    "unidadCatalogo": "unidad del catálogo (ej: L, kg, mL, g)",
    "notas": "conversión realizada u observación, o vacío"
  }
]

Reglas importantes:
1. Convierte automáticamente las unidades al sistema métrico del catálogo (ej: 1 Galón = 3.785 L, 1 Pichinga 5L = 5 L).
2. Si en el catálogo hay un producto con nombre similar, asigna su ID en "productoId".
3. Si no hay coincidencia, usa null en "productoId" y mantén la unidad de la factura.
4. Devuelve SOLO el arreglo JSON, sin texto adicional, sin markdown, sin bloques de código.`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim();

    // Limpiar posibles bloques de código si Claude los incluyó de todas formas
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let lineas;
    try {
      lineas = JSON.parse(jsonText);
    } catch {
      console.error("Claude devolvió texto no parseable:", rawText);
      return res.status(422).json({ message: 'La IA no pudo interpretar la factura. Intenta con una imagen más clara.', raw: rawText });
    }

    res.status(200).json({ lineas, catalogo });
  } catch (error) {
    console.error("Error en escanear factura:", error);
    res.status(500).json({ message: 'Error al procesar la imagen con IA.' });
  }
});

app.post('/api/compras/confirmar', async (req, res) => {
  try {
    const { imageBase64, mediaType, proveedor, fecha, lineas } = req.body;

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos una línea de producto.' });
    }

    const batch = db.batch();
    let stockActualizados = 0;
    let productosCreados = 0;

    // Pre-generar ID de compra para referenciarlo en los movimientos
    const compraRef = db.collection('compras').doc();
    const motivoCompra = proveedor ? `Compra: ${proveedor}` : 'Compra de inventario';

    for (const linea of lineas) {
      const cantidad = parseFloat(linea.cantidadIngresada) || 0;
      if (cantidad <= 0) continue;

      if (linea.productoId) {
        // ── Producto existente: solo incrementar stock ──
        const prodRef = db.collection('productos').doc(linea.productoId);
        batch.update(prodRef, { stockActual: FieldValue.increment(cantidad) });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: linea.productoId,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          cantidad,
          unidad: linea.unidad || '',
          fecha: Timestamp.now(),
          motivo: motivoCompra,
          compraId: compraRef.id,
          fincaId: ID_FINCA_ACTUAL,
        });
        stockActualizados++;
      } else if (linea.ingredienteActivo) {
        // ── Producto nuevo: crear con todos los campos del formulario ──
        const newProdRef = db.collection('productos').doc();
        batch.set(newProdRef, {
          idProducto: linea.idProducto || `PD-${Date.now()}`,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          ingredienteActivo: linea.ingredienteActivo,
          tipo: linea.tipo || '',
          plagaQueControla: linea.plagaQueControla || '',
          periodoReingreso: parseFloat(linea.periodoReingreso) || 0,
          periodoACosecha: parseFloat(linea.periodoACosecha) || 0,
          unidad: linea.unidad || 'L',
          stockActual: cantidad,
          stockMinimo: parseFloat(linea.stockMinimo) || 0,
          moneda: linea.moneda || 'USD',
          tipoCambio: parseFloat(linea.tipoCambio) || 1,
          precioUnitario: parseFloat(linea.precioUnitario) || 0,
          proveedor: proveedor || '',
          fincaId: ID_FINCA_ACTUAL,
        });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: newProdRef.id,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          cantidad,
          unidad: linea.unidad || 'L',
          fecha: Timestamp.now(),
          motivo: motivoCompra,
          compraId: compraRef.id,
          fincaId: ID_FINCA_ACTUAL,
        });
        productosCreados++;
      }
      // Si no tiene productoId ni ingredienteActivo: se ignora (incompleto)
    }

    // Guardar registro de compra (ref pre-generada arriba)
    batch.set(compraRef, {
      fincaId: ID_FINCA_ACTUAL,
      proveedor: proveedor || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha)) : Timestamp.now(),
      lineas: lineas.map(l => ({
        productoId: l.productoId || null,
        nombreFactura: l.nombreFactura || '',
        cantidadIngresada: parseFloat(l.cantidadIngresada) || 0,
        unidad: l.unidad || '',
      })),
      imageBase64: imageBase64 || null,
      mediaType: mediaType || null,
      createdAt: Timestamp.now(),
    });

    await batch.commit();
    res.status(201).json({
      id: compraRef.id,
      stockActualizados,
      productosCreados,
      message: 'Compra registrada exitosamente.',
    });
  } catch (error) {
    console.error("Error confirmando compra:", error);
    res.status(500).json({ message: 'Error al registrar la compra.' });
  }
});

// --- API ENDPOINTS: SOLICITUDES DE COMPRA ---
app.get('/api/solicitudes-compra', async (req, res) => {
  try {
    const snapshot = await db.collection('solicitudes_compra')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .orderBy('fechaCreacion', 'desc')
      .limit(50)
      .get();
    const solicitudes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fechaCreacion: doc.data().fechaCreacion.toDate().toISOString(),
    }));
    res.status(200).json(solicitudes);
  } catch (error) {
    console.error('Error fetching solicitudes:', error);
    res.status(500).json({ message: 'Error al obtener solicitudes.' });
  }
});

app.post('/api/solicitudes-compra', async (req, res) => {
  try {
    const { responsableId, responsableNombre, notas, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un producto.' });
    }

    const resolvedResponsableId = responsableId || 'proveeduria';
    const resolvedResponsableNombre = responsableNombre || 'Proveeduría';

    const mappedItems = items.map(i => ({
      productoId: i.productoId,
      nombreComercial: i.nombreComercial,
      cantidadSolicitada: parseFloat(i.cantidadSolicitada) || 0,
      unidad: i.unidad,
      stockActual: parseFloat(i.stockActual) || 0,
      stockMinimo: parseFloat(i.stockMinimo) || 0,
    }));

    const batch = db.batch();

    // Crear la solicitud de compra
    const solicitudRef = db.collection('solicitudes_compra').doc();
    batch.set(solicitudRef, {
      fincaId: ID_FINCA_ACTUAL,
      fechaCreacion: Timestamp.now(),
      estado: 'pendiente',
      responsableId: resolvedResponsableId,
      responsableNombre: resolvedResponsableNombre,
      notas: notas || '',
      items: mappedItems,
    });

    // Crear tarea asociada en scheduled_tasks
    const productosResumen = mappedItems
      .map(i => `${i.nombreComercial} (${i.cantidadSolicitada} ${i.unidad})`)
      .join(', ');
    const taskRef = db.collection('scheduled_tasks').doc();
    batch.set(taskRef, {
      type: 'SOLICITUD_COMPRA',
      executeAt: Timestamp.now(),
      status: 'pending',
      loteId: null,
      fincaId: ID_FINCA_ACTUAL,
      solicitudId: solicitudRef.id,
      activity: {
        name: `Solicitud de compra: ${mappedItems.length} producto(s)`,
        type: 'notificacion',
        responsableId: resolvedResponsableId,
        responsableNombre: resolvedResponsableNombre,
        descripcion: productosResumen,
        productos: mappedItems.map(i => ({
          productoId: i.productoId,
          nombreComercial: i.nombreComercial,
          cantidad: i.cantidadSolicitada,
          unidad: i.unidad,
          stockActual: i.stockActual,
          stockMinimo: i.stockMinimo,
        })),
      },
      notas: notas || '',
    });

    await batch.commit();
    res.status(201).json({ id: solicitudRef.id, taskId: taskRef.id, message: 'Solicitud creada exitosamente.' });
  } catch (error) {
    console.error('Error creating solicitud:', error);
    res.status(500).json({ message: 'Error al crear la solicitud.' });
  }
});

app.put('/api/solicitudes-compra/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, items, responsableId, responsableNombre, notas } = req.body;
    const update = {};
    if (estado) update.estado = estado;
    if (items) update.items = items;
    if (responsableId !== undefined) update.responsableId = responsableId;
    if (responsableNombre !== undefined) update.responsableNombre = responsableNombre;
    if (notas !== undefined) update.notas = notas;
    await db.collection('solicitudes_compra').doc(id).update(update);
    res.status(200).json({ message: 'Solicitud actualizada.' });
  } catch (error) {
    console.error('Error updating solicitud:', error);
    res.status(500).json({ message: 'Error al actualizar la solicitud.' });
  }
});

app.delete('/api/solicitudes-compra/:id', async (req, res) => {
  try {
    await db.collection('solicitudes_compra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    console.error('Error deleting solicitud:', error);
    res.status(500).json({ message: 'Error al eliminar la solicitud.' });
  }
});

// --- API ENDPOINTS: MOVIMIENTOS ---
app.get('/api/movimientos', async (req, res) => {
  try {
    const { productoId } = req.query;
    let query = db.collection('movimientos')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .orderBy('fecha', 'desc')
      .limit(100);
    if (productoId) {
      query = db.collection('movimientos')
        .where('fincaId', '==', ID_FINCA_ACTUAL)
        .where('productoId', '==', productoId)
        .orderBy('fecha', 'desc')
        .limit(100);
    }
    const snapshot = await query.get();
    const movimientos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha.toDate().toISOString(),
    }));
    res.status(200).json(movimientos);
  } catch (error) {
    console.error('Error fetching movimientos:', error);
    res.status(500).json({ message: 'Error al obtener movimientos.' });
  }
});

// --- API ENDPOINTS: ÓRDENES DE COMPRA ---
app.get('/api/ordenes-compra', async (req, res) => {
  try {
    const snapshot = await db.collection('ordenes_compra')
      .where('fincaId', '==', ID_FINCA_ACTUAL)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    let ordenes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha ? doc.data().fecha.toDate().toISOString() : null,
      fechaEntrega: doc.data().fechaEntrega ? doc.data().fechaEntrega.toDate().toISOString() : null,
      createdAt: doc.data().createdAt ? doc.data().createdAt.toDate().toISOString() : null,
    }));
    const { estado } = req.query;
    if (estado) ordenes = ordenes.filter(o => o.estado === estado);
    res.status(200).json(ordenes);
  } catch (error) {
    console.error('Error fetching ordenes:', error);
    res.status(500).json({ message: 'Error al obtener órdenes de compra.' });
  }
});

app.post('/api/ordenes-compra', async (req, res) => {
  try {
    const { poNumber, fecha, fechaEntrega, proveedor, direccionProveedor, elaboradoPor, notas, items, taskId, solicitudId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un producto.' });
    }
    const docRef = await db.collection('ordenes_compra').add({
      fincaId: ID_FINCA_ACTUAL,
      poNumber: poNumber || `OC-${Date.now()}`,
      fecha: fecha ? Timestamp.fromDate(new Date(fecha)) : Timestamp.now(),
      fechaEntrega: fechaEntrega ? Timestamp.fromDate(new Date(fechaEntrega)) : null,
      proveedor: proveedor || '',
      direccionProveedor: direccionProveedor || '',
      elaboradoPor: elaboradoPor || '',
      notas: notas || '',
      estado: 'activa',
      taskId: taskId || null,
      solicitudId: solicitudId || null,
      items: items.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: i.nombreComercial || '',
        ingredienteActivo: i.ingredienteActivo || '',
        cantidad: parseFloat(i.cantidad) || 0,
        unidad: i.unidad || '',
        precioUnitario: parseFloat(i.precioUnitario) || 0,
        moneda: i.moneda || 'USD',
      })),
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: docRef.id, message: 'Orden de compra guardada.' });
  } catch (error) {
    console.error('Error saving orden:', error);
    res.status(500).json({ message: 'Error al guardar la orden de compra.' });
  }
});

// --- API ENDPOINTS: RECEPCIONES DE PRODUCTOS ---
app.get('/api/recepciones', async (req, res) => {
  try {
    const { ordenCompraId } = req.query;
    let query = db.collection('recepciones').where('fincaId', '==', ID_FINCA_ACTUAL);
    if (ordenCompraId) {
      query = query.where('ordenCompraId', '==', ordenCompraId).limit(5);
    } else {
      query = query.orderBy('fechaRecepcion', 'desc').limit(50);
    }
    const snapshot = await query.get();
    const recepciones = snapshot.docs.map(doc => {
      const data = doc.data();
      // eslint-disable-next-line no-unused-vars
      const { imageBase64, mediaType, ...rest } = data; // strip legacy base64 fields
      return {
        id: doc.id,
        ...rest,
        fechaRecepcion: data.fechaRecepcion ? data.fechaRecepcion.toDate().toISOString() : null,
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      };
    });
    res.status(200).json(recepciones);
  } catch (error) {
    console.error('Error fetching recepciones:', error);
    res.status(500).json({ message: 'Error al obtener recepciones.' });
  }
});

app.post('/api/recepciones', async (req, res) => {
  try {
    const { ordenCompraId, poNumber, proveedor, items, notas, imageBase64, mediaType } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ítem.' });
    }
    const recibidos = items.filter(i => parseFloat(i.cantidadRecibida) > 0);
    if (recibidos.length === 0) {
      return res.status(400).json({ message: 'Al menos un producto debe tener cantidad recibida mayor a cero.' });
    }

    const recepcionRef = db.collection('recepciones').doc();
    const motivo = `Recepción OC: ${poNumber || ordenCompraId || 'Manual'}`;

    // Upload image to Firebase Storage (if provided)
    let imageUrl = null;
    if (imageBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `recepciones/${recepcionRef.id}.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(imageBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        imageUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Storage upload failed:', storageErr.message);
      }
    }

    const batch = db.batch();

    for (const item of recibidos) {
      const cantidadRecibida = parseFloat(item.cantidadRecibida);
      if (item.productoId) {
        batch.update(db.collection('productos').doc(item.productoId), {
          stockActual: FieldValue.increment(cantidadRecibida),
        });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: item.productoId,
          nombreComercial: item.nombreComercial || '',
          cantidad: cantidadRecibida,
          unidad: item.unidad || '',
          fecha: Timestamp.now(),
          motivo,
          recepcionId: recepcionRef.id,
          fincaId: ID_FINCA_ACTUAL,
        });
      }
    }

    batch.set(recepcionRef, {
      fincaId: ID_FINCA_ACTUAL,
      ordenCompraId: ordenCompraId || null,
      poNumber: poNumber || '',
      proveedor: proveedor || '',
      fechaRecepcion: Timestamp.now(),
      items: recibidos.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: i.nombreComercial || '',
        cantidadOC: parseFloat(i.cantidadOC) || 0,
        cantidadRecibida: parseFloat(i.cantidadRecibida),
        unidad: i.unidad || '',
      })),
      notas: notas || '',
      imageUrl: imageUrl || null,
      createdAt: Timestamp.now(),
    });

    if (ordenCompraId) {
      const allReceived = items.every(
        i => parseFloat(i.cantidadRecibida) >= parseFloat(i.cantidadOC)
      );
      batch.update(db.collection('ordenes_compra').doc(ordenCompraId), {
        estado: allReceived ? 'recibida' : 'recibida_parcial',
      });
    }

    await batch.commit();
    res.status(201).json({ id: recepcionRef.id, message: 'Recepción registrada y stock actualizado.' });
  } catch (error) {
    console.error('Error processing recepcion:', error);
    res.status(500).json({ message: 'Error al registrar la recepción.' });
  }
});

// Se exporta la app de Express, inyectando los secretos necesarios.
exports.api = functions.runWith({
  secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, anthropicApiKey]
}).https.onRequest(app);
