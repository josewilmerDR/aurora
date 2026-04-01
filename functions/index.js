
const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const { getFirestore, Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');
const webpush = require('web-push');

// --- DEFINICIÓN DE SECRETOS CON EL NUEVO SISTEMA "PARAMS" ---
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const vapidPublicKey = defineSecret("VAPID_PUBLIC_KEY");
const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");

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
    req.userEmail = decoded.email || '';
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

  // Para lotes: usar source.hectareas.
  // Para grupos: sumar areaCalculada de las siembras vinculadas.
  let loteHectareas = parseFloat(source?.hectareas) || 1;
  if (task.grupoId && source) {
    const bloqueIds = (Array.isArray(task.bloques) && task.bloques.length > 0)
      ? task.bloques.slice(0, 10)
      : (Array.isArray(source.bloques) ? source.bloques.slice(0, 10) : []);
    if (bloqueIds.length > 0) {
      const siembrasSnap = await db.collection('siembras')
        .where(FieldPath.documentId(), 'in', bloqueIds)
        .get();
      const totalArea = siembrasSnap.docs.reduce(
        (s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0
      );
      if (totalArea > 0) loteHectareas = totalArea;
    }
  }

  return {
    id: taskDoc.id,
    activityName: task.activity?.name,
    loteName: source
      ? (source.nombreLote || source.nombreGrupo || '—')
      : (task.snap_grupoNombre || task.snap_loteNombre || ((task.loteId || task.grupoId) ? 'Eliminado' : '—')),
    loteHectareas,
    responsableName: responsable
      ? responsable.nombre
      : (task.activity?.responsableNombre || 'Proveeduría'),
    responsableTel: responsable ? responsable.telefono : '—',
    dueDate: task.executeAt?.toDate?.()?.toISOString() ?? null,
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

    if (memberships.length > 0) {
      const fincaIds = [...new Set(memberships.map(m => m.fincaId))];
      const fincaDocs = await Promise.all(fincaIds.map(id => db.collection('fincas').doc(id).get()));
      const ownerMap = {};
      fincaDocs.forEach(doc => { if (doc.exists) ownerMap[doc.id] = doc.data().adminUid; });
      const enriched = memberships.map(m => ({ ...m, isOwner: ownerMap[m.fincaId] === req.uid }));
      return res.status(200).json({ memberships: enriched });
    }

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

    // Buscar el doc ID del usuario en la colección users (por email)
    let userId = null;
    if (req.userEmail) {
      const userSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', req.userEmail)
        .limit(1)
        .get();
      if (!userSnap.empty) userId = userSnap.docs[0].id;
    }

    res.status(200).json({
      uid: req.uid,
      userId,
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

// POST /api/auth/claim-invitations — vincula al usuario con las fincas donde fue agregado por email
app.post('/api/auth/claim-invitations', authenticateOnly, async (req, res) => {
  try {
    const { uid, userEmail } = req;
    if (!userEmail) return res.status(400).json({ message: 'No se encontró email en el token.' });

    // Buscar registros en 'users' que coincidan con este email
    const usersSnap = await db.collection('users').where('email', '==', userEmail).get();
    if (usersSnap.empty) return res.status(200).json({ memberships: [] });

    const batch = db.batch();
    const newMemberships = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const { fincaId, nombre, rol, telefono } = userData;
      if (!fincaId) continue;

      // Verificar si ya existe una membresía para este uid + finca
      const existingSnap = await db.collection('memberships')
        .where('uid', '==', uid)
        .where('fincaId', '==', fincaId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        newMemberships.push({ id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() });
        continue;
      }

      // Obtener el nombre de la finca
      const fincaDoc = await db.collection('fincas').doc(fincaId).get();
      const fincaNombre = fincaDoc.exists ? fincaDoc.data().nombre : fincaId;

      // Crear la membresía
      const membershipRef = db.collection('memberships').doc();
      const membershipData = {
        uid,
        fincaId,
        fincaNombre,
        email: userEmail,
        nombre: nombre || '',
        telefono: telefono || '',
        rol: rol || 'trabajador',
        creadoEn: Timestamp.now(),
      };
      batch.set(membershipRef, membershipData);

      // Actualizar el doc de usuario con el uid para futuras referencias
      batch.update(userDoc.ref, { uid });

      newMemberships.push({ id: membershipRef.id, ...membershipData });
    }

    if (newMemberships.length > 0) await batch.commit();
    res.status(200).json({ memberships: newMemberships });
  } catch (error) {
    console.error('[AUTH] Error claiming invitations:', error);
    res.status(500).json({ message: 'Error al reclamar invitaciones.' });
  }
});

// --- API ENDPOINTS: TASKS ---
app.get('/api/tasks', authenticate, async (req, res) => {
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

app.post('/api/tasks', authenticate, async (req, res) => {
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

app.get('/api/tasks/overdue-count', authenticate, async (req, res) => {
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

// --- API ENDPOINTS: CÉDULAS DE APLICACIÓN ---

async function nextCedulaConsecutivo(fincaId) {
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  let consecutivo;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { ultimo: next }, { merge: true });
    consecutivo = `#CA-${String(next).padStart(5, '0')}`;
  });
  return consecutivo;
}

// Allocate count consecutive numbers in a single transaction
async function nextCedulasConsecutivos(fincaId, count) {
  if (count <= 1) return [await nextCedulaConsecutivo(fincaId)];
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  const consecutivos = [];
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    tx.set(counterRef, { ultimo: current + count }, { merge: true });
    for (let i = 0; i < count; i++) {
      consecutivos.push(`#CA-${String(current + 1 + i).padStart(5, '0')}`);
    }
  });
  return consecutivos;
}

const serializeCedula = (id, data) => ({
  id,
  ...data,
  generadaAt:    data.generadaAt?.toDate?.()?.toISOString()    || null,
  mezclaListaAt: data.mezclaListaAt?.toDate?.()?.toISOString() || null,
  aplicadaAt:    data.aplicadaAt?.toDate?.()?.toISOString()    || null,
});

app.get('/api/cedulas', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const snap = await db.collection('cedulas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('generadaAt', 'desc')
      .get();
    res.json(snap.docs.map(d => serializeCedula(d.id, d.data())));
  } catch (error) {
    console.error('Error fetching cedulas:', error);
    res.status(500).json({ message: 'Error al obtener cédulas.' });
  }
});

app.get('/api/cedulas/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const data = ownership.doc.data();
    const cedula = serializeCedula(ownership.doc.id, data);

    // Enrich with calibración details for the viewer
    if (data.snap_calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(data.snap_calibracionId).get();
      if (calDoc.exists) {
        cedula.calibracion = { id: calDoc.id, ...calDoc.data() };
        const cal = calDoc.data();
        const maqIds = [cal.aplicadorId, cal.tractorId].filter(Boolean);
        if (maqIds.length > 0) {
          const maqDocs = await Promise.all(maqIds.map(mid => db.collection('maquinaria').doc(mid).get()));
          const maqMap = {};
          maqDocs.forEach(d => { if (d.exists) maqMap[d.id] = d.data(); });
          cedula.calibracionAplicador = cal.aplicadorId ? (maqMap[cal.aplicadorId] || null) : null;
          cedula.calibracionTractor   = cal.tractorId   ? (maqMap[cal.tractorId]   || null) : null;
        }
      }
    }

    res.json(cedula);
  } catch (error) {
    console.error('Error fetching cedula by id:', error);
    res.status(500).json({ message: 'Error al obtener la cédula.' });
  }
});

app.post('/api/cedulas', authenticate, async (req, res) => {
  try {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ message: 'taskId es requerido.' });

    const ownership = await verifyOwnership('scheduled_tasks', taskId, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const existing = await db.collection('cedulas')
      .where('taskId', '==', taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    if (!existing.empty) {
      return res.status(409).json({
        message: 'Esta tarea ya tiene cédulas generadas.',
        cedulas: existing.docs.map(d => serializeCedula(d.id, d.data())),
      });
    }

    // Detect multi-lote grupo: create one cedula per lote
    const taskData = ownership.doc.data();
    if (taskData.grupoId && !taskData.loteId) {
      const grupoDoc = await db.collection('grupos').doc(taskData.grupoId).get();
      const grupoData = grupoDoc.exists ? grupoDoc.data() : {};
      const allBloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
        ? taskData.bloques
        : (Array.isArray(grupoData.bloques) ? grupoData.bloques : []);
      if (allBloqueIds.length > 0) {
        const allBloques = [];
        for (let i = 0; i < allBloqueIds.length; i += 10) {
          const chunk = allBloqueIds.slice(i, i + 10);
          const snap = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
          snap.docs.forEach(d => allBloques.push({ id: d.id, ...d.data() }));
        }
        // Group block IDs by lote name
        const loteMap = {};
        for (const b of allBloques) {
          const key = b.loteNombre || b.loteId || '_sin_lote';
          if (!loteMap[key]) loteMap[key] = [];
          loteMap[key].push(b.id);
        }
        const loteEntries = Object.entries(loteMap);
        if (loteEntries.length > 1) {
          // Multi-lote: one cedula per lote
          const consecutivos = await nextCedulasConsecutivos(req.fincaId, loteEntries.length);
          const batch = db.batch();
          const now = Timestamp.now();
          const cedulasCreated = [];
          loteEntries.forEach(([loteNombre, bloqueIds], i) => {
            const ref = db.collection('cedulas').doc();
            const cedula = {
              consecutivo: consecutivos[i],
              taskId,
              fincaId: req.fincaId,
              status: 'pendiente',
              generadaAt: now,
              generadaPor: req.uid,
              mezclaListaAt: null,
              mezclaListaPor: null,
              aplicadaAt: null,
              aplicadaPor: null,
              splitLoteNombre: loteNombre,
              splitBloqueIds: bloqueIds,
            };
            batch.set(ref, cedula);
            cedulasCreated.push(serializeCedula(ref.id, cedula));
          });
          await batch.commit();
          return res.status(201).json(cedulasCreated);
        }
      }
    }

    // Single cedula (normal path)
    const consecutivo = await nextCedulaConsecutivo(req.fincaId);
    const cedula = {
      consecutivo,
      taskId,
      fincaId: req.fincaId,
      status: 'pendiente',
      generadaAt: Timestamp.now(),
      generadaPor: req.uid,
      mezclaListaAt: null,
      mezclaListaPor: null,
      aplicadaAt: null,
      aplicadaPor: null,
    };
    const docRef = await db.collection('cedulas').add(cedula);
    res.status(201).json(serializeCedula(docRef.id, cedula));
  } catch (error) {
    console.error('Error creating cedula:', error);
    res.status(500).json({ message: 'Error al generar la cédula.' });
  }
});

app.put('/api/cedulas/:id/mezcla-lista', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const cedula = ownership.doc.data();
    if (cedula.status !== 'pendiente') {
      return res.status(409).json({ message: `La cédula no está en estado pendiente (estado actual: ${cedula.status}).` });
    }

    const taskDoc = await db.collection('scheduled_tasks').doc(cedula.taskId).get();
    if (!taskDoc.exists) return res.status(404).json({ message: 'Tarea asociada no encontrada.' });
    const taskData = taskDoc.data();
    const productos = taskData.activity?.productos;

    // Calcular hectáreas según origen (lote o grupo)
    let hectareas = 1;
    let sourceNombre = '';
    if (cedula.splitBloqueIds?.length > 0) {
      // Split cedula: use only this lote's specific blocks
      sourceNombre = cedula.splitLoteNombre || '';
      const splitSnap = await db.collection('siembras')
        .where(FieldPath.documentId(), 'in', cedula.splitBloqueIds.slice(0, 10))
        .get();
      hectareas = splitSnap.docs.reduce((s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0) || 1;
    } else if (taskData.loteId) {
      const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
      hectareas = loteDoc.exists ? (parseFloat(loteDoc.data().hectareas) || 1) : 1;
      sourceNombre = loteDoc.exists ? (loteDoc.data().nombreLote || '') : '';
    } else if (taskData.grupoId) {
      const grupoDoc = await db.collection('grupos').doc(taskData.grupoId).get();
      sourceNombre = grupoDoc.exists ? (grupoDoc.data().nombreGrupo || '') : '';
      const bloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
        ? taskData.bloques.slice(0, 10)
        : (grupoDoc.exists && Array.isArray(grupoDoc.data().bloques) ? grupoDoc.data().bloques.slice(0, 10) : []);
      if (bloqueIds.length > 0) {
        const siembrasSnap = await db.collection('siembras')
          .where(FieldPath.documentId(), 'in', bloqueIds)
          .get();
        hectareas = siembrasSnap.docs.reduce((s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0) || 1;
      }
    }

    const batch = db.batch();
    if (Array.isArray(productos) && productos.length > 0) {
      // Aggregate deductions per unique productoId — Firestore batches
      // reject multiple writes to the same document reference.
      const deduccionPorProducto = {};
      for (const prod of productos) {
        if (!prod.productoId) continue;
        const deduccion = prod.cantidad !== undefined
          ? parseFloat(prod.cantidad)
          : parseFloat(prod.cantidadPorHa || 0) * hectareas;
        if (isNaN(deduccion) || deduccion <= 0) continue;
        deduccionPorProducto[prod.productoId] =
          (deduccionPorProducto[prod.productoId] || 0) + deduccion;
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'egreso',
          productoId: prod.productoId,
          nombreComercial: prod.nombreComercial || '',
          cantidad: deduccion,
          unidad: prod.unidad || '',
          fecha: Timestamp.now(),
          motivo: taskData.activity.name,
          tareaId: cedula.taskId,
          cedulaId: req.params.id,
          cedulaConsecutivo: cedula.consecutivo,
          loteId: taskData.loteId || null,
          grupoId: taskData.grupoId || null,
          loteNombre: taskData.loteId  ? sourceNombre : '',
          grupoNombre: taskData.grupoId ? sourceNombre : '',
          fincaId: req.fincaId,
        });
      }
      // One batch.update per unique producto
      for (const [productoId, totalDeduccion] of Object.entries(deduccionPorProducto)) {
        batch.update(db.collection('productos').doc(productoId), {
          stockActual: FieldValue.increment(-totalDeduccion),
        });
      }
    }

    const mezclaListaNombre = req.body?.nombre || null;

    batch.update(db.collection('cedulas').doc(req.params.id), {
      status: 'en_transito',
      mezclaListaAt: Timestamp.now(),
      mezclaListaPor: req.uid,
      mezclaListaNombre,
    });
    await batch.commit();
    res.json({ id: req.params.id, status: 'en_transito' });
  } catch (error) {
    console.error('Error in mezcla-lista:', error);
    res.status(500).json({ message: 'Error al procesar la mezcla.' });
  }
});

