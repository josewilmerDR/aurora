const { Router } = require('express');
const { db, Timestamp, FieldValue, admin } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { getAnthropicClient } = require('../lib/clients');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

const PRODUCT_FIELDS = ['idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo',
  'plagaQueControla', 'periodoReingreso', 'periodoACosecha', 'cantidadPorHa',
  'unidad', 'stockActual', 'stockMinimo', 'moneda', 'tipoCambio', 'precioUnitario',
  'iva', 'proveedor', 'registroFitosanitario', 'observacion', 'activo'];

const VALID_TYPES = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro', ''];
const VALID_CURRENCIES = ['USD', 'CRC', 'EUR'];

function validateProducto(body, isCreate) {
  const errors = [];
  const s = (v) => typeof v === 'string' ? v : '';
  const checkStr = (key, label, max) => {
    if (body[key] !== undefined && s(body[key]).length > max)
      errors.push(`${label}: max ${max} characters`);
  };
  const checkNumRange = (key, label, min, max, exclusive) => {
    if (body[key] === undefined || body[key] === '' || body[key] === null) return;
    const n = Number(body[key]);
    if (isNaN(n)) { errors.push(`${label}: must be a number`); return; }
    if (n < min) errors.push(`${label}: min ${min}`);
    if (exclusive ? n >= max : n > max) errors.push(`${label}: must be less than ${max}`);
  };

  if (isCreate && !s(body.nombreComercial).trim())
    errors.push('nombreComercial is required');

  checkStr('idProducto',            'idProducto',           32);
  checkStr('nombreComercial',       'nombreComercial',     64);
  checkStr('ingredienteActivo',     'ingredienteActivo',   64);
  checkStr('proveedor',             'proveedor',           128);
  checkStr('registroFitosanitario', 'registroFitosanitario', 32);
  checkStr('observacion',           'observacion',         288);
  checkStr('plagaQueControla',      'plagaQueControla',    128);
  checkStr('unidad',                'unidad',              40);

  if (body.tipo !== undefined && !VALID_TYPES.includes(s(body.tipo)))
    errors.push('Invalid tipo');
  if (body.moneda !== undefined && !VALID_CURRENCIES.includes(s(body.moneda)))
    errors.push('Invalid moneda');

  checkNumRange('cantidadPorHa',    'cantidadPorHa',      0, 2048, true);
  checkNumRange('periodoReingreso', 'periodoReingreso',    0, 512,  true);
  checkNumRange('periodoACosecha',  'periodoACosecha',     0, 512,  true);
  checkNumRange('stockActual',      'stockActual',         0, 32768, true);
  checkNumRange('stockMinimo',      'stockMinimo',         0, 32768, true);
  checkNumRange('precioUnitario',   'precioUnitario',      0, 2097152, true);
  checkNumRange('tipoCambio',       'tipoCambio',          0, 2097152, true);
  checkNumRange('iva',              'iva',                 0, 100,  false);

  return errors;
}

// --- API ENDPOINTS: PRODUCTOS ---
router.get('/api/productos', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(productos);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch productos.', 500);
  }
});

router.post('/api/productos', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, true);
    if (valErrors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, valErrors.join('; '), 400);

    const { fechaIngreso, facturaNumero, registrarIngreso, ordenCompraId, ocPoNumber } = req.body;
    const fechaTs = fechaIngreso
      ? Timestamp.fromDate(new Date(fechaIngreso + 'T12:00:00'))
      : Timestamp.now();
    const producto = { ...pick(req.body, PRODUCT_FIELDS), fincaId: req.fincaId };

    // Check if a producto with the same idProducto already exists
    if (producto.idProducto) {
      const existing = await db.collection('productos')
        .where('fincaId', '==', req.fincaId)
        .where('idProducto', '==', producto.idProducto)
        .limit(1)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        const stockIngresado = parseFloat(producto.stockActual) || 0;
        if (registrarIngreso && stockIngresado > 0) {
          const batch = db.batch();
          batch.update(doc.ref, { stockActual: FieldValue.increment(stockIngresado) });
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: doc.id,
            idProducto: producto.idProducto || doc.data().idProducto || '',
            nombreComercial: producto.nombreComercial || doc.data().nombreComercial || '',
            cantidad: stockIngresado,
            unidad: producto.unidad || doc.data().unidad || '',
            precioUnitario: parseFloat(producto.precioUnitario) || 0,
            iva: parseFloat(producto.iva) || 0,
            proveedor: producto.proveedor || '',
            fecha: fechaTs,
            motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Ingreso de inventario',
            ...(facturaNumero  ? { facturaNumero }  : {}),
            ...(ordenCompraId  ? { ordenCompraId }  : {}),
            ...(ocPoNumber     ? { ocPoNumber }     : {}),
            fincaId: req.fincaId,
          });
          await batch.commit();
        } else {
          await doc.ref.update({ stockActual: FieldValue.increment(stockIngresado) });
        }
        const updated = { ...doc.data(), stockActual: (doc.data().stockActual || 0) + stockIngresado };
        return res.status(200).json({ id: doc.id, ...updated, merged: true });
      }
    }

    const stockIngresado = parseFloat(producto.stockActual) || 0;
    const newProdRef = db.collection('productos').doc();
    const batch = db.batch();
    batch.set(newProdRef, producto);
    if (stockIngresado > 0) {
      batch.set(db.collection('movimientos').doc(), {
        tipo: 'ingreso',
        productoId: newProdRef.id,
        idProducto: producto.idProducto || '',
        nombreComercial: producto.nombreComercial || '',
        cantidad: stockIngresado,
        unidad: producto.unidad || '',
        precioUnitario: parseFloat(producto.precioUnitario) || 0,
        iva: parseFloat(producto.iva) || 0,
        proveedor: producto.proveedor || '',
        fecha: fechaTs,
        motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Carga inicial',
        ...(facturaNumero  ? { facturaNumero }  : {}),
        ...(ordenCompraId  ? { ordenCompraId }  : {}),
        ...(ocPoNumber     ? { ocPoNumber }     : {}),
        fincaId: req.fincaId,
      });
    }
    await batch.commit();
    res.status(201).json({ id: newProdRef.id, ...producto, merged: false });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create producto.', 500);
  }
});

