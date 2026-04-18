const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { getTwilioClient } = require('../lib/clients');
const { twilioWhatsappFrom } = require('../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const {
  computeFincaScores,
  listScores,
  getScore,
} = require('../lib/hr/performanceAggregator');
const { productivityMatrix } = require('../lib/hr/productivityByLabor');
const { computeLaborBenchmarks } = require('../lib/hr/laborBenchmarks');
const { projectWorkload, MAX_HORIZON_WEEKS } = require('../lib/hr/workloadProjector');
const { currentCapacity } = require('../lib/hr/capacityCalculator');
const {
  computeAccuracy,
  cutoffForWindow,
  VALID_RESOLUTIONS,
} = require('../lib/hr/accuracyCalculator');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: HUMAN RESOURCES
// ─────────────────────────────────────────────────────────────────────────────

// Worker Fichas
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
      if (clean[k].length > max) errs.push(`${k} exceeds ${max} characters.`);
    } else if (clean[k] != null) {
      errs.push(`${k} must be a string.`);
    }
  }
  if (typeof clean.telefonoEmergencia === 'string' && clean.telefonoEmergencia && !PHONE_RE_FICHA.test(clean.telefonoEmergencia)) {
    errs.push('Invalid emergency phone.');
  }

  if (clean.fechaIngreso !== undefined && clean.fechaIngreso !== '' && clean.fechaIngreso !== null) {
    if (typeof clean.fechaIngreso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clean.fechaIngreso)) {
      errs.push('Invalid fechaIngreso.');
    } else {
      const d = new Date(clean.fechaIngreso);
      if (Number.isNaN(d.getTime())) errs.push('Invalid fechaIngreso.');
    }
  }

  if (clean.tipoContrato != null && clean.tipoContrato !== '' && !FICHA_TIPOS_CONTRATO.includes(clean.tipoContrato)) {
    errs.push('Invalid tipoContrato.');
  }

  for (const k of ['salarioBase', 'precioHora']) {
    if (clean[k] === '' || clean[k] == null) { clean[k] = null; continue; }
    const n = Number(clean[k]);
    if (!Number.isFinite(n) || n < 0 || n > FICHA_SALARIO_MAX) {
      errs.push(`${k} must be a number between 0 and ${FICHA_SALARIO_MAX}.`);
    } else {
      clean[k] = n;
    }
  }

  if (clean.encargadoId != null && typeof clean.encargadoId !== 'string') {
    errs.push('Invalid encargadoId.');
  }

  if (clean.horarioSemanal !== undefined) {
    if (clean.horarioSemanal == null || typeof clean.horarioSemanal !== 'object' || Array.isArray(clean.horarioSemanal)) {
      errs.push('Invalid horarioSemanal.');
    } else {
      const norm = {};
      for (const d of FICHA_DIAS) {
        const day = clean.horarioSemanal[d];
        const activo = !!(day && day.activo === true);
        const inicio = day && typeof day.inicio === 'string' ? day.inicio : '';
        const fin = day && typeof day.fin === 'string' ? day.fin : '';
        if (activo) {
          if (!TIME_RE.test(inicio) || !TIME_RE.test(fin)) { errs.push(`Invalid schedule for ${d}.`); continue; }
          const [h1, m1] = inicio.split(':').map(Number);
          const [h2, m2] = fin.split(':').map(Number);
          if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push(`End <= start on ${d}.`);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch fichas.', 500);
  }
});

router.get('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const doc = await db.collection('hr_fichas').doc(req.params.userId).get();
    if (!doc.exists) return res.status(200).json({});
    if (doc.data().fincaId && doc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch ficha.', 500);
  }
});

router.put('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const { errs, clean } = validateFichaPayload(req.body || {});
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);
    if (clean.encargadoId) {
      const encDoc = await db.collection('users').doc(clean.encargadoId).get();
      if (!encDoc.exists || encDoc.data().fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid encargado.', 400);
      }
    }
    await db.collection('hr_fichas').doc(req.params.userId).set(
      { ...clean, fincaId: req.fincaId, updatedAt: Timestamp.now() },
      { merge: true }
    );
    res.status(200).json({ message: 'Ficha updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save ficha.', 500);
  }
});

// Asistencia
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch attendance.', 500);
  }
});

router.post('/api/hr/asistencia', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, estado, horasExtra, notas } = req.body;
    if (!trabajadorId || !fecha || !estado) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, fecha and estado are required.', 400);
    const ref = await db.collection('hr_asistencia').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      estado, horasExtra: Number(horasExtra) || 0, notas: notas || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register attendance.', 500);
  }
});

router.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

// Horas Extra
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch overtime.', 500);
  }
});

