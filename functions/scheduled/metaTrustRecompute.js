// Meta trust recompute cron — Fase 6.3.
//
// Runs monthly on day 2 at 04:00 UTC (day after `hrMonthlyScoring` which
// runs on day 1). Enumerates fincas with at least one KPI observation,
// recomputes trust, and emits guardrail proposals per each finca's meta
// level (N1 → proposed; N2 → tightening auto-applies; N3 → both apply).
//
// Idempotency: a re-run on the same day just produces another session of
// proposals. The executor never double-applies a proposal (each proposal
// is its own `autopilot_actions` doc, and approval applies it once and
// sets `status=executed`).

const { functions } = require('../lib/firebase');
const {
  recomputeAndPropose,
  listFincasWithObservations,
} = require('../lib/meta/trust/trustManager');

module.exports = functions.scheduler.onSchedule(
  { schedule: '0 4 2 * *', timeZone: 'UTC' },
  async () => {
    const started = Date.now();
    console.log('[META_TRUST] Monthly recompute starting.');

    const fincaIds = await listFincasWithObservations();
    if (fincaIds.length === 0) {
      console.log('[META_TRUST] No fincas with observations yet. Skipping.');
      return null;
    }

    const actor = { uid: null, email: 'cron:metaTrustRecompute' };
    const results = await Promise.allSettled(
      fincaIds.map(id => recomputeAndPropose(id, { now: new Date(), actor })),
    );

    let ok = 0;
    let proposalTotal = 0;
    let executedTotal = 0;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[META_TRUST] finca=${fincaIds[i]} failed:`, r.reason?.message || r.reason);
      } else if (r.value?.ran === false) {
        console.log(`[META_TRUST] finca=${fincaIds[i]} skipped: ${r.value.reason}`);
      } else {
        ok += 1;
        const props = r.value?.proposals || [];
        proposalTotal += props.length;
        executedTotal += props.filter(p => p.status === 'executed').length;
        console.log(`[META_TRUST] finca=${fincaIds[i]} proposals=${props.length} executed=${props.filter(p => p.status === 'executed').length} level=${r.value?.effectiveLevel}`);
      }
    });

    console.log(
      `[META_TRUST] Done. fincas=${fincaIds.length} ok=${ok} ` +
      `proposals=${proposalTotal} executed=${executedTotal} ` +
      `durationMs=${Date.now() - started}`
    );
    return null;
  }
);
