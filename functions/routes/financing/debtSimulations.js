// Handlers for `/api/financing/debt-simulations/...` — Fase 5.4.
//
// Runs a two-leg Monte Carlo simulation (with debt vs without) over a 12m
// horizon, optionally refines the verdict with Claude, and persists the
// full output append-only. All actions here are N1 recommendations only —
// 5.5 enforces the hard-coded policy.

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { isPaused } = require('../../lib/autopilotKillSwitch');
const {
  isFinancingDomainActive,
  assertNivelAllowed,
} = require('../../lib/financing/financingDomainGuards');
const { simulateDebtRoi } = require('../../lib/financing/debtScenarioSimulator');
const {
  refineWithClaude,
  heuristicRecommendation,
} = require('../../lib/financing/debtRoiReasoner');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const repo = require('./repository');

const VALID_USECASE_TIPOS = new Set(['compra_insumos', 'siembra', 'infraestructura', 'liquidez']);
const VALID_RETURN_KINDS = new Set(['linear', 'delayed_revenue', 'cost_reduction', 'none']);

// Compute bounds for the Monte Carlo. The cost of a run is O(nTrials ×
// horizonteMeses); without a ceiling a single authenticated request could
// pass nTrials: 1e8 and exhaust CPU / hit the function timeout (DoS). These
// caps are generous for any real analysis (5000 trials over 10 years) while
// bounding worst-case compute.
const MAX_N_TRIALS = 5000;
const MAX_HORIZONTE_MESES = 120;
const DEFAULT_N_TRIALS = 500;
const DEFAULT_HORIZONTE_MESES = 12;

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// Coerce an optional integer body param into [1, max], falling back to
// `fallback` when absent/invalid. Pathological values are clamped, not
// rejected, so exploratory callers still get a (bounded) result.
function clampInt(raw, fallback, max) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

// ─── Kill switch ──────────────────────────────────────────────────────────

async function assertAllowed(fincaId) {
  if (await isPaused(fincaId)) {
    return { blocked: true, reason: 'Autopilot paused for this finca.' };
  }
  const cfg = await repo.getAutopilotConfig(fincaId);
  if (!isFinancingDomainActive(cfg)) {
    return { blocked: true, reason: 'Financing domain disabled.' };
  }
  const configuredLevel = cfg?.dominios?.financing?.nivel;
  if (configuredLevel && configuredLevel !== 'nivel1') {
    const check = assertNivelAllowed(configuredLevel);
    if (check.blocked) return { blocked: true, reason: check.reason };
  }
  return { blocked: false };
}

// ─── Input validation ────────────────────────────────────────────────────

function validateUseCase(raw) {
  if (raw === null || raw === undefined) return { value: null };
  if (typeof raw !== 'object') return { error: 'useCase must be an object.' };
  const tipo = typeof raw.tipo === 'string' ? raw.tipo.trim() : '';
  if (!VALID_USECASE_TIPOS.has(tipo)) {
    return { error: `useCase.tipo must be one of: ${[...VALID_USECASE_TIPOS].join(', ')}.` };
  }
  const detalle = typeof raw.detalle === 'string' ? raw.detalle.trim().slice(0, 300) : '';
  const model = raw.expectedReturnModel && typeof raw.expectedReturnModel === 'object'
    ? raw.expectedReturnModel
    : null;
  let expectedReturnModel = null;
  if (model) {
    const kind = typeof model.kind === 'string' ? model.kind.trim() : 'none';
    if (!VALID_RETURN_KINDS.has(kind)) {
      return { error: `expectedReturnModel.kind must be one of: ${[...VALID_RETURN_KINDS].join(', ')}.` };
    }
    expectedReturnModel = {
      kind,
      monthlyIncrease: Number.isFinite(Number(model.monthlyIncrease)) ? Number(model.monthlyIncrease) : 0,
      monthlyCostReduction: Number.isFinite(Number(model.monthlyCostReduction)) ? Number(model.monthlyCostReduction) : 0,
      startMonth: Number.isInteger(Number(model.startMonth)) ? Number(model.startMonth) : 0,
    };
  }
  return {
    value: {
      tipo,
      detalle: detalle || null,
      expectedReturnModel,
    },
  };
}

// ─── Baseline derivation ─────────────────────────────────────────────────