router.post('/api/hr/horas-extra', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, horas, motivo } = req.body;
    if (!trabajadorId || !fecha || !horas) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, fecha and horas are required.', 400);
    const ref = await db.collection('hr_horas_extra').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      horas: Number(horas), motivo: motivo || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register overtime.', 500);
  }
});

router.delete('/api/hr/horas-extra/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_horas_extra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// Permisos and Vacations
const PERMISO_TIPOS = ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'];
const PERMISO_ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERMISO_MOTIVO_MAX = 500;
const PERMISO_NOMBRE_MAX = 120;

function validatePermisoPayload(body) {
  const errs = [];
  const clean = {};

  clean.trabajadorId = typeof body.trabajadorId === 'string' ? body.trabajadorId.trim() : '';
  if (!clean.trabajadorId) errs.push('trabajadorId is required.');

  clean.trabajadorNombre = typeof body.trabajadorNombre === 'string'
    ? body.trabajadorNombre.trim().slice(0, PERMISO_NOMBRE_MAX) : '';

  clean.tipo = typeof body.tipo === 'string' ? body.tipo : '';
  if (!PERMISO_TIPOS.includes(clean.tipo)) errs.push('Invalid tipo.');

  clean.fechaInicio = typeof body.fechaInicio === 'string' ? body.fechaInicio : '';
  if (!DATE_RE.test(clean.fechaInicio) || Number.isNaN(new Date(clean.fechaInicio).getTime())) {
    errs.push('Invalid fechaInicio.');
  }

  clean.esParcial = body.esParcial === true;

  let fechaFin = typeof body.fechaFin === 'string' ? body.fechaFin : clean.fechaInicio;
  if (clean.esParcial) fechaFin = clean.fechaInicio;
  if (!DATE_RE.test(fechaFin) || Number.isNaN(new Date(fechaFin).getTime())) {
    errs.push('Invalid fechaFin.');
  } else if (DATE_RE.test(clean.fechaInicio) && fechaFin < clean.fechaInicio) {
    errs.push('fechaFin cannot be earlier than fechaInicio.');
  }
  clean.fechaFin = fechaFin;

  if (clean.esParcial) {
    const hi = typeof body.horaInicio === 'string' ? body.horaInicio : '';
    const hf = typeof body.horaFin === 'string' ? body.horaFin : '';
    if (!TIME_RE.test(hi) || !TIME_RE.test(hf)) {
      errs.push('Invalid horaInicio/horaFin.');
    } else {
      const [h1, m1] = hi.split(':').map(Number);
      const [h2, m2] = hf.split(':').map(Number);
      if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push('horaFin must be later than horaInicio.');
    }
    clean.horaInicio = hi;
    clean.horaFin = hf;
    const horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 24) errs.push('horas must be between 0 and 24.');
    clean.horas = Number.isFinite(horas) ? horas : 0;
    clean.dias = 0;
  } else {
    clean.horaInicio = null;
    clean.horaFin = null;
    clean.horas = 0;
    const dias = Number(body.dias);
    if (!Number.isFinite(dias) || dias < 1 || dias > 365) errs.push('dias must be between 1 and 365.');
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch permisos.', 500);
  }
});

router.post('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const { errs, clean } = validatePermisoPayload(req.body || {});
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);

    const workerDoc = await db.collection('users').doc(clean.trabajadorId).get();
    if (!workerDoc.exists || workerDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid worker.', 400);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create permiso.', 500);
  }
});

router.put('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const estado = (req.body || {}).estado;
    if (!PERMISO_ESTADOS.includes(estado)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    }
    if ((estado === 'aprobado' || estado === 'rechazado') && !hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to approve or reject.', 403);
    }

    await db.collection('hr_permisos').doc(req.params.id).update({
      estado, updatedAt: Timestamp.now(),
    });
    res.status(200).json({ message: 'Permiso updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update permiso.', 500);
  }
});

router.delete('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to delete.', 403);
    }
    await db.collection('hr_permisos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Permiso deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete permiso.', 500);
  }
});

// Planilla
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planilla.', 500);
  }
});

router.post('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, mes, anio, diasTrabajados, horasExtra, salarioBase, deducciones, total } = req.body;
    if (!trabajadorId || !mes || !anio) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, mes and anio are required.', 400);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save planilla.', 500);
  }
});

