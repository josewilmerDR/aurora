// Dominio Cosecha. Router que agrupa los submódulos (registros + despachos);
// montado por functions/index.js vía `require('./routes/harvest')`. Cada
// submódulo declara rutas con path completo (/api/cosecha/*).

const { Router } = require('express');

const router = Router();
router.use(require('./registros'));
router.use(require('./despachos'));

module.exports = router;
