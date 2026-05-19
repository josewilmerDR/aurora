const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { MODULE_PREFIXES } = require('../lib/moduleMap');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// Conceptual model: the `users` collection holds **people**. Each person can
// have two independent facets:
//   - tieneAcceso=true       → can log into the system; uses `rol` + `restrictedTo`.
//   - empleadoPlanilla=true  → is on payroll; has `hr_fichas/{id}` and HR records.
// A person can be one, the other, both, or neither (but the API rejects creating
// a doc with both flags false).
//
// Once a person has been on payroll (tuvoEmpleo=true), the doc is immortal:
// hard-delete is refused so historical HR records keep their FK target.
// Lifecycle is then driven via grant/revoke endpoints which only flip flags.

const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;
const LIMITS = { nombre: 80, email: 120, telefono: 20, motivoSalida: 200 };
const MODULE_IDS = new Set(Object.keys(MODULE_PREFIXES));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanRestrictedTo(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  for (const v of raw) {
    if (typeof v === 'string' && MODULE_IDS.has(v)) seen.add(v);
  }
  return [...seen].sort();
}

// Normalize the two facet flags against the rules:
//   - tieneAcceso=true requires a valid (non-'ninguno') rol and a valid email.
//   - tieneAcceso=false forces rol='ninguno' and restrictedTo=[].
//   - at least one of (tieneAcceso, empleadoPlanilla) must be true on create.
// Returns { errs, clean } where clean has the canonical field values.
function validateUserPayload(body, { mode } = { mode: 'create' }) {
  const errs = [];
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const telefono = typeof body.telefono === 'string' ? body.telefono.trim() : '';
  let rol = body.rol;
  const tieneAcceso = body.tieneAcceso === true;
  const empleadoPlanilla = body.empleadoPlanilla === true;

  if (nombre.length < 2 || nombre.length > LIMITS.nombre) {
    errs.push(`Nombre: 2–${LIMITS.nombre} caracteres.`);
  }
  if (telefono && (!PHONE_RE.test(telefono) || telefono.length > LIMITS.telefono)) {
    errs.push('Teléfono inválido.');
  }

  if (tieneAcceso) {
    if (!emailRaw || !EMAIL_RE.test(emailRaw) || emailRaw.length > LIMITS.email) {
      errs.push('Email inválido (requerido para usuarios con acceso al sistema).');
    }
    if (rol == null || rol === 'ninguno' || !ROLES_VALIDOS.includes(rol)) {
      errs.push('Rol inválido (requerido para usuarios con acceso al sistema).');
    }
  } else {
    if (emailRaw && (!EMAIL_RE.test(emailRaw) || emailRaw.length > LIMITS.email)) {
      errs.push('Email inválido.');
    }
    rol = 'ninguno';
  }

  if (body.restrictedTo !== undefined && !Array.isArray(body.restrictedTo)) {
    errs.push('restrictedTo debe ser un arreglo.');
  }

  if (mode === 'create' && !tieneAcceso && !empleadoPlanilla) {
    errs.push('La persona debe tener acceso al sistema o estar en planilla (o ambas).');
  }

  return {
    errs,
    clean: {
      nombre,
      email: emailRaw,
      telefono,
      rol: rol || 'ninguno',
      tieneAcceso,
      empleadoPlanilla,
    },
  };
}

function requireAdmin(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return res.status(403).json({ message: 'Solo administradores pueden gestionar usuarios.' });
  }
  next();
}

// Parse a YYYY-MM-DD date, falling back to today if absent. Returns a
// Firestore Timestamp set to noon UTC of that date (matches the convention
// used in hr_asistencia/hr_permisos so subsequent date comparisons line up).
function parseFechaSalida(raw) {
  if (typeof raw === 'string' && DATE_RE.test(raw)) {
    const d = new Date(raw + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return Timestamp.now();
}

// --- API ENDPOINTS: USERS ---
router.get('/api/users', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios.' });
  }
});

