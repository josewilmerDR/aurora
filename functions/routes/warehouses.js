const { Router } = require('express');
const { db, admin, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE, writeFeedEvent } = require('../lib/helpers');
const { sendApiError, ERROR_CODES, ApiError, handleApiError } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { buildItemCreate, buildItemUpdate, buildMovementCreate } = require('./warehouses.schemas');

const router = Router();

// Role gate: warehouse data is operational inventory. Item/movement reads and
// writes require `encargado` (matches the frontend route gate); item deletes
// require `supervisor`. Managing the bodegas themselves (create/edit/delete) is
// an admin operation (`administrador`), matching the /admin/bodegas route gate.
// Backend is the source of truth — UI gating is secondary.
const requireRole = (minRole) => (req, res, next) =>
  hasMinRoleBE(req.userRole, minRole)
    ? next()
    : sendApiError(res, ERROR_CODES.FORBIDDEN, `Requires ${minRole} role or higher.`, 403);

// --- API ENDPOINTS: BODEGAS ---
// A "bodega" is a typed warehouse. The `tipo` field determines which frontend
// component is rendered (agroquimicos, combustibles, herramientas, generica…).
// If the finca has no bodegas, the agroquímicos one is auto-seeded.
router.get('/api/bodegas', authenticate, requireRole('encargado'), async (req, res) => {
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

router.post('/api/bodegas', authenticate, requireRole('administrador'), async (req, res) => {
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

router.put('/api/bodegas/:id', authenticate, requireRole('administrador'), async (req, res) => {
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

router.delete('/api/bodegas/:id', authenticate, requireRole('administrador'), async (req, res) => {
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
    const prev = check.doc.data();
    await check.doc.ref.delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BODEGA_DELETE,
      target: { type: 'bodega', id: req.params.id },
      metadata: { nombre: prev.nombre || null, tipo: prev.tipo || null },
      severity: SEVERITY.WARNING,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[bodegas DELETE]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete bodega.', 500);
  }
});

// --- API ENDPOINTS: BODEGA ITEMS (inventario de bodegas genéricas) ---

router.get('/api/bodegas/:id/items', authenticate, requireRole('encargado'), async (req, res) => {
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

router.post('/api/bodegas/:id/items', authenticate, requireRole('encargado'), rateLimit('bodega-write', 'write'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const { data, error } = buildItemCreate(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const item = {
      bodegaId: req.params.id,
      fincaId: req.fincaId,
      ...data,
      activo: true,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('bodega_items').add(item);
    // Trazabilidad del asiento inicial: crear un ítem ya con stock o valor
    // siembra inventario sin un movimiento que lo respalde. Se deja constancia
    // en el feed (las entradas/salidas posteriores ya lo hacen).
    if ((data.stockActual || 0) > 0 || (data.total || 0) > 0) {
      writeFeedEvent({
        fincaId: req.fincaId,
        uid: req.uid,
        userEmail: req.userEmail,
        eventType: 'bodega_item',
        activityType: 'create',
        title: `Alta de ítem ${data.nombre} (stock inicial ${data.stockActual || 0})`,
      });
    }
    return res.status(201).json({ id: docRef.id, ...item });
  } catch (err) {
    console.error('[bodega_items POST]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create item.', 500);
  }
});

router.put('/api/bodegas/:id/items/:itemId', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id || itemDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
    }
    const { data: updates, error } = buildItemUpdate(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const prev = itemDoc.data();
    await itemDoc.ref.update(updates);
    // Cambiar el valor contable (`total`) o dar de baja lógica el ítem
    // (`activo:false`, que lo oculta de la UI sin borrarlo) son ediciones de
    // peso que antes no dejaban rastro. Se registran en el feed; el borrado
    // físico irreversible sigue yendo al audit log.
    const totalChanged = updates.total !== undefined && updates.total !== prev.total;
    const activoChanged = updates.activo !== undefined && updates.activo !== prev.activo;
    if (totalChanged || activoChanged) {
      writeFeedEvent({
        fincaId: req.fincaId,
        uid: req.uid,
        userEmail: req.userEmail,
        eventType: 'bodega_item',
        activityType: activoChanged && updates.activo === false ? 'baja' : 'update',
        title: activoChanged && updates.activo === false
          ? `Baja de ítem ${prev.nombre}`
          : `Ajuste de ítem ${prev.nombre}`,
      });
    }
    return res.json({ id: req.params.itemId, ...prev, ...updates });
  } catch (err) {
    console.error('[bodega_items PUT]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update item.', 500);
  }
});

router.delete('/api/bodegas/:id/items/:itemId', authenticate, requireRole('supervisor'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id || itemDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
    }
    // Only delete if it has no movements
    const movsSnap = await db.collection('bodega_movimientos')
      .where('itemId', '==', req.params.itemId).limit(1).get();
    if (!movsSnap.empty) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot delete an item with registered movements.', 400);
    }
    const prev = itemDoc.data();
    await itemDoc.ref.delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.BODEGA_ITEM_DELETE,
      target: { type: 'bodega_item', id: req.params.itemId },
      metadata: { nombre: prev.nombre || null, unidad: prev.unidad || null, bodegaId: req.params.id },
      severity: SEVERITY.WARNING,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[bodega_items DELETE]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete item.', 500);
  }
});

// --- API ENDPOINTS: BODEGA MOVIMIENTOS ---

router.get('/api/bodegas/:id/movimientos', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const snap = await db.collection('bodega_movimientos')
      .where('bodegaId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    return res.json(snap.docs.map(d => {
      // No exponer la ruta interna de Storage en el listado; el adjunto se pide
      // on-demand vía GET .../factura. `tieneFactura` basta para pintar el link.
      const { facturaPath, ...data } = d.data();
      return { id: d.id, ...data, timestamp: data.timestamp?.toDate().toISOString() };
    }));
  } catch (err) {
    console.error('[bodega_movimientos GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch movements.', 500);
  }
});

