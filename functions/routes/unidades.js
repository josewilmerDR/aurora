const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');

const router = Router();

// ── Unidades de Medida ─────────────────────────────────────────────────────
router.get('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener unidades de medida.' });
  }
});

router.post('/api/unidades-medida', authenticate, async (req, res) => {
  try {
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
    const data = {
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      fincaId: req.fincaId,
    };
    // Upsert by nombre
    const existing = await db.collection('unidades_medida')
      .where('fincaId', '==', req.fincaId)
      .where('nombre', '==', data.nombre)
      .limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const { fincaId, ...updateData } = data;
      await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
      return res.status(200).json({ id: doc.id, merged: true });
    }
    data.creadoEn = Timestamp.now();
    const ref = await db.collection('unidades_medida').add(data);
    res.status(201).json({ id: ref.id, merged: false });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear unidad de medida.' });
  }
});

router.put('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { nombre, descripcion, precio, labor, factorConversion, unidadBase } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });
    await db.collection('unidades_medida').doc(req.params.id).update({
      nombre:           nombre.trim(),
      descripcion:      descripcion      ? String(descripcion).trim()       : '',
      precio:           precio != null && precio !== '' ? parseFloat(precio) || 0 : null,
      labor:            labor            ? String(labor).trim()             : '',
      factorConversion: factorConversion != null && factorConversion !== '' ? parseFloat(factorConversion) || null : null,
      unidadBase:       unidadBase       ? String(unidadBase).trim()        : '',
      actualizadoEn:    Timestamp.now(),
    });
    res.status(200).json({ message: 'Unidad actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar unidad de medida.' });
  }
});

router.delete('/api/unidades-medida/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('unidades_medida', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('unidades_medida').doc(req.params.id).delete();
    res.status(200).json({ message: 'Unidad eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar unidad de medida.' });
  }
});

module.exports = router;
