const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { getTwilioClient } = require('../lib/clients');
const { twilioWhatsappFrom } = require('../lib/firebase');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: RECURSOS HUMANOS
// ─────────────────────────────────────────────────────────────────────────────

// ── Fichas del Trabajador ────────────────────────────────────────────────────
const FICHA_TIPOS_CONTRATO = ['permanente', 'temporal', 'por_obra'];
const FICHA_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const PHONE_RE_FICHA = /^[\d\s+\-()]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FICHA_LIMITS = {
  puesto: 80, departamento: 80, cedula: 30, direccion: 200,
  contactoEmergencia: 80, telefonoEmergencia: 20, notas: 2000,
};
const FICHA_SALARIO_MAX = 10_000_000;

function validateFichaPayload(body) {
  const allowed = [
    'puesto', 'departamento', 'fechaIngreso', 'tipoContrato',
    'salarioBase', 'precioHora', 'cedula', 'encargadoId',
    'direccion', 'contactoEmergencia', 'telefonoEmergencia',
    'notas', 'horarioSemanal',
  ];
  const clean = {};
  for (const k of allowed) if (body[k] !== undefined) clean[k] = body[k];

  const errs = [];
  for (const [k, max] of Object.entries(FICHA_LIMITS)) {
    if (typeof clean[k] === 'string') {
      clean[k] = clean[k].trim();
      if (clean[k].length > max) errs.push(`${k} excede ${max} caracteres.`);
    } else if (clean[k] != null) {
      errs.push(`${k} debe ser texto.`);
    }
  }
  if (typeof clean.telefonoEmergencia === 'string' && clean.telefonoEmergencia && !PHONE_RE_FICHA.test(clean.telefonoEmergencia)) {
    errs.push('Teléfono de emergencia inválido.');
  }

  if (clean.fechaIngreso !== undefined && clean.fechaIngreso !== '' && clean.fechaIngreso !== null) {
    if (typeof clean.fechaIngreso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clean.fechaIngreso)) {
      errs.push('Fecha de ingreso inválida.');
    } else {
      const d = new Date(clean.fechaIngreso);
      if (Number.isNaN(d.getTime())) errs.push('Fecha de ingreso inválida.');
    }
  }

  if (clean.tipoContrato != null && clean.tipoContrato !== '' && !FICHA_TIPOS_CONTRATO.includes(clean.tipoContrato)) {
    errs.push('Tipo de contrato inválido.');
  }

  for (const k of ['salarioBase', 'precioHora']) {
    if (clean[k] === '' || clean[k] == null) { clean[k] = null; continue; }
    const n = Number(clean[k]);
    if (!Number.isFinite(n) || n < 0 || n > FICHA_SALARIO_MAX) {
      errs.push(`${k} debe ser un número entre 0 y ${FICHA_SALARIO_MAX}.`);
    } else {
      clean[k] = n;
    }
  }

  if (clean.encargadoId != null && typeof clean.encargadoId !== 'string') {
    errs.push('encargadoId inválido.');
  }

  if (clean.horarioSemanal !== undefined) {
    if (clean.horarioSemanal == null || typeof clean.horarioSemanal !== 'object' || Array.isArray(clean.horarioSemanal)) {
      errs.push('horarioSemanal inválido.');
    } else {
      const norm = {};
      for (const d of FICHA_DIAS) {
        const day = clean.horarioSemanal[d];
        const activo = !!(day && day.activo === true);
        const inicio = day && typeof day.inicio === 'string' ? day.inicio : '';
        const fin = day && typeof day.fin === 'string' ? day.fin : '';
        if (activo) {
          if (!TIME_RE.test(inicio) || !TIME_RE.test(fin)) { errs.push(`Horario de ${d} inválido.`); continue; }
          const [h1, m1] = inicio.split(':').map(Number);
          const [h2, m2] = fin.split(':').map(Number);
          if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push(`Salida ≤ entrada en ${d}.`);
        }
        norm[d] = { activo, inicio, fin };
      }
      clean.horarioSemanal = norm;
    }
  }

  return { errs, clean };
}

router.get('/api/hr/fichas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId).get();
    const data = snap.docs.map(d => ({ userId: d.id, ...d.data() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener fichas.' });
  }
});

router.get('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    const doc = await db.collection('hr_fichas').doc(req.params.userId).get();
    if (!doc.exists) return res.status(200).json({});
    if (doc.data().fincaId && doc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener ficha.' });
  }
});

router.put('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    const { errs, clean } = validateFichaPayload(req.body || {});
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });
    if (clean.encargadoId) {
      const encDoc = await db.collection('users').doc(clean.encargadoId).get();
      if (!encDoc.exists || encDoc.data().fincaId !== req.fincaId) {
        return res.status(400).json({ message: 'Encargado no válido.' });
      }
    }
    await db.collection('hr_fichas').doc(req.params.userId).set(
      { ...clean, fincaId: req.fincaId, updatedAt: Timestamp.now() },
      { merge: true }
    );
    res.status(200).json({ message: 'Ficha actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar ficha.' });
  }
});