// Derives the scenarioSimulator baseline context from a saved snapshot.
// Any explicit `body.baselineOverride` wins over the derived values — useful
// for what-if analysis on a hypothetical baseline.
function deriveBaseline(snapshot, override = {}) {
  const is = snapshot?.incomeStatement || {};
  const bs = snapshot?.balanceSheet || {};

  const periodCost = Number(is.costs?.totalCosts) || 0;
  const periodRevenue = Number(is.revenue?.amount) || 0;

  const base = {
    baselineMonthlyRevenue: round2(periodRevenue / 12),
    baselineMonthlyCost: round2(periodCost / 12),
    initialCash: Number(bs.assets?.cash?.amount) || 0,
    commitmentsByMonth: [],
    priceVolatility: 0.15,
    yieldVolatility: 0.10,
    costDriftMonthly: 0.005,
  };

  return {
    ...base,
    ...('baselineMonthlyRevenue' in override ? { baselineMonthlyRevenue: Number(override.baselineMonthlyRevenue) || 0 } : {}),
    ...('baselineMonthlyCost' in override ? { baselineMonthlyCost: Number(override.baselineMonthlyCost) || 0 } : {}),
    ...('initialCash' in override ? { initialCash: Number(override.initialCash) || 0 } : {}),
    ...('priceVolatility' in override ? { priceVolatility: Number(override.priceVolatility) || 0.15 } : {}),
    ...('yieldVolatility' in override ? { yieldVolatility: Number(override.yieldVolatility) || 0.10 } : {}),
    ...('costDriftMonthly' in override ? { costDriftMonthly: Number(override.costDriftMonthly) || 0.005 } : {}),
    // Cap antes de mapear: un array gigante (p.ej. 1e8 entradas) forzaría una
    // asignación masiva en memoria aun cuando el motor luego lo recorte a H.
    // MAX_HORIZONTE_MESES es el máximo útil — más allá del horizonte se ignora.
    ...(Array.isArray(override.commitmentsByMonth)
      ? { commitmentsByMonth: override.commitmentsByMonth.slice(0, MAX_HORIZONTE_MESES).map(v => Number(v) || 0) }
      : {}),
  };
}

// ─── Simulate ─────────────────────────────────────────────────────────────

async function simulateDebtRoiHandler(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const block = await assertAllowed(req.fincaId);
    if (block.blocked) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, block.reason, 423);
    }

    const body = req.body || {};
    const creditProductId = typeof body.creditProductId === 'string' ? body.creditProductId.trim() : '';
    const snapshotId = typeof body.snapshotId === 'string' ? body.snapshotId.trim() : '';
    const amount = Number(body.amount);
    const plazoMeses = Number(body.plazoMeses);

    if (!creditProductId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'creditProductId is required.', 400);
    }
    if (!snapshotId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'snapshotId is required.', 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'amount must be > 0.', 400);
    }
    if (!Number.isInteger(plazoMeses) || plazoMeses < 1) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'plazoMeses must be positive integer.', 400);
    }

    // Load credit product — must belong to caller's finca.
    const prodOwn = await verifyOwnership('credit_products', creditProductId, req.fincaId);
    if (!prodOwn.ok) return sendApiError(res, prodOwn.code, prodOwn.message, prodOwn.status);
    const product = prodOwn.doc.data();

    // Range checks vs product envelope.
    if (amount < product.monedaMin || amount > product.monedaMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `amount must be within [${product.monedaMin}, ${product.monedaMax}] for this product.`, 400);
    }
    if (plazoMeses < product.plazoMesesMin || plazoMeses > product.plazoMesesMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `plazoMeses must be within [${product.plazoMesesMin}, ${product.plazoMesesMax}] for this product.`, 400);
    }

    const apr = body.apr === undefined || body.apr === null || body.apr === ''
      ? Number(product.aprMax)
      : Number(body.apr);
    if (!Number.isFinite(apr) || apr < product.aprMin || apr > product.aprMax) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT,
        `apr must be within [${product.aprMin}, ${product.aprMax}] for this product.`, 400);
    }

    // Load snapshot.
    const snapOwn = await verifyOwnership('financial_profile_snapshots', snapshotId, req.fincaId);
    if (!snapOwn.ok) return sendApiError(res, snapOwn.code, snapOwn.message, snapOwn.status);
    const snapshot = snapOwn.doc.data();

    // Validate useCase.
    const uc = validateUseCase(body.useCase);
    if (uc.error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, uc.error, 400);

    // Simulation parameters with defaults, clamped to bound worst-case compute.
    const nTrials = clampInt(body.nTrials, DEFAULT_N_TRIALS, MAX_N_TRIALS);
    const seed = Number.isInteger(Number(body.seed)) ? Number(body.seed) : 1;
    const horizonteMeses = clampInt(body.horizonteMeses, DEFAULT_HORIZONTE_MESES, MAX_HORIZONTE_MESES);

    const baseline = deriveBaseline(snapshot, body.baselineOverride || {});
    const simulation = simulateDebtRoi({
      baseline,
      debt: { amount, plazoMeses, apr, esquemaAmortizacion: product.esquemaAmortizacion },
      useCase: uc.value,
      horizonteMeses,
      nTrials,
      seed,
    });
    if (simulation.error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, simulation.error, 400);
    }

    // Claude refinement (opt-in) with deterministic fallback.
    const useClaude = String(req.query.useClaude || '').toLowerCase() === '1';
    let recommendation = null;
    if (useClaude) {
      recommendation = await refineWithClaude({
        simulation,
        debt: { amount, plazoMeses, apr, esquemaAmortizacion: product.esquemaAmortizacion },
        useCase: uc.value,
      });
    }
    if (!recommendation) {
      recommendation = heuristicRecommendation(simulation);
    }

    // Persist — append-only.
    const id = await repo.createDebtSimulation(req.fincaId, {
      uid: req.uid,
      userEmail: req.userEmail,
    }, {
      creditProductId,
      providerName: product.providerName || null,
      snapshotId,
      snapshotAsOf: snapshot.asOf || null,
      amount: round2(amount),
      plazoMeses,
      apr,
      esquemaAmortizacion: product.esquemaAmortizacion,
      useCase: uc.value,
      baseline,
      seed,
      nTrials,
      horizonteMeses,
      withoutDebt: simulation.withoutDebt,
      withDebt: simulation.withDebt,
      delta: simulation.delta,
      debtCashFlow: simulation.debtCashFlow,
      useCaseImpact: simulation.useCaseImpact,
      warnings: simulation.warnings,
      recommendation,
      usedClaude: useClaude,
    });

    res.status(201).json({
      id,
      creditProductId,
      snapshotId,
      amount: round2(amount),
      plazoMeses,
      apr,
      esquemaAmortizacion: product.esquemaAmortizacion,
      useCase: uc.value,
      seed,
      nTrials,
      horizonteMeses,
      withoutDebt: simulation.withoutDebt,
      withDebt: simulation.withDebt,
      delta: simulation.delta,
      debtCashFlow: simulation.debtCashFlow,
      warnings: simulation.warnings,
      recommendation,
      usedClaude: useClaude,
    });
  } catch (error) {
    console.error('[FINANCING] debt-simulations simulate failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to simulate debt ROI.', 500);
  }
}

