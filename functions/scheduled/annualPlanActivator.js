// Cron de activación diferida para planes anuales generados en N3.
//
// Cada hora busca versiones en `status: 'scheduled_activation'` cuya ventana
// `activationScheduledFor` ya venció, y las promueve a `active`
// (supersediendo la versión activa previa en transacción).
//
// Es idempotente: si la versión ya fue cancelada (`status='cancelled'`) o
// activada manualmente en la ventana, el cron simplemente la ignora.

const { functions, db, Timestamp } = require('../lib/firebase');

module.exports = functions.scheduler.onSchedule(
  { schedule: 'every 60 minutes' },
  async () => {
    const now = Timestamp.now();
    const snap = await db.collection('annual_plans')
      .where('status', '==', 'scheduled_activation')
      .where('activationScheduledFor', '<=', now)
      .get();

    if (snap.empty) {
      console.log('[annualPlanActivator] no plans due.');
      return null;
    }

    let promoted = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const plan = doc.data();
      try {
        await db.runTransaction(async (t) => {
          // Re-leemos el doc dentro de la transacción para evitar races con
          // cancelaciones manuales.
          const fresh = await t.get(doc.ref);
          if (!fresh.exists) return;
          const f = fresh.data();
          if (f.status !== 'scheduled_activation') {
            skipped += 1;
            return;
          }
          // Supersede la versión activa previa (si la hay).
          if (f.supersedes) {
            const priorRef = db.collection('annual_plans').doc(f.supersedes);
            const priorSnap = await t.get(priorRef);
            if (priorSnap.exists && priorSnap.data().isActive) {
              t.update(priorRef, {
                status: 'superseded',
                isActive: false,
                supersededBy: doc.id,
                updatedAt: now,
              });
            }
          }
          // También chequeamos que no haya otra active para (finca, year).
          const otherActiveSnap = await db.collection('annual_plans')
            .where('fincaId', '==', f.fincaId)
            .where('year', '==', f.year)
            .where('isActive', '==', true)
            .get();
          for (const other of otherActiveSnap.docs) {
            if (other.id !== doc.id) {
              t.update(other.ref, {
                status: 'superseded',
                isActive: false,
                supersededBy: doc.id,
                updatedAt: now,
              });
            }
          }
          const changelogEntry = {
            version: f.version,
            fecha: now,
            razon: 'Activación automática tras ventana de 24h (N3).',
            diff: null,
            autor: 'autopilot',
            autorUid: null,
            autorEmail: null,
            level: f.level || 'nivel3',
            summary: 'Activada por cron (scheduled_activation).',
          };
          t.update(doc.ref, {
            status: 'active',
            isActive: true,
            activatedAt: now,
            activationScheduledFor: null,
            changelog: [...(f.changelog || []), changelogEntry],
          });
          promoted += 1;
        });
      } catch (err) {
        console.error(`[annualPlanActivator] plan ${doc.id} promotion failed:`, err.message);
      }
    }

    console.log(`[annualPlanActivator] promoted=${promoted} skipped=${skipped}`);
    return null;
  },
);
