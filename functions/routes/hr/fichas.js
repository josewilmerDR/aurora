// HR — Fichas, asistencia y permisos.
//
// Sub-archivo del split de routes/hr.js. Agrupa los CRUDs "people-baseline"
// que operan sobre los datos de cada trabajador en la finca:
//   - hr_fichas         → puesto, salario, horario, contacto de emergencia
//   - hr_asistencia     → asistencia diaria con horasExtra opcionales;
//                         endpoint batch usa doc id determinista
//                         `${trabajadorId}_${fecha}` (upsert idempotente)
//   - hr_permisos       → vacaciones / enfermedad / licencias

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { TIME_RE, DATE_RE } = require('./helpers');

const router = Router();

// ─── Worker Fichas ───────────────────────────────────────────────────────

const FICHA_TIPOS_CONTRATO = ['permanente', 'temporal', 'por_obra'];
const FICHA_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const PHONE_RE_FICHA = /^[\d\s+\-()]+$/;
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
    // Fichas carry salaries, cédula and emergency contacts. Gate to encargado+
    // so a trabajador can't enumerate the finca's payroll via direct API call
    // (the UI already gates every ficha/payroll/cost page to encargado+).
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read HR fichas.', 403);
    }
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
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read an HR ficha.', 403);
    }
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