app.put('/api/cedulas/:id/aplicada', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const cedula = ownership.doc.data();
    if (cedula.status !== 'en_transito') {
      return res.status(409).json({ message: `La cédula no está en tránsito (estado actual: ${cedula.status}).` });
    }

    // ── Recopilar datos para snapshot ──────────────────────────────────────
    const taskDoc = await db.collection('scheduled_tasks').doc(cedula.taskId).get();
    const taskData = taskDoc.exists ? taskDoc.data() : {};

    // Fuente: lote o grupo
    let sourceData = null, sourceType = null, sourceId = null;
    if (taskData.loteId) {
      const d = await db.collection('lotes').doc(taskData.loteId).get();
      if (d.exists) { sourceData = d.data(); sourceType = 'lote'; sourceId = taskData.loteId; }
    } else if (taskData.grupoId) {
      const d = await db.collection('grupos').doc(taskData.grupoId).get();
      if (d.exists) { sourceData = d.data(); sourceType = 'grupo'; sourceId = taskData.grupoId; }
    }

    // Paquete técnico
    let pkgData = null;
    if (sourceData?.paqueteId) {
      const d = await db.collection('packages').doc(sourceData.paqueteId).get();
      if (d.exists) pkgData = d.data();
    }

    // Config (parámetros para fecha de cosecha)
    const configDoc = await db.collection('config').doc(req.fincaId).get();
    const configData = configDoc.exists ? configDoc.data() : {};

    // Calibración: desde la actividad de la tarea, con fallback en la actividad actual del paquete
    let calData = null;
    let calibracionId = taskData.activity?.calibracionId || cedula.calibracionId || null;
    if (!calibracionId && pkgData?.activities) {
      const actName = taskData.activity?.name;
      const actDay  = taskData.activity?.day;
      const pkgAct  = pkgData.activities.find(a =>
        (actName && a.name === actName) || (actDay != null && String(a.day) === String(actDay))
      );
      calibracionId = pkgAct?.calibracionId || null;
    }
    if (calibracionId) {
      const d = await db.collection('calibraciones').doc(calibracionId).get();
      if (d.exists) calData = { id: d.id, ...d.data() };
    }

    // Maquinaria del aplicador (capacidad de boon)
    let litrosAplicador = null;
    if (calData?.aplicadorId) {
      const d = await db.collection('maquinaria').doc(calData.aplicadorId).get();
      if (d.exists) litrosAplicador = parseFloat(d.data().capacidad) || null;
    }

    // Bloques / siembras: for split cedulas use only this lote's blocks
    const allBloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
      ? taskData.bloques
      : (Array.isArray(sourceData?.bloques) ? sourceData.bloques : []);
    const bloqueIds = (cedula.splitBloqueIds?.length > 0) ? cedula.splitBloqueIds : allBloqueIds;
    let bloquesList = [];
    if (bloqueIds.length > 0) {
      for (let i = 0; i < bloqueIds.length; i += 10) {
        const chunk = bloqueIds.slice(i, i + 10);
        const snap = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
        snap.docs.forEach(d => bloquesList.push({ id: d.id, ...d.data() }));
      }
    }

    // Catálogo de productos
    const productos = taskData.activity?.productos || [];
    const productoIds = [...new Set(productos.map(p => p.productoId).filter(Boolean))];
    const catMap = {};
    for (let i = 0; i < productoIds.length; i += 10) {
      const chunk = productoIds.slice(i, i + 10);
      const snap = await db.collection('productos').where(FieldPath.documentId(), 'in', chunk).get();
      snap.docs.forEach(d => { catMap[d.id] = d.data(); });
    }

    // ── Cálculos derivados ─────────────────────────────────────────────────
    const areaHa = bloquesList.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0)
                || parseFloat(sourceData?.hectareas || 0) || 0;
    const totalPlantas = bloquesList.reduce((s, b) => s + (Number(b.plantas) || 0), 0);

    const cosecha = sourceData?.cosecha || pkgData?.tipoCosecha || '';
    const etapa   = sourceData?.etapa   || pkgData?.etapaCultivo || '';

    const PARAM_DEFAULTS = { diasSiembraICosecha: 400, diasForzaICosecha: 150, diasChapeaIICosecha: 215, diasForzaIICosecha: 150 };
    const cfg = { ...PARAM_DEFAULTS, ...configData };
    let fechaCosecha = null;
    if (sourceData?.fechaCreacion) {
      let dias = null;
      if      (cosecha === 'I Cosecha'  && etapa === 'Desarrollo')   dias = cfg.diasSiembraICosecha;
      else if (cosecha === 'I Cosecha'  && etapa === 'Postforza')    dias = cfg.diasForzaICosecha;
      else if (cosecha === 'II Cosecha' && etapa === 'Desarrollo')   dias = cfg.diasChapeaIICosecha;
      else if (cosecha === 'II Cosecha' && etapa === 'Postforza')    dias = cfg.diasForzaIICosecha;
      if (dias != null) {
        const base = sourceData.fechaCreacion.toDate ? sourceData.fechaCreacion.toDate() : new Date(sourceData.fechaCreacion);
        const fc = new Date(base);
        fc.setUTCDate(fc.getUTCDate() + Number(dias));
        fechaCosecha = fc.toISOString().split('T')[0];
      }
    }

    const volumenPorHa = calData ? (parseFloat(calData.volumen) || null) : null;
    const totalBoones  = (volumenPorHa && litrosAplicador && areaHa)
      ? (volumenPorHa * areaHa) / litrosAplicador : null;

    // Snapshot de productos (uno por ítem, con datos del catálogo)
    let periodoCarenciaMax = 0, periodoReingresoMax = 0;
    const productosSnap = productos.map(prod => {
      const cat = catMap[prod.productoId] || {};
      const cantPorHa = prod.cantidadPorHa !== undefined
        ? parseFloat(prod.cantidadPorHa)
        : (prod.cantidad !== undefined ? parseFloat(prod.cantidad) : null);
      const total = cantPorHa != null && areaHa ? parseFloat((cantPorHa * areaHa).toFixed(4)) : null;
      const perCarencia  = Number(cat.periodoACosecha)  || 0;
      const perReingreso = Number(cat.periodoReingreso) || 0;
      if (perCarencia  > periodoCarenciaMax)  periodoCarenciaMax  = perCarencia;
      if (perReingreso > periodoReingresoMax) periodoReingresoMax = perReingreso;
      let cantBoom = null, cantFraccion = null;
      if (cantPorHa != null && volumenPorHa && litrosAplicador && totalBoones) {
        cantBoom = parseFloat(((cantPorHa * litrosAplicador) / volumenPorHa).toFixed(4));
        const fracDecimal = totalBoones % 1;
        cantFraccion = fracDecimal > 0 ? parseFloat((cantBoom * fracDecimal).toFixed(4)) : null;
      }
      return {
        productoId: prod.productoId || null,
        idProducto: cat.idProducto || null,
        nombreComercial: cat.nombreComercial || prod.nombreComercial || null,
        ingredienteActivo: cat.ingredienteActivo || null,
        cantidadPorHa: cantPorHa,
        unidad: cat.unidad || prod.unidad || null,
        total,
        periodoCarencia:  perCarencia  || null,
        periodoReingreso: perReingreso || null,
        cantBoom,
        cantFraccion,
      };
    });

    const bloquesSnap = bloquesList.map(b => ({
      id: b.id,
      bloque:        b.bloque        || null,
      loteNombre:    b.loteNombre    || null,
      areaCalculada: parseFloat(b.areaCalculada) || null,
      plantas:       Number(b.plantas) || null,
    }));

    const snapDueDate = taskData.executeAt
      ? (taskData.executeAt.toDate ? taskData.executeAt.toDate().toISOString().split('T')[0] : taskData.executeAt)
      : null;
    const snapFechaCreacionGrupo = sourceData?.fechaCreacion
      ? (sourceData.fechaCreacion.toDate ? sourceData.fechaCreacion.toDate().toISOString().split('T')[0] : sourceData.fechaCreacion)
      : null;

    // ── Construir updateData ───────────────────────────────────────────────
    const { sobrante, sobranteLoteId, sobranteLoteNombre,
            condicionesTiempo, temperatura, humedadRelativa,
            horaInicio, horaFinal, operario,
            metodoAplicacion, encargadoFinca, encargadoBodega, supAplicaciones } = req.body || {};

    const updateData = {
      status: 'aplicada_en_campo',
      aplicadaAt: Timestamp.now(),
      aplicadaPor: req.uid,
      sobrante: sobrante === true,
      // Campos completados por el usuario en el formulario
      metodoAplicacion: metodoAplicacion || calData?.metodo || null,
      encargadoFinca:   encargadoFinca   || null,
      encargadoBodega:  encargadoBodega  || null,
      supAplicaciones:  supAplicaciones  || pkgData?.tecnicoResponsable || null,
      // Snapshot: datos del momento de la aplicación
      snap_activityName:         taskData.activity?.name || null,
      snap_dueDate:              snapDueDate,
      snap_fechaCosecha:         taskData.type === 'MANUAL' ? (cedula.snap_fechaCosecha       || null) : fechaCosecha,
      snap_fechaCreacionGrupo:   taskData.type === 'MANUAL' ? (cedula.snap_fechaCreacionGrupo || null) : snapFechaCreacionGrupo,
      snap_sourceType:           sourceType,
      snap_sourceName:           taskData.type === 'MANUAL'
        ? (cedula.snap_sourceName || null)
        : (sourceData?.nombreGrupo || sourceData?.nombreLote || null),
      snap_cosecha:              taskData.type === 'MANUAL' ? (cedula.snap_cosecha || null) : (cosecha || null),
      snap_etapa:                taskData.type === 'MANUAL' ? (cedula.snap_etapa   || null) : (etapa   || null),
      snap_paqueteTecnico:       pkgData?.nombrePaquete || null,
      snap_areaHa:               areaHa  || null,
      snap_totalPlantas:         totalPlantas || null,
      snap_periodoCarenciaMax:   periodoCarenciaMax  || null,
      snap_periodoReingresoMax:  periodoReingresoMax || null,
      snap_calibracionId:        calibracionId       || null,
      snap_calibracionNombre:    calData?.nombre     || null,
      snap_volumenPorHa:         volumenPorHa,
      snap_litrosAplicador:      litrosAplicador,
      snap_totalBoones:          totalBoones != null ? parseFloat(totalBoones.toFixed(2)) : null,
      snap_productos:            productosSnap,
      snap_bloques:              bloquesSnap,
    };
    if (sobrante) {
      if (sobranteLoteId)     updateData.sobranteLoteId     = sobranteLoteId;
      if (sobranteLoteNombre) updateData.sobranteLoteNombre = sobranteLoteNombre;
    }
    if (condicionesTiempo != null) updateData.condicionesTiempo = condicionesTiempo;
    if (temperatura       != null) updateData.temperatura       = Number(temperatura);
    if (humedadRelativa   != null) updateData.humedadRelativa   = Number(humedadRelativa);
    if (horaInicio        != null) updateData.horaInicio        = horaInicio;
    if (horaFinal         != null) updateData.horaFinal         = horaFinal;
    if (operario          != null) updateData.operario          = operario;

    // For split cedulas: only complete task when ALL sibling cedulas are applied/annulled
    const siblingsSnap = await db.collection('cedulas')
      .where('taskId', '==', cedula.taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    const allSiblingsApplied = siblingsSnap.docs.every(d => {
      if (d.id === req.params.id) return true; // being applied now
      const s = d.data().status;
      return s === 'aplicada_en_campo' || s === 'anulada';
    });

    const batch = db.batch();
    batch.update(db.collection('cedulas').doc(req.params.id), updateData);
    if (allSiblingsApplied) {
      // Marcar tarea como completada — inventario ya fue debitado en mezcla-lista
      batch.update(db.collection('scheduled_tasks').doc(cedula.taskId), {
        status: 'completed_by_user',
        completedAt: Timestamp.now(),
        cedulaId: req.params.id,
      });
    }
    await batch.commit();
    res.json({ id: req.params.id, status: 'aplicada_en_campo' });
  } catch (error) {
    console.error('Error in cedula aplicada:', error);
    res.status(500).json({ message: 'Error al registrar la aplicación.' });
  }
});

app.post('/api/cedulas/manual', authenticate, async (req, res) => {
  try {
    const { fecha, activityName, loteId, grupoId, bloques, productos, calibracionId, tecnicoResponsable } = req.body;

    if (!fecha) return res.status(400).json({ message: 'La fecha es requerida.' });
    if (!activityName?.trim()) return res.status(400).json({ message: 'El nombre de la aplicación es requerido.' });
    if (!loteId && !grupoId) return res.status(400).json({ message: 'Debe indicar un lote o grupo.' });
    if (!Array.isArray(productos) || productos.length === 0) return res.status(400).json({ message: 'Debe agregar al menos un producto.' });

    if (loteId) {
      const o = await verifyOwnership('lotes', loteId, req.fincaId);
      if (!o.ok) return res.status(o.status).json({ message: o.message });
    } else {
      const o = await verifyOwnership('grupos', grupoId, req.fincaId);
      if (!o.ok) return res.status(o.status).json({ message: o.message });
    }

    // Enrich product data from catalog
    const enrichedProductos = await Promise.all(
      productos.map(async (p) => {
        const doc = await db.collection('productos').doc(p.productoId).get();
        const info = doc.exists ? doc.data() : {};
        return {
          productoId: p.productoId,
          nombreComercial: info.nombreComercial || '',
          cantidadPorHa: parseFloat(p.cantidadPorHa) || 0,
          unidad: info.unidad || '',
          periodoReingreso: info.periodoReingreso ?? null,
          periodoACosecha: info.periodoACosecha ?? null,
        };
      })
    );

    const executeAt = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    const taskData = {
      type: 'MANUAL',
      status: 'pending',
      fincaId: req.fincaId,
      ...(loteId ? { loteId } : { grupoId }),
      ...(Array.isArray(bloques) && bloques.length > 0 ? { bloques } : {}),
      activity: { name: activityName.trim(), type: 'aplicacion', productos: enrichedProductos, ...(calibracionId ? { calibracionId } : {}) },
      executeAt,
      createdAt: Timestamp.now(),
    };
    const taskRef = await db.collection('scheduled_tasks').add(taskData);

    // Calibración snap fields
    let calData = null;
    let litrosAplicador = null;
    if (calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(calibracionId).get();
      if (calDoc.exists) {
        calData = { id: calDoc.id, ...calDoc.data() };
        if (calData.aplicadorId) {
          const maqDoc = await db.collection('maquinaria').doc(calData.aplicadorId).get();
          if (maqDoc.exists) litrosAplicador = parseFloat(maqDoc.data().capacidad) || null;
        }
      }
    }

    // Compute snap_sourceName, snap_fechaCosecha and related group fields
    let snapSourceName = 'N/A';
    let snapCosecha = null, snapEtapa = null, snapFechaCosecha = null, snapFechaCreacionGrupo = null;
    if (Array.isArray(bloques) && bloques.length > 0 && loteId) {
      const [siembrasSnap, gruposSnap, configDoc] = await Promise.all([
        db.collection('siembras').where('loteId', '==', loteId).get(),
        db.collection('grupos').where('fincaId', '==', req.fincaId).get(),
        db.collection('config').doc(req.fincaId).get(),
      ]);
      const configData = configDoc.exists ? configDoc.data() : {};
      const PARAM_DEFAULTS = { diasSiembraICosecha: 400, diasForzaICosecha: 150, diasChapeaIICosecha: 215, diasForzaIICosecha: 150 };
      const cfg = { ...PARAM_DEFAULTS, ...configData };

      const loteBloqueIds = new Set(siembrasSnap.docs.map(d => d.id));
      const selectedSet   = new Set(bloques);
      let matchedData = null, matchCount = 0;
      for (const gDoc of gruposSnap.docs) {
        const gData   = gDoc.data();
        const gInLote = (gData.bloques || []).filter(id => loteBloqueIds.has(id));
        if (gInLote.length === 0) continue;
        const gSet = new Set(gInLote);
        if (selectedSet.size === gSet.size && [...selectedSet].every(id => gSet.has(id))) {
          matchCount++;
          matchedData = gData;
        }
      }
      if (matchCount === 1 && matchedData) {
        snapSourceName = matchedData.nombreGrupo || 'N/A';
        snapCosecha    = matchedData.cosecha || null;
        snapEtapa      = matchedData.etapa   || null;
        const fc = matchedData.fechaCreacion;
        snapFechaCreacionGrupo = fc?.toDate ? fc.toDate().toISOString().split('T')[0] : (fc || null);
        if (fc && snapCosecha && snapEtapa) {
          let dias = null;
          if      (snapCosecha === 'I Cosecha'  && snapEtapa === 'Desarrollo')  dias = cfg.diasSiembraICosecha;
          else if (snapCosecha === 'I Cosecha'  && snapEtapa === 'Postforza')   dias = cfg.diasForzaICosecha;
          else if (snapCosecha === 'II Cosecha' && snapEtapa === 'Desarrollo')  dias = cfg.diasChapeaIICosecha;
          else if (snapCosecha === 'II Cosecha' && snapEtapa === 'Postforza')   dias = cfg.diasForzaIICosecha;
          if (dias != null) {
            const base = fc.toDate ? fc.toDate() : new Date(fc);
            const d = new Date(base);
            d.setDate(d.getDate() + dias);
            snapFechaCosecha = d.toISOString().split('T')[0];
          }
        }
      }
    }

    const consecutivo = await nextCedulaConsecutivo(req.fincaId);
    const cedulaData = {
      consecutivo,
      taskId: taskRef.id,
      fincaId: req.fincaId,
      status: 'pendiente',
      generadaAt: Timestamp.now(),
      generadaPor: req.uid,
      mezclaListaAt: null,
      mezclaListaPor: null,
      aplicadaAt: null,
      aplicadaPor: null,
      snap_sourceName:           snapSourceName,
      snap_sourceType:           'lote',
      snap_cosecha:              snapCosecha,
      snap_etapa:                snapEtapa,
      snap_fechaCosecha:         snapFechaCosecha,
      snap_fechaCreacionGrupo:   snapFechaCreacionGrupo,
      snap_calibracionId:     calData?.id           || null,
      snap_calibracionNombre: calData?.nombre        || null,
      snap_volumenPorHa:      calData ? (parseFloat(calData.volumen) || null) : null,
      snap_litrosAplicador:   litrosAplicador,
      ...(tecnicoResponsable?.trim() ? { tecnicoResponsable: tecnicoResponsable.trim() } : {}),
    };
    const cedulaRef = await db.collection('cedulas').add(cedulaData);

    const enrichedTask = await enrichTask(await taskRef.get());
    res.status(201).json({ cedula: serializeCedula(cedulaRef.id, cedulaData), task: enrichedTask });
  } catch (error) {
    console.error('Error creating manual cedula:', error);
    res.status(500).json({ message: 'Error al crear la cédula.' });
  }
});

