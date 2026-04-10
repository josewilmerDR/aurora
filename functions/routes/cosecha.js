const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

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
    if (!data.fecha || !data.loteId || data.cantidad == null) {
      return res.status(400).json({ message: 'Fecha, lote y cantidad son obligatorios.' });
    }
    data.cantidad = parseFloat(data.cantidad) || 0;
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
    if (data.cantidad != null) data.cantidad = parseFloat(data.cantidad) || 0;
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
    data.cantidad = parseFloat(data.cantidad) || 0;
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
