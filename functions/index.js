
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

  const lotePromise = db.collection('lotes').doc(task.loteId).get();
  const userPromise = db.collection('users').doc(task.activity.responsableId).get();
  const [loteDoc, userDoc] = await Promise.all([lotePromise, userPromise]);

  const lote = loteDoc.data();
  const responsable = userDoc.data();

  return {
    id: taskDoc.id,
    activityName: task.activity.name,
    loteName: lote ? lote.nombreLote : 'Lote no encontrado',
    loteHectareas: lote ? (lote.hectareas || 1) : 1,
    responsableName: responsable ? responsable.nombre : 'Usuario no encontrado',
    responsableTel: responsable ? responsable.telefono : 'Sin teléfono',
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
          const batch = db.batch();
          batch.update(db.collection('scheduled_tasks').doc(id), updateData);
          for (const prod of productos) {
            // Tareas ad-hoc usan `cantidad` absoluta; tareas de paquete usan `cantidadPorHa × hectareas`
            const deduccion = prod.cantidad !== undefined
              ? prod.cantidad
              : prod.cantidadPorHa * hectareas;
            const prodRef = db.collection('productos').doc(prod.productoId);
            batch.update(prodRef, { stockActual: FieldValue.increment(-deduccion) });
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

    for (const linea of lineas) {
      const cantidad = parseFloat(linea.cantidadIngresada) || 0;
      if (cantidad <= 0) continue;

      if (linea.productoId) {
        // ── Producto existente: solo incrementar stock ──
        const prodRef = db.collection('productos').doc(linea.productoId);
        batch.update(prodRef, { stockActual: FieldValue.increment(cantidad) });
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
        productosCreados++;
      }
      // Si no tiene productoId ni ingredienteActivo: se ignora (incompleto)
    }

    // Guardar registro de compra
    const compraRef = db.collection('compras').doc();
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

// Se exporta la app de Express, inyectando los secretos necesarios.
exports.api = functions.runWith({
  secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, anthropicApiKey]
}).https.onRequest(app);