app.put('/api/cedulas/:id/anular', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const cedula = ownership.doc.data();
    if (cedula.status === 'aplicada_en_campo') {
      return res.status(409).json({ message: 'No se puede anular una cédula ya aplicada en campo.' });
    }
    if (cedula.status === 'anulada') {
      return res.status(409).json({ message: 'La cédula ya está anulada.' });
    }

    const batch = db.batch();

    // If en_transito the stock was already deducted — reverse it via existing movimientos
    if (cedula.status === 'en_transito') {
      const movSnap = await db.collection('movimientos')
        .where('cedulaId', '==', req.params.id)
        .where('fincaId', '==', req.fincaId)
        .get();

      const reversalPorProducto = {};
      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso' && d.productoId) {
          reversalPorProducto[d.productoId] = (reversalPorProducto[d.productoId] || 0) + d.cantidad;
        }
      }
      for (const [productoId, total] of Object.entries(reversalPorProducto)) {
        batch.update(db.collection('productos').doc(productoId), {
          stockActual: FieldValue.increment(total),
        });
      }
      // Compensating ingreso movimientos so the ledger stays coherent
      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso') {
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: d.productoId,
            nombreComercial: d.nombreComercial,
            cantidad: d.cantidad,
            unidad: d.unidad,
            fecha: Timestamp.now(),
            motivo: `Anulación cédula ${cedula.consecutivo}`,
            tareaId: cedula.taskId,
            cedulaId: req.params.id,
            cedulaConsecutivo: cedula.consecutivo,
            loteId: d.loteId || null,
            grupoId: d.grupoId || null,
            loteNombre: d.loteNombre || '',
            fincaId: req.fincaId,
          });
        }
      }
    }

    batch.update(db.collection('cedulas').doc(req.params.id), {
      status: 'anulada',
      anuladaAt: Timestamp.now(),
      anuladaPor: req.uid,
    });
    // Only change task status if all sibling cedulas are now inactive
    const siblingsSnap = await db.collection('cedulas')
      .where('taskId', '==', cedula.taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    const allInactive = siblingsSnap.docs.every(d => {
      if (d.id === req.params.id) return true; // being annulled now
      const s = d.data().status;
      return s === 'anulada' || s === 'aplicada_en_campo';
    });
    if (allInactive) {
      const anyApplied = siblingsSnap.docs.some(d =>
        d.id !== req.params.id && d.data().status === 'aplicada_en_campo'
      );
      batch.update(db.collection('scheduled_tasks').doc(cedula.taskId), {
        status: anyApplied ? 'completed_by_user' : 'skipped',
      });
    }
    await batch.commit();
    res.json({ id: req.params.id, status: 'anulada' });
  } catch (error) {
    console.error('Error anulando cedula:', error);
    res.status(500).json({ message: 'Error al anular la cédula.' });
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

// --- API ENDPOINTS: CEDULA TEMPLATES ---
app.get('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('cedula_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

app.post('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const { nombre, productos } = req.body;
    if (!nombre) return res.status(400).json({ message: 'El nombre es requerido.' });
    const template = {
      nombre,
      productos: productos || [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('cedula_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear plantilla.' });
  }
});

app.delete('/api/cedula-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('cedula_templates').doc(req.params.id).delete();
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

// --- API ENDPOINTS: BODEGAS ---
// Una "bodega" es un almacén tipado. El campo `tipo` determina qué componente
// frontend se renderiza (agroquimicos, combustibles, herramientas, generico…).
// Si la finca no tiene ninguna bodega, se siembra automáticamente la de agroquímicos.
app.get('/api/bodegas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('bodegas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('orden')
      .get();

    if (!snap.empty) {
      return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    // Auto-seed: primera ejecución por finca
    const defaultBodega = {
      nombre: 'Agroquímicos',
      tipo: 'agroquimicos',
      icono: 'FiDroplet',
      orden: 1,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('bodegas').add(defaultBodega);
    return res.json([{ id: docRef.id, ...defaultBodega }]);
  } catch (err) {
    console.error('[bodegas GET]', err);
    return res.status(500).json({ message: 'Error al obtener bodegas.' });
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
  'unidad', 'stockActual', 'stockMinimo', 'moneda', 'tipoCambio', 'precioUnitario',
  'iva', 'proveedor', 'registroFitosanitario', 'observacion', 'activo'];

app.post('/api/productos', authenticate, async (req, res) => {
  try {
    const { fechaIngreso, facturaNumero, registrarIngreso, ordenCompraId, ocPoNumber } = req.body;
    const fechaTs = fechaIngreso
      ? Timestamp.fromDate(new Date(fechaIngreso + 'T12:00:00'))
      : Timestamp.now();
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
        if (registrarIngreso && stockIngresado > 0) {
          const batch = db.batch();
          batch.update(doc.ref, { stockActual: FieldValue.increment(stockIngresado) });
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: doc.id,
            idProducto: producto.idProducto || doc.data().idProducto || '',
            nombreComercial: producto.nombreComercial || doc.data().nombreComercial || '',
            cantidad: stockIngresado,
            unidad: producto.unidad || doc.data().unidad || '',
            precioUnitario: parseFloat(producto.precioUnitario) || 0,
            iva: parseFloat(producto.iva) || 0,
            proveedor: producto.proveedor || '',
            fecha: fechaTs,
            motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Ingreso de inventario',
            ...(facturaNumero  ? { facturaNumero }  : {}),
            ...(ordenCompraId  ? { ordenCompraId }  : {}),
            ...(ocPoNumber     ? { ocPoNumber }     : {}),
            fincaId: req.fincaId,
          });
          await batch.commit();
        } else {
          await doc.ref.update({ stockActual: FieldValue.increment(stockIngresado) });
        }
        const updated = { ...doc.data(), stockActual: (doc.data().stockActual || 0) + stockIngresado };
        return res.status(200).json({ id: doc.id, ...updated, merged: true });
      }
    }

    const stockIngresado = parseFloat(producto.stockActual) || 0;
    if (registrarIngreso && stockIngresado > 0) {
      const newProdRef = db.collection('productos').doc();
      const batch = db.batch();
      batch.set(newProdRef, producto);
      batch.set(db.collection('movimientos').doc(), {
        tipo: 'ingreso',
        productoId: newProdRef.id,
        idProducto: producto.idProducto || '',
        nombreComercial: producto.nombreComercial || '',
        cantidad: stockIngresado,
        unidad: producto.unidad || '',
        precioUnitario: parseFloat(producto.precioUnitario) || 0,
        iva: parseFloat(producto.iva) || 0,
        proveedor: producto.proveedor || '',
        fecha: fechaTs,
        motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Ingreso de inventario',
        ...(facturaNumero  ? { facturaNumero }  : {}),
        ...(ordenCompraId  ? { ordenCompraId }  : {}),
        ...(ocPoNumber     ? { ocPoNumber }     : {}),
        fincaId: req.fincaId,
      });
      await batch.commit();
      res.status(201).json({ id: newProdRef.id, ...producto, merged: false });
    } else {
      const docRef = await db.collection('productos').add(producto);
      res.status(201).json({ id: docRef.id, ...producto, merged: false });
    }
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
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return res.status(409).json({ message: 'Esta acción solo es permitida para productos con existencias nulas.' });
    }
    await db.collection('productos').doc(id).delete();
    res.status(200).json({ message: 'Producto eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar producto.' });
  }
});

app.put('/api/productos/:id/inactivar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return res.status(409).json({ message: 'Esta acción solo es permitida para productos con existencias nulas.' });
    }
    await db.collection('productos').doc(req.params.id).update({ activo: false });
    res.status(200).json({ message: 'Producto inactivado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al inactivar producto.' });
  }
});

app.put('/api/productos/:id/activar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('productos').doc(req.params.id).update({ activo: true });
    res.status(200).json({ message: 'Producto activado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al activar producto.' });
  }
});