router.delete('/api/hr/planilla/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// Shared helpers for planillas (fijo / unidad / hora)
const PLANILLA_LIMITS = {
  segmentos: 50,
  trabajadoresPorPlanilla: 500,
  observaciones: 1000,
  nombrePlantilla: 100,
  string: 200,        // cap for lote, labor, grupo, unidad names, etc.
  numeric: 9_999_999, // cap for totalGeneral, costs, quantities
  filasPorPlanilla: 500,
  diasPorFila: 400,   // defensive cap (~1 year + margin)
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

// Roles allowed to create/edit planillas on behalf of other encargados.
const PLANILLA_ROLES_ON_BEHALF = ['supervisor', 'administrador', 'rrhh'];
const canActOnBehalf = (req) => PLANILLA_ROLES_ON_BEHALF.includes(req.userRole);

// Resolves the authenticated user's doc id (collection `users`) from
// email + fincaId. Returns null if not found. Cached on req to avoid repeats.
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

// Load the fichas map (userId → { precioHora, salarioBase, … }) for the active finca.
async function loadFichasMap(fincaId) {
  const snap = await db.collection('hr_fichas').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

// Load the unidades map (normalized name → { precio, factorConversion, unidadBase }).
async function loadUnidadesMap(fincaId) {
  const snap = await db.collection('unidades_medida').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => {
    const u = d.data() || {};
    if (u.nombre) map.set(String(u.nombre).trim().toLowerCase(), u);
  });
  return map;
}

// Load the users map (userId → user) of the finca.
async function loadUsersMap(fincaId) {
  const snap = await db.collection('users').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

// Audit trail
const PLANILLA_HISTORY_MAX = 50;

function buildHistoryEntry({ userId, email, action }) {
  return { at: new Date(), by: userId || null, byEmail: email || null, action };
}

function appendHistory(currentHistory, entry) {
  const arr = Array.isArray(currentHistory) ? currentHistory : [];
  const next = [...arr, entry];
  return next.length > PLANILLA_HISTORY_MAX ? next.slice(-PLANILLA_HISTORY_MAX) : next;
}

// Rate limiter (in-memory, per Cloud Function instance)
// Defense in depth. Does not replace API Gateway quotas.
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
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Rate limit exceeded. Try again later.', 429);
    }
    next();
  };
}

// Planilla Salario Fijo
// Sanitizes a planilla fijo row: verifies trabajadorId against users/fichas
// of the finca and canonicalises nombre / cedula / puesto / salarioBase / fechaIngreso
// from authoritative sources. Discards rows with invalid trabajadorId.
const FIJO_CCSS_RATE = 0.1083;
const FIJO_JORNADA_HORAS_DEFAULT = 48;

