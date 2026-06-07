// Products — confirmación atómica de ingreso de mercancía.
//
// Sub-archivo del split de routes/products.js. POST /api/ingreso/confirmar:
// versión más nueva del flujo de recepción que coexiste con
// /api/recepciones (en procurement-invoices/receipts.js). Diferencias:
//   - Resuelve productos por productoId o idProducto, mergeando si existe
//     o creando si no
//   - Sube la imagen de factura a Cloud Storage con token firmado
//   - Si viene ordenCompraId, recalcula cantidadRecibida server-side
//     (no confía en el cliente) y actualiza estado de la OC
//
// Persiste un único batch con: actualización/creación de productos,
// movimientos tipo='ingreso' por línea, recepción agregada, y opcional
// update de la OC.

const { Router } = require('express');
const { db, Timestamp, FieldValue, admin } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { reconcileReceive, computeEstado } = require('../../lib/inventory/ocReconcile');
const { MAX_RECEIVE_QTY } = require('../../lib/inventory/quantities');
const { cleanStr, num } = require('../../lib/inventory/sanitize');

const router = Router();

// Registrar un ingreso crea/mergea productos, incrementa stockActual, escribe
// el ledger de movimientos y cierra OCs (transición irreversible). Es un write
// privilegiado: mismo piso que POST /api/productos (encargado+) y rate-limited
// como escritura masiva con upload a Storage.
router.post('/api/ingreso/confirmar', authenticate, rateLimit('ingreso_confirmar', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register intake.', 403);
    }

    const { items, fecha, ordenCompraId, imageBase64, mediaType } = req.body;
    const proveedor = cleanStr(req.body.proveedor, 200);
    const facturaNumero = cleanStr(req.body.facturaNumero, 100);
    const ocPoNumber = cleanStr(req.body.ocPoNumber, 40);

    // --- Input validation ---
    if (typeof req.body.proveedor === 'string' && req.body.proveedor.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Supplier name too long.', 400);
    }
    if (typeof req.body.facturaNumero === 'string' && req.body.facturaNumero.length > 100) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invoice number too long.', 400);
    }
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 15 * 1024 * 1024) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Image too large (max ~10 MB).', 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one item is required.', 400);
    }
    if (items.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Too many items.', 400);
    }
    for (const item of items) {
      const qty = parseFloat(item.cantidad);
      if (!isNaN(qty) && (qty < 0 || qty > MAX_RECEIVE_QTY || !isFinite(qty))) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, `Invalid quantity for ${item.nombreComercial || 'a product'}.`, 400);
      }
    }
    const validos = items.filter(i => (i.idProducto || '').trim() || (i.nombreComercial || '').trim());
    if (validos.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No items have sufficient data.', 400);
    }

    const fechaTs = fecha
      ? Timestamp.fromDate(new Date(fecha + 'T12:00:00'))
      : Timestamp.now();

    // ── Pre-resolve products (async before the batch) ────────────────────────
    const resolved = [];
    for (const item of validos) {
      const stockIngresado = num(item.cantidad, { min: 0, max: MAX_RECEIVE_QTY });
      if (stockIngresado <= 0) continue;

      let existingDoc = null;
      if (item.productoId) {
        const snap = await db.collection('productos').doc(item.productoId).get();
        if (snap.exists && snap.data().fincaId === req.fincaId) existingDoc = snap;
      }
      if (!existingDoc && (item.idProducto || '').trim()) {
        const snap = await db.collection('productos')
          .where('fincaId', '==', req.fincaId)
          .where('idProducto', '==', item.idProducto.trim())
          .limit(1).get();
        if (!snap.empty) existingDoc = snap.docs[0];
      }
      resolved.push({ item, stockIngresado, existingDoc });
    }

    if (resolved.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'All items have zero quantity.', 400);
    }

    // ── Pre-generate reception ID for the file name ──────────────────────────
    const recepcionRef = db.collection('recepciones').doc();

    // ── Upload invoice image to Firebase Storage (if provided) ───────────────
    // Si el upload falla NO abortamos la recepción (el ledger es lo crítico),
    // pero señalizamos `imagenGuardada:false` para que el front avise que el
    // comprobante no quedó adjunto.
    let facturaImageUrl = null;
    let imagenGuardada = !imageBase64; // true si no se esperaba imagen
    if (imageBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `recepciones/${recepcionRef.id}_factura.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(imageBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        facturaImageUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
        imagenGuardada = true;
      } catch (storageErr) {
        console.error('Storage upload failed (factura ingreso):', storageErr.message);
        imagenGuardada = false;
      }
    }

    // ── Build batch ─────────────────────────────────────────────────────────
    const batch = db.batch();
    const recepcionItems = [];
    let creados = 0, mergeados = 0;

    for (const { item, stockIngresado, existingDoc } of resolved) {
      const precioUnitario = num(item.precioUnitario, { min: 0, max: 1e9 });
      const iva = num(item.iva, { min: 0, max: 100 });
      let productoId;
      if (existingDoc) {
        productoId = existingDoc.id;
        batch.update(existingDoc.ref, { stockActual: FieldValue.increment(stockIngresado) });
        mergeados++;
      } else {
        const newRef = db.collection('productos').doc();
        productoId = newRef.id;
        batch.set(newRef, {
          idProducto: (item.idProducto || '').trim(),
          nombreComercial: item.nombreComercial || '',
          ingredienteActivo: item.ingredienteActivo || '',
          tipo: item.tipo || '',
          unidad: item.unidad || '',
          precioUnitario,
          iva,
          proveedor: proveedor || '',
          stockActual: stockIngresado,
          stockMinimo: 0,
          cantidadPorHa: 0,
          moneda: 'USD',
          tipoCambio: 1,
          plagaQueControla: '',
          periodoReingreso: 0,
          periodoACosecha: 0,
          activo: true,
          fincaId: req.fincaId,
        });
        creados++;
      }

      batch.set(db.collection('movimientos').doc(), {
        tipo: 'ingreso',
        productoId,
        idProducto: (item.idProducto || '').trim(),
        nombreComercial: item.nombreComercial || '',
        cantidad: stockIngresado,
        unidad: item.unidad || '',
        precioUnitario,
        iva,
        proveedor: proveedor || '',
        fecha: fechaTs,
        motivo: proveedor ? `Ingreso: ${proveedor}` : 'Ingreso de inventario',
        recepcionId: recepcionRef.id,
        fincaId: req.fincaId,
        ...(facturaNumero    ? { facturaNumero }    : {}),
        ...(ordenCompraId   ? { ordenCompraId }   : {}),
        ...(ocPoNumber      ? { ocPoNumber }      : {}),
        ...(facturaImageUrl ? { facturaImageUrl } : {}),
      });

      recepcionItems.push({
        productoId,
        idProducto: (item.idProducto || '').trim(),
        nombreComercial: item.nombreComercial || '',
        cantidadOC: num(item.cantidadOC, { min: 0, max: MAX_RECEIVE_QTY }) || stockIngresado,
        cantidadRecibida: stockIngresado,
        unidad: item.unidad || '',
        precioUnitario,
        iva,
      });
    }

    batch.set(recepcionRef, {
      fincaId: req.fincaId,
      ordenCompraId: ordenCompraId || null,
      poNumber: ocPoNumber || '',
      proveedor: proveedor || '',
      facturaNumero: facturaNumero || '',
      fechaRecepcion: fechaTs,
      items: recepcionItems,
      imageUrl: facturaImageUrl || null,
      createdAt: Timestamp.now(),
      createdBy: req.uid || null,
      createdByEmail: req.userEmail || '',
    });

    if (ordenCompraId) {
      const ordenDoc = await db.collection('ordenes_compra').doc(ordenCompraId).get();
      if (ordenDoc.exists && ordenDoc.data().fincaId === req.fincaId) {
        // Conciliación server-side (nunca confiamos en el cliente): acumula lo
        // recibido sobre las líneas de la OC y deriva el estado de su propia
        // `cantidad`. Lógica compartida con receipts.js (recepción/anulación).
        const updatedItems = reconcileReceive(ordenDoc.data().items || [], recepcionItems);
        batch.update(ordenDoc.ref, { estado: computeEstado(updatedItems), items: updatedItems });
      }
    }

    await batch.commit();

    // Audit: el ingreso muta stock, crea productos y cierra OCs (irreversible).
    // Mismo criterio que PURCHASE_RECEIPT en el flujo de /api/recepciones.
    await writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PURCHASE_RECEIPT,
      target: { type: 'recepcion', id: recepcionRef.id },
      metadata: {
        creados,
        mergeados,
        itemsCount: recepcionItems.length,
        ordenCompraId: ordenCompraId || null,
        proveedor: proveedor || null,
        facturaNumero: facturaNumero || null,
      },
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ recepcionId: recepcionRef.id, creados, mergeados, imagenGuardada });
  } catch (error) {
    console.error('Error in ingreso/confirmar:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register intake.', 500);
  }
});

module.exports = router;
