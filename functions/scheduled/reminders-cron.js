const { functions, db, vapidPublicKey, vapidPrivateKey } = require('../lib/firebase');
const webpush = require('web-push');

// --- FUNCIÓN PROGRAMADA: ENVIAR PUSH DE RECORDATORIOS VENCIDOS ---
// Se ejecuta cada 5 minutos y envía notificaciones push a usuarios con recordatorios vencidos.
module.exports = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', secrets: [vapidPublicKey, vapidPrivateKey] },
  async () => {
  const VAPID_SUBJECT = 'mailto:aurora@finca.com';
  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  const now = new Date();
  const snap = await db.collection('reminders')
    .where('status', '==', 'pending')
    .get();

  const due = snap.docs.filter(d => {
    const remindAt = d.data().remindAt?.toDate?.();
    return remindAt && remindAt <= now;
  });

  if (!due.length) return null;

  for (const doc of due) {
    const { uid, fincaId, message } = doc.data();
    await doc.ref.update({ status: 'delivered' });

    const subSnap = await db.collection('push_subscriptions')
      .where('uid', '==', uid)
      .where('fincaId', '==', fincaId)
      .get();

    const payload = JSON.stringify({
      title: 'Recordatorio — Aurora',
      body: message,
      icon: '/aurora-logo.png',
      badge: '/aurora-logo.png',
      data: { url: '/' },
    });

    for (const subDoc of subSnap.docs) {
      try {
        await webpush.sendNotification(subDoc.data().subscription, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await subDoc.ref.delete();
        } else {
          console.error('Error enviando push:', err.message);
        }
      }
    }
  }
  return null;
});
