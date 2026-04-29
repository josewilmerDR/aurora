// HR — Performance scoring, productividad, proyección de carga y auditoría
// de recomendaciones del autopilot.
//
// Sub-archivo del split de routes/hr.js. Agrupa todas las features añadidas
// en la Sub-fase 3 (Aurora HR autonomy):
//   - performance        → score mensual por trabajador (subscores + ranking)
//   - productivity       → matriz user × labor × lote × unidad (último período)
//   - workload-projection → demanda de mano de obra estimada N semanas adelante
//   - recommendations-audit / accuracy → trazabilidad de las acciones que el
//     autopilot HR sugirió y cómo el humano resolvió cada una

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  computeFincaScores,
  listScores,
  getScore,
} = require('../../lib/hr/performanceAggregator');
const { productivityMatrix } = require('../../lib/hr/productivityByLabor');
const { computeLaborBenchmarks } = require('../../lib/hr/laborBenchmarks');
const { projectWorkload, MAX_HORIZON_WEEKS } = require('../../lib/hr/workloadProjector');
const { currentCapacity } = require('../../lib/hr/capacityCalculator');
const {
  computeAccuracy,
  cutoffForWindow,
  VALID_RESOLUTIONS,
} = require('../../lib/hr/accuracyCalculator');
const { DATE_RE } = require('./helpers');

const router = Router();

const PERIOD_RE = /^\d{4}-\d{2}$/;

// ─── Performance scoring ─────────────────────────────────────────────────

// Quita ranking y detalles cross-worker de un score doc antes de mandarlo a
// un trabajador mirando su propio registro. Mantiene los subscores visibles
// pero corta el contexto que dejaría inferir el desempeño de los compañeros.
function redactForSelfView(doc) {
  if (!doc) return doc;
  const { details, weights, ...rest } = doc;
  return { ...rest, details, weights };
}

router.get('/api/hr/performance', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const period = String(req.query.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const rows = await listScores(req.fincaId, period);
    res.status(200).json(rows);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch performance scores.', 500);
  }
});

router.get('/api/hr/performance/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const period = String(req.query.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const isSelf = req.dbUserId === userId;
    const isSupervisor = hasMinRoleBE(req.userRole, 'supervisor');
    if (!isSelf && !isSupervisor) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    const doc = await getScore(req.fincaId, userId, period);
    if (!doc) return res.status(200).json(null);
    res.status(200).json(isSupervisor ? doc : redactForSelfView(doc));
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch performance score.', 500);
  }
});

router.post('/api/hr/performance/recompute', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const period = String(req.query.period || req.body?.period || '');
    if (!PERIOD_RE.test(period)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'period must be YYYY-MM.', 400);
    }
    const results = await computeFincaScores(req.fincaId, period, { computedBy: 'manual' });
    res.status(200).json({ period, computed: results.length, results });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to recompute performance scores.', 500);
  }
});

// ─── Productivity matrix ─────────────────────────────────────────────────

// GET /api/hr/productivity?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD
//
// Matriz de productividad (userId × labor × loteId × unidad) + benchmarks
// (p25/p50/p75 por labor+unidad). Supervisor-only. Pares con unidades
// distintas NUNCA se comparan — cada (labor, unidad) es bucket independiente.
router.get('/api/hr/productivity', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const periodStart = String(req.query.periodStart || '');
    const periodEnd = String(req.query.periodEnd || '');
    if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'periodStart and periodEnd must be YYYY-MM-DD.', 400);
    }
    const start = new Date(`${periodStart}T00:00:00Z`);
    const end = new Date(`${periodEnd}T23:59:59.999Z`);
    if (!(start < end)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'periodStart must be before periodEnd.', 400);
    }
    const snap = await db.collection('hr_planilla_unidad')
      .where('fincaId', '==', req.fincaId)
      .where('fecha', '>=', Timestamp.fromDate(start))
      .where('fecha', '<=', Timestamp.fromDate(end))
      .get();
    const planillas = snap.docs.map(d => d.data());
    const matrix = productivityMatrix(planillas);
    const benchmarks = computeLaborBenchmarks(matrix);
    res.status(200).json({ periodStart, periodEnd, matrix, benchmarks });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute productivity matrix.', 500);
  }
});

// ─── Workload projection ─────────────────────────────────────────────────

