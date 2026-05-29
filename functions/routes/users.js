const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const {
  ROLES_VALIDOS,
  cleanRestrictedTo,
  validateUserPayload,
} = require('./users.shared');

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
// Lifecycle is then driven via grant/revoke endpoints (users-facets.js) which
// only flip flags. Cross-field validation rules live in users.shared.js.

function requireAdmin(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only administrators can manage users.', 403);
  }
  next();
}

// Gate for endpoints that expose PII (email, teléfono, rol, motivo de salida…)
// but are read by non-admin screens too (HR ficha, planilla). The floor is
// `encargado`: the lowest role that legitimately needs the full directory.
// Workers below that resolve id→nombre through GET /api/users/lite, which
// carries no PII and stays open to any authenticated member.
function requireEncargado(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Requires encargado role or higher.', 403);
  }
  next();
}

// --- API ENDPOINTS: USERS ---
// PII-bearing directory: returns email, teléfono, rol, restrictedTo and the
// HR termination fields (motivoSalidaPlanilla…) for every person in the finca.
// Gated to `encargado+` so a trabajador can no longer dump the whole finca's
// PII; name-only call sites use GET /api/users/lite instead (no PII, open to
// any authenticated member). Rate-limited on the same bucket as /lite so the
// per-user budget is shared regardless of which variant is hit.
router.get('/api/users', authenticate, requireEncargado, rateLimit('users_read', 'public_read'), async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(users);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch users.', 500);
  }
});

// GET /api/users/lite — directorio mínimo de personas de la finca.
//
// Surge de la auditoría de Paquetes: pantallas que solo necesitan resolver
// `id → nombre` (pickers de responsable, orphan-check de plantillas) estaban
// jalando el GET completo, que incluye email, teléfono y rol de TODOS los
// usuarios para cualquier trabajador autenticado. Eso es over-fetch de PII.
//
// Esta variante devuelve solo lo que esos call sites necesitan:
//   - id, nombre               → render
//   - empleadoPlanilla,        → derivar `eligibleResponsables`
//     tieneAcceso                (empleado en planilla con acceso al sistema)
//
// Sin email, teléfono, rol, restrictedTo ni cualquier flag de RR.HH. La ruta
// queda abierta a cualquier autenticado (igual que /api/users), porque
// trabajadores legítimos necesitan resolver nombres de responsables en sus
// propias pantallas.
router.get('/api/users/lite', authenticate, rateLimit('users_read', 'public_read'), async (req, res) => {
  try {
    const snapshot = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const lite = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        nombre: d.nombre || '',
        empleadoPlanilla: d.empleadoPlanilla === true,
        tieneAcceso: d.tieneAcceso === true,
      };
    });
    res.status(200).json(lite);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch user directory.', 500);
  }
});

router.post('/api/users', authenticate, requireAdmin, rateLimit('users_write', 'write'), async (req, res) => {
  try {
    const { errs, clean } = validateUserPayload(req.body, { mode: 'create' });
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);

    // Email uniqueness only matters for personas who actually use the email
    // to log in. Two non-system "people" with the same emergency email is fine.
    if (clean.email) {
      const dup = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', clean.email).limit(1).get();
      if (!dup.empty) return sendApiError(res, ERROR_CODES.ALREADY_EXISTS, 'Email already registered.', 409);
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create user.', 500);
  }
});

router.put('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
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
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You cannot change your own role.', 403);
    }
    if (isSelf && userData.tieneAcceso === false) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You cannot revoke your own system access.', 403);
    }
    if (isSelf && userData.restrictedTo !== undefined) {
      const cleaned = cleanRestrictedTo(userData.restrictedTo) || [];
      if (cleaned.length > 0 && !cleaned.includes('admin')) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You cannot restrict your own access to the admin module.', 403);
      }
    }

    // Refusing the orphan state ({tieneAcceso:false, empleadoPlanilla:false})
    // forces callers to use revoke-access / revoke-planilla, which carry the
    // right side-effects (audit, fechaSalidaPlanilla, membership deletion).
    if (!merged.tieneAcceso && !merged.empleadoPlanilla) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'A person cannot be left without access and without payroll. Use the dedicated revoke endpoints instead.',
        400,
      );
    }

    const { errs, clean } = validateUserPayload(merged, { mode: 'update' });
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);

    if (userData.email && clean.email) {
      const dup = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', clean.email).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== id) return sendApiError(res, ERROR_CODES.ALREADY_EXISTS, 'Email already registered.', 409);
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update user.', 500);
  }
});

router.delete('/api/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const doomed = ownership.doc.data();
    const targetEmail = (doomed.email || '').toLowerCase();
    if (req.userEmail && targetEmail === req.userEmail.toLowerCase()) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You cannot delete your own user.', 403);
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

    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete user.', 500);
  }
});

module.exports = router;
