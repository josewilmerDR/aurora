// HR monthly scoring cron — runs day 1 of each month at 03:00 UTC.
//
// For every finca that has at least one hr_ficha, computes the previous
// month's performance scores via the aggregator from sub-fase 3.1.
// Idempotent: aggregator uses deterministic doc IDs
// (`{fincaId}_{userId}_{period}`) with merge:true, so reruns overwrite
// the same docs instead of duplicating.

const { functions, db } = require('../lib/firebase');
const { computeFincaScores } = require('../lib/hr/performanceAggregator');

// List every finca that has at least one ficha. We intentionally do NOT
// filter by autopilot_config.mode — even fincas with the agent off
// should have their monthly scores calculated. Scores are a reporting
// artifact; they're not an autonomous side effect.
async function listFincasWithHrData() {
  const snap = await db.collection('hr_fichas').get();
  const ids = new Set();
  for (const doc of snap.docs) {
    const fincaId = doc.data().fincaId;
    if (typeof fincaId === 'string' && fincaId) ids.add(fincaId);
  }
  return Array.from(ids);
}

function previousMonthPeriod(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed, so "previous month" is just m
  // If today is Jan 1, previous month is December of last year.
  const prev = m === 0 ? { y: y - 1, m: 12 } : { y, m };
  return `${prev.y}-${String(prev.m).padStart(2, '0')}`;
}

module.exports = functions.scheduler.onSchedule(
  { schedule: '0 3 1 * *', timeZone: 'UTC' },
  async () => {
    const period = previousMonthPeriod(new Date());
    const fincaIds = await listFincasWithHrData();
    if (!fincaIds.length) {
      console.log(`[HR_MONTHLY] No fincas with HR data. Skipping ${period}.`);
      return null;
    }

    console.log(`[HR_MONTHLY] Computing scores for ${fincaIds.length} finca(s), period=${period}.`);
    const results = await Promise.allSettled(
      fincaIds.map(id => computeFincaScores(id, period, { computedBy: 'autopilot' }))
    );

    let okCount = 0;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[HR_MONTHLY] finca=${fincaIds[i]} failed:`, r.reason?.message || r.reason);
      } else {
        okCount += 1;
        console.log(`[HR_MONTHLY] finca=${fincaIds[i]} scored ${r.value.length} worker(s).`);
      }
    });

    console.log(`[HR_MONTHLY] Done. ${okCount}/${fincaIds.length} fincas OK.`);
    return null;
  }
);

// Exported for tests
module.exports.previousMonthPeriod = previousMonthPeriod;
module.exports.listFincasWithHrData = listFincasWithHrData;
