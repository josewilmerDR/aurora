const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');

const router = Router();

// --- API ENDPOINTS: RECORDATORIOS PERSONALES ---

// GET /api/reminders/due — recordatorios vencidos (remindAt <= ahora), los marca como entregados
router.get('/api/reminders/due', authenticate, async (req, res) => {
  try {
    const now = new Date();
    // Sin filtro de rango en Firestore (requeriría índice compuesto); se filtra en JS
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
      .get();
    const dueDocs = snap.docs.filter(d => {
      const remindAt = d.data().remindAt?.toDate?.();
      return remindAt && remindAt <= now;
    });
    if (!dueDocs.length) return res.json([]);
    const batch = db.batch();
    const reminders = dueDocs.map(d => {
      batch.update(d.ref, { status: 'delivered' });
      return { id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() };
    });
    await batch.commit();
    res.json(reminders);
  } catch (err) {
    console.error('Error al obtener recordatorios vencidos:', err);
    res.status(500).json({ message: 'Error al obtener recordatorios.' });
  }
});

// GET /api/reminders — lista todos los recordatorios pendientes del usuario
router.get('/api/reminders', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('reminders')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .where('status', '==', 'pending')
      .get();
    const reminders = snap.docs
      .map(d => ({ id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() }))
      .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
    res.json(reminders);
  } catch (err) {
    console.error('Error al obtener recordatorios:', err);
    res.status(500).json({ message: 'Error al obtener recordatorios.' });
  }
});

// POST /api/reminders — crea un recordatorio personal
router.post('/api/reminders', authenticate, async (req, res) => {
  try {
    const { message, remindAt } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'El mensaje es requerido.' });
    if (!remindAt) return res.status(400).json({ message: 'La fecha del recordatorio es requerida.' });
    const remindDate = new Date(remindAt);
    if (isNaN(remindDate.getTime())) return res.status(400).json({ message: 'Fecha inválida.' });
    const docRef = await db.collection('reminders').add({
      uid: req.uid,
      fincaId: req.fincaId,
      message: message.trim(),
      remindAt: Timestamp.fromDate(remindDate),
      status: 'pending',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: docRef.id, message: message.trim(), remindAt: remindDate.toISOString() });
  } catch (err) {
    console.error('Error al crear recordatorio:', err);
    res.status(500).json({ message: 'Error al crear el recordatorio.' });
  }
});

// DELETE /api/reminders/:id — elimina un recordatorio
router.delete('/api/reminders/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('reminders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Recordatorio no encontrado.' });
    if (doc.data().uid !== req.uid) return res.status(403).json({ message: 'Acceso no autorizado.' });
    await db.collection('reminders').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar recordatorio:', err);
    res.status(500).json({ message: 'Error al eliminar el recordatorio.' });
  }
});

module.exports = router;
