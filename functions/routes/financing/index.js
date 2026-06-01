// Router for `/api/financing/...` — Fase 5 (External Financing).
//
// Fase 5.1 only exposes the financial profile endpoints. Later sub-fases
// (5.2 credit catalog, 5.3 eligibility, 5.4 debt simulations) will mount
// additional handlers under the same router.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const {
  getLiveProfile,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  exportSnapshot,
} = require('./profile');
const {
  listCreditProducts,
  getCreditProduct,
  createCreditProduct,
  updateCreditProduct,
  deleteCreditProduct,
} = require('./creditProducts');
const { simulateCreditCost } = require('./simulateCost');
const {
  analyzeEligibility,
  listEligibilityAnalyses,
  getEligibilityAnalysis,
} = require('./eligibility');
const {
  simulateDebtRoiHandler,
  listDebtSimulations,
  getDebtSimulation,
  deleteDebtSimulation,
} = require('./debtSimulations');

const router = Router();

// Gate de rol AUTORITATIVO del dominio, a nivel de router. Antes el chequeo
// vivía sólo dentro de cada handler (18 copias de `hasMinRoleBE`), de modo que
// un handler nuevo montado sin su `if` quedaba abierto a cualquier miembro de la
// finca. Centralizarlo acá garantiza que toda ruta tenga un piso de rol explícito
// en un solo lugar. Los handlers conservan su propio chequeo como defensa en
// profundidad (y porque el orquestador los invoca en proceso, sin pasar por este
// router). Lecturas → supervisor+; escrituras/snapshots/export/analyze → admin.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

// Order matters: specific paths before /:id.
router.get('/api/financing/profile/live', authenticate, requireRole('supervisor'), getLiveProfile);

// Snapshot creation fans out to a heavy multi-collection scan + an immutable
// write; cap it with the costly_read tier so a runaway client (or abusive
// admin) can't hammer expensive Firestore reads.
router.post('/api/financing/profile/snapshot', authenticate, requireRole('administrador'), rateLimit('financing_snapshot', 'costly_read'), createSnapshot);
router.get('/api/financing/profile/snapshots', authenticate, requireRole('supervisor'), listSnapshots);
// Export serializes the full financial profile (HTML/JSON) and is a data
// exfiltration channel; cap it like the snapshot create so a token can't
// script a mass pull. Same costly_read tier.
router.get('/api/financing/profile/snapshots/:id/export', authenticate, requireRole('administrador'), rateLimit('financing_snapshot_export', 'costly_read'), exportSnapshot);
router.get('/api/financing/profile/snapshots/:id', authenticate, requireRole('supervisor'), getSnapshot);

// Fase 5.2 — credit product catalog.
// List fans out to a full-collection scan + in-memory filtering → costly_read.
// Mutations share the 'write' tier so an abusive admin can't spam the catalog.
router.get('/api/financing/credit-products', authenticate, requireRole('supervisor'), rateLimit('financing_credit_read', 'costly_read'), listCreditProducts);
router.post('/api/financing/credit-products', authenticate, requireRole('administrador'), rateLimit('financing_credit_write', 'write'), createCreditProduct);
router.post('/api/financing/credit-products/:id/simulate-cost', authenticate, requireRole('supervisor'), simulateCreditCost);
router.get('/api/financing/credit-products/:id', authenticate, requireRole('supervisor'), getCreditProduct);
router.put('/api/financing/credit-products/:id', authenticate, requireRole('administrador'), rateLimit('financing_credit_write', 'write'), updateCreditProduct);
router.delete('/api/financing/credit-products/:id', authenticate, requireRole('administrador'), rateLimit('financing_credit_write', 'write'), deleteCreditProduct);

// Fase 5.3 — eligibility analysis.
// `analyze` loads the snapshot + catalog and (opt-in ?useClaude=1) fans out
// serial Claude calls per borderline product → ai_heavy tier.
router.post('/api/financing/eligibility/analyze', authenticate, requireRole('administrador'), rateLimit('financing_eligibility', 'ai_heavy'), analyzeEligibility);
router.get('/api/financing/eligibility', authenticate, requireRole('supervisor'), listEligibilityAnalyses);
router.get('/api/financing/eligibility/:id', authenticate, requireRole('supervisor'), getEligibilityAnalysis);

// Fase 5.4 — debt ROI Monte Carlo simulations.
// `simulate` runs nTrials × horizonteMeses of CPU-bound Monte Carlo and
// (opt-in) a Claude refinement → ai_heavy tier. Params are also clamped in
// the handler so a single call can't exhaust CPU.
router.post('/api/financing/debt-simulations/simulate', authenticate, requireRole('supervisor'), rateLimit('financing_sim', 'ai_heavy'), simulateDebtRoiHandler);
// List fans out to a full-collection scan → costly_read. DELETE is a hard,
// irreversible write on an append-only record → 'write' tier (and audited).
router.get('/api/financing/debt-simulations', authenticate, requireRole('supervisor'), rateLimit('financing_sim_read', 'costly_read'), listDebtSimulations);
router.get('/api/financing/debt-simulations/:id', authenticate, requireRole('supervisor'), getDebtSimulation);
router.delete('/api/financing/debt-simulations/:id', authenticate, requireRole('supervisor'), rateLimit('financing_sim_write', 'write'), deleteDebtSimulation);

module.exports = router;
