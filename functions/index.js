
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

// URL de la app desplegada (¡IMPORTANTE!)
const APP_URL = 'https://aurora-7dc9b.web.app';

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '15mb' }));

// --- HELPERS DE SEGURIDAD ---
// Extrae solo los campos permitidos de un objeto (evita mass assignment)
const pick = (obj, fields) => fields.reduce((acc, f) => {
  if (obj[f] !== undefined) acc[f] = obj[f];
  return acc;
}, {});

// Verifica que un documento exista y pertenezca a la finca del request
const verifyOwnership = async (collection, docId, fincaId) => {
  const doc = await db.collection(collection).doc(docId).get();
  if (!doc.exists) return { ok: false, status: 404, message: 'Documento no encontrado.' };
  if (doc.data().fincaId !== fincaId) return { ok: false, status: 403, message: 'Acceso no autorizado.' };
  return { ok: true, doc };
};

// --- MIDDLEWARE DE AUTENTICACIÓN ---
// Verifica el Firebase ID Token y la membresía del usuario en la finca indicada.
// Rutas públicas (WhatsApp) usan skipAuth: true y no pasan por aquí.
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const fincaId = req.headers['x-finca-id'];

  if (!authHeader?.startsWith('Bearer ') || !fincaId) {
    return res.status(401).json({ message: 'No autorizado.' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // Verificar membresía en la finca solicitada
    const membershipSnap = await db.collection('memberships')
      .where('uid', '==', uid)
      .where('fincaId', '==', fincaId)
      .limit(1)
      .get();

    if (membershipSnap.empty) {
      return res.status(403).json({ message: 'No tienes acceso a esta organización.' });
    }

    req.uid = uid;
    req.fincaId = fincaId;
    req.userRole = membershipSnap.docs[0].data().rol;
    next();
  } catch (error) {
    console.error('[AUTH] Token inválido:', error.message);
    return res.status(401).json({ message: 'Sesión inválida. Inicia sesión de nuevo.' });
  }
};

// Middleware solo de token (sin verificar finca) — para endpoints de auth
const authenticateOnly = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autorizado.' });
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Sesión inválida.' });
  }
};

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

  const sourcePromise = task.loteId
    ? db.collection('lotes').doc(task.loteId).get()
    : task.grupoId
    ? db.collection('grupos').doc(task.grupoId).get()
    : Promise.resolve(null);
  const userPromise = hasRealUser
    ? db.collection('users').doc(responsableId).get()
    : Promise.resolve(null);

  const [sourceDoc, userDoc] = await Promise.all([sourcePromise, userPromise]);

  const source = sourceDoc ? sourceDoc.data() : null;
  const responsable = userDoc ? userDoc.data() : null;

  return {
    id: taskDoc.id,
    activityName: task.activity?.name,
    loteName: source
      ? (source.nombreLote || source.nombreGrupo || '—')
      : (task.loteId || task.grupoId) ? 'No encontrado' : '—',
    loteHectareas: source ? (source.hectareas || 1) : 1,
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

// --- API ENDPOINTS: AUTH / MULTI-TENANT ---

// GET /api/auth/memberships — lista las fincas del usuario autenticado
app.get('/api/auth/memberships', authenticateOnly, async (req, res) => {
  try {
    const snap = await db.collection('memberships')
      .where('uid', '==', req.uid)
      .get();
    const memberships = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ memberships });
  } catch (error) {
    console.error('[AUTH] Error fetching memberships:', error);
    res.status(500).json({ message: 'Error al obtener las organizaciones.' });
  }
});

// GET /api/auth/me — perfil del usuario en la finca activa
app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('memberships')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ message: 'Perfil no encontrado.' });
    const membership = snap.docs[0].data();
    const fincaDoc = await db.collection('fincas').doc(req.fincaId).get();
    res.status(200).json({
      uid: req.uid,
      ...membership,
      fincaNombre: fincaDoc.exists ? fincaDoc.data().nombre : '',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el perfil.' });
  }
});

// POST /api/auth/register-finca — crea una nueva finca y el admin inicial
app.post('/api/auth/register-finca', authenticateOnly, async (req, res) => {
  try {
    const { fincaNombre, nombreAdmin } = req.body;
    if (!fincaNombre || !nombreAdmin) {
      return res.status(400).json({ message: 'fincaNombre y nombreAdmin son requeridos.' });
    }
    const fincaRef = db.collection('fincas').doc();
    const batch = db.batch();
    batch.set(fincaRef, {
      nombre: fincaNombre,
      adminUid: req.uid,
      plan: 'basic',
      creadoEn: Timestamp.now(),
    });
    const membershipRef = db.collection('memberships').doc();
    batch.set(membershipRef, {
      uid: req.uid,
      fincaId: fincaRef.id,
      fincaNombre,
      email: req.userEmail || '',
      nombre: nombreAdmin,
      telefono: '',
      rol: 'administrador',
      creadoEn: Timestamp.now(),
    });
    await batch.commit();
    res.status(201).json({ fincaId: fincaRef.id, message: 'Organización creada exitosamente.' });
  } catch (error) {
    console.error('[AUTH] Error creating finca:', error);
    res.status(500).json({ message: 'Error al crear la organización.' });
  }
});

// --- API ENDPOINTS: TASKS ---
app.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const tasksSnapshot = await db.collection('scheduled_tasks').where('fincaId', '==', req.fincaId).get();
    const enrichedTasksPromises = tasksSnapshot.docs.map(enrichTask);
    const enrichedTasks = await Promise.all(enrichedTasksPromises);
    res.status(200).json(enrichedTasks.filter(t => t !== null));
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: 'Error al obtener las tareas.' });
  }
});

app.post('/api/tasks', authenticate, async (req, res) => {
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

app.get('/api/tasks/overdue-count', authenticate, async (req, res) => {
  try {
    const now = Timestamp.now();
    const snapshot = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
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

app.put('/api/tasks/:id', authenticate, async (req, res) => {
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
              fincaId: taskData.fincaId,
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
app.get('/api/task-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('task_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

app.post('/api/task-templates', authenticate, async (req, res) => {
  try {
    const { nombre, responsableId, productos } = req.body;
    if (!nombre)
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const template = {
      nombre,
      responsableId: responsableId || '',
      productos: productos || [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('task_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear plantilla.' });
  }
});

app.delete('/api/task-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('task_templates').doc(req.params.id).delete();
    res.json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

// --- API ENDPOINTS: USERS ---
app.get('/api/users', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios.' });
  }
});

app.post('/api/users', authenticate, async (req, res) => {
  try {
    const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];
    const { nombre, email, telefono, rol, empleadoPlanilla } = req.body;
    if (!nombre || !email) return res.status(400).json({ message: 'nombre y email son requeridos.' });
    if (rol && !ROLES_VALIDOS.includes(rol)) return res.status(400).json({ message: 'Rol inválido.' });
    const user = { nombre, email, telefono: telefono || '', rol: rol || 'trabajador', empleadoPlanilla: empleadoPlanilla === true, fincaId: req.fincaId };
    const docRef = await db.collection('users').add(user);
    res.status(201).json({ id: docRef.id, ...user });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear usuario.' });
  }
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];
    const userData = pick(req.body, ['nombre', 'email', 'telefono', 'rol', 'empleadoPlanilla']);
    if (userData.rol && !ROLES_VALIDOS.includes(userData.rol)) return res.status(400).json({ message: 'Rol inválido.' });
    await db.collection('users').doc(id).update(userData);
    res.status(200).json({ id, ...userData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  }
});

app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('users').doc(id).delete();
    res.status(200).json({ message: 'Usuario eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar usuario.' });
  }
});

// --- API ENDPOINTS: PRODUCTOS ---
app.get('/api/productos', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(productos);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener productos.' });
  }
});

const CAMPOS_PRODUCTO = ['idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo',
  'plagaQueControla', 'periodoReingreso', 'periodoACosecha', 'cantidadPorHa',
  'unidad', 'stockActual', 'stockMinimo', 'moneda', 'tipoCambio', 'precioUnitario', 'proveedor'];

app.post('/api/productos', authenticate, async (req, res) => {
  try {
    const producto = { ...pick(req.body, CAMPOS_PRODUCTO), fincaId: req.fincaId };

    // Verificar si ya existe un producto con el mismo idProducto
    if (producto.idProducto) {
      const existing = await db.collection('productos')
        .where('fincaId', '==', req.fincaId)
        .where('idProducto', '==', producto.idProducto)
        .limit(1)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        const stockIngresado = parseFloat(producto.stockActual) || 0;
        await doc.ref.update({ stockActual: FieldValue.increment(stockIngresado) });
        const updated = { ...doc.data(), stockActual: (doc.data().stockActual || 0) + stockIngresado };
        return res.status(200).json({ id: doc.id, ...updated, merged: true });
      }
    }

    const docRef = await db.collection('productos').add(producto);
    res.status(201).json({ id: docRef.id, ...producto, merged: false });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear producto.' });
  }
});

app.put('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const productoData = pick(req.body, CAMPOS_PRODUCTO);
    await db.collection('productos').doc(id).update(productoData);
    res.status(200).json({ id, ...productoData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar producto.' });
  }
});

app.delete('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('productos').doc(id).delete();
    res.status(200).json({ message: 'Producto eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar producto.' });
  }
});

