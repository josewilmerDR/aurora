const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

const router = Router();

// Cosecha es un módulo operativo de encargado+ (gateado así en el frontend,
// routeRoles.js → '/cosecha/*': 'encargado'). El backend re-aplica el piso para
// que un trabajador no pueda crear/anular despachos ni tocar registros llamando
// la API directamente.
function requireEncargado(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only encargado or above can access harvest data.', 403);
  }
  next();
}

// Normaliza y valida el array de boletas que compone un despacho. Cada boleta
// debe ser un objeto con un id de registro (string), y opcionalmente consecutivo
// (string) y cantidad (número). Descarta cualquier campo no whitelisteado para
// que el cliente no pueda inyectar objetos arbitrarios/anidados al doc, y capa
// el tamaño del array. Devuelve { error, boletas }.
const MAX_BOLETAS = 256;
function normalizeBoletas(raw) {
  if (raw === undefined || raw === null) return { boletas: [] };
  if (!Array.isArray(raw)) return { error: 'Boletas must be an array.' };
  if (raw.length > MAX_BOLETAS) return { error: `Too many boletas (max ${MAX_BOLETAS}).` };
  const boletas = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return { error: 'Each boleta must be an object.' };
    }
    if (typeof b.id !== 'string' || b.id.length === 0 || b.id.length > 1500) {
      return { error: 'Each boleta requires a valid id.' };
    }
    const boleta = { id: b.id };
    if (b.consecutivo !== undefined && b.consecutivo !== null) {
      if (typeof b.consecutivo !== 'string' || b.consecutivo.length > 64) {
        return { error: 'Invalid boleta consecutivo.' };
      }
      boleta.consecutivo = b.consecutivo;
    }
    if (b.cantidad !== undefined && b.cantidad !== null && b.cantidad !== '') {
      const c = Number(b.cantidad);
      if (!Number.isFinite(c) || c < 0 || c >= 16384) {
        return { error: 'Invalid boleta cantidad.' };
      }
      boleta.cantidad = c;
    }
    boletas.push(boleta);
  }
  return { boletas };
}

