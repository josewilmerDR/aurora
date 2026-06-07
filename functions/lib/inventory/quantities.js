// Topes de cantidad compartidos por los flujos de ingreso de stock.
//
// Los tres writers de recepción (products/intake.js, procurement-invoices/
// receipts.js y procurement-invoices/invoices.js «compras/confirmar») deben
// acotar la cantidad por línea con el MISMO límite — antes divergían (uno
// clampaba a 999999, otro no acotaba nada). Un valor inflado que entra a
// stock/movimientos es superficie de ataque, así que se centraliza aquí.
//
// 999999 está muy por encima de cualquier factura agrícola legítima; líneas por
// encima se rechazan en vez de clamparse silenciosamente.
const MAX_RECEIVE_QTY = 999999;

module.exports = { MAX_RECEIVE_QTY };
