const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

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
    const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];
    const { nombre, email, telefono, rol, empleadoPlanilla } = req.body;
    if (!nombre || !email) return res.status(400).json({ message: 'nombre y email son requeridos.' });
    if (rol && !ROLES_VALIDOS.includes(rol)) return res.status(400).json({ message: 'Rol inválido.' });
    const emailNorm = email.trim().toLowerCase();
    const user = { nombre, email: emailNorm, telefono: telefono || '', rol: rol || 'trabajador', empleadoPlanilla: empleadoPlanilla === true, fincaId: req.fincaId };
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
    const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];
    const userData = pick(req.body, ['nombre', 'email', 'telefono', 'rol', 'empleadoPlanilla']);
    if (userData.rol && !ROLES_VALIDOS.includes(userData.rol)) return res.status(400).json({ message: 'Rol inválido.' });
    if (userData.email) userData.email = userData.email.trim().toLowerCase();
    await db.collection('users').doc(id).update(userData);
    res.status(200).json({ id, ...userData });
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