// ── Chat IA para editar productos ────────────────────────────────────────────
app.post('/api/productos/ai-editar', authenticate, async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ message: 'Mensaje requerido.' });

    const snap = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });

    const productosTexto = productos.map(p =>
      `ID: ${p.id} | Código: ${p.idProducto || ''} | Nombre: ${p.nombreComercial || ''} | IngredienteActivo: ${p.ingredienteActivo || ''} | Tipo: ${p.tipo || ''} | Plaga: ${p.plagaQueControla || ''} | Dosis/Ha: ${p.cantidadPorHa ?? ''} | Unidad: ${p.unidad || ''} | Reingreso(h): ${p.periodoReingreso ?? ''} | Cosecha(días): ${p.periodoACosecha ?? ''} | Stock: ${p.stockActual ?? 0} | StockMin: ${p.stockMinimo ?? 0} | Precio: ${p.precioUnitario ?? ''} ${p.moneda || ''} | TipoCambio: ${p.tipoCambio ?? ''} | Proveedor: ${p.proveedor || ''}`
    ).join('\n');

    const systemPrompt = `Eres el asistente de inventario Aurora. Interpretas solicitudes en español para modificar productos agroquímicos.

CAMPOS DISPONIBLES (nombre técnico exacto):
- idProducto: Código del producto
- nombreComercial: Nombre comercial
- ingredienteActivo: Ingrediente activo
- tipo: Tipo — solo estos valores: "Herbicida", "Fungicida", "Insecticida", "Fertilizante", "Regulador de crecimiento", "Otro"
- plagaQueControla: Plaga o enfermedad que controla
- cantidadPorHa: Dosis por hectárea (número)
- unidad: Unidad de medida (L, kg, cc, g, mL, etc.)
- periodoReingreso: Período de reingreso en horas (número entero)
- periodoACosecha: Período a cosecha en días (número entero)
- stockMinimo: Stock mínimo (número)
- precioUnitario: Precio unitario (número)
- moneda: Moneda — solo: "USD", "CRC", "EUR"
- tipoCambio: Tipo de cambio (número)
- proveedor: Nombre del proveedor

CAMPO ESPECIAL (ajuste de inventario con nota obligatoria):
- stockActual: Stock actual (número) — devuélvelo en "stockAdjustments", NUNCA en "changes"

REGLAS:
1. Identifica el/los productos por nombre aproximado, código o ingrediente activo.
2. Solo incluye los cambios explícitamente solicitados.
3. Si un producto no se encuentra, explícalo en "error".
4. Si la solicitud es ambigua (varios productos podrían coincidir), pide aclaración en "error".
5. Normaliza el campo "tipo" al valor válido más cercano.

Responde SOLO con JSON válido, sin texto adicional ni bloques de código:
{
  "mensaje": "texto breve describiendo los cambios o el error",
  "changes": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "field": "campoTecnico", "oldValue": "valor_actual", "newValue": "nuevo_valor" }
  ],
  "stockAdjustments": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "stockActual": 0, "newStock": 0 }
  ],
  "error": null
}`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Inventario actual:\n${productosTexto}\n\nSolicitud: ${mensaje}` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Respuesta de IA inválida.');
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('Error en ai-editar productos:', err);
    res.status(500).json({ message: err.message || 'Error al procesar la solicitud.' });
  }
});

// --- API ENDPOINTS: AJUSTE DE INVENTARIO (TOMA FÍSICA) ---
app.post('/api/inventario/ajuste', authenticate, async (req, res) => {
  try {
    const { nota, ajustes } = req.body;
    if (!nota || !nota.trim()) {
      return res.status(400).json({ message: 'La nota explicativa es obligatoria.' });
    }
    if (!Array.isArray(ajustes) || ajustes.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ajuste.' });
    }

    const fincaId = req.fincaId;
    const batch = db.batch();
    const fechaAjuste = new Date();
    const movimientosCreados = [];

    for (const ajuste of ajustes) {
      const { productoId, stockAnterior, stockNuevo } = ajuste;
      if (productoId === undefined || stockNuevo === undefined) continue;
      const stockNuevoNum = parseFloat(stockNuevo);
      const stockAnteriorNum = parseFloat(stockAnterior);
      if (isNaN(stockNuevoNum) || stockNuevoNum < 0) continue;
      if (Math.abs(stockNuevoNum - stockAnteriorNum) < 0.0001) continue; // sin cambio

      const prodRef = db.collection('productos').doc(productoId);
      batch.update(prodRef, { stockActual: stockNuevoNum });

      const diferencia = stockNuevoNum - stockAnteriorNum;
      const movRef = db.collection('movimientos').doc();
      const movData = {
        fincaId,
        productoId,
        tipo: 'ajuste',
        cantidad: diferencia,
        stockAnterior: stockAnteriorNum,
        stockNuevo: stockNuevoNum,
        nota: nota.trim(),
        fecha: fechaAjuste,
      };
      batch.set(movRef, movData);
      movimientosCreados.push({ id: movRef.id, ...movData });
    }

    if (movimientosCreados.length === 0) {
      return res.status(400).json({ message: 'No hay diferencias que ajustar.' });
    }

    await batch.commit();
    res.status(200).json({ ajustados: movimientosCreados.length, movimientos: movimientosCreados });
  } catch (error) {
    console.error('Error en ajuste de inventario:', error);
    res.status(500).json({ message: 'Error al procesar el ajuste de inventario.' });
  }
});

// --- API ENDPOINTS: INGRESO CONFIRMADO (ProductIngreso → recepción atómica) ---
app.post('/api/ingreso/confirmar', authenticate, async (req, res) => {
  try {
    const { items, proveedor, fecha, facturaNumero, ordenCompraId, ocPoNumber, ocEstado, ocUpdatedItems, imageBase64, mediaType } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ítem.' });
    }
    const validos = items.filter(i => (i.idProducto || '').trim() || (i.nombreComercial || '').trim());
    if (validos.length === 0) {
      return res.status(400).json({ message: 'Ningún ítem tiene datos suficientes.' });
    }

    const fechaTs = fecha
      ? Timestamp.fromDate(new Date(fecha + 'T12:00:00'))
      : Timestamp.now();

    // ── Pre-resolver productos (async antes del batch) ───────────────────────
    const resolved = [];
    for (const item of validos) {
      const stockIngresado = parseFloat(item.cantidad) || 0;
      if (stockIngresado <= 0) continue;

      let existingDoc = null;
      if (item.productoId) {
        const snap = await db.collection('productos').doc(item.productoId).get();
        if (snap.exists && snap.data().fincaId === req.fincaId) existingDoc = snap;
      }
      if (!existingDoc && (item.idProducto || '').trim()) {
        const snap = await db.collection('productos')
          .where('fincaId', '==', req.fincaId)
          .where('idProducto', '==', item.idProducto.trim())
          .limit(1).get();
        if (!snap.empty) existingDoc = snap.docs[0];
      }
      resolved.push({ item, stockIngresado, existingDoc });
    }

    if (resolved.length === 0) {
      return res.status(400).json({ message: 'Todos los ítems tienen cantidad cero.' });
    }

    // ── Pre-generar ID de recepción para el nombre del archivo ───────────────
    const recepcionRef = db.collection('recepciones').doc();

    // ── Subir imagen de factura a Firebase Storage (si se proveyó) ───────────
    let facturaImageUrl = null;
    if (imageBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `recepciones/${recepcionRef.id}_factura.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(imageBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        facturaImageUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Storage upload failed (factura ingreso):', storageErr.message);
      }
    }

    // ── Construir batch ──────────────────────────────────────────────────────
    const batch = db.batch();
    const recepcionItems = [];
    let creados = 0, mergeados = 0;

    for (const { item, stockIngresado, existingDoc } of resolved) {
      let productoId;
      if (existingDoc) {
        productoId = existingDoc.id;
        batch.update(existingDoc.ref, { stockActual: FieldValue.increment(stockIngresado) });
        mergeados++;
      } else {
        const newRef = db.collection('productos').doc();
        productoId = newRef.id;
        batch.set(newRef, {
          idProducto: (item.idProducto || '').trim(),
          nombreComercial: item.nombreComercial || '',
          ingredienteActivo: item.ingredienteActivo || '',
          tipo: item.tipo || '',
          unidad: item.unidad || '',
          precioUnitario: parseFloat(item.precioUnitario) || 0,
          iva: parseFloat(item.iva) || 0,
          proveedor: proveedor || '',
          stockActual: stockIngresado,
          stockMinimo: 0,
          cantidadPorHa: 0,
          moneda: 'USD',
          tipoCambio: 1,
          plagaQueControla: '',
          periodoReingreso: 0,
          periodoACosecha: 0,
          activo: true,
          fincaId: req.fincaId,
        });
        creados++;
      }

      batch.set(db.collection('movimientos').doc(), {
        tipo: 'ingreso',
        productoId,
        idProducto: (item.idProducto || '').trim(),
        nombreComercial: item.nombreComercial || '',
        cantidad: stockIngresado,
        unidad: item.unidad || '',
        precioUnitario: parseFloat(item.precioUnitario) || 0,
        iva: parseFloat(item.iva) || 0,
        proveedor: proveedor || '',
        fecha: fechaTs,
        motivo: proveedor ? `Ingreso: ${proveedor}` : 'Ingreso de inventario',
        recepcionId: recepcionRef.id,
        fincaId: req.fincaId,
        ...(facturaNumero    ? { facturaNumero }    : {}),
        ...(ordenCompraId   ? { ordenCompraId }   : {}),
        ...(ocPoNumber      ? { ocPoNumber }      : {}),
        ...(facturaImageUrl ? { facturaImageUrl } : {}),
      });

      recepcionItems.push({
        productoId,
        idProducto: (item.idProducto || '').trim(),
        nombreComercial: item.nombreComercial || '',
        cantidadOC: parseFloat(item.cantidadOC) || stockIngresado,
        cantidadRecibida: stockIngresado,
        unidad: item.unidad || '',
        precioUnitario: parseFloat(item.precioUnitario) || 0,
      });
    }

    batch.set(recepcionRef, {
      fincaId: req.fincaId,
      ordenCompraId: ordenCompraId || null,
      poNumber: ocPoNumber || '',
      proveedor: proveedor || '',
      facturaNumero: facturaNumero || '',
      fechaRecepcion: fechaTs,
      items: recepcionItems,
      imageUrl: facturaImageUrl || null,
      createdAt: Timestamp.now(),
    });

    if (ordenCompraId && ocEstado) {
      const ocUpdate = { estado: ocEstado };
      if (Array.isArray(ocUpdatedItems)) ocUpdate.items = ocUpdatedItems;
      batch.update(db.collection('ordenes_compra').doc(ordenCompraId), ocUpdate);
    }

    await batch.commit();
    res.status(201).json({ recepcionId: recepcionRef.id, creados, mergeados });
  } catch (error) {
    console.error('Error en ingreso/confirmar:', error);
    res.status(500).json({ message: 'Error al registrar el ingreso.' });
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
    const pkg = { ...pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']), fincaId: req.fincaId };
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
    const pkgData = pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']);
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

app.get('/api/grupos/:id/delete-check', authenticate, async (req, res) => {
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

app.delete('/api/grupos/:id', authenticate, async (req, res) => {
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
    "subtotalLinea": 150.00,
    "notas": "conversión realizada u observación, o vacío"
  }
]

Reglas importantes:
1. Convierte automáticamente las unidades al sistema métrico del catálogo (ej: 1 Galón = 3.785 L, 1 Pichinga 5L = 5 L).
2. Si en el catálogo hay un producto con nombre similar, asigna su ID en "productoId".
3. Si no hay coincidencia, usa null en "productoId" y mantén la unidad de la factura.
4. "subtotalLinea" es el importe total de ESA FILA específica (cantidad × precio unitario). Ejemplo: si la fila dice "2 unidades × $75.00 = $150.00", entonces subtotalLinea = 150.00. NO uses el total general de la factura. Si el subtotal de la línea no aparece explícitamente, multiplica cantidad × precio unitario. Si ninguno de los dos está disponible, usa null.
5. Devuelve SOLO el arreglo JSON, sin texto adicional, sin markdown, sin bloques de código.`;

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
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
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
    const { productoId, fechaDesde, fechaHasta } = req.query;
    let query = db.collection('movimientos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .limit(500);
    if (productoId) {
      query = db.collection('movimientos')
        .where('fincaId', '==', req.fincaId)
        .where('productoId', '==', productoId)
        .orderBy('fecha', 'desc')
        .limit(500);
    }
    if (fechaDesde) {
      query = query.where('fecha', '>=', Timestamp.fromDate(new Date(fechaDesde + 'T00:00:00')));
    }
    if (fechaHasta) {
      query = query.where('fecha', '<=', Timestamp.fromDate(new Date(fechaHasta + 'T23:59:59')));
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
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fechaEntrega: fechaEntrega ? Timestamp.fromDate(new Date(fechaEntrega + 'T12:00:00')) : null,
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

app.patch('/api/ordenes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, items } = req.body;
    const valid = ['activa', 'completada', 'cancelada', 'recibida', 'recibida_parcialmente'];
    if (!valid.includes(estado)) return res.status(400).json({ message: 'Estado inválido.' });
    const docRef = db.collection('ordenes_compra').doc(id);
    const doc = await docRef.get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId)
      return res.status(404).json({ message: 'Orden no encontrada.' });
    const updateData = { estado, updatedAt: Timestamp.now() };
    if (Array.isArray(items)) updateData.items = items;
    await docRef.update(updateData);
    res.status(200).json({ message: 'Estado actualizado.' });
  } catch (error) {
    console.error('Error updating orden estado:', error);
    res.status(500).json({ message: 'Error al actualizar la orden.' });
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
          idProducto: item.idProducto || '',
          nombreComercial: item.nombreComercial || '',
          cantidad: cantidadRecibida,
          unidad: item.unidad || '',
          precioUnitario: parseFloat(item.precioUnitario) || 0,
          proveedor: proveedor || '',
          ocPoNumber: poNumber || '',
          ordenCompraId: ordenCompraId || null,
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
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
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
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
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
    const { trabajadorId, trabajadorNombre, tipo, fechaInicio, fechaFin, dias, motivo, conGoce,
            esParcial, horaInicio, horaFin, horas } = req.body;
    if (!trabajadorId || !tipo || !fechaInicio) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_permisos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      fechaInicio: Timestamp.fromDate(new Date(fechaInicio + 'T12:00:00')),
      fechaFin: Timestamp.fromDate(new Date((fechaFin || fechaInicio) + 'T12:00:00')),
      dias: Number(dias) || 0,
      esParcial: esParcial === true,
      horaInicio: esParcial ? (horaInicio || null) : null,
      horaFin:    esParcial ? (horaFin    || null) : null,
      horas:      esParcial ? (Number(horas) || 0)  : 0,
      motivo: motivo || '',
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
      estado: 'pendiente',
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

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

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

    // If marking as pagada, complete the associated dashboard task
    if (estado === 'pagada') {
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
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
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
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
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

// ── Subordinados (trabajadores asignados a un encargado) ──────────────────────
app.get('/api/hr/subordinados', authenticate, async (req, res) => {
  try {
    const { encargadoId } = req.query;
    if (!encargadoId) return res.status(400).json({ message: 'encargadoId es requerido.' });
    const fichasSnap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', encargadoId)
      .get();
    const trabajadorIds = fichasSnap.docs.map(d => d.id);
    if (trabajadorIds.length === 0) return res.status(200).json([]);
    const usersSnap = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const subordinados = usersSnap.docs
      .filter(d => trabajadorIds.includes(d.id))
      .map(d => ({ id: d.id, ...d.data() }));
    res.status(200).json(subordinados);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener subordinados.' });
  }
});

// ── Planilla por Unidad / Hora ────────────────────────────────────────────────
app.get('/api/hr/planilla-unidad', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_unidad')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fecha: d.data().fecha ? d.data().fecha.toDate().toISOString() : null,
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener planillas.' });
  }
});

app.get('/api/hr/planilla-unidad/historial', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_unidad_historial')
      .where('fincaId', '==', req.fincaId)
      .orderBy('aprobadoAt', 'desc')
      .get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fecha:      d.data().fecha?.toDate?.()?.toISOString()      || null,
      aprobadoAt: d.data().aprobadoAt?.toDate?.()?.toISOString() || null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener historial de planillas.' });
  }
});

app.post('/api/hr/planilla-unidad', authenticate, async (req, res) => {
  try {
    const { fecha, encargadoId, encargadoNombre, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;
    if (!fecha || !encargadoId) return res.status(400).json({ message: 'Fecha y encargado son requeridos.' });

    // Generar consecutivo PU-XXXXX
    const counterRef = db.collection('counters').doc(`planilla_unidad_${req.fincaId}`);
    let consecutivo = 'PU-00001';
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      const next = counterDoc.exists ? (counterDoc.data().value || 0) + 1 : 1;
      t.set(counterRef, { value: next });
      consecutivo = `PU-${String(next).padStart(5, '0')}`;
    });

    const ref = await db.collection('hr_planilla_unidad').add({
      fincaId: req.fincaId,
      consecutivo,
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      encargadoId, encargadoNombre: encargadoNombre || '',
      segmentos: segmentos || [],
      trabajadores: trabajadores || [],
      totalGeneral: Number(totalGeneral) || 0,
      estado: estado || 'borrador',
      observaciones: observaciones || '',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, consecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear planilla.' });
  }
});

app.put('/api/hr/planilla-unidad/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { fecha, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

    const update = { updatedAt: Timestamp.now() };
    if (fecha !== undefined) update.fecha = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    if (segmentos !== undefined) update.segmentos = segmentos;
    if (trabajadores !== undefined) update.trabajadores = trabajadores;
    if (totalGeneral !== undefined) update.totalGeneral = Number(totalGeneral);
    if (estado !== undefined) update.estado = estado;
    if (observaciones !== undefined) update.observaciones = observaciones;

    // ── Snapshot al aprobar ────────────────────────────────────────────────────
    if (estado === 'aprobada' && !ownership.doc.data().snapshotCreado) {
      const doc = ownership.doc.data();

      // Resolver nombre del aprobador
      let aprobadoPor = req.userEmail;
      const userSnap = await db.collection('users')
        .where('email', '==', req.userEmail)
        .where('fincaId', '==', req.fincaId)
        .limit(1).get();
      if (!userSnap.empty) aprobadoPor = userSnap.docs[0].data().nombre;

      const aprobadoAt = Timestamp.now();
      const segs    = doc.segmentos   || [];
      const workers = doc.trabajadores || [];
      const batch = db.batch();

      workers.forEach(worker => {
        segs.forEach(seg => {
          const cantidad = Number(worker.cantidades?.[seg.id]) || 0;
          if (cantidad <= 0) return;
          const costoUnitario = Number(seg.costoUnitario) || 0;
          const ref = db.collection('hr_planilla_unidad_historial').doc();
          batch.set(ref, {
            fincaId:          req.fincaId,
            planillaId:       req.params.id,
            consecutivo:      doc.consecutivo   || '',
            fecha:            doc.fecha         || null,   // Timestamp
            encargadoNombre:  doc.encargadoNombre || '',
            aprobadoPor,
            aprobadoAt,
            observaciones:    doc.observaciones || '',
            totalGeneral:     Number(doc.totalGeneral) || 0,
            // Segmento
            loteNombre:       seg.loteNombre   || '',
            grupo:            seg.grupo        || '',
            labor:            seg.labor        || '',
            avanceHa:         Number(seg.avanceHa) || 0,
            unidad:           seg.unidad       || '',
            costoUnitario,
            // Trabajador
            trabajadorId:     worker.trabajadorId   || '',
            trabajadorNombre: worker.trabajadorNombre || '',
            cantidad,
            subtotal:         cantidad * costoUnitario,
            totalTrabajador:  Number(worker.total) || 0,
          });
        });
      });

      await batch.commit();
      update.snapshotCreado = true;
    }

    await db.collection('hr_planilla_unidad').doc(req.params.id).update(update);
    res.status(200).json({ message: 'Planilla actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar planilla.' });
  }
});

app.delete('/api/hr/planilla-unidad/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('hr_planilla_unidad').doc(req.params.id).delete();
    res.status(200).json({ message: 'Planilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar planilla.' });
  }
});

// ── Plantillas de Planilla por Unidad / Hora ──────────────────────────────────
app.get('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_plantillas_planilla')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', req.query.encargadoId || '')
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

app.post('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const { nombre, segmentos, trabajadores, encargadoId } = req.body;
    if (!nombre || !encargadoId) return res.status(400).json({ message: 'Nombre y encargado son requeridos.' });
    const ref = await db.collection('hr_plantillas_planilla').add({
      fincaId: req.fincaId,
      nombre: nombre.trim(),
      segmentos: segmentos || [],
      trabajadores: trabajadores || [],
      encargadoId,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar plantilla.' });
  }
});

app.delete('/api/hr/plantillas-planilla/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_plantillas_planilla', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('hr_plantillas_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
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
    const { nombreEmpresa, identificacion, representanteLegal, administrador, direccion, whatsapp, correo, logoBase64, mediaType,
            diasIDesarrollo, diasIIDesarrollo, diasPostForza,
            diasSiembraICosecha, diasForzaICosecha, diasChapeaIICosecha, diasForzaIICosecha,
            plantasPorHa, kgPorPlanta, kgPorHa, rechazoICosecha, rechazoIICosecha } = req.body;

    const data = { fincaId: req.fincaId, updatedAt: Timestamp.now() };
    if (nombreEmpresa      !== undefined) data.nombreEmpresa      = nombreEmpresa;
    if (identificacion     !== undefined) data.identificacion     = identificacion;
    if (representanteLegal !== undefined) data.representanteLegal = representanteLegal;
    if (administrador      !== undefined) data.administrador      = administrador;
    if (direccion          !== undefined) data.direccion          = direccion;
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
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
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
    const data = snap.docs.map(d => {
      const raw = d.data();
      return { id: d.id, ...raw, fecha: raw.fecha.toDate().toISOString(), fechaCierre: raw.fechaCierre ? raw.fechaCierre.toDate().toISOString() : null };
    });
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
    const esCerrado = cerrado === true || cerrado === 'true';
    const inputFechaCierre = req.body.fechaCierre;
    const fechaCierre = esCerrado
      ? (inputFechaCierre && String(inputFechaCierre).trim()
          ? Timestamp.fromDate(new Date(String(inputFechaCierre).trim() + 'T12:00:00'))
          : Timestamp.now())
      : null;

    const bloqueNorm = bloque || '';
    const ref = await db.collection('siembras').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      bloque: bloqueNorm,
      plantas: plantas_, densidad: densidad_,
      areaCalculada,
      materialId: materialId || '',
      materialNombre: materialNombre || '',
      rangoPesos: rangoPesos || '',
      variedad: variedad || '',
      cerrado: esCerrado,
      ...(fechaCierre && { fechaCierre }),
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      createdAt: Timestamp.now(),
    });

    if (esCerrado) {
      const siblingsSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloqueNorm)
        .get();
      const batch = db.batch();
      siblingsSnap.docs.forEach(d => {
        if (d.id !== ref.id) batch.update(d.ref, { cerrado: true, fechaCierre });
      });
      await batch.commit();
    }

    res.status(201).json({ id: ref.id, areaCalculada });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar siembra.' });
  }
});

app.put('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.fecha) updates.fecha = Timestamp.fromDate(new Date(updates.fecha));

    const needsDoc = updates.plantas !== undefined || updates.densidad !== undefined || updates.cerrado === true;
    if (needsDoc) {
      const doc = await db.collection('siembras').doc(req.params.id).get();
      const current = doc.data();

      if (updates.plantas !== undefined || updates.densidad !== undefined) {
        const plantas_ = parseInt(updates.plantas ?? current.plantas) || 0;
        const densidad_ = parseFloat(updates.densidad ?? current.densidad) || 0;
        updates.areaCalculada = densidad_ > 0 ? parseFloat((plantas_ / densidad_).toFixed(4)) : 0;
      }

      if (updates.cerrado !== undefined) {
        const fechaCierreUpdate = updates.cerrado === true ? Timestamp.now() : FieldValue.delete();
        const siblingsSnap = await db.collection('siembras')
          .where('fincaId', '==', current.fincaId)
          .where('loteId', '==', current.loteId)
          .where('bloque', '==', current.bloque)
          .get();
        const batch = db.batch();
        const thisId = req.params.id;
        siblingsSnap.docs.forEach(d => {
          const sibUpdates = d.id === thisId
            ? { ...updates, fechaCierre: fechaCierreUpdate }
            : { cerrado: updates.cerrado, fechaCierre: fechaCierreUpdate };
          batch.update(d.ref, sibUpdates);
        });
        await batch.commit();
        return res.status(200).json({ message: 'Siembra actualizada.' });
      }
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
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas, moneda,
            contacto, whatsapp, sitioWeb, paisOrigen, tiempoEntregaDias,
            limiteCredito, banco, cuentaBancaria, descuentoHabitual, categoria, estado } = req.body;
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
      moneda: moneda || 'USD',
      contacto: contacto?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      sitioWeb: sitioWeb?.trim() || '',
      paisOrigen: paisOrigen?.trim() || '',
      tiempoEntregaDias: tiempoEntregaDias ? parseInt(tiempoEntregaDias) : null,
      limiteCredito: limiteCredito ? parseFloat(limiteCredito) : null,
      banco: banco?.trim() || '',
      cuentaBancaria: cuentaBancaria?.trim() || '',
      descuentoHabitual: descuentoHabitual ? parseFloat(descuentoHabitual) : null,
      categoria: categoria?.trim() || '',
      estado: estado || 'activo',
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
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas, moneda,
            contacto, whatsapp, sitioWeb, paisOrigen, tiempoEntregaDias,
            limiteCredito, banco, cuentaBancaria, descuentoHabitual, categoria, estado } = req.body;
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
      moneda: moneda || 'USD',
      contacto: contacto?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      sitioWeb: sitioWeb?.trim() || '',
      paisOrigen: paisOrigen?.trim() || '',
      tiempoEntregaDias: tiempoEntregaDias ? parseInt(tiempoEntregaDias) : null,
      limiteCredito: limiteCredito ? parseFloat(limiteCredito) : null,
      banco: banco?.trim() || '',
      cuentaBancaria: cuentaBancaria?.trim() || '',
      descuentoHabitual: descuentoHabitual ? parseFloat(descuentoHabitual) : null,
      categoria: categoria?.trim() || '',
      estado: estado || 'activo',
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
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''));
    res.json(items);
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
    };
    if (capacidad !== undefined && capacidad !== '') data.capacidad = Number(capacidad);
    // Upsert: if idMaquina is provided and already exists for this finca, update it
    if (data.idMaquina) {
      const existing = await db.collection('maquinaria')
        .where('fincaId', '==', req.fincaId)
        .where('idMaquina', '==', data.idMaquina)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        const { fincaId, ...updateData } = data;
        await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    data.creadoEn = Timestamp.now();
    const doc = await db.collection('maquinaria').add(data);
    res.status(201).json({ id: doc.id, merged: false });
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
  const coleccionesPermitidas = ['lotes', 'siembras', 'grupos', 'scheduled_tasks', 'productos', 'users', 'materiales_siembra', 'packages'];
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

// Tool: registrar registro de horímetro
async function chatToolRegistrarHorimetro(input, fincaId) {
  const allowed = [
    'fecha', 'tractorId', 'tractorNombre', 'implemento',
    'horimetroInicial', 'horimetroFinal',
    'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
    'horaInicio', 'horaFinal', 'operarioId', 'operarioNombre',
  ];
  const data = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)));
  if (!data.fecha || !data.tractorId) {
    return { error: 'Fecha y tractorId son obligatorios.' };
  }
  const ref = await db.collection('horimetro').add({
    ...data,
    fincaId,
    creadoEn: Timestamp.now(),
  });
  const horas = (data.horimetroInicial != null && data.horimetroFinal != null)
    ? (parseFloat(data.horimetroFinal) - parseFloat(data.horimetroInicial)).toFixed(1)
    : null;
  return { id: ref.id, registrado: true, horas };
}

// Tool: registrar permiso o ausencia de RR.HH.
async function chatToolRegistrarPermiso(input, fincaId) {
  const { trabajadorId, trabajadorNombre, tipo, conGoce, fechaInicio, esParcial,
          horaInicio, horaFin: horaFinInput, fechaFin, motivo } = input;

  if (!trabajadorId || !tipo || !fechaInicio) {
    return { error: 'trabajadorId, tipo y fechaInicio son obligatorios.' };
  }

  const TIPOS_VALIDOS = ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'];
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return { error: `Tipo "${tipo}" no válido. Usa: ${TIPOS_VALIDOS.join(', ')}` };
  }

  // Verify trabajador belongs to finca
  const userDoc = await db.collection('users').doc(trabajadorId).get();
  if (!userDoc.exists || userDoc.data().fincaId !== fincaId) {
    return { error: 'Trabajador no encontrado en esta finca.' };
  }

  let horaFin = horaFinInput || null;
  let horas = 0;

  if (esParcial) {
    if (!horaInicio) return { error: 'horaInicio es obligatoria para permisos parciales.' };

    // Si no se proporcionó horaFin, buscar en el horario semanal del trabajador
    if (!horaFin) {
      try {
        const fichaDoc = await db.collection('hr_fichas').doc(trabajadorId).get();
        if (fichaDoc.exists) {
          const horario = fichaDoc.data().horarioSemanal || {};
          const JS_DAY_TO_KEY = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
          const dayKey = JS_DAY_TO_KEY[new Date(fechaInicio + 'T12:00:00').getDay()];
          const diaHorario = horario[dayKey];
          if (diaHorario?.activo && diaHorario.fin) {
            horaFin = diaHorario.fin;
          }
        }
      } catch { /* ignorar */ }
    }

    if (horaInicio && horaFin) {
      const [h1, m1] = horaInicio.split(':').map(Number);
      const [h2, m2] = horaFin.split(':').map(Number);
      const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      horas = Math.max(0, Math.round(mins / 60 * 10) / 10);
    }
  }

  const fechaFinReal = esParcial ? fechaInicio : (fechaFin || fechaInicio);
  let dias = 0;
  if (!esParcial) {
    const d = Math.round((new Date(fechaFinReal) - new Date(fechaInicio)) / 86400000) + 1;
    dias = Math.max(1, d);
  }

  const ref = await db.collection('hr_permisos').add({
    trabajadorId,
    trabajadorNombre: trabajadorNombre || userDoc.data().nombre || '',
    tipo,
    fechaInicio: Timestamp.fromDate(new Date(fechaInicio + 'T12:00:00')),
    fechaFin: Timestamp.fromDate(new Date(fechaFinReal + 'T12:00:00')),
    dias,
    esParcial: esParcial === true,
    horaInicio: esParcial ? (horaInicio || null) : null,
    horaFin:    esParcial ? (horaFin    || null) : null,
    horas:      esParcial ? horas : 0,
    motivo: motivo || '',
    conGoce: conGoce !== false,
    estado: 'pendiente',
    fincaId,
    createdAt: Timestamp.now(),
  });

  const tipoLabels = {
    vacaciones: 'Vacaciones', enfermedad: 'Enfermedad',
    permiso_con_goce: 'Permiso con goce', permiso_sin_goce: 'Permiso sin goce', licencia: 'Licencia',
  };
  return {
    id: ref.id,
    registrado: true,
    resumen: {
      trabajador: trabajadorNombre || userDoc.data().nombre,
      tipo: tipoLabels[tipo] || tipo,
      conGoce: conGoce !== false,
      fecha: fechaInicio,
      esParcial: esParcial === true,
      horaInicio: esParcial ? horaInicio : null,
      horaFin:    esParcial ? horaFin : null,
      horas:      esParcial ? horas : null,
      dias:       !esParcial ? dias : null,
      fechaFin:   (!esParcial && fechaFinReal !== fechaInicio) ? fechaFinReal : null,
    },
  };
}

async function chatToolCrearEmpleado({ nombre, email, telefono, rol, empleadoPlanilla }, fincaId) {
  if (!nombre?.trim() || !email?.trim() || !rol) {
    return { error: 'Nombre, email y rol son obligatorios.' };
  }
  const emailNorm = email.trim().toLowerCase();
  const existing = await db.collection('users')
    .where('fincaId', '==', fincaId)
    .where('email', '==', emailNorm)
    .get();
  if (!existing.empty) {
    return { error: `Ya existe un usuario con el correo "${emailNorm}" en esta finca.` };
  }
  const docRef = await db.collection('users').add({
    nombre: nombre.trim(),
    email: emailNorm,
    telefono: telefono?.trim() || '',
    rol: rol || 'trabajador',
    empleadoPlanilla: empleadoPlanilla === true,
    fincaId,
    createdAt: Timestamp.now(),
  });
  return {
    ok: true,
    id: docRef.id,
    nombre: nombre.trim(),
    email: emailNorm,
    rol: rol || 'trabajador',
    empleadoPlanilla: empleadoPlanilla === true,
  };
}

async function chatToolEditarEmpleado({ empleadoId, nombre, email, telefono, rol, empleadoPlanilla }, fincaId) {
  const updates = {};
  if (nombre !== undefined)          updates.nombre          = nombre.trim();
  if (email !== undefined)           updates.email           = email.trim().toLowerCase();
  if (telefono !== undefined)        updates.telefono        = telefono.trim();
  if (rol !== undefined)             updates.rol             = rol;
  if (empleadoPlanilla !== undefined) updates.empleadoPlanilla = empleadoPlanilla;
  if (Object.keys(updates).length === 0) {
    return { error: 'Debes especificar al menos un campo a modificar.' };
  }
  const doc = await db.collection('users').doc(empleadoId).get();
  if (!doc.exists || doc.data().fincaId !== fincaId) {
    return { error: 'Empleado no encontrado en esta finca.' };
  }
  await db.collection('users').doc(empleadoId).update(updates);
  return { ok: true, empleadoId, nombreActual: doc.data().nombre, cambios: updates };
}

app.post('/api/chat', authenticate, async (req, res) => {
  try {
    const { message, imageBase64, mediaType, userId, userName, history, clientTime, clientTzName, clientTzOffset } = req.body;

    if (!anthropicClient) {
      anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });
    }

    // Cargar catálogos para que Claude pueda resolver nombres a IDs
    const [lotesSnap, matsSnap, paquetesSnap, gruposSnap, siembrasSnap, maquinariaSnap, usersSnap, laboresSnap, productosSnap] = await Promise.all([
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).get(),
      db.collection('packages').where('fincaId', '==', req.fincaId).get(),
      db.collection('grupos').where('fincaId', '==', req.fincaId).get(),
      db.collection('siembras').where('fincaId', '==', req.fincaId).get(),
      db.collection('maquinaria').where('fincaId', '==', req.fincaId).get(),
      db.collection('users').where('fincaId', '==', req.fincaId).get(),
      db.collection('labores').where('fincaId', '==', req.fincaId).get(),
      db.collection('productos').where('fincaId', '==', req.fincaId).get(),
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

    // Construir mapa siembraId -> {loteNombre, bloque} para enriquecer grupos
    const siembraMap = {};
    siembrasSnap.docs.forEach(d => {
      siembraMap[d.id] = { loteNombre: d.data().loteNombre || '', bloque: d.data().bloque || '' };
    });
    const catalogoGrupos = gruposSnap.docs.map(d => {
      const g = d.data();
      const bloques = Array.isArray(g.bloques) ? g.bloques : [];
      // Resolver lotes únicos que conforman este grupo
      const lotesEnGrupo = [...new Set(bloques.map(sid => siembraMap[sid]?.loteNombre).filter(Boolean))];
      const bloquesDetalle = bloques.map(sid => {
        const s = siembraMap[sid];
        return s ? `${s.loteNombre} bloque ${s.bloque}` : sid;
      });
      return {
        id: d.id,
        nombre: g.nombreGrupo || '',
        cosecha: g.cosecha || '',
        etapa: g.etapa || '',
        lotes: lotesEnGrupo,
        bloques: bloquesDetalle,
        totalBloques: bloques.length,
      };
    });
    const gruposTexto = catalogoGrupos.length
      ? catalogoGrupos.map(g =>
          `  - Grupo: "${g.nombre}" | ID: "${g.id}"` +
          (g.cosecha ? ` | Cosecha: ${g.cosecha}` : '') +
          (g.etapa ? ` | Etapa: ${g.etapa}` : '') +
          ` | Lotes que agrupa: [${g.lotes.join(', ') || 'sin lotes resueltos'}]` +
          ` | Bloques: [${g.bloques.join('; ')}]`
        ).join('\n')
      : '  (sin grupos registrados)';

    // Catálogos de maquinaria, usuarios y labores para horímetro
    const catalogoMaquinaria = maquinariaSnap.docs.map(d => ({
      id: d.id, idMaquina: d.data().idMaquina || '', codigo: d.data().codigo || '',
      descripcion: d.data().descripcion || '', tipo: d.data().tipo || '',
    }));
    const tractoresTexto = (() => {
      const t = catalogoMaquinaria.filter(m => /tractor|otra maquinaria/i.test(m.tipo));
      return t.length
        ? t.map(m => `  - ID: "${m.id}" | ID Activo: "${m.idMaquina}" | Código: "${m.codigo}" | Nombre: "${m.descripcion}"`).join('\n')
        : '  (sin tractores registrados)';
    })();
    const implementosTexto = (() => {
      const t = catalogoMaquinaria.filter(m => /implemento/i.test(m.tipo));
      return t.length
        ? t.map(m => `  - ID: "${m.id}" | ID Activo: "${m.idMaquina}" | Código: "${m.codigo}" | Nombre: "${m.descripcion}"`).join('\n')
        : '  (sin implementos registrados)';
    })();
    const catalogoUsers = usersSnap.docs.map(d => ({
      id: d.id, nombre: d.data().nombre || '', rol: d.data().rol || '',
      email: d.data().email || '', telefono: d.data().telefono || '',
      empleadoPlanilla: d.data().empleadoPlanilla === true,
    }));
    const operariosTexto = catalogoUsers.length
      ? catalogoUsers.map(u => `  - ID: "${u.id}" | Nombre: "${u.nombre}" | Rol: ${u.rol} | Email: ${u.email} | Teléfono: ${u.telefono || '—'} | Planilla: ${u.empleadoPlanilla ? 'sí' : 'no'}`).join('\n')
      : '  (sin usuarios registrados)';
    const catalogoLabores = laboresSnap.docs.map(d => ({
      id: d.id, codigo: d.data().codigo || '', descripcion: d.data().descripcion || '',
    }));
    const laboresTexto = catalogoLabores.length
      ? catalogoLabores.map(l => `  - ID: "${l.id}"${l.codigo ? ` | Código: "${l.codigo}"` : ''} | Descripción: "${l.descripcion}"`).join('\n')
      : '  (sin labores registradas)';

    const catalogoProductos = productosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const productosTexto = catalogoProductos.length
      ? catalogoProductos.map(p =>
          `  - ID: "${p.id}" | Código: "${p.idProducto || ''}" | Nombre: "${p.nombreComercial || ''}" | IngredienteActivo: "${p.ingredienteActivo || ''}" | Tipo: ${p.tipo || ''} | Plaga: "${p.plagaQueControla || ''}" | Dosis/Ha: ${p.cantidadPorHa ?? ''} | Unidad: ${p.unidad || ''} | Stock: ${p.stockActual ?? 0} | StockMin: ${p.stockMinimo ?? 0} | Precio: ${p.precioUnitario ?? ''} ${p.moneda || ''} | Proveedor: "${p.proveedor || ''}"`
        ).join('\n')
      : '  (sin productos registrados)';

    // Fecha y hora del cliente (con zona horaria local del usuario)
    const userNow = clientTime ? new Date(clientTime) : new Date();
    const tz = clientTzName || 'America/Costa_Rica';
    const userDateTimeStr = userNow.toLocaleString('es-CR', {
      timeZone: tz,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const today = userNow.toLocaleDateString('sv', { timeZone: tz }); // "YYYY-MM-DD" en zona del usuario

    const systemPrompt = `Eres Aurora, el asistente inteligente de la plataforma agrícola Aurora para Finca Aurora.
Ayudas a los trabajadores a registrar siembras, horímetros y consultar datos agrícolas.
Fecha y hora actual del usuario: ${userDateTimeStr} (${tz}). El usuario es ${userName || 'un trabajador de la finca'}.

## Catálogo actual del sistema

Lotes registrados:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Paquetes de tareas disponibles:
${paquetesTexto}

Grupos registrados (agrupaciones de bloques de distintos lotes para homogeneizar labores y aplicaciones):
${gruposTexto}

Tractores y Maquinaria de campo registrada:
${tractoresTexto}

Implementos registrados:
${implementosTexto}

Labores registradas:
${laboresTexto}

Operarios / Usuarios registrados:
${operariosTexto}

Inventario de productos agroquímicos (bodega):
${productosTexto}

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

Cuando el usuario pida registrar un horímetro (ej: "agrega el siguiente horímetro: tractor 4-1, implemento 5-13, horímetro inicial 10.4, horímetro final 15.3, lote 6A, labor 189, hora inicial 5am hora final 2pm"):
1. Extrae todos los datos del texto usando los catálogos precargados arriba:
   - **Tractor**: busca por Código (ej: "4-1"), ID Activo o nombre aproximado → obtén ID interno y nombre
   - **Implemento**: igual que tractor → guarda solo el nombre (descripcion), no el ID
   - **Labor**: busca por Código o Descripción aproximada → guarda solo la descripción de la labor
   - **Lote**: busca por nombre o código → guarda loteId y loteNombre
   - **Grupo**: busca por nombre entre los grupos del lote → guarda el nombre del grupo (nombreGrupo)
   - **Operario**: busca por nombre aproximado → guarda operarioId y operarioNombre
   - **Horas**: convierte a formato 24h HH:MM — "5am" → "05:00", "2pm" → "14:00", "14:30" → "14:30"
   - **Fecha**: si no se menciona, usa ${today}
2. Si el tractor no pudo resolverse, pregunta antes de continuar. Es el único campo verdaderamente obligatorio.
3. Si el usuario mencionó un lote pero NO mencionó el grupo, muéstrale la lista de grupos disponibles para ese lote (del catálogo de grupos, campo "Lotes que agrupa") y pregúntale cuál es. Recuerda todos los demás datos ya extraídos — no vuelvas a preguntar por ellos.
4. Cuando el usuario responda el grupo (aunque sea con nombre aproximado o parcial), resuélvelo al nombreGrupo correcto y llama de inmediato a la herramienta que corresponda con todos los datos acumulados.
5. Los bloques son opcionales — si el usuario los menciona, inclúyelos; si no, déjalos vacíos.
6. Una vez registrado, confirma con un resumen breve: tractor, lote, grupo, labor y horas trabajadas.

**Flujo según origen del registro:**
- **Texto o voz**: usa directamente 'registrar_horimetro' cuando tengas fecha y tractorId.
- **Imagen**: SIEMPRE usa 'previsualizar_horimetro' (nunca 'registrar_horimetro' con imagen). El sistema mostrará al usuario una tarjeta de confirmación con los datos para que los revise antes de guardar.

Cuando el usuario pida modificar un campo de un producto del inventario (ej: "cambia el ingrediente activo del Cloruro de Potasio a Potasio", "el proveedor del Roundup es AgroVal"):
1. Busca el producto en el catálogo de productos agroquímicos usando coincidencia aproximada del nombre, código o ingrediente activo.
2. Usa "editar_producto" con el ID Firestore correcto, el nombre técnico del campo y el nuevo valor.
3. Los campos editables son: idProducto, nombreComercial, ingredienteActivo, tipo, plagaQueControla, cantidadPorHa, unidad, periodoReingreso, periodoACosecha, stockMinimo, precioUnitario, moneda, tipoCambio, proveedor. El campo "tipo" solo acepta: "Herbicida", "Fungicida", "Insecticida", "Fertilizante", "Regulador de crecimiento", "Otro".

Cuando el usuario pida cambiar el stock actual de un producto (ej: "actualiza el stock del Mancozeb a 15 kg", "hay 20 litros de Roundup"):
1. Los ajustes de stock generan un movimiento de inventario y requieren una nota explicativa.
2. Si el usuario ya dio una nota o razón, usa "ajustar_stock" directamente.
3. Si no, pide la nota antes de ejecutar. Ejemplo: "¿Cuál es la razón del ajuste? (ej: conteo físico, pérdida por derrame…)"

Cuando el usuario pida un reporte, análisis, proyección o cualquier consulta de datos (ej: "¿cuántas plantas se sembraron este mes?", "¿qué tareas están pendientes?", "¿qué productos están bajo stock?"):
1. Usa "consultar_datos" con los filtros apropiados para obtener los datos relevantes.
2. Puedes hacer múltiples llamadas encadenadas para cruzar información entre colecciones (ej: primero lotes, luego siembras de esos lotes).
3. Analiza los resultados y presenta un resumen claro: totales, promedios, comparaciones o lo que sea útil.
4. No pidas confirmación para consultas — simplemente ejecuta y responde.

## Esquema de colecciones

- **lotes**: codigoLote, nombreLote, fechaCreacion, paqueteId, hectareas
- **siembras**: loteId, loteNombre, bloque, plantas, densidad, areaCalculada, materialId, materialNombre, variedad, rangoPesos, fecha, responsableNombre, cerrado
- **grupos**: nombreGrupo, cosecha, etapa, fechaCreacion, bloques[] (array de IDs de siembras), paqueteId — Un grupo NO guarda el nombre del lote directamente; agrupa bloques concretos (siembras) de uno o varios lotes.
- **horimetro**: fecha, tractorId, tractorNombre, implemento, horimetroInicial, horimetroFinal, loteId, loteNombre, grupo, bloques[], labor, horaInicio, horaFinal, operarioId, operarioNombre
- **maquinaria**: idMaquina, codigo, descripcion, tipo (TRACTOR DE LLANTAS | IMPLEMENTO | etc.), ubicacion
- **labores**: codigo, descripcion, observacion
- **scheduled_tasks**: type (REMINDER_3_DAY|REMINDER_DUE_DAY), status (pending|completed_by_user|skipped|notified), executeAt, loteId, grupoId, activity{name,day,type,responsableId,productos[]}
- **productos**: idProducto, nombreComercial, ingredienteActivo, tipo, stockActual, stockMinimo, cantidadPorHa, unidad
- **users**: nombre, email, telefono, rol (trabajador|encargado|supervisor|administrador)
- **materiales_siembra**: nombre, variedad, rangoPesos
- **packages**: nombrePaquete, tipoCosecha, etapaCultivo, activities[]

## Cómo relacionar grupos con lotes

Un grupo se forma seleccionando bloques específicos de siembra (identificados por su ID en Firestore). Cada bloque pertenece a un lote. Por eso:
- Cuando el usuario pregunte "¿qué grupos tiene el lote X?", usa el catálogo de grupos precargado arriba (campo "Lotes que agrupa") para responder directamente sin llamar herramientas.
- Cuando necesites más detalle (hectáreas, plantas, estado), usa consultar_datos sobre "grupos" y filtra por ID del grupo de interés.
- Puedes explicar al usuario que un grupo es una agrupación de bloques de distintos lotes, creada para aplicarles las mismas labores o agroquímicos de forma uniforme.

Cuando el usuario pida registrar un permiso, ausencia o vacaciones (ej: "registra un permiso para Juan hoy a partir de las 12 medio día", "vacaciones para Ana del 10 al 15 de abril", "Olger tiene permiso mañana por el día completo"):
1. Identifica al trabajador en el catálogo de operarios/usuarios (coincidencia aproximada). Resuelve al trabajadorId correcto.
2. Determina el tipo: vacaciones, enfermedad, permiso_con_goce, permiso_sin_goce, licencia. Si no está claro, usa "permiso_con_goce" como tipo neutro pero menciona cuál escogiste.
3. Determina si es parcial (por horas) o días completos:
   - Parcial: si se menciona una hora de inicio y/o fin (ej: "a partir de las 12", "de 8am a 12pm", "desde las 2 de la tarde").
   - Días completos: si se mencionan días sin horas específicas.
4. Convierte fechas: "hoy" → ${today}. Para fechas relativas (mañana, el viernes, etc.) calcula la fecha YYYY-MM-DD correcta.
5. Convierte horas a formato 24h HH:MM: "12 medio día" → "12:00", "5pm" → "17:00", "8am" → "08:00", "2 de la tarde" → "14:00".
6. Para permisos parciales: incluye horaInicio. Si el usuario solo dio la hora de inicio sin indicar la de fin, NO incluyas horaFin — el sistema la resolverá automáticamente del horario registrado del trabajador para ese día.
7. Para días completos: incluye fechaFin si hay un rango; si es un solo día, solo fechaInicio.
8. Si el usuario NO especificó si es con goce o sin goce de salario, DEBES preguntar antes de registrar. No asumas.
9. Llama a "registrar_permiso" con todos los datos confirmados.

Cuando el usuario pida crear un recordatorio personal (ej: "recuérdame en dos semanas que debo revisar la fruta del lote 7", "avísame el viernes que llame al proveedor", "recuérdame mañana a las 3pm que..."):
1. Extrae el mensaje del recordatorio (qué debe hacer el usuario).
2. Calcula la fecha y hora exacta usando la fecha y hora actual del usuario indicada arriba (${userDateTimeStr}): "en 2 semanas" → suma 14 días desde hoy (${today}), "mañana" → ${today} + 1 día, "el viernes" → próximo viernes, "a las 3pm" → T15:00:00, "a las 3" → interpreta como 15:00 si es por la tarde según contexto. Si el usuario no especifica hora, usa las 07:00.
3. Llama a "crear_recordatorio" con message (redactado claramente) y remindAt en formato ISO 8601 (YYYY-MM-DDTHH:MM:00).
4. Confirma al usuario con la fecha y hora en formato legible: "Listo, te recuerdo el [día, DD de mes] a las [HH:MM]."

Cuando el usuario pregunte por sus recordatorios (ej: "¿qué recordatorios tengo?", "muéstrame mis recordatorios", "¿tengo algo pendiente?"):
1. Llama a "listar_recordatorios" y presenta la lista ordenada por fecha con el mensaje y la fecha/hora de cada uno.
2. Si no hay recordatorios activos, indícalo amigablemente.

Cuando el usuario quiera cancelar un recordatorio (ej: "cancela el recordatorio de la fruta", "borra mi recordatorio del viernes"):
1. Llama primero a "listar_recordatorios" para ver los activos.
2. Identifica cuál coincide con la descripción del usuario (coincidencia aproximada por mensaje o fecha).
3. Llama a "eliminar_recordatorio" con el ID correcto y confirma la cancelación.

Cuando el usuario adjunte una imagen de un formulario físico de planilla de trabajadores (planilla por hora o por unidad):
1. Identifica las columnas de trabajo de izquierda a derecha (campo LOTE, LABOR, UNIDAD, COSTO por columna). Numera mentalmente cada columna empezando en 0.
2. Extrae la fecha y el nombre del encargado.
3. Para cada columna construye un objeto segmento (en orden 0, 1, 2…): lote, labor, grupo, avance, unidad, costo.
4. Para cada fila de trabajador: lee su nombre y luego recorre las columnas de izquierda a derecha. Construye un array de cantidades donde cantidades[0] = valor de la columna 0, cantidades[1] = valor de la columna 1, etc. Si una celda está vacía usa "".
5. CRÍTICO: el array cantidades de cada trabajador debe tener exactamente tantos elementos como segmentos haya, en el mismo orden de columna. No uses mapas ni IDs — usa solo el índice de posición.
6. Usa el catálogo de usuarios para resolver encargadoId y trabajadorId por coincidencia aproximada de nombre.
7. Usa el catálogo de lotes para resolver loteId/loteNombre, y el catálogo de labores para el campo labor en formato "codigo - descripción".
8. Llama a "previsualizar_planilla". El sistema mostrará una tarjeta de confirmación al usuario.

Cuando el usuario pida crear o agregar un nuevo empleado (ej: "agrega a Juan Pérez como trabajador", "crea un usuario para María con correo maria@gmail.com", "registra a Pedro Solís"):
1. Los datos OBLIGATORIOS son nombre completo, correo electrónico y rol (trabajador/encargado/supervisor/administrador). Si el usuario no los ha dado todos, pídelos.
2. Sugiere también agregar: número de teléfono y si debe recibir pago de planilla (empleadoPlanilla: true/false). Hazlo de forma amigable, dejando claro que son opcionales.
3. Una vez tengas nombre y email, resume todos los datos que vas a registrar y pide confirmación explícita antes de crear.
4. Solo llama a "crear_empleado" tras recibir confirmación del usuario.

Cuando el usuario pida modificar datos de un empleado existente (ej: "cambia el teléfono de Juan a 8888-1234", "actualiza el correo de Ana García", "asigna a Pedro como encargado", "agrega a María a la planilla"):
1. Identifica al empleado en el catálogo de usuarios por nombre (coincidencia aproximada).
2. Identifica qué campo(s) cambiar: nombre, email, telefono, rol o empleadoPlanilla.
3. Antes de aplicar, confirma: "¿Confirmas cambiar el [campo] de [nombre] a [nuevo valor]?"
4. Solo llama a "editar_empleado" tras recibir confirmación del usuario.

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
              enum: ['lotes', 'siembras', 'grupos', 'scheduled_tasks', 'productos', 'users', 'materiales_siembra', 'packages'],
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
      {
        name: 'registrar_horimetro',
        description: 'Registra un nuevo registro de horímetro (uso de maquinaria). Úsala cuando el usuario proporcione los datos de un registro de horímetro por texto o voz. Requiere al menos fecha y tractorId.',
        input_schema: {
          type: 'object',
          properties: {
            fecha:             { type: 'string', description: 'Fecha del registro en formato YYYY-MM-DD. Default: hoy.' },
            tractorId:         { type: 'string', description: 'ID interno del tractor (del catálogo de maquinaria).' },
            tractorNombre:     { type: 'string', description: 'Nombre/descripción del tractor.' },
            implemento:        { type: 'string', description: 'Nombre del implemento (descripcion del activo), opcional.' },
            horimetroInicial:  { type: 'number', description: 'Lectura inicial del horímetro, opcional.' },
            horimetroFinal:    { type: 'number', description: 'Lectura final del horímetro, opcional.' },
            loteId:            { type: 'string', description: 'ID interno del lote, opcional.' },
            loteNombre:        { type: 'string', description: 'Nombre del lote, opcional.' },
            grupo:             { type: 'string', description: 'Nombre del grupo (nombreGrupo), requerido si se proporciona lote.' },
            bloques:           { type: 'array', items: { type: 'string' }, description: 'Lista de bloques trabajados, opcional.' },
            labor:             { type: 'string', description: 'Descripción de la labor realizada (no el código, sino la descripción del catálogo).' },
            horaInicio:        { type: 'string', description: 'Hora de inicio en formato HH:MM (24h).' },
            horaFinal:         { type: 'string', description: 'Hora final en formato HH:MM (24h).' },
            operarioId:        { type: 'string', description: 'ID del operario, opcional.' },
            operarioNombre:    { type: 'string', description: 'Nombre del operario, opcional.' },
          },
          required: ['fecha', 'tractorId', 'tractorNombre'],
        },
      },
      {
        name: 'editar_producto',
        description: 'Edita un campo de un producto del inventario de bodega (excepto el stock actual). Úsala cuando el usuario pida cambiar el nombre, ingrediente activo, proveedor, tipo, dosis por hectárea, precio, etc.',
        input_schema: {
          type: 'object',
          properties: {
            productoId: { type: 'string', description: 'ID Firestore del producto.' },
            campo: { type: 'string', description: 'Campo técnico a editar: idProducto, nombreComercial, ingredienteActivo, tipo, plagaQueControla, cantidadPorHa, unidad, periodoReingreso, periodoACosecha, stockMinimo, precioUnitario, moneda, tipoCambio, proveedor.' },
            nuevoValor: { description: 'Nuevo valor para el campo.' },
          },
          required: ['productoId', 'campo', 'nuevoValor'],
        },
      },
      {
        name: 'ajustar_stock',
        description: 'Ajusta el stock actual de un producto del inventario. Genera un movimiento de inventario. Requiere una nota explicativa obligatoria.',
        input_schema: {
          type: 'object',
          properties: {
            productoId: { type: 'string', description: 'ID Firestore del producto.' },
            stockNuevo: { type: 'number', description: 'Nuevo valor del stock.' },
            nota: { type: 'string', description: 'Nota explicativa del ajuste (obligatoria, ej: conteo físico, pérdida, corrección).' },
          },
          required: ['productoId', 'stockNuevo', 'nota'],
        },
      },
      {
        name: 'previsualizar_horimetro',
        description: 'Extrae TODAS las filas de un formulario de horímetro desde una imagen para que el usuario las revise antes de guardar. Úsala SIEMPRE cuando el usuario envíe una imagen. Puede haber una o varias filas. NO guarda nada en la base de datos.',
        input_schema: {
          type: 'object',
          properties: {
            filas: {
              type: 'array',
              description: 'Lista de registros extraídos del formulario. Cada fila es un registro independiente.',
              items: {
                type: 'object',
                properties: {
                  fecha:             { type: 'string', description: 'Fecha en formato YYYY-MM-DD.' },
                  tractorId:         { type: 'string', description: 'ID interno del tractor.' },
                  tractorNombre:     { type: 'string', description: 'Nombre/descripción del tractor.' },
                  implemento:        { type: 'string', description: 'Nombre del implemento, opcional.' },
                  horimetroInicial:  { type: 'number', description: 'Lectura inicial, opcional.' },
                  horimetroFinal:    { type: 'number', description: 'Lectura final, opcional.' },
                  loteId:            { type: 'string', description: 'ID del lote, opcional.' },
                  loteNombre:        { type: 'string', description: 'Nombre del lote, opcional.' },
                  grupo:             { type: 'string', description: 'Nombre del grupo, opcional.' },
                  bloques:           { type: 'array', items: { type: 'string' }, description: 'Bloques, opcional.' },
                  labor:             { type: 'string', description: 'Descripción de la labor, opcional.' },
                  horaInicio:        { type: 'string', description: 'Hora inicio HH:MM (24h), opcional.' },
                  horaFinal:         { type: 'string', description: 'Hora final HH:MM (24h), opcional.' },
                  operarioId:        { type: 'string', description: 'ID del operario, opcional.' },
                  operarioNombre:    { type: 'string', description: 'Nombre del operario, opcional.' },
                },
                required: ['fecha', 'tractorId', 'tractorNombre'],
              },
            },
          },
          required: ['filas'],
        },
      },
      {
      name: 'registrar_permiso',
      description: 'Registra un permiso, ausencia o vacaciones para un trabajador. Puede ser parcial (por horas) o de días completos. Si no se especifica horaFin para un permiso parcial, el sistema la tomará automáticamente del horario semanal del trabajador.',
      input_schema: {
        type: 'object',
        properties: {
          trabajadorId:     { type: 'string', description: 'ID Firestore del trabajador.' },
          trabajadorNombre: { type: 'string', description: 'Nombre completo del trabajador.' },
          tipo: {
            type: 'string',
            enum: ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'],
            description: 'Tipo de permiso.',
          },
          conGoce:    { type: 'boolean', description: 'true = con goce de salario, false = sin goce de salario.' },
          fechaInicio: { type: 'string', description: 'Fecha del permiso en formato YYYY-MM-DD.' },
          esParcial:  { type: 'boolean', description: 'true si el permiso es por horas (parcial), false si es de día(s) completo(s).' },
          horaInicio: { type: 'string', description: 'Hora de inicio HH:MM (24h). Solo para permisos parciales.' },
          horaFin:    { type: 'string', description: 'Hora de fin HH:MM (24h). Solo para permisos parciales. Si se omite, se tomará del horario del trabajador.' },
          fechaFin:   { type: 'string', description: 'Fecha de fin YYYY-MM-DD. Solo para permisos de días completos con rango. Si se omite, se usa fechaInicio.' },
          motivo:     { type: 'string', description: 'Motivo o descripción breve del permiso (opcional).' },
        },
        required: ['trabajadorId', 'trabajadorNombre', 'tipo', 'conGoce', 'fechaInicio', 'esParcial'],
      },
    },
      {
        name: 'crear_recordatorio',
        description: 'Crea un recordatorio personal y privado para el usuario actual. Solo él podrá verlo. Úsala cuando el usuario pida que se le recuerde algo en una fecha/hora futura.',
        input_schema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Qué debe recordarle al usuario. Redáctalo como una nota clara, ej: "Revisar la fruta del lote 7".' },
            remindAt: { type: 'string', description: 'Fecha y hora del recordatorio en formato ISO 8601 (YYYY-MM-DDTHH:MM:00). Si el usuario no especifica hora, usa T07:00:00.' },
          },
          required: ['message', 'remindAt'],
        },
      },
      {
        name: 'listar_recordatorios',
        description: 'Lista todos los recordatorios pendientes del usuario actual. Úsala cuando el usuario pregunte por sus recordatorios.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'eliminar_recordatorio',
        description: 'Elimina un recordatorio del usuario. Úsala cuando el usuario pida cancelar o borrar un recordatorio específico.',
        input_schema: {
          type: 'object',
          properties: {
            reminderId: { type: 'string', description: 'ID del recordatorio a eliminar.' },
          },
          required: ['reminderId'],
        },
      },
      {
        name: 'previsualizar_planilla',
        description: 'Extrae los datos de una planilla de trabajadores (por hora o por unidad) desde una imagen para que el usuario revise y confirme antes de guardar. Úsala SIEMPRE cuando el usuario adjunte una imagen de un formulario físico de planilla. NO guarda nada en la base de datos.',
        input_schema: {
          type: 'object',
          properties: {
            fecha:           { type: 'string', description: 'Fecha de la planilla en formato YYYY-MM-DD.' },
            encargadoId:     { type: 'string', description: 'ID del encargado en el sistema (resuelto por nombre aproximado del catálogo de usuarios).' },
            encargadoNombre: { type: 'string', description: 'Nombre del encargado tal como aparece en el formulario.' },
            segmentos: {
              type: 'array',
              description: 'Columnas de trabajo de la planilla, de izquierda a derecha. El índice de cada segmento en este array (0, 1, 2…) es su posición de columna.',
              items: {
                type: 'object',
                properties: {
                  loteId:        { type: 'string', description: 'ID del lote en el sistema.' },
                  loteNombre:    { type: 'string', description: 'Nombre del lote.' },
                  labor:         { type: 'string', description: 'Labor en formato "codigo - descripción".' },
                  grupo:         { type: 'string', description: 'Nombre del grupo, opcional.' },
                  avanceHa:      { type: 'string', description: 'Avance (número como string), opcional.' },
                  unidad:        { type: 'string', description: 'Unidad de medida, opcional.' },
                  costoUnitario: { type: 'string', description: 'Costo unitario (número como string), opcional.' },
                },
              },
            },
            trabajadores: {
              type: 'array',
              description: 'Lista de trabajadores. Las cantidades son un array posicional: cantidades[0] es la cantidad del segmento 0 (primera columna), cantidades[1] del segmento 1, etc. Usa "" si el trabajador no trabajó esa columna.',
              items: {
                type: 'object',
                properties: {
                  trabajadorId:     { type: 'string', description: 'ID del trabajador en el sistema.' },
                  trabajadorNombre: { type: 'string', description: 'Nombre del trabajador.' },
                  cantidades: {
                    type: 'array',
                    description: 'Array posicional de cantidades, una por columna en el mismo orden que segmentos. Ej: si hay 4 columnas y el trabajador trabajó 8 horas en la columna 2: ["", "", "8", ""].',
                    items: { type: 'string' },
                  },
                },
                required: ['trabajadorNombre', 'cantidades'],
              },
            },
            observaciones: { type: 'string', description: 'Observaciones o notas del formulario, opcional.' },
          },
          required: ['fecha'],
        },
      },
      {
        name: 'crear_empleado',
        description: 'Crea un nuevo empleado/usuario en el sistema. Úsala cuando el usuario pida agregar o registrar un nuevo trabajador. SIEMPRE pide confirmación antes de llamar esta herramienta.',
        input_schema: {
          type: 'object',
          properties: {
            nombre:           { type: 'string', description: 'Nombre completo del empleado.' },
            email:            { type: 'string', description: 'Correo electrónico del empleado.' },
            telefono:         { type: 'string', description: 'Número de teléfono (opcional).' },
            rol:              { type: 'string', enum: ['trabajador', 'encargado', 'supervisor', 'administrador'], description: 'Rol del usuario en el sistema. OBLIGATORIO.' },
            empleadoPlanilla: { type: 'boolean', description: 'true si el empleado debe recibir pago de planilla.' },
          },
          required: ['nombre', 'email', 'rol'],
        },
      },
      {
        name: 'editar_empleado',
        description: 'Modifica los datos de un empleado existente (nombre, email, teléfono, rol o estado de planilla). SIEMPRE pide confirmación antes de llamar esta herramienta.',
        input_schema: {
          type: 'object',
          properties: {
            empleadoId:       { type: 'string', description: 'ID Firestore del empleado a modificar.' },
            nombre:           { type: 'string', description: 'Nuevo nombre completo (opcional).' },
            email:            { type: 'string', description: 'Nuevo correo electrónico (opcional).' },
            telefono:         { type: 'string', description: 'Nuevo número de teléfono (opcional).' },
            rol:              { type: 'string', enum: ['trabajador', 'encargado', 'supervisor', 'administrador'], description: 'Nuevo rol en el sistema (opcional).' },
            empleadoPlanilla: { type: 'boolean', description: 'Nuevo estado de planilla: true = asignado, false = no asignado (opcional).' },
          },
          required: ['empleadoId'],
        },
      },
    ];

    // Construir historial de conversación
    const messages = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const h of history) {
        if (h.role !== 'user' && h.role !== 'assistant') continue;
        if (!h.text) continue;
        // Asegurar alternancia: si el último rol es igual al entrante, fusionar
        const last = messages[messages.length - 1];
        if (last && last.role === h.role) continue;
        messages.push({ role: h.role, content: [{ type: 'text', text: h.text }] });
      }
    }

    // Construir mensaje actual del usuario
    const userContent = [];
    if (imageBase64 && mediaType) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } });
    }
    userContent.push({ type: 'text', text: message || 'Ayúdame con esta información.' });

    // Anthropic exige que el primer mensaje sea de rol 'user'
    if (messages.length > 0 && messages[0].role !== 'user') messages.shift();

    messages.push({ role: 'user', content: userContent });

    // Loop agéntico: máximo 6 iteraciones para evitar loops infinitos
    let horimetroDraft = null;
    let planillaDraft = null;
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
        const responsePayload = { reply: text };
        if (horimetroDraft) responsePayload.horimetroDraft = horimetroDraft;
        if (planillaDraft) responsePayload.planillaDraft = planillaDraft;
        return res.json(responsePayload);
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
          } else if (block.name === 'registrar_horimetro') {
            result = await chatToolRegistrarHorimetro(block.input, req.fincaId);
          } else if (block.name === 'editar_producto') {
            const { productoId, campo, nuevoValor } = block.input;
            const CAMPOS_EDITABLES = ['idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo', 'plagaQueControla', 'cantidadPorHa', 'unidad', 'periodoReingreso', 'periodoACosecha', 'stockMinimo', 'precioUnitario', 'moneda', 'tipoCambio', 'proveedor'];
            if (!CAMPOS_EDITABLES.includes(campo)) {
              result = { error: `Campo "${campo}" no permitido. Para ajustar el stock usa ajustar_stock.` };
            } else {
              const ownership = await verifyOwnership('productos', productoId, req.fincaId);
              if (!ownership.ok) {
                result = { error: ownership.message };
              } else {
                const oldValue = ownership.doc.data()[campo];
                await db.collection('productos').doc(productoId).update({ [campo]: nuevoValor });
                result = { ok: true, productoNombre: ownership.doc.data().nombreComercial, campo, oldValue: oldValue ?? null, newValue: nuevoValor };
              }
            }
          } else if (block.name === 'ajustar_stock') {
            const { productoId, stockNuevo, nota } = block.input;
            if (!nota?.trim()) {
              result = { error: 'La nota explicativa es obligatoria para ajustar el stock.' };
            } else {
              const ownership = await verifyOwnership('productos', productoId, req.fincaId);
              if (!ownership.ok) {
                result = { error: ownership.message };
              } else {
                const stockAnterior = ownership.doc.data().stockActual ?? 0;
                const stockNuevoNum = parseFloat(stockNuevo);
                if (isNaN(stockNuevoNum) || stockNuevoNum < 0) {
                  result = { error: 'El stock debe ser un número mayor o igual a 0.' };
                } else if (Math.abs(stockNuevoNum - stockAnterior) < 0.001) {
                  result = { ok: true, mensaje: 'El stock ya tiene ese valor, no se realizó ningún cambio.' };
                } else {
                  const batch = db.batch();
                  batch.update(db.collection('productos').doc(productoId), { stockActual: stockNuevoNum });
                  batch.set(db.collection('movimientos').doc(), {
                    fincaId: req.fincaId, productoId,
                    tipo: 'ajuste',
                    cantidad: stockNuevoNum - stockAnterior,
                    stockAnterior, stockNuevo: stockNuevoNum,
                    nota: nota.trim(),
                    fecha: new Date(),
                  });
                  await batch.commit();
                  result = { ok: true, productoNombre: ownership.doc.data().nombreComercial, stockAnterior, stockNuevo: stockNuevoNum, diferencia: stockNuevoNum - stockAnterior };
                }
              }
            }
          } else if (block.name === 'previsualizar_horimetro') {
            const allowed = ['fecha', 'tractorId', 'tractorNombre', 'implemento', 'horimetroInicial', 'horimetroFinal', 'loteId', 'loteNombre', 'grupo', 'bloques', 'labor', 'horaInicio', 'horaFinal', 'operarioId', 'operarioNombre'];
            const filas = Array.isArray(block.input.filas) ? block.input.filas : [block.input];
            horimetroDraft = filas.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => allowed.includes(k))));
            result = { preview: true, filas: horimetroDraft.length, mensaje: 'Datos extraídos. El sistema mostrará una tarjeta al usuario para confirmar o editar antes de guardar.' };
          } else if (block.name === 'previsualizar_planilla') {
            // Assign real segment IDs and map positional cantidades array → { segId: value }
            const rawSegs = Array.isArray(block.input.segmentos) ? block.input.segmentos : [];
            const segmentos = rawSegs.map(s => ({
              id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
              loteId: s.loteId || '', loteNombre: s.loteNombre || '',
              labor: s.labor || '', grupo: s.grupo || '',
              avanceHa: s.avanceHa || '', unidad: s.unidad || '',
              costoUnitario: s.costoUnitario || '',
            }));
            const trabajadores = (Array.isArray(block.input.trabajadores) ? block.input.trabajadores : []).map(t => {
              const arr = Array.isArray(t.cantidades) ? t.cantidades : [];
              const cantidades = {};
              segmentos.forEach((seg, idx) => { cantidades[seg.id] = String(arr[idx] ?? ''); });
              return { trabajadorId: t.trabajadorId || '', trabajadorNombre: t.trabajadorNombre || '', cantidades };
            });
            planillaDraft = {
              fecha:           block.input.fecha || '',
              encargadoId:     block.input.encargadoId || '',
              encargadoNombre: block.input.encargadoNombre || '',
              segmentos, trabajadores,
              observaciones:   block.input.observaciones || '',
            };
            result = { preview: true, segmentos: segmentos.length, trabajadores: trabajadores.length, mensaje: 'Datos extraídos. El sistema mostrará una tarjeta al usuario para confirmar o editar antes de guardar.' };
          } else if (block.name === 'crear_empleado') {
            result = await chatToolCrearEmpleado(block.input, req.fincaId);
          } else if (block.name === 'editar_empleado') {
            result = await chatToolEditarEmpleado(block.input, req.fincaId);
          } else if (block.name === 'registrar_permiso') {
            result = await chatToolRegistrarPermiso(block.input, req.fincaId);
          } else if (block.name === 'crear_recordatorio') {
            const { message: rMsg, remindAt: rAt } = block.input;
            if (!rMsg?.trim() || !rAt) {
              result = { error: 'Se requieren message y remindAt.' };
            } else {
              // Si Claude devuelve hora local sin offset (ej: "2026-03-17T08:40:00"),
              // el servidor UTC lo interpretaría como UTC. Corregimos usando el offset del cliente.
              const remindDate = /Z$|[+-]\d{2}:\d{2}$/.test(rAt)
                ? new Date(rAt)
                : new Date(new Date(rAt + 'Z').getTime() + (Number(clientTzOffset) || 0) * 60 * 1000);
              if (isNaN(remindDate.getTime())) {
                result = { error: 'Fecha inválida.' };
              } else {
                const docRef = await db.collection('reminders').add({
                  uid: req.uid,
                  fincaId: req.fincaId,
                  message: rMsg.trim(),
                  remindAt: Timestamp.fromDate(remindDate),
                  status: 'pending',
                  createdAt: Timestamp.now(),
                });
                result = { ok: true, id: docRef.id, message: rMsg.trim(), remindAt: remindDate.toISOString() };
              }
            }
          } else if (block.name === 'listar_recordatorios') {
            const rSnap = await db.collection('reminders')
              .where('uid', '==', req.uid)
              .where('fincaId', '==', req.fincaId)
              .where('status', '==', 'pending')
              .get();
            const rList = rSnap.docs
              .map(d => ({ id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() }))
              .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
            result = { total: rList.length, recordatorios: rList };
          } else if (block.name === 'eliminar_recordatorio') {
            const { reminderId } = block.input;
            const rDoc = await db.collection('reminders').doc(reminderId).get();
            if (!rDoc.exists || rDoc.data().uid !== req.uid) {
              result = { error: 'Recordatorio no encontrado o sin permiso.' };
            } else {
              await db.collection('reminders').doc(reminderId).delete();
              result = { ok: true };
            }
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

// --- API ENDPOINTS: RECORDATORIOS PERSONALES ---

// GET /api/reminders/due — recordatorios vencidos (remindAt <= ahora), los marca como entregados
app.get('/api/reminders/due', authenticate, async (req, res) => {
  try {
    const now = new Date();
    // Sin filtro de rango en Firestore (requeriría índice compuesto); se filtra en JS
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
      .get();
    const dueDocs = snap.docs.filter(d => {
      const remindAt = d.data().remindAt?.toDate?.();
      return remindAt && remindAt <= now;
    });
    if (!dueDocs.length) return res.json([]);
    const batch = db.batch();
    const reminders = dueDocs.map(d => {
      batch.update(d.ref, { status: 'delivered' });
      return { id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() };
    });
    await batch.commit();
    res.json(reminders);
  } catch (err) {
    console.error('Error al obtener recordatorios vencidos:', err);
    res.status(500).json({ message: 'Error al obtener recordatorios.' });
  }
});

// GET /api/reminders — lista todos los recordatorios pendientes del usuario
app.get('/api/reminders', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
      .get();
    const reminders = snap.docs
      .map(d => ({ id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() }))
      .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
    res.json(reminders);
  } catch (err) {
    console.error('Error al obtener recordatorios:', err);
    res.status(500).json({ message: 'Error al obtener recordatorios.' });
  }
});