// ── Harvest record payload validation ────────────────────────────────────────
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strict validation: rejects non-existent dates like "2026-02-30"
// (which `new Date()` would silently normalize to another real date).
function isValidISODate(s) {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// Upper bound of the allowed `fecha` range. Uses "tomorrow UTC" as the ceiling
// to tolerate timezone differences between the client (local time) and the
// server (UTC) — avoids rejecting a valid "today" date in the user's TZ when
// UTC has not yet advanced to the same day.
function maxAllowedFechaISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function validateCosechaPayload(body, { partial = false } = {}) {
  // fecha — required, strict YYYY-MM-DD format, not after current day
  if (!partial || body.fecha !== undefined) {
    if (!isValidISODate(body.fecha)) {
      return 'Date is required in YYYY-MM-DD format.';
    }
    if (body.fecha > maxAllowedFechaISO()) {
      return 'Date cannot be after the current day.';
    }
  }

  // loteId — required
  if (!partial || body.loteId !== undefined) {
    const loteId = body.loteId;
    if (typeof loteId !== 'string' || loteId.trim().length === 0) {
      return 'Lote is required.';
    }
    if (loteId.length > 128) return 'Lote identifier is too long.';
  }

  // loteNombre
  if (body.loteNombre !== undefined && body.loteNombre !== null && body.loteNombre !== '') {
    if (typeof body.loteNombre !== 'string' || body.loteNombre.length > 128) {
      return 'Lote name cannot exceed 128 characters.';
    }
  }

  // grupo
  if (body.grupo !== undefined && body.grupo !== null && body.grupo !== '') {
    if (typeof body.grupo !== 'string' || body.grupo.length > 128) {
      return 'Grupo cannot exceed 128 characters.';
    }
  }

  // bloque
  if (body.bloque !== undefined && body.bloque !== null && body.bloque !== '') {
    if (typeof body.bloque !== 'string' || body.bloque.length > 64) {
      return 'Bloque cannot exceed 64 characters.';
    }
  }

  // cantidad — required, > 0 and < 16384
  if (!partial || body.cantidad !== undefined) {
    const cant = Number(body.cantidad);
    if (!Number.isFinite(cant) || cant <= 0 || cant >= 16384) {
      return 'Harvested quantity must be greater than 0 and less than 16384.';
    }
  }

  // cantidadRecibidaPlanta — optional, ≥ 0 and < 16384 when present
  if (
    body.cantidadRecibidaPlanta !== undefined &&
    body.cantidadRecibidaPlanta !== null &&
    body.cantidadRecibidaPlanta !== ''
  ) {
    const cr = Number(body.cantidadRecibidaPlanta);
    if (!Number.isFinite(cr) || cr < 0 || cr >= 16384) {
      return 'Quantity received at plant must be between 0 and 16384.';
    }
  }

  // unidad
  if (body.unidad !== undefined && body.unidad !== null && body.unidad !== '') {
    if (typeof body.unidad !== 'string' || body.unidad.length > 64) {
      return 'Unit cannot exceed 64 characters.';
    }
  }

  // unidadId — id de catálogo persistido para poder pre-seleccionar la unidad
  // si en el futuro se edita el registro (round-trip). #13 audit.
  if (body.unidadId !== undefined && body.unidadId !== null && body.unidadId !== '') {
    if (typeof body.unidadId !== 'string' || body.unidadId.length > 128) {
      return 'Invalid unit identifier.';
    }
  }

  // operarioId / operarioNombre
  if (body.operarioId !== undefined && body.operarioId !== null && body.operarioId !== '') {
    if (typeof body.operarioId !== 'string' || body.operarioId.length > 128) {
      return 'Invalid operario identifier.';
    }
  }
  if (body.operarioNombre !== undefined && body.operarioNombre !== null && body.operarioNombre !== '') {
    if (typeof body.operarioNombre !== 'string' || body.operarioNombre.length > 128) {
      return 'Operario name cannot exceed 128 characters.';
    }
  }

  // activoId / activoNombre
  if (body.activoId !== undefined && body.activoId !== null && body.activoId !== '') {
    if (typeof body.activoId !== 'string' || body.activoId.length > 128) {
      return 'Invalid asset identifier.';
    }
  }
  if (body.activoNombre !== undefined && body.activoNombre !== null && body.activoNombre !== '') {
    if (typeof body.activoNombre !== 'string' || body.activoNombre.length > 160) {
      return 'Asset name cannot exceed 160 characters.';
    }
  }

  // implementoId / implementoNombre
  if (body.implementoId !== undefined && body.implementoId !== null && body.implementoId !== '') {
    if (typeof body.implementoId !== 'string' || body.implementoId.length > 128) {
      return 'Invalid implement identifier.';
    }
  }
  if (body.implementoNombre !== undefined && body.implementoNombre !== null && body.implementoNombre !== '') {
    if (typeof body.implementoNombre !== 'string' || body.implementoNombre.length > 160) {
      return 'Implement name cannot exceed 160 characters.';
    }
  }

  // nota — strictly less than 288 characters
  if (body.nota !== undefined && body.nota !== null && body.nota !== '') {
    if (typeof body.nota !== 'string' || body.nota.length >= 288) {
      return 'Note cannot exceed 287 characters.';
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Harvest Records
// ══════════════════════════════════════════════════════════════════════════════
router.get('/api/cosecha/registros', authenticate, requireEncargado, async (req, res) => {
  try {
    const snapshot = await db.collection('cosecha_registros')
      .where('fincaId', '==', req.fincaId)
      .get();
    const records = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.status(200).json(records);
  } catch (error) {
    console.error('Error fetching cosecha records:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch records.', 500);
  }
});

router.post('/api/cosecha/registros', authenticate, requireEncargado, rateLimit('cosecha_write', 'write'), async (req, res) => {
  try {
    const allowed = [
      'fecha', 'loteId', 'loteNombre', 'grupo', 'bloque',
      'cantidad', 'unidad', 'unidadId',
      'operarioId', 'operarioNombre',
      'activoId', 'activoNombre',
      'implementoId', 'implementoNombre',
      'nota', 'cantidadRecibidaPlanta',
    ];
    const data = pick(req.body, allowed);
    const validationError = validateCosechaPayload(data);
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    // El loteId debe pertenecer a la finca: evita registros que referencien lotes
    // de otra finca (o inexistentes) y deriva el nombre del lote del lado servidor
    // en vez de confiar en el loteNombre del cliente.
    const loteOwnership = await verifyOwnership('lotes', data.loteId, req.fincaId);
    if (!loteOwnership.ok) return sendApiError(res, loteOwnership.code, loteOwnership.message, loteOwnership.status);
    data.loteNombre = loteOwnership.doc.data().nombreLote || '';
    data.cantidad = parseFloat(data.cantidad);
    if (data.cantidadRecibidaPlanta != null) {
      data.cantidadRecibidaPlanta = parseFloat(data.cantidadRecibidaPlanta) || 0;
    }
    const counterRef = db.collection('counters').doc(`cosecha_${req.fincaId}`);
    let seq;
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      t.set(counterRef, { value: seq }, { merge: true });
    });
    const consecutivo = `RC-${String(seq).padStart(6, '0')}`;
    const ref = await db.collection('cosecha_registros').add({
      ...data,
      consecutivo,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, consecutivo, ...data });
  } catch (error) {
    console.error('Error creating cosecha record:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save record.', 500);
  }
});

router.put('/api/cosecha/registros/:id', authenticate, requireEncargado, rateLimit('cosecha_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const allowed = [
      'fecha', 'loteId', 'loteNombre', 'grupo', 'bloque',
      'cantidad', 'unidad', 'unidadId',
      'operarioId', 'operarioNombre',
      'activoId', 'activoNombre',
      'implementoId', 'implementoNombre',
      'nota', 'cantidadRecibidaPlanta',
    ];
    const data = pick(req.body, allowed);
    const validationError = validateCosechaPayload(data, { partial: true });
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    // Si cambia el loteId, validá ownership y deriva el nombre del servidor.
    if (data.loteId !== undefined) {
      const loteOwnership = await verifyOwnership('lotes', data.loteId, req.fincaId);
      if (!loteOwnership.ok) return sendApiError(res, loteOwnership.code, loteOwnership.message, loteOwnership.status);
      data.loteNombre = loteOwnership.doc.data().nombreLote || '';
    }
    if (data.cantidad != null) data.cantidad = parseFloat(data.cantidad);
    if (data.cantidadRecibidaPlanta != null) {
      data.cantidadRecibidaPlanta = parseFloat(data.cantidadRecibidaPlanta) || 0;
    }
    await db.collection('cosecha_registros').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error updating cosecha record:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update record.', 500);
  }
});