// ── Asistencia ───────────────────────────────────────────────────────────────
router.get('/api/hr/asistencia', authenticate, async (req, res) => {
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

router.post('/api/hr/asistencia', authenticate, async (req, res) => {
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

router.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar registro.' });
  }
});

// ── Horas Extra ──────────────────────────────────────────────────────────────
router.get('/api/hr/horas-extra', authenticate, async (req, res) => {
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

router.post('/api/hr/horas-extra', authenticate, async (req, res) => {
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

router.delete('/api/hr/horas-extra/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_horas_extra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Permisos y Vacaciones ────────────────────────────────────────────────────
const PERMISO_TIPOS = ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'];
const PERMISO_ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERMISO_MOTIVO_MAX = 500;
const PERMISO_NOMBRE_MAX = 120;

function validatePermisoPayload(body) {
  const errs = [];
  const clean = {};

  clean.trabajadorId = typeof body.trabajadorId === 'string' ? body.trabajadorId.trim() : '';
  if (!clean.trabajadorId) errs.push('Trabajador requerido.');

  clean.trabajadorNombre = typeof body.trabajadorNombre === 'string'
    ? body.trabajadorNombre.trim().slice(0, PERMISO_NOMBRE_MAX) : '';

  clean.tipo = typeof body.tipo === 'string' ? body.tipo : '';
  if (!PERMISO_TIPOS.includes(clean.tipo)) errs.push('Tipo inválido.');

  clean.fechaInicio = typeof body.fechaInicio === 'string' ? body.fechaInicio : '';
  if (!DATE_RE.test(clean.fechaInicio) || Number.isNaN(new Date(clean.fechaInicio).getTime())) {
    errs.push('Fecha inicio inválida.');
  }

  clean.esParcial = body.esParcial === true;

  let fechaFin = typeof body.fechaFin === 'string' ? body.fechaFin : clean.fechaInicio;
  if (clean.esParcial) fechaFin = clean.fechaInicio;
  if (!DATE_RE.test(fechaFin) || Number.isNaN(new Date(fechaFin).getTime())) {
    errs.push('Fecha fin inválida.');
  } else if (DATE_RE.test(clean.fechaInicio) && fechaFin < clean.fechaInicio) {
    errs.push('Fecha fin no puede ser anterior a fecha inicio.');
  }
  clean.fechaFin = fechaFin;

  if (clean.esParcial) {
    const hi = typeof body.horaInicio === 'string' ? body.horaInicio : '';
    const hf = typeof body.horaFin === 'string' ? body.horaFin : '';
    if (!TIME_RE.test(hi) || !TIME_RE.test(hf)) {
      errs.push('Hora inicio/fin inválida.');
    } else {
      const [h1, m1] = hi.split(':').map(Number);
      const [h2, m2] = hf.split(':').map(Number);
      if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push('Hora fin debe ser posterior a hora inicio.');
    }
    clean.horaInicio = hi;
    clean.horaFin = hf;
    const horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 24) errs.push('Horas debe estar entre 0 y 24.');
    clean.horas = Number.isFinite(horas) ? horas : 0;
    clean.dias = 0;
  } else {
    clean.horaInicio = null;
    clean.horaFin = null;
    clean.horas = 0;
    const dias = Number(body.dias);
    if (!Number.isFinite(dias) || dias < 1 || dias > 365) errs.push('Días debe estar entre 1 y 365.');
    clean.dias = Number.isFinite(dias) ? dias : 0;
  }

  clean.motivo = typeof body.motivo === 'string'
    ? body.motivo.trim().slice(0, PERMISO_MOTIVO_MAX) : '';

  clean.conGoce = body.conGoce !== false;

  return { errs, clean };
}

router.get('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_permisos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaInicio', 'desc').get();
    const data = snap.docs.map(d => {
      const dt = d.data();
      return {
        id: d.id, ...dt,
        fechaInicio: dt.fechaInicio?.toDate ? dt.fechaInicio.toDate().toISOString() : null,
        fechaFin:    dt.fechaFin?.toDate    ? dt.fechaFin.toDate().toISOString()    : null,
        createdAt:   dt.createdAt?.toDate   ? dt.createdAt.toDate().toISOString()   : null,
      };
    });
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener permisos.' });
  }
});

router.post('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const { errs, clean } = validatePermisoPayload(req.body || {});
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });

    const workerDoc = await db.collection('users').doc(clean.trabajadorId).get();
    if (!workerDoc.exists || workerDoc.data().fincaId !== req.fincaId) {
      return res.status(400).json({ message: 'Trabajador no válido.' });
    }

    const ref = await db.collection('hr_permisos').add({
      trabajadorId: clean.trabajadorId,
      trabajadorNombre: clean.trabajadorNombre || workerDoc.data().nombre || '',
      tipo: clean.tipo,
      fechaInicio: Timestamp.fromDate(new Date(clean.fechaInicio + 'T12:00:00')),
      fechaFin:    Timestamp.fromDate(new Date(clean.fechaFin    + 'T12:00:00')),
      dias: clean.dias,
      esParcial: clean.esParcial,
      horaInicio: clean.horaInicio,
      horaFin:    clean.horaFin,
      horas:      clean.horas,
      motivo: clean.motivo,
      conGoce: clean.conGoce,
      estado: 'pendiente',
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear permiso.' });
  }
});

router.put('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const estado = (req.body || {}).estado;
    if (!PERMISO_ESTADOS.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido.' });
    }
    if ((estado === 'aprobado' || estado === 'rechazado') && !hasMinRoleBE(req.userRole, 'supervisor')) {
      return res.status(403).json({ message: 'No tienes permisos para aprobar o rechazar.' });
    }

    await db.collection('hr_permisos').doc(req.params.id).update({
      estado, updatedAt: Timestamp.now(),
    });
    res.status(200).json({ message: 'Permiso actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar permiso.' });
  }
});

router.delete('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return res.status(403).json({ message: 'No tienes permisos para eliminar.' });
    }
    await db.collection('hr_permisos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Permiso eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar permiso.' });
  }
});