router.post('/api/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const { errs, clean } = validateUserPayload(req.body, { mode: 'create' });
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });

    // Email uniqueness only matters for personas who actually use the email
    // to log in. Two non-system "people" with the same emergency email is fine.
    if (clean.email) {
      const dup = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', clean.email).limit(1).get();
      if (!dup.empty) return res.status(409).json({ message: 'Ese email ya está registrado.' });
    }

    const restrictedTo = clean.tieneAcceso ? (cleanRestrictedTo(req.body.restrictedTo) || []) : [];

    const user = {
      nombre: clean.nombre,
      email: clean.email,
      telefono: clean.telefono,
      rol: clean.rol,
      tieneAcceso: clean.tieneAcceso,
      empleadoPlanilla: clean.empleadoPlanilla,
      // tuvoEmpleo is monotonic: once set to true it never reverts to false.
      // Seeded here from the initial empleadoPlanilla so a person created as
      // an employee is immediately marked immortal.
      tuvoEmpleo: clean.empleadoPlanilla,
      fincaId: req.fincaId,
      restrictedTo,
    };
    const docRef = await db.collection('users').add(user);

    const isPrivileged = clean.rol === 'administrador' || clean.rol === 'supervisor';
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_CREATE,
      target: { type: 'user', id: docRef.id },
      metadata: {
        email: clean.email || null,
        rol: clean.rol,
        tieneAcceso: clean.tieneAcceso,
        empleadoPlanilla: clean.empleadoPlanilla,
        restrictedTo,
      },
      severity: isPrivileged ? SEVERITY.WARNING : SEVERITY.INFO,
    });

    res.status(201).json({ id: docRef.id, ...user });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear usuario.' });
  }
});

router.put('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const userData = pick(req.body, [
      'nombre', 'email', 'telefono', 'rol',
      'tieneAcceso', 'empleadoPlanilla', 'restrictedTo',
    ]);
    const current = ownership.doc.data();
    const isSelf = req.userEmail && current.email && current.email.toLowerCase() === req.userEmail.toLowerCase();

    // Merge incoming partial update with current state for validation. This
    // lets a caller PUT a single field without re-sending the whole object,
    // while still enforcing the cross-field rules (tieneAcceso ↔ rol/email).
    const merged = {
      nombre: userData.nombre !== undefined ? userData.nombre : current.nombre,
      email: userData.email !== undefined ? userData.email : current.email,
      telefono: userData.telefono !== undefined ? userData.telefono : current.telefono,
      rol: userData.rol !== undefined ? userData.rol : current.rol,
      tieneAcceso: userData.tieneAcceso !== undefined ? userData.tieneAcceso : current.tieneAcceso === true,
      empleadoPlanilla: userData.empleadoPlanilla !== undefined ? userData.empleadoPlanilla : current.empleadoPlanilla === true,
      restrictedTo: userData.restrictedTo !== undefined ? userData.restrictedTo : current.restrictedTo,
    };

    if (isSelf && userData.rol !== undefined && userData.rol !== current.rol) {
      return res.status(403).json({ message: 'No puedes cambiar tu propio rol.' });
    }
    if (isSelf && userData.tieneAcceso === false) {
      return res.status(403).json({ message: 'No puedes revocarte el acceso al sistema a ti mismo.' });
    }
    if (isSelf && userData.restrictedTo !== undefined) {
      const cleaned = cleanRestrictedTo(userData.restrictedTo) || [];
      if (cleaned.length > 0 && !cleaned.includes('admin')) {
        return res.status(403).json({ message: 'No puedes restringir tu propio acceso al módulo de administración.' });
      }
    }

    // Refusing the orphan state ({tieneAcceso:false, empleadoPlanilla:false})
    // forces callers to use revoke-access / revoke-planilla, which carry the
    // right side-effects (audit, fechaSalidaPlanilla, membership deletion).
    if (!merged.tieneAcceso && !merged.empleadoPlanilla) {
      return res.status(400).json({
        message: 'No se puede dejar a la persona sin acceso y sin planilla. Use los endpoints específicos de revocación.',
      });
    }

    const { errs, clean } = validateUserPayload(merged, { mode: 'update' });
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });

    if (userData.email && clean.email) {
      const dup = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', clean.email).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== id) return res.status(409).json({ message: 'Ese email ya está registrado.' });
    }

    const updates = {};
    if (userData.nombre !== undefined) updates.nombre = clean.nombre;
    if (userData.email !== undefined) updates.email = clean.email;
    if (userData.telefono !== undefined) updates.telefono = clean.telefono;
    if (userData.rol !== undefined || userData.tieneAcceso !== undefined) updates.rol = clean.rol;
    if (userData.tieneAcceso !== undefined) updates.tieneAcceso = clean.tieneAcceso;
    if (userData.empleadoPlanilla !== undefined) {
      updates.empleadoPlanilla = clean.empleadoPlanilla;
      // Monotonic: setting empleadoPlanilla=true also marks tuvoEmpleo. Going
      // back to false here is allowed for legacy admin edits, but the proper
      // flow is revoke-planilla which also records fechaSalidaPlanilla.
      if (clean.empleadoPlanilla === true) updates.tuvoEmpleo = true;
    }
    if (userData.restrictedTo !== undefined) {
      updates.restrictedTo = clean.tieneAcceso ? (cleanRestrictedTo(userData.restrictedTo) || []) : [];
    }
    // tieneAcceso=false implies restrictedTo=[]; enforce even if caller didn't
    // pass restrictedTo, otherwise stale module restrictions could re-apply
    // if access is later re-granted.
    if (userData.tieneAcceso === true && !clean.tieneAcceso) {
      updates.restrictedTo = [];
    }

    await db.collection('users').doc(id).update(updates);

    // Memberships are the source of truth for authenticated requests. Sync
    // rol/restrictedTo changes; delete the membership entirely if access was
    // revoked through this endpoint (the proper path is revoke-access, but a
    // legacy PUT can also reach this state).
    const rolChanged = userData.rol !== undefined && clean.rol !== current.rol;
    const restrictedChanged = userData.restrictedTo !== undefined;
    const accessRevoked = userData.tieneAcceso === false && current.tieneAcceso !== false;
    if (rolChanged || restrictedChanged || accessRevoked) {
      const targetEmail = (updates.email || current.email || '').toLowerCase();
      if (targetEmail) {
        const memSnap = await db.collection('memberships')
          .where('fincaId', '==', req.fincaId)
          .where('email', '==', targetEmail)
          .limit(1)
          .get();
        if (!memSnap.empty) {
          if (accessRevoked) {
            await memSnap.docs[0].ref.delete();
          } else {
            const membershipUpdate = {};
            if (rolChanged) membershipUpdate.rol = clean.rol;
            if (restrictedChanged) membershipUpdate.restrictedTo = updates.restrictedTo;
            if (Object.keys(membershipUpdate).length) {
              await memSnap.docs[0].ref.update(membershipUpdate);
            }
          }
        }
      }
    }

    if (rolChanged) {
      const escalating = (ROLES_VALIDOS.indexOf(clean.rol) > ROLES_VALIDOS.indexOf(current.rol || 'trabajador'));
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.USER_ROLE_CHANGE,
        target: { type: 'user', id },
        metadata: {
          email: (current.email || '').toLowerCase(),
          from: current.rol || null,
          to: clean.rol,
          escalating,
        },
        severity: escalating ? SEVERITY.WARNING : SEVERITY.INFO,
      });
    }
    if (restrictedChanged) {
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.USER_RESTRICTED_TO_CHANGE,
        target: { type: 'user', id },
        metadata: {
          email: (current.email || '').toLowerCase(),
          from: Array.isArray(current.restrictedTo) ? current.restrictedTo : [],
          to: updates.restrictedTo,
        },
        severity: SEVERITY.INFO,
      });
    }
    if (!rolChanged && !restrictedChanged) {
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.USER_UPDATE,
        target: { type: 'user', id },
        metadata: { email: (current.email || '').toLowerCase(), fields: Object.keys(updates) },
        severity: SEVERITY.INFO,
      });
    }

    res.status(200).json({ id, ...updates });
  } catch (error) {
    console.error('[users:put]', error);
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  }
});