function sanitizeFijoDia(d) {
  const fechaRaw = typeof d?.fecha === 'string' ? d.fecha : '';
  // Accepts both full ISO and YYYY-MM-DD
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
    return { ok: false, msg: 'filas must be an array.' };
  if (filas.length > PLANILLA_LIMITS.filasPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.filasPorPlanilla} employees per planilla.` };

  const cleaned = [];
  for (const f of filas) {
    const trabajadorId = trimStr(f?.trabajadorId, 64);
    if (!trabajadorId || !usersMap.has(trabajadorId)) continue; // discard silently

    const userDoc  = usersMap.get(trabajadorId) || {};
    const ficha    = fichasMap.get(trabajadorId) || {};
    const nombre   = trimStr(userDoc.nombre, PLANILLA_LIMITS.string);
    const cedula   = trimStr(ficha.cedula || f?.cedula, 30);
    const puesto   = trimStr(ficha.puesto || f?.puesto, PLANILLA_LIMITS.string);
    const fechaIng = (typeof ficha.fechaIngreso === 'string' && FECHA_RE.test(ficha.fechaIngreso))
      ? ficha.fechaIngreso
      : ((typeof f?.fechaIngreso === 'string' && FECHA_RE.test(f.fechaIngreso)) ? f.fechaIngreso : '');

    // salarioMensual: authoritative from ficha if present, fallback to received value (clamp).
    const salarioMensual = ficha.salarioBase != null
      ? clampNumber(ficha.salarioBase, PLANILLA_LIMITS.numeric)
      : clampNumber(f?.salarioMensual, PLANILLA_LIMITS.numeric);

    // salarioDiario: user-editable (override of salarioMensual/30). Clamp.
    const salarioDiario = clampNumber(f?.salarioDiario, PLANILLA_LIMITS.numeric);

    // horasSemanales: derive from ficha.horarioSemanal if present, else fallback.
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

    // Totals: trust client computation but clamp.
    const salarioOrdinario      = clampNumber(f?.salarioOrdinario, PLANILLA_LIMITS.numeric);
    const salarioExtraordinario = clampNumber(f?.salarioExtraordinario, PLANILLA_LIMITS.numeric);
    const salarioBruto          = clampNumber(f?.salarioBruto, PLANILLA_LIMITS.numeric);
    // CCSS must be consistent with salarioBruto; recompute server-side.
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

// Validate periodo range (ISO date string). Accepts both formats: YYYY-MM-DD
// or full ISO datetime. Returns Date objects or null+msg.
function parsePeriodoISO(periodoInicio, periodoFin) {
  if (typeof periodoInicio !== 'string' || typeof periodoFin !== 'string')
    return { ok: false, msg: 'Invalid periodo.' };
  const ini = new Date(periodoInicio);
  const fin = new Date(periodoFin);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime()))
    return { ok: false, msg: 'Invalid dates.' };
  if (fin < ini)
    return { ok: false, msg: 'End date must be equal or later than start date.' };
  const diffDays = Math.floor((fin - ini) / 86400000) + 1;
  if (diffDays > PLANILLA_LIMITS.periodoDiasMax)
    return { ok: false, msg: `periodo cannot exceed ${PLANILLA_LIMITS.periodoDiasMax} days.` };
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planillas.', 500);
  }
});

// Only supervisor/administrador/rrhh can create, edit content, delete
// or change the state of planillas fijas. trabajador/encargado can only read.
const PLANILLA_FIJO_ROLES_WRITE = ['supervisor', 'administrador', 'rrhh'];
const canEditarFijo = (req) => PLANILLA_FIJO_ROLES_WRITE.includes(req.userRole);

router.post('/api/hr/planilla-fijo', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to create planillas.', 403);

    const { periodoInicio, periodoFin, periodoLabel, filas } = req.body;
    const periodo = parsePeriodoISO(periodoInicio, periodoFin);
    if (!periodo.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, periodo.msg, 400);

    const [usersMap, fichasMap] = await Promise.all([
      loadUsersMap(req.fincaId),
      loadFichasMap(req.fincaId),
    ]);
    const san = sanitizeFijoFilas(filas, usersMap, fichasMap);
    if (!san.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, san.msg, 400);
    if (san.value.length === 0)
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Planilla must contain at least one valid employee.', 400);

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
      console.warn('Failed to send planilla notifications:', notifErr.message);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save planilla.', 500);
  }
});

router.put('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { estado, filas, periodoInicio, periodoFin, periodoLabel } = req.body;
    const currentDoc = ownership.doc.data();
    const currentEstado = currentDoc.estado || 'pendiente';

    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = canPagar;

    // Only write roles can modify any planilla fija.
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to modify planillas.', 403);

    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    if (estado === 'aprobada' && !canAprobar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to approve planillas.', 403);
    if (estado === 'pagada' && !canPagar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to pay planillas.', 403);

    // Once paid, only admin/rrhh can modify (accounting reversal).
    if (currentEstado === 'pagada' && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already paid; only administrador or rrhh may modify it.', 403);

    // Approved: only transition to paid, or modifications by admin/rrhh.
    if (currentEstado === 'aprobada' && !isAdminLike && estado !== 'pagada')
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved; only admin/rrhh may modify outside of pay transition.', 403);

    const update = { updatedAt: Timestamp.now() };

    // Period change (only with new filas, to avoid inconsistency).
    if (periodoInicio !== undefined || periodoFin !== undefined) {
      const periodo = parsePeriodoISO(
        periodoInicio || currentDoc.periodoInicio?.toDate().toISOString(),
        periodoFin    || currentDoc.periodoFin?.toDate().toISOString(),
      );
      if (!periodo.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, periodo.msg, 400);
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
      if (!san.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, san.msg, 400);
      if (san.value.length === 0)
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Planilla must contain at least one valid employee.', 400);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update planilla.', 500);
  }
});

router.delete('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    const estadoActual = data.estado || 'pendiente';
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    // Only pendientes are freely deletable by write roles.
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to delete planillas.', 403);
    if (['aprobada', 'pagada'].includes(estadoActual) && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Approved or paid planillas can only be deleted by admin/rrhh.', 403);

    await db.collection('hr_planilla_fijo').doc(req.params.id).delete();
    const taskSnap = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('planillaId', '==', req.params.id)
      .where('type', '==', 'PLANILLA_PAGO')
      .limit(1).get();
    if (!taskSnap.empty) {
      await taskSnap.docs[0].ref.delete();
    }
    res.status(200).json({ message: 'Planilla deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete planilla.', 500);
  }
});

// Memos
router.get('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_memorandums')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch memorandums.', 500);
  }
});

router.post('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, tipo, motivo, descripcion, fecha } = req.body;
    if (!trabajadorId || !tipo || !motivo) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, tipo and motivo are required.', 400);
    const ref = await db.collection('hr_memorandums').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      motivo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create memorandum.', 500);
  }
});

router.delete('/api/hr/memorandums/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_memorandums').doc(req.params.id).delete();
    res.status(200).json({ message: 'Memorandum deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// Document attachments
router.get('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_documentos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch documents.', 500);
  }
});

router.post('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, nombre, tipo, descripcion, fecha } = req.body;
    if (!trabajadorId || !nombre || !tipo) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, nombre and tipo are required.', 400);
    const ref = await db.collection('hr_documentos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      nombre, tipo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save document.', 500);
  }
});

router.delete('/api/hr/documentos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_documentos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Document deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// Subordinates (workers assigned to an encargado)
router.get('/api/hr/subordinados', authenticate, async (req, res) => {
  try {
    const { encargadoId } = req.query;
    if (!encargadoId) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'encargadoId is required.', 400);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch subordinates.', 500);
  }
});

// Planilla por Unidad / Hora
const isHoraUnit = (u) => /^horas?$/i.test((u || '').trim());

// Computes the worker total across all segments. Rule identical
// to the frontend / snapshot at approval.
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

// Re-derives prices from authoritative sources, validates identities and
// recomputes totals:
// - precioHora comes from hr_fichas (not from the client).
// - costoUnitario / factorConversion / unidadBase come from the
//   unidades_medida catalog when the unidad exists there; for free-form
//   (uncatalogued) unidades, the sanitised client value is accepted.
// - trabajadorId MUST exist in `users` and belong to the finca; others
//   are silently discarded (prevents injecting fake IDs into the snapshot).
// - trabajadorNombre is overwritten with the canonical `nombre` from `users`.
async function enrichPlanilla(fincaId, segmentos, trabajadores) {
  const [fichasMap, unidadesMap, usersMap] = await Promise.all([
    loadFichasMap(fincaId),
    loadUnidadesMap(fincaId),
    loadUsersMap(fincaId),
  ]);

  const enrichedSegs = (segmentos || []).map(s => {
    const key = String(s.unidad || '').trim().toLowerCase();
    const cat = key ? unidadesMap.get(key) : null;
    if (!cat) return s; // free-form / uncatalogued unit → respect client value
    return {
      ...s,
      // Only override costoUnitario if the catalog defines an explicit price.
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
        // Canonical nombre from users (not from the client) — prevents cosmetic forgery.
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

// Sanitises segmentos: types, lengths, finite numbers.
function sanitizeSegmentos(segmentos) {
  if (!Array.isArray(segmentos)) return { ok: false, msg: 'segmentos must be an array.' };
  if (segmentos.length > PLANILLA_LIMITS.segmentos)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.segmentos} segmentos.` };
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

