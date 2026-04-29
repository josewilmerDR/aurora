// Strategy — aggregator del dominio (Fase 4.2 — recomendaciones de rotación).
//
// Resultado del split de routes/strategy.js (609 LOC). El dominio cubre tres
// superficies:
//
//   1. Constraints agronómicos     — catálogo editable por cultivo
//   2. Recomendador de rotación    — Claude + thinking + guardrails + ejecución N3
//   3. Ciclo de decisión           — accept/reject + ejecución N2
//
// Sub-archivos:
//   - helpers.js     — constants, requireSupervisor, executePropuestasAsSiembras,
//                       stripReasoningForRole (compartido por recommend + decisions)
//   - constraints.js — CRUD de rotation_constraints
//   - recommend.js   — POST /rotation/recommend (con loaders de contexto)
//   - decisions.js   — list/get/accept/reject de rotation_recommendations

const { Router } = require('express');

const constraintsRouter = require('./constraints');
const recommendRouter   = require('./recommend');
const decisionsRouter   = require('./decisions');

const router = Router();

router.use(constraintsRouter);
router.use(recommendRouter);
router.use(decisionsRouter);

module.exports = router;