// On-demand signed URL for a movement's attached invoice (H8). Re-verifies
// role + finca + bodega ownership on every access, so a leaked link cannot
// outlive the short expiry and authz is enforced per-request (unlike the old
// permanent download-token URL embedded in the doc).
router.get('/api/bodegas/:id/movimientos/:movId/factura', authenticate, requireRole('encargado'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);
    const movDoc = await db.collection('bodega_movimientos').doc(req.params.movId).get();
    if (!movDoc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Movement not found.', 404);
    const mov = movDoc.data();
    if (mov.fincaId !== req.fincaId || mov.bodegaId !== req.params.id) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Movement not found.', 404);
    }
    // Legacy docs (pre-H8) carry a permanent token URL instead of a path.
    if (!mov.facturaPath) {
      if (mov.facturaUrl) return res.json({ url: mov.facturaUrl });
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'No attachment for this movement.', 404);
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(mov.facturaPath);
    const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (isEmulator) {
      // getSignedUrl no funciona en el emulador (sin service account). Fallback:
      // construir la URL con el download token guardado en metadata.
      const [meta] = await file.getMetadata();
      const token = meta.metadata?.firebaseStorageDownloadTokens;
      const encodedPath = encodeURIComponent(mov.facturaPath);
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
  } catch (err) {
    console.error('[bodega_movimientos factura GET]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to resolve attachment.', 500);
  }
});

// Resolve a referenced doc's display name server-side, validating tenancy.
// Returns '' (and the caller clears the id) when the id is empty, the doc does
// not exist, or it belongs to another finca — so a movement never persists a
// client-supplied name decoupled from a real, in-finca reference.
async function resolveRefName(collection, id, fincaId, buildName) {
  if (!id) return '';
  const doc = await db.collection(collection).doc(id).get();
  if (!doc.exists || doc.data().fincaId !== fincaId) return '';
  return (buildName(doc.data()) || '').slice(0, 200);
}

