// User facet endpoints — grant / revoke access and planilla.
//
// These give the frontend a clean way to flip a single facet without having
// to reason about the rol/email/restrictedTo cross-field rules. Each one is
// idempotent: granting an already-granted facet returns 200 with no side
// effect, so retries from the UI are safe.
//
// Lives apart from users.js (CRUD) to keep both files under the <500 LOC
// route-file budget; shared invariants are imported from users.shared.js.

const { Router } = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const {
  ROLES_VALIDOS, EMAIL_RE, LIMITS,
  cleanRestrictedTo, parseFechaSalida,
} = require('./users.shared');

const router = Router();

function requireAdmin(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return res.status(403).json({ message: 'Solo administradores pueden gestionar usuarios.' });
  }
  next();
}

// POST /api/users/:id/grant-access  { rol, restrictedTo? }
router.post('/api/users/:id/grant-access', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const current = ownership.doc.data();

    const rol = req.body?.rol;
    if (!rol || rol === 'ninguno' || !ROLES_VALIDOS.includes(rol)) {
      return res.status(400).json({ message: 'Rol inválido. Debe ser distinto de "ninguno".' });
    }
    const email = (current.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'La persona no tiene un email válido. Actualízalo antes de darle acceso.' });
    }

    const restrictedTo = cleanRestrictedTo(req.body?.restrictedTo) || [];
    await db.collection('users').doc(id).update({
      tieneAcceso: true,
      rol,
      restrictedTo,
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_ACCESS_GRANT,
      target: { type: 'user', id },
      metadata: {
        email,
        rol,
        previouslyHadAccess: current.tieneAcceso === true,
      },
      severity: (rol === 'administrador' || rol === 'supervisor') ? SEVERITY.WARNING : SEVERITY.INFO,
    });

    res.status(200).json({ id, tieneAcceso: true, rol, restrictedTo });
  } catch (error) {
    console.error('[users:grant-access]', error);
    res.status(500).json({ message: 'Error al otorgar acceso.' });
  }
});

// POST /api/users/:id/revoke-access
router.post('/api/users/:id/revoke-access', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const current = ownership.doc.data();
    const targetEmail = (current.email || '').toLowerCase();
    if (req.userEmail && targetEmail === req.userEmail.toLowerCase()) {
      return res.status(403).json({ message: 'No puedes revocarte el acceso al sistema a ti mismo.' });
    }

    // Idempotent: already revoked → return ok without rewriting the doc or
    // re-emitting an audit event (which would otherwise mask the real revocation).
    if (current.tieneAcceso !== true) {
      return res.status(200).json({ id, tieneAcceso: false, alreadyRevoked: true });
    }

    await db.collection('users').doc(id).update({
      tieneAcceso: false,
      rol: 'ninguno',
      restrictedTo: [],
    });

    // Drop the membership so the next authenticated request from this person
    // fails the membership check. Without this the user could keep using the
    // app until their Firebase token expires.
    if (targetEmail) {
      const memSnap = await db.collection('memberships')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', targetEmail)
        .limit(1)
        .get();
      if (!memSnap.empty) await memSnap.docs[0].ref.delete();
    }

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_ACCESS_REVOKE,
      target: { type: 'user', id },
      metadata: {
        email: targetEmail || null,
        previousRol: current.rol || null,
        stillEmpleado: current.empleadoPlanilla === true,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ id, tieneAcceso: false });
  } catch (error) {
    console.error('[users:revoke-access]', error);
    res.status(500).json({ message: 'Error al revocar acceso.' });
  }
});

// POST /api/users/:id/grant-planilla
router.post('/api/users/:id/grant-planilla', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const current = ownership.doc.data();
    const wasRehire = current.tuvoEmpleo === true;

    const updates = {
      empleadoPlanilla: true,
      tuvoEmpleo: true,
      // Clear any prior termination fields — rehiring an ex-employee should
      // not leave their old fechaSalida hanging around.
      fechaSalidaPlanilla: FieldValue.delete(),
      motivoSalidaPlanilla: FieldValue.delete(),
    };
    await db.collection('users').doc(id).update(updates);

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_PLANILLA_GRANT,
      target: { type: 'user', id },
      metadata: {
        email: (current.email || '').toLowerCase() || null,
        rehire: wasRehire,
        previouslyOnPlanilla: current.empleadoPlanilla === true,
      },
      severity: SEVERITY.INFO,
    });

    res.status(200).json({ id, empleadoPlanilla: true, rehire: wasRehire });
  } catch (error) {
    console.error('[users:grant-planilla]', error);
    res.status(500).json({ message: 'Error al asignar planilla.' });
  }
});

// POST /api/users/:id/revoke-planilla  { motivo?, fecha? }
router.post('/api/users/:id/revoke-planilla', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const current = ownership.doc.data();
    const targetEmail = (current.email || '').toLowerCase();
    if (req.userEmail && targetEmail === req.userEmail.toLowerCase()) {
      return res.status(403).json({ message: 'No puedes rescindir tu propio contrato.' });
    }

    if (current.empleadoPlanilla !== true) {
      return res.status(200).json({ id, empleadoPlanilla: false, alreadyRevoked: true });
    }

    const motivo = typeof req.body?.motivo === 'string'
      ? req.body.motivo.trim().slice(0, LIMITS.motivoSalida)
      : '';
    const fechaSalida = parseFechaSalida(req.body?.fecha);

    await db.collection('users').doc(id).update({
      empleadoPlanilla: false,
      fechaSalidaPlanilla: fechaSalida,
      motivoSalidaPlanilla: motivo,
      // tuvoEmpleo is monotonic — never reverts. Setting it again explicitly
      // covers the (paranoid) case where the doc somehow lacks it.
      tuvoEmpleo: true,
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_PLANILLA_REVOKE,
      target: { type: 'user', id },
      metadata: {
        email: targetEmail || null,
        motivo: motivo || null,
        fecha: fechaSalida.toDate().toISOString().slice(0, 10),
        stillHasAccess: current.tieneAcceso === true,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ id, empleadoPlanilla: false });
  } catch (error) {
    console.error('[users:revoke-planilla]', error);
    res.status(500).json({ message: 'Error al rescindir contrato.' });
  }
});

module.exports = router;
