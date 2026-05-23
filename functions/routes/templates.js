const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// Crear plantillas de tareas es escritura compartida a nivel de finca — la
// limitamos a encargado+ para evitar que cualquier trabajador siembre ruido en
// el catálogo. El borrado por id se valida con `verifyOwnership` en cada
// handler para impedir borrados cross-tenant.
function requireEncargado(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Encargado role required to manage task templates.', 403);
  }
  next();
}

// Validación mínima de payload para POST /api/task-templates. Antes el
// endpoint solo chequeaba `!nombre`; productos y responsableId iban a
// Firestore sin shape ni límites.
const TPL_NOMBRE_MAX = 120;
const TPL_PRODUCTOS_MAX = 24;
function validateTaskTemplatePayload(body) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre) return 'Template name is required.';
  if (nombre.length > TPL_NOMBRE_MAX) return `Template name cannot exceed ${TPL_NOMBRE_MAX} characters.`;
  if (body.responsableId !== undefined && body.responsableId !== null && typeof body.responsableId !== 'string') {
    return 'responsableId must be a string.';
  }
  if ((body.responsableId || '').length > 128) return 'responsableId is too long.';
  const productos = body.productos;
  if (productos !== undefined && !Array.isArray(productos)) {
    return 'productos must be an array.';
  }
  const list = Array.isArray(productos) ? productos : [];
  if (list.length > TPL_PRODUCTOS_MAX) {
    return `Maximum ${TPL_PRODUCTOS_MAX} products per template.`;
  }
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    if (typeof p.productoId !== 'string' || !p.productoId.trim()) {
      return `Product ${i + 1}: productoId is required.`;
    }
    if (p.productoId.length > 128) {
      return `Product ${i + 1}: productoId is too long.`;
    }
    const qty = Number(p.cantidad);
    if (!Number.isFinite(qty) || qty < 0 || qty >= 1024) {
      return `Product ${i + 1}: cantidad must be between 0 and 1024.`;
    }
  }
  return null;
}

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

router.post('/api/task-templates', authenticate, requireEncargado, async (req, res) => {
  try {
    const validationError = validateTaskTemplatePayload(req.body);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const { nombre, responsableId, productos } = req.body;
    const template = {
      nombre: nombre.trim(),
      responsableId: responsableId || '',
      productos: Array.isArray(productos)
        ? productos.map(p => ({
            productoId: String(p.productoId),
            cantidad: Number(p.cantidad) || 0,
          }))
        : [],
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
    const ownership = await verifyOwnership('task_templates', req.params.id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
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
    const ownership = await verifyOwnership('cedula_templates', req.params.id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    await db.collection('cedula_templates').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete cedula template.', 500);
  }
});

module.exports = router;