// POST /api/reminders — crea un recordatorio personal
app.post('/api/reminders', authenticate, async (req, res) => {
  try {
    const { message, remindAt } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'El mensaje es requerido.' });
    if (!remindAt) return res.status(400).json({ message: 'La fecha del recordatorio es requerida.' });
    const remindDate = new Date(remindAt);
    if (isNaN(remindDate.getTime())) return res.status(400).json({ message: 'Fecha inválida.' });
    const docRef = await db.collection('reminders').add({
      uid: req.uid,
      fincaId: req.fincaId,
      message: message.trim(),
      remindAt: Timestamp.fromDate(remindDate),
      status: 'pending',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: docRef.id, message: message.trim(), remindAt: remindDate.toISOString() });
  } catch (err) {
    console.error('Error al crear recordatorio:', err);
    res.status(500).json({ message: 'Error al crear el recordatorio.' });
  }
});

// DELETE /api/reminders/:id — elimina un recordatorio
app.delete('/api/reminders/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('reminders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Recordatorio no encontrado.' });
    if (doc.data().uid !== req.uid) return res.status(403).json({ message: 'Acceso no autorizado.' });
    await db.collection('reminders').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar recordatorio:', err);
    res.status(500).json({ message: 'Error al eliminar el recordatorio.' });
  }
});

