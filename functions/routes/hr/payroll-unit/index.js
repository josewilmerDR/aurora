// HR/payroll-unit — aggregator del sub-dominio.
//
// Resultado del split de routes/hr/payroll-unit.js (557 LOC). El sub-dominio
// modela planilla por unidad/hora con segmentos por lote/labor y plantillas
// reutilizables del encargado.
//
// Sub-archivos:
//   - helpers.js    — enrichPlanilla, sanitizers, computeWorkerTotal (locales)
//   - reads.js      — GET planilla-unidad + historial
//   - mutations.js  — POST + PUT (con snapshot al aprobar) + DELETE
//   - templates.js  — plantillas-planilla (CRUD del encargado)
//
// Montado por hr/index.js sin cambios — Node resuelve el directorio.

const { Router } = require('express');

const readsRouter     = require('./reads');
const mutationsRouter = require('./mutations');
const templatesRouter = require('./templates');

const router = Router();

router.use(readsRouter);
router.use(mutationsRouter);
router.use(templatesRouter);

module.exports = router;
