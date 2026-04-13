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
    const { nombre, unidad, stockActual, stockMinimo, descripcion, total, moneda } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ message: 'El nombre del ítem es requerido.' });
    if (nombre.trim().length > 200) return res.status(400).json({ message: 'Nombre demasiado largo (máx 200).' });
    if (descripcion && String(descripcion).length > 500) return res.status(400).json({ message: 'Descripción demasiado larga (máx 500).' });
    if (unidad && String(unidad).trim().length > 50) return res.status(400).json({ message: 'Unidad demasiado larga (máx 50).' });
    const safeFloat = (v) => { const n = parseFloat(v); return (isNaN(n) || !isFinite(n) || n < 0) ? 0 : n; };
    const parsedTotal = total !== undefined && total !== '' ? parseFloat(total) : null;
    if (parsedTotal !== null && (isNaN(parsedTotal) || !isFinite(parsedTotal) || parsedTotal < 0)) {
      return res.status(400).json({ message: 'Total debe ser un número válido ≥ 0.' });
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
    const allowed = ['nombre', 'unidad', 'stockMinimo', 'descripcion', 'activo', 'total', 'moneda'];
    const updates = pick(req.body, allowed);
    if (updates.nombre !== undefined) {
      updates.nombre = String(updates.nombre).trim().slice(0, 200);
      if (!updates.nombre) return res.status(400).json({ message: 'El nombre no puede estar vacío.' });
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
        if (isNaN(v) || !isFinite(v) || v < 0) return res.status(400).json({ message: 'Total debe ser un número válido ≥ 0.' });
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
    if (isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      return res.status(400).json({ message: 'La cantidad debe ser un número positivo finito.' });
    }
    // Validar longitud de strings
    if (nota && String(nota).length > 500) return res.status(400).json({ message: 'Nota demasiado larga (máx 500).' });
    if (factura && String(factura).length > 100) return res.status(400).json({ message: 'Factura demasiado larga (máx 100).' });
    if (oc && String(oc).length > 100) return res.status(400).json({ message: 'OC demasiado larga (máx 100).' });
    // Validar total
    const parsedTotal = total !== undefined && total !== '' ? parseFloat(total) : null;
    if (parsedTotal !== null && (isNaN(parsedTotal) || !isFinite(parsedTotal) || parsedTotal < 0)) {
      return res.status(400).json({ message: 'Total debe ser un número válido ≥ 0.' });
    }
    // Validar tamaño base64 (~5 MB en base64 ≈ 6.67 MB string)
    if (imageBase64 && imageBase64.length > 7 * 1024 * 1024) {
      return res.status(400).json({ message: 'Archivo adjunto demasiado grande (máx 5 MB).' });
    }

    // ── Subir factura adjunta a Firebase Storage (si se proveyó) ────────────
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

    // ── Transacción atómica: verificar stock + actualizar + registrar mov ───
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
    return res.status(500).json({ message: 'Error al registrar movimiento.' });
  }
});

module.exports = router;
