const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { hasMinRoleBE } = require('../lib/helpers');
const { rateLimit } = require('../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: WEB PUSH ---

// GET /api/push/vapid-public-key — returns the VAPID public key to the client
router.get('/api/push/vapid-public-key', authenticate, (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — save the user's push subscription
router.post('/api/push/subscribe', authenticate, rateLimit('push_subscribe', 'write'), async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid subscription.', 400);
    }
    // Sobrescribir un doc con otro `uid` es CORRECTO acá, al revés que en el
    // DELETE de abajo: el endpoint push identifica una instalación de
    // navegador, no a una persona. En una tablet de campo compartida, cuando
    // la segunda persona se suscribe el endpoint es el mismo, y la
    // suscripción debe pasar a ser suya — quien está logueado ahora es quien
    // debe recibir las notificaciones de ese dispositivo. Rechazar por dueño
    // distinto rompería los dispositivos compartidos, que son el caso normal.
    // Upsert: use the endpoint as the doc ID (base64-encoded to avoid invalid chars)
    const docId = Buffer.from(subscription.endpoint).toString('base64').slice(0, 500);
    await db.collection('push_subscriptions').doc(docId).set({
      uid: req.uid,
      fincaId: req.fincaId,
      subscription,
      // `origin` se registra AHORA porque el endpoint push no lo codifica:
      // una URL de FCM se ve igual venga del dominio viejo o del nuevo, y
      // después del cutover ya no hay forma de distinguirlos, retroactiva
      // ni de ninguna otra manera. Es la dimensión de /subscriptions/stats.
      origin: (typeof req.get('origin') === 'string' ? req.get('origin').slice(0, 200) : null) || null,
      updatedAt: Timestamp.now(),
      // Nota: set SIN merge a propósito — si la suscripción estaba marcada
      // status:'gone' (endpoint muerto podado por pushDelivery), volver a
      // suscribirse limpia la marca y la revive.
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving push subscription:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save subscription.', 500);
  }
});

// GET /api/push/subscriptions/stats — SOLO lectura: suscripciones de la
// finca desglosadas vivas/gone y por origen. Este número, medido antes y
// después de la mudanza de dominio, es la meta de la campaña de
// re-suscripción (las vivas del origen nuevo deben alcanzar a las que había
// en el viejo). 'gone' existe porque la poda MARCA en vez de borrar
// (lib/pushDelivery.js) — es la evidencia de cuántos usuarios perdieron
// notificaciones.
router.get('/api/push/subscriptions/stats', authenticate, rateLimit('push_stats', 'costly_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Supervisor role or above required.', 403);
    }
    const snap = await db.collection('push_subscriptions')
      .where('fincaId', '==', req.fincaId)
      .get();

    const stats = { total: snap.size, vivas: 0, gone: 0, porOrigen: {} };
    snap.docs.forEach(d => {
      const v = d.data();
      // Mismo criterio que fetchLiveSubs: viva = status !== 'gone' (los docs
      // legacy sin el campo cuentan como vivas).
      const viva = v.status !== 'gone';
      if (viva) stats.vivas += 1; else stats.gone += 1;
      const key = v.origin || 'desconocido';
      if (!stats.porOrigen[key]) stats.porOrigen[key] = { vivas: 0, gone: 0 };
      stats.porOrigen[key][viva ? 'vivas' : 'gone'] += 1;
    });

    res.json(stats);
  } catch (err) {
    console.error('Error building push subscription stats:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to build subscription stats.', 500);
  }
});

// DELETE /api/push/subscribe — remove the user's push subscription
router.delete('/api/push/subscribe', authenticate, rateLimit('push_subscribe', 'write'), async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Endpoint is required.', 400);
    }
    const docId = Buffer.from(endpoint).toString('base64').slice(0, 500);
    // El doc id deriva del endpoint push, no del inquilino: quien conozca el
    // endpoint de otra persona podía borrarle la suscripción y dejarla sin
    // notificaciones, en silencio y desde otra finca. Verificamos dueño antes
    // de borrar. Respondemos ok:true igual cuando el doc no existe o no es
    // suyo — DELETE es idempotente y así no hay señal de enumeración que
    // permita confirmar qué endpoints están registrados.
    const ref = db.collection('push_subscriptions').doc(docId);
    const snap = await ref.get();
    if (snap.exists) {
      const sub = snap.data();
      if (sub.uid === req.uid && sub.fincaId === req.fincaId) {
        await ref.delete();
      } else {
        console.warn('[push] delete rechazado: la suscripción no pertenece al solicitante');
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting push subscription:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete subscription.', 500);
  }
});

module.exports = router;
