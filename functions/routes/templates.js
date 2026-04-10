const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');

const router = Router();

// --- API ENDPOINTS: TASK TEMPLATES ---
router.get('/api/task-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('task_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

router.post('/api/task-templates', authenticate, async (req, res) => {
  try {
    const { nombre, responsableId, productos } = req.body;
    if (!nombre)
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const template = {
      nombre,
      responsableId: responsableId || '',
      productos: productos || [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('task_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear plantilla.' });
  }
});

router.delete('/api/task-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('task_templates').doc(req.params.id).delete();
    res.json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

// --- API ENDPOINTS: CEDULA TEMPLATES ---
router.get('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('cedula_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

router.post('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const { nombre, productos } = req.body;
    if (!nombre) return res.status(400).json({ message: 'El nombre es requerido.' });
    const template = {
      nombre,
      productos: productos || [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('cedula_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear plantilla.' });
  }
});

router.delete('/api/cedula-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('cedula_templates').doc(req.params.id).delete();
    res.json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

module.exports = router;
