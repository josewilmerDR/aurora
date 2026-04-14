const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;
const LIMITS = { nombre: 80, email: 120, telefono: 20 };

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

  return { errs, clean: { nombre, email, telefono, rol: rol || 'trabajador' } };
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

router.post('/api/users', authenticate, async (req, res) => {
  try {
    const { errs, clean } = validateUserPayload(req.body);
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });
    const dup = await db.collection('users')
      .where('fincaId', '==', req.fincaId)
      .where('email', '==', clean.email).limit(1).get();
    if (!dup.empty) return res.status(409).json({ message: 'Ese email ya está registrado.' });
    const user = { ...clean, empleadoPlanilla: req.body.empleadoPlanilla === true, fincaId: req.fincaId };
    const docRef = await db.collection('users').add(user);
    res.status(201).json({ id: docRef.id, ...user });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear usuario.' });
  }
});

router.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('users', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const userData = pick(req.body, ['nombre', 'email', 'telefono', 'rol', 'empleadoPlanilla']);
    const { errs, clean } = validateUserPayload({ ...ownership.doc.data(), ...userData });
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
    await db.collection('users').doc(id).update(updates);
    res.status(200).json({ id, ...updates });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  }
});

router.delete('/api/users/:id', authenticate, async (req, res) => {
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

module.exports = router;
