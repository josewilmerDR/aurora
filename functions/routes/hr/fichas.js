// HR — Worker Fichas.
//
// Sub-archivo del split de routes/hr.js. Maneja la colección hr_fichas:
// puesto, salario, horario, cédula y contacto de emergencia de cada
// trabajador. Asistencia y permisos viven en sus propios sub-archivos
// (asistencia.js, permisos.js).

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { TIME_RE } = require('./helpers');

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

router.get('/api/hr/fichas', authenticate, rateLimit('hr_fichas_read', 'costly_read'), async (req, res) => {
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

router.get('/api/hr/fichas/:userId', authenticate, rateLimit('hr_fichas_read', 'costly_read'), async (req, res) => {
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
    const fichaRef = db.collection('hr_fichas').doc(req.params.userId);
    const prevSnap = await fichaRef.get();
    const prev = prevSnap.exists ? prevSnap.data() : {};
    await fichaRef.set(
      { ...clean, fincaId: req.fincaId, updatedAt: Timestamp.now() },
      { merge: true }
    );

    // Audit ONLY salary/precio-hora changes: it's the monetary base of payroll
    // (forensic: quién subió/bajó el salario de quién, de cuánto a cuánto). The
    // rest of the ficha (puesto, horario, contacto, notas) is routine editing
    // and stays out of the stream, aligned with auditLog.js policy.
    const salaryChanged = ['salarioBase', 'precioHora'].some(
      k => clean[k] !== undefined && (prev[k] ?? null) !== (clean[k] ?? null)
    );
    if (salaryChanged) {
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.HR_FICHA_SALARY_CHANGE,
        target: { type: 'user', id: req.params.userId },
        metadata: {
          salarioBase: { from: prev.salarioBase ?? null, to: clean.salarioBase ?? null },
          precioHora: { from: prev.precioHora ?? null, to: clean.precioHora ?? null },
        },
        severity: SEVERITY.WARNING,
      });
    }

    res.status(200).json({ message: 'Ficha updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save ficha.', 500);
  }
});

module.exports = router;