// --- API ENDPOINTS: HORÍMETRO ---
app.get('/api/horimetro', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('horimetro')
      .where('fincaId', '==', req.fincaId)
      .get();
    const records = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.status(200).json(records);
  } catch (error) {
    console.error('Error al obtener horímetro:', error);
    res.status(500).json({ message: 'Error al obtener los registros.' });
  }
});

app.post('/api/horimetro', authenticate, async (req, res) => {
  try {
    const allowed = [
      'fecha', 'tractorId', 'tractorNombre', 'implemento',
      'horimetroInicial', 'horimetroFinal',
      'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
      'horaInicio', 'horaFinal', 'operarioId', 'operarioNombre',
    ];
    const data = pick(req.body, allowed);
    if (!data.fecha || !data.tractorId) {
      return res.status(400).json({ message: 'Fecha y tractor son obligatorios.' });
    }
    const ref = await db.collection('horimetro').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, ...data });
  } catch (error) {
    console.error('Error al crear horímetro:', error);
    res.status(500).json({ message: 'Error al guardar el registro.' });
  }
});

app.put('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const allowed = [
      'fecha', 'tractorId', 'tractorNombre', 'implemento',
      'horimetroInicial', 'horimetroFinal',
      'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
      'horaInicio', 'horaFinal', 'operarioId', 'operarioNombre',
    ];
    const data = pick(req.body, allowed);
    await db.collection('horimetro').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error al actualizar horímetro:', error);
    res.status(500).json({ message: 'Error al actualizar el registro.' });
  }
});

