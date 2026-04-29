// Strategy — recomendador de rotación.
//
// Sub-archivo del split de routes/strategy.js. Único endpoint:
// POST /api/strategy/rotation/recommend. Reúne contexto (lote, paquetes,
// constraints, historial, yield, temporadas), llama al recomendador
// (Claude + thinking blocks), corre guardrails, persiste el doc y, si
// el modo es N3 con guardrails OK, ejecuta las propuestas como siembras
// de inmediato.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeFeedEvent } = require('../../lib/helpers');
const { validateRotationProposal } = require('../../lib/strategy/rotationGuardrails');
const { recommendRotation } = require('../../lib/strategy/rotationRecommender');
const { isPaused: isAutopilotPaused } = require('../../lib/autopilotKillSwitch');
const { computeYieldAggregate } = require('../../lib/strategy/yieldAggregator');
const {
  ALLOWED_LEVELS,
  MAX_HORIZONTE,
  MAX_MONTHLY_ROTATION_EXECUTIONS,
  requireSupervisor,
  countMonthlyRotationExecutions,
  executePropuestasAsSiembras,
  stripReasoningForRole,
} = require('./helpers');

const router = Router();

// Deriva la cadena histórica del lote (siembras + cierres) en el formato que
// espera rotationGuardrails. Orden: más antiguo primero.
async function loadLoteHistoryForRotation(fincaId, loteId, packagesById) {
  const snap = await db.collection('siembras')
    .where('fincaId', '==', fincaId)
    .where('loteId', '==', loteId)
    .get();
  const items = snap.docs.map(d => {
    const data = d.data();
    const fechaTs = data.fecha?.toDate?.();
    const cierreTs = data.fechaCierre?.toDate?.();
    const paquete = data.paqueteId ? packagesById[data.paqueteId] : null;
    return {
      id: d.id,
      paqueteId: data.paqueteId || null,
      paqueteNombre: paquete?.nombrePaquete || data.paqueteNombre || null,
      cultivo: paquete?.tipoCosecha || null,
      familiaBotanica: paquete?.familiaBotanica || null,
      fecha: fechaTs ? fechaTs.toISOString().slice(0, 10) : null,
      cerrado: !!data.cerrado,
      cancelada: !!data.cancelada,
      fechaCierre: cierreTs ? cierreTs.toISOString().slice(0, 10) : null,
    };
  }).filter(s => !s.cancelada);
  // Orden descendente por fecha (más reciente primero); los guardrails lo
  // re-ordenan internamente, pero la ruta también lo usa para devolver al
  // cliente.
  items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return items;
}

async function loadActiveSiembras(historial) {
  // Ya están filtradas (no canceladas). Activas = no cerradas.
  return historial.filter(s => !s.cerrado);
}

// Obtiene yield rows por paquete para el último año, best-effort. Si el
// agregador falla, devolvemos []; el recomendador lo tolera.
async function loadYieldRowsForPrompt(fincaId) {
  try {
    const today = new Date();
    const hasta = today.toISOString().slice(0, 10);
    const desdeDt = new Date(today);
    desdeDt.setFullYear(desdeDt.getFullYear() - 1);
    const desde = desdeDt.toISOString().slice(0, 10);
    const out = await computeYieldAggregate(fincaId, { desde, hasta, groupBy: 'paquete' });
    return out?.rows || [];
  } catch (err) {
    console.error('[strategy] yield rows load failed (best-effort):', err.message);
    return [];
  }
}

async function loadTemporadasForPrompt(fincaId) {
  try {
    const snap = await db.collection('temporadas').where('fincaId', '==', fincaId).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.status !== 'archived');
  } catch (err) {
    console.error('[strategy] temporadas load failed (best-effort):', err.message);
    return [];
  }
}

