const { Router } = require('express');
const { db, admin, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: BODEGAS ---
// A "bodega" is a typed warehouse. The `tipo` field determines which frontend
// component is rendered (agroquimicos, combustibles, herramientas, generica…).
// If the finca has no bodegas, the agroquímicos one is auto-seeded.
router.get('/api/bodegas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('bodegas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('orden')
      .get();

    if (!snap.empty) {
      return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    // Auto-seed: first execution per finca
    const now = Timestamp.now();
    const agroquimicos = { nombre: 'Agroquímicos', tipo: 'agroquimicos', icono: 'FiDroplet', orden: 1, fincaId: req.fincaId, creadoEn: now };
    const combustibles = { nombre: 'Combustibles',  tipo: 'combustibles',  icono: 'FiDroplet', orden: 2, fincaId: req.fincaId, creadoEn: now };
    const [refAgroq, refComb] = await Promise.all([
      db.collection('bodegas').add(agroquimicos),
      db.collection('bodegas').add(combustibles),
    ]);
    return res.json([
      { id: refAgroq.id, ...agroquimicos },
      { id: refComb.id,  ...combustibles },
    ]);
  } catch (err) {
    console.error('[bodegas GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch bodegas.', 500);
  }
});

router.post('/api/bodegas', authenticate, async (req, res) => {
  try {
    const { nombre, icono } = req.body;
    if (!nombre?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);

    // Calculate order: max + 1
    const snap = await db.collection('bodegas').where('fincaId', '==', req.fincaId).get();
    const maxOrden = snap.empty ? 1 : Math.max(...snap.docs.map(d => d.data().orden || 0));
    const bodega = {
      nombre: nombre.trim(),
      tipo: 'generica',
      icono: icono || 'FiBox',
      orden: maxOrden + 1,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('bodegas').add(bodega);
    return res.status(201).json({ id: docRef.id, ...bodega });
  } catch (err) {
    console.error('[bodegas POST]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create bodega.', 500);
  }
});

router.put('/api/bodegas/:id', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'System bodegas cannot be edited.', 403);
    }
    const { nombre, icono } = req.body;
    const updates = {};
    if (nombre?.trim()) updates.nombre = nombre.trim();
    if (icono) updates.icono = icono;
    await check.doc.ref.update(updates);
    return res.json({ id: req.params.id, ...check.doc.data(), ...updates });
  } catch (err) {
    console.error('[bodegas PUT]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update bodega.', 500);
  }
});

router.delete('/api/bodegas/:id', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'System bodegas cannot be deleted.', 403);
    }
    // Only delete if it has no items
    const itemsSnap = await db.collection('bodega_items')
      .where('bodegaId', '==', req.params.id).limit(1).get();
    if (!itemsSnap.empty) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot delete a bodega that still has items. Remove all items first.', 400);
    }
    await check.doc.ref.delete();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[bodegas DELETE]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete bodega.', 500);
  }
});

// --- API ENDPOINTS: BODEGA ITEMS (inventario de bodegas genéricas) ---

router.get('/api/bodegas/:id/items', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const snap = await db.collection('bodega_items')
      .where('bodegaId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('[bodega_items GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch items.', 500);
  }
});

router.post('/api/bodegas/:id/items', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const { nombre, unidad, stockActual, stockMinimo, descripcion, total, moneda } = req.body;
    if (!nombre?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Item name is required.', 400);
    if (nombre.trim().length > 200) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name too long (max 200).', 400);
    if (descripcion && String(descripcion).length > 500) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Description too long (max 500).', 400);
    if (unidad && String(unidad).trim().length > 50) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Unit too long (max 50).', 400);
    const safeFloat = (v) => { const n = parseFloat(v); return (isNaN(n) || !isFinite(n) || n < 0) ? 0 : n; };
    const parsedTotal = total !== undefined && total !== '' ? parseFloat(total) : null;
    if (parsedTotal !== null && (isNaN(parsedTotal) || !isFinite(parsedTotal) || parsedTotal < 0)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Total must be a valid number >= 0.', 400);
    }
    const MONEDAS_VALIDAS = ['USD', 'CRC', 'EUR'];
    const item = {
      bodegaId: req.params.id,
      fincaId: req.fincaId,
      nombre: nombre.trim().slice(0, 200),
      unidad: (unidad?.trim() || 'unidad').slice(0, 50),
      stockActual: safeFloat(stockActual),
      stockMinimo: safeFloat(stockMinimo),
      descripcion: (descripcion?.trim() || '').slice(0, 500),
      total: parsedTotal,
      moneda: MONEDAS_VALIDAS.includes(moneda?.trim()) ? moneda.trim() : 'CRC',
      activo: true,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('bodega_items').add(item);
    return res.status(201).json({ id: docRef.id, ...item });
  } catch (err) {
    console.error('[bodega_items POST]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create item.', 500);
  }
});

