// Products — aggregator del dominio (legacy `productos`).
//
// Resultado del split de routes/products.js (607 LOC). El dominio cubre el
// catálogo de agroquímicos + sus flujos cercanos:
//
// Sub-archivos:
//   - helpers.js     — PRODUCT_FIELDS, validateProducto + listas válidas
//   - crud.js        — /api/productos/* CRUD + activar/inactivar
//   - ai.js          — /api/productos/ai-editar (edición vía Claude)
//   - adjustment.js  — /api/inventario/ajuste (reconciliación física, audit WARNING)
//   - intake.js      — /api/ingreso/confirmar (recepción atómica con factura)

const { Router } = require('express');

const crudRouter       = require('./crud');
const aiRouter         = require('./ai');
const adjustmentRouter = require('./adjustment');
const intakeRouter     = require('./intake');

const router = Router();

router.use(crudRouter);
router.use(aiRouter);
router.use(adjustmentRouter);
router.use(intakeRouter);

module.exports = router;
