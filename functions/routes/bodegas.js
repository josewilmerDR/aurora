const { Router } = require('express');
const { db, admin, Timestamp, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

// --- API ENDPOINTS: BODEGAS ---
// Una "bodega" es un almacén tipado. El campo `tipo` determina qué componente
// frontend se renderiza (agroquimicos, combustibles, herramientas, generico…).
// Si la finca no tiene ninguna bodega, se siembra automáticamente la de agroquímicos.
router.get('/api/bodegas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('bodegas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('orden')
      .get();

    if (!snap.empty) {
      return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }

    // Auto-seed: primera ejecución por finca
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
    return res.status(500).json({ message: 'Error al obtener bodegas.' });
  }
});

router.post('/api/bodegas', authenticate, async (req, res) => {
  try {
    const { nombre, icono } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre es requerido.' });

    // Calcular orden: max + 1
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
    return res.status(500).json({ message: 'Error al crear bodega.' });
  }
});

router.put('/api/bodegas/:id', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return res.status(403).json({ message: 'Esta bodega es del sistema y no se puede editar.' });
    }
    const { nombre, icono } = req.body;
    const updates = {};
    if (nombre?.trim()) updates.nombre = nombre.trim();
    if (icono) updates.icono = icono;
    await check.doc.ref.update(updates);
    return res.json({ id: req.params.id, ...check.doc.data(), ...updates });
  } catch (err) {
    console.error('[bodegas PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar bodega.' });
  }
});

router.delete('/api/bodegas/:id', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    if (['agroquimicos', 'combustibles'].includes(check.doc.data().tipo)) {
      return res.status(403).json({ message: 'Esta bodega es del sistema y no se puede eliminar.' });
    }
    // Solo eliminar si no tiene items
    const itemsSnap = await db.collection('bodega_items')
      .where('bodegaId', '==', req.params.id).limit(1).get();
    if (!itemsSnap.empty) {
      return res.status(400).json({ message: 'No se puede eliminar una bodega con productos. Elimine primero todos los productos.' });
    }
    await check.doc.ref.delete();
    return res.json({ message: 'Bodega eliminada.' });
  } catch (err) {
    console.error('[bodegas DELETE]', err);
    return res.status(500).json({ message: 'Error al eliminar bodega.' });
  }
});

// --- API ENDPOINTS: BODEGA ITEMS (inventario de bodegas genéricas) ---

router.get('/api/bodegas/:id/items', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const snap = await db.collection('bodega_items')
      .where('bodegaId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('[bodega_items GET]', err);
    return res.status(500).json({ message: 'Error al obtener items.' });
  }
});

router.post('/api/bodegas/:id/items', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const { nombre, unidad, stockActual, stockMinimo, descripcion, total } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre del ítem es requerido.' });
    const item = {
      bodegaId: req.params.id,
      fincaId: req.fincaId,
      nombre: nombre.trim(),
      unidad: unidad?.trim() || 'unidad',
      stockActual: parseFloat(stockActual) || 0,
      stockMinimo: parseFloat(stockMinimo) || 0,
      descripcion: descripcion?.trim() || '',
      total: total !== undefined && total !== '' ? parseFloat(total) : null,
      activo: true,
      creadoEn: Timestamp.now(),
    };
    const docRef = await db.collection('bodega_items').add(item);
    return res.status(201).json({ id: docRef.id, ...item });
  } catch (err) {
    console.error('[bodega_items POST]', err);
    return res.status(500).json({ message: 'Error al crear ítem.' });
  }
});

router.put('/api/bodegas/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
      return res.status(404).json({ message: 'Ítem no encontrado.' });
    }
    const allowed = ['nombre', 'unidad', 'stockMinimo', 'descripcion', 'activo', 'total'];
    const updates = pick(req.body, allowed);
    if (updates.nombre) updates.nombre = updates.nombre.trim();
    if (updates.stockMinimo !== undefined) updates.stockMinimo = parseFloat(updates.stockMinimo) || 0;
    if (updates.total !== undefined) updates.total = updates.total !== '' && updates.total !== null ? parseFloat(updates.total) : null;
    await itemDoc.ref.update(updates);
    return res.json({ id: req.params.itemId, ...itemDoc.data(), ...updates });
  } catch (err) {
    console.error('[bodega_items PUT]', err);
    return res.status(500).json({ message: 'Error al actualizar ítem.' });
  }
});

router.delete('/api/bodegas/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const itemDoc = await db.collection('bodega_items').doc(req.params.itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
      return res.status(404).json({ message: 'Ítem no encontrado.' });
    }
    // Solo eliminar si no tiene movimientos
    const movsSnap = await db.collection('bodega_movimientos')
      .where('itemId', '==', req.params.itemId).limit(1).get();
    if (!movsSnap.empty) {
      return res.status(400).json({ message: 'No se puede eliminar un ítem con movimientos registrados.' });
    }
    await itemDoc.ref.delete();
    return res.json({ message: 'Ítem eliminado.' });
  } catch (err) {
    console.error('[bodega_items DELETE]', err);
    return res.status(500).json({ message: 'Error al eliminar ítem.' });
  }
});