// --- API ENDPOINTS: PACKAGES (PLANTILLAS) ---
app.get('/api/packages', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('packages').where('fincaId', '==', req.fincaId).get();
    const packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener paquetes.' });
  }
});

app.post('/api/packages', authenticate, async (req, res) => {
  try {
    const { nombrePaquete } = req.body;
    if (!nombrePaquete) return res.status(400).json({ message: 'nombrePaquete es requerido.' });
    const pkg = { ...pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'activities', 'descripcion']), fincaId: req.fincaId };
    const docRef = await db.collection('packages').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear paquete.' });
  }
});

app.put('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const pkgData = pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'activities', 'descripcion']);
    await db.collection('packages').doc(id).update(pkgData);
    res.status(200).json({ id, ...pkgData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el paquete.' });
  }
});

app.delete('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('packages').doc(id).delete();
    res.status(200).json({ message: 'Paquete eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el paquete.' });
  }
});

// --- API ENDPOINTS: LOTES ---
app.get('/api/lotes', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('lotes').where('fincaId', '==', req.fincaId).get();
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


app.post('/api/lotes', authenticate, async (req, res) => {
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

        res.status(201).json({ id: loteRef.id, message: 'Lote y tareas programadas con éxito. Se enviaron notificaciones inmediatas.' });

    } catch (error) {
        console.error("[ERROR] Creando lote y tareas:", error);
        res.status(500).json({ message: 'Error al procesar el lote.' });
    }
});

app.put('/api/lotes/:id', authenticate, async (req, res) => {
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

app.get('/api/lotes/:id/task-count', authenticate, async (req, res) => {
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

app.delete('/api/lotes/:id', authenticate, async (req, res) => {
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

// --- API ENDPOINTS: GRUPOS ---
app.get('/api/grupos', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('grupos').where('fincaId', '==', req.fincaId).get();
        const grupos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(grupos);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener grupos.' });
    }
});

app.post('/api/grupos', authenticate, async (req, res) => {
    try {
        const { nombreGrupo, cosecha, etapa, fechaCreacion, bloques, paqueteId } = req.body;
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

                return res.status(201).json({ id: grupoRef.id, message: 'Grupo y tareas programadas con éxito.' });
            }
        }

        res.status(201).json({ id: grupoRef.id, message: 'Grupo creado exitosamente.' });
    } catch (error) {
        console.error('[ERROR] Creando grupo:', error);
        res.status(500).json({ message: 'Error al crear el grupo.' });
    }
});

app.put('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

        const grupoData = pick(req.body, ['nombreGrupo', 'cosecha', 'etapa', 'fechaCreacion', 'bloques', 'paqueteId']);
        const originalData = ownership.doc.data();

        if (grupoData.fechaCreacion && typeof grupoData.fechaCreacion === 'string') {
            grupoData.fechaCreacion = Timestamp.fromDate(new Date(grupoData.fechaCreacion));
        }

        await db.collection('grupos').doc(id).update(grupoData);

        const hasDateChanged = originalData.fechaCreacion?.toMillis() !== grupoData.fechaCreacion?.toMillis();
        const hasPackageChanged = originalData.paqueteId !== grupoData.paqueteId;

        if (hasDateChanged || hasPackageChanged) {
            // Eliminar tareas anteriores del grupo
            const tasksSnapshot = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
            const deleteBatch = db.batch();
            tasksSnapshot.docs.forEach(doc => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            // Crear nuevas tareas si hay paquete
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
        }

        res.status(200).json({ id, ...grupoData });
    } catch (error) {
        console.error('Error updating grupo:', error);
        res.status(500).json({ message: 'Error al actualizar el grupo.' });
    }
});

app.delete('/api/grupos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const ownership = await verifyOwnership('grupos', id, req.fincaId);
        if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
        const tasksSnapshot = await db.collection('scheduled_tasks').where('grupoId', '==', id).get();
        const batch = db.batch();
        tasksSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('grupos').doc(id));
        await batch.commit();
        res.status(200).json({ message: 'Grupo y tareas asociadas eliminados correctamente.' });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar el grupo.' });
    }
});

// --- API ENDPOINTS: TASK ACTIONS ---

app.post('/api/tasks/:id/reschedule', authenticate, async (req, res) => {
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

app.post('/api/tasks/:id/reassign', authenticate, async (req, res) => {
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

// --- API ENDPOINTS: COMPRAS (ESCANEO DE FACTURAS) ---

app.get('/api/compras', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('compras')
      .where('fincaId', '==', req.fincaId)
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

app.post('/api/compras/escanear', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ message: 'Se requiere imageBase64 y mediaType.' });
    }
    const MEDIA_TYPES_VALIDOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!MEDIA_TYPES_VALIDOS.includes(mediaType)) {
      return res.status(400).json({ message: 'Tipo de imagen no soportado. Use jpeg, png, gif o webp.' });
    }

    // Obtener catálogo de productos actual para que Claude pueda hacer el match
    const productosSnap = await db.collection('productos')
      .where('fincaId', '==', req.fincaId)
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

app.post('/api/compras/confirmar', authenticate, async (req, res) => {
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
          fincaId: req.fincaId,
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
          fincaId: req.fincaId,
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
          fincaId: req.fincaId,
        });
        productosCreados++;
      }
      // Si no tiene productoId ni ingredienteActivo: se ignora (incompleto)
    }

    // Guardar registro de compra (ref pre-generada arriba)
    batch.set(compraRef, {
      fincaId: req.fincaId,
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
app.get('/api/solicitudes-compra', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('solicitudes_compra')
      .where('fincaId', '==', req.fincaId)
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

app.post('/api/solicitudes-compra', authenticate, async (req, res) => {
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
      fincaId: req.fincaId,
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
      fincaId: req.fincaId,
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

app.put('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('solicitudes_compra', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { estado, items, responsableId, responsableNombre, notas } = req.body;
    const ESTADOS_VALIDOS = ['pendiente', 'aprobada', 'rechazada', 'completada'];
    if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ message: 'Estado inválido.' });
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

app.delete('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('solicitudes_compra', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('solicitudes_compra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    console.error('Error deleting solicitud:', error);
    res.status(500).json({ message: 'Error al eliminar la solicitud.' });
  }
});

// --- API ENDPOINTS: MOVIMIENTOS ---
app.get('/api/movimientos', authenticate, async (req, res) => {
  try {
    const { productoId } = req.query;
    let query = db.collection('movimientos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .limit(100);
    if (productoId) {
      query = db.collection('movimientos')
        .where('fincaId', '==', req.fincaId)
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
app.get('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('ordenes_compra')
      .where('fincaId', '==', req.fincaId)
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

app.post('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const { fecha, fechaEntrega, proveedor, direccionProveedor, elaboradoPor, notas, items, taskId, solicitudId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un producto.' });
    }
    const counterRef = db.collection('counters').doc(`oc_${req.fincaId}`);
    let seq;
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      t.set(counterRef, { value: seq }, { merge: true });
    });
    const poNumber = `OC-${String(seq).padStart(6, '0')}`;
    const docRef = await db.collection('ordenes_compra').add({
      fincaId: req.fincaId,
      poNumber,
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
    if (solicitudId) {
      await db.collection('scheduled_tasks').doc(solicitudId).update({
        status: 'completed_by_user',
        completedAt: Timestamp.now(),
        ordenCompraId: docRef.id,
      });
    }
    res.status(201).json({ id: docRef.id, poNumber, message: 'Orden de compra guardada.' });
  } catch (error) {
    console.error('Error saving orden:', error);
    res.status(500).json({ message: 'Error al guardar la orden de compra.' });
  }
});

// --- API ENDPOINTS: RECEPCIONES DE PRODUCTOS ---
app.get('/api/recepciones', authenticate, async (req, res) => {
  try {
    const { ordenCompraId } = req.query;
    let query = db.collection('recepciones').where('fincaId', '==', req.fincaId);
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

app.post('/api/recepciones', authenticate, async (req, res) => {
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
          fincaId: req.fincaId,
        });
      }
    }

    batch.set(recepcionRef, {
      fincaId: req.fincaId,
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

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: RECURSOS HUMANOS
// ─────────────────────────────────────────────────────────────────────────────

// ── Fichas del Trabajador ────────────────────────────────────────────────────
app.get('/api/hr/fichas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId).get();
    const data = snap.docs.map(d => ({ userId: d.id, ...d.data() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener fichas.' });
  }
});

app.get('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('hr_fichas').doc(req.params.userId).get();
    res.status(200).json(doc.exists ? { id: doc.id, ...doc.data() } : {});
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener ficha.' });
  }
});

app.put('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    await db.collection('hr_fichas').doc(req.params.userId).set(
      { ...req.body, fincaId: req.fincaId, updatedAt: Timestamp.now() },
      { merge: true }
    );
    res.status(200).json({ message: 'Ficha actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar ficha.' });
  }
});

// ── Asistencia ───────────────────────────────────────────────────────────────
app.get('/api/hr/asistencia', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_asistencia').where('fincaId', '==', req.fincaId);
    if (mes && anio) {
      const start = Timestamp.fromDate(new Date(Number(anio), Number(mes) - 1, 1));
      const end   = Timestamp.fromDate(new Date(Number(anio), Number(mes), 1));
      query = query.where('fecha', '>=', start).where('fecha', '<', end);
    }
    const snap = await query.orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener asistencia.' });
  }
});

