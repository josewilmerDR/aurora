// Gestión de las bodegas (warehouses) en sí: crear, editar, borrar y listar.
// Separado de warehouses.js (que maneja items y movimientos) para mantener
// ambos archivos bajo el presupuesto de LOC (docs/code-standards.md §1).
//
// Una "bodega" es un almacén tipado. El campo `tipo` determina qué componente
// del frontend se renderiza (agroquimicos, combustibles, generica…). Las
// bodegas de sistema (agroquimicos/combustibles) no se editan ni borran.
const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { buildBodegaCreate, buildBodegaUpdate } = require('./warehouses.schemas');

const router = Router();

// Backend es la fuente de verdad — el UI gating es defensa secundaria. Listar
// requiere `encargado` (coincide con el route gate); crear/editar/borrar la
// bodega es operación admin (`administrador`), igual que el gate /admin/bodegas.
const requireRole = (minRole) => (req, res, next) =>
  hasMinRoleBE(req.userRole, minRole)
    ? next()
    : sendApiError(res, ERROR_CODES.FORBIDDEN, `Requires ${minRole} role or higher.`, 403);

// --- API ENDPOINTS: BODEGAS ---
// Si la finca no tiene bodegas, se auto-siembran las de sistema.
router.get('/api/bodegas', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const snap = await db.collection('bodegas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('orden')
      .get();

    if (!snap.empty) {
      return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    // Auto-seed: first execution per finca.
    // Nota de seguridad (auditoría 2026-06-05): este GET (accesible por
    // `encargado`) dispara escrituras de sistema en la primera visita de una
    // finca sin bodegas. Es ACEPTADO a propósito: el seed es idempotente (solo
    // corre cuando `snap.empty`), acotado (2 docs fijos), sin input del cliente
    // y sin PII. No se mueve a un endpoint admin-gated para no romper la primera
    // vista del encargado (que necesita ver las bodegas de sistema sin depender
    // de que un admin haya hecho un provisioning previo).
    const now = Timestamp.now();
    const agroquimicos = { nombre: 'Agroquímicos', tipo: 'agroquimicos', icono: 'FiDroplet', orden: 1, fincaId: req.fincaId, creadoEn: now };
    const combustibles = { nombre: 'Combustibles',  tipo: 'combustibles',  icono: 'FiDroplet', orden: 2, fincaId: req.fincaId, creadoEn: now };
    const [refAgroq, refComb] = await Promise.all([
      db.collection('bodegas').add(agroquimicos),
      db.collection('bodegas').add(combustibles),
    ]);
    return res.json([
      { id: refAgroq.id, ...agroquimicos },
      { id: refComb.id,  ...combustibles },
    ]);
  } catch (err) {
    console.error('[bodegas GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch bodegas.', 500);
  }
});

router.post('/api/bodegas', authenticate, requireRole('administrador'), rateLimit('bodega-admin', 'write'), async (req, res) => {
  try {
    const { data, error } = buildBodegaCreate(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const { clientBodegaId } = data;

    // Idempotencia: si el cliente envía clientBodegaId, se usa como doc ID; un
    // reintento con la misma clave encuentra el doc ya escrito y lo devuelve sin
    // crear un duplicado. El cálculo de orden se hace dentro de la transacción.
    const docRef = clientBodegaId
      ? db.collection('bodegas').doc(clientBodegaId)
      : db.collection('bodegas').doc();
    let duplicate = false;
    const bodega = await db.runTransaction(async (t) => {
      if (clientBodegaId) {
        const existing = await t.get(docRef);
        if (existing.exists) {
          // Defensa cross-finca: una clave que ya pertenece a otra finca no se
          // reusa ni se filtra; se trata como duplicado del dueño legítimo.
          duplicate = true;
          return existing.data();
        }
      }
      // Calculate order: max + 1 (dentro de la transacción para consistencia).
      const snap = await db.collection('bodegas').where('fincaId', '==', req.fincaId).get();
      const maxOrden = snap.empty ? 1 : Math.max(...snap.docs.map(d => d.data().orden || 0));
      const nueva = {
        nombre: data.nombre,
        tipo: 'generica',
        icono: data.icono,
        orden: maxOrden + 1,
        fincaId: req.fincaId,
        creadoEn: Timestamp.now(),
      };
      t.set(docRef, nueva);
      return nueva;
    });
    // Un duplicado de otra finca no debe devolver sus datos al llamante.
    if (duplicate && bodega.fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Idempotency key already in use.', 409);
    }
    return res.status(duplicate ? 200 : 201).json({ id: docRef.id, ...bodega });
  } catch (err) {
    console.error('[bodegas POST]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create bodega.', 500);
  }
});

router.put('/api/bodegas/:id', authenticate, requireRole('administrador'), rateLimit('bodega-admin', 'write'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'System bodegas cannot be edited.', 403);
    }
    const { data, error } = buildBodegaUpdate(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const updates = {};
    if (data.nombre !== undefined) updates.nombre = data.nombre;
    if (data.icono !== undefined) updates.icono = data.icono;
    await check.doc.ref.update(updates);
    return res.json({ id: req.params.id, ...check.doc.data(), ...updates });
  } catch (err) {
    console.error('[bodegas PUT]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update bodega.', 500);
  }
});

router.delete('/api/bodegas/:id', authenticate, requireRole('administrador'), rateLimit('bodega-admin', 'write'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'System bodegas cannot be deleted.', 403);
    }
    // Only delete if it has no items
    const itemsSnap = await db.collection('bodega_items')
      .where('bodegaId', '==', req.params.id).limit(1).get();
    if (!itemsSnap.empty) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot delete a bodega that still has items. Remove all items first.', 409);
    }
    const prev = check.doc.data();
    await check.doc.ref.delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BODEGA_DELETE,
      target: { type: 'bodega', id: req.params.id },
      metadata: { nombre: prev.nombre || null, tipo: prev.tipo || null },
      severity: SEVERITY.WARNING,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[bodegas DELETE]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete bodega.', 500);
  }
});

module.exports = router;
