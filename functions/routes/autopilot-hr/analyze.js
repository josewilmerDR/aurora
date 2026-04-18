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
const { detectAlerts } = require('../../lib/hr/performanceAlertDetector');
const { reasonAboutAlert } = require('../../lib/hr/performanceReasoner');
const { getAnthropicClient } = require('../../lib/clients');

const { routeCandidate } = require('./routeCandidate');

const DEFAULT_HORIZON_WEEKS = 12;
const PERIOD_RE = /^\d{4}-\d{2}$/;
const ALERT_LOOKBACK_MONTHS = 3; // enough for the 'alta' 3-month rule

// Build a period chain newest → oldest for a given currentPeriod YYYY-MM.
function buildPeriodChain(currentPeriod, monthsBack) {
  if (!PERIOD_RE.test(currentPeriod)) return [];
  const year = Number(currentPeriod.slice(0, 4));
  const month = Number(currentPeriod.slice(5, 7));
  const chain = [];
  for (let offset = 0; offset < monthsBack; offset++) {
    const target = new Date(Date.UTC(year, month - 1 - offset, 1));
    const y = target.getUTCFullYear();
    const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
    chain.push(`${y}-${mm}`);
  }
  return chain;
}

// Anthropic client may not be configured in all environments. Wrap so
// a missing secret can't break the whole endpoint — worst case we fall
// back to deterministic text.
function safeGetAnthropic() {
  try {
    return getAnthropicClient();
  } catch (err) {
    console.warn('[AUTOPILOT-HR] Anthropic client unavailable:', err.message);
    return null;
  }
}

async function loadScoresByPeriod(fincaId, periodChain) {
  const snaps = await Promise.all(periodChain.map(p =>
    db.collection('hr_performance_scores')
      .where('fincaId', '==', fincaId)
      .where('period', '==', p)
      .get()
  ));
  const out = {};
  snaps.forEach((snap, i) => {
    out[periodChain[i]] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });
  return out;
}

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

    // ── Alerts branch (sub-fase 3.5) ────────────────────────────────────
    //
    // Runs only when `period=YYYY-MM` is provided. Reads score docs for
    // the current + lookback months, detects sustained under-performance,
    // drafts a supervisor-facing note (Claude opt-in), and persists each
    // alert as a sugerir_revision_desempeno action via routeCandidate.
    let alertResults = [];
    let alertReason = 'not_run';
    const period = typeof body.period === 'string' ? body.period : null;
    if (period && PERIOD_RE.test(period)) {
      const periodChain = buildPeriodChain(period, ALERT_LOOKBACK_MONTHS);
      const scoresByPeriod = await loadScoresByPeriod(fincaId, periodChain);
      const { alerts, reason: detectReason } = detectAlerts({
        currentPeriod: period, periodChain, scoresByPeriod,
      });
      alertReason = detectReason;

      // Claude reasoning opt-in. Default off; enable via body.useClaude=1
      // (same pattern as RFQ winner selection in sub-fase 2.5).
      const reasonerEnabled = body.useClaude === true || body.useClaude === 1 || body.useClaude === '1';
      const anthropicClient = reasonerEnabled ? safeGetAnthropic() : null;

      for (const alert of alerts) {
        const scoreDoc = scoresByPeriod[period]?.find(s => s.userId === alert.userId) || null;
        const reasoned = await reasonAboutAlert(alert, {
          subscoresSnapshot: scoreDoc?.subscores || null,
        }, { enabled: reasonerEnabled && !!anthropicClient, anthropicClient });

        const candidate = {
          type: 'sugerir_revision_desempeno',
          params: {
            userId: alert.userId,
            period,
            severity: alert.severity,
            evidenceRefs: alert.evidenceRefs,
          },
          titulo: `Revisión de desempeño sugerida (severidad: ${alert.severity})`,
          descripcion: reasoned.text,
          prioridad: alert.severity === 'alta' ? 'alta' : 'media',
          hrRecommendation: {
            alert,
            reasoningText: reasoned.text,
            reasoningFallback: reasoned.fallback,
          },
        };

        const row = await routeCandidate({
          candidate,
          level,
          fincaId,
          sessionId, // may be empty string if hiring produced none; harmless
          proposedBy: req.uid || null,
          proposedByName: req.userEmail || 'autopilot',
        });

        // Persist Claude reasoning on the action doc if we captured it.
        // The value lives alongside the existing action fields and is
        // role-gated downstream via stripReasoning() on read paths.
        if (!reasoned.fallback && reasoned.reasoning) {
          await db.collection('autopilot_actions').doc(row.actionId).update({
            reasoning: reasoned.reasoning,
          });
        }
        alertResults.push(row);
      }
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
      alerts: {
        reason: alertReason,
        found: alertResults.length,
        results: alertResults,
      },
      sessionId: results.length > 0 ? sessionId : null,
    });
  } catch (error) {
    console.error('[AUTOPILOT-HR] analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run HR analysis.', 500);
  }
}

module.exports = { analyze };
