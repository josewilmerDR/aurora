// Procurement-invoices — recepción de mercancía (`recepciones`).
//
// Sub-archivo del split de routes/procurement-invoices.js. La recepción
// es donde la OC se materializa en stock real. Endpoints:
//   - GET  /api/recepciones    lista (filtra opcional por ordenCompraId)
//   - POST /api/recepciones    registra recepción → suma stockActual,
//                               escribe ledger en movimientos, sube imagen
//                               firmada a Cloud Storage, y actualiza el
//                               estado de la OC asociada (recibida o
//                               recibida_parcial). Genera audit INFO con
//                               total recibido.
//
// Únicos efectos colaterales sobre stock distintos de cedulas (egreso) y
// compras (ingreso por factura): aquí entra ingreso por OC formal.

const { Router } = require('express');
const { db, admin, Timestamp, FieldValue } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

router.get('/api/recepciones', authenticate, async (req, res) => {
  try {
    const { ordenCompraId } = req.query;
    let query = db.collection('recepciones').where('fincaId', '==', req.fincaId);
    if (ordenCompraId) {
      query = query.where('ordenCompraId', '==', ordenCompraId).limit(5);
    } else {
      query = query.orderBy('fechaRecepcion', 'desc').limit(50);
    }
    const snapshot = await query.get();
    const recepciones = snapshot.docs.map(doc => {
      const data = doc.data();
      // eslint-disable-next-line no-unused-vars
      const { imageBase64, mediaType, ...rest } = data; // strip legacy base64 fields
      return {
        id: doc.id,
        ...rest,
        fechaRecepcion: data.fechaRecepcion ? data.fechaRecepcion.toDate().toISOString() : null,
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      };
    });
    res.status(200).json(recepciones);
  } catch (error) {
    console.error('[recepciones:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recepciones.', 500);
  }
});

router.get('/api/recepciones/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('recepciones').doc(req.params.id).get();
    if (!doc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Recepción no encontrada.', 404);
    }
    const data = doc.data();
    if (data.fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Recepción no encontrada.', 404);
    }
    // eslint-disable-next-line no-unused-vars
    const { imageBase64, mediaType, ...rest } = data;
    const toIso = (ts) => (ts && typeof ts.toDate === 'function') ? ts.toDate().toISOString() : null;
    res.status(200).json({
      id: doc.id,
      ...rest,
      fechaRecepcion: toIso(data.fechaRecepcion),
      createdAt: toIso(data.createdAt),
      anuladaAt: toIso(data.anuladaAt),
    });
  } catch (error) {
    console.error('[recepciones:get]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch recepción.', 500);
  }
});

