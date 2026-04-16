const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: TASK TEMPLATES ---
router.get('/api/task-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('task_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch task templates.', 500);
  }
});

router.post('/api/task-templates', authenticate, async (req, res) => {
  try {
    const { nombre, responsableId, productos } = req.body;
    if (!nombre) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Template name is required.', 400);
    }
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create task template.', 500);
  }
});

router.delete('/api/task-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('task_templates').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete task template.', 500);
  }
});

// --- API ENDPOINTS: CEDULA TEMPLATES ---
router.get('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('cedula_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedula templates.', 500);
  }
});

router.post('/api/cedula-templates', authenticate, async (req, res) => {
  try {
    const { nombre, productos } = req.body;
    if (!nombre) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Template name is required.', 400);
    }
    const template = {
      nombre,
      productos: productos || [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('cedula_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create cedula template.', 500);
  }
});

router.delete('/api/cedula-templates/:id', authenticate, async (req, res) => {
  try {
    await db.collection('cedula_templates').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete cedula template.', 500);
  }
});

module.exports = router;
