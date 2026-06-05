// HR — Permisos / Vacaciones.
//
// Sub-archivo del split de routes/hr.js. Maneja la colección hr_permisos:
// vacaciones / enfermedad / licencias. La aprobación deriva el descuento en
// planilla, por eso aprobar/rechazar exige supervisor+ y queda auditado.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { TIME_RE, DATE_RE } = require('./helpers');

const router = Router();

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
      // Whitelist explícita en vez de spread `...dt`: cualquier campo nuevo que
      // se agregue al doc no viaja al cliente sin una decisión deliberada.
      return {
        id: d.id,
        trabajadorId: dt.trabajadorId || '',
        trabajadorNombre: dt.trabajadorNombre || '',
        tipo: dt.tipo || '',
        estado: dt.estado || '',
        dias: dt.dias ?? 0,
        horas: dt.horas ?? 0,
        esParcial: dt.esParcial === true,
        horaInicio: dt.horaInicio ?? null,
        horaFin: dt.horaFin ?? null,
        motivo: dt.motivo || '',
        conGoce: dt.conGoce !== false,
        fincaId: dt.fincaId || '',
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
      // Nombre canónico del doc `users` (no el del payload): el cliente no debe
      // poder guardar un nombre que no corresponda al trabajadorId validado.
      trabajadorNombre: workerDoc.data().nombre || clean.trabajadorNombre || '',
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

router.put('/api/hr/permisos/:id', authenticate, rateLimit('hr_permisos_write', 'write'), async (req, res) => {
  try {
    // Cambiar el estado de un permiso (incluido revertir a pendiente) altera el
    // flujo que descuenta/justifica nómina — operación de RR.HH., encargado+ only.
    // Sin este piso un trabajador podía revertir aprobaciones de toda la finca.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to update permiso.', 403);
    }
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
    // Toda transición de estado vuelve efectivo (o revierte) un permiso que
    // descuenta/justifica nómina — operación privilegiada con valor forense.
    // Se audita también revertir a pendiente (deshace una decisión previa).
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
    res.status(200).json({ message: 'Permiso updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update permiso.', 500);
  }
});

router.delete('/api/hr/permisos/:id', authenticate, rateLimit('hr_permisos_write', 'write'), async (req, res) => {
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
