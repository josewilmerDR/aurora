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
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

router.post('/api/ingreso/confirmar', authenticate, async (req, res) => {
  try {
    const { items, proveedor, fecha, facturaNumero, ordenCompraId, ocPoNumber, imageBase64, mediaType } = req.body;

    // --- Input validation ---
    if (typeof proveedor === 'string' && proveedor.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Supplier name too long.', 400);
    }
    if (typeof facturaNumero === 'string' && facturaNumero.length > 100) {
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
      if (!isNaN(qty) && (qty < 0 || qty > 999999 || !isFinite(qty))) {
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
      const stockIngresado = parseFloat(item.cantidad) || 0;
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
    let facturaImageUrl = null;
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
      } catch (storageErr) {
        console.error('Storage upload failed (factura ingreso):', storageErr.message);
      }
    }

    // ── Build batch ─────────────────────────────────────────────────────────
    const batch = db.batch();
    const recepcionItems = [];
    let creados = 0, mergeados = 0;

    for (const { item, stockIngresado, existingDoc } of resolved) {
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
          precioUnitario: parseFloat(item.precioUnitario) || 0,
          iva: parseFloat(item.iva) || 0,
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
        precioUnitario: parseFloat(item.precioUnitario) || 0,
        iva: parseFloat(item.iva) || 0,
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
        cantidadOC: parseFloat(item.cantidadOC) || stockIngresado,
        cantidadRecibida: stockIngresado,
        unidad: item.unidad || '',
        precioUnitario: parseFloat(item.precioUnitario) || 0,
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
    });

    if (ordenCompraId) {
      const ordenDoc = await db.collection('ordenes_compra').doc(ordenCompraId).get();
      if (ordenDoc.exists && ordenDoc.data().fincaId === req.fincaId) {
        const ocData = ordenDoc.data();
        const ocItems = ocData.items || [];
        // Recalculate cantidadRecibida server-side (do not trust the client)
        const updatedItems = ocItems.map(ocItem => {
          const match = recepcionItems.find(ri =>
            ri.productoId === ocItem.productoId ||
            (ri.nombreComercial || '').toLowerCase().trim() === (ocItem.nombreComercial || '').toLowerCase().trim()
          );
          const prevReceived = parseFloat(ocItem.cantidadRecibida) || 0;
          const nowReceived = match ? match.cantidadRecibida : 0;
          return { ...ocItem, cantidadRecibida: prevReceived + nowReceived };
        });
        const allFull = updatedItems.every(i =>
          (parseFloat(i.cantidad) || 0) === 0 ||
          (parseFloat(i.cantidadRecibida) || 0) >= (parseFloat(i.cantidad) || 0)
        );
        batch.update(ordenDoc.ref, {
          estado: allFull ? 'recibida' : 'recibida_parcialmente',
          items: updatedItems,
        });
      }
    }

    await batch.commit();
    res.status(201).json({ recepcionId: recepcionRef.id, creados, mergeados });
  } catch (error) {
    console.error('Error in ingreso/confirmar:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register intake.', 500);
  }
});

module.exports = router;
