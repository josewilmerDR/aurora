// Despachos de cosecha. Cada despacho agrupa boletas (registros) y se vincula a
// un comprador; sostiene la justificación de los ingresos de la finca.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { pick, verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { requireEncargado, normalizeBoletas } = require('./validation');

const router = Router();

router.get('/api/cosecha/despachos', authenticate, requireEncargado, async (req, res) => {
  try {
    const snapshot = await db.collection('cosecha_despachos')
      .where('fincaId', '==', req.fincaId)
      .get();
    const records = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching cosecha dispatches:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch dispatches.', 500);
  }
});

router.post('/api/cosecha/despachos', authenticate, requireEncargado, rateLimit('cosecha_write', 'write'), async (req, res) => {
  try {
    const allowed = [
      'fecha', 'loteId', 'loteNombre',
      'operarioCamionNombre', 'placaCamion',
      'cantidad', 'unidad', 'unidadId',
      'boletas',
      'buyerId', 'buyerName',
      'despachadorId', 'despachadorNombre',
      'encargadoId', 'encargadoNombre',
      'nota',
    ];
    const data = pick(req.body, allowed);
    if (!data.fecha || !data.loteId || data.cantidad == null) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fecha, loteId and cantidad are required.', 400);
    }
    if (!data.buyerId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'buyerId is required.', 400);
    }
    // Validate date format (+1 day tolerance for frontend/backend TZ differences)
    if (typeof data.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format.', 400);
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const limitStr = tomorrow.toISOString().slice(0, 10);
    if (data.fecha > limitStr) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid or future date.', 400);
    }
    // Validate quantity (must be strictly positive — a zero-quantity dispatch
    // has no business meaning and can still be linked to an income).
    data.cantidad = parseFloat(data.cantidad);
    if (isNaN(data.cantidad) || data.cantidad <= 0 || data.cantidad > 32768) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Quantity must be greater than 0 and at most 32768.', 400);
    }
    // Verify referenced IDs exist AND belong to this finca (verifyOwnership
    // folds both into a 404, evitando enumeración cross-tenant y la fuga del
    // nombre del lote/usuario/unidad de otra finca). Los nombres se derivan
    // siempre del lado servidor.
    const loteOwnership = await verifyOwnership('lotes', data.loteId, req.fincaId);
    if (!loteOwnership.ok) return sendApiError(res, loteOwnership.code, loteOwnership.message, loteOwnership.status);
    data.loteNombre = loteOwnership.doc.data().nombreLote || '';

    if (data.despachadorId) {
      const despOwnership = await verifyOwnership('users', data.despachadorId, req.fincaId);
      if (!despOwnership.ok) return sendApiError(res, despOwnership.code, despOwnership.message, despOwnership.status);
      data.despachadorNombre = despOwnership.doc.data().nombre || '';
    }
    if (data.encargadoId) {
      const encOwnership = await verifyOwnership('users', data.encargadoId, req.fincaId);
      if (!encOwnership.ok) return sendApiError(res, encOwnership.code, encOwnership.message, encOwnership.status);
      data.encargadoNombre = encOwnership.doc.data().nombre || '';
    }
    if (data.unidadId) {
      const uniOwnership = await verifyOwnership('unidades_medida', data.unidadId, req.fincaId);
      if (!uniOwnership.ok) return sendApiError(res, uniOwnership.code, uniOwnership.message, uniOwnership.status);
      data.unidad = uniOwnership.doc.data().nombre || '';
    }
    const buyerOwnership = await verifyOwnership('buyers', data.buyerId, req.fincaId);
    if (!buyerOwnership.ok) return sendApiError(res, buyerOwnership.code, buyerOwnership.message, buyerOwnership.status);
    data.buyerName = buyerOwnership.doc.data().name || '';

    // Coaccioná a string y truncá; un campo no-string se descarta en vez de
    // persistirse crudo (un objeto/array en nota/placa rompería el render y la
    // integridad del doc).
    const strLimits = { operarioCamionNombre: 48, placaCamion: 12, nota: 288, unidad: 64 };
    for (const [field, max] of Object.entries(strLimits)) {
      if (data[field] === undefined || data[field] === null) continue;
      data[field] = typeof data[field] === 'string' ? data[field].slice(0, max) : '';
    }
    // Whitelist + cap del array de boletas (sin esto el cliente puede inyectar
    // objetos arbitrarios/anidados o un array sin tope al documento).
    const { error: boletasError, boletas } = normalizeBoletas(data.boletas);
    if (boletasError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, boletasError, 400);
    data.boletas = boletas;
    data.estado = 'activo';
    const counterRef = db.collection('counters').doc(`cosecha_despachos_${req.fincaId}`);
    let seq;
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      t.set(counterRef, { value: seq }, { merge: true });
    });
    const consecutivo = `DC-${String(seq).padStart(6, '0')}`;
    const ref = await db.collection('cosecha_despachos').add({
      ...data,
      consecutivo,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, consecutivo, ...data });
  } catch (error) {
    console.error('Error creating cosecha dispatch:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save dispatch.', 500);
  }
});

