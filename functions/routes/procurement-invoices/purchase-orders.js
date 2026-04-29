// Procurement-invoices — órdenes de compra (`ordenes_compra`).
//
// Sub-archivo del split de routes/procurement-invoices.js. CRUD de OCs
// (purchase orders): el documento formal que se manda al proveedor antes
// de la recepción. Tres endpoints:
//   - GET   /api/ordenes-compra        lista, opcional ?estado=...
//   - POST  /api/ordenes-compra        crea OC, calcula totalCRC con FX
//                                       cuando algún ítem está en otra moneda;
//                                       genera poNumber atómico via counter;
//                                       cierra solicitud asociada y back-linkea
//                                       RFQ si vienen referenciados
//   - PATCH /api/ordenes-compra/:id    cambia estado o items (recepción
//                                       parcial, cancelación, etc.)
//
// La transición de OC a stock real ocurre en receipts.js (POST /api/recepciones).

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

router.get('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('ordenes_compra')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    let ordenes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha ? doc.data().fecha.toDate().toISOString() : null,
      fechaEntrega: doc.data().fechaEntrega ? doc.data().fechaEntrega.toDate().toISOString() : null,
      createdAt: doc.data().createdAt ? doc.data().createdAt.toDate().toISOString() : null,
    }));
    const { estado } = req.query;
    if (estado) ordenes = ordenes.filter(o => o.estado === estado);
    res.status(200).json(ordenes);
  } catch (error) {
    console.error('[ordenes-compra:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch purchase orders.', 500);
  }
});

router.post('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const { fecha, fechaEntrega, proveedor, direccionProveedor, elaboradoPor, notas, items, taskId, solicitudId, rfqId, exchangeRateToCRC } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one product is required.', 400);
    }
    if (items.length > 500) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Too many products in a single order.', 400);
    }
    const isValidYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime());
    if (fecha != null && !isValidYmd(fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid order date.', 400);
    }
    if (fechaEntrega != null && fechaEntrega !== '' && !isValidYmd(fechaEntrega)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid delivery date.', 400);
    }
    if (fecha && fechaEntrega && fechaEntrega < fecha) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Delivery date cannot be earlier than order date.', 400);
    }
    const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
    const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
      const n = parseFloat(v);
      if (!isFinite(n)) return 0;
      return Math.min(Math.max(n, min), max);
    };

    // Moneda funcional = CRC. Si algún ítem está en otra moneda, exigimos
    // tipo de cambio y congelamos `totalCRC` al crear la OC.
    const hasNonCrcItem = items.some(i => {
      const m = typeof i.moneda === 'string' ? i.moneda.toUpperCase() : 'CRC';
      return m && m !== 'CRC';
    });
    let fxRate = 1;
    if (hasNonCrcItem) {
      const fx = parseFloat(exchangeRateToCRC);
      if (!isFinite(fx) || fx <= 0 || fx > 100000) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'exchangeRateToCRC is required and must be > 0 when any item is not in CRC.', 400);
      }
      fxRate = fx;
    }
    const totalCRC = items.reduce((sum, i) => {
      const qty = num(i.cantidad, { min: 0, max: 1e9 });
      const price = num(i.precioUnitario, { min: 0, max: 1e9 });
      const moneda = (typeof i.moneda === 'string' ? i.moneda.toUpperCase() : 'CRC');
      const lineTotal = qty * price;
      return sum + (moneda !== 'CRC' ? lineTotal * fxRate : lineTotal);
    }, 0);

    const counterRef = db.collection('counters').doc(`oc_${req.fincaId}`);
    let seq;
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      t.set(counterRef, { value: seq }, { merge: true });
    });
    const poNumber = `OC-${String(seq).padStart(6, '0')}`;
    const docRef = await db.collection('ordenes_compra').add({
      fincaId: req.fincaId,
      poNumber,
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fechaEntrega: fechaEntrega ? Timestamp.fromDate(new Date(fechaEntrega + 'T12:00:00')) : null,
      proveedor: str(proveedor, 200),
      direccionProveedor: str(direccionProveedor, 300),
      elaboradoPor: str(elaboradoPor, 120),
      notas: str(notas, 1000),
      estado: 'activa',
      taskId: taskId || null,
      solicitudId: solicitudId || null,
      rfqId: rfqId || null,
      items: items.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: str(i.nombreComercial, 200),
        ingredienteActivo: str(i.ingredienteActivo, 200),
        cantidad: num(i.cantidad, { min: 0, max: 1e9 }),
        unidad: str(i.unidad, 20),
        precioUnitario: num(i.precioUnitario, { min: 0, max: 1e9 }),
        iva: num(i.iva, { min: 0, max: 100 }),
        moneda: str(i.moneda, 10) || 'CRC',
      })),
      exchangeRateToCRC: fxRate,
      totalCRC: Math.round(totalCRC * 100) / 100,
      createdAt: Timestamp.now(),
    });
    if (solicitudId) {
      await db.collection('scheduled_tasks').doc(solicitudId).update({
        status: 'completed_by_user',
        completedAt: Timestamp.now(),
        ordenCompraId: docRef.id,
      });
    }
    if (rfqId) {
      // Back-link the RFQ to this OC so the cotización UI can show "OC ya creada".
      // Ownership-check to avoid cross-finca writes if an attacker spoofs rfqId.
      const rfqRef = db.collection('rfqs').doc(rfqId);
      const rfqSnap = await rfqRef.get();
      if (rfqSnap.exists && rfqSnap.data().fincaId === req.fincaId) {
        await rfqRef.update({
          ocId: docRef.id,
          ocNumber: poNumber,
          ocCreatedAt: Timestamp.now(),
        });
      }
    }

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PURCHASE_ORDER_CREATE,
      target: { type: 'orden_compra', id: docRef.id },
      metadata: {
        poNumber,
        proveedor: (proveedor || '').slice(0, 200),
        totalCRC: Math.round(totalCRC * 100) / 100,
        itemsCount: items.length,
        solicitudId: solicitudId || null,
        rfqId: rfqId || null,
      },
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ id: docRef.id, poNumber, message: 'Purchase order saved.' });
  } catch (error) {
    console.error('[ordenes-compra:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save purchase order.', 500);
  }
});

router.patch('/api/ordenes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, items } = req.body;
    const valid = ['activa', 'completada', 'cancelada', 'recibida', 'recibida_parcialmente'];
    if (!valid.includes(estado)) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    const docRef = db.collection('ordenes_compra').doc(id);
    const doc = await docRef.get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId)
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Purchase order not found.', 404);
    const updateData = { estado, updatedAt: Timestamp.now() };
    if (Array.isArray(items)) updateData.items = items;
    await docRef.update(updateData);
    res.status(200).json({ message: 'Estado updated.' });
  } catch (error) {
    console.error('[ordenes-compra:patch]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update order.', 500);
  }
});

module.exports = router;
