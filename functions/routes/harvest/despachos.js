// Despachos de cosecha. Cada despacho agrupa boletas (registros) y se vincula a
// un comprador; sostiene la justificación de los ingresos de la finca.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { pick, verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { requireEncargado, normalizeBoletas, isValidISODate, maxAllowedFechaISO } = require('./validation');
const { findActiveDispatchUsingBoletas, findIncomeReferencingDispatch } = require('./guards');

const router = Router();

router.get('/api/cosecha/despachos', authenticate, requireEncargado, rateLimit('cosecha_read', 'costly_read'), async (req, res) => {
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
    // Misma validación estricta de fecha que los registros (rechaza 2026-02-30 y
    // fechas futuras; el techo "mañana UTC" tolera el desfase de TZ front/back).
    if (!isValidISODate(data.fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format.', 400);
    }
    if (data.fecha > maxAllowedFechaISO()) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Date cannot be after the current day.', 400);
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
    // Cada boleta debe referenciar un cosecha_registro EXISTENTE de esta finca.
    // normalizeBoletas sólo valida forma; sin este chequeo un despacho podría
    // apuntar a registros de otra finca o a ids inexistentes y, como el despacho
    // sostiene un ingreso, romper la trazabilidad cosecha↔ingreso (y abrir una
    // vía de referencia cruzada entre fincas). getAll en un solo round-trip.
    if (boletas.length > 0) {
      const refs = boletas.map(b => db.collection('cosecha_registros').doc(b.id));
      const snaps = await db.getAll(...refs);
      const invalid = snaps.some(s => !s.exists || s.data().fincaId !== req.fincaId);
      if (invalid) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'A boleta references a harvest record that does not exist in this finca.', 400);
      }
      // Una boleta pertenece a lo sumo a un despacho ACTIVO. Sin este chequeo dos
      // despachos activos podrían reclamar la misma boleta desde su creación →
      // doble conteo de cosecha→ingreso. Mismo guard que la reactivación (PUT),
      // aplicado también al crear.
      const clash = await findActiveDispatchUsingBoletas(req.fincaId, boletas.map(b => b.id));
      if (clash) {
        return sendApiError(
          res,
          ERROR_CODES.CONFLICT,
          `A boleta is already used by active dispatch ${clash.data().consecutivo || clash.id}.`,
          409,
        );
      }
    }
    data.boletas = boletas;
    // Conciliación suave (no bloqueante, H8): si TODAS las boletas traen cantidad,
    // persistimos su suma para que reportes/auditoría puedan detectar divergencias
    // contra `cantidad` (el peso de báscula declarado, que puede diferir
    // legítimamente del campo por merma/humedad/pesaje). Si alguna boleta no trae
    // cantidad la suma sería parcial/engañosa → null (no reconciliable).
    const boletasConCantidad = boletas.length > 0 && boletas.every(b => typeof b.cantidad === 'number');
    data.boletasCantidadSum = boletasConCantidad
      ? Math.round(boletas.reduce((sum, b) => sum + b.cantidad, 0) * 100) / 100
      : null;
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
      // Autoría en el documento monetizable: quién creó el despacho que sostiene
      // un ingreso. Cierra el hueco forense "sin rastro de autoría" de forma más
      // durable que un audit event (el doc no tiene TTL). Los creates de cosecha
      // quedan fuera del audit stream por política del archivo (H5).
      creadoPor: req.uid,
      creadoPorEmail: req.userEmail || '',
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
      // Trazabilidad inversa cosecha↔ingreso: si un ingreso ACTIVO referencia este
      // despacho, anularlo lo sacaría del conteo de cosecha mientras el ingreso
      // sigue contando la plata → doble contabilidad / datos contaminados.
      // Política: BLOQUEAR. El usuario debe primero revertir, editar (sacar el
      // despacho de despachoIds) o anular el ingreso para liberar el despacho;
      // recién ahí se puede anular acá. Sólo aplica en la transición real
      // activo→anulado. El front traduce RESOURCE_REFERENCED → 409.
      if (current.estado !== 'anulado') {
        const incomeRef = await findIncomeReferencingDispatch(req.fincaId, id);
        if (incomeRef) {
          const inc = incomeRef.data();
          return sendApiError(
            res,
            ERROR_CODES.RESOURCE_REFERENCED,
            `Dispatch is referenced by active income ${incomeRef.id} (${inc.date || 'n/d'}); revert that income before voiding the dispatch.`,
            409,
          );
        }
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
        const clash = await findActiveDispatchUsingBoletas(req.fincaId, myBoletaIds, { excludeDispatchId: id });
        if (clash) {
          return sendApiError(res, ERROR_CODES.CONFLICT, 'A boleta of this dispatch is already used by another active dispatch.', 409);
        }
      }
      // Reactivar limpia el motivo previo.
      data.notaAnulacion = '';
      data.anuladoEn = null;
    }
    await db.collection('cosecha_despachos').doc(id).update({ ...data, actualizadoPor: req.uid, actualizadoEn: Timestamp.now() });
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
