// Rutas de estrategia — Fase 4.2 (recomendaciones de rotación).
//
// Contiene tres superficies:
//
//   1. Constraints agronómicos (CRUD) — catálogo editable por cultivo.
//   2. Recomendador de rotación — endpoint que arma contexto, llama a Claude
//      (con thinking blocks), corre guardrails y persiste una
//      rotation_recommendation.
//   3. Ciclo de decisión — endpoints para aceptar/rechazar/ejecutar una
//      recomendación según el nivel autorizado (N2 aprueba → ejecuta siembras;
//      N3 recomienda + ejecuta en un solo paso).
//
// Permisos:
//   - Constraints CRUD: supervisor+
//   - Recommend: supervisor+
//   - Accept/reject: supervisor+
//
// La acción ejecutable es `crear_siembra`, que escribe en `siembras` con
// `createdByAutopilot=true`. Su compensación (`marcar_siembra_cancelada`)
// queda registrada junto con la acción.

const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE, writeFeedEvent } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const {
  validateConstraintPayload,
  normalizeConstraintPayload,
} = require('../lib/strategy/rotationConstraintsValidator');
const { validateRotationProposal } = require('../lib/strategy/rotationGuardrails');
const { recommendRotation } = require('../lib/strategy/rotationRecommender');
const { stripReasoning } = require('../lib/autopilotReasoning');
const { executeAutopilotAction } = require('../lib/autopilotActions');
const { isPaused: isAutopilotPaused } = require('../lib/autopilotKillSwitch');
const { computeYieldAggregate } = require('../lib/strategy/yieldAggregator');

const router = Router();

const ALLOWED_LEVELS = ['nivel1', 'nivel2', 'nivel3'];
const MAX_HORIZONTE = 6;                      // tope duro
const MAX_MONTHLY_ROTATION_EXECUTIONS = 10;   // cap N3 por finca

// ─── Helpers comunes ──────────────────────────────────────────────────────

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(
      res,
      ERROR_CODES.INSUFFICIENT_ROLE,
      'Strategy routes require supervisor role or higher.',
      403,
    );
    return false;
  }
  return true;
}

function isValidIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function startOfMonthUtcMillis(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

async function countMonthlyRotationExecutions(fincaId) {
  const since = Timestamp.fromMillis(startOfMonthUtcMillis());
  // Usamos una query normal (no .count()) para no depender de la extensión.
  // Si el volumen crece, se puede mover a aggregation query.
  const snap = await db.collection('autopilot_actions')
    .where('fincaId', '==', fincaId)
    .where('type', '==', 'crear_siembra')
    .where('status', '==', 'executed')
    .where('createdAt', '>=', since)
    .get();
  return snap.size;
}

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

// ══════════════════════════════════════════════════════════════════════════
// CONSTRAINTS CRUD
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/strategy/rotation-constraints', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('rotation_constraints')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.cultivo || '').localeCompare(b.cultivo || ''));
    res.status(200).json(items);
  } catch (error) {
    console.error('[strategy] list constraints failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch rotation constraints.', 500);
  }
});

router.post('/api/strategy/rotation-constraints', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const allowed = ['cultivo', 'familiaBotanica', 'descansoMinCiclos', 'descansoMinDias', 'incompatibleCon', 'notas'];
    const raw = pick(req.body, allowed);
    const validationError = validateConstraintPayload(raw);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const payload = normalizeConstraintPayload(raw);
    // Unicidad lógica: no permitimos dos constraints activos con el mismo
    // `cultivo` (case-insensitive) en la misma finca.
    const existingSnap = await db.collection('rotation_constraints')
      .where('fincaId', '==', req.fincaId)
      .get();
    const conflict = existingSnap.docs
      .map(d => d.data())
      .find(c => (c.cultivo || '').toLowerCase() === payload.cultivo.toLowerCase());
    if (conflict) {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `A constraint for cultivo "${payload.cultivo}" already exists.`,
        409,
      );
    }
    const toStore = {
      ...payload,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || null,
      createdAt: Timestamp.now(),
    };
    const ref = await db.collection('rotation_constraints').add(toStore);
    res.status(201).json({ id: ref.id, ...toStore });
  } catch (error) {
    console.error('[strategy] create constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create constraint.', 500);
  }
});

router.put('/api/strategy/rotation-constraints/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_constraints', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const allowed = ['cultivo', 'familiaBotanica', 'descansoMinCiclos', 'descansoMinDias', 'incompatibleCon', 'notas'];
    const raw = pick(req.body, allowed);
    const validationError = validateConstraintPayload(raw, { partial: true });
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const payload = normalizeConstraintPayload(raw);
    const toUpdate = {
      ...payload,
      updatedBy: req.uid,
      updatedAt: Timestamp.now(),
    };
    await db.collection('rotation_constraints').doc(id).update(toUpdate);
    res.status(200).json({ id, ...toUpdate });
  } catch (error) {
    console.error('[strategy] update constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update constraint.', 500);
  }
});