router.put('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, false);
    if (valErrors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, valErrors.join('; '), 400);

    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const productoData = pick(req.body, PRODUCT_FIELDS);
    await db.collection('productos').doc(id).update(productoData);
    res.status(200).json({ id, ...productoData });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update producto.', 500);
  }
});

router.delete('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Only products with zero stock can be deleted.', 409);
    }
    await db.collection('productos').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete producto.', 500);
  }
});

router.put('/api/productos/:id/inactivar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Only products with zero stock can be deactivated.', 409);
    }
    await db.collection('productos').doc(req.params.id).update({ activo: false });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to deactivate producto.', 500);
  }
});

router.put('/api/productos/:id/activar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('productos').doc(req.params.id).update({ activo: true });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to activate producto.', 500);
  }
});

// ── AI chat for editing productos ────────────────────────────────────────────
router.post('/api/productos/ai-editar', authenticate, async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Message is required.', 400);

    const snap = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const anthropicClient = getAnthropicClient();

    const productosTexto = productos.map(p =>
      `ID: ${p.id} | Código: ${p.idProducto || ''} | Nombre: ${p.nombreComercial || ''} | IngredienteActivo: ${p.ingredienteActivo || ''} | Tipo: ${p.tipo || ''} | Plaga: ${p.plagaQueControla || ''} | Dosis/Ha: ${p.cantidadPorHa ?? ''} | Unidad: ${p.unidad || ''} | Reingreso(h): ${p.periodoReingreso ?? ''} | Cosecha(días): ${p.periodoACosecha ?? ''} | Stock: ${p.stockActual ?? 0} | StockMin: ${p.stockMinimo ?? 0} | Precio: ${p.precioUnitario ?? ''} ${p.moneda || ''} | TipoCambio: ${p.tipoCambio ?? ''} | Proveedor: ${p.proveedor || ''}`
    ).join('\n');

    const systemPrompt = `Eres el asistente de inventario Aurora. Interpretas solicitudes en español para modificar productos agroquímicos.

CAMPOS DISPONIBLES (nombre técnico exacto):
- idProducto: Código del producto
- nombreComercial: Nombre comercial
- ingredienteActivo: Ingrediente activo
- tipo: Tipo — solo estos valores: "Herbicida", "Fungicida", "Insecticida", "Fertilizante", "Regulador de crecimiento", "Otro"
- plagaQueControla: Plaga o enfermedad que controla
- cantidadPorHa: Dosis por hectárea (número)
- unidad: Unidad de medida (L, kg, cc, g, mL, etc.)
- periodoReingreso: Período de reingreso en horas (número entero)
- periodoACosecha: Período a cosecha en días (número entero)
- stockMinimo: Stock mínimo (número)
- precioUnitario: Precio unitario (número)
- moneda: Moneda — solo: "USD", "CRC", "EUR"
- tipoCambio: Tipo de cambio (número)
- proveedor: Nombre del proveedor

CAMPO ESPECIAL (ajuste de inventario con nota obligatoria):
- stockActual: Stock actual (número) — devuélvelo en "stockAdjustments", NUNCA en "changes"

REGLAS:
1. Identifica el/los productos por nombre aproximado, código o ingrediente activo.
2. Solo incluye los cambios explícitamente solicitados.
3. Si un producto no se encuentra, explícalo en "error".
4. Si la solicitud es ambigua (varios productos podrían coincidir), pide aclaración en "error".
5. Normaliza el campo "tipo" al valor válido más cercano.

Responde SOLO con JSON válido, sin texto adicional ni bloques de código:
{
  "mensaje": "texto breve describiendo los cambios o el error",
  "changes": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "field": "campoTecnico", "oldValue": "valor_actual", "newValue": "nuevo_valor" }
  ],
  "stockAdjustments": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "stockActual": 0, "newStock": 0 }
  ],
  "error": null
}`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Inventario actual:\n${productosTexto}\n\nSolicitud: ${mensaje}` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Respuesta de IA inválida.');
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('Error en ai-editar productos:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, err.message || 'Failed to process AI request.', 500);
  }
});

// --- API ENDPOINTS: INVENTORY ADJUSTMENT (PHYSICAL COUNT) ---
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
    res.status(200).json({ ajustados: movimientosCreados.length, movimientos: movimientosCreados });
  } catch (error) {
    console.error('Error in inventory adjustment:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process inventory adjustment.', 500);
  }
});

// --- API ENDPOINTS: CONFIRMED INTAKE (ProductIngreso → atomic reception) ---
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
