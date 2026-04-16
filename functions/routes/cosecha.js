const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

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
router.get('/api/cosecha/registros', authenticate, async (req, res) => {
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

router.post('/api/cosecha/registros', authenticate, async (req, res) => {
  try {
    const allowed = [
      'fecha', 'loteId', 'loteNombre', 'grupo', 'bloque',
      'cantidad', 'unidad',
      'operarioId', 'operarioNombre',
      'activoId', 'activoNombre',
      'implementoId', 'implementoNombre',
      'nota', 'cantidadRecibidaPlanta',
    ];
    const data = pick(req.body, allowed);
    const validationError = validateCosechaPayload(data);
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
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

router.put('/api/cosecha/registros/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const allowed = [
      'fecha', 'loteId', 'loteNombre', 'grupo', 'bloque',
      'cantidad', 'unidad',
      'operarioId', 'operarioNombre',
      'activoId', 'activoNombre',
      'implementoId', 'implementoNombre',
      'nota', 'cantidadRecibidaPlanta',
    ];
    const data = pick(req.body, allowed);
    const validationError = validateCosechaPayload(data, { partial: true });
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
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

router.delete('/api/cosecha/registros/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('cosecha_registros').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error deleting cosecha record:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

// Harvest Dispatches
// ══════════════════════════════════════════════════════════════════════════════
router.get('/api/cosecha/despachos', authenticate, async (req, res) => {
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

router.post('/api/cosecha/despachos', authenticate, async (req, res) => {
  try {
    const allowed = [
      'fecha', 'loteId', 'loteNombre',
      'operarioCamionNombre', 'placaCamion',
      'cantidad', 'unidad', 'unidadId',
      'boletas',
      'despachadorId', 'despachadorNombre',
      'encargadoId', 'encargadoNombre',
      'nota',
    ];
    const data = pick(req.body, allowed);
    if (!data.fecha || !data.loteId || data.cantidad == null) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fecha, loteId and cantidad are required.', 400);
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
    // Validate quantity
    data.cantidad = parseFloat(data.cantidad);
    if (isNaN(data.cantidad) || data.cantidad < 0 || data.cantidad > 32768) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Quantity must be between 0 and 32768.', 400);
    }
    // Verify referenced IDs exist in Firestore
    const loteDoc = await db.collection('lotes').doc(data.loteId).get();
    if (!loteDoc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'The specified lote does not exist.', 400);
    }
    data.loteNombre = loteDoc.data().nombreLote || '';

    if (data.despachadorId) {
      const despDoc = await db.collection('users').doc(data.despachadorId).get();
      if (!despDoc.exists) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, 'The specified dispatcher does not exist.', 400);
      }
      data.despachadorNombre = despDoc.data().nombre || '';
    }
    if (data.encargadoId) {
      const encDoc = await db.collection('users').doc(data.encargadoId).get();
      if (!encDoc.exists) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, 'The specified encargado does not exist.', 400);
      }
      data.encargadoNombre = encDoc.data().nombre || '';
    }
    if (data.unidadId) {
      const uniDoc = await db.collection('unidades_medida').doc(data.unidadId).get();
      if (!uniDoc.exists) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, 'The specified unit does not exist.', 400);
      }
      data.unidad = uniDoc.data().nombre || '';
    }

    // Truncate strings to max lengths
    const strLimits = { operarioCamionNombre: 48, placaCamion: 12, nota: 288 };
    for (const [field, max] of Object.entries(strLimits)) {
      if (typeof data[field] === 'string') data[field] = data[field].slice(0, max);
    }
    if (!Array.isArray(data.boletas)) data.boletas = [];
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

router.put('/api/cosecha/despachos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_despachos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const allowed = ['estado', 'notaAnulacion'];
    const data = pick(req.body, allowed);
    await db.collection('cosecha_despachos').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error updating cosecha dispatch:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update dispatch.', 500);
  }
});

module.exports = router;