// ── Planilla ─────────────────────────────────────────────────────────────────
router.get('/api/hr/planilla', authenticate, async (req, res) => {
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

router.post('/api/hr/planilla', authenticate, async (req, res) => {
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

router.delete('/api/hr/planilla/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Helpers compartidos para planillas (fijo / unidad / hora) ────────────────
const PLANILLA_LIMITS = {
  segmentos: 50,
  trabajadoresPorPlanilla: 500,
  observaciones: 1000,
  nombrePlantilla: 100,
  string: 200,        // tope para nombres de lote, labor, grupo, unidad, etc.
  numeric: 9_999_999, // tope para totalGeneral, costos, cantidades
  filasPorPlanilla: 500,
  diasPorFila: 400,   // tope defensivo (~1 año + margen)
  deduccionesPorFila: 50,
  conceptoDeduccion: 100,
  periodoDiasMax: 366,
};
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLANILLA_ESTADOS = ['borrador', 'pendiente', 'aprobada', 'pagada'];

function trimStr(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

function clampNumber(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

// Roles que pueden crear/editar planillas a nombre de otros encargados.
const PLANILLA_ROLES_ON_BEHALF = ['supervisor', 'administrador', 'rrhh'];
const canActOnBehalf = (req) => PLANILLA_ROLES_ON_BEHALF.includes(req.userRole);

// Resuelve el doc id del usuario autenticado (collection `users`) a partir de
// email + fincaId. Devuelve null si no existe. Cachea en req para no repetir.
async function resolveAuthUserId(req) {
  if (req._authUserId !== undefined) return req._authUserId;
  if (!req.userEmail) { req._authUserId = null; return null; }
  const snap = await db.collection('users')
    .where('email', '==', req.userEmail)
    .where('fincaId', '==', req.fincaId)
    .limit(1).get();
  req._authUserId = snap.empty ? null : snap.docs[0].id;
  return req._authUserId;
}

// Carga el mapa de fichas (userId → { precioHora, salarioBase, … }) para la finca activa.
async function loadFichasMap(fincaId) {
  const snap = await db.collection('hr_fichas').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

// Carga el mapa de unidades (nombre normalizado → { precio, factorConversion, unidadBase }).
async function loadUnidadesMap(fincaId) {
  const snap = await db.collection('unidades_medida').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => {
    const u = d.data() || {};
    if (u.nombre) map.set(String(u.nombre).trim().toLowerCase(), u);
  });
  return map;
}

// Carga el mapa de usuarios (userId → user) de la finca.
async function loadUsersMap(fincaId) {
  const snap = await db.collection('users').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

// ── Audit trail ──────────────────────────────────────────────────────────────
const PLANILLA_HISTORY_MAX = 50;

function buildHistoryEntry({ userId, email, action }) {
  return { at: new Date(), by: userId || null, byEmail: email || null, action };
}

function appendHistory(currentHistory, entry) {
  const arr = Array.isArray(currentHistory) ? currentHistory : [];
  const next = [...arr, entry];
  return next.length > PLANILLA_HISTORY_MAX ? next.slice(-PLANILLA_HISTORY_MAX) : next;
}

// ── Rate limiter (in-memory, por instancia de Cloud Function) ────────────────
// Defensa en profundidad. No reemplaza quotas a nivel de API Gateway.
const RATE_BUCKETS = new Map();
const RATE_BUCKET_MAX = 5000;

function planillaRateLimit({ windowMs = 60_000, max = 60 } = {}) {
  return (req, res, next) => {
    const uid = req.uid;
    if (!uid) return next();
    const key = `${uid}:${req.method}:${req.baseUrl || ''}${req.path}`;
    const now = Date.now();
    let bucket = RATE_BUCKETS.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      if (RATE_BUCKETS.size > RATE_BUCKET_MAX) {
        for (const [k, b] of RATE_BUCKETS) {
          if (now - b.windowStart > windowMs) RATE_BUCKETS.delete(k);
          if (RATE_BUCKETS.size <= RATE_BUCKET_MAX / 2) break;
        }
      }
      bucket = { count: 0, windowStart: now };
      RATE_BUCKETS.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.windowStart + windowMs - now) / 1000)));
      return res.status(429).json({ message: 'Demasiadas solicitudes. Espera un momento.' });
    }
    next();
  };
}

// ── Planilla Salario Fijo ─────────────────────────────────────────────────────
// Sanitiza un fila de planilla fijo: verifica trabajadorId contra users/fichas
// de la finca y canonicaliza nombre / cédula / puesto / salarioBase / fechaIngreso
// desde fuentes autoritativas. Descarta filas con trabajadorId inválido.
const FIJO_CCSS_RATE = 0.1083;
const FIJO_JORNADA_HORAS_DEFAULT = 48;

function sanitizeFijoDia(d) {
  const fechaRaw = typeof d?.fecha === 'string' ? d.fecha : '';
  // Acepta tanto ISO completo como YYYY-MM-DD
  const fechaStr = fechaRaw.slice(0, 10);
  if (!FECHA_RE.test(fechaStr)) return null;
  return {
    fecha: fechaRaw.length >= 10 ? fechaRaw.slice(0, 30) : fechaStr,
    ausente: d?.ausente === true,
    horasParciales: clampNumber(d?.horasParciales, 24),
    salarioExtra: clampNumber(d?.salarioExtra, PLANILLA_LIMITS.numeric),
  };
}

function sanitizeFijoDeduccion(d) {
  return {
    concepto: trimStr(d?.concepto, PLANILLA_LIMITS.conceptoDeduccion).trim(),
    monto: clampNumber(d?.monto, PLANILLA_LIMITS.numeric),
  };
}

function sanitizeFijoFilas(filas, usersMap, fichasMap) {
  if (!Array.isArray(filas))
    return { ok: false, msg: 'filas debe ser un arreglo.' };
  if (filas.length > PLANILLA_LIMITS.filasPorPlanilla)
    return { ok: false, msg: `Máximo ${PLANILLA_LIMITS.filasPorPlanilla} empleados por planilla.` };

  const cleaned = [];
  for (const f of filas) {
    const trabajadorId = trimStr(f?.trabajadorId, 64);
    if (!trabajadorId || !usersMap.has(trabajadorId)) continue; // descartar silenciosamente

    const userDoc  = usersMap.get(trabajadorId) || {};
    const ficha    = fichasMap.get(trabajadorId) || {};
    const nombre   = trimStr(userDoc.nombre, PLANILLA_LIMITS.string);
    const cedula   = trimStr(ficha.cedula || f?.cedula, 30);
    const puesto   = trimStr(ficha.puesto || f?.puesto, PLANILLA_LIMITS.string);
    const fechaIng = (typeof ficha.fechaIngreso === 'string' && FECHA_RE.test(ficha.fechaIngreso))
      ? ficha.fechaIngreso
      : ((typeof f?.fechaIngreso === 'string' && FECHA_RE.test(f.fechaIngreso)) ? f.fechaIngreso : '');

    // salarioMensual: autoritativo desde ficha si existe, fallback al valor recibido (clamp).
    const salarioMensual = ficha.salarioBase != null
      ? clampNumber(ficha.salarioBase, PLANILLA_LIMITS.numeric)
      : clampNumber(f?.salarioMensual, PLANILLA_LIMITS.numeric);

    // salarioDiario: editable por el usuario (override de salarioMensual/30). Clamp.
    const salarioDiario = clampNumber(f?.salarioDiario, PLANILLA_LIMITS.numeric);

    // horasSemanales: derivar de ficha.horarioSemanal si existe, sino fallback.
    let horasSemanales = 0;
    const horario = ficha.horarioSemanal;
    if (horario && typeof horario === 'object') {
      const dias = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
      for (const k of dias) {
        const d = horario[k];
        if (!d?.activo || typeof d.inicio !== 'string' || typeof d.fin !== 'string') continue;
        const [h1, m1] = d.inicio.split(':').map(Number);
        const [h2, m2] = d.fin.split(':').map(Number);
        if ([h1, m1, h2, m2].some(n => !Number.isFinite(n))) continue;
        horasSemanales += Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
      }
    }
    if (!(horasSemanales > 0)) horasSemanales = FIJO_JORNADA_HORAS_DEFAULT;
    horasSemanales = clampNumber(horasSemanales, 168); // max 7*24

    const dias = Array.isArray(f?.dias)
      ? f.dias.slice(0, PLANILLA_LIMITS.diasPorFila).map(sanitizeFijoDia).filter(Boolean)
      : [];
    const deduccionesExtra = Array.isArray(f?.deduccionesExtra)
      ? f.deduccionesExtra.slice(0, PLANILLA_LIMITS.deduccionesPorFila).map(sanitizeFijoDeduccion)
      : [];

    const efectivoDesdeRaw = typeof f?.efectivoDesde === 'string' ? f.efectivoDesde.slice(0, 10) : '';
    const efectivoDesde = FECHA_RE.test(efectivoDesdeRaw) ? efectivoDesdeRaw : '';

    // Totales: confiar en cómputo del cliente pero clamp.
    const salarioOrdinario      = clampNumber(f?.salarioOrdinario, PLANILLA_LIMITS.numeric);
    const salarioExtraordinario = clampNumber(f?.salarioExtraordinario, PLANILLA_LIMITS.numeric);
    const salarioBruto          = clampNumber(f?.salarioBruto, PLANILLA_LIMITS.numeric);
    // CCSS debe ser consistente con salarioBruto; recomputar server-side.
    const deduccionCCSS         = Math.round(salarioBruto * FIJO_CCSS_RATE);
    const otrasDeduccionesTotal = deduccionesExtra.reduce((s, d) => s + d.monto, 0);
    const totalDeducciones      = deduccionCCSS + otrasDeduccionesTotal;
    const totalNeto             = Math.max(0, salarioBruto - totalDeducciones);

    cleaned.push({
      trabajadorId,
      trabajadorNombre: nombre,
      cedula, puesto,
      fechaIngreso: fechaIng,
      periodoParcial: f?.periodoParcial === true,
      efectivoDesde,
      salarioMensual, salarioDiario,
      horasSemanales,
      dias, deduccionesExtra,
      salarioOrdinario, salarioExtraordinario, salarioBruto,
      deduccionCCSS,
      otrasDeduccionesTotal: Math.round(otrasDeduccionesTotal),
      totalDeducciones: Math.round(totalDeducciones),
      totalNeto: Math.round(totalNeto),
    });
  }
  return { ok: true, value: cleaned };
}

function sumTotalGeneral(filas) {
  const total = (filas || []).reduce((s, f) => s + (Number(f.totalNeto) || 0), 0);
  return clampNumber(total, PLANILLA_LIMITS.numeric);
}

// Valida rango de período (ISO date string). Permite ambos formatos: YYYY-MM-DD
// o ISO datetime completo. Devuelve objetos Date o null+msg.
function parsePeriodoISO(periodoInicio, periodoFin) {
  if (typeof periodoInicio !== 'string' || typeof periodoFin !== 'string')
    return { ok: false, msg: 'Período inválido.' };
  const ini = new Date(periodoInicio);
  const fin = new Date(periodoFin);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime()))
    return { ok: false, msg: 'Fechas inválidas.' };
  if (fin < ini)
    return { ok: false, msg: 'La fecha final debe ser igual o posterior a la inicial.' };
  const diffDays = Math.floor((fin - ini) / 86400000) + 1;
  if (diffDays > PLANILLA_LIMITS.periodoDiasMax)
    return { ok: false, msg: `El período no puede exceder ${PLANILLA_LIMITS.periodoDiasMax} días.` };
  return { ok: true, ini, fin };
}

router.get('/api/hr/planilla-fijo', authenticate, async (req, res) => {
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

// Sólo supervisor/administrador/rrhh pueden crear, editar el contenido, eliminar
// o cambiar el estado de planillas fijas. trabajador/encargado pueden sólo leer.
const PLANILLA_FIJO_ROLES_WRITE = ['supervisor', 'administrador', 'rrhh'];
const canEditarFijo = (req) => PLANILLA_FIJO_ROLES_WRITE.includes(req.userRole);

router.post('/api/hr/planilla-fijo', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    if (!canEditarFijo(req))
      return res.status(403).json({ message: 'No tienes permisos para crear planillas.' });

    const { periodoInicio, periodoFin, periodoLabel, filas } = req.body;
    const periodo = parsePeriodoISO(periodoInicio, periodoFin);
    if (!periodo.ok) return res.status(400).json({ message: periodo.msg });

    const [usersMap, fichasMap] = await Promise.all([
      loadUsersMap(req.fincaId),
      loadFichasMap(req.fincaId),
    ]);
    const san = sanitizeFijoFilas(filas, usersMap, fichasMap);
    if (!san.ok) return res.status(400).json({ message: san.msg });
    if (san.value.length === 0)
      return res.status(400).json({ message: 'La planilla debe tener al menos un empleado válido.' });

    const totalGeneral = sumTotalGeneral(san.value);
    const labelClean = trimStr(periodoLabel, PLANILLA_LIMITS.string);

    // Generate atomic consecutive number PL-00001, PL-00002, ...
    const counterRef = db.collection('counters').doc(`planilla_fijo_${req.fincaId}`);
    const nextNum = await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      const next = (counterDoc.exists ? (counterDoc.data().last || 0) : 0) + 1;
      t.set(counterRef, { last: next }, { merge: true });
      return next;
    });
    const numeroConsecutivo = `PL-${String(nextNum).padStart(5, '0')}`;

    const authUserId = await resolveAuthUserId(req);
    const ref = await db.collection('hr_planilla_fijo').add({
      periodoInicio: Timestamp.fromDate(periodo.ini),
      periodoFin: Timestamp.fromDate(periodo.fin),
      periodoLabel: labelClean,
      filas: san.value,
      totalGeneral,
      estado: 'pendiente',
      numeroConsecutivo,
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
      createdBy: { userId: authUserId || null, email: req.userEmail || null },
      history: [buildHistoryEntry({ userId: authUserId, email: req.userEmail, action: 'created:pendiente' })],
    });

    // Notify supervisors/admins via WhatsApp (best-effort)
    try {
      const client = getTwilioClient();
      const usersSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('rol', 'in', ['supervisor', 'administrador'])
        .get();
      const total = totalGeneral.toLocaleString('es-CR');
      const body = `📋 *Planilla Pendiente de Pago*\nPeríodo: ${labelClean}\nTotal a pagar: ₡${total}\nRevise y apruebe el pago en el sistema Aurora.`;
      const from = `whatsapp:${twilioWhatsappFrom.value()}`;
      const notifPromises = [];
      usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.telefono) {
          const to = `whatsapp:${u.telefono.replace(/\s+/g, '')}`;
          notifPromises.push(
            client.messages.create({ body, from, to })
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
        name: `Aprobar pago de planilla: ${labelClean}`,
        responsableId: null,
        responsableNombre: 'Sin asignar',
      },
    });

    res.status(201).json({ id: ref.id, numeroConsecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar planilla.' });
  }
});

