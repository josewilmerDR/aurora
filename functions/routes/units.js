const { Router } = require('express');
const { z } = require('zod');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

const router = Router();

// Caps en sync con UnidadesMedida.jsx (maxLength del form). El front trunca por
// UX; el backend valida por seguridad (curl/Postman saltan el maxLength). Drift
// = límites inconsistentes. Mismo criterio de defensa en profundidad que labores.
const MAX_NOMBRE = 40;
const MAX_DESCRIPCION = 80;
const MAX_UNIDAD_BASE = 40;
const MAX_LABOR = 64; // id de labor (Firestore doc id), no texto libre

// Números opcionales del form: el front manda number | '' | null. Vacío → ausente;
// el resto se coacciona y se valida finito y en rango. NO validamos que `labor` /
// `unidadBase` existan: el modelo referencia por nombre/id sin cascada (a propósito),
// e InitialSetup puede crear unidades antes que su base — exigir existencia rompería
// ese flujo. Acá solo acotamos tipo y longitud.
const optionalNumber = (label, { positive = false } = {}) => z.preprocess(
  v => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number(`${label} must be a number.`)
    .finite(`${label} must be finite.`)
    .refine(n => (positive ? n > 0 : n >= 0),
      positive ? `${label} must be greater than 0.` : `${label} must be 0 or greater.`)
    .optional(),
);

// Presence de `nombre` se chequea aparte (MISSING_REQUIRED_FIELDS); acá solo el cap.
const unidadBodySchema = z.object({
  nombre: z.string('nombre must be a string.')
    .refine(s => s.trim().length <= MAX_NOMBRE, `nombre max ${MAX_NOMBRE} characters.`)
    .optional(),
  descripcion: z.string('descripcion must be a string.')
    .refine(s => s.trim().length <= MAX_DESCRIPCION, `descripcion max ${MAX_DESCRIPCION} characters.`)
    .optional(),
  labor: z.string('labor must be a string.')
    .max(MAX_LABOR, `labor max ${MAX_LABOR} characters.`)
    .optional(),
  unidadBase: z.string('unidadBase must be a string.')
    .refine(s => s.trim().length <= MAX_UNIDAD_BASE, `unidadBase max ${MAX_UNIDAD_BASE} characters.`)
    .optional(),
  precio: optionalNumber('precio'),
  factorConversion: optionalNumber('factorConversion', { positive: true }),
});

// Devuelve { missingName } | { errors[] }. La presencia de nombre se reporta con
// su propio código para conservar el contrato legacy; el resto agrega VALIDATION_FAILED.
function validateUnidadBody(body) {
  const b = body || {};
  if (typeof b.nombre !== 'string' || !b.nombre.trim()) return { missingName: true };
  const errors = [];
  const parsed = unidadBodySchema.safeParse(b);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
  }
  return { errors };
}

// ── Units of Measure ───────────────────────────────────────────────────────
// GET rate-limited (public_read) como /api/productos: el endpoint está abierto a
// cualquier miembro autenticado porque los selectores de cosecha/inventario lo
// necesitan. Pero `precio` es la tarifa de planilla por unidad; lo proyectamos
// fuera para `trabajador`. encargado+ lo ve (lo consume Salario por Unidad para
// sugerir el costo unitario) y supervisor+ administra la página.
router.get('/api/unidades-medida', authenticate, rateLimit('unidades_medida_read', 'public_read'), async (req, res) => {
  try {
    const canSeePrecio = hasMinRoleBE(req.userRole, 'encargado');
    const snap = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc').get();
    res.json(snap.docs.map(d => {
      const data = { id: d.id, ...d.data() };
      if (!canSeePrecio) delete data.precio;
      return data;
    }));
  } catch (error) {
    console.error('Error fetching unidades de medida:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch unidades de medida.', 500);
  }
});

// Conteo de referencias a una unidad, server-side. Reemplaza la descarga del
// catálogo completo de productos que la página hacía solo para contar impacto
// antes de borrar/renombrar. Agregaciones count() — no traen documentos.
// Gateado a supervisor+ (único consumidor: la página de administración).
router.get('/api/unidades-medida/:id/refs', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can read unidad references.', 403);
    }
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { nombre, unidadBase } = ownership.doc.data();

    const [prodAgg, baseAgg] = await Promise.all([
      db.collection('productos')
        .where('fincaId', '==', req.fincaId).where('unidad', '==', nombre).count().get(),
      db.collection('unidades_medida')
        .where('fincaId', '==', req.fincaId).where('unidadBase', '==', nombre).count().get(),
    ]);

    // Excluí la propia unidad si (degeneradamente) se referencia a sí misma como base.
    let baseCount = baseAgg.data().count;
    if (unidadBase === nombre) baseCount = Math.max(0, baseCount - 1);

    res.json({ productCount: prodAgg.data().count, baseCount });
  } catch (error) {
    console.error('Error counting unidad references:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to count unidad references.', 500);
  }
});

router.post('/api/unidades-medida', authenticate, rateLimit('unidades_medida_write', 'write'), async (req, res) => {
  try {
    // Writes match the only UI caller (/admin/unidades-medida = supervisor)
    // and InitialSetup (admin). GET stays open for product/cosecha selectors.
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can create unidades de medida.', 403);
    }
    const v = validateUnidadBody(req.body);
    if (v.missingName) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (v.errors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, v.errors.join('; '), 400);
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    const data = {
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      fincaId: req.fincaId,
    };
    // Upsert by nombre
    const existing = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .where('nombre', '==', data.nombre)
      .limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const { fincaId, ...updateData } = data;
      await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
      return res.status(200).json({ id: doc.id, merged: true });
    }
    data.creadoEn = Timestamp.now();
    const ref = await db.collection('unidades_medida').add(data);
    res.status(201).json({ id: ref.id, merged: false });
  } catch (error) {
    console.error('Error creating unidad de medida:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create unidad de medida.', 500);
  }
});

router.put('/api/unidades-medida/:id', authenticate, rateLimit('unidades_medida_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can update unidades de medida.', 403);
    }
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const v = validateUnidadBody(req.body);
    if (v.missingName) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (v.errors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, v.errors.join('; '), 400);
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    await db.collection('unidades_medida').doc(req.params.id).update({
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      actualizadoEn:    Timestamp.now(),
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error updating unidad de medida:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update unidad de medida.', 500);
  }
});

router.delete('/api/unidades-medida/:id', authenticate, rateLimit('unidades_medida_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can delete unidades de medida.', 403);
    }
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const prevData = ownership.doc.data();
    await db.collection('unidades_medida').doc(req.params.id).delete();

    // Irreversible y rompe referencias por nombre (productos + unidades base).
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.UNIDAD_MEDIDA_DELETE,
      target: { type: 'unidad_medida', id: req.params.id },
      metadata: {
        nombre: prevData.nombre || null,
        unidadBase: prevData.unidadBase || null,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error deleting unidad de medida:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete unidad de medida.', 500);
  }
});

module.exports = router;
