// Registros de cosecha (boletas). CRUD scoping por finca; cada registro puede
// alimentar un despacho como boleta.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { pick, verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { requireEncargado, validateCosechaPayload } = require('./validation');

const router = Router();

const ALLOWED_FIELDS = [
  'fecha', 'loteId', 'loteNombre', 'grupo', 'bloque',
  'cantidad', 'unidad', 'unidadId',
  'operarioId', 'operarioNombre',
  'activoId', 'activoNombre',
  'implementoId', 'implementoNombre',
  'nota', 'cantidadRecibidaPlanta',
];

// Referencias opcionales de un registro: además del lote, un registro puede
// apuntar a un operario (users), un activo/implemento (maquinaria) y una unidad.
// Cada id presente debe pertenecer a la finca y su nombre se deriva del lado
// servidor (no se confía en el *Nombre del cliente), igual que en despachos —
// evita referencias colgantes cross-finca y mantiene el nombre autoritativo.
// [idField, nameField, collection, maxLen, nameFn]
const REF_CHECKS = [
  ['operarioId',   'operarioNombre',   'users',           128, d => d.nombre || ''],
  ['activoId',     'activoNombre',     'maquinaria',      160, d => [d.codigo, d.descripcion].filter(Boolean).join(' — ')],
  ['implementoId', 'implementoNombre', 'maquinaria',      160, d => [d.codigo, d.descripcion].filter(Boolean).join(' — ')],
  ['unidadId',     'unidad',           'unidades_medida',  64, d => d.nombre || ''],
];

// Verifica ownership de las referencias presentes en `data` y reescribe sus
// nombres con el valor del servidor. Devuelve el primer fallo de ownership como
// { ok:false, code, message, status } o { ok:true }.
async function resolveRegistroRefs(data, fincaId) {
  for (const [idField, nameField, collection, maxLen, nameFn] of REF_CHECKS) {
    if (data[idField] === undefined || data[idField] === null || data[idField] === '') continue;
    const own = await verifyOwnership(collection, data[idField], fincaId);
    if (!own.ok) return own;
    data[nameField] = String(nameFn(own.doc.data()) || '').slice(0, maxLen);
  }
  return { ok: true };
}

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
    const data = pick(req.body, ALLOWED_FIELDS);
    const validationError = validateCosechaPayload(data);
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    // El loteId debe pertenecer a la finca: evita registros que referencien lotes
    // de otra finca (o inexistentes) y deriva el nombre del lote del lado servidor
    // en vez de confiar en el loteNombre del cliente.
    const loteOwnership = await verifyOwnership('lotes', data.loteId, req.fincaId);
    if (!loteOwnership.ok) return sendApiError(res, loteOwnership.code, loteOwnership.message, loteOwnership.status);
    data.loteNombre = loteOwnership.doc.data().nombreLote || '';
    // operario/activo/implemento/unidad también scoped a la finca (nombres derivados).
    const refResult = await resolveRegistroRefs(data, req.fincaId);
    if (!refResult.ok) return sendApiError(res, refResult.code, refResult.message, refResult.status);
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
    const data = pick(req.body, ALLOWED_FIELDS);
    const validationError = validateCosechaPayload(data, { partial: true });
    if (validationError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    // Si cambia el loteId, validá ownership y deriva el nombre del servidor.
    if (data.loteId !== undefined) {
      const loteOwnership = await verifyOwnership('lotes', data.loteId, req.fincaId);
      if (!loteOwnership.ok) return sendApiError(res, loteOwnership.code, loteOwnership.message, loteOwnership.status);
      data.loteNombre = loteOwnership.doc.data().nombreLote || '';
    }
    // Revalidá ownership de cualquier referencia que venga en el update parcial.
    const refResult = await resolveRegistroRefs(data, req.fincaId);
    if (!refResult.ok) return sendApiError(res, refResult.code, refResult.message, refResult.status);
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

module.exports = router;
