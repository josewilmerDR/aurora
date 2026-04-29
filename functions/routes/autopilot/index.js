// Autopilot — Aggregator del dominio.
//
// Resultado del split de routes/autopilot.js (2085 LOC) en un directorio.
// Cada sub-archivo expone su propio Router con paths absolutos
// /api/autopilot/*; este index los monta en un Router único que
// functions/index.js requiere con `app.use(require('./routes/autopilot'))`.
// Node resuelve el directory y carga este index automáticamente.
//
// Para añadir un nuevo endpoint del dominio autopilot:
//   1. Identifica si encaja en uno de los sub-archivos existentes
//      (config / analyze / command / actions / preferences).
//   2. Si NO encaja, crea un nuevo sub-archivo siguiendo el patrón.
//   3. Móntalo aquí. No regreses al monolito.
//
// La complejidad principal vive en analyze.js (~750 LOC con N1/N2/N3) y
// command.js (~370 LOC). Reducirlos requeriría partir cada modo en su
// propio sub-archivo — scope para una migración posterior.

const { Router } = require('express');

const configRouter      = require('./config');
const analyzeRouter     = require('./analyze');
const commandRouter     = require('./command');
const actionsRouter     = require('./actions');
const preferencesRouter = require('./preferences');

const router = Router();

router.use(configRouter);
router.use(analyzeRouter);
router.use(commandRouter);
router.use(actionsRouter);
router.use(preferencesRouter);

module.exports = router;