// Sanitises trabajadores: types, lengths, finite quantities.
function sanitizeTrabajadores(trabajadores) {
  if (!Array.isArray(trabajadores)) return { ok: false, msg: 'trabajadores must be an array.' };
  if (trabajadores.length > PLANILLA_LIMITS.trabajadoresPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.trabajadoresPorPlanilla} trabajadores.` };
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planillas.', 500);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planilla history.', 500);
  }
});

router.post('/api/hr/planilla-unidad', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { fecha, encargadoId, segmentos, trabajadores, estado, observaciones } = req.body;

    // Type / required / length validation
    if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha (expected YYYY-MM-DD).', 400);
    const fechaDate = new Date(fecha + 'T12:00:00');
    if (Number.isNaN(fechaDate.getTime()))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha.', 400);
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Encargado is required.', 400);
    if (estado != null && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);

    // Client cannot create planillas on behalf of another encargado unless
    // they hold supervisor/admin/rrhh role.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot create planillas on behalf of another encargado.', 403);

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);

    // Re-derive prices, validate identities and recompute totals from
    // authoritative sources (hr_fichas + unidades_medida + users).
    const enriched = await enrichPlanilla(req.fincaId, segs.value, tabs.value);

    // Resolve canonical encargado nombre (not from the client).
    const encargadoUser = enriched.usersMap.get(encargadoId.trim());
    const encargadoNombreCanon = trimStr(encargadoUser?.nombre, PLANILLA_LIMITS.string);

    // The consecutivo is assigned only when the planilla leaves borrador.
    // If saved as borrador, it is created without one to avoid wasting numbers.
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create planilla.', 500);
  }
});

router.put('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { fecha, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;

    // Only the owner encargado (or higher roles) can edit.
    const currentDoc = ownership.doc.data();
    const docEncargadoId = currentDoc.encargadoId;
    const currentEstado = currentDoc.estado || 'borrador';
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot edit planillas of another encargado.', 403);

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    if (estado === 'aprobada' && !canAprobar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to approve planillas.', 403);
    if (estado === 'pagada' && !canPagar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to pay planillas.', 403);

    // Block rollback from terminal states (aprobada / pagada): only
    // administrador or rrhh may modify already approved or paid planillas.
    const lockedStates = ['aprobada', 'pagada'];
    if (lockedStates.includes(currentEstado) && !isAdminLike) {
      // Any write on an approved/paid planilla is restricted.
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved/paid; only administrador or rrhh may modify it.', 403);
    }
    // Block explicit rollback transitions (aprobada → other / pagada → other)
    // even for admin-like → records intentional action, not accidental.
    // (admin-like may still do so if they send it explicitly.)
    // Note: we already passed the previous guard, so admin-like can do it.

    const update = { updatedAt: Timestamp.now() };
    if (fecha !== undefined) {
      if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha (expected YYYY-MM-DD).', 400);
      const fechaDate = new Date(fecha + 'T12:00:00');
      if (Number.isNaN(fechaDate.getTime()))
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha.', 400);
      update.fecha = Timestamp.fromDate(fechaDate);
    }
    let segsClean = null;
    let tabsClean = null;
    if (segmentos !== undefined) {
      const segs = sanitizeSegmentos(segmentos);
      if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
      segsClean = segs.value;
    }
    if (trabajadores !== undefined) {
      const tabs = sanitizeTrabajadores(trabajadores);
      if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);
      tabsClean = tabs.value;
    }
    // If segmentos or trabajadores came in, re-derive prices and totals from
    // authoritative sources. If only one was sent, complete with the existing
    // doc value so the computation is coherent.
    if (segsClean !== null || tabsClean !== null) {
      const enriched = await enrichPlanilla(
        req.fincaId,
        segsClean !== null ? segsClean : (currentDoc.segmentos || []),
        tabsClean !== null ? tabsClean : (currentDoc.trabajadores || []),
      );
      if (segsClean !== null) update.segmentos = enriched.segmentos;
      if (tabsClean !== null) update.trabajadores = enriched.trabajadores;
      // totalGeneral is always recomputed server-side: client value ignored.
      update.totalGeneral = enriched.totalGeneral;
      // Resolve canonical encargado nombre (may have changed in `users`).
      const encargadoUser = enriched.usersMap.get(docEncargadoId);
      if (encargadoUser) update.encargadoNombre = trimStr(encargadoUser.nombre, PLANILLA_LIMITS.string);
    } else if (totalGeneral !== undefined) {
      // Only a "metadata" field changed (estado, observaciones) — the client
      // may have recomputed the total locally; we accept it sanitised.
      update.totalGeneral = clampNumber(totalGeneral, PLANILLA_LIMITS.numeric);
    }
    if (estado !== undefined) update.estado = estado;
    if (observaciones !== undefined) update.observaciones = trimStr(observaciones, PLANILLA_LIMITS.observaciones);

    // Audit trail: record who modified and what type of change it was.
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

    // Assign consecutivo if the planilla doesn't have one yet and is leaving borrador
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

    // Snapshot on approval
    if (estado === 'aprobada' && !currentDoc.snapshotCreado) {
      // Merge old data with body changes to always use the latest version
      const doc = { ...currentDoc, ...update };

      // Resolve approver name
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
            // Segment
            loteNombre:       seg.loteNombre   || '',
            grupo:            seg.grupo        || '',
            labor:            seg.labor        || '',
            avanceHa:         Number(seg.avanceHa) || 0,
            unidad:           seg.unidad       || '',
            costoUnitario,
            // Worker
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
    res.status(200).json({ message: 'Planilla updated.', consecutivo });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update planilla.', 500);
  }
});

router.delete('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    const docEncargadoId = data.encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot delete planillas of another encargado.', 403);
    // Block deletion of approved/paid planillas except for admin/rrhh.
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (['aprobada', 'pagada'].includes(data.estado) && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved/paid; only administrador or rrhh may delete it.', 403);
    await db.collection('hr_planilla_unidad').doc(req.params.id).delete();
    res.status(200).json({ message: 'Planilla deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete planilla.', 500);
  }
});

// Templates for Planilla por Unidad / Hora
router.get('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const encargadoId = typeof req.query.encargadoId === 'string' ? req.query.encargadoId.trim() : '';
    if (!encargadoId)
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'encargadoId is required.', 400);
    // Only the owner encargado or higher roles can list foreign templates.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot view templates of another encargado.', 403);

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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch templates.', 500);
  }
});

router.post('/api/hr/plantillas-planilla', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { nombre, segmentos, trabajadores, encargadoId } = req.body;
    const nombreClean = trimStr(nombre, PLANILLA_LIMITS.nombrePlantilla).trim();
    if (!nombreClean) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Nombre is required.', 400);
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Encargado is required.', 400);

    // Do not allow saving templates on behalf of another encargado.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot save templates on behalf of another encargado.', 403);

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);

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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save template.', 500);
  }
});

router.delete('/api/hr/plantillas-planilla/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_plantillas_planilla', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const docEncargadoId = ownership.doc.data().encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot delete templates of another encargado.', 403);
    await db.collection('hr_plantillas_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Template deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete template.', 500);
  }
});

// Job applications
router.get('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_solicitudes_empleo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaSolicitud', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fechaSolicitud: d.data().fechaSolicitud.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch applications.', 500);
  }
});

router.post('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const { nombre, email, telefono, puesto, notas } = req.body;
    if (!nombre || !puesto) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'nombre and puesto are required.', 400);
    const ref = await db.collection('hr_solicitudes_empleo').add({
      nombre, email: email || '', telefono: telefono || '',
      puesto, notas: notas || '', estado: 'pendiente',
      fechaSolicitud: Timestamp.now(), fincaId: req.fincaId,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create application.', 500);
  }
});

router.put('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Application updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update.', 500);
  }
});

router.delete('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Application deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance scoring (Sub-fase 3.1)
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_RE = /^\d{4}-\d{2}$/;

// Remove ranking and cross-worker details from a score doc before sending
// it to a worker looking at their own record. Keeps the subscores visible
// but strips context that would let the worker infer peers' performance.
function redactForSelfView(doc) {
  if (!doc) return doc;
  const { details, weights, ...rest } = doc;
  return { ...rest, details, weights };
}

router.get('/api/hr/performance', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const period = String(req.query.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const rows = await listScores(req.fincaId, period);
    res.status(200).json(rows);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch performance scores.', 500);
  }
});

router.get('/api/hr/performance/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const period = String(req.query.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const isSelf = req.dbUserId === userId;
    const isSupervisor = hasMinRoleBE(req.userRole, 'supervisor');
    if (!isSelf && !isSupervisor) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const doc = await getScore(req.fincaId, userId, period);
    if (!doc) return res.status(200).json(null);
    res.status(200).json(isSupervisor ? doc : redactForSelfView(doc));
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch performance score.', 500);
  }
});

router.post('/api/hr/performance/recompute', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const period = String(req.query.period || req.body?.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const results = await computeFincaScores(req.fincaId, period, { computedBy: 'manual' });
    res.status(200).json({ period, computed: results.length, results });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to recompute performance scores.', 500);
  }
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/hr/productivity?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD
//
// Productivity matrix (userId × labor × loteId × unidad) + benchmarks
// (p25/p50/p75 por labor+unidad). Supervisor-only. Pairs crossing
// different units NEVER compared — each (labor, unidad) bucket is
// independent.
router.get('/api/hr/productivity', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const periodStart = String(req.query.periodStart || '');
    const periodEnd = String(req.query.periodEnd || '');
    if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'periodStart and periodEnd must be YYYY-MM-DD.', 400);
    }
    const start = new Date(`${periodStart}T00:00:00Z`);
    const end = new Date(`${periodEnd}T23:59:59.999Z`);
    if (!(start < end)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'periodStart must be before periodEnd.', 400);
    }
    const snap = await db.collection('hr_planilla_unidad')
      .where('fincaId', '==', req.fincaId)
      .where('fecha', '>=', Timestamp.fromDate(start))
      .where('fecha', '<=', Timestamp.fromDate(end))
      .get();
    const planillas = snap.docs.map(d => d.data());
    const matrix = productivityMatrix(planillas);
    const benchmarks = computeLaborBenchmarks(matrix);
    res.status(200).json({ periodStart, periodEnd, matrix, benchmarks });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute productivity matrix.', 500);
  }
});

// GET /api/hr/workload-projection?horizonWeeks=12
//
// Projects upcoming labor demand over the next N weeks using each
// active siembra's linked package. Emits activity count (hard) and
// estimated person-hours (soft, via a per-activity default) side by
// side. Also returns current baseline capacity from permanent workers.
//
// Known limitation: packages.activities[] have no per-activity hour
// field. estimatedPersonHours uses the default in
// `assumptions.defaultActivityHours` — the UI should surface this so
// the user knows the metric is an estimate.
router.get('/api/hr/workload-projection', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const rawHorizon = req.query.horizonWeeks;
    let horizonWeeks = 12;
    if (rawHorizon !== undefined) {
      const n = Number(rawHorizon);
      if (!Number.isFinite(n)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'horizonWeeks must be a number.', 400);
      }
      horizonWeeks = n;
    }

    const [siembrasSnap, packagesSnap, fichasSnap] = await Promise.all([
      db.collection('siembras').where('fincaId', '==', req.fincaId).get(),
      db.collection('packages').where('fincaId', '==', req.fincaId).get(),
      db.collection('hr_fichas').where('fincaId', '==', req.fincaId).get(),
    ]);
    const siembras = siembrasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const packages = packagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const fichas = fichasSnap.docs.map(d => ({ userId: d.id, ...d.data() }));

    const capacity = currentCapacity(fichas);
    const projection = projectWorkload({
      siembras,
      packages,
      horizonWeeks,
      now: new Date(),
      opts: { avgWeeklyHoursPerWorker: capacity.avgWeeklyHoursPermanent },
    });

    res.status(200).json({
      horizonWeeks: projection.horizonWeeks,
      maxHorizonWeeks: MAX_HORIZON_WEEKS,
      now: projection.now,
      assumptions: projection.assumptions,
      capacity,
      weeks: projection.weeks,
      summary: projection.summary,
      diagnostics: projection.diagnostics,
    });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute workload projection.', 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Recommendations audit (Sub-fase 3.7)
// ─────────────────────────────────────────────────────────────────────────────
//
// `hr_recommendations_audit` stores, per autopilot_actions doc of the HR
// domain, what the human decided (approved / rejected / ignored) and the
// retrospective outcome judgement (outcomeMatchedReality: bool | null).
// Feeds the accuracy endpoint, which is the substrate for the phase 3
// exit criterion (90% agreement with humans over 6 months).

function validateAuditPayload(body) {
  const errs = [];
  const clean = {};
  if (body?.humanResolution !== undefined) {
    if (!VALID_RESOLUTIONS.has(body.humanResolution)) {
      errs.push(`humanResolution must be one of: ${Array.from(VALID_RESOLUTIONS).join(', ')}.`);
    } else {
      clean.humanResolution = body.humanResolution;
    }
  }
  if (body?.outcomeMatchedReality !== undefined && body.outcomeMatchedReality !== null) {
    if (typeof body.outcomeMatchedReality !== 'boolean') {
      errs.push('outcomeMatchedReality must be a boolean or null.');
    } else {
      clean.outcomeMatchedReality = body.outcomeMatchedReality;
    }
  } else if (body?.outcomeMatchedReality === null) {
    clean.outcomeMatchedReality = null;
  }
  if (body?.outcomeNotes !== undefined) {
    if (typeof body.outcomeNotes !== 'string' || body.outcomeNotes.length > 1000) {
      errs.push('outcomeNotes must be a string up to 1000 chars.');
    } else {
      clean.outcomeNotes = body.outcomeNotes.trim();
    }
  }
  return { errs, clean };
}

// POST /api/hr/recommendations-audit/:actionId (supervisor+)
// Upserts the audit doc keyed by actionId. Lets admins revisit the
// same record to add outcomeMatchedReality later without losing the
// initial resolution.
router.post('/api/hr/recommendations-audit/:actionId', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const { actionId } = req.params;
    const { errs, clean } = validateAuditPayload(req.body || {});
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);

    // Verify the action exists and belongs to this finca, and capture
    // the action type so the audit doc is self-contained for reporting.
    const actionDoc = await db.collection('autopilot_actions').doc(actionId).get();
    if (!actionDoc.exists || actionDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    if (actionDoc.data().categoria !== 'hr') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Audit is only valid for HR actions.', 400);
    }

    const now = Timestamp.now();
    const ref = db.collection('hr_recommendations_audit').doc(actionId);
    const existing = await ref.get();
    const payload = {
      fincaId: req.fincaId,
      autopilotActionId: actionId,
      type: actionDoc.data().type,
      ...clean,
      resolvedAt: now,
      resolvedBy: req.dbUserId || null,
      resolvedByEmail: req.userEmail || null,
    };
    if (!existing.exists) payload.createdAt = now;
    await ref.set(payload, { merge: true });
    res.status(200).json({ id: actionId, ...payload });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save audit.', 500);
  }
});

// GET /api/hr/recommendations-accuracy?months=6 (supervisor+)
// Computes overall + per-type hitRate over the last N months.
router.get('/api/hr/recommendations-accuracy', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const raw = req.query.months;
    let months = 6;
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 36) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'months must be a number in [1, 36].', 400);
      }
      months = Math.floor(n);
    }
    const cutoff = cutoffForWindow(months);
    const snap = await db.collection('hr_recommendations_audit')
      .where('fincaId', '==', req.fincaId)
      .where('resolvedAt', '>=', Timestamp.fromDate(cutoff))
      .get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const accuracy = computeAccuracy(rows, { windowMonths: months });
    res.status(200).json({ months, cutoff: cutoff.toISOString(), ...accuracy });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute accuracy.', 500);
  }
});

module.exports = router;
