// Monitoring — aggregator del dominio (legacy `monitoreo`).
//
// Resultado del split de routes/monitoring.js (792 LOC). El dominio modela
// 4 sub-conceptos relacionados:
//
//   tipos (plantillas)  → catálogo de campos personalizados (texto/número/fecha)
//   paquetes            → programa de actividades de muestreo con tipos asociados
//   muestreos (órdenes) → instancias programadas (scheduled_tasks tipo MUESTREO)
//   monitoreos          → datos efectivamente capturados, lo que reportes leen
//
// Sub-archivos:
//   - helpers.js   — sanitizers + constantes compartidas
//   - types.js     — /api/monitoreo/tipos/* CRUD
//   - packages.js  — /api/monitoreo/paquetes/* CRUD
//   - sampling.js  — /api/muestreos/* (orders + AI form scanner)
//   - records.js   — /api/monitoreo/* (lectura/escritura de monitoreos)

const { Router } = require('express');

const typesRouter    = require('./types');
const packagesRouter = require('./packages');
const samplingRouter = require('./sampling');
const recordsRouter  = require('./records');

const router = Router();

router.use(typesRouter);
router.use(packagesRouter);
router.use(samplingRouter);
router.use(recordsRouter);

module.exports = router;