router.post('/api/strategy/rotation/recommend', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (await isAutopilotPaused(req.fincaId)) {
      return sendApiError(
        res,
        ERROR_CODES.AUTOPILOT_PAUSED,
        'Autopilot is paused for this finca.',
        423,
      );
    }

    const { loteId, horizonteCiclos, level } = req.body || {};
    if (!loteId || typeof loteId !== 'string') {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'loteId is required.', 400);
    }
    const horizonte = Number(horizonteCiclos);
    if (!Number.isInteger(horizonte) || horizonte < 1 || horizonte > MAX_HORIZONTE) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        `horizonteCiclos must be an integer in [1, ${MAX_HORIZONTE}].`,
        400,
      );
    }
    const resolvedLevel = ALLOWED_LEVELS.includes(level) ? level : 'nivel1';

    // Validate lote ownership.
    const loteSnap = await db.collection('lotes').doc(loteId).get();
    if (!loteSnap.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Lote not found.', 404);
    }
    if (loteSnap.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Lote does not belong to this finca.', 403);
    }
    const lote = { id: loteSnap.id, ...loteSnap.data() };

    // Reunir contexto.
    const [packagesSnap, constraintsSnap] = await Promise.all([
      db.collection('packages').where('fincaId', '==', req.fincaId).get(),
      db.collection('rotation_constraints').where('fincaId', '==', req.fincaId).get(),
    ]);
    const paquetes = packagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const packagesById = Object.fromEntries(paquetes.map(p => [p.id, p]));
    const constraints = constraintsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const [historial, yieldRows, temporadas] = await Promise.all([
      loadLoteHistoryForRotation(req.fincaId, loteId, packagesById),
      loadYieldRowsForPrompt(req.fincaId),
      loadTemporadasForPrompt(req.fincaId),
    ]);
    const activeSiembras = await loadActiveSiembras(historial);

    // Llamada al recomendador (Claude + thinking).
    const today = new Date().toISOString().slice(0, 10);
    let recOutput;
    try {
      recOutput = await recommendRotation({
        lote, horizonteCiclos: horizonte, paquetes, constraints,
        historial, yieldRows, temporadas, today,
      });
    } catch (err) {
      console.error('[strategy] recommender failed:', err);
      return sendApiError(
        res,
        ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        `Recommender failed: ${err.message || 'unknown'}`,
        502,
      );
    }

    // Guardrails.
    const constraintsByCultivo = {};
    for (const c of constraints) {
      if (c.cultivo) constraintsByCultivo[String(c.cultivo).toLowerCase()] = c;
    }
    const monthlyCount = await countMonthlyRotationExecutions(req.fincaId);
    const guardrailsCheck = validateRotationProposal({
      propuestas: recOutput.propuestas,
      constraintsByCultivo,
      historial,
      activeSiembras,
      monthlyExecutionsCount: monthlyCount,
      maxMonthlyExecutions: MAX_MONTHLY_ROTATION_EXECUTIONS,
      mode: resolvedLevel === 'nivel3' ? 'nivel3' : 'plan',
    });

    // Persist recommendation.
    const nowTs = Timestamp.now();
    const recRef = db.collection('rotation_recommendations').doc();
    const baseDoc = {
      fincaId: req.fincaId,
      loteId,
      loteNombre: lote.nombreLote || '',
      horizonteCiclos: horizonte,
      level: resolvedLevel,
      status: 'issued',
      propuestas: recOutput.propuestas,
      comentarioGeneral: recOutput.comentarioGeneral,
      guardrailsCheck,
      reasoning: recOutput.reasoning,
      modelVersion: recOutput.modelVersion,
      generatedBy: req.uid,
      generatedByEmail: req.userEmail || null,
      createdAt: nowTs,
      executedSiembrasIds: [],
      executedActionsIds: [],
    };
    await recRef.set(baseDoc);

    // Feed event — el helper maneja sus propios errores.
    writeFeedEvent({
      fincaId: req.fincaId,
      uid: req.uid,
      userEmail: req.userEmail,
      eventType: 'rotation_recommendation_created',
      activityType: 'rotacion',
      title: `Recomendación de rotación para lote "${lote.nombreLote || loteId}" — ${resolvedLevel}`,
      loteNombre: lote.nombreLote || null,
    });

    // Si es N3 y los guardrails lo permiten, ejecutamos las siembras en
    // secuencia. Los fallos por propuesta no abortan las demás — cada una
    // queda con su propia entrada en autopilot_actions.
    if (resolvedLevel === 'nivel3' && guardrailsCheck.allowed) {
      const executed = await executePropuestasAsSiembras({
        recommendationId: recRef.id,
        recDoc: baseDoc,
        fincaId: req.fincaId,
        actor: { uid: req.uid, email: req.userEmail },
        level: resolvedLevel,
      });
      await recRef.update({
        status: executed.allOk ? 'executed' : 'failed',
        executedSiembrasIds: executed.siembrasIds,
        executedActionsIds: executed.actionsIds,
        executedAt: Timestamp.now(),
        executionErrors: executed.errors,
      });
      const updated = (await recRef.get()).data();
      return res.status(201).json({ id: recRef.id, ...stripReasoningForRole(updated, req.userRole) });
    }

    res.status(201).json({ id: recRef.id, ...stripReasoningForRole(baseDoc, req.userRole) });
  } catch (error) {
    console.error('[strategy] recommend failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to generate rotation recommendation.', 500);
  }
});

module.exports = router;
