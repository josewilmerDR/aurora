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
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { reconcileReceive, reconcileRevert, computeEstado } = require('../../lib/inventory/ocReconcile');
const { MAX_RECEIVE_QTY } = require('../../lib/inventory/quantities');
const { cleanStr, num } = require('../../lib/inventory/sanitize');

const router = Router();

router.get('/api/recepciones', authenticate, rateLimit('recepciones_read', 'public_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can view recepciones.', 403);
    }
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

router.get('/api/recepciones/:id', authenticate, rateLimit('recepciones_read', 'public_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can view recepciones.', 403);
    }
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

// Resuelve la factura adjunta bajo demanda. Devuelve un signed URL de 15 min
// (no un link público permanente), validando rol + finca. Docs legacy guardan
// imageUrl con token permanente → se devuelve tal cual para no romperlos.
router.get('/api/recepciones/:id/factura', authenticate, rateLimit('recepciones_read', 'public_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can view recepciones.', 403);
    }
    const doc = await db.collection('recepciones').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Recepción no encontrada.', 404);
    }
    const data = doc.data();
    if (!data.imagePath) {
      if (data.imageUrl) return res.json({ url: data.imageUrl }); // legacy
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'No attachment for this reception.', 404);
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(data.imagePath);
    const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (isEmulator) {
      // getSignedUrl no funciona en el emulador (sin service account). Fallback:
      // construir la URL con el download token guardado en metadata.
      const [meta] = await file.getMetadata();
      const token = meta.metadata?.firebaseStorageDownloadTokens;
      const encodedPath = encodeURIComponent(data.imagePath);
      return res.json({
        url: `http://${isEmulator}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`,
      });
    }
    const [url] = await file.getSignedUrl({
      action: 'read',
      version: 'v4',
      expires: Date.now() + 15 * 60 * 1000, // 15 min
    });
    return res.json({ url });
  } catch (error) {
    console.error('[recepciones:factura]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to resolve attachment.', 500);
  }
});

