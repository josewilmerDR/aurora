const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');

const router = Router();

// ── Labores ────────────────────────────────────────────────────────────────
router.get('/api/labores', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('labores')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (parseInt(a.codigo) || 0) - (parseInt(b.codigo) || 0));
    res.json(items);
  } catch (error) {
    console.error('Error al obtener labores:', error);
    res.status(500).json({ message: 'Error al obtener labores.' });
  }
});

router.post('/api/labores', authenticate, async (req, res) => {
  try {
    const allowed = ['codigo', 'descripcion', 'observacion'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    data.fincaId = req.fincaId;
    // Upsert by código if provided
    if (data.codigo) {
      const existing = await db.collection('labores')
        .where('fincaId', '==', req.fincaId)
        .where('codigo', '==', data.codigo)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        const { fincaId, ...updateData } = data;
        await doc.ref.update({ ...updateData, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    data.creadoEn = Timestamp.now();
    const doc = await db.collection('labores').add(data);
    res.status(201).json({ id: doc.id, merged: false });
  } catch (error) {
    console.error('Error al crear labor:', error);
    res.status(500).json({ message: 'Error al crear labor.' });
  }
});

router.put('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const allowed = ['codigo', 'descripcion', 'observacion'];
    const data = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    await db.collection('labores').doc(req.params.id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.json({ message: 'Labor actualizada.' });
  } catch (error) {
    console.error('Error al actualizar labor:', error);
    res.status(500).json({ message: 'Error al actualizar labor.' });
  }
});

router.delete('/api/labores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('labores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('labores').doc(req.params.id).delete();
    res.json({ message: 'Labor eliminada.' });
  } catch (error) {
    console.error('Error al eliminar labor:', error);
    res.status(500).json({ message: 'Error al eliminar labor.' });
  }
});

module.exports = router;
