const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { MODULE_PREFIXES } = require('../lib/moduleMap');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

const router = Router();

const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;
const LIMITS = { nombre: 80, email: 120, telefono: 20 };
// Whitelist of sidebar module ids that can appear in `restrictedTo`. Keeps
// in sync with MODULE_PREFIXES automatically — adding a new module to the
// moduleMap also exposes it here without any extra wiring.
const MODULE_IDS = new Set(Object.keys(MODULE_PREFIXES));

// Filters a raw restrictedTo array into clean module ids. Non-strings and
// unknown ids are silently dropped (not an error — a stale client payload
// should not block an admin's update). Returns an array sorted + deduped.
function cleanRestrictedTo(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  for (const v of raw) {
    if (typeof v === 'string' && MODULE_IDS.has(v)) seen.add(v);
  }
  return [...seen].sort();
}

function validateUserPayload(body) {
  const errs = [];
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const telefono = typeof body.telefono === 'string' ? body.telefono.trim() : '';
  const rol = body.rol;

  if (nombre.length < 2 || nombre.length > LIMITS.nombre) errs.push(`Nombre: 2–${LIMITS.nombre} caracteres.`);
  if (!EMAIL_RE.test(email) || email.length > LIMITS.email) errs.push('Email inválido.');
  if (telefono && (!PHONE_RE.test(telefono) || telefono.length > LIMITS.telefono)) errs.push('Teléfono inválido.');
  if (rol != null && !ROLES_VALIDOS.includes(rol)) errs.push('Rol inválido.');

  // restrictedTo is optional. When present it must be an array of strings;
  // unknown module ids are scrubbed, but if the caller clearly sent a non-
  // array (e.g. a string or object) that is a client bug worth flagging.
  if (body.restrictedTo !== undefined && !Array.isArray(body.restrictedTo)) {
    errs.push('restrictedTo debe ser un arreglo.');
  }

  return { errs, clean: { nombre, email, telefono, rol: rol || 'trabajador' } };
}

function requireAdmin(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return res.status(403).json({ message: 'Solo administradores pueden gestionar usuarios.' });
  }
  next();
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
    const { errs, clean } = validateUserPayload(req.body);
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });
    const dup = await db.collection('users')
      .where('fincaId', '==', req.fincaId)
      .where('email', '==', clean.email).limit(1).get();
    if (!dup.empty) return res.status(409).json({ message: 'Ese email ya está registrado.' });

    const restrictedTo = cleanRestrictedTo(req.body.restrictedTo) || [];

    const user = {
      ...clean,
      empleadoPlanilla: req.body.empleadoPlanilla === true,
      fincaId: req.fincaId,
      restrictedTo,
    };
    const docRef = await db.collection('users').add(user);

    // Admin created an invitation. Severity `warning` when the invite grants
    // a privileged role straight away, `info` otherwise.
    const isPrivileged = clean.rol === 'administrador' || clean.rol === 'supervisor';
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.USER_CREATE,
      target: { type: 'user', id: docRef.id },
      metadata: {
        email: clean.email,
        rol: clean.rol,
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
    const userData = pick(req.body, ['nombre', 'email', 'telefono', 'rol', 'empleadoPlanilla', 'restrictedTo']);
    const current = ownership.doc.data();
    const isSelf = req.userEmail && current.email && current.email.toLowerCase() === req.userEmail.toLowerCase();
    if (isSelf && userData.rol !== undefined && userData.rol !== current.rol) {
      return res.status(403).json({ message: 'No puedes cambiar tu propio rol.' });
    }
    // Self-lockout guard: an admin must not be able to restrict themselves out
    // of the admin module — otherwise they lose access to user management.
    if (isSelf && userData.restrictedTo !== undefined) {
      const cleaned = cleanRestrictedTo(userData.restrictedTo) || [];
      if (cleaned.length > 0 && !cleaned.includes('admin')) {
        return res.status(403).json({ message: 'No puedes restringir tu propio acceso al módulo de administración.' });
      }
    }
    const { errs, clean } = validateUserPayload({ ...current, ...userData });
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });
    if (userData.email) {
      const dup = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', clean.email).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== id) return res.status(409).json({ message: 'Ese email ya está registrado.' });
    }
    const updates = {};
    if (userData.nombre !== undefined) updates.nombre = clean.nombre;
    if (userData.email !== undefined) updates.email = clean.email;
    if (userData.telefono !== undefined) updates.telefono = clean.telefono;
    if (userData.rol !== undefined) updates.rol = clean.rol;
    if (userData.empleadoPlanilla !== undefined) updates.empleadoPlanilla = userData.empleadoPlanilla === true;
    if (userData.restrictedTo !== undefined) updates.restrictedTo = cleanRestrictedTo(userData.restrictedTo) || [];
    await db.collection('users').doc(id).update(updates);

    // Sync the mirror on memberships when rol or restrictedTo changed. Without
    // this, an admin edit would never propagate to a user who has already
    // logged in (the membership is the source of truth for authenticate).
    // Match by email + fincaId — the uid is on memberships but not reliably
    // cached on users until after claim-invitations runs the first time.
    const rolChanged = userData.rol !== undefined && clean.rol !== current.rol;
    const restrictedChanged = userData.restrictedTo !== undefined;
    if (rolChanged || restrictedChanged) {
      const targetEmail = (updates.email || current.email || '').toLowerCase();
      if (targetEmail) {
        const memSnap = await db.collection('memberships')
          .where('fincaId', '==', req.fincaId)
          .where('email', '==', targetEmail)
          .limit(1)
          .get();
        if (!memSnap.empty) {
          const membershipUpdate = {};
          if (rolChanged) membershipUpdate.rol = clean.rol;
          if (restrictedChanged) membershipUpdate.restrictedTo = updates.restrictedTo;
          await memSnap.docs[0].ref.update(membershipUpdate);
        }
      }
    }

    // Emit dedicated audit events for role and restriction changes — they are
    // the most abuse-prone edits on this endpoint. A generic user.update is
    // emitted when neither of those changed, so every PUT is traceable.
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
    await db.collection('users').doc(id).delete();

    // Deleting users is always worth flagging.
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

module.exports = router;
