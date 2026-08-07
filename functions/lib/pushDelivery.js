// Entrega de web push + higiene de suscripciones — módulo ÚNICO.
//
// Antes la poda de suscripciones muertas estaba duplicada literalmente en
// dos archivos (lib/helpers.js y scheduled/reminders-cron.js) y BORRABA la
// evidencia: al eliminar el doc en 410/404 no queda forma de contar cuántos
// usuarios perdieron notificaciones — exactamente el número que se necesita
// alrededor de la mudanza de dominio. Reglas de este módulo:
//
//   - 410/404 → se MARCA `status: 'gone'` (+goneAt, +goneStatusCode). El doc
//     queda como evidencia y alimenta GET /api/push/subscriptions/stats.
//     Una re-suscripción del cliente re-escribe el doc (set sin merge en
//     routes/webpush.js) y lo revive.
//   - Cualquier otro error se loguea con su statusCode — antes el `else`
//     vacío de helpers.js se tragaba todo sin una sola línea.
//   - Los consultantes usan fetchLiveSubs, que filtra EN MEMORIA con
//     `status !== 'gone'`. Ni el filtro positivo (status === 'active') ni un
//     where('status', '!=', 'gone') de Firestore sirven: AMBOS excluyen los
//     docs existentes que no tienen el campo (Firestore omite del resultado
//     de `!=` los docs sin el campo), dejando a todos los usuarios actuales
//     sin notificaciones, en silencio.
//
// Los llamadores que hoy no hacen await deben seguir sin hacerlo: es
// fire-and-forget deliberado para no bloquear la respuesta HTTP.

const webpush = require('web-push');
const { db, Timestamp } = require('./firebase');

const VAPID_SUBJECT = 'mailto:aurora@finca.com';

// Suscripciones vivas de una finca (opcionalmente de un solo uid).
// El filtro de estado es en memoria a propósito — ver cabecera.
async function fetchLiveSubs(fincaId, uid = null) {
  let q = db.collection('push_subscriptions').where('fincaId', '==', fincaId);
  if (uid) q = q.where('uid', '==', uid);
  const snap = await q.get();
  return snap.docs.filter(d => d.data().status !== 'gone');
}

// Envía el payload a cada suscripción. Devuelve cuántas se entregaron.
// No lanza por fallos de entrega individuales: marca/loguea y sigue.
async function sendPushToSubs(subDocs, { title, body, icon, badge, url } = {}) {
  if (!subDocs || subDocs.length === 0) return 0;

  webpush.setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const payload = JSON.stringify({
    title: title || 'Aurora',
    body: body || '',
    icon: icon || '/aurora-logo.png',
    badge: badge || '/aurora-logo.png',
    data: { url: url || '/' },
  });

  let delivered = 0;
  for (const subDoc of subDocs) {
    try {
      await webpush.sendNotification(subDoc.data().subscription, payload);
      delivered += 1;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Marca, no borra — la evidencia es el punto (ver cabecera).
        await subDoc.ref.update({
          status: 'gone',
          goneAt: Timestamp.now(),
          goneStatusCode: err.statusCode,
        }).catch(markErr => {
          console.error('[PUSH] No se pudo marcar la suscripción como gone:', markErr.message);
        });
      } else {
        console.error(`[PUSH] Error de entrega (status ${err.statusCode ?? '?'}):`, err.message);
      }
    }
  }
  return delivered;
}

module.exports = { fetchLiveSubs, sendPushToSubs };
