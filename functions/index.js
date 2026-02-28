
const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// --- DEFINICIÓN DE SECRETOS CON EL NUEVO SISTEMA "PARAMS" ---
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");

// --- INICIALIZACIÓN UNIVERSAL DE CLIENTES ---
// Se inicializa sin parámetros para que funcione tanto en el emulador como en producción.
admin.initializeApp();
const db = getFirestore(admin.app(), 'auroradatabase');

// El cliente de Twilio se declarará y se inicializará "perezosamente" (lazy)
// solo cuando sea necesario, para evitar errores de despliegue.
let twilioClient;

const app = express();
const ID_FINCA_ACTUAL = 'finca_aurora_test';

// URL de la app desplegada (¡IMPORTANTE!)
const APP_URL = 'https://aurora-7dc9b.web.app';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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
    await db.collection('scheduled_tasks').doc(id).update(updateData);
    res.status(200).json({ id, ...updateData });
  } catch (error) {
    console.error(`Error updating task ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al actualizar la tarea.' });
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
    const { nombreLote, fechaCreacion, paqueteId } = req.body;
    if (!nombreLote || !fechaCreacion || !paqueteId) {
        return res.status(400).json({ message: 'Faltan datos para crear el lote.' });
    }

    try {
        const loteRef = await db.collection('lotes').add({ nombreLote, fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)), paqueteId, fincaId: ID_FINCA_ACTUAL });
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

// El cron job se elimina de aquí. Debería ser una función separada
// con un trigger de schedule si es necesario.

// Se exporta la app de Express, inyectando los secretos necesarios.
exports.api = functions.runWith({ secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom] }).https.onRequest(app);