// GET /api/hr/workload-projection?horizonWeeks=12
//
// Proyecta demanda de mano de obra en las próximas N semanas usando el
// paquete vinculado a cada siembra activa. Devuelve count de actividades
// (hard) y horas-persona estimadas (soft, vía un default por actividad)
// lado a lado. También retorna la capacidad baseline de trabajadores
// permanentes.
//
// Limitación conocida: packages.activities[] no tiene campo de horas por
// actividad. estimatedPersonHours usa el default en
// `assumptions.defaultActivityHours` — el UI debería marcarlo para que el
// usuario sepa que la métrica es estimación.
router.get('/api/hr/workload-projection', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const rawHorizon = req.query.horizonWeeks;
    let horizonWeeks = 12;
    if (rawHorizon !== undefined) {
      const n = Number(rawHorizon);
      if (!Number.isFinite(n)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'horizonWeeks must be a number.', 400);
      }
      horizonWeeks = n;
    }

    const [siembrasSnap, packagesSnap, fichasSnap] = await Promise.all([
      db.collection('siembras').where('fincaId', '==', req.fincaId).get(),
      db.collection('packages').where('fincaId', '==', req.fincaId).get(),
      db.collection('hr_fichas').where('fincaId', '==', req.fincaId).get(),
    ]);
    const siembras = siembrasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const packages = packagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const fichas = fichasSnap.docs.map(d => ({ userId: d.id, ...d.data() }));

    const capacity = currentCapacity(fichas);
    const projection = projectWorkload({
      siembras,
      packages,
      horizonWeeks,
      now: new Date(),
      opts: { avgWeeklyHoursPerWorker: capacity.avgWeeklyHoursPermanent },
    });

    res.status(200).json({
      horizonWeeks: projection.horizonWeeks,
      maxHorizonWeeks: MAX_HORIZON_WEEKS,
      now: projection.now,
      assumptions: projection.assumptions,
      capacity,
      weeks: projection.weeks,
      summary: projection.summary,
      diagnostics: projection.diagnostics,
    });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute workload projection.', 500);
  }
});

// ─── Recommendations audit (Sub-fase 3.7) ───────────────────────────────
//
// `hr_recommendations_audit` guarda, por cada doc de autopilot_actions del
// dominio HR, qué decidió el humano (approved / rejected / ignored) y el
// veredicto retrospectivo (outcomeMatchedReality: bool | null). Alimenta el
// endpoint de accuracy, sustrato del exit criterion de fase 3 (90% de
// agreement con humanos en 6 meses).

function validateAuditPayload(body) {
  const errs = [];
  const clean = {};
  if (body?.humanResolution !== undefined) {
    if (!VALID_RESOLUTIONS.has(body.humanResolution)) {
      errs.push(`humanResolution must be one of: ${Array.from(VALID_RESOLUTIONS).join(', ')}.`);
    } else {
      clean.humanResolution = body.humanResolution;
    }
  }
  if (body?.outcomeMatchedReality !== undefined && body.outcomeMatchedReality !== null) {
    if (typeof body.outcomeMatchedReality !== 'boolean') {
      errs.push('outcomeMatchedReality must be a boolean or null.');
    } else {
      clean.outcomeMatchedReality = body.outcomeMatchedReality;
    }
  } else if (body?.outcomeMatchedReality === null) {
    clean.outcomeMatchedReality = null;
  }
  if (body?.outcomeNotes !== undefined) {
    if (typeof body.outcomeNotes !== 'string' || body.outcomeNotes.length > 1000) {
      errs.push('outcomeNotes must be a string up to 1000 chars.');
    } else {
      clean.outcomeNotes = body.outcomeNotes.trim();
    }
  }
  return { errs, clean };
}

// POST /api/hr/recommendations-audit/:actionId (supervisor+)
// Upsertea el doc de auditoría keyed por actionId. Permite que admins
// vuelvan al mismo registro a agregar outcomeMatchedReality después sin
// perder la resolución inicial.
router.post('/api/hr/recommendations-audit/:actionId', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const { actionId } = req.params;
    const { errs, clean } = validateAuditPayload(req.body || {});
    if (errs.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, errs.join(' '), 400);

    // Verificar que la acción existe y pertenece a esta finca, y capturar
    // el tipo para que el doc de auditoría sea autocontenido en reportes.
    const actionDoc = await db.collection('autopilot_actions').doc(actionId).get();
    if (!actionDoc.exists || actionDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Unauthorized access.', 403);
    }
    if (actionDoc.data().categoria !== 'hr') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Audit is only valid for HR actions.', 400);
    }

    const now = Timestamp.now();
    const ref = db.collection('hr_recommendations_audit').doc(actionId);
    const existing = await ref.get();
    const payload = {
      fincaId: req.fincaId,
      autopilotActionId: actionId,
      type: actionDoc.data().type,
      ...clean,
      resolvedAt: now,
      resolvedBy: req.dbUserId || null,
      resolvedByEmail: req.userEmail || null,
    };
    if (!existing.exists) payload.createdAt = now;
    await ref.set(payload, { merge: true });
    res.status(200).json({ id: actionId, ...payload });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save audit.', 500);
  }
});

// GET /api/hr/recommendations-accuracy?months=6 (supervisor+)
// Calcula hitRate global + por tipo en los últimos N meses.
router.get('/api/hr/recommendations-accuracy', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
    }
    const raw = req.query.months;
    let months = 6;
    if (raw !== undefined) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 36) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'months must be a number in [1, 36].', 400);
      }
      months = Math.floor(n);
    }
    const cutoff = cutoffForWindow(months);
    const snap = await db.collection('hr_recommendations_audit')
      .where('fincaId', '==', req.fincaId)
      .where('resolvedAt', '>=', Timestamp.fromDate(cutoff))
      .get();
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const accuracy = computeAccuracy(rows, { windowMonths: months });
    res.status(200).json({ months, cutoff: cutoff.toISOString(), ...accuracy });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute accuracy.', 500);
  }
});

module.exports = router;