app.delete('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('horimetro').doc(id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    console.error('Error al eliminar horímetro:', error);
    res.status(500).json({ message: 'Error al eliminar el registro.' });
  }
});

app.post('/api/horimetro/escanear', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ message: 'Imagen requerida.' });

    if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });

    const [maqSnap, lotesSnap, gruposSnap, siembrasSnap, laboresSnap, usersSnap] = await Promise.all([
      db.collection('maquinaria').where('fincaId', '==', req.fincaId).get(),
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('grupos').where('fincaId', '==', req.fincaId).get(),
      db.collection('siembras').where('fincaId', '==', req.fincaId).get(),
      db.collection('labores').where('fincaId', '==', req.fincaId).get(),
      db.collection('users').where('fincaId', '==', req.fincaId).get(),
    ]);

    const maq = maqSnap.docs.map(d => ({ id: d.id, ...pick(d.data(), ['idMaquina', 'codigo', 'descripcion', 'tipo']) }));
    const tractores  = maq.filter(m => /tractor|otra maquinaria/i.test(m.tipo));
    const implementos = maq.filter(m => /implemento/i.test(m.tipo));
    const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombreLote: d.data().nombreLote || '', codigoLote: d.data().codigoLote || '' }));
    const siembraMap = {};
    siembrasSnap.docs.forEach(d => { siembraMap[d.id] = { loteNombre: d.data().loteNombre || '' }; });
    const grupos = gruposSnap.docs.map(d => {
      const g = d.data();
      const lotesGrupo = [...new Set((g.bloques || []).map(bid => siembraMap[bid]?.loteNombre).filter(Boolean))];
      return { id: d.id, nombreGrupo: g.nombreGrupo || '', lotes: lotesGrupo };
    });
    const labores   = laboresSnap.docs.map(d => ({ id: d.id, codigo: d.data().codigo || '', descripcion: d.data().descripcion || '' }));
    const operarios = usersSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || '' }));
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de horímetro de maquinaria.