router.post('/api/recepciones', authenticate, rateLimit('recepciones_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register a reception.', 403);
    }
    const { ordenCompraId, items, imageBase64, mediaType } = req.body;
    // Sanitizar strings user-controlled (control/bidi strip + cap de longitud).
    const poNumber = cleanStr(req.body.poNumber, 100);
    const proveedor = cleanStr(req.body.proveedor, 200);
    const notas = cleanStr(req.body.notas, 1000);

    // Input validation
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
      if (qty < 0 || qty > MAX_RECEIVE_QTY || !isFinite(qty)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, `Invalid quantity for ${item.nombreComercial || 'a product'}.`, 400);
      }
    }
    const recibidos = items.filter(i => parseFloat(i.cantidadRecibida) > 0);
    if (recibidos.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'At least one product must have quantity received > 0.', 400);
    }

    // Verify the order exists, belongs to the finca and is active. Guardamos sus
    // líneas para conciliarlas server-side más abajo (recepción parcial
    // acumulativa). Aceptamos ambos rótulos de "parcial": el canónico
    // `recibida_parcialmente` y el legacy `recibida_parcial`.
    let ordenItems = null;
    if (ordenCompraId) {
      const ordenDoc = await db.collection('ordenes_compra').doc(ordenCompraId).get();
      if (!ordenDoc.exists) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Purchase order not found.', 404);
      }
      const ordenData = ordenDoc.data();
      if (ordenData.fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'No access to this purchase order.', 403);
      }
      const abierta = ['activa', 'recibida_parcial', 'recibida_parcialmente'];
      if (!abierta.includes(ordenData.estado)) {
        return sendApiError(res, ERROR_CODES.CONFLICT, 'This order has already been received or cancelled.', 400);
      }
      ordenItems = Array.isArray(ordenData.items) ? ordenData.items : [];
    }

    // H1 — multi-tenant: el productoId de cada línea lo controla el cliente y
    // abajo se usa para `increment(stockActual)`. Sin verificar la finca del
    // producto, un encargado podría inflar el stock de un producto de OTRA finca
    // (el movimiento se escribe con SU fincaId, invisible para la finca víctima).
    // Espeja el chequeo de intake.js/adjustment.js: resolvemos cada productoId y
    // abortamos si alguno no pertenece a la finca (mismo error para inexistente y
    // foráneo, sin filtrar existencia cross-tenant).
    const productoIds = [...new Set(recibidos.map(i => i.productoId).filter(Boolean))];
    if (productoIds.length > 0) {
      const prodSnaps = await Promise.all(
        productoIds.map(id => db.collection('productos').doc(id).get())
      );
      const ownedProductoIds = new Set();
      for (const snap of prodSnaps) {
        if (snap.exists && snap.data().fincaId === req.fincaId) ownedProductoIds.add(snap.id);
      }
      if (productoIds.some(id => !ownedProductoIds.has(id))) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'One or more products are invalid for this finca.', 400);
      }
    }

    const recepcionRef = db.collection('recepciones').doc();
    const motivo = `Recepción OC: ${poNumber || ordenCompraId || 'Manual'}`;

    // Upload image to Firebase Storage (if provided). Se persiste el PATH, no
    // una URL con token permanente: la factura se sirve bajo demanda vía
    // GET /api/recepciones/:id/factura con un signed URL de 15 min, autenticado
    // y finca-scoped (alineado con warehouses.js H8). Evita un link público
    // no expirable que cualquiera con la URL podría abrir sin auth.
    let imagePath = null;
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
        imagePath = fileName;
      } catch (storageErr) {
        console.error('[recepciones] Storage upload failed:', storageErr.message);
      }
    }

    const batch = db.batch();

    for (const item of recibidos) {
      const cantidadRecibida = num(item.cantidadRecibida, { max: 999999 });
      if (item.productoId) {
        batch.update(db.collection('productos').doc(item.productoId), {
          stockActual: FieldValue.increment(cantidadRecibida),
        });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: item.productoId,
          idProducto: cleanStr(item.idProducto, 100),
          nombreComercial: cleanStr(item.nombreComercial, 200),
          cantidad: cantidadRecibida,
          unidad: cleanStr(item.unidad, 40),
          precioUnitario: num(item.precioUnitario),
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
        idProducto: cleanStr(i.idProducto, 100),
        nombreComercial: cleanStr(i.nombreComercial, 200),
        cantidadOC: num(i.cantidadOC, { max: 999999 }),
        cantidadRecibida: num(i.cantidadRecibida, { max: 999999 }),
        unidad: cleanStr(i.unidad, 40),
        precioUnitario: num(i.precioUnitario),
        iva: num(i.iva, { max: 100 }),
      })),
      notas: notas || '',
      imagePath: imagePath || null,
      createdAt: Timestamp.now(),
      createdBy: req.uid || null,
      createdByEmail: req.userEmail || '',
    });

    if (ordenCompraId) {
      // Conciliación server-side: acumula lo recibido sobre las líneas de la OC
      // y deriva el estado de su propia `cantidad` (no del `cantidadOC` que
      // manda el cliente). Misma lógica que intake.js y la anulación.
      const updatedItems = reconcileReceive(ordenItems || [], recibidos.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: i.nombreComercial || '',
        cantidadRecibida: num(i.cantidadRecibida, { max: MAX_RECEIVE_QTY }),
      })));
      batch.update(db.collection('ordenes_compra').doc(ordenCompraId), {
        estado: computeEstado(updatedItems),
        items: updatedItems,
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
router.post('/api/recepciones/:id/anular', authenticate, rateLimit('recepciones_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only supervisor or above can void a reception.', 403);
    }
    const razon = (req.body?.razon || '').trim();
    if (!razon) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Razón es requerida.', 400);
    }
    if (razon.length > 200) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Razón excede 200 caracteres.', 400);
    }

    const recepcionRef = db.collection('recepciones').doc(req.params.id);

    // Toda la anulación corre en una transacción: re-lee la recepción DENTRO de
    // la tx y aborta si ya está anulada. Cierra el TOCTOU de dos "anular"
    // concurrentes que, con el batch anterior, podían pasar ambos el check
    // !anulada y revertir el stock dos veces.
    let txResult;
    try {
      txResult = await db.runTransaction(async (t) => {
        const recepcionDoc = await t.get(recepcionRef);
        if (!recepcionDoc.exists) {
          return { error: { code: ERROR_CODES.NOT_FOUND, msg: 'Recepción no encontrada.', status: 404 } };
        }
        const recepcion = recepcionDoc.data();
        if (recepcion.fincaId !== req.fincaId) {
          return { error: { code: ERROR_CODES.NOT_FOUND, msg: 'Recepción no encontrada.', status: 404 } };
        }
        if (recepcion.anulada) {
          return { error: { code: ERROR_CODES.CONFLICT, msg: 'La recepción ya está anulada.', status: 409 } };
        }

        const items = Array.isArray(recepcion.items) ? recepcion.items : [];
        const itemsConProducto = items.filter(it => it.productoId);

        // ── LECTURAS (todas antes de cualquier escritura) ──────────────────
        const productoRefs = itemsConProducto.map(it => db.collection('productos').doc(it.productoId));
        const productoDocs = await Promise.all(productoRefs.map(r => t.get(r)));

        const movsSnap = await t.get(
          db.collection('movimientos')
            .where('recepcionId', '==', req.params.id)
            .where('fincaId', '==', req.fincaId)
        );

        let ocRef = null;
        let ocDoc = null;
        if (recepcion.ordenCompraId) {
          ocRef = db.collection('ordenes_compra').doc(recepcion.ordenCompraId);
          ocDoc = await t.get(ocRef);
        }

        // Validar stock disponible (no deshacer un ingreso ya consumido).
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
          return { error: { code: ERROR_CODES.VALIDATION_FAILED, msg: `No se puede anular: stock insuficiente. ${lines}`, status: 422 } };
        }

        // ── ESCRITURAS ─────────────────────────────────────────────────────
        const motivo = `Anulación recepción ${recepcion.poNumber ? `OC ${recepcion.poNumber}` : (recepcion.proveedor || 'manual')}`;

        // Decrementar stock + movimientos compensatorios.
        for (let i = 0; i < itemsConProducto.length; i++) {
          const item = itemsConProducto[i];
          const cant = parseFloat(item.cantidadRecibida) || 0;
          t.update(productoRefs[i], { stockActual: FieldValue.increment(-cant) });
          t.set(db.collection('movimientos').doc(), {
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

        // Marcar movimientos originales como anulados (denormalización lectura).
        for (const mov of movsSnap.docs) {
          if (mov.data().tipo === 'ingreso') {
            t.update(mov.ref, { recepcionAnulada: true });
          }
        }

        // Actualizar la recepción.
        t.update(recepcionRef, {
          anulada: true,
          anuladaAt: Timestamp.now(),
          anuladaPor: req.uid,
          anuladaRazon: razon,
        });

        // Si venía de una OC, decrementar cantidadRecibida y recalcular estado.
        if (ocRef && ocDoc && ocDoc.exists && ocDoc.data().fincaId === req.fincaId) {
          // Revertir lo recibido por esta recepción y recomputar estado con la
          // misma lógica compartida que la recepción (consume-once + estado
          // derivado de la propia OC).
          const updatedItems = reconcileRevert(ocDoc.data().items || [], items);
          t.update(ocRef, { estado: computeEstado(updatedItems), items: updatedItems });
        }

        return { ok: true, proveedor: recepcion.proveedor || '', itemsCount: itemsConProducto.length };
      });
    } catch (txErr) {
      console.error('[recepciones:anular:tx]', txErr);
      return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to void reception.', 500);
    }

    if (txResult.error) {
      return sendApiError(res, txResult.error.code, txResult.error.msg, txResult.error.status);
    }

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PURCHASE_RECEIPT_VOID || 'PURCHASE_RECEIPT_VOID',
      target: { type: 'recepcion', id: req.params.id },
      metadata: {
        proveedor: (txResult.proveedor || '').slice(0, 200),
        itemsCount: txResult.itemsCount,
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