router.post('/api/recepciones', authenticate, async (req, res) => {
  try {
    const { ordenCompraId, poNumber, proveedor, items, notas, imageBase64, mediaType } = req.body;

    // Input validation
    if (typeof notas === 'string' && notas.length > 1000) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'notas must not exceed 1000 characters.', 400);
    }
    if (typeof poNumber === 'string' && poNumber.length > 100) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'PO number is too long.', 400);
    }
    if (typeof proveedor === 'string' && proveedor.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Supplier name is too long.', 400);
    }
    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 15 * 1024 * 1024) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Image is too large (max ~10 MB).', 400);
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one item is required.', 400);
    }
    if (items.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Too many items in the reception.', 400);
    }
    for (const item of items) {
      const qty = parseFloat(item.cantidadRecibida);
      if (qty < 0 || qty > 999999 || !isFinite(qty)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, `Invalid quantity for ${item.nombreComercial || 'a product'}.`, 400);
      }
    }
    const recibidos = items.filter(i => parseFloat(i.cantidadRecibida) > 0);
    if (recibidos.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'At least one product must have quantity received > 0.', 400);
    }

    // Verify the order exists, belongs to the finca and is active
    if (ordenCompraId) {
      const ordenDoc = await db.collection('ordenes_compra').doc(ordenCompraId).get();
      if (!ordenDoc.exists) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Purchase order not found.', 404);
      }
      const ordenData = ordenDoc.data();
      if (ordenData.fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'No access to this purchase order.', 403);
      }
      if (ordenData.estado !== 'activa' && ordenData.estado !== 'recibida_parcial') {
        return sendApiError(res, ERROR_CODES.CONFLICT, 'This order has already been received or cancelled.', 400);
      }
    }

    const recepcionRef = db.collection('recepciones').doc();
    const motivo = `Recepción OC: ${poNumber || ordenCompraId || 'Manual'}`;

    // Upload image to Firebase Storage (if provided)
    let imageUrl = null;
    if (imageBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `recepciones/${recepcionRef.id}.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(imageBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        imageUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('[recepciones] Storage upload failed:', storageErr.message);
      }
    }

    const batch = db.batch();

    for (const item of recibidos) {
      const cantidadRecibida = parseFloat(item.cantidadRecibida);
      if (item.productoId) {
        batch.update(db.collection('productos').doc(item.productoId), {
          stockActual: FieldValue.increment(cantidadRecibida),
        });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: item.productoId,
          idProducto: item.idProducto || '',
          nombreComercial: item.nombreComercial || '',
          cantidad: cantidadRecibida,
          unidad: item.unidad || '',
          precioUnitario: parseFloat(item.precioUnitario) || 0,
          proveedor: proveedor || '',
          ocPoNumber: poNumber || '',
          ordenCompraId: ordenCompraId || null,
          fecha: Timestamp.now(),
          motivo,
          recepcionId: recepcionRef.id,
          fincaId: req.fincaId,
        });
      }
    }

    batch.set(recepcionRef, {
      fincaId: req.fincaId,
      ordenCompraId: ordenCompraId || null,
      poNumber: poNumber || '',
      proveedor: proveedor || '',
      fechaRecepcion: Timestamp.now(),
      items: recibidos.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: i.nombreComercial || '',
        cantidadOC: parseFloat(i.cantidadOC) || 0,
        cantidadRecibida: parseFloat(i.cantidadRecibida),
        unidad: i.unidad || '',
      })),
      notas: notas || '',
      imageUrl: imageUrl || null,
      createdAt: Timestamp.now(),
    });

    if (ordenCompraId) {
      const allReceived = items.every(
        i => parseFloat(i.cantidadRecibida) >= parseFloat(i.cantidadOC)
      );
      batch.update(db.collection('ordenes_compra').doc(ordenCompraId), {
        estado: allReceived ? 'recibida' : 'recibida_parcial',
      });
    }

    await batch.commit();

    // Goods received → inventory grew. Forensically useful when reconciling
    // physical stock later: answers "when did we say this arrived and who
    // accepted it".
    const totalCantidad = recibidos.reduce((s, i) => s + (parseFloat(i.cantidadRecibida) || 0), 0);
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PURCHASE_RECEIPT,
      target: { type: 'recepcion', id: recepcionRef.id },
      metadata: {
        ordenCompraId: ordenCompraId || null,
        poNumber: poNumber || null,
        proveedor: (proveedor || '').slice(0, 200),
        itemsCount: recibidos.length,
        totalCantidad: Math.round(totalCantidad * 100) / 100,
      },
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ id: recepcionRef.id, message: 'Reception registered and stock updated.' });
  } catch (error) {
    console.error('[recepciones:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register the reception.', 500);
  }
});

// Anular una recepción. Reglas:
//   - 404 si no existe o pertenece a otra finca.
//   - 409 si ya está anulada (idempotencia).
//   - 422 si algún producto tiene stockActual < cantidadRecibida (no se puede
//     deshacer un ingreso que ya fue parcialmente consumido). Se devuelve la
//     lista de productos bloqueantes.
//   - Reversión por compensating entries: cada item genera un movimiento
//     `tipo: 'anulacion_ingreso'` con cantidad igual a la recibida; el
//     stockActual se decrementa con FieldValue.increment. Los movimientos
//     originales no se mutan (ledger inmutable) excepto por una marca
//     `recepcionAnulada: true` para que la UI pueda mostrarlos como anulados
//     sin tener que hacer joins.
//   - Si la recepción venía de una OC, la cantidadRecibida de cada item se
//     decrementa y el estado de la OC se recalcula.
router.post('/api/recepciones/:id/anular', authenticate, async (req, res) => {
  try {
    const razon = (req.body?.razon || '').trim();
    if (!razon) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Razón es requerida.', 400);
    }
    if (razon.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Razón excede 200 caracteres.', 400);
    }

    const recepcionRef = db.collection('recepciones').doc(req.params.id);
    const recepcionDoc = await recepcionRef.get();
    if (!recepcionDoc.exists) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Recepción no encontrada.', 404);
    }
    const recepcion = recepcionDoc.data();
    if (recepcion.fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Recepción no encontrada.', 404);
    }
    if (recepcion.anulada) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'La recepción ya está anulada.', 409);
    }

    const items = Array.isArray(recepcion.items) ? recepcion.items : [];
    const itemsConProducto = items.filter(it => it.productoId);

    // 1. Validar stock disponible en cada producto.
    const productoDocs = await Promise.all(
      itemsConProducto.map(it => db.collection('productos').doc(it.productoId).get())
    );
    const blocking = [];
    for (let i = 0; i < itemsConProducto.length; i++) {
      const item = itemsConProducto[i];
      const doc = productoDocs[i];
      const cant = parseFloat(item.cantidadRecibida) || 0;
      const stock = doc.exists ? (parseFloat(doc.data().stockActual) || 0) : 0;
      if (stock < cant) {
        blocking.push({
          nombreComercial: item.nombreComercial || doc.data()?.nombreComercial || item.idProducto || 'Producto',
          stockActual: stock,
          cantidadAReversar: cant,
          unidad: item.unidad || doc.data()?.unidad || '',
        });
      }
    }
    if (blocking.length > 0) {
      const lines = blocking.map(b =>
        `${b.nombreComercial}: stock ${b.stockActual} ${b.unidad} < a reversar ${b.cantidadAReversar} ${b.unidad}`
      ).join('; ');
      return sendApiError(res,
        ERROR_CODES.VALIDATION_FAILED,
        `No se puede anular: stock insuficiente. ${lines}`,
        422
      );
    }

    // 2. Localizar movimientos originales (para flag recepcionAnulada).
    const movsSnap = await db.collection('movimientos')
      .where('recepcionId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .get();

    const batch = db.batch();
    const motivo = `Anulación recepción REC-${req.params.id.slice(-6).toUpperCase()}`;

    // 3. Decrementar stock + escribir movimientos compensatorios.
    for (const item of itemsConProducto) {
      const cant = parseFloat(item.cantidadRecibida) || 0;
      batch.update(db.collection('productos').doc(item.productoId), {
        stockActual: FieldValue.increment(-cant),
      });
      batch.set(db.collection('movimientos').doc(), {
        tipo: 'anulacion_ingreso',
        productoId: item.productoId,
        idProducto: item.idProducto || '',
        nombreComercial: item.nombreComercial || '',
        cantidad: cant,
        unidad: item.unidad || '',
        precioUnitario: parseFloat(item.precioUnitario) || 0,
        proveedor: recepcion.proveedor || '',
        fecha: Timestamp.now(),
        motivo,
        razon,
        recepcionId: req.params.id,
        fincaId: req.fincaId,
      });
    }

    // 4. Marcar movimientos originales como anulados (denormalización para lectura).
    for (const mov of movsSnap.docs) {
      const d = mov.data();
      if (d.tipo === 'ingreso') {
        batch.update(mov.ref, { recepcionAnulada: true });
      }
    }

    // 5. Actualizar la recepción.
    batch.update(recepcionRef, {
      anulada: true,
      anuladaAt: Timestamp.now(),
      anuladaPor: req.uid,
      anuladaRazon: razon,
    });

    // 6. Si venía de una OC, decrementar cantidadRecibida y recalcular estado.
    if (recepcion.ordenCompraId) {
      const ocRef = db.collection('ordenes_compra').doc(recepcion.ordenCompraId);
      const ocDoc = await ocRef.get();
      if (ocDoc.exists && ocDoc.data().fincaId === req.fincaId) {
        const ocData = ocDoc.data();
        const ocItems = ocData.items || [];
        const updatedItems = ocItems.map(ocItem => {
          const match = items.find(ri =>
            ri.productoId === ocItem.productoId ||
            (ri.nombreComercial || '').toLowerCase().trim() === (ocItem.nombreComercial || '').toLowerCase().trim()
          );
          if (!match) return ocItem;
          const prevReceived = parseFloat(ocItem.cantidadRecibida) || 0;
          const reverted = parseFloat(match.cantidadRecibida) || 0;
          return { ...ocItem, cantidadRecibida: Math.max(0, prevReceived - reverted) };
        });
        const totalRecibido = updatedItems.reduce((s, i) => s + (parseFloat(i.cantidadRecibida) || 0), 0);
        const allFull = updatedItems.every(i =>
          (parseFloat(i.cantidad) || 0) === 0 ||
          (parseFloat(i.cantidadRecibida) || 0) >= (parseFloat(i.cantidad) || 0)
        );
        const nextEstado = totalRecibido === 0
          ? 'pendiente'
          : (allFull ? 'recibida' : 'recibida_parcialmente');
        batch.update(ocRef, { estado: nextEstado, items: updatedItems });
      }
    }

    await batch.commit();

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PURCHASE_RECEIPT_VOID || 'PURCHASE_RECEIPT_VOID',
      target: { type: 'recepcion', id: req.params.id },
      metadata: {
        proveedor: (recepcion.proveedor || '').slice(0, 200),
        itemsCount: itemsConProducto.length,
        razon: razon.slice(0, 200),
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ id: req.params.id, anulada: true });
  } catch (error) {
    console.error('[recepciones:anular]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to void reception.', 500);
  }
});

module.exports = router;
