// Procurement-invoices — aggregator del dominio (legacy `compras`).
//
// Resultado del split de routes/procurement-invoices.js (870 LOC). El
// dominio modela todo el ciclo de adquisición de inventario:
//
//   solicitud        → request del encargado
//        ↓
//   orden de compra  → documento formal al proveedor
//        ↓
//   recepción        → mercancía llegó, stock + ledger
//
// Más dos rutas alternas: factura escaneada con IA (compras) y consulta
// del ledger de movimientos.
//
// Sub-archivos por sub-dominio:
//   - invoices.js           — /api/compras/* (escaneo + confirmación)
//   - purchase-requests.js  — /api/solicitudes-compra/* (CRUD de pedidos internos)
//   - movements.js          — /api/movimientos (lectura del ledger)
//   - purchase-orders.js    — /api/ordenes-compra/* (CRUD de OCs)
//   - receipts.js           — /api/recepciones/* (recepción → stock)
//
// Cada sub-archivo expone su propio Router con paths absolutos.

const { Router } = require('express');

const invoicesRouter        = require('./invoices');
const purchaseRequestsRouter = require('./purchase-requests');
const movementsRouter       = require('./movements');
const purchaseOrdersRouter  = require('./purchase-orders');
const receiptsRouter        = require('./receipts');

const router = Router();

router.use(invoicesRouter);
router.use(purchaseRequestsRouter);
router.use(movementsRouter);
router.use(purchaseOrdersRouter);
router.use(receiptsRouter);

module.exports = router;
