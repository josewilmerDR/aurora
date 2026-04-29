// Products — ajuste físico de inventario.
//
// Sub-archivo del split de routes/products.js. POST /api/inventario/ajuste:
// permite reconciliar stock cuando hay discrepancia con el conteo físico.
// Cada ajuste produce un movimiento tipo='ajuste' con stockAnterior y
// stockNuevo, además de actualizar el stock del producto. Requiere nota
// obligatoria de hasta 288 caracteres.
//
// Genera un audit WARNING con el total absoluto de delta y la lista de
// items (capada a 20). Esto es importante porque el ajuste manual es
// fraud-prone: un insider puede ocultar pérdidas con notas vagas, y el
// audit log permite revisar adjustments sospechosos a posteriori.

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

router.post('/api/inventario/ajuste', authenticate, async (req, res) => {
  try {
    const { nota, ajustes } = req.body;
    if (!nota || !nota.trim()) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Explanatory note is required.', 400);
    }
    if (typeof nota === 'string' && nota.length > 288) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Note cannot exceed 288 characters.', 400);
    }
    if (!Array.isArray(ajustes) || ajustes.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one adjustment is required.', 400);
    }
    // Firestore batch limit: 500 ops. Each ajuste = 2 ops (update + set).
    if (ajustes.length > 250) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Maximum 250 adjustments per request.', 400);
    }

    const fincaId = req.fincaId;
    const notaTrimmed = nota.trim().slice(0, 288);

    // Verify all productoIds belong to this finca before modifying
    const productoIds = ajustes
      .map(a => a.productoId)
      .filter(id => typeof id === 'string' && id.length > 0);
    if (productoIds.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No valid products found.', 400);
    }
    const prodSnaps = await Promise.all(
      productoIds.map(id => db.collection('productos').doc(id).get())
    );
    const ownedIds = new Set();
    for (const snap of prodSnaps) {
      if (snap.exists && snap.data().fincaId === fincaId) ownedIds.add(snap.id);
    }

    const batch = db.batch();
    const fechaAjuste = new Date();
    const movimientosCreados = [];

    for (const ajuste of ajustes) {
      const { productoId, stockAnterior, stockNuevo } = ajuste;
      if (!productoId || stockNuevo === undefined) continue;
      if (!ownedIds.has(productoId)) continue;
      const stockNuevoNum = parseFloat(stockNuevo);
      const stockAnteriorNum = parseFloat(stockAnterior);
      if (isNaN(stockNuevoNum) || stockNuevoNum < 0 || stockNuevoNum > 32768) continue;
      if (Math.abs(stockNuevoNum - stockAnteriorNum) < 0.0001) continue; // sin cambio

      const prodRef = db.collection('productos').doc(productoId);
      batch.update(prodRef, { stockActual: stockNuevoNum });

      const diferencia = stockNuevoNum - stockAnteriorNum;
      const movRef = db.collection('movimientos').doc();
      const movData = {
        fincaId,
        productoId,
        tipo: 'ajuste',
        cantidad: diferencia,
        stockAnterior: stockAnteriorNum,
        stockNuevo: stockNuevoNum,
        nota: notaTrimmed,
        fecha: fechaAjuste,
      };
      batch.set(movRef, movData);
      movimientosCreados.push({ id: movRef.id, ...movData });
    }

    if (movimientosCreados.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No differences to adjust.', 400);
    }

    await batch.commit();

    // Manual stock reconciliation is fraud-prone: an insider can hide a loss
    // by "adjusting" stock downward with a vague nota. Log the full delta list
    // so a reviewer can spot large or suspicious adjustments later.
    const totalDelta = movimientosCreados.reduce((sum, m) => sum + Math.abs(m.cantidad || 0), 0);
    writeAuditEvent({
      fincaId,
      actor: req,
      action: ACTIONS.STOCK_ADJUST,
      metadata: {
        nota: notaTrimmed,
        ajustesCount: movimientosCreados.length,
        totalDelta: Math.round(totalDelta * 100) / 100,
        items: movimientosCreados.slice(0, 20).map(m => ({
          productoId: m.productoId,
          stockAnterior: m.stockAnterior,
          stockNuevo: m.stockNuevo,
          cantidad: m.cantidad,
        })),
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ ajustados: movimientosCreados.length, movimientos: movimientosCreados });
  } catch (error) {
    console.error('Error in inventory adjustment:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process inventory adjustment.', 500);
  }
});

module.exports = router;
