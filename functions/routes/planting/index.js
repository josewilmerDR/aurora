// Router del dominio planting (siembras + materiales-siembra).
// Montado desde functions/index.js como app.use(require('./routes/planting')).
//
// Sub-routers:
//   materiales.js  — CRUD de materiales_siembra
//   scan.js        — POST /api/siembras/escanear (Claude vision)
//   available.js   — GET /api/siembras/disponibles (asignación a grupos)
//   bulk.js        — POST /api/siembras/bulk (batch atómico)
//   siembras.js    — CRUD de siembras
//
// Orden de montaje: el sub-router de siembras va último porque sus rutas
// (`/api/siembras/:id`) podrían capturar las URLs con sub-path fijo
// (`escanear`, `disponibles`, `bulk`) si se montaran primero.

const { Router } = require('express');

const router = Router();

router.use(require('./materiales'));
router.use(require('./scan'));
router.use(require('./available'));
router.use(require('./bulk'));
router.use(require('./siembras'));

module.exports = router;
