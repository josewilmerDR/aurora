const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');

const router = Router();

// --- API ENDPOINTS: WEB PUSH ---

// GET /api/push/vapid-public-key — devuelve la clave pública VAPID al cliente
router.get('/api/push/vapid-public-key', authenticate, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — guarda la suscripción push del usuario
router.post('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ message: 'Suscripción inválida.' });
    // Upsert: usamos el endpoint como ID del doc (en base64 para evitar chars inválidos)
    const docId = Buffer.from(subscription.endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).set({
      uid: req.uid,
      fincaId: req.fincaId,
      subscription,
      updatedAt: Timestamp.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando suscripción push:', err);
    res.status(500).json({ message: 'Error al guardar la suscripción.' });
  }
});

// DELETE /api/push/subscribe — elimina la suscripción push del usuario
router.delete('/api/push/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ message: 'endpoint requerido.' });
    const docId = Buffer.from(endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando suscripción push:', err);
    res.status(500).json({ message: 'Error al eliminar la suscripción.' });
  }
});

module.exports = router;