router.put('/api/bodegas/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
    }
    const allowed = ['nombre', 'unidad', 'stockMinimo', 'descripcion', 'activo', 'total', 'moneda'];
    const updates = pick(req.body, allowed);
    if (updates.nombre !== undefined) {
      updates.nombre = String(updates.nombre).trim().slice(0, 200);
      if (!updates.nombre) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name cannot be empty.', 400);
    }
    if (updates.unidad !== undefined) updates.unidad = String(updates.unidad).trim().slice(0, 50);
    if (updates.descripcion !== undefined) updates.descripcion = String(updates.descripcion).trim().slice(0, 500);
    if (updates.stockMinimo !== undefined) {
      const v = parseFloat(updates.stockMinimo);
      updates.stockMinimo = (isNaN(v) || !isFinite(v) || v < 0) ? 0 : v;
    }
    if (updates.total !== undefined) {
      if (updates.total === '' || updates.total === null) { updates.total = null; }
      else {
        const v = parseFloat(updates.total);
        if (isNaN(v) || !isFinite(v) || v < 0) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Total must be a valid number >= 0.', 400);
        updates.total = v;
      }
    }
    if (updates.moneda !== undefined) {
      const MONEDAS_VALIDAS = ['USD', 'CRC', 'EUR'];
      if (!MONEDAS_VALIDAS.includes(updates.moneda)) updates.moneda = 'CRC';
    }
    await itemDoc.ref.update(updates);
    return res.json({ id: req.params.itemId, ...itemDoc.data(), ...updates });
  } catch (err) {
    console.error('[bodega_items PUT]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update item.', 500);
  }
});

router.delete('/api/bodegas/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
    }
    // Only delete if it has no movements
    const movsSnap = await db.collection('bodega_movimientos')
      .where('itemId', '==', req.params.itemId).limit(1).get();
    if (!movsSnap.empty) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot delete an item with registered movements.', 400);
    }
    await itemDoc.ref.delete();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[bodega_items DELETE]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete item.', 500);
  }
});

// --- API ENDPOINTS: BODEGA MOVIMIENTOS ---

router.get('/api/bodegas/:id/movimientos', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const snap = await db.collection('bodega_movimientos')
      .where('bodegaId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate().toISOString() })));
  } catch (err) {
    console.error('[bodega_movimientos GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch movements.', 500);
  }
});

