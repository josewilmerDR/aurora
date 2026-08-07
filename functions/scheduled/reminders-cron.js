const { functions, db, vapidPublicKey, vapidPrivateKey } = require('../lib/firebase');
const { fetchLiveSubs, sendPushToSubs } = require('../lib/pushDelivery');

// --- FUNCIÓN PROGRAMADA: ENVIAR PUSH DE RECORDATORIOS VENCIDOS ---
// Se ejecuta cada 5 minutos y envía notificaciones push a usuarios con
// recordatorios vencidos. La entrega y la higiene de suscripciones viven en
// lib/pushDelivery.js (antes este archivo duplicaba la poda y BORRABA los
// docs; ahora se marcan gone y fetchLiveSubs los excluye — sin ese filtro,
// el cron reintentaría endpoints muertos cada cinco minutos para siempre).
module.exports = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', secrets: [vapidPublicKey, vapidPrivateKey] },
  async () => {
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

    const subs = await fetchLiveSubs(fincaId, uid);
    await sendPushToSubs(subs, {
      title: 'Recordatorio — Aurora',
      body: message,
      url: '/',
    });
  }
  return null;
});