// --- API ENDPOINTS: BODEGA MOVIMIENTOS ---

router.get('/api/bodegas/:id/movimientos', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });
    const snap = await db.collection('bodega_movimientos')
      .where('bodegaId', '==', req.params.id)
      .where('fincaId', '==', req.fincaId)
      .orderBy('timestamp', 'desc')
      .limit(500)
      .get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data(), timestamp: d.data().timestamp?.toDate().toISOString() })));
  } catch (err) {
    console.error('[bodega_movimientos GET]', err);
    return res.status(500).json({ message: 'Error al obtener movimientos.' });
  }
});

router.post('/api/bodegas/:id/movimientos', authenticate, async (req, res) => {
  try {
    const check = await verifyOwnership('bodegas', req.params.id, req.fincaId);
    if (!check.ok) return res.status(check.status).json({ message: check.message });

    const { itemId, tipo, cantidad, nota,
            loteId, loteNombre, laborId, laborNombre,
            activoId, activoNombre, operarioId, operarioNombre,
            factura, oc, total,
            imageBase64, mediaType } = req.body;
    if (!itemId || !tipo || !cantidad) {
      return res.status(400).json({ message: 'itemId, tipo y cantidad son requeridos.' });
    }
    if (!['entrada', 'salida'].includes(tipo)) {
      return res.status(400).json({ message: 'tipo debe ser "entrada" o "salida".' });
    }
    const cantNum = parseFloat(cantidad);
    if (isNaN(cantNum) || cantNum <= 0) {
      return res.status(400).json({ message: 'La cantidad debe ser un número positivo.' });
    }

    const itemDoc = await db.collection('bodega_items').doc(itemId).get();
    if (!itemDoc.exists || itemDoc.data().bodegaId !== req.params.id) {
      return res.status(404).json({ message: 'Ítem no encontrado.' });
    }
    const stockAntes = itemDoc.data().stockActual || 0;
    if (tipo === 'salida' && stockAntes < cantNum) {
      return res.status(400).json({ message: `Stock insuficiente. Disponible: ${stockAntes} ${itemDoc.data().unidad}.` });
    }

    const delta = tipo === 'entrada' ? cantNum : -cantNum;
    const stockDespues = stockAntes + delta;

    // Transacción atómica: actualizar stock + registrar movimiento
    const movRef = db.collection('bodega_movimientos').doc();
    // ── Subir factura adjunta a Firebase Storage (si se proveyó) ────────────
    let facturaUrl = null;
    if (imageBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : (mediaType || '').includes('pdf') ? 'pdf' : 'jpg';
        const fileName = `bodega_movimientos/${req.params.id}_${Date.now()}.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(imageBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        facturaUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Storage upload failed (bodega movimiento):', storageErr.message);
      }
    }

    const movData = {
      bodegaId: req.params.id,
      fincaId: req.fincaId,
      itemId,
      itemNombre: itemDoc.data().nombre,
      tipo,
      cantidad: cantNum,
      stockAntes,
      stockDespues,
      nota: nota?.trim() || '',
      loteId: loteId || '',
      loteNombre: loteNombre || '',
      laborId: laborId || '',
      laborNombre: laborNombre || '',
      activoId: activoId || '',
      activoNombre: activoNombre || '',
      operarioId: operarioId || '',
      operarioNombre: operarioNombre || '',
      factura: factura?.trim() || '',
      oc: oc?.trim() || '',
      total: total !== undefined && total !== '' ? parseFloat(total) : null,
      facturaUrl,
      usuarioId: req.uid,
      timestamp: Timestamp.now(),
    };

    const itemUpdateData = { stockActual: FieldValue.increment(delta) };
    let totalSalida = null;
    if (tipo === 'entrada' && total !== undefined && total !== '') {
      const totalNum = parseFloat(total);
      if (!isNaN(totalNum) && totalNum > 0) {
        itemUpdateData.total = FieldValue.increment(totalNum);
      }
    } else if (tipo === 'salida') {
      const itemTotal = itemDoc.data().total;
      if (itemTotal != null && itemTotal > 0 && stockAntes > 0) {
        const valorSalida = (itemTotal / stockAntes) * cantNum;
        totalSalida = valorSalida;
        itemUpdateData.total = FieldValue.increment(-valorSalida);
      }
    }
    movData.totalSalida = totalSalida;

    const batch = db.batch();
    batch.set(movRef, movData);
    batch.update(itemDoc.ref, itemUpdateData);
    await batch.commit();

    return res.status(201).json({ id: movRef.id, ...movData, timestamp: movData.timestamp.toDate().toISOString() });
  } catch (err) {
    console.error('[bodega_movimientos POST]', err);
    return res.status(500).json({ message: 'Error al registrar movimiento.' });
  }
});

module.exports = router;
