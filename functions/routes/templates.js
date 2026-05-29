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

// requireEncargado: borrar una plantilla es escritura del catálogo y debe
// igualar el gate del POST. El GET queda abierto a authenticate porque los
// trabajadores aplican plantillas al crear tareas (POST /api/tasks no exige
// rol); pero crear/eliminar el catálogo es encargado+. Sin este gate un
// trabajador podía borrar plantillas de su finca que no puede crear.
// verifyOwnership debajo mantiene el aislamiento por finca.
router.delete('/api/task-templates/:id', authenticate, requireEncargado, async (req, res) => {
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
// Validación de payload para POST /api/cedula-templates. Antes el endpoint
// solo chequeaba `!nombre`; `productos` viajaba sin shape ni cap y se
// persistía tal cual (riesgo de grow-bomb del doc Firestore + payloads
// hostiles). Los caps están alineados con los del dominio cédulas
// (MAX_ACTIVITY_LEN=64, MAX_PRODUCTOS=50, MAX_CANTIDAD_POR_HA=100000) para
// que una plantilla no produzca cédulas que el endpoint manual rechazaría.
const CTPL_NOMBRE_MAX = 64;
const CTPL_PRODUCTOS_MAX = 50;
const CTPL_CANT_MAX = 100000;
function validateCedulaTemplatePayload(body) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  if (!nombre) return 'Template name is required.';
  if (nombre.length > CTPL_NOMBRE_MAX) return `Template name cannot exceed ${CTPL_NOMBRE_MAX} characters.`;
  const productos = body.productos;
  if (productos !== undefined && !Array.isArray(productos)) {
    return 'productos must be an array.';
  }
  const list = Array.isArray(productos) ? productos : [];
  if (list.length > CTPL_PRODUCTOS_MAX) {
    return `Maximum ${CTPL_PRODUCTOS_MAX} products per template.`;
  }
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    if (typeof p.productoId !== 'string' || !p.productoId.trim()) {
      return `Product ${i + 1}: productoId is required.`;
    }
    if (p.productoId.length > 128) {
      return `Product ${i + 1}: productoId is too long.`;
    }
    const qty = Number(p.cantidadPorHa);
    if (!Number.isFinite(qty) || qty < 0 || qty > CTPL_CANT_MAX) {
      return `Product ${i + 1}: cantidadPorHa must be between 0 and ${CTPL_CANT_MAX}.`;
    }
    if (p.nombreComercial !== undefined && typeof p.nombreComercial !== 'string') {
      return `Product ${i + 1}: nombreComercial must be a string.`;
    }
    if (typeof p.nombreComercial === 'string' && p.nombreComercial.length > 200) {
      return `Product ${i + 1}: nombreComercial is too long.`;
    }
    if (p.unidad !== undefined && typeof p.unidad !== 'string') {
      return `Product ${i + 1}: unidad must be a string.`;
    }
    if (typeof p.unidad === 'string' && p.unidad.length > 32) {
      return `Product ${i + 1}: unidad is too long.`;
    }
  }
  return null;
}

// requireEncargado: simetría con el POST/DELETE de cedula-templates. A
// diferencia de task-templates (que trabajadores leen al crear tareas), el
// único consumidor de este GET es el flujo de creación de cédulas, gateado a
// encargado+ en la ruta /aplicaciones/cedulas — no hay consumidor de menor
// rol, así que el gate es consistencia sin cambio de comportamiento.
router.get('/api/cedula-templates', authenticate, requireEncargado, async (req, res) => {
  try {
    const snapshot = await db.collection('cedula_templates')
      .where('fincaId', '==', req.fincaId).get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedula templates.', 500);
  }
});

router.post('/api/cedula-templates', authenticate, requireEncargado, async (req, res) => {
  try {
    const validationError = validateCedulaTemplatePayload(req.body);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const { nombre, productos } = req.body;
    const template = {
      nombre: nombre.trim(),
      // Normalizar shape: solo persistir los 4 campos definidos. Antes
      // `productos: productos || []` aceptaba campos arbitrarios del cliente
      // (riesgo de payloads hostiles que crecieran el doc en sucesivos PUTs).
      productos: Array.isArray(productos)
        ? productos.map(p => ({
            productoId: String(p.productoId),
            nombreComercial: typeof p.nombreComercial === 'string' ? p.nombreComercial : '',
            cantidadPorHa: Number(p.cantidadPorHa) || 0,
            unidad: typeof p.unidad === 'string' ? p.unidad : '',
          }))
        : [],
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('cedula_templates').add(template);
    res.status(201).json({ id: docRef.id, ...template });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create cedula template.', 500);
  }
});

router.delete('/api/cedula-templates/:id', authenticate, requireEncargado, async (req, res) => {
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
