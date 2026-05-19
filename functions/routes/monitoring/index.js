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
//   - types.js     — /api/muestreos/tipos/* CRUD
//   - packages.js  — /api/muestreos/paquetes/* CRUD
//   - sampling.js  — /api/muestreos/ordenes y /api/muestreos/escanear-formulario
//   - records.js   — /api/muestreos (lectura/escritura de monitoreos capturados)
//
// Convención (CLAUDE.md "Module conventions: Monitoreo vs Muestreos"):
// /api/monitoreo/* queda RESERVADO para futuros dashboards cross-submódulo
// (sensores, telemetría). Todo lo sampling-specific vive bajo /api/muestreos/*.
// El shim debajo redirige el namespace viejo para clientes con build cacheado.

const { Router } = require('express');

const typesRouter    = require('./types');
const packagesRouter = require('./packages');
const samplingRouter = require('./sampling');
const recordsRouter  = require('./records');

const router = Router();

// DEPRECATED ALIAS (PR #558) — eliminar después de 2 releases de producción.
// Reescribe /api/monitoreo/* → /api/muestreos/* antes de que los routers
// hagan match, para no romper clientes con builds cacheados durante el
// rollout. moduleMap.js incluye ambos prefijos para que la verificación de
// módulo siga funcionando con el namespace viejo.
router.use((req, _res, next) => {
  if (/^\/api\/monitoreo(\/|\?|$)/.test(req.url)) {
    req.url = req.url.replace(/^\/api\/monitoreo/, '/api/muestreos');
  }
  next();
});

router.use(typesRouter);
router.use(packagesRouter);
router.use(samplingRouter);
router.use(recordsRouter);

module.exports = router;