router.post('/api/bodegas/:id/movimientos', authenticate, requireRole('encargado'), rateLimit('bodega-mov', 'write'), async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return sendApiError(res, check.code, check.message, check.status);

    const { data, error } = buildMovementCreate(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const { itemId, tipo, cantidad: cantNum, nota, factura, oc, total: parsedTotal,
            loteId, laborId, activoId, operarioId, clientMovId, imageBase64, mediaType } = data;

    // ── Resolve reference names server-side (anti-tampering, H3) ────────────
    // Cualquier *Nombre enviado por el cliente se descarta; el nombre se deriva
    // del doc real validando que pertenezca a la finca. Si la referencia es
    // inválida, se limpia también el id para no dejar un id colgante.
    const [loteNombre, laborNombre, activoNombre, operarioNombre] = await Promise.all([
      resolveRefName('lotes', loteId, req.fincaId, (d) => d.nombreLote),
      resolveRefName('labores', laborId, req.fincaId, (d) => `${d.codigo ? d.codigo + ' - ' : ''}${d.descripcion || ''}`),
      resolveRefName('maquinaria', activoId, req.fincaId, (d) => d.descripcion),
      resolveRefName('users', operarioId, req.fincaId, (d) => d.nombre),
    ]);
    const refs = {
      loteId: loteNombre ? loteId : '', loteNombre,
      laborId: laborNombre ? laborId : '', laborNombre,
      activoId: activoNombre ? activoId : '', activoNombre,
      operarioId: operarioNombre ? operarioId : '', operarioNombre,
    };

    // ── Upload attached invoice to Firebase Storage (if provided) ──────────
    // Se guarda SOLO el storage path (no una URL pública con token permanente).
    // La factura se sirve on-demand vía GET .../factura, que emite una signed
    // URL de corta vida tras re-verificar rol + finca (H8).
    let facturaPath = null;
    if (imageBase64) {
      const { randomUUID } = require('crypto');
      const bucket = admin.storage().bucket();
      const safeMime = mediaType; // already whitelisted by the schema
      const ext = safeMime.includes('png') ? 'png' : safeMime.includes('pdf') ? 'pdf' : safeMime.includes('webp') ? 'webp' : 'jpg';
      const fileName = `bodega_movimientos/${req.params.id}_${Date.now()}_${randomUUID()}.${ext}`;
      const file = bucket.file(fileName);
      await file.save(Buffer.from(imageBase64, 'base64'), {
        contentType: safeMime,
        // Token de descarga para el fallback del emulador (getSignedUrl no
        // funciona sin credenciales de service account en local).
        metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
      });
      facturaPath = fileName;
    }

    // ── Atomic transaction: verify stock + update + register movement ──────
    // Idempotencia (H10): si el cliente envía clientMovId, se usa como doc ID;
    // un reintento con el mismo id encuentra el doc ya escrito y devuelve el
    // existente sin volver a mover stock.
    const movRef = clientMovId
      ? db.collection('bodega_movimientos').doc(clientMovId)
      : db.collection('bodega_movimientos').doc();
    const itemRef = db.collection('bodega_items').doc(itemId);
    let duplicate = false;
    const result = await db.runTransaction(async (t) => {
      if (clientMovId) {
        const existing = await t.get(movRef);
        if (existing.exists) { duplicate = true; return existing.data(); }
      }
      const itemDoc = await t.get(itemRef);
      if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id || itemDoc.data().fincaId !== req.fincaId) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, 'Item not found.', 404);
      }
      const stockAntes = itemDoc.data().stockActual || 0;
      if (tipo === 'salida' && stockAntes < cantNum) {
        throw new ApiError(ERROR_CODES.INSUFFICIENT_STOCK, `Insufficient stock. Available: ${stockAntes}.`, 409);
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
        nota,
        ...refs,
        factura,
        oc,
        total: parsedTotal,
        facturaPath,
        // Flag liviano para que el listado sepa que hay adjunto sin exponer la
        // ruta de Storage. La URL real se pide on-demand al endpoint /factura.
        tieneFactura: !!facturaPath,
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

    // Business trail in the finca feed (H7). Skipped on idempotent replays so a
    // retry doesn't double-post. Audit log is reserved for irreversible deletes.
    if (!duplicate) {
      writeFeedEvent({
        fincaId: req.fincaId,
        uid: req.uid,
        userEmail: req.userEmail,
        eventType: 'bodega_movimiento',
        activityType: tipo,
        title: `${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${result.cantidad} en ${result.itemNombre}`,
      });
    }

    const ts = result.timestamp?.toDate ? result.timestamp.toDate().toISOString() : result.timestamp;
    return res.status(duplicate ? 200 : 201).json({ id: movRef.id, ...result, timestamp: ts });
  } catch (err) {
    return handleApiError(res, err, 'Failed to register movement.');
  }
});

module.exports = router;