router.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const doomed = ownership.doc.data();
    const targetEmail = (doomed.email || '').toLowerCase();
    if (req.userEmail && targetEmail === req.userEmail.toLowerCase()) {
      return res.status(403).json({ message: 'No puedes eliminar tu propio usuario.' });
    }

    // Hard-delete is reserved for people with no HR footprint. Anything else
    // must go through the revoke-* endpoints so historical records keep a
    // valid FK target and the audit trail captures the lifecycle.
    if (doomed.tuvoEmpleo === true || doomed.empleadoPlanilla === true) {
      return sendApiError(
        res,
        ERROR_CODES.USER_HAS_HR_HISTORY,
        'User has HR history and cannot be hard-deleted. Use revoke-access and/or revoke-planilla.',
        409,
      );
    }

    await db.collection('users').doc(id).delete();

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_DELETE,
      target: { type: 'user', id },
      metadata: {
        email: targetEmail,
        rol: doomed.rol || null,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ message: 'Usuario eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar usuario.' });
  }
});

// ─── Facet endpoints: grant/revoke access and planilla ───────────────────
//
// These give the frontend a clean way to flip a single facet without having
// to reason about the rol/email/restrictedTo cross-field rules. Each one is
// idempotent: granting an already-granted facet returns 200 with no side
// effect, so retries from the UI are safe.

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
// Exported for unit testing — keeps the cross-field invariants (tieneAcceso ↔
// rol/email, orphan-state rejection) checkable without spinning up the HTTP
// stack. Not intended for general consumers; route handlers should remain
// the only callers in production code.
module.exports.__test = { validateUserPayload, cleanRestrictedTo };
