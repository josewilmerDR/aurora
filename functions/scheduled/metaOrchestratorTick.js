// Meta orchestrator tick cron — Fase 6.6.
//
// Runs every 6 hours. For each finca with meta data, invokes the orchestrator
// analyze endpoint via the existing synthetic req/res helper (`invokeAnalyzer`).
// Each run honors the finca's configured meta level:
//   - nivel1 / off → plan persists as recommendation; no fan-out.
//   - nivel2 / nivel3 → analyzer fan-out happens inside the analyze handler;
//     the standard defenses (HR N3-forbidden, financing N1-only, per-domain
//     kill switches, global kill switch) still hold at every layer.
//
// The cron NEVER raises its own level — it passes through config. This is
// the key property that lets an admin pause autonomy just by flipping
// `autopilot_config.dominios.meta.nivel` to `nivel1` without editing cron code.

const { functions, db } = require('../lib/firebase');
const { invokeAnalyzer } = require('../routes/autopilot-orchestrator/invokeAnalyzer');
const { analyze } = require('../routes/autopilot-orchestrator/analyze');

// Enumerates fincas that have at least one meta snapshot OR orchestrator run
// OR KPI observation. Broad by design — the analyze handler itself short-
// circuits when the meta domain is paused, so there is no harm in trying.
async function listFincasForTick() {
  const [a, b, c] = await Promise.all([
    db.collection('meta_finca_snapshots').get(),
    db.collection('meta_orchestrator_runs').get(),
    db.collection('meta_kpi_observations').get(),
  ]);
  const ids = new Set();
  for (const d of [...a.docs, ...b.docs, ...c.docs]) {
    const f = d.data().fincaId;
    if (typeof f === 'string' && f) ids.add(f);
  }
  return Array.from(ids);
}

module.exports = functions.scheduler.onSchedule(
  { schedule: '0 */6 * * *', timeZone: 'UTC' },
  async () => {
    const started = Date.now();
    const fincaIds = await listFincasForTick();
    if (fincaIds.length === 0) {
      console.log('[META_ORCH_TICK] No fincas with meta data. Skipping.');
      return null;
    }

    console.log(`[META_ORCH_TICK] Ticking ${fincaIds.length} finca(s).`);
    let ok = 0;
    let blocked = 0;
    let failed = 0;

    // Sequential: the analyze handler can fan out to 3 specialist analyzers,
    // each touching multiple collections. Running fincas in parallel risks
    // overlapping transactions on small deployments. A handful of fincas
    // per tick is well within the 6h interval.
    for (const fincaId of fincaIds) {
      const reqCtx = {
        fincaId,
        uid: null,
        userEmail: 'cron:metaOrchestratorTick',
        // The analyze handler role-gates at supervisor+. The cron acts as an
        // admin-equivalent internal caller — the downstream caps (HR N3,
        // financing N1) are NOT affected by this role.
        userRole: 'administrador',
      };
      try {
        const result = await invokeAnalyzer(analyze, reqCtx, {}, {});
        const sc = result.statusCode;
        const body = result.body || {};
        if (sc >= 200 && sc < 300) {
          ok += 1;
          const levelStr = body.effectiveLevel || body.level || 'n/a';
          console.log(`[META_ORCH_TICK] finca=${fincaId} ok level=${levelStr} steps=${body.summary?.stepCount ?? 0}`);
        } else if (sc === 423) {
          blocked += 1;
          console.log(`[META_ORCH_TICK] finca=${fincaId} blocked (kill switch / domain off)`);
        } else {
          failed += 1;
          console.warn(`[META_ORCH_TICK] finca=${fincaId} non-2xx status=${sc} body=${JSON.stringify(body).slice(0, 200)}`);
        }
      } catch (err) {
        failed += 1;
        console.error(`[META_ORCH_TICK] finca=${fincaId} threw:`, err?.message || err);
      }
    }

    console.log(
      `[META_ORCH_TICK] Done. fincas=${fincaIds.length} ok=${ok} blocked=${blocked} failed=${failed} ` +
      `durationMs=${Date.now() - started}`
    );
    return null;
  }
);

// Exposed for tests
module.exports.listFincasForTick = listFincasForTick;