app.post('/api/hr/asistencia', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, estado, horasExtra, notas } = req.body;
    if (!trabajadorId || !fecha || !estado) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_asistencia').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha)),
      estado, horasExtra: Number(horasExtra) || 0, notas: notas || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar asistencia.' });
  }
});

app.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar registro.' });
  }
});

// ── Horas Extra ──────────────────────────────────────────────────────────────
app.get('/api/hr/horas-extra', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_horas_extra').where('fincaId', '==', req.fincaId);
    if (mes && anio) {
      const start = Timestamp.fromDate(new Date(Number(anio), Number(mes) - 1, 1));
      const end   = Timestamp.fromDate(new Date(Number(anio), Number(mes), 1));
      query = query.where('fecha', '>=', start).where('fecha', '<', end);
    }
    const snap = await query.orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener horas extra.' });
  }
});

app.post('/api/hr/horas-extra', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, horas, motivo } = req.body;
    if (!trabajadorId || !fecha || !horas) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_horas_extra').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha)),
      horas: Number(horas), motivo: motivo || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar horas extra.' });
  }
});

app.delete('/api/hr/horas-extra/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_horas_extra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Permisos y Vacaciones ────────────────────────────────────────────────────
app.get('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_permisos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaInicio', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fechaInicio: d.data().fechaInicio.toDate().toISOString(),
      fechaFin: d.data().fechaFin.toDate().toISOString(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener permisos.' });
  }
});

app.post('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, tipo, fechaInicio, fechaFin, dias, motivo, conGoce } = req.body;
    if (!trabajadorId || !tipo || !fechaInicio || !fechaFin) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_permisos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      fechaInicio: Timestamp.fromDate(new Date(fechaInicio)),
      fechaFin: Timestamp.fromDate(new Date(fechaFin)),
      dias: Number(dias) || 1, motivo: motivo || '',
      conGoce: conGoce !== false,
      estado: 'pendiente', fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear permiso.' });
  }
});

app.put('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_permisos').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Permiso actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar permiso.' });
  }
});

app.delete('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_permisos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Permiso eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar permiso.' });
  }
});

// ── Planilla ─────────────────────────────────────────────────────────────────
app.get('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_planilla').where('fincaId', '==', req.fincaId);
    if (mes) query = query.where('mes', '==', Number(mes));
    if (anio) query = query.where('anio', '==', Number(anio));
    const snap = await query.orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener planilla.' });
  }
});

app.post('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, mes, anio, diasTrabajados, horasExtra, salarioBase, deducciones, total } = req.body;
    if (!trabajadorId || !mes || !anio) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_planilla').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      mes: Number(mes), anio: Number(anio),
      diasTrabajados: Number(diasTrabajados) || 0,
      horasExtra: Number(horasExtra) || 0,
      salarioBase: Number(salarioBase) || 0,
      deducciones: Number(deducciones) || 0,
      total: Number(total) || 0,
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar planilla.' });
  }
});

app.delete('/api/hr/planilla/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Planilla Salario Fijo ─────────────────────────────────────────────────────
app.get('/api/hr/planilla-fijo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_fijo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      periodoInicio: d.data().periodoInicio?.toDate().toISOString(),
      periodoFin: d.data().periodoFin?.toDate().toISOString(),
      createdAt: d.data().createdAt?.toDate().toISOString(),
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener planillas.' });
  }
});

app.post('/api/hr/planilla-fijo', authenticate, async (req, res) => {
  try {
    const { periodoInicio, periodoFin, periodoLabel, filas, totalGeneral } = req.body;
    if (!periodoInicio || !periodoFin || !filas)
      return res.status(400).json({ message: 'Faltan campos requeridos.' });

    // Generate atomic consecutive number PL-00001, PL-00002, ...
    const counterRef = db.collection('counters').doc(`planilla_fijo_${req.fincaId}`);
    const nextNum = await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      const next = (counterDoc.exists ? (counterDoc.data().last || 0) : 0) + 1;
      t.set(counterRef, { last: next }, { merge: true });
      return next;
    });
    const numeroConsecutivo = `PL-${String(nextNum).padStart(5, '0')}`;

    const ref = await db.collection('hr_planilla_fijo').add({
      periodoInicio: Timestamp.fromDate(new Date(periodoInicio)),
      periodoFin: Timestamp.fromDate(new Date(periodoFin)),
      periodoLabel: periodoLabel || '',
      filas,
      totalGeneral: Number(totalGeneral) || 0,
      estado: 'pendiente_pago',
      numeroConsecutivo,
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
    });

    // Notify supervisors/admins via WhatsApp
    try {
      if (!twilioClient) {
        twilioClient = twilio(twilioAccountSid.value(), twilioAuthToken.value());
      }
      const usersSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('rol', 'in', ['supervisor', 'administrador'])
        .get();
      const total = Number(totalGeneral).toLocaleString('es-CR');
      const body = `📋 *Planilla Pendiente de Pago*\nPeríodo: ${periodoLabel}\nTotal a pagar: ₡${total}\nRevise y apruebe el pago en el sistema Aurora.`;
      const from = `whatsapp:${twilioWhatsappFrom.value()}`;
      const notifPromises = [];
      usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.telefono) {
          const to = `whatsapp:${u.telefono.replace(/\s+/g, '')}`;
          notifPromises.push(
            twilioClient.messages.create({ body, from, to })
              .catch(e => console.warn('Notif planilla fallida para', u.nombre, e.message))
          );
        }
      });
      await Promise.all(notifPromises);
    } catch (notifErr) {
      console.warn('Error al enviar notificaciones de planilla:', notifErr.message);
    }

    // Create an unassigned dashboard task for payroll approval
    await db.collection('scheduled_tasks').add({
      type: 'PLANILLA_PAGO',
      status: 'pending',
      executeAt: Timestamp.now(),
      fincaId: req.fincaId,
      planillaId: ref.id,
      activity: {
        name: `Aprobar pago de planilla: ${periodoLabel || ''}`,
        responsableId: null,
        responsableNombre: 'Sin asignar',
      },
    });

    res.status(201).json({ id: ref.id, numeroConsecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar planilla.' });
  }
});