router.put('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const { estado, filas, periodoInicio, periodoFin, periodoLabel } = req.body;
    const currentDoc = ownership.doc.data();
    const currentEstado = currentDoc.estado || 'pendiente';

    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = canPagar;

    // Sólo roles de escritura pueden modificar cualquier planilla fija.
    if (!canEditarFijo(req))
      return res.status(403).json({ message: 'No tienes permisos para modificar planillas.' });

    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return res.status(400).json({ message: 'Estado inválido.' });
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

    // Una vez pagada, sólo admin/rrhh puede modificarla (reversión contable).
    if (currentEstado === 'pagada' && !isAdminLike)
      return res.status(403).json({ message: 'Esta planilla ya fue pagada y sólo administrador o RR.HH. puede modificarla.' });

    // Aprobada: sólo transición a pagada, o modificaciones por admin/rrhh.
    if (currentEstado === 'aprobada' && !isAdminLike && estado !== 'pagada')
      return res.status(403).json({ message: 'Esta planilla ya fue aprobada; sólo admin/RR.HH. puede modificarla fuera de pagar.' });

    const update = { updatedAt: Timestamp.now() };

    // Cambio de período (sólo con filas nuevas, para evitar inconsistencia).
    if (periodoInicio !== undefined || periodoFin !== undefined) {
      const periodo = parsePeriodoISO(
        periodoInicio || currentDoc.periodoInicio?.toDate().toISOString(),
        periodoFin    || currentDoc.periodoFin?.toDate().toISOString(),
      );
      if (!periodo.ok) return res.status(400).json({ message: periodo.msg });
      update.periodoInicio = Timestamp.fromDate(periodo.ini);
      update.periodoFin    = Timestamp.fromDate(periodo.fin);
    }
    if (periodoLabel !== undefined)
      update.periodoLabel = trimStr(periodoLabel, PLANILLA_LIMITS.string);

    if (filas !== undefined) {
      const [usersMap, fichasMap] = await Promise.all([
        loadUsersMap(req.fincaId),
        loadFichasMap(req.fincaId),
      ]);
      const san = sanitizeFijoFilas(filas, usersMap, fichasMap);
      if (!san.ok) return res.status(400).json({ message: san.msg });
      if (san.value.length === 0)
        return res.status(400).json({ message: 'La planilla debe tener al menos un empleado válido.' });
      update.filas = san.value;
      update.totalGeneral = sumTotalGeneral(san.value);
    }

    if (estado !== undefined) update.estado = estado;

    // Audit trail
    const authUserId = await resolveAuthUserId(req);
    const actions = [];
    if (estado !== undefined && estado !== currentEstado) actions.push(`estado:${currentEstado}→${estado}`);
    if (filas !== undefined) actions.push('filas');
    if ((periodoInicio !== undefined || periodoFin !== undefined) && actions.length === 0) actions.push('periodo');
    if (periodoLabel !== undefined && actions.length === 0) actions.push('label');
    if (actions.length > 0) {
      update.history = appendHistory(currentDoc.history, buildHistoryEntry({
        userId: authUserId, email: req.userEmail, action: actions.join(','),
      }));
      update.updatedBy = { userId: authUserId || null, email: req.userEmail || null };
    }

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

router.delete('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const data = ownership.doc.data();
    const estadoActual = data.estado || 'pendiente';
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    // Sólo pendientes son borrables libremente por roles de escritura.
    if (!canEditarFijo(req))
      return res.status(403).json({ message: 'No tienes permisos para eliminar planillas.' });
    if (['aprobada', 'pagada'].includes(estadoActual) && !isAdminLike)
      return res.status(403).json({ message: 'Planillas aprobadas o pagadas sólo puede eliminarlas admin/RR.HH.' });

    await db.collection('hr_planilla_fijo').doc(req.params.id).delete();
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
router.get('/api/hr/memorandums', authenticate, async (req, res) => {
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

router.post('/api/hr/memorandums', authenticate, async (req, res) => {
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

router.delete('/api/hr/memorandums/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_memorandums').doc(req.params.id).delete();
    res.status(200).json({ message: 'Memorándum eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Documentos Adjuntos ───────────────────────────────────────────────────────
router.get('/api/hr/documentos', authenticate, async (req, res) => {
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

router.post('/api/hr/documentos', authenticate, async (req, res) => {
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

router.delete('/api/hr/documentos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_documentos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Documento eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Subordinados (trabajadores asignados a un encargado) ──────────────────────
router.get('/api/hr/subordinados', authenticate, async (req, res) => {
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
const isHoraUnit = (u) => /^horas?$/i.test((u || '').trim());

// Calcula el total de un trabajador para todos los segmentos. Regla idéntica
// a la del frontend / snapshot al aprobar.
function computeWorkerTotal(worker, segmentos) {
  return (segmentos || []).reduce((sum, seg) => {
    const cantidad = clampNumber(worker.cantidades?.[seg.id], PLANILLA_LIMITS.numeric);
    if (cantidad <= 0) return sum;
    const horaDirecta = isHoraUnit(seg.unidad);
    const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
    const precio = (horaDirecta || horaConFactor)
      ? (Number(worker.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
      : (Number(seg.costoUnitario) || 0);
    return sum + cantidad * precio;
  }, 0);
}

// Re-deriva precios desde fuentes autoritativas, valida identidades y recalcula
// totales:
// - precioHora viene de hr_fichas (no del cliente).
// - costoUnitario / factorConversion / unidadBase vienen del catálogo
//   unidades_medida cuando la unidad existe ahí; si es una unidad libre no
//   catalogada, se acepta el valor del cliente (ya saneado).
// - trabajadorId DEBE existir en `users` y pertenecer a la finca; los demás
//   se descartan silenciosamente (impide inyectar IDs falsos al snapshot).
// - trabajadorNombre se sobreescribe con el `nombre` canónico de `users`.
async function enrichPlanilla(fincaId, segmentos, trabajadores) {
  const [fichasMap, unidadesMap, usersMap] = await Promise.all([
    loadFichasMap(fincaId),
    loadUnidadesMap(fincaId),
    loadUsersMap(fincaId),
  ]);

  const enrichedSegs = (segmentos || []).map(s => {
    const key = String(s.unidad || '').trim().toLowerCase();
    const cat = key ? unidadesMap.get(key) : null;
    if (!cat) return s; // unidad libre / no catalogada → respetar valor del cliente
    return {
      ...s,
      // Sólo sobrescribir costoUnitario si el catálogo define un precio explícito.
      costoUnitario: (cat.precio != null && cat.precio !== '')
        ? clampNumber(cat.precio, PLANILLA_LIMITS.numeric)
        : s.costoUnitario,
      factorConversion: cat.factorConversion != null
        ? clampNumber(cat.factorConversion, PLANILLA_LIMITS.numeric)
        : null,
      unidadBase: cat.unidadBase || '',
    };
  });

  const enrichedWorkers = (trabajadores || [])
    .filter(t => t.trabajadorId && usersMap.has(t.trabajadorId))
    .map(t => {
      const userDoc = usersMap.get(t.trabajadorId) || {};
      const ficha = fichasMap.get(t.trabajadorId);
      const precioHora = ficha ? clampNumber(ficha.precioHora, PLANILLA_LIMITS.numeric) : 0;
      const next = {
        ...t,
        // Nombre canónico desde users (no del cliente) — evita falsificación cosmética.
        trabajadorNombre: trimStr(userDoc.nombre, PLANILLA_LIMITS.string),
        precioHora,
      };
      next.total = clampNumber(computeWorkerTotal(next, enrichedSegs), PLANILLA_LIMITS.numeric);
      return next;
    });

  const totalGeneral = clampNumber(
    enrichedWorkers.reduce((s, w) => s + (Number(w.total) || 0), 0),
    PLANILLA_LIMITS.numeric
  );

  return { segmentos: enrichedSegs, trabajadores: enrichedWorkers, totalGeneral, usersMap };
}

// Sanitiza segmentos: tipos, longitudes, números finitos.
function sanitizeSegmentos(segmentos) {
  if (!Array.isArray(segmentos)) return { ok: false, msg: 'segmentos debe ser un arreglo.' };
  if (segmentos.length > PLANILLA_LIMITS.segmentos)
    return { ok: false, msg: `Máximo ${PLANILLA_LIMITS.segmentos} segmentos.` };
  const cleaned = segmentos.map(s => ({
    id: trimStr(s?.id, 64),
    loteId: trimStr(s?.loteId, 64),
    loteNombre: trimStr(s?.loteNombre, PLANILLA_LIMITS.string),
    labor: trimStr(s?.labor, PLANILLA_LIMITS.string),
    grupo: trimStr(s?.grupo, PLANILLA_LIMITS.string),
    avanceHa: clampNumber(s?.avanceHa, PLANILLA_LIMITS.numeric),
    unidad: trimStr(s?.unidad, PLANILLA_LIMITS.string),
    costoUnitario: clampNumber(s?.costoUnitario, PLANILLA_LIMITS.numeric),
    factorConversion: s?.factorConversion == null ? null : clampNumber(s.factorConversion, PLANILLA_LIMITS.numeric),
    unidadBase: trimStr(s?.unidadBase, PLANILLA_LIMITS.string),
  }));
  return { ok: true, value: cleaned };
}

// Sanitiza trabajadores: tipos, longitudes, cantidades finitas.
function sanitizeTrabajadores(trabajadores) {
  if (!Array.isArray(trabajadores)) return { ok: false, msg: 'trabajadores debe ser un arreglo.' };
  if (trabajadores.length > PLANILLA_LIMITS.trabajadoresPorPlanilla)
    return { ok: false, msg: `Máximo ${PLANILLA_LIMITS.trabajadoresPorPlanilla} trabajadores.` };
  const cleaned = trabajadores.map(t => {
    const cantsIn = (t && typeof t.cantidades === 'object' && t.cantidades) ? t.cantidades : {};
    const cantsOut = {};
    for (const k of Object.keys(cantsIn).slice(0, PLANILLA_LIMITS.segmentos)) {
      const segId = String(k).slice(0, 64);
      cantsOut[segId] = clampNumber(cantsIn[k], PLANILLA_LIMITS.numeric);
    }
    return {
      trabajadorId: trimStr(t?.trabajadorId, 64),
      trabajadorNombre: trimStr(t?.trabajadorNombre, PLANILLA_LIMITS.string),
      precioHora: clampNumber(t?.precioHora, PLANILLA_LIMITS.numeric),
      cantidades: cantsOut,
      total: clampNumber(t?.total, PLANILLA_LIMITS.numeric),
    };
  });
  return { ok: true, value: cleaned };
}

router.get('/api/hr/planilla-unidad', authenticate, async (req, res) => {
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

router.get('/api/hr/planilla-unidad/historial', authenticate, async (req, res) => {
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

router.post('/api/hr/planilla-unidad', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { fecha, encargadoId, segmentos, trabajadores, estado, observaciones } = req.body;

    // Validación de tipos / requeridos / longitudes
    if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
      return res.status(400).json({ message: 'Fecha inválida (formato YYYY-MM-DD).' });
    const fechaDate = new Date(fecha + 'T12:00:00');
    if (Number.isNaN(fechaDate.getTime()))
      return res.status(400).json({ message: 'Fecha inválida.' });
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return res.status(400).json({ message: 'Encargado es requerido.' });
    if (estado != null && !PLANILLA_ESTADOS.includes(estado))
      return res.status(400).json({ message: 'Estado inválido.' });

    // El cliente no puede crear planillas a nombre de otro encargado a menos
    // que tenga rol supervisor/admin/rrhh.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes crear planillas a nombre de otro encargado.' });

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return res.status(400).json({ message: segs.msg });
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return res.status(400).json({ message: tabs.msg });

    // Re-derivar precios, validar identidades y recalcular totales desde
    // fuentes autoritativas (hr_fichas + unidades_medida + users).
    const enriched = await enrichPlanilla(req.fincaId, segs.value, tabs.value);

    // Resolver nombre canónico del encargado (no del cliente).
    const encargadoUser = enriched.usersMap.get(encargadoId.trim());
    const encargadoNombreCanon = trimStr(encargadoUser?.nombre, PLANILLA_LIMITS.string);

    // El consecutivo solo se asigna cuando la planilla sale del estado borrador.
    // Si se guarda como borrador, se crea sin consecutivo para no desperdiciar números.
    const estadoFinal = estado || 'borrador';
    const esBorrador = estadoFinal === 'borrador';
    let consecutivo = null;
    if (!esBorrador) {
      const counterRef = db.collection('counters').doc(`planilla_unidad_${req.fincaId}`);
      await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        const next = counterDoc.exists ? (counterDoc.data().value || 0) + 1 : 1;
        t.set(counterRef, { value: next });
        consecutivo = `PU-${String(next).padStart(5, '0')}`;
      });
    }

    const auditEntry = buildHistoryEntry({
      userId: authUserId,
      email: req.userEmail,
      action: `created:${estadoFinal}`,
    });
    const docData = {
      fincaId: req.fincaId,
      fecha: Timestamp.fromDate(fechaDate),
      encargadoId: trimStr(encargadoId, 64),
      encargadoNombre: encargadoNombreCanon,
      segmentos: enriched.segmentos,
      trabajadores: enriched.trabajadores,
      totalGeneral: enriched.totalGeneral,
      estado: estadoFinal,
      observaciones: trimStr(observaciones, PLANILLA_LIMITS.observaciones),
      createdAt: Timestamp.now(),
      createdBy: { userId: authUserId || null, email: req.userEmail || null },
      history: [auditEntry],
    };
    if (consecutivo) docData.consecutivo = consecutivo;

    const ref = await db.collection('hr_planilla_unidad').add(docData);
    res.status(201).json({ id: ref.id, consecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear planilla.' });
  }
});

router.put('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { fecha, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;

    // Sólo el encargado dueño de la planilla (o roles superiores) puede editarla.
    const currentDoc = ownership.doc.data();
    const docEncargadoId = currentDoc.encargadoId;
    const currentEstado = currentDoc.estado || 'borrador';
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes editar planillas de otro encargado.' });

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return res.status(400).json({ message: 'Estado inválido.' });
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

    // Bloquear retroceso desde estados terminales (aprobada / pagada): sólo
    // administrador o rrhh pueden modificar planillas ya aprobadas o pagadas.
    const lockedStates = ['aprobada', 'pagada'];
    if (lockedStates.includes(currentEstado) && !isAdminLike) {
      // Cualquier escritura sobre una planilla aprobada/pagada queda restringida.
      return res.status(403).json({ message: 'Esta planilla ya fue aprobada/pagada y sólo administrador o RR.HH. puede modificarla.' });
    }
    // Bloquear transiciones de retroceso explícitas (aprobada → otro / pagada → otro)
    // incluso para admin-like → registra acción intencional, no por descuido.
    // (Los admin-like sí pueden hacerlo si lo envían explícitamente.)
    // Nota: ya pasamos el guard anterior, así que admin-like puede hacerlo.

    const update = { updatedAt: Timestamp.now() };
    if (fecha !== undefined) {
      if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
        return res.status(400).json({ message: 'Fecha inválida (formato YYYY-MM-DD).' });
      const fechaDate = new Date(fecha + 'T12:00:00');
      if (Number.isNaN(fechaDate.getTime()))
        return res.status(400).json({ message: 'Fecha inválida.' });
      update.fecha = Timestamp.fromDate(fechaDate);
    }
    let segsClean = null;
    let tabsClean = null;
    if (segmentos !== undefined) {
      const segs = sanitizeSegmentos(segmentos);
      if (!segs.ok) return res.status(400).json({ message: segs.msg });
      segsClean = segs.value;
    }
    if (trabajadores !== undefined) {
      const tabs = sanitizeTrabajadores(trabajadores);
      if (!tabs.ok) return res.status(400).json({ message: tabs.msg });
      tabsClean = tabs.value;
    }
    // Si vino segmentos o trabajadores, re-derivar precios y totales desde
    // fuentes autoritativas. Si vino sólo uno de los dos, completar con el
    // valor existente en el doc para que el cómputo sea coherente.
    if (segsClean !== null || tabsClean !== null) {
      const enriched = await enrichPlanilla(
        req.fincaId,
        segsClean !== null ? segsClean : (currentDoc.segmentos || []),
        tabsClean !== null ? tabsClean : (currentDoc.trabajadores || []),
      );
      if (segsClean !== null) update.segmentos = enriched.segmentos;
      if (tabsClean !== null) update.trabajadores = enriched.trabajadores;
      // totalGeneral siempre se recalcula server-side: ignora el del cliente.
      update.totalGeneral = enriched.totalGeneral;
      // Resolver nombre canónico del encargado (puede haber cambiado en `users`).
      const encargadoUser = enriched.usersMap.get(docEncargadoId);
      if (encargadoUser) update.encargadoNombre = trimStr(encargadoUser.nombre, PLANILLA_LIMITS.string);
    } else if (totalGeneral !== undefined) {
      // Sólo cambió un campo "metadata" (estado, observaciones) — el cliente
      // pudo recalcular total localmente; lo aceptamos saneado.
      update.totalGeneral = clampNumber(totalGeneral, PLANILLA_LIMITS.numeric);
    }
    if (estado !== undefined) update.estado = estado;
    if (observaciones !== undefined) update.observaciones = trimStr(observaciones, PLANILLA_LIMITS.observaciones);

    // Audit trail: registrar quién modificó y qué tipo de cambio fue.
    const actions = [];
    if (estado !== undefined && estado !== currentEstado) actions.push(`estado:${currentEstado}→${estado}`);
    if (segsClean !== null || tabsClean !== null) actions.push('updated');
    if (observaciones !== undefined && actions.length === 0) actions.push('observaciones');
    if (fecha !== undefined && actions.length === 0) actions.push('fecha');
    if (actions.length > 0) {
      const auditEntry = buildHistoryEntry({
        userId: authUserId,
        email: req.userEmail,
        action: actions.join(','),
      });
      update.history = appendHistory(currentDoc.history, auditEntry);
      update.updatedBy = { userId: authUserId || null, email: req.userEmail || null };
    }

    // Asignar consecutivo si la planilla aún no tiene uno y está saliendo del borrador
    let consecutivo = currentDoc.consecutivo || null;
    if (!consecutivo && estado && estado !== 'borrador') {
      const counterRef = db.collection('counters').doc(`planilla_unidad_${req.fincaId}`);
      await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        const next = counterDoc.exists ? (counterDoc.data().value || 0) + 1 : 1;
        t.set(counterRef, { value: next });
        consecutivo = `PU-${String(next).padStart(5, '0')}`;
      });
      update.consecutivo = consecutivo;
    }

    // ── Snapshot al aprobar ────────────────────────────────────────────────────
    if (estado === 'aprobada' && !currentDoc.snapshotCreado) {
      // Mezclar datos viejos con los cambios del body para usar siempre la versión más reciente
      const doc = { ...currentDoc, ...update };

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
          const horaDirecta = isHoraUnit(seg.unidad);
          const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
          const costoUnitario = (horaDirecta || horaConFactor)
            ? (Number(worker.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
            : (Number(seg.costoUnitario) || 0);
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
    res.status(200).json({ message: 'Planilla actualizada.', consecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar planilla.' });
  }
});

router.delete('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const data = ownership.doc.data();
    const docEncargadoId = data.encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes eliminar planillas de otro encargado.' });
    // Bloquear borrado de planillas aprobadas/pagadas salvo admin/rrhh.
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (['aprobada', 'pagada'].includes(data.estado) && !isAdminLike)
      return res.status(403).json({ message: 'Esta planilla ya fue aprobada/pagada y sólo administrador o RR.HH. puede eliminarla.' });
    await db.collection('hr_planilla_unidad').doc(req.params.id).delete();
    res.status(200).json({ message: 'Planilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar planilla.' });
  }
});

// ── Plantillas de Planilla por Unidad / Hora ──────────────────────────────────
router.get('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const encargadoId = typeof req.query.encargadoId === 'string' ? req.query.encargadoId.trim() : '';
    if (!encargadoId)
      return res.status(400).json({ message: 'encargadoId es requerido.' });
    // Sólo el propio encargado o roles superiores pueden listar plantillas ajenas.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes ver plantillas de otro encargado.' });

    const snap = await db.collection('hr_plantillas_planilla')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', encargadoId)
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

router.post('/api/hr/plantillas-planilla', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { nombre, segmentos, trabajadores, encargadoId } = req.body;
    const nombreClean = trimStr(nombre, PLANILLA_LIMITS.nombrePlantilla).trim();
    if (!nombreClean) return res.status(400).json({ message: 'Nombre es requerido.' });
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return res.status(400).json({ message: 'Encargado es requerido.' });

    // No permitir guardar plantillas a nombre de otro encargado.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes guardar plantillas a nombre de otro encargado.' });

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return res.status(400).json({ message: segs.msg });
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return res.status(400).json({ message: tabs.msg });

    const ref = await db.collection('hr_plantillas_planilla').add({
      fincaId: req.fincaId,
      nombre: nombreClean,
      segmentos: segs.value,
      trabajadores: tabs.value,
      encargadoId: trimStr(encargadoId, 64),
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar plantilla.' });
  }
});

router.delete('/api/hr/plantillas-planilla/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_plantillas_planilla', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const docEncargadoId = ownership.doc.data().encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return res.status(403).json({ message: 'No puedes eliminar plantillas de otro encargado.' });
    await db.collection('hr_plantillas_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

// ── Solicitudes de Empleo ─────────────────────────────────────────────────────
router.get('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
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

router.post('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
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

router.put('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Solicitud actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar.' });
  }
});

router.delete('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

module.exports = router;
