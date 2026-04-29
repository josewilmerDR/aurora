// HR — Aggregator del dominio.
//
// Resultado del split de routes/hr.js (1898 LOC) en un directorio. Cada
// sub-archivo expone su propio Router con paths absolutos /api/hr/*; este
// index los monta en un Router único que functions/index.js requiere con
// `app.use(require('./routes/hr'))`. Node resuelve el directory y carga
// este index automáticamente.
//
// Para añadir un nuevo endpoint del dominio HR:
//   1. Identifica si encaja en uno de los sub-archivos existentes.
//   2. Si NO encaja, crea un nuevo sub-archivo siguiendo el patrón.
//   3. Móntalo aquí. No regreses al monolito.

const { Router } = require('express');

const fichasRouter       = require('./fichas');
const payrollFixedRouter = require('./payroll-fixed');
const payrollUnitRouter  = require('./payroll-unit');
const recordsRouter      = require('./records');
const performanceRouter  = require('./performance');
const miscRouter         = require('./misc');

const router = Router();

router.use(fichasRouter);
router.use(payrollFixedRouter);
router.use(payrollUnitRouter);
router.use(recordsRouter);
router.use(performanceRouter);
router.use(miscRouter);

module.exports = router;