app.put('/api/hr/planilla-fijo/:id', authenticate, async (req, res) => {
  try {
    const { estado, filas, totalGeneral, periodoInicio, periodoFin, periodoLabel } = req.body;
    const update = { updatedAt: Timestamp.now() };
    if (estado) update.estado = estado;
    if (filas) {
      update.filas = filas;
      update.totalGeneral = Number(totalGeneral) || 0;
    }
    if (periodoInicio) update.periodoInicio = Timestamp.fromDate(new Date(periodoInicio));
    if (periodoFin)    update.periodoFin    = Timestamp.fromDate(new Date(periodoFin));
    if (periodoLabel)  update.periodoLabel  = periodoLabel;
    await db.collection('hr_planilla_fijo').doc(req.params.id).update(update);

    // If marking as pagado, complete the associated dashboard task
    if (estado === 'pagado') {
      const taskSnap = await db.collection('scheduled_tasks')
        .where('fincaId', '==', req.fincaId)
        .where('planillaId', '==', req.params.id)
        .where('type', '==', 'PLANILLA_PAGO')
        .limit(1).get();
      if (!taskSnap.empty) {
        await taskSnap.docs[0].ref.update({ status: 'completed_by_user' });
      }
    }

    res.status(200).json({ id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar planilla.' });
  }
});

app.delete('/api/hr/planilla-fijo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla_fijo').doc(req.params.id).delete();
    // Also delete the associated dashboard task
    const taskSnap = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('planillaId', '==', req.params.id)
      .where('type', '==', 'PLANILLA_PAGO')
      .limit(1).get();
    if (!taskSnap.empty) {
      await taskSnap.docs[0].ref.delete();
    }
    res.status(200).json({ message: 'Planilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar planilla.' });
  }
});

// ── Memorándums ───────────────────────────────────────────────────────────────
app.get('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_memorandums')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener memorándums.' });
  }
});

app.post('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, tipo, motivo, descripcion, fecha } = req.body;
    if (!trabajadorId || !tipo || !motivo) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_memorandums').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      motivo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha)) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear memorándum.' });
  }
});

app.delete('/api/hr/memorandums/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_memorandums').doc(req.params.id).delete();
    res.status(200).json({ message: 'Memorándum eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Documentos Adjuntos ───────────────────────────────────────────────────────
app.get('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_documentos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener documentos.' });
  }
});

app.post('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, nombre, tipo, descripcion, fecha } = req.body;
    if (!trabajadorId || !nombre || !tipo) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_documentos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      nombre, tipo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha)) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar documento.' });
  }
});

app.delete('/api/hr/documentos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_documentos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Documento eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Solicitudes de Empleo ─────────────────────────────────────────────────────
app.get('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_solicitudes_empleo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaSolicitud', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fechaSolicitud: d.data().fechaSolicitud.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener solicitudes.' });
  }
});

app.post('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const { nombre, email, telefono, puesto, notas } = req.body;
    if (!nombre || !puesto) return res.status(400).json({ message: 'Nombre y puesto son obligatorios.' });
    const ref = await db.collection('hr_solicitudes_empleo').add({
      nombre, email: email || '', telefono: telefono || '',
      puesto, notas: notas || '', estado: 'pendiente',
      fechaSolicitud: Timestamp.now(), fincaId: req.fincaId,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear solicitud.' });
  }
});

app.put('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Solicitud actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar.' });
  }
});

app.delete('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: CONFIGURACIÓN DE CUENTA
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/config', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('config').doc(req.fincaId).get();
    res.status(200).json(doc.exists ? { id: doc.id, ...doc.data() } : {});
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener configuración.' });
  }
});

