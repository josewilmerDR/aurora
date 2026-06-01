// Router for `/api/financing/...` — Fase 5 (External Financing).
//
// Fase 5.1 only exposes the financial profile endpoints. Later sub-fases
// (5.2 credit catalog, 5.3 eligibility, 5.4 debt simulations) will mount
// additional handlers under the same router.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
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

// Order matters: specific paths before /:id.
router.get('/api/financing/profile/live', authenticate, getLiveProfile);

// Snapshot creation fans out to a heavy multi-collection scan + an immutable
// write; cap it with the costly_read tier so a runaway client (or abusive
// admin) can't hammer expensive Firestore reads.
router.post('/api/financing/profile/snapshot', authenticate, rateLimit('financing_snapshot', 'costly_read'), createSnapshot);
router.get('/api/financing/profile/snapshots', authenticate, listSnapshots);
router.get('/api/financing/profile/snapshots/:id/export', authenticate, exportSnapshot);
router.get('/api/financing/profile/snapshots/:id', authenticate, getSnapshot);

// Fase 5.2 — credit product catalog.
// List fans out to a full-collection scan + in-memory filtering → costly_read.
// Mutations share the 'write' tier so an abusive admin can't spam the catalog.
router.get('/api/financing/credit-products', authenticate, rateLimit('financing_credit_read', 'costly_read'), listCreditProducts);
router.post('/api/financing/credit-products', authenticate, rateLimit('financing_credit_write', 'write'), createCreditProduct);
router.post('/api/financing/credit-products/:id/simulate-cost', authenticate, simulateCreditCost);
router.get('/api/financing/credit-products/:id', authenticate, getCreditProduct);
router.put('/api/financing/credit-products/:id', authenticate, rateLimit('financing_credit_write', 'write'), updateCreditProduct);
router.delete('/api/financing/credit-products/:id', authenticate, rateLimit('financing_credit_write', 'write'), deleteCreditProduct);

// Fase 5.3 — eligibility analysis.
// `analyze` loads the snapshot + catalog and (opt-in ?useClaude=1) fans out
// serial Claude calls per borderline product → ai_heavy tier.
router.post('/api/financing/eligibility/analyze', authenticate, rateLimit('financing_eligibility', 'ai_heavy'), analyzeEligibility);
router.get('/api/financing/eligibility', authenticate, listEligibilityAnalyses);
router.get('/api/financing/eligibility/:id', authenticate, getEligibilityAnalysis);

// Fase 5.4 — debt ROI Monte Carlo simulations.
// `simulate` runs nTrials × horizonteMeses of CPU-bound Monte Carlo and
// (opt-in) a Claude refinement → ai_heavy tier. Params are also clamped in
// the handler so a single call can't exhaust CPU.
router.post('/api/financing/debt-simulations/simulate', authenticate, rateLimit('financing_sim', 'ai_heavy'), simulateDebtRoiHandler);
router.get('/api/financing/debt-simulations', authenticate, listDebtSimulations);
router.get('/api/financing/debt-simulations/:id', authenticate, getDebtSimulation);
router.delete('/api/financing/debt-simulations/:id', authenticate, deleteDebtSimulation);

module.exports = router;