router.put('/api/cosecha/despachos/:id', authenticate, requireEncargado, rateLimit('cosecha_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_despachos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const current = ownership.doc.data();
    const allowed = ['estado', 'notaAnulacion'];
    const data = pick(req.body, allowed);
    // Sólo se admiten transiciones de estado conocidas.
    if (data.estado != null && data.estado !== 'activo' && data.estado !== 'anulado') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid dispatch state.', 400);
    }
    // Anular exige un motivo (trazabilidad). El front lo pide en el modal.
    if (data.estado === 'anulado') {
      if (typeof data.notaAnulacion !== 'string' || !data.notaAnulacion.trim()) {
        return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'notaAnulacion is required to void a dispatch.', 400);
      }
      data.notaAnulacion = data.notaAnulacion.slice(0, 288);
      data.anuladoEn = Timestamp.now();
    } else if (data.estado === 'activo') {
      // Reactivar vuelve a reclamar las boletas de este despacho. Si otro
      // despacho ACTIVO ya las tomó mientras éste estaba anulado, una
      // reactivación ciega haría que ambos cuenten la misma boleta (doble conteo
      // de cosecha→ingreso). Rechazá la reactivación si hay solapamiento.
      if (current.estado === 'anulado') {
        const myBoletaIds = Array.isArray(current.boletas)
          ? current.boletas.map(b => b && b.id).filter(Boolean)
          : [];
        if (myBoletaIds.length > 0) {
          const idSet = new Set(myBoletaIds);
          // fincaId-only query (índice de campo único, sin índice compuesto) +
          // filtro de estado en memoria — mismo patrón que el delete-guard.
          const fincaSnap = await db.collection('cosecha_despachos')
            .where('fincaId', '==', req.fincaId)
            .get();
          const clash = fincaSnap.docs.some(d =>
            d.id !== id
            && d.data().estado !== 'anulado'
            && Array.isArray(d.data().boletas)
            && d.data().boletas.some(b => b && idSet.has(b.id)));
          if (clash) {
            return sendApiError(res, ERROR_CODES.CONFLICT, 'A boleta of this dispatch is already used by another active dispatch.', 409);
          }
        }
      }
      // Reactivar limpia el motivo previo.
      data.notaAnulacion = '';
      data.anuladoEn = null;
    }
    await db.collection('cosecha_despachos').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    // Anular es destructivo para la trazabilidad ingreso↔cosecha (libera boletas
    // y saca el despacho del conteo): dejá rastro forense de quién/cuándo/por qué.
    if (data.estado === 'anulado' && current.estado !== 'anulado') {
      await writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.COSECHA_DISPATCH_VOID,
        target: { type: 'cosecha_despacho', id },
        metadata: {
          consecutivo: current.consecutivo || null,
          motivo: data.notaAnulacion || null,
          cantidad: current.cantidad ?? null,
        },
        severity: SEVERITY.WARNING,
      });
    }
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error updating cosecha dispatch:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update dispatch.', 500);
  }
});

module.exports = router;