router.post('/api/bodegas/:id/movimientos', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);

    const { itemId, tipo, cantidad, nota,
            loteId, loteNombre, laborId, laborNombre,
            activoId, activoNombre, operarioId, operarioNombre,
            factura, oc, total,
            imageBase64, mediaType } = req.body;
    if (!itemId || !tipo || !cantidad) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'itemId, tipo and cantidad are required.', 400);
    }
    if (!['entrada', 'salida'].includes(tipo)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'tipo must be "entrada" or "salida".', 400);
    }
    const cantNum = parseFloat(cantidad);
    if (isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Quantity must be a positive finite number.', 400);
    }
    // Validate string lengths
    if (nota && String(nota).length > 500) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Note too long (max 500).', 400);
    if (factura && String(factura).length > 100) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invoice too long (max 100).', 400);
    if (oc && String(oc).length > 100) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'OC too long (max 100).', 400);
    // Validar total
    const parsedTotal = total !== undefined && total !== '' ? parseFloat(total) : null;
    if (parsedTotal !== null && (isNaN(parsedTotal) || !isFinite(parsedTotal) || parsedTotal < 0)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Total must be a valid number >= 0.', 400);
    }
    // Validate base64 size (~5 MB in base64 ≈ 6.67 MB string)
    if (imageBase64 && imageBase64.length > 7 * 1024 * 1024) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Attachment too large (max 5 MB).', 400);
    }

    // ── Upload attached invoice to Firebase Storage (if provided) ──────────
    let facturaUrl = null;
    if (imageBase64) {
      const { randomUUID } = require('crypto');
      const bucket = admin.storage().bucket();
      const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      const safeMime = ALLOWED_MEDIA.includes(mediaType) ? mediaType : 'image/jpeg';
      const ext = safeMime.includes('png') ? 'png' : safeMime.includes('pdf') ? 'pdf' : safeMime.includes('webp') ? 'webp' : 'jpg';
      const fileName = `bodega_movimientos/${req.params.id}_${Date.now()}.${ext}`;
      const file = bucket.file(fileName);
      const token = randomUUID();
      await file.save(Buffer.from(imageBase64, 'base64'), {
        contentType: safeMime,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      const encodedPath = encodeURIComponent(fileName);
      facturaUrl = isEmulator
        ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
        : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
    }

    // ── Atomic transaction: verify stock + update + register movement ──────
    const movRef = db.collection('bodega_movimientos').doc();
    const itemRef = db.collection('bodega_items').doc(itemId);
    const result = await db.runTransaction(async (t) => {
      const itemDoc = await t.get(itemRef);
      if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
        throw Object.assign(new Error('Ítem no encontrado.'), { statusCode: 404 });
      }
      const stockAntes = itemDoc.data().stockActual || 0;
      if (tipo === 'salida' && stockAntes < cantNum) {
        throw Object.assign(
          new Error(`Stock insuficiente. Disponible: ${stockAntes} ${itemDoc.data().unidad}.`),
          { statusCode: 400 }
        );
      }

      const delta = tipo === 'entrada' ? cantNum : -cantNum;
      const stockDespues = stockAntes + delta;

      const movData = {
        bodegaId: req.params.id,
        fincaId: req.fincaId,
        itemId,
        itemNombre: itemDoc.data().nombre,
        tipo,
        cantidad: cantNum,
        stockAntes,
        stockDespues,
        nota: (nota?.trim() || '').slice(0, 500),
        loteId: loteId || '',
        loteNombre: (loteNombre || '').slice(0, 200),
        laborId: laborId || '',
        laborNombre: (laborNombre || '').slice(0, 200),
        activoId: activoId || '',
        activoNombre: (activoNombre || '').slice(0, 200),
        operarioId: operarioId || '',
        operarioNombre: (operarioNombre || '').slice(0, 200),
        factura: (factura?.trim() || '').slice(0, 100),
        oc: (oc?.trim() || '').slice(0, 100),
        total: parsedTotal,
        facturaUrl,
        usuarioId: req.uid,
        timestamp: Timestamp.now(),
      };

      const itemUpdateData = { stockActual: FieldValue.increment(delta) };
      let totalSalida = null;
      if (tipo === 'entrada' && parsedTotal !== null && parsedTotal > 0) {
        itemUpdateData.total = FieldValue.increment(parsedTotal);
      } else if (tipo === 'salida') {
        const itemTotal = itemDoc.data().total;
        if (itemTotal != null && itemTotal > 0 && stockAntes > 0) {
          const valorSalida = (itemTotal / stockAntes) * cantNum;
          totalSalida = valorSalida;
          itemUpdateData.total = FieldValue.increment(-valorSalida);
        }
      }
      movData.totalSalida = totalSalida;

      t.set(movRef, movData);
      t.update(itemRef, itemUpdateData);
      return movData;
    });

    return res.status(201).json({ id: movRef.id, ...result, timestamp: result.timestamp.toDate().toISOString() });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    console.error('[bodega_movimientos POST]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register movement.', 500);
  }
});

module.exports = router;
