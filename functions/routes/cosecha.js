const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

// ── Validación de payload de registro de cosecha ─────────────────────────────
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validación estricta: rechaza fechas inexistentes como "2026-02-30"
// (que `new Date()` normalizaría silenciosamente a otra fecha real).
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

// Límite superior del rango permitido para `fecha`. Usa "mañana UTC" como tope
// para tolerar la diferencia de zona horaria entre el cliente (hora local) y
// el servidor (UTC) — evita rechazar una fecha válida del día de hoy en el TZ
// del usuario cuando el UTC aún no ha avanzado al mismo día.
function maxAllowedFechaISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function validateCosechaPayload(body, { partial = false } = {}) {
  // fecha — requerida, formato YYYY-MM-DD estricto, no posterior al día actual
  if (!partial || body.fecha !== undefined) {
    if (!isValidISODate(body.fecha)) {
      return 'La fecha es requerida en formato YYYY-MM-DD.';
    }
    if (body.fecha > maxAllowedFechaISO()) {
      return 'La fecha no puede ser posterior al día actual.';
    }
  }

  // loteId — requerido
  if (!partial || body.loteId !== undefined) {
    const loteId = body.loteId;
    if (typeof loteId !== 'string' || loteId.trim().length === 0) {
      return 'El lote es requerido.';
    }
    if (loteId.length > 128) return 'El identificador del lote es demasiado largo.';
  }

  // loteNombre
  if (body.loteNombre !== undefined && body.loteNombre !== null && body.loteNombre !== '') {
    if (typeof body.loteNombre !== 'string' || body.loteNombre.length > 128) {
      return 'El nombre del lote no puede superar 128 caracteres.';
    }
  }

  // grupo
  if (body.grupo !== undefined && body.grupo !== null && body.grupo !== '') {
    if (typeof body.grupo !== 'string' || body.grupo.length > 128) {
      return 'El grupo no puede superar 128 caracteres.';
    }
  }

  // bloque
  if (body.bloque !== undefined && body.bloque !== null && body.bloque !== '') {
    if (typeof body.bloque !== 'string' || body.bloque.length > 64) {
      return 'El bloque no puede superar 64 caracteres.';
    }
  }

  // cantidad — requerida, > 0 y < 16384
  if (!partial || body.cantidad !== undefined) {
    const cant = Number(body.cantidad);
    if (!Number.isFinite(cant) || cant <= 0 || cant >= 16384) {
      return 'La cantidad cosechada debe ser mayor a 0 y menor a 16384.';
    }
  }

  // cantidadRecibidaPlanta — opcional, ≥ 0 y < 16384 cuando se envía
  if (
    body.cantidadRecibidaPlanta !== undefined &&
    body.cantidadRecibidaPlanta !== null &&
    body.cantidadRecibidaPlanta !== ''
  ) {
    const cr = Number(body.cantidadRecibidaPlanta);
    if (!Number.isFinite(cr) || cr < 0 || cr >= 16384) {
      return 'La cantidad recibida en planta debe ser un número entre 0 y 16384.';
    }
  }

  // unidad
  if (body.unidad !== undefined && body.unidad !== null && body.unidad !== '') {
    if (typeof body.unidad !== 'string' || body.unidad.length > 64) {
      return 'La unidad no puede superar 64 caracteres.';
    }
  }

  // operarioId / operarioNombre
  if (body.operarioId !== undefined && body.operarioId !== null && body.operarioId !== '') {
    if (typeof body.operarioId !== 'string' || body.operarioId.length > 128) {
      return 'El identificador del operario es inválido.';
    }
  }
  if (body.operarioNombre !== undefined && body.operarioNombre !== null && body.operarioNombre !== '') {
    if (typeof body.operarioNombre !== 'string' || body.operarioNombre.length > 128) {
      return 'El nombre del operario no puede superar 128 caracteres.';
    }
  }

  // activoId / activoNombre
  if (body.activoId !== undefined && body.activoId !== null && body.activoId !== '') {
    if (typeof body.activoId !== 'string' || body.activoId.length > 128) {
      return 'El identificador del activo es inválido.';
    }
  }
  if (body.activoNombre !== undefined && body.activoNombre !== null && body.activoNombre !== '') {
    if (typeof body.activoNombre !== 'string' || body.activoNombre.length > 160) {
      return 'El nombre del activo no puede superar 160 caracteres.';
    }
  }

  // implementoId / implementoNombre
  if (body.implementoId !== undefined && body.implementoId !== null && body.implementoId !== '') {
    if (typeof body.implementoId !== 'string' || body.implementoId.length > 128) {
      return 'El identificador del implemento es inválido.';
    }
  }
  if (body.implementoNombre !== undefined && body.implementoNombre !== null && body.implementoNombre !== '') {
    if (typeof body.implementoNombre !== 'string' || body.implementoNombre.length > 160) {
      return 'El nombre del implemento no puede superar 160 caracteres.';
    }
  }

  // nota — estrictamente menor a 288 caracteres
  if (body.nota !== undefined && body.nota !== null && body.nota !== '') {
    if (typeof body.nota !== 'string' || body.nota.length >= 288) {
      return 'La nota no puede superar 287 caracteres.';
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Registro de Cosecha
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
    console.error('Error al obtener registros de cosecha:', error);
    res.status(500).json({ message: 'Error al obtener los registros.' });
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
    if (validationError) return res.status(400).json({ message: validationError });
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
    console.error('Error al crear registro de cosecha:', error);
    res.status(500).json({ message: 'Error al guardar el registro.' });
  }
});

