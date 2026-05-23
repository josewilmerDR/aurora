const { Router } = require('express');
const { z } = require('zod');
const { db, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

const router = Router();

// Mutaciones de paquetes requieren supervisor+. La UI ya filtra la ruta
// `/packages` con `minRole: 'supervisor'`, pero el backend tenía cero gate de
// rol — un trabajador con un token Firebase válido podía hacer POST/PUT/DELETE
// directamente. Esto cierra esa brecha de defense-in-depth.
function requireSupervisor(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role required to manage packages.', 403);
  }
  next();
}

// --- Package payload validation (Zod) ---
//
// Migración desde el validador hand-rolled a Zod (Tanda 3 de la auditoría —
// CLAUDE.md §3 exige Zod cuando se toca el archivo; el contrato de error
// sigue siendo "mensaje en inglés del primer issue"). Cambios materiales
// respecto al legacy:
//
//   - Nested objects (activities[], productos[]) ahora se validan con su
//     propia schema y se filtran a sus campos conocidos. Antes `pick()`
//     filtraba solo a nivel raíz, así que cualquier atributo extra dentro
//     de una activity/producto persistía en Firestore.
//   - responsableId / calibracionId / productoId tienen formato (string ≤128)
//     en vez de aceptar cualquier valor.
//   - nombreComercial / unidad / periodos: caps de longitud (antes ilimitados).
//
// `buildPackagePayload(body)` devuelve `{ data, error }`. `data` es el doc
// listo para persistir; el handler solo agrega `fincaId` y lo guarda.

const VALID_HARVEST_TYPES = ['I Cosecha', 'II Cosecha', 'III Cosecha', 'Semillero'];
const VALID_CROP_STAGES = ['Desarrollo', 'Postforza', 'N/A'];
const ACT_PRODUCTOS_MAX = 24;
const ACTIVITIES_MAX = 200;
const FIRESTORE_ID_MAX = 128;

const productoSchema = z.object({
  productoId: z.string().min(1).max(FIRESTORE_ID_MAX),
  nombreComercial: z.string().max(200).optional().default(''),
  cantidadPorHa: z.coerce.number()
    .refine((n) => Number.isFinite(n) && n > 0 && n < 1024, {
      message: 'cantidadPorHa must be > 0 and < 1024.',
    }),
  unidad: z.string().max(32).optional().default(''),
  // periodoReingreso/periodoACosecha vienen del catálogo de productos como
  // string ("12h", "7 días") o número crudo. Aceptamos ambos pero acotados.
  periodoReingreso: z.union([z.string().max(32), z.number()]).optional(),
  periodoACosecha: z.union([z.string().max(32), z.number()]).optional(),
});

const activitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  day: z.coerce.number().int().min(0).max(1825),
  // `type` se denormaliza desde el form (productos.length > 0 → 'aplicacion').
  // El cron de tareas lo consume, así que limitamos el enum.
  type: z.enum(['notificacion', 'aplicacion']).optional(),
  responsableId: z.string().max(FIRESTORE_ID_MAX).optional().default(''),
  calibracionId: z.string().max(FIRESTORE_ID_MAX).optional().default(''),
  productos: z.array(productoSchema).max(ACT_PRODUCTOS_MAX).optional().default([]),
});

// Mantenemos tipoCosecha/etapaCultivo como opcionales para no romper PUTs
// sobre paquetes históricos que se crearon antes de que el form los marcara
// requeridos. Cuando vienen, deben ser enums válidos.
const packageSchema = z.object({
  nombrePaquete: z.string().trim().min(1).max(128),
  descripcion: z.string().max(1024).optional().default(''),
  tecnicoResponsable: z.string().max(48).optional().default(''),
  tipoCosecha: z.enum(VALID_HARVEST_TYPES).optional(),
  etapaCultivo: z.enum(VALID_CROP_STAGES).optional(),
  activities: z.array(activitySchema).max(ACTIVITIES_MAX).optional().default([]),
});

function buildPackagePayload(body) {
  const parsed = packageSchema.safeParse(body || {});
  if (!parsed.success) {
    // El primer issue es el que el usuario percibe — mensaje en inglés con
    // el path Zod (p. ej. "activities.2.productos.0.cantidadPorHa: must be...").
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { error: `${path}${issue.message}` };
  }
  return { data: parsed.data };
}

// --- API ENDPOINTS: PACKAGES ---
router.get('/api/packages', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('packages').where('fincaId', '==', req.fincaId).get();
    const packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch packages.', 500);
  }
});

router.post('/api/packages', authenticate, requireSupervisor, rateLimit('packages_write', 'write'), async (req, res) => {
  try {
    const validated = buildPackagePayload(req.body);
    if (validated.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validated.error, 400);
    }
    const pkg = { ...validated.data, fincaId: req.fincaId };
    const docRef = await db.collection('packages').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create package.', 500);
  }
});

router.put('/api/packages/:id', authenticate, requireSupervisor, rateLimit('packages_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const validated = buildPackagePayload(req.body);
    if (validated.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validated.error, 400);
    }
    await db.collection('packages').doc(id).update(validated.data);
    res.status(200).json({ id, ...validated.data });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update package.', 500);
  }
});

router.delete('/api/packages/:id', authenticate, requireSupervisor, rateLimit('packages_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const prevData = ownership.doc.data();
    await db.collection('packages').doc(id).delete();

    // Audit WARNING: DELETE rompe referencias en lotes/grupos sin posibilidad
    // de undo. Snapshoteamos nombre + tipo + #actividades porque después del
    // delete no hay forma de reconstruir qué era.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PACKAGE_DELETE,
      target: { type: 'package', id },
      metadata: {
        nombrePaquete: prevData.nombrePaquete || null,
        tipoCosecha: prevData.tipoCosecha || null,
        etapaCultivo: prevData.etapaCultivo || null,
        activitiesCount: Array.isArray(prevData.activities) ? prevData.activities.length : 0,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete package.', 500);
  }
});

// Archive / unarchive: solo flip de un timestamp en `archivedAt`. NO afecta
// referencias existentes (lotes/grupos que apuntan al paquete siguen
// resolviendo) — distinto de DELETE que rompe esas referencias. La UI usa
// archivedAt como toggle: presente → archivado; ausente → activo.
router.post('/api/packages/:id/archive', authenticate, requireSupervisor, rateLimit('packages_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const prevData = ownership.doc.data();
    await db.collection('packages').doc(id).update({
      archivedAt: FieldValue.serverTimestamp(),
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PACKAGE_ARCHIVE,
      target: { type: 'package', id },
      metadata: { nombrePaquete: prevData.nombrePaquete || null },
      severity: SEVERITY.INFO,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to archive package.', 500);
  }
});

router.post('/api/packages/:id/unarchive', authenticate, requireSupervisor, rateLimit('packages_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const prevData = ownership.doc.data();
    await db.collection('packages').doc(id).update({
      archivedAt: FieldValue.delete(),
    });

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PACKAGE_UNARCHIVE,
      target: { type: 'package', id },
      metadata: { nombrePaquete: prevData.nombrePaquete || null },
      severity: SEVERITY.INFO,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to unarchive package.', 500);
  }
});

module.exports = router;