router.delete('/api/strategy/rotation-constraints/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_constraints', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    await db.collection('rotation_constraints').doc(id).delete();
    res.status(200).json({ id, deleted: true });
  } catch (error) {
    console.error('[strategy] delete constraint failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete constraint.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// RECOMENDADOR
// ══════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════
// CICLO DE DECISIÓN
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/strategy/rotation-recommendations', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('rotation_recommendations')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      })
      .map(item => stripReasoningForRole(item, req.userRole));
    res.status(200).json(items);
  } catch (error) {
    console.error('[strategy] list recommendations failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recommendations.', 500);
  }
});

router.get('/api/strategy/rotation-recommendations/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const data = ownership.doc.data();
    res.status(200).json({ id, ...stripReasoningForRole(data, req.userRole) });
  } catch (error) {
    console.error('[strategy] get recommendation failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recommendation.', 500);
  }
});

router.post('/api/strategy/rotation-recommendations/:id/accept', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (await isAutopilotPaused(req.fincaId)) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'Autopilot is paused.', 423);
    }
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const recDoc = ownership.doc.data();
    if (recDoc.status !== 'issued') {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Recommendation is in status "${recDoc.status}" and cannot be accepted.`,
        409,
      );
    }
    if (!recDoc.guardrailsCheck?.allowed) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'Recommendation has blocking guardrail violations; it cannot be executed.',
        400,
      );
    }

    const executed = await executePropuestasAsSiembras({
      recommendationId: id,
      recDoc,
      fincaId: req.fincaId,
      actor: { uid: req.uid, email: req.userEmail },
      level: recDoc.level || 'nivel2',
    });
    const recRef = db.collection('rotation_recommendations').doc(id);
    await recRef.update({
      status: executed.allOk ? 'executed' : 'failed',
      executedSiembrasIds: executed.siembrasIds,
      executedActionsIds: executed.actionsIds,
      executionErrors: executed.errors,
      executedAt: Timestamp.now(),
      reviewedBy: req.uid,
      reviewedByEmail: req.userEmail || null,
      reviewedAt: Timestamp.now(),
    });
    const updated = (await recRef.get()).data();
    res.status(200).json({ id, ...stripReasoningForRole(updated, req.userRole) });
  } catch (error) {
    console.error('[strategy] accept failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to accept recommendation.', 500);
  }
});

router.post('/api/strategy/rotation-recommendations/:id/reject', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('rotation_recommendations', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const rec = ownership.doc.data();
    if (rec.status !== 'issued') {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Recommendation is in status "${rec.status}" and cannot be rejected.`,
        409,
      );
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 512) : '';
    await db.collection('rotation_recommendations').doc(id).update({
      status: 'rejected',
      rejectionReason: reason || null,
      reviewedBy: req.uid,
      reviewedByEmail: req.userEmail || null,
      reviewedAt: Timestamp.now(),
    });
    res.status(200).json({ id, status: 'rejected', rejectionReason: reason });
  } catch (error) {
    console.error('[strategy] reject failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to reject recommendation.', 500);
  }
});

// ─── Ejecución compartida ─────────────────────────────────────────────────

// Crea una siembra por propuesta usando executeAutopilotAction. Cada ejecución
// se registra en autopilot_actions con su compensación. Las fallas por
// propuesta no abortan el ciclo: recopilamos errores y el caller decide el
// estado final del recommendation doc.
async function executePropuestasAsSiembras({ recommendationId, recDoc, fincaId, actor, level }) {
  const siembrasIds = [];
  const actionsIds = [];
  const errors = [];
  for (const propuesta of recDoc.propuestas || []) {
    if (!propuesta.paqueteId || !propuesta.fechaSiembra) {
      errors.push({
        orden: propuesta.orden,
        message: 'Propuesta sin paqueteId o fechaSiembra — omitida.',
      });
      continue;
    }
    const actionDocRef = db.collection('autopilot_actions').doc();
    actionsIds.push(actionDocRef.id);
    const initialDoc = {
      fincaId,
      sessionId: null,
      type: 'crear_siembra',
      params: {
        loteId: recDoc.loteId,
        paqueteId: propuesta.paqueteId,
        fecha: propuesta.fechaSiembra,
        razon: propuesta.razon || '',
      },
      titulo: `Siembra programada — ${propuesta.nombrePaquete || propuesta.paqueteId}`,
      descripcion: propuesta.razon || '',
      prioridad: 'media',
      categoria: 'rotacion',
      proposedBy: actor.uid || null,
      proposedByName: actor.email || null,
      reviewedBy: actor.uid || null,
      reviewedByName: actor.email || null,
      reviewedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      rotationRecommendationId: recommendationId,
      rotationOrden: propuesta.orden,
      reasoning: recDoc.reasoning || null,
    };
    try {
      const result = await executeAutopilotAction(
        'crear_siembra',
        initialDoc.params,
        fincaId,
        { level, actionDocRef, actionInitialDoc: initialDoc },
      );
      siembrasIds.push(result.siembraId);
    } catch (err) {
      errors.push({
        orden: propuesta.orden,
        actionId: actionDocRef.id,
        message: err.message || String(err),
      });
    }
  }
  return {
    allOk: errors.length === 0 && siembrasIds.length > 0,
    siembrasIds,
    actionsIds,
    errors,
  };
}

// Oculta `reasoning` para roles debajo de supervisor, igual que autopilot.
function stripReasoningForRole(data, userRole) {
  if (hasMinRoleBE(userRole, 'supervisor')) return data;
  return stripReasoning(data);
}

module.exports = router;
