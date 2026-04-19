// Rutas de escenarios what-if — Fase 4.4.
//
// Superficies:
//   - POST /api/strategy/scenarios/simulate — genera un nuevo escenario
//   - GET  /api/strategy/scenarios          — listar (más reciente primero)
//   - GET  /api/strategy/scenarios/:id      — detalle
//
// Nivel 1 exclusivo. Simular no es una acción: no crea siembras, no mueve
// dinero, no contrata. Por eso no pasa por autopilot_actions.
//
// Permisos: supervisor+.

const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { simulateScenarios, DEFAULTS: SIM_DEFAULTS } = require('../lib/strategy/scenarioSimulator');
const { loadScenarioContext } = require('../lib/strategy/scenarioContextLoader');
const { reasonOverScenarios } = require('../lib/strategy/scenarioReasoner');
const { stripReasoning } = require('../lib/autopilotReasoning');

const router = Router();

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Scenarios require supervisor+.', 403);
    return false;
  }
  return true;
}

function stripByRole(data, userRole) {
  if (hasMinRoleBE(userRole, 'supervisor')) return data;
  return stripReasoning(data);
}

// ══════════════════════════════════════════════════════════════════════════
// Simulate
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/strategy/scenarios/simulate', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const body = req.body || {};
    const horizonteMeses = Number.isInteger(body.horizonteMeses)
      ? Math.max(1, Math.min(24, body.horizonteMeses))
      : 12;
    const nTrials = Number.isInteger(body.nTrials)
      ? Math.max(10, Math.min(5000, body.nTrials))
      : SIM_DEFAULTS.nTrials;
    const seed = Number.isFinite(Number(body.seed))
      ? Number(body.seed)
      : Math.floor(Date.now() % 2_147_483_647);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
    const restrictions = body.restrictions && typeof body.restrictions === 'object'
      ? body.restrictions : {};
    const skipReasoner = body.skipReasoner === true;

    // 1. Cargar contexto desde Firestore (best-effort).
    const context = await loadScenarioContext(req.fincaId, { horizonteMeses, restrictions });

    // 2. Correr Monte Carlo.
    const simulationOutput = simulateScenarios(context, { nTrials, seed });

    // 3. Razonamiento Claude (opcional — si skipReasoner=true, p. ej. para
    //    smoke tests o corridas rápidas).
    let reasoning = null;
    let claudeAnalysis = null;
    if (!skipReasoner) {
      try {
        const result = await reasonOverScenarios({
          simulationOutput,
          restrictions,
          warnings: context.warnings,
        });
        claudeAnalysis = result.analysis;
        reasoning = result.reasoning;
      } catch (err) {
        console.error('[scenarios] reasoner failed:', err.message);
        // No abortamos — persistimos la simulación sin análisis.
        claudeAnalysis = { error: err.message || 'unknown' };
      }
    }

    // 4. Persistir.
    const nowTs = Timestamp.now();
    const doc = {
      fincaId: req.fincaId,
      name: name || `Simulación ${new Date().toISOString().slice(0, 16)}`,
      horizonteMeses,
      nTrials,
      seed,
      restrictions,
      inputsSnapshot: context.inputsSnapshot || {},
      warnings: context.warnings,
      scenarios: simulationOutput.scenarios,
      resumen: simulationOutput.resumen,
      trialsAggregate: simulationOutput.trialsAggregate,
      context: simulationOutput.context,
      claudeAnalysis,
      reasoning,
      status: 'completed',
      generatedBy: req.uid,
      generatedByEmail: req.userEmail || null,
      createdAt: nowTs,
    };
    const ref = await db.collection('scenarios').add(doc);

    res.status(201).json({ id: ref.id, ...stripByRole(doc, req.userRole) });
  } catch (error) {
    console.error('[scenarios] simulate failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to simulate scenarios.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// List + get
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/strategy/scenarios', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('scenarios')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      })
      .map(item => stripByRole(item, req.userRole));
    res.status(200).json(items);
  } catch (error) {
    console.error('[scenarios] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list scenarios.', 500);
  }
});

router.get('/api/strategy/scenarios/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('scenarios', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id, ...stripByRole(ownership.doc.data(), req.userRole) });
  } catch (error) {
    console.error('[scenarios] get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch scenario.', 500);
  }
});

module.exports = router;