TRACTORES:
${tractores.map(t => `ID:"${t.id}"|Código:"${t.codigo}"|IDActivo:"${t.idMaquina}"|Nombre:"${t.descripcion}"`).join('\n') || '(ninguno)'}

IMPLEMENTOS:
${implementos.map(t => `ID:"${t.id}"|Código:"${t.codigo}"|IDActivo:"${t.idMaquina}"|Nombre:"${t.descripcion}"`).join('\n') || '(ninguno)'}

LOTES:
${lotes.map(l => `ID:"${l.id}"|Código:"${l.codigoLote}"|Nombre:"${l.nombreLote}"`).join('\n') || '(ninguno)'}

GRUPOS:
${grupos.map(g => `ID:"${g.id}"|Nombre:"${g.nombreGrupo}"|Lotes:[${g.lotes.join(',')}]`).join('\n') || '(ninguno)'}

LABORES:
${labores.map(l => `ID:"${l.id}"|Código:"${l.codigo}"|Desc:"${l.descripcion}"`).join('\n') || '(ninguno)'}

OPERARIOS:
${operarios.map(u => `ID:"${u.id}"|Nombre:"${u.nombre}"`).join('\n') || '(ninguno)'}

Extrae cada fila del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "fecha": "YYYY-MM-DD (busca la fecha en el encabezado; si no aparece usa ${today})",
    "tractorId": "ID del tractor del catálogo o null",
    "tractorNombre": "nombre del tractor tal como aparece o del catálogo si coincide",
    "implemento": "nombre del implemento del catálogo si coincide, o texto del formulario, o cadena vacía",
    "horimetroInicial": número o null,
    "horimetroFinal": número o null,
    "loteId": "ID del lote si coincide, o null",
    "loteNombre": "nombre del lote tal como aparece",
    "grupo": "nombreGrupo del catálogo si coincide, o texto del formulario, o cadena vacía",
    "bloques": [],
    "labor": "descripción de la labor del catálogo si coincide, o texto del formulario, o cadena vacía",
    "horaInicio": "HH:MM en 24h, o cadena vacía",
    "horaFinal": "HH:MM en 24h, o cadena vacía",
    "operarioId": "ID del operario si coincide, o null",
    "operarioNombre": "nombre del operario tal como aparece"
  }
]
Reglas:
1. Cada fila del formulario es un objeto separado en el arreglo.
2. horimetroInicial y horimetroFinal deben ser números (float), no cadenas. Usa null si no aparece.
3. Horas en formato 24h: "5am"→"05:00", "2pm"→"14:00".
4. Si hay una fecha común en el encabezado, aplícala a todas las filas.
5. Resuelve tractor, lote, grupo, labor y operario usando coincidencia aproximada con los catálogos.
6. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ] }],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const filas = JSON.parse(jsonText);
    res.json({ filas });
  } catch (error) {
    console.error('Error escaneando horímetro:', error);
    res.status(500).json({ message: 'Error al procesar la imagen.' });
  }
});

// ── Unidades de Medida ─────────────────────────────────────────────────────
app.get('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener unidades de medida.' });
  }
});

app.post('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
    const data = {
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      fincaId: req.fincaId,
    };
    // Upsert by nombre
    const existing = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .where('nombre', '==', data.nombre)
      .limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const { fincaId, ...updateData } = data;
      await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
      return res.status(200).json({ id: doc.id, merged: true });
    }
    data.creadoEn = Timestamp.now();
    const ref = await db.collection('unidades_medida').add(data);
    res.status(201).json({ id: ref.id, merged: false });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear unidad de medida.' });
  }
});

app.put('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
    await db.collection('unidades_medida').doc(req.params.id).update({
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      actualizadoEn:    Timestamp.now(),
    });
    res.status(200).json({ message: 'Unidad actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar unidad de medida.' });
  }
});

app.delete('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('unidades_medida').doc(req.params.id).delete();
    res.status(200).json({ message: 'Unidad eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar unidad de medida.' });
  }
});

// ── Labores ────────────────────────────────────────────────────────────────
app.get('/api/labores', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('labores')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (parseInt(a.codigo) || 0) - (parseInt(b.codigo) || 0));
    res.json(items);
  } catch (error) {
    console.error('Error al obtener labores:', error);
    res.status(500).json({ message: 'Error al obtener labores.' });
  }
});

app.post('/api/labores', authenticate, async (req, res) => {
  try {
    const allowed = ['codigo', 'descripcion', 'observacion'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    data.fincaId = req.fincaId;
    // Upsert by código if provided
    if (data.codigo) {
      const existing = await db.collection('labores')
        .where('fincaId', '==', req.fincaId)
        .where('codigo', '==', data.codigo)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        const { fincaId, ...updateData } = data;
        await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    data.creadoEn = Timestamp.now();
    const doc = await db.collection('labores').add(data);
    res.status(201).json({ id: doc.id, merged: false });
  } catch (error) {
    console.error('Error al crear labor:', error);
    res.status(500).json({ message: 'Error al crear labor.' });
  }
});

app.put('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const allowed = ['codigo', 'descripcion', 'observacion'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    await db.collection('labores').doc(req.params.id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.json({ message: 'Labor actualizada.' });
  } catch (error) {
    console.error('Error al actualizar labor:', error);
    res.status(500).json({ message: 'Error al actualizar labor.' });
  }
});

app.delete('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('labores').doc(req.params.id).delete();
    res.json({ message: 'Labor eliminada.' });
  } catch (error) {
    console.error('Error al eliminar labor:', error);
    res.status(500).json({ message: 'Error al eliminar labor.' });
  }
});

// --- API ENDPOINTS: WEB PUSH ---

// GET /api/push/vapid-public-key — devuelve la clave pública VAPID al cliente
app.get('/api/push/vapid-public-key', authenticate, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — guarda la suscripción push del usuario
app.post('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ message: 'Suscripción inválida.' });
    // Upsert: usamos el endpoint como ID del doc (en base64 para evitar chars inválidos)
    const docId = Buffer.from(subscription.endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).set({
      uid: req.uid,
      fincaId: req.fincaId,
      subscription,
      updatedAt: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando suscripción push:', err);
    res.status(500).json({ message: 'Error al guardar la suscripción.' });
  }
});

// DELETE /api/push/subscribe — elimina la suscripción push del usuario
app.delete('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'endpoint requerido.' });
    const docId = Buffer.from(endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando suscripción push:', err);
    res.status(500).json({ message: 'Error al eliminar la suscripción.' });
  }
});

// ─── CALIBRACIONES ────────────────────────────────────────────────────────────

app.get('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('calibraciones')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .get();
    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(items);
  } catch (err) {
    console.error('Error al obtener calibraciones:', err);
    res.status(500).json({ message: 'Error al obtener calibraciones.' });
  }
});

app.post('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    if (!data.nombre?.trim()) {
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }
    const doc = { ...data, fincaId: req.fincaId, creadoEn: Timestamp.now() };
    const ref = await db.collection('calibraciones').add(doc);
    res.status(201).json({ id: ref.id, ...doc });
  } catch (err) {
    console.error('Error al crear calibración:', err);
    res.status(500).json({ message: 'Error al crear la calibración.' });
  }
});

app.put('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    await db.collection('calibraciones').doc(req.params.id).update(data);
    res.status(200).json({ id: req.params.id, ...data });
  } catch (err) {
    console.error('Error al actualizar calibración:', err);
    res.status(500).json({ message: 'Error al actualizar la calibración.' });
  }
});

app.delete('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('calibraciones').doc(req.params.id).delete();
    res.status(200).json({ message: 'Calibración eliminada.' });
  } catch (err) {
    console.error('Error al eliminar calibración:', err);
    res.status(500).json({ message: 'Error al eliminar la calibración.' });
  }
});

// Se exporta la app de Express, inyectando los secretos necesarios.
exports.api = functions.runWith({
  secrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, anthropicApiKey, vapidPublicKey, vapidPrivateKey]
}).https.onRequest(app);

// --- FUNCIÓN PROGRAMADA: ENVIAR PUSH DE RECORDATORIOS VENCIDOS ---
// Se ejecuta cada 5 minutos y envía notificaciones push a usuarios con recordatorios vencidos.
exports.sendDuePushReminders = functions.runWith({
  secrets: [vapidPublicKey, vapidPrivateKey]
}).pubsub.schedule('every 5 minutes').onRun(async () => {
  const VAPID_SUBJECT = 'mailto:aurora@finca.com';
  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const now = new Date();
  // Buscar recordatorios pendientes cuyo remindAt ya pasó
  const snap = await db.collection('reminders')
    .where('status', '==', 'pending')
    .get();

  const due = snap.docs.filter(d => {
    const remindAt = d.data().remindAt?.toDate?.();
    return remindAt && remindAt <= now;
  });

  if (!due.length) return null;

  for (const doc of due) {
    const { uid, fincaId, message } = doc.data();
    // Marcar como entregado
    await doc.ref.update({ status: 'delivered' });

    // Buscar suscripciones push del usuario
    const subSnap = await db.collection('push_subscriptions')
      .where('uid', '==', uid)
      .where('fincaId', '==', fincaId)
      .get();

    const payload = JSON.stringify({
      title: 'Recordatorio — Aurora',
      body: message,
      icon: '/aurora-logo.png',
      badge: '/aurora-logo.png',
      data: { url: '/' },
    });

    for (const subDoc of subSnap.docs) {
      try {
        await webpush.sendNotification(subDoc.data().subscription, payload);
      } catch (err) {
        // Suscripción expirada o inválida — limpiar
        if (err.statusCode === 410 || err.statusCode === 404) {
          await subDoc.ref.delete();
        } else {
          console.error('Error enviando push:', err.message);
        }
      }
    }
  }
  return null;
});