router.put('/api/cosecha/registros/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
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
    if (validationError) return res.status(400).json({ message: validationError });
    if (data.cantidad != null) data.cantidad = parseFloat(data.cantidad);
    if (data.cantidadRecibidaPlanta != null) {
      data.cantidadRecibidaPlanta = parseFloat(data.cantidadRecibidaPlanta) || 0;
    }
    await db.collection('cosecha_registros').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error al actualizar registro de cosecha:', error);
    res.status(500).json({ message: 'Error al actualizar el registro.' });
  }
});

router.delete('/api/cosecha/registros/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_registros', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('cosecha_registros').doc(id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    console.error('Error al eliminar registro de cosecha:', error);
    res.status(500).json({ message: 'Error al eliminar el registro.' });
  }
});

// Despacho de Cosecha
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
    console.error('Error al obtener despachos de cosecha:', error);
    res.status(500).json({ message: 'Error al obtener los despachos.' });
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
      return res.status(400).json({ message: 'Fecha, lote y cantidad son obligatorios.' });
    }
    // Validar formato de fecha (tolerancia +1 día para diferencias de timezone frontend/backend)
    if (typeof data.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
      return res.status(400).json({ message: 'Formato de fecha inválido.' });
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const limitStr = tomorrow.toISOString().slice(0, 10);
    if (data.fecha > limitStr) {
      return res.status(400).json({ message: 'Fecha inválida o futura.' });
    }
    // Validar cantidad
    data.cantidad = parseFloat(data.cantidad);
    if (isNaN(data.cantidad) || data.cantidad < 0 || data.cantidad > 32768) {
      return res.status(400).json({ message: 'Cantidad debe estar entre 0 y 32768.' });
    }
    // Verificar que los IDs referenciados existan en Firestore
    const loteDoc = await db.collection('lotes').doc(data.loteId).get();
    if (!loteDoc.exists) {
      return res.status(400).json({ message: 'El lote indicado no existe.' });
    }
    data.loteNombre = loteDoc.data().nombreLote || '';

    if (data.despachadorId) {
      const despDoc = await db.collection('users').doc(data.despachadorId).get();
      if (!despDoc.exists) {
        return res.status(400).json({ message: 'El despachador indicado no existe.' });
      }
      data.despachadorNombre = despDoc.data().nombre || '';
    }
    if (data.encargadoId) {
      const encDoc = await db.collection('users').doc(data.encargadoId).get();
      if (!encDoc.exists) {
        return res.status(400).json({ message: 'El encargado indicado no existe.' });
      }
      data.encargadoNombre = encDoc.data().nombre || '';
    }
    if (data.unidadId) {
      const uniDoc = await db.collection('unidades_medida').doc(data.unidadId).get();
      if (!uniDoc.exists) {
        return res.status(400).json({ message: 'La unidad indicada no existe.' });
      }
      data.unidad = uniDoc.data().nombre || '';
    }

    // Truncar strings a longitudes máximas
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
    console.error('Error al crear despacho de cosecha:', error);
    res.status(500).json({ message: 'Error al guardar el despacho.' });
  }
});

router.put('/api/cosecha/despachos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('cosecha_despachos', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const allowed = ['estado', 'notaAnulacion'];
    const data = pick(req.body, allowed);
    await db.collection('cosecha_despachos').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error al actualizar despacho de cosecha:', error);
    res.status(500).json({ message: 'Error al actualizar el despacho.' });
  }
});

module.exports = router;
