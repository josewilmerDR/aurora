const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE, pick } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { getLiveCosts } = require('./costs.live');
const {
  validateBody,
  indirectoCreateSchema,
  indirectoUpdateSchema,
  snapshotCreateSchema,
} = require('./costs.schemas');

const router = Router();

// El Centro de Costos expone datos financieros consolidados de toda la finca
// (planilla, depreciación, ROI). El sidebar lo gatea a encargado+, pero la UI
// es defensa secundaria: el backend tiene que replicar el mínimo o un
// trabajador con token puede leer/escribir vía API directa. Middleware
// reutilizable para no repetir el chequeo en cada handler.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ██  COST CENTER — live aggregation, indirects, snapshots
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/costos/live — agregación en vivo (handler en costs.live.js).
// rateLimit: lee 10 colecciones completas de la finca por request (el endpoint
// más caro del dominio); el bucket 'write' acota el martilleo desde el date-picker.
router.get('/api/costos/live', authenticate, requireRole('encargado'), rateLimit('costos_live', 'write'), getLiveCosts);

// CRUD costos_indirectos
router.get('/api/costos/indirectos', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const snap = await db.collection('costos_indirectos')
      .where('fincaId', '==', req.fincaId)
      .get();
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data(), creadoAt: d.data().creadoAt?.toDate?.()?.toISOString() || null }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.json(data);
  } catch (error) {
    console.error('[costos/indirectos:get]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch indirect costs.', 500);
  }
});

router.post('/api/costos/indirectos', authenticate, requireRole('encargado'), rateLimit('costos_write', 'write'), async (req, res) => {
  try {
    const { data: body, error } = validateBody(indirectoCreateSchema, req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const data = {
      fecha: body.fecha, categoria: body.categoria, descripcion: body.descripcion,
      monto: body.monto,
      fincaId: req.fincaId, creadoPor: req.uid, creadoAt: Timestamp.now(),
    };
    const ref = await db.collection('costos_indirectos').add(data);
    res.status(201).json({ id: ref.id, ...data });
  } catch (error) {
    console.error('[costos/indirectos:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create indirect cost.', 500);
  }
});

router.put('/api/costos/indirectos/:id', authenticate, requireRole('encargado'), rateLimit('costos_write', 'write'), async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_indirectos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { data: body, error } = validateBody(indirectoUpdateSchema, req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const data = pick(body, ['fecha', 'categoria', 'descripcion', 'monto']);
    data.actualizadoEn = Timestamp.now();
    await db.collection('costos_indirectos').doc(req.params.id).update(data);
    res.json({ id: req.params.id, ...data });
  } catch (error) {
    console.error('[costos/indirectos:put]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update indirect cost.', 500);
  }
});

router.delete('/api/costos/indirectos/:id', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_indirectos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const prev = ownership.doc.data();
    await db.collection('costos_indirectos').doc(req.params.id).delete();
    writeAuditEvent({
      fincaId: req.fincaId, actor: req,
      action: ACTIONS.COSTO_INDIRECTO_DELETE,
      target: { type: 'costos_indirectos', id: req.params.id },
      metadata: { fecha: prev?.fecha || null, categoria: prev?.categoria || null, monto: prev?.monto ?? null },
      severity: SEVERITY.WARNING,
    });
    res.json({ message: 'Deleted.' });
  } catch (error) {
    console.error('[costos/indirectos:delete]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete indirect cost.', 500);
  }
});

// CRUD costos_snapshots
router.get('/api/costos/snapshots', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const snap = await db.collection('costos_snapshots')
      .where('fincaId', '==', req.fincaId)
      .get();
    const data = snap.docs
      .map(d => {
        const raw = d.data();
        return {
          id: d.id,
          nombre: raw.nombre,
          tipo: raw.tipo,
          rangoFechas: raw.rangoFechas,
          resumen: raw.resumen,
          fechaCreacion: raw.fechaCreacion?.toDate?.()?.toISOString() || null,
          creadoPor: raw.creadoPor,
        };
      })
      .sort((a, b) => (b.fechaCreacion || '').localeCompare(a.fechaCreacion || ''));
    res.json(data);
  } catch (error) {
    console.error('[costos/snapshots:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch snapshots.', 500);
  }
});

router.get('/api/costos/snapshots/:id', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const raw = ownership.doc.data();
    // Whitelist explícita: no hacemos spread del doc crudo para no filtrar
    // fincaId ni creadoPor (uid interno) al cliente.
    res.json({
      id: ownership.doc.id,
      ...pick(raw, ['nombre', 'tipo', 'rangoFechas', 'resumen', 'porLote', 'porGrupo', 'porBloque', 'creadoPor']),
      fechaCreacion: raw.fechaCreacion?.toDate?.()?.toISOString() || null,
    });
  } catch (error) {
    console.error('[costos/snapshots:get]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch snapshot.', 500);
  }
});

router.post('/api/costos/snapshots', authenticate, requireRole('encargado'), rateLimit('costos_write', 'write'), async (req, res) => {
  try {
    const { data: body, error } = validateBody(snapshotCreateSchema, req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const data = {
      nombre: body.nombre, tipo: body.tipo,
      rangoFechas: body.rangoFechas, resumen: body.resumen,
      porLote: body.porLote, porGrupo: body.porGrupo, porBloque: body.porBloque,
      fincaId: req.fincaId, creadoPor: req.uid, fechaCreacion: Timestamp.now(),
    };
    const ref = await db.collection('costos_snapshots').add(data);
    res.status(201).json({ id: ref.id, nombre: data.nombre });
  } catch (error) {
    console.error('[costos/snapshots:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create snapshot.', 500);
  }
});

router.delete('/api/costos/snapshots/:id', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const ownership = await verifyOwnership('costos_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const prev = ownership.doc.data();
    await db.collection('costos_snapshots').doc(req.params.id).delete();
    writeAuditEvent({
      fincaId: req.fincaId, actor: req,
      action: ACTIONS.COSTO_SNAPSHOT_DELETE,
      target: { type: 'costos_snapshots', id: req.params.id },
      metadata: { nombre: prev?.nombre || null, tipo: prev?.tipo || null, rangoFechas: prev?.rangoFechas || null },
      severity: SEVERITY.WARNING,
    });
    res.json({ message: 'Snapshot deleted.' });
  } catch (error) {
    console.error('[costos/snapshots:delete]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete snapshot.', 500);
  }
});

module.exports = router;