app.put('/api/config', authenticate, async (req, res) => {
  try {
    const { nombreEmpresa, identificacion, direccion, whatsapp, correo, logoBase64, mediaType,
            diasIDesarrollo, diasIIDesarrollo, diasPostForza,
            diasSiembraICosecha, diasForzaICosecha, diasChapeaIICosecha, diasForzaIICosecha,
            plantasPorHa, kgPorPlanta, kgPorHa, rechazoICosecha, rechazoIICosecha } = req.body;

    const data = { fincaId: req.fincaId, updatedAt: Timestamp.now() };
    if (nombreEmpresa    !== undefined) data.nombreEmpresa    = nombreEmpresa;
    if (identificacion   !== undefined) data.identificacion   = identificacion;
    if (direccion        !== undefined) data.direccion        = direccion;
    if (whatsapp         !== undefined) data.whatsapp         = whatsapp;
    if (correo           !== undefined) data.correo           = correo;
    if (diasIDesarrollo  !== undefined) data.diasIDesarrollo  = Number(diasIDesarrollo);
    if (diasIIDesarrollo !== undefined) data.diasIIDesarrollo = Number(diasIIDesarrollo);
    if (diasPostForza    !== undefined) data.diasPostForza    = Number(diasPostForza);
    if (diasSiembraICosecha !== undefined) data.diasSiembraICosecha = Number(diasSiembraICosecha);
    if (diasForzaICosecha   !== undefined) data.diasForzaICosecha   = Number(diasForzaICosecha);
    if (diasChapeaIICosecha !== undefined) data.diasChapeaIICosecha = Number(diasChapeaIICosecha);
    if (diasForzaIICosecha  !== undefined) data.diasForzaIICosecha  = Number(diasForzaIICosecha);
    if (plantasPorHa        !== undefined) data.plantasPorHa        = Number(plantasPorHa);
    if (kgPorPlanta         !== undefined) data.kgPorPlanta         = Number(kgPorPlanta);
    if (kgPorHa             !== undefined) data.kgPorHa             = Number(kgPorHa);
    if (rechazoICosecha     !== undefined) data.rechazoICosecha     = Number(rechazoICosecha);
    if (rechazoIICosecha    !== undefined) data.rechazoIICosecha    = Number(rechazoIICosecha);

    if (logoBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `config/${req.fincaId}/logo.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(logoBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        data.logoUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Logo upload failed:', storageErr.message);
      }
    }

    await db.collection('config').doc(req.fincaId).set(data, { merge: true });
    const updated = await db.collection('config').doc(req.fincaId).get();
    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar configuración.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: MONITOREO
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_MONITOREO_DEFAULT = [
  {
    id: 'plagas_foliares',
    nombre: 'Plagas Foliares',
    campos: [
      { key: 'plaga', label: 'Plaga predominante', type: 'text' },
      { key: 'infestacion', label: '% Infestación', type: 'percent' },
      { key: 'severidad', label: 'Severidad', type: 'select', opciones: ['Leve', 'Moderada', 'Severa'] },
    ],
    activo: true,
  },
  {
    id: 'plagas_radicales',
    nombre: 'Plagas Radicales',
    campos: [
      { key: 'cochinilla', label: '% Cochinilla', type: 'percent' },
      { key: 'fusarium', label: '% Fusarium', type: 'percent' },
    ],
    activo: true,
  },
  {
    id: 'crecimiento',
    nombre: 'Crecimiento / Meristemo',
    campos: [
      { key: 'plantas_muestreadas', label: '# Plantas muestreadas', type: 'number' },
      { key: 'altura_promedio', label: 'Altura promedio (cm)', type: 'number' },
      { key: 'largo_hoja_d', label: 'Largo hoja D (cm)', type: 'number' },
    ],
    activo: true,
  },
  {
    id: 'floracion',
    nombre: 'Floración',
    campos: [
      { key: 'porcentaje', label: '% Floración', type: 'percent' },
      { key: 'fecha_estimada_cosecha', label: 'Fecha estimada cosecha', type: 'date' },
    ],
    activo: true,
  },
  {
    id: 'peso_fruta',
    nombre: 'Peso de Fruta',
    campos: [
      { key: 'peso_promedio', label: 'Peso promedio (g)', type: 'number' },
      { key: 'muestra', label: '# Frutas muestreadas', type: 'number' },
    ],
    activo: true,
  },
  {
    id: 'premaduracion',
    nombre: 'Premaduración',
    campos: [
      { key: 'porcentaje_color', label: '% Color', type: 'percent' },
      { key: 'brix', label: '° Brix', type: 'number' },
      { key: 'dias_estimados', label: 'Días estimados a cosecha', type: 'number' },
    ],
    activo: true,
  },
  {
    id: 'malezas',
    nombre: 'Malezas',
    campos: [
      { key: 'cobertura', label: '% Cobertura', type: 'percent' },
      { key: 'especies', label: 'Especies predominantes', type: 'text' },
    ],
    activo: true,
  },
];

// ── Tipos de Monitoreo ────────────────────────────────────────────────────────
app.get('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('tipos_monitoreo').where('fincaId', '==', req.fincaId).get();
    if (!snap.empty) {
      return res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
    // Seed defaults on first call
    const batch = db.batch();
    TIPOS_MONITOREO_DEFAULT.forEach(tipo => {
      const ref = db.collection('tipos_monitoreo').doc();
      batch.set(ref, { ...tipo, fincaId: req.fincaId });
    });
    await batch.commit();
    const snap2 = await db.collection('tipos_monitoreo').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap2.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener tipos de monitoreo.' });
  }
});

app.post('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const { nombre, campos } = req.body;
    if (!nombre || !Array.isArray(campos) || campos.length === 0)
      return res.status(400).json({ message: 'Nombre y al menos un campo son obligatorios.' });
    const ref = await db.collection('tipos_monitoreo').add({
      nombre, campos, activo: true, fincaId: req.fincaId,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear tipo.' });
  }
});

app.put('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('tipos_monitoreo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Tipo actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar tipo.' });
  }
});

app.delete('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('tipos_monitoreo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Tipo eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar tipo.' });
  }
});

// ── Registros de Monitoreo ────────────────────────────────────────────────────
app.get('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, tipoId, desde, hasta } = req.query;
    let query = db.collection('monitoreos').where('fincaId', '==', req.fincaId);
    if (loteId) query = query.where('loteId', '==', loteId);
    if (tipoId) query = query.where('tipoId', '==', tipoId);
    if (desde)  query = query.where('fecha', '>=', Timestamp.fromDate(new Date(desde)));
    if (hasta)  query = query.where('fecha', '<=', Timestamp.fromDate(new Date(hasta)));
    const snap = await query.orderBy('fecha', 'desc').limit(200).get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener monitoreos.' });
  }
});

app.post('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, loteNombre, tipoId, tipoNombre, bloque, fecha, responsableId, responsableNombre, datos, observaciones } = req.body;
    if (!loteId || !tipoId || !fecha)
      return res.status(400).json({ message: 'Lote, tipo y fecha son obligatorios.' });
    const ref = await db.collection('monitoreos').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      tipoId, tipoNombre: tipoNombre || '',
      bloque: bloque || '',
      fecha: Timestamp.fromDate(new Date(fecha)),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      datos: datos || {},
      observaciones: observaciones || '',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar monitoreo.' });
  }
});

app.get('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('monitoreos').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'No encontrado.' });
    res.status(200).json({ id: doc.id, ...doc.data(), fecha: doc.data().fecha.toDate().toISOString() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener monitoreo.' });
  }
});

app.delete('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('monitoreos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Monitoreo eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar monitoreo.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: SIEMBRA
// ─────────────────────────────────────────────────────────────────────────────

// ── Materiales de siembra ────────────────────────────────────────────────────
app.get('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).orderBy('nombre').get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener materiales.' });
  }
});

app.post('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    const { nombre, rangoPesos, variedad } = req.body;
    if (!nombre) return res.status(400).json({ message: 'El nombre es obligatorio.' });
    const ref = await db.collection('materiales_siembra').add({
      nombre, rangoPesos: rangoPesos || '', variedad: variedad || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear material.' });
  }
});

app.put('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    const { nombre, rangoPesos, variedad } = req.body;
    await db.collection('materiales_siembra').doc(req.params.id).update({ nombre, rangoPesos, variedad });
    res.status(200).json({ message: 'Material actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar material.' });
  }
});

app.delete('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    await db.collection('materiales_siembra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Material eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar material.' });
  }
});

// ── Escanear formulario de siembra con IA ────────────────────────────────────
app.post('/api/siembras/escanear', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ message: 'Se requiere imageBase64 y mediaType.' });
    }

    const [lotesSnap, matsSnap] = await Promise.all([
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).get(),
    ]);

    const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombreLote }));
    const materiales = matsSnap.docs.map(d => ({
      id: d.id,
      nombre: d.data().nombre,
      rangoPesos: d.data().rangoPesos || '',
      variedad: d.data().variedad || '',
    }));

    if (!anthropicClient) {
      anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });
    }

    const lotesTexto = lotes.length
      ? lotes.map(l => `- ID: "${l.id}" | Nombre: "${l.nombre}"`).join('\n')
      : '(sin lotes registrados)';
    const matsTexto = materiales.length
      ? materiales.map(m => `- ID: "${m.id}" | Nombre: "${m.nombre}" | RangoPesos: "${m.rangoPesos}" | Variedad: "${m.variedad}"`).join('\n')
      : '(sin materiales registrados)';

    const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de siembra de piña.

Lotes registrados en el sistema:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Extrae cada fila de siembra del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "loteId": "ID del lote si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "loteNombre": "nombre del lote tal como aparece en el formulario",
    "bloque": "identificador del bloque (letra, número o combinación), o cadena vacía si no aparece",
    "plantas": 15000,
    "densidad": 65000,
    "materialId": "ID del material si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "materialNombre": "nombre del material tal como aparece en el formulario, o cadena vacía",
    "rangoPesos": "rango de pesos si aparece en el formulario, o cadena vacía",
    "variedad": "variedad si aparece en el formulario, o cadena vacía"
  }
]

Reglas:
1. Si el nombre del lote coincide (o es muy similar) con uno del catálogo, usa su ID; si no hay coincidencia, deja loteId como null.
2. Si el nombre del material coincide con uno del catálogo, usa su ID; si no, deja materialId como null.
3. Si no aparece densidad en el formulario, usa 65000 como valor por defecto.
4. plantas y densidad deben ser números enteros, no cadenas.
5. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let filas;
    try {
      filas = JSON.parse(jsonText);
    } catch {
      console.error('Claude devolvió texto no parseable:', rawText);
      return res.status(422).json({ message: 'La IA no pudo interpretar el formulario. Intenta con una imagen más clara.', raw: rawText });
    }

    res.json({ filas, lotes, materiales });
  } catch (error) {
    console.error('Error en escanear siembra:', error);
    res.status(500).json({ message: 'Error al procesar la imagen con IA.' });
  }
});

// ── Registros de siembra ─────────────────────────────────────────────────────
app.get('/api/siembras', authenticate, async (req, res) => {
  try {
    const { loteId, desde, hasta } = req.query;
    let query = db.collection('siembras').where('fincaId', '==', req.fincaId);
    if (loteId) query = query.where('loteId', '==', loteId);
    if (desde)  query = query.where('fecha', '>=', Timestamp.fromDate(new Date(desde)));
    if (hasta)  query = query.where('fecha', '<=', Timestamp.fromDate(new Date(hasta)));
    const snap = await query.orderBy('fecha', 'desc').limit(300).get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener siembras.' });
  }
});

app.post('/api/siembras', authenticate, async (req, res) => {
  try {
    const { loteId, loteNombre, bloque, plantas, densidad, materialId, materialNombre, rangoPesos, variedad, cerrado, fecha, responsableId, responsableNombre } = req.body;
    if (!loteId || !fecha) return res.status(400).json({ message: 'Lote y fecha son obligatorios.' });

    const plantas_ = parseInt(plantas) || 0;
    const densidad_ = parseFloat(densidad) || 0;
    const areaCalculada = densidad_ > 0 ? parseFloat((plantas_ / densidad_).toFixed(4)) : 0;

    const ref = await db.collection('siembras').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      bloque: bloque || '',
      plantas: plantas_, densidad: densidad_,
      areaCalculada,
      materialId: materialId || '',
      materialNombre: materialNombre || '',
      rangoPesos: rangoPesos || '',
      variedad: variedad || '',
      cerrado: cerrado === true || cerrado === 'true',
      fecha: Timestamp.fromDate(new Date(fecha)),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, areaCalculada });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar siembra.' });
  }
});

app.put('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.fecha) updates.fecha = Timestamp.fromDate(new Date(updates.fecha));
    if (updates.plantas !== undefined || updates.densidad !== undefined) {
      const doc = await db.collection('siembras').doc(req.params.id).get();
      const current = doc.data();
      const plantas_ = parseInt(updates.plantas ?? current.plantas) || 0;
      const densidad_ = parseFloat(updates.densidad ?? current.densidad) || 0;
      updates.areaCalculada = densidad_ > 0 ? parseFloat((plantas_ / densidad_).toFixed(4)) : 0;
    }
    await db.collection('siembras').doc(req.params.id).update(updates);
    res.status(200).json({ message: 'Siembra actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar siembra.' });
  }
});

app.delete('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    await db.collection('siembras').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar siembra.' });
  }
});

// --- API ENDPOINTS: PROVEEDORES ---
app.get('/api/proveedores', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('proveedores')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc')
      .get();
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener proveedores.' });
  }
});

app.post('/api/proveedores', authenticate, async (req, res) => {
  try {
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ message: 'El nombre del proveedor es obligatorio.' });
    }
    const doc = await db.collection('proveedores').add({
      nombre: nombre.trim(),
      ruc: ruc?.trim() || '',
      telefono: telefono?.trim() || '',
      email: email?.trim() || '',
      direccion: direccion?.trim() || '',
      tipoPago: tipoPago || 'contado',
      diasCredito: tipoPago === 'credito' ? (parseInt(diasCredito) || 30) : null,
      notas: notas?.trim() || '',
      fincaId: req.fincaId,
      creadoEn: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear proveedor.' });
  }
});

app.put('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ message: 'El nombre del proveedor es obligatorio.' });
    }
    await db.collection('proveedores').doc(req.params.id).update({
      nombre: nombre.trim(),
      ruc: ruc?.trim() || '',
      telefono: telefono?.trim() || '',
      email: email?.trim() || '',
      direccion: direccion?.trim() || '',
      tipoPago: tipoPago || 'contado',
      diasCredito: tipoPago === 'credito' ? (parseInt(diasCredito) || 30) : null,
      notas: notas?.trim() || '',
    });
    res.json({ message: 'Proveedor actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar proveedor.' });
  }
});

app.delete('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    await db.collection('proveedores').doc(req.params.id).delete();
    res.json({ message: 'Proveedor eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar proveedor.' });
  }
});

// --- API ENDPOINTS: MAQUINARIA ---
app.get('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('maquinaria')
      .where('fincaId', '==', req.fincaId)
      .orderBy('descripcion', 'asc')
      .get();
    res.json(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener maquinaria.' });
  }
});

app.post('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const { idMaquina, codigo, descripcion, tipo, ubicacion, observacion, capacidad } = req.body;
    if (!descripcion || !descripcion.trim()) {
      return res.status(400).json({ message: 'La descripción es obligatoria.' });
    }
    const data = {
      idMaquina: idMaquina?.trim() || '',
      codigo: codigo?.trim() || '',
      descripcion: descripcion.trim(),
      tipo: tipo?.trim() || '',
      ubicacion: ubicacion?.trim() || '',
      observacion: observacion?.trim() || '',
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    if (capacidad !== undefined && capacidad !== '') data.capacidad = Number(capacidad);
    const doc = await db.collection('maquinaria').add(data);
    res.status(201).json({ id: doc.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear maquinaria.' });
  }
});

app.put('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    const { idMaquina, codigo, descripcion, tipo, ubicacion, observacion, capacidad } = req.body;
    if (!descripcion || !descripcion.trim()) {
      return res.status(400).json({ message: 'La descripción es obligatoria.' });
    }
    const data = {
      idMaquina: idMaquina?.trim() || '',
      codigo: codigo?.trim() || '',
      descripcion: descripcion.trim(),
      tipo: tipo?.trim() || '',
      ubicacion: ubicacion?.trim() || '',
      observacion: observacion?.trim() || '',
      capacidad: (capacidad !== undefined && capacidad !== '') ? Number(capacidad) : null,
    };
    await db.collection('maquinaria').doc(req.params.id).update(data);
    res.json({ message: 'Actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar maquinaria.' });
  }
});

app.delete('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    await db.collection('maquinaria').doc(req.params.id).delete();
    res.json({ message: 'Eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar maquinaria.' });
  }
});

// ── Aurora AI Chat ────────────────────────────────────────────────────────────

// Tool: escanea imagen de siembra y extrae filas estructuradas
async function chatToolEscanarSiembra(imageBase64, mediaType, fincaId) {
  const [lotesSnap, matsSnap] = await Promise.all([
    db.collection('lotes').where('fincaId', '==', fincaId).get(),
    db.collection('materiales_siembra').where('fincaId', '==', fincaId).get(),
  ]);
  const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombreLote }));
  const materiales = matsSnap.docs.map(d => ({
    id: d.id,
    nombre: d.data().nombre,
    rangoPesos: d.data().rangoPesos || '',
    variedad: d.data().variedad || '',
  }));

  const lotesTexto = lotes.length
    ? lotes.map(l => `- ID: "${l.id}" | Nombre: "${l.nombre}"`).join('\n')
    : '(sin lotes registrados)';
  const matsTexto = materiales.length
    ? materiales.map(m => `- ID: "${m.id}" | Nombre: "${m.nombre}" | RangoPesos: "${m.rangoPesos}" | Variedad: "${m.variedad}"`).join('\n')
    : '(sin materiales registrados)';

  const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de siembra de piña.

Lotes registrados en el sistema:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Extrae cada fila de siembra del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "loteId": "ID del lote si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "loteNombre": "nombre del lote tal como aparece en el formulario",
    "bloque": "identificador del bloque (letra, número o combinación), o cadena vacía si no aparece",
    "plantas": 15000,
    "densidad": 65000,
    "materialId": "ID del material si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "materialNombre": "nombre del material tal como aparece en el formulario, o cadena vacía",
    "rangoPesos": "rango de pesos si aparece en el formulario, o cadena vacía",
    "variedad": "variedad si aparece en el formulario, o cadena vacía"
  }
]

Reglas:
1. Si el nombre del lote coincide (o es muy similar) con uno del catálogo, usa su ID; si no hay coincidencia, deja loteId como null.
2. Si el nombre del material coincide con uno del catálogo, usa su ID; si no, deja materialId como null.
3. Si no aparece densidad en el formulario, usa 65000 como valor por defecto.
4. plantas y densidad deben ser números enteros, no cadenas.
5. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const rawText = response.content[0].text.trim();
  const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const filas = JSON.parse(jsonText);
  return { filas, lotes, materiales };
}

// Tool: registra filas de siembra en Firestore
async function chatToolRegistrarSiembras({ filas, fecha }, responsableId, responsableNombre, fincaId) {
  const today = new Date().toISOString().slice(0, 10);
  const fechaFinal = fecha || today;
  const results = [];
  const omitidas = [];

  for (const fila of filas) {
    if (!fila.loteId || !fila.plantas || !fila.densidad) {
      omitidas.push(fila.loteNombre || '(sin lote)');
      continue;
    }
    const plantas_ = parseInt(fila.plantas) || 0;
    const densidad_ = parseFloat(fila.densidad) || 0;
    const areaCalculada = densidad_ > 0 ? parseFloat((plantas_ / densidad_).toFixed(4)) : 0;

    const ref = await db.collection('siembras').add({
      fincaId,
      loteId: fila.loteId,
      loteNombre: fila.loteNombre || '',
      bloque: fila.bloque || '',
      plantas: plantas_,
      densidad: densidad_,
      areaCalculada,
      materialId: fila.materialId || '',
      materialNombre: fila.materialNombre || '',
      rangoPesos: fila.rangoPesos || '',
      variedad: fila.variedad || '',
      cerrado: false,
      fecha: Timestamp.fromDate(new Date(fechaFinal)),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      createdAt: Timestamp.now(),
    });
    results.push({ id: ref.id, loteNombre: fila.loteNombre, bloque: fila.bloque, plantas: plantas_, areaCalculada });
  }

  return { registrados: results.length, detalles: results, omitidas };
}

// Tool: consulta genérica de Firestore para reportes y análisis
async function chatToolConsultarDatos({ coleccion, filtros = [], ordenarPor, limite = 20, campos }, fincaId) {
  const coleccionesPermitidas = ['lotes', 'siembras', 'scheduled_tasks', 'productos', 'users', 'materiales_siembra', 'packages'];
  if (!coleccionesPermitidas.includes(coleccion)) {
    return { error: `Colección no permitida. Usa una de: ${coleccionesPermitidas.join(', ')}` };
  }

  let query = db.collection(coleccion).where('fincaId', '==', fincaId);

  for (const f of filtros) {
    query = query.where(f.campo, f.operador, f.valor);
  }

  if (ordenarPor) {
    query = query.orderBy(ordenarPor.campo, ordenarPor.direccion || 'asc');
  }

  const limiteSeguro = Math.min(parseInt(limite) || 20, 200);
  query = query.limit(limiteSeguro);

  const snap = await query.get();

  let docs = snap.docs.map(d => {
    const data = d.data();
    const doc = { id: d.id };
    for (const [k, v] of Object.entries(data)) {
      if (k === 'fincaId') continue;
      if (v && typeof v.toDate === 'function') {
        doc[k] = v.toDate().toISOString().slice(0, 10);
      } else {
        doc[k] = v;
      }
    }
    return doc;
  });

  if (campos && campos.length > 0) {
    docs = docs.map(d => {
      const projected = { id: d.id };
      for (const campo of campos) {
        if (d[campo] !== undefined) projected[campo] = d[campo];
      }
      return projected;
    });
  }

  return { coleccion, total: docs.length, datos: docs };
}

// Tool: crea un nuevo lote con sus tareas programadas
async function chatToolCrearLote({ codigoLote, nombreLote, fechaCreacion, paqueteId, hectareas }, fincaId) {
  const loteData = {
    codigoLote,
    ...(nombreLote ? { nombreLote } : {}),
    fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
    hectareas: parseFloat(hectareas) || 0,
    fincaId,
  };
  if (paqueteId) loteData.paqueteId = paqueteId;

  const loteRef = await db.collection('lotes').add(loteData);

  if (!paqueteId) {
    return { id: loteRef.id, codigoLote, mensaje: `Lote ${codigoLote} creado sin paquete técnico.` };
  }

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
    tasksBatch.set(reminderTaskRef, { type: 'REMINDER_3_DAY', executeAt: Timestamp.fromDate(reminderDate), loteId: loteRef.id, activity, status: 'pending', fincaId });

    const dueTaskRef = db.collection('scheduled_tasks').doc();
    const dueTaskData = { type: 'REMINDER_DUE_DAY', executeAt: Timestamp.fromDate(activityDate), loteId: loteRef.id, activity, status: 'pending', fincaId };
    tasksBatch.set(dueTaskRef, dueTaskData);

    if (activityDay >= 0 && activityDay <= 3) {
      tasksForImmediateNotification.push({ ref: dueTaskRef, data: dueTaskData });
    }
  }

  await tasksBatch.commit();

  const loteNombreDisplay = nombreLote || codigoLote;
  for (const taskToNotify of tasksForImmediateNotification) {
    await sendNotificationWithLink(taskToNotify.ref, taskToNotify.data, loteNombreDisplay);
  }

  return {
    id: loteRef.id,
    codigoLote,
    tareasCreadas: paqueteData.activities.length * 2,
    mensaje: `Lote ${codigoLote} creado con ${paqueteData.activities.length} actividades programadas.`,
  };
}

// Tool: consulta registros de siembra existentes
async function chatToolConsultarSiembras({ loteId, limite = 10 }, fincaId) {
  let query = db.collection('siembras')
    .where('fincaId', '==', fincaId)
    .orderBy('fecha', 'desc')
    .limit(Math.min(limite, 50));
  if (loteId) query = query.where('loteId', '==', loteId);
  const snap = await query.get();
  const siembras = snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    fecha: d.data().fecha?.toDate().toISOString().slice(0, 10),
    createdAt: undefined,
  }));
  return { siembras, total: siembras.length };
}

app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const { message, imageBase64, mediaType, userId, userName } = req.body;

    if (!anthropicClient) {
      anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });
    }

    // Cargar catálogos para que Claude pueda resolver nombres a IDs
    const [lotesSnap, matsSnap, paquetesSnap] = await Promise.all([
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).get(),
      db.collection('packages').where('fincaId', '==', req.fincaId).get(),
    ]);
    const catalogoLotes = lotesSnap.docs.map(d => ({
      id: d.id,
      codigoLote: d.data().codigoLote || '',
      nombreLote: d.data().nombreLote || '',
    }));
    const catalogoMateriales = matsSnap.docs.map(d => ({
      id: d.id,
      nombre: d.data().nombre,
      rangoPesos: d.data().rangoPesos || '',
      variedad: d.data().variedad || '',
    }));

    const lotesTexto = catalogoLotes.length
      ? catalogoLotes.map(l => {
          const parts = [`  - ID interno: "${l.id}"`];
          if (l.codigoLote) parts.push(`Código: "${l.codigoLote}"`);
          if (l.nombreLote) parts.push(`Nombre: "${l.nombreLote}"`);
          return parts.join(' | ');
        }).join('\n')
      : '  (sin lotes registrados)';
    const matsTexto = catalogoMateriales.length
      ? catalogoMateriales.map(m => `  - ID: "${m.id}" | Nombre: "${m.nombre}"${m.variedad ? ` | Variedad: "${m.variedad}"` : ''}${m.rangoPesos ? ` | Pesos: "${m.rangoPesos}"` : ''}`).join('\n')
      : '  (sin materiales registrados)';

    const catalogoPaquetes = paquetesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombrePaquete, tipo: d.data().tipoCosecha || '', etapa: d.data().etapaCultivo || '' }));
    const paquetesTexto = catalogoPaquetes.length
      ? catalogoPaquetes.map(p => `  - ID: "${p.id}" | Nombre: "${p.nombre}"${p.tipo ? ` | Tipo: "${p.tipo}"` : ''}${p.etapa ? ` | Etapa: "${p.etapa}"` : ''}`).join('\n')
      : '  (sin paquetes registrados)';

    const today = new Date().toISOString().slice(0, 10);

    const systemPrompt = `Eres Aurora, el asistente inteligente de la plataforma agrícola Aurora para Finca Aurora.
Ayudas a los trabajadores a registrar siembras y consultar datos agrícolas.
Hoy es ${today}. El usuario es ${userName || 'un trabajador de la finca'}.

## Catálogo actual del sistema

Lotes registrados:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Paquetes de tareas disponibles:
${paquetesTexto}

## Instrucciones

Cuando el usuario pida registrar una siembra por texto (ej: "registra 4345 plantas de Corona Mediana al bloque 4 del lote L2610"):
1. Busca el lote en el catálogo usando coincidencia aproximada. El usuario puede referirse a un lote de cualquiera de estas formas:
   - Por su Código estructurado (ej: "L2610", "lote L2610")
   - Por su Nombre amigable (ej: "4", "lote 4", "el cuatro", "Lote de Rojas")
   - Por cualquier combinación o abreviación de los anteriores
   Siempre resuelve la referencia al "ID interno" correcto antes de registrar.
2. Busca el material usando coincidencia aproximada (ignora mayúsculas, abreviaciones como "CM" = "Corona Mediana").
3. Si encuentras coincidencias claras, llama directamente a "registrar_siembras" con los IDs correctos.
4. Si un lote o material no existe en el catálogo, indícalo al usuario antes de registrar.
5. Usa densidad 65000 por defecto si el usuario no especifica.

Cuando el usuario pida crear un lote (ej: "crea el lote 6", "registra el lote Norte", "nuevo lote 12"):
1. Genera automáticamente el codigoLote: "L" + últimos 2 dígitos del año actual + número del lote en 2 dígitos con cero a la izquierda (ej: lote 6 en 2026 → "L2606", lote 12 → "L2612"). Si el lote tiene nombre sin número (ej: "Lote Norte"), el código no lleva número de lote — usa el próximo número libre o pregunta.
2. El nombreLote es el número o nombre amigable que el usuario mencionó (ej: "6", "Norte").
3. Si el usuario no proporcionó la fecha de inicio del lote, pregúntala antes de llamar a "crear_lote".
4. Pregunta también si desea asignar un paquete técnico (muestra los disponibles) y las hectáreas. Si el usuario dice que no o no responde, crea sin ellos.
5. Llama a "crear_lote" con todos los datos confirmados.

Cuando el usuario pida registrar una siembra con imagen adjunta:
1. Llama a "escanear_formulario_siembra" para extraer los datos de la imagen.
2. Muestra un resumen de lo encontrado y llama a "registrar_siembras".

Cuando el usuario pida un reporte, análisis, proyección o cualquier consulta de datos (ej: "¿cuántas plantas se sembraron este mes?", "¿qué tareas están pendientes?", "¿qué productos están bajo stock?"):
1. Usa "consultar_datos" con los filtros apropiados para obtener los datos relevantes.
2. Puedes hacer múltiples llamadas encadenadas para cruzar información entre colecciones (ej: primero lotes, luego siembras de esos lotes).
3. Analiza los resultados y presenta un resumen claro: totales, promedios, comparaciones o lo que sea útil.
4. No pidas confirmación para consultas — simplemente ejecuta y responde.

## Esquema de colecciones

- **lotes**: codigoLote, nombreLote, fechaCreacion, paqueteId, hectareas
- **siembras**: loteId, loteNombre, bloque, plantas, densidad, areaCalculada, materialId, materialNombre, variedad, rangoPesos, fecha, responsableNombre, cerrado
- **scheduled_tasks**: type (REMINDER_3_DAY|REMINDER_DUE_DAY), status (pending|completed_by_user|skipped|notified), executeAt, loteId, activity{name,day,type,responsableId,productos[]}
- **productos**: idProducto, nombreComercial, ingredienteActivo, tipo, stockActual, stockMinimo, cantidadPorHa, unidad
- **users**: nombre, email, telefono, rol (trabajador|encargado|supervisor|administrador)
- **materiales_siembra**: nombre, variedad, rangoPesos
- **packages**: nombrePaquete, tipoCosecha, etapaCultivo, activities[]

Responde siempre en español, de forma concisa y amigable. Usa formato de lista o tabla cuando sea útil.`;

    const tools = [
      {
        name: 'consultar_datos',
        description: 'Consulta cualquier colección de Firestore de la finca para reportes, análisis y búsquedas. El filtro de fincaId se aplica automáticamente. Puedes hacer múltiples llamadas encadenadas para cruzar información entre colecciones.',
        input_schema: {
          type: 'object',
          properties: {
            coleccion: {
              type: 'string',
              enum: ['lotes', 'siembras', 'scheduled_tasks', 'productos', 'users', 'materiales_siembra', 'packages'],
              description: 'Colección a consultar',
            },
            filtros: {
              type: 'array',
              description: 'Filtros WHERE a aplicar (opcional)',
              items: {
                type: 'object',
                properties: {
                  campo:    { type: 'string' },
                  operador: { type: 'string', enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains'] },
                  valor:    { description: 'Valor del filtro (string, number, boolean, o array para "in")' },
                },
                required: ['campo', 'operador', 'valor'],
              },
            },
            ordenarPor: {
              type: 'object',
              description: 'Ordenamiento opcional',
              properties: {
                campo:     { type: 'string' },
                direccion: { type: 'string', enum: ['asc', 'desc'] },
              },
              required: ['campo'],
            },
            limite: { type: 'number', description: 'Máximo de documentos a devolver (default 20, máximo 200)' },
            campos: {
              type: 'array',
              items: { type: 'string' },
              description: 'Campos a incluir en el resultado (opcional, por defecto todos)',
            },
          },
          required: ['coleccion'],
        },
      },
      {
        name: 'crear_lote',
        description: 'Crea un nuevo lote en el sistema, con sus tareas programadas si se asigna un paquete. Úsala cuando el usuario pida crear o registrar un nuevo lote.',
        input_schema: {
          type: 'object',
          properties: {
            codigoLote:    { type: 'string', description: 'Código estructurado del lote, ej: L2606. Generado automáticamente: "L" + año (2 dígitos) + número de lote (2 dígitos).' },
            nombreLote:    { type: 'string', description: 'Nombre amigable del lote, opcional. Ej: "6", "Norte", "Lote de Rojas".' },
            fechaCreacion: { type: 'string', description: 'Fecha de inicio del lote en formato YYYY-MM-DD.' },
            paqueteId:     { type: 'string', description: 'ID del paquete técnico a asignar (opcional).' },
            hectareas:     { type: 'number', description: 'Superficie del lote en hectáreas (opcional).' },
          },
          required: ['codigoLote', 'fechaCreacion'],
        },
      },
      {
        name: 'escanear_formulario_siembra',
        description: 'Escanea la imagen de formulario de siembra adjunta por el usuario y extrae los datos estructurados. Úsala cuando el usuario comparte una foto de un formulario físico de siembra.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'registrar_siembras',
        description: 'Registra filas de siembra en la base de datos. Úsala después de escanear el formulario o cuando el usuario proporcione los datos directamente.',
        input_schema: {
          type: 'object',
          properties: {
            filas: {
              type: 'array',
              description: 'Arreglo de filas de siembra a registrar',
              items: {
                type: 'object',
                properties: {
                  loteId:        { type: 'string',  description: 'ID del lote en el sistema' },
                  loteNombre:    { type: 'string',  description: 'Nombre del lote' },
                  bloque:        { type: 'string',  description: 'Identificador del bloque' },
                  plantas:       { type: 'number',  description: 'Cantidad de plantas' },
                  densidad:      { type: 'number',  description: 'Densidad de siembra (pl/ha), default 65000' },
                  materialId:    { type: 'string',  description: 'ID del material de siembra' },
                  materialNombre:{ type: 'string',  description: 'Nombre del material' },
                  rangoPesos:    { type: 'string',  description: 'Rango de pesos del material' },
                  variedad:      { type: 'string',  description: 'Variedad del material' },
                },
                required: ['loteId', 'plantas', 'densidad'],
              },
            },
            fecha: { type: 'string', description: 'Fecha de siembra en formato YYYY-MM-DD. Si no se especifica, usa la fecha de hoy.' },
          },
          required: ['filas'],
        },
      },
      {
        name: 'consultar_siembras',
        description: 'Consulta los registros de siembra existentes en el sistema.',
        input_schema: {
          type: 'object',
          properties: {
            loteId: { type: 'string', description: 'Filtrar por ID de lote (opcional)' },
            limite: { type: 'number', description: 'Máximo de registros a devolver (default 10, máximo 50)' },
          },
        },
      },
    ];

    // Construir mensaje inicial del usuario
    const userContent = [];
    if (imageBase64 && mediaType) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
    }
    userContent.push({ type: 'text', text: message || 'Ayúdame con esta información.' });

    const messages = [{ role: 'user', content: userContent }];

    // Loop agéntico: máximo 6 iteraciones para evitar loops infinitos
    let iterations = 0;
    while (iterations < 6) {
      iterations++;

      const response = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });

      // Si Claude terminó, devolver respuesta
      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
        return res.json({ reply: text });
      }

      // Si no hay tool_use, salir
      if (response.stop_reason !== 'tool_use') {
        const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        return res.json({ reply: text || 'No pude procesar la solicitud.' });
      }

      // Ejecutar herramientas
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result;
        try {
          if (block.name === 'consultar_datos') {
            result = await chatToolConsultarDatos(block.input, req.fincaId);
          } else if (block.name === 'crear_lote') {
            result = await chatToolCrearLote(block.input, req.fincaId);
            } else if (block.name === 'escanear_formulario_siembra') {
            if (!imageBase64 || !mediaType) {
              result = { error: 'No se adjuntó ninguna imagen. Por favor adjunta una foto del formulario.' };
            } else {
              result = await chatToolEscanarSiembra(imageBase64, mediaType, req.fincaId);
            }
          } else if (block.name === 'registrar_siembras') {
            result = await chatToolRegistrarSiembras(block.input, userId, userName, req.fincaId);
          } else if (block.name === 'consultar_siembras') {
            result = await chatToolConsultarSiembras(block.input, req.fincaId);
          } else {
            result = { error: `Herramienta desconocida: ${block.name}` };
          }
        } catch (err) {
          console.error(`Error ejecutando herramienta ${block.name}:`, err);
          result = { error: err.message };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    res.json({ reply: 'Lo siento, no pude completar la tarea. Por favor intenta de nuevo.' });
  } catch (error) {
    console.error('Error en /api/chat:', error);
    res.status(500).json({ reply: 'Error interno del servidor.' });
  }
});

// Se exporta la app de Express, inyectando los secretos necesarios.
exports.api = functions.runWith({
  secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, anthropicApiKey]
}).https.onRequest(app);