router.put('/api/hr/fichas/:userId', authenticate, rateLimit('hr_fichas_write', 'write'), async (req, res) => {
  try {
    // Writing a ficha sets salary/cédula/emergency contact — encargado+ only,
    // matching the EmployeeProfile page (the sole UI caller) and blocking a
    // trabajador from tampering with payroll via direct API call.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can write an HR ficha.', 403);
    }
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    // Only payroll employees can have an HR ficha. This guards against
    // accidentally creating fichas for system-only users from any caller
    // (chat tools, scripts, future UIs) — the proper flow is grant-planilla
    // first, then PUT the ficha.
    if (userDoc.data().empleadoPlanilla !== true) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'User is not on payroll. Grant planilla before saving an HR ficha.', 400);
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

// ─── Asistencia ──────────────────────────────────────────────────────────

const ASISTENCIA_ESTADOS = ['presente', 'ausente', 'vacaciones', 'incapacidad', 'permiso'];
const ASISTENCIA_BATCH_MAX = 200;
const ASISTENCIA_FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ASISTENCIA_NOTAS_MAX = 500;

router.get('/api/hr/asistencia', authenticate, rateLimit('hr_asistencia_read', 'costly_read'), async (req, res) => {
  try {
    // La asistencia (estado/horas extra/notas de cada trabajador) es dato de
    // nómina — encargado+ only, igual que fichas/planilla. Sin esto cualquier
    // trabajador leía la cuadrilla completa por llamada directa.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read attendance.', 403);
    }
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

router.post('/api/hr/asistencia', authenticate, rateLimit('hr_asistencia_write', 'write'), async (req, res) => {
  try {
    // Mismo boundary que el batch: escribe la base de nómina, así que exige
    // encargado+, valida estado contra la enum, la fecha con regex y que el
    // trabajador pertenezca a la finca (no se confía el nombre del cliente —
    // se canoniza desde users).
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register attendance.', 403);
    }
    const { trabajadorId, fecha, estado, horasExtra, notas } = req.body || {};
    const id = String(trabajadorId || '').trim();
    if (!id || !ASISTENCIA_FECHA_RE.test(String(fecha)) || !ASISTENCIA_ESTADOS.includes(String(estado))) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `trabajadorId, fecha (YYYY-MM-DD) and a valid estado (${ASISTENCIA_ESTADOS.join(', ')}) are required.`, 400);
    }
    const workerDoc = await db.collection('users').doc(id).get();
    if (!workerDoc.exists || workerDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid worker.', 400);
    }
    const ref = await db.collection('hr_asistencia').add({
      trabajadorId: id,
      trabajadorNombre: workerDoc.data().nombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      estado,
      horasExtra: Math.max(0, Math.min(24, Number(horasExtra) || 0)),
      notas: String(notas || '').slice(0, ASISTENCIA_NOTAS_MAX),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register attendance.', 500);
  }
});

// Batch upsert: registra la asistencia de toda la cuadrilla para una fecha
// en un solo request. Usa doc id determinista `${trabajadorId}_${fecha}`
// para que reenviar el mismo día sobreescriba en lugar de duplicar — la
// asistencia es naturalmente "una por trabajador por día".
router.post('/api/hr/asistencia/batch', authenticate, rateLimit('hr_asistencia_write', 'write'), async (req, res) => {
  try {
    // Escribe la base de nómina (estado/horas extra) de toda la cuadrilla.
    // encargado+ only, igual que el resto del módulo HR — la UI lo gatea a
    // encargado pero el backend es el boundary real ante una llamada directa.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can save attendance.', 403);
    }
    const { fecha, registros } = req.body || {};
    if (!fecha || !ASISTENCIA_FECHA_RE.test(String(fecha))) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'fecha must be YYYY-MM-DD.', 400);
    }
    if (!Array.isArray(registros) || registros.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'registros must be a non-empty array.', 400);
    }
    if (registros.length > ASISTENCIA_BATCH_MAX) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Maximum ${ASISTENCIA_BATCH_MAX} registros per batch.`, 400);
    }

    // Cargo users de la finca una sola vez para validar trabajadorIds y
    // canonizar el nombre desde fuente autoritativa (no confío en cliente).
    const usersSnap = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const userMap = new Map(usersSnap.docs.map(d => [d.id, d.data()]));

    const errors = [];
    const cleaned = [];
    const seenIds = new Set();
    for (let i = 0; i < registros.length; i++) {
      const r = registros[i] || {};
      const id = String(r.trabajadorId || '').trim();
      const estado = String(r.estado || '').trim();
      if (!id || !userMap.has(id)) {
        errors.push({ index: i, msg: 'trabajadorId is invalid or does not belong to the finca.' });
        continue;
      }
      if (seenIds.has(id)) {
        errors.push({ index: i, msg: 'Duplicate trabajadorId in the same batch.' });
        continue;
      }
      if (!ASISTENCIA_ESTADOS.includes(estado)) {
        errors.push({ index: i, msg: `estado must be one of: ${ASISTENCIA_ESTADOS.join(', ')}.` });
        continue;
      }
      seenIds.add(id);
      cleaned.push({
        trabajadorId: id,
        trabajadorNombre: userMap.get(id).nombre || '',
        estado,
        horasExtra: Math.max(0, Math.min(24, Number(r.horasExtra) || 0)),
        notas: String(r.notas || '').slice(0, ASISTENCIA_NOTAS_MAX),
      });
    }

    if (errors.length) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, JSON.stringify(errors), 400);
    }

    const fechaTs = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    const now = Timestamp.now();
    const batch = db.batch();
    cleaned.forEach(r => {
      const docId = `${r.trabajadorId}_${fecha}`;
      const ref = db.collection('hr_asistencia').doc(docId);
      // merge:true sobre id determinista da upsert idempotente. Sólo
      // escribimos updatedAt; createdAt requeriría un read previo por doc
      // (~200 reads extra) que no aporta — el doc snapshot ya guarda su
      // creation time, y el caso operativo (auditoría) usa updatedAt.
      batch.set(ref, {
        ...r,
        fecha: fechaTs,
        fincaId: req.fincaId,
        updatedAt: now,
      }, { merge: true });
    });
    await batch.commit();

    res.status(200).json({ saved: cleaned.length });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save batch attendance.', 500);
  }
});

router.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    // Los doc id son deterministas (`${trabajadorId}_${fecha}`) → adivinables.
    // Sin verifyOwnership cualquier autenticado borraría registros de OTRA
    // finca. Y borrar asistencia es irreversible y altera la nómina, así que
    // exigimos encargado+ y dejamos rastro forense.
    const ownership = await verifyOwnership('hr_asistencia', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to delete attendance.', 403);
    }
    const prev = ownership.doc.data() || {};
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.ASISTENCIA_DELETE,
      target: { type: 'asistencia', id: req.params.id },
      metadata: {
        trabajadorId: prev.trabajadorId || null,
        estado: prev.estado || null,
        horasExtra: prev.horasExtra ?? null,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

// ─── Permisos / Vacaciones ───────────────────────────────────────────────

const PERMISO_TIPOS = ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'];
const PERMISO_ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
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

router.get('/api/hr/permisos', authenticate, rateLimit('hr_permisos_read', 'costly_read'), async (req, res) => {
  try {
    // Los permisos llevan `motivo` y tipo `enfermedad` (dato cuasi-médico) de
    // toda la finca. encargado+ only — sin esto un trabajador leía las
    // ausencias y motivos de salud de todos sus compañeros.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read permisos.', 403);
    }
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

router.post('/api/hr/permisos', authenticate, rateLimit('hr_permisos_write', 'write'), async (req, res) => {
  try {
    // Crear permisos a nombre de cualquier trabajador es operación de RR.HH.
    // (alimenta el flujo de aprobación que descuenta nómina). encargado+ only
    // — sin esto un trabajador podía generar solicitudes falsas para terceros.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create permisos.', 403);
    }
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

    const prev = ownership.doc.data() || {};
    await db.collection('hr_permisos').doc(req.params.id).update({
      estado, updatedAt: Timestamp.now(),
    });
    // Aprobar/rechazar vuelve efectivo (o revierte) un permiso que descuenta/
    // justifica nómina — operación privilegiada con valor forense.
    if (estado === 'aprobado' || estado === 'rechazado') {
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.PERMISO_DECISION,
        target: { type: 'permiso', id: req.params.id },
        metadata: {
          estado,
          previousEstado: prev.estado || null,
          trabajadorId: prev.trabajadorId || null,
          tipo: prev.tipo || null,
        },
        severity: SEVERITY.WARNING,
      });
    }
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
    const prev = ownership.doc.data() || {};
    await db.collection('hr_permisos').doc(req.params.id).delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PERMISO_DELETE,
      target: { type: 'permiso', id: req.params.id },
      metadata: {
        trabajadorId: prev.trabajadorId || null,
        tipo: prev.tipo || null,
        estado: prev.estado || null,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ message: 'Permiso deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete permiso.', 500);
  }
});

module.exports = router;
