// Meta KPI sweep cron — Fase 6.2.
//
// Runs daily at 04:00 UTC. Evaluates every autopilot_action and every
// orchestrator_run whose window (30 / 90 / 365 d) has elapsed since the
// previous sweep and hasn't been observed yet. Each observation is
// persisted to `meta_kpi_observations` with a deterministic doc ID so
// re-running the sweep is safe.

const { functions } = require('../lib/firebase');
const { sweepAll } = require('../lib/meta/kpi/kpiSweep');

module.exports = functions.scheduler.onSchedule(
  { schedule: '0 4 * * *', timeZone: 'UTC' },
  async () => {
    const started = Date.now();
    console.log('[META_KPI] Sweep starting.');
    try {
      const result = await sweepAll({ now: new Date() });
      const totals = result.summaries.reduce((acc, s) => {
        acc.actionsWritten += s.actions.written || 0;
        acc.runsWritten += s.runs.written || 0;
        acc.errors += s.errors.length;
        return acc;
      }, { actionsWritten: 0, runsWritten: 0, errors: 0 });
      console.log(
        `[META_KPI] Sweep done. fincas=${result.fincaCount} ` +
        `actionsWritten=${totals.actionsWritten} runsWritten=${totals.runsWritten} ` +
        `errors=${totals.errors} durationMs=${Date.now() - started}`
      );
    } catch (err) {
      console.error('[META_KPI] Sweep failed:', err?.message || err);
    }
    return null;
  }
);
