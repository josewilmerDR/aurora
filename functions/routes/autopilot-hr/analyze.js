// POST /api/autopilot/hr/analyze
//
// Runs the HR agent:
//   1. Reads autopilot_config (kill switch, level)
//   2. Loads siembras + packages + hr_fichas for the finca
//   3. Projects workload and capacity (sub-fase 3.3 libs)
//   4. Runs the hiring recommender (sub-fase 3.4 lib)
//   5. Persists each recommendation as an autopilot_actions doc with
//      status='proposed'. NEVER executes.
//
// Kill switch: `dominios.rrhh.activo=false` short-circuits.

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const { isHrDomainActive, resolveHrLevel } = require('../../lib/hr/hrDomainGuards');
const { projectWorkload } = require('../../lib/hr/workloadProjector');
const { currentCapacity } = require('../../lib/hr/capacityCalculator');
const { recommendHiring } = require('../../lib/hr/hiringRecommender');

const { routeCandidate } = require('./routeCandidate');

const DEFAULT_HORIZON_WEEKS = 12;

function clampHorizon(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_HORIZON_WEEKS;
  if (n < 1) return 1;
  if (n > 26) return 26;
  return Math.floor(n);
}

async function analyze(req, res) {
  try {
    const fincaId = req.fincaId;
    const body = req.body || {};
    const now = new Date();
    const horizonWeeks = clampHorizon(body.horizonWeeks);

    const [configSnap, siembrasSnap, packagesSnap, fichasSnap] = await Promise.all([
      db.collection('autopilot_config').doc(fincaId).get(),
      db.collection('siembras').where('fincaId', '==', fincaId).get(),
      db.collection('packages').where('fincaId', '==', fincaId).get(),
      db.collection('hr_fichas').where('fincaId', '==', fincaId).get(),
    ]);

    const config = configSnap.exists ? configSnap.data() : {};
    const guardrails = config.guardrails || {};

    if (!isHrDomainActive(guardrails)) {
      return res.json({
        ran: false,
        reason: 'Dominio RRHH desactivado (kill switch).',
        recommendations: [],
        results: [],
      });
    }

    const siembras = siembrasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const packages = packagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const fichas = fichasSnap.docs.map(d => ({ userId: d.id, ...d.data() }));

    const capacity = currentCapacity(fichas);
    const projection = projectWorkload({
      siembras, packages, horizonWeeks, now,
      opts: { avgWeeklyHoursPerWorker: capacity.avgWeeklyHoursPermanent },
    });
    const { recommendations, reason, summary } = recommendHiring({
      projection, capacity,
    });

    // level is captured for audit, but routeCandidate caps it internally.
    const level = resolveHrLevel(guardrails, config.mode);

    const sessionRef = db.collection('autopilot_sessions').doc();
    const sessionId = sessionRef.id;

    const results = [];
    for (const rec of recommendations) {
      const candidate = {
        type: 'sugerir_contratacion',
        params: {
          weekStart: rec.weekStart,
          weekEnd: rec.weekEnd,
          workersShort: rec.workersShort,
          recommendedAction: rec.recommendedAction,
          consecutiveWeeks: rec.consecutiveWeeks,
        },
        titulo: `Contratación sugerida: ~${rec.workersShort} persona(s) para ${rec.weekStart}`,
        descripcion: rec.reasoning,
        prioridad: rec.urgency === 'alta' ? 'alta' : (rec.urgency === 'media' ? 'media' : 'baja'),
        hrRecommendation: rec,
      };
      const row = await routeCandidate({
        candidate,
        level,
        fincaId,
        sessionId,
        proposedBy: req.uid || null,
        proposedByName: req.userEmail || 'autopilot',
      });
      results.push(row);
    }

    if (results.length > 0) {
      await sessionRef.set({
        fincaId,
        kind: 'hr_analysis',
        level,
        horizonWeeks,
        startedAt: Timestamp.now(),
        finishedAt: Timestamp.now(),
        actionCount: results.length,
        executedCount: 0, // HR never executes
        proposedCount: results.length,
      });
    }

    res.json({
      ran: true,
      level,
      horizonWeeks,
      capacity,
      projection: {
        weeks: projection.weeks,
        assumptions: projection.assumptions,
        summary: projection.summary,
      },
      recommendationsFound: recommendations.length,
      reason,
      summary,
      results,
      sessionId: results.length > 0 ? sessionId : null,
    });
  } catch (error) {
    console.error('[AUTOPILOT-HR] analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run HR analysis.', 500);
  }
}

module.exports = { analyze };
