// POST /api/rfqs — creates an RFQ and fans out a WhatsApp message to every
// supplier listed in `supplierIds`. Delivery outcomes are stored per-supplier
// so the UI can tell which messages actually landed.
//
// The RFQ doc lifecycle starts in 'sent' (at least one recipient reached) or
// 'failed_send' (nobody reachable). Transitions: 'sent' → 'closed' (via the
// close handler) or → 'cancelled' (via delete).

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { buildRfqDoc } = require('../../lib/procurement/rfqValidator');
const { buildRfqMessage } = require('../../lib/procurement/rfqMessage');
const { sendRfqToSupplier } = require('../../lib/procurement/sendSupplierMessage');

async function createRfq(req, res) {
  try {
    const { error, data } = buildRfqDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);

    // Load suppliers, filter to this finca. Out-of-finca IDs are silently
    // dropped — the validator already capped count, and 403-for-each would
    // just leak which supplier IDs exist elsewhere.
    const supplierDocs = await Promise.all(
      data.supplierIds.map(id => db.collection('proveedores').doc(id).get())
    );
    const suppliers = supplierDocs
      .filter(d => d.exists && d.data().fincaId === req.fincaId)
      .map(d => ({ id: d.id, ...d.data() }));
    if (suppliers.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED,
        'Ninguno de los proveedores indicados pertenece a esta finca.', 400);
    }

    // Optional product name hydration if not supplied.
    let productName = data.nombreComercial;
    if (!productName) {
      const prodSnap = await db.collection('productos').doc(data.productoId).get();
      if (prodSnap.exists && prodSnap.data().fincaId === req.fincaId) {
        productName = prodSnap.data().nombreComercial || '';
      }
    }

    const fincaName = await fetchFincaName(req.fincaId);

    // Pre-allocate the doc so its id can land in the message body (as Ref).
    const rfqRef = db.collection('rfqs').doc();
    const outcomes = [];
    for (const supplier of suppliers) {
      const messageBody = buildRfqMessage({
        supplierName: supplier.nombre,
        fincaName,
        productName,
        cantidad: data.cantidad,
        unidad: data.unidad,
        deadline: data.deadline,
        rfqId: rfqRef.id,
        notas: data.notas,
      });
      const outcome = await sendRfqToSupplier({ supplier, messageBody });
      outcomes.push(outcome);
    }

    const anySent = outcomes.some(o => o.sent);
    const rfqDoc = {
      fincaId: req.fincaId,
      productoId: data.productoId,
      nombreComercial: productName || '',
      cantidad: data.cantidad,
      unidad: data.unidad,
      deadline: data.deadline,
      notas: data.notas,
      currency: data.currency,
      maxLeadTimeDays: data.maxLeadTimeDays,
      suppliersContacted: outcomes,
      responses: [],
      estado: anySent ? 'sent' : 'failed_send',
      winner: null,
      createdBy: req.uid || null,
      createdByName: req.userEmail || '',
      createdAt: Timestamp.now(),
      closedAt: null,
    };
    await rfqRef.set(rfqDoc);

    res.status(201).json({
      id: rfqRef.id,
      estado: rfqDoc.estado,
      suppliersContacted: outcomes,
    });
  } catch (error) {
    console.error('[RFQS] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create RFQ.', 500);
  }
}

async function fetchFincaName(fincaId) {
  try {
    const snap = await db.collection('fincas').doc(fincaId).get();
    if (snap.exists) return snap.data().nombre || '';
  } catch {
    // fincas collection may not exist in every deployment — fall through.
  }
  return '';
}

module.exports = { createRfq };