// ─── List ─────────────────────────────────────────────────────────────────

async function listDebtSimulations(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const docs = await repo.listDebtSimulations(req.fincaId);
    const rows = docs.map(({ id, data }) => ({
      id,
      creditProductId: data.creditProductId,
      providerName: data.providerName || null,
      snapshotId: data.snapshotId,
      amount: data.amount,
      plazoMeses: data.plazoMeses,
      apr: data.apr,
      recommendation: data.recommendation?.recommendation || null,
      marginDelta: data.delta?.resumen?.margenMedio?.delta ?? 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
      usedClaude: !!data.usedClaude,
    }));
    res.json(rows);
  } catch (error) {
    console.error('[FINANCING] debt-simulations list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list debt simulations.', 500);
  }
}

// ─── Get one ──────────────────────────────────────────────────────────────

async function getDebtSimulation(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership('debt_simulations', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    // createdBy (uid) y createdByEmail son identificadores internos del autor
    // que la UI no muestra; los omitimos del payload.
    const { createdBy, createdByEmail, recommendation, ...data } = ownership.doc.data();
    // `recommendation.reasoning` es el razonamiento crudo (chain-of-thought) de
    // Claude — útil para auditoría server-side, pero la UI solo usa el veredicto
    // y la justificación corta. No lo exponemos al cliente.
    const safeRecommendation = recommendation
      ? (({ reasoning, ...rest }) => rest)(recommendation)
      : recommendation;
    res.json({
      id: ownership.doc.id,
      ...data,
      recommendation: safeRecommendation,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    });
  } catch (error) {
    console.error('[FINANCING] debt-simulations get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch debt simulation.', 500);
  }
}

// ─── Delete ─────────────────────────────────────────────────────────────────

// Las simulaciones son append-only por diseño (trazabilidad), pero el usuario
// necesita poder limpiar corridas exploratorias/descartadas que ensucian la
// tabla. Borrado duro, restringido a supervisor+ (mismo gate que crear/listar)
// y validando ownership por finca.
async function deleteDebtSimulation(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }
    const ownership = await verifyOwnership('debt_simulations', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const removed = ownership.doc.data();
    await repo.removeDebtSimulation(req.params.id);

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.FINANCING_DEBT_SIMULATION_DELETE,
      target: { type: 'debt_simulation', id: req.params.id },
      metadata: {
        providerName: removed.providerName || null,
        amount: removed.amount ?? null,
        plazoMeses: removed.plazoMeses ?? null,
      },
      severity: SEVERITY.WARNING,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('[FINANCING] debt-simulations delete failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete debt simulation.', 500);
  }
}

module.exports = {
  simulateDebtRoiHandler,
  listDebtSimulations,
  getDebtSimulation,
  deleteDebtSimulation,
  // exported for tests
  _internals: { deriveBaseline, validateUseCase, clampInt },
  _limits: { MAX_N_TRIALS, MAX_HORIZONTE_MESES },
};
