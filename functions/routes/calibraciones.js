const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

// ─── CALIBRACIONES ────────────────────────────────────────────────────────────

router.get('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('calibraciones')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .get();
    const items = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(items);
  } catch (err) {
    console.error('Error al obtener calibraciones:', err);
    res.status(500).json({ message: 'Error al obtener calibraciones.' });
  }
});

router.post('/api/calibraciones', authenticate, async (req, res) => {
  try {
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    if (!data.nombre?.trim()) {
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }
    const doc = { ...data, fincaId: req.fincaId, creadoEn: Timestamp.now() };
    const ref = await db.collection('calibraciones').add(doc);
    res.status(201).json({ id: ref.id, ...doc });
  } catch (err) {
    console.error('Error al crear calibración:', err);
    res.status(500).json({ message: 'Error al crear la calibración.' });
  }
});

router.put('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const data = pick(req.body, [
      'nombre', 'fecha', 'tractorId', 'tractorNombre',
      'aplicadorId', 'aplicadorNombre', 'volumen', 'rpmRecomendado',
      'marchaRecomendada', 'tipoBoquilla', 'presionRecomendada',
      'velocidadKmH', 'responsableId', 'responsableNombre', 'metodo',
    ]);
    await db.collection('calibraciones').doc(req.params.id).update(data);
    res.status(200).json({ id: req.params.id, ...data });
  } catch (err) {
    console.error('Error al actualizar calibración:', err);
    res.status(500).json({ message: 'Error al actualizar la calibración.' });
  }
});

router.delete('/api/calibraciones/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('calibraciones', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('calibraciones').doc(req.params.id).delete();
    res.status(200).json({ message: 'Calibración eliminada.' });
  } catch (err) {
    console.error('Error al eliminar calibración:', err);
    res.status(500).json({ message: 'Error al eliminar la calibración.' });
  }
});

module.exports = router;