router.delete('/api/cosecha/registros/:id', authenticate, requireEncargado, rateLimit('cosecha_write', 'write'), async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    // Guardrail: un registro usado como boleta en un despacho ACTIVO no se puede
    // borrar — dejaría el despacho apuntando a una boleta inexistente y rompería
    // la trazabilidad ingreso↔cosecha. El front traduce RESOURCE_REFERENCED → 409.
    const despachosSnap = await db.collection('cosecha_despachos')
      .where('fincaId', '==', req.fincaId)
      .get();
    const despachoEnUso = despachosSnap.docs.find(d => {
      const data = d.data();
      if (data.estado === 'anulado') return false;
      return Array.isArray(data.boletas) && data.boletas.some(b => b && b.id === id);
    });
    if (despachoEnUso) {
      return sendApiError(
        res,
        ERROR_CODES.RESOURCE_REFERENCED,
        `Cosecha record is used as a boleta in active dispatch ${despachoEnUso.data().consecutivo || despachoEnUso.id}; void that dispatch first.`,
        409,
      );
    }
    const registro = ownership.doc.data();
    await db.collection('cosecha_registros').doc(id).delete();
    // Borrado irreversible de una boleta de cosecha: dejá rastro de quién/cuándo
    // y qué registro (consecutivo) se borró.
    await writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.COSECHA_RECORD_DELETE,
      target: { type: 'cosecha_registro', id },
      metadata: { consecutivo: registro.consecutivo || null, loteNombre: registro.loteNombre || null },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error deleting cosecha record:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

// Harvest Dispatches
// ══════════════════════════════════════════════════════════════════════════════
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
      // Reactivar libera... no: vuelve a reclamar las boletas de este despacho.
      // Si otro despacho ACTIVO ya las tomó mientras éste estaba anulado, una
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
