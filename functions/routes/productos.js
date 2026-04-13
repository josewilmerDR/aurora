const { Router } = require('express');
const { db, Timestamp, FieldValue, admin } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { getAnthropicClient } = require('../lib/clients');

const router = Router();

const CAMPOS_PRODUCTO = ['idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo',
  'plagaQueControla', 'periodoReingreso', 'periodoACosecha', 'cantidadPorHa',
  'unidad', 'stockActual', 'stockMinimo', 'moneda', 'tipoCambio', 'precioUnitario',
  'iva', 'proveedor', 'registroFitosanitario', 'observacion', 'activo'];

const TIPOS_VALIDOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro', ''];
const MONEDAS_VALIDAS = ['USD', 'CRC', 'EUR'];

function validateProducto(body, isCreate) {
  const errors = [];
  const s = (v) => typeof v === 'string' ? v : '';
  const checkStr = (key, label, max) => {
    if (body[key] !== undefined && s(body[key]).length > max)
      errors.push(`${label}: máximo ${max} caracteres`);
  };
  const checkNumRange = (key, label, min, max, exclusive) => {
    if (body[key] === undefined || body[key] === '' || body[key] === null) return;
    const n = Number(body[key]);
    if (isNaN(n)) { errors.push(`${label}: debe ser un número`); return; }
    if (n < min) errors.push(`${label}: mínimo ${min}`);
    if (exclusive ? n >= max : n > max) errors.push(`${label}: debe ser menor a ${max}`);
  };

  if (isCreate && !s(body.nombreComercial).trim())
    errors.push('Nombre comercial es obligatorio');

  checkStr('idProducto',            'ID Producto',        32);
  checkStr('nombreComercial',       'Nombre comercial',   64);
  checkStr('ingredienteActivo',     'Ingrediente activo', 64);
  checkStr('proveedor',             'Proveedor',          128);
  checkStr('registroFitosanitario', 'Registro',           32);
  checkStr('observacion',           'Observación',        288);
  checkStr('plagaQueControla',      'Plaga/enfermedad',   128);
  checkStr('unidad',                'Unidad',             40);

  if (body.tipo !== undefined && !TIPOS_VALIDOS.includes(s(body.tipo)))
    errors.push('Tipo no válido');
  if (body.moneda !== undefined && !MONEDAS_VALIDAS.includes(s(body.moneda)))
    errors.push('Moneda no válida');

  checkNumRange('cantidadPorHa',    'Dosis por Ha',       0, 2048, true);
  checkNumRange('periodoReingreso', 'Período reingreso',  0, 512,  true);
  checkNumRange('periodoACosecha',  'Período a cosecha',  0, 512,  true);
  checkNumRange('stockActual',      'Stock',              0, 32768, true);
  checkNumRange('stockMinimo',      'Stock mínimo',       0, 32768, true);
  checkNumRange('precioUnitario',   'Precio unitario',    0, 2097152, true);
  checkNumRange('tipoCambio',       'Tipo de cambio',     0, 2097152, true);
  checkNumRange('iva',              'IVA',                0, 100,  false);

  return errors;
}

// --- API ENDPOINTS: PRODUCTOS ---
router.get('/api/productos', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(productos);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener productos.' });
  }
});

router.post('/api/productos', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, true);
    if (valErrors.length) return res.status(400).json({ message: valErrors.join('; ') });

    const { fechaIngreso, facturaNumero, registrarIngreso, ordenCompraId, ocPoNumber } = req.body;
    const fechaTs = fechaIngreso
      ? Timestamp.fromDate(new Date(fechaIngreso + 'T12:00:00'))
      : Timestamp.now();
    const producto = { ...pick(req.body, CAMPOS_PRODUCTO), fincaId: req.fincaId };

    // Verificar si ya existe un producto con el mismo idProducto
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
    res.status(500).json({ message: 'Error al crear producto.' });
  }
});

router.put('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, false);
    if (valErrors.length) return res.status(400).json({ message: valErrors.join('; ') });

    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const productoData = pick(req.body, CAMPOS_PRODUCTO);
    await db.collection('productos').doc(id).update(productoData);
    res.status(200).json({ id, ...productoData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar producto.' });
  }
});

router.delete('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return res.status(409).json({ message: 'Esta acción solo es permitida para productos con existencias nulas.' });
    }
    await db.collection('productos').doc(id).delete();
    res.status(200).json({ message: 'Producto eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar producto.' });
  }
});

router.put('/api/productos/:id/inactivar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return res.status(409).json({ message: 'Esta acción solo es permitida para productos con existencias nulas.' });
    }
    await db.collection('productos').doc(req.params.id).update({ activo: false });
    res.status(200).json({ message: 'Producto inactivado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al inactivar producto.' });
  }
});

router.put('/api/productos/:id/activar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('productos').doc(req.params.id).update({ activo: true });
    res.status(200).json({ message: 'Producto activado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al activar producto.' });
  }
});

// ── Chat IA para editar productos ────────────────────────────────────────────
router.post('/api/productos/ai-editar', authenticate, async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ message: 'Mensaje requerido.' });

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
    res.status(500).json({ message: err.message || 'Error al procesar la solicitud.' });
  }
});

// --- API ENDPOINTS: AJUSTE DE INVENTARIO (TOMA FÍSICA) ---
router.post('/api/inventario/ajuste', authenticate, async (req, res) => {
  try {
    const { nota, ajustes } = req.body;
    if (!nota || !nota.trim()) {
      return res.status(400).json({ message: 'La nota explicativa es obligatoria.' });
    }
    if (!Array.isArray(ajustes) || ajustes.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ajuste.' });
    }

    const fincaId = req.fincaId;
    const batch = db.batch();
    const fechaAjuste = new Date();
    const movimientosCreados = [];

    for (const ajuste of ajustes) {
      const { productoId, stockAnterior, stockNuevo } = ajuste;
      if (productoId === undefined || stockNuevo === undefined) continue;
      const stockNuevoNum = parseFloat(stockNuevo);
      const stockAnteriorNum = parseFloat(stockAnterior);
      if (isNaN(stockNuevoNum) || stockNuevoNum < 0) continue;
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
        nota: nota.trim(),
        fecha: fechaAjuste,
      };
      batch.set(movRef, movData);
      movimientosCreados.push({ id: movRef.id, ...movData });
    }

    if (movimientosCreados.length === 0) {
      return res.status(400).json({ message: 'No hay diferencias que ajustar.' });
    }

    await batch.commit();
    res.status(200).json({ ajustados: movimientosCreados.length, movimientos: movimientosCreados });
  } catch (error) {
    console.error('Error en ajuste de inventario:', error);
    res.status(500).json({ message: 'Error al procesar el ajuste de inventario.' });
  }
});

// --- API ENDPOINTS: INGRESO CONFIRMADO (ProductIngreso → recepción atómica) ---
router.post('/api/ingreso/confirmar', authenticate, async (req, res) => {
  try {
    const { items, proveedor, fecha, facturaNumero, ordenCompraId, ocPoNumber, ocEstado, ocUpdatedItems, imageBase64, mediaType } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ítem.' });
    }
    const validos = items.filter(i => (i.idProducto || '').trim() || (i.nombreComercial || '').trim());
    if (validos.length === 0) {
      return res.status(400).json({ message: 'Ningún ítem tiene datos suficientes.' });
    }

    const fechaTs = fecha
      ? Timestamp.fromDate(new Date(fecha + 'T12:00:00'))
      : Timestamp.now();

    // ── Pre-resolver productos (async antes del batch) ───────────────────────
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
      return res.status(400).json({ message: 'Todos los ítems tienen cantidad cero.' });
    }

    // ── Pre-generar ID de recepción para el nombre del archivo ───────────────
    const recepcionRef = db.collection('recepciones').doc();

    // ── Subir imagen de factura a Firebase Storage (si se proveyó) ───────────
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

    // ── Construir batch ──────────────────────────────────────────────────────
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

    if (ordenCompraId && ocEstado) {
      const ocUpdate = { estado: ocEstado };
      if (Array.isArray(ocUpdatedItems)) ocUpdate.items = ocUpdatedItems;
      batch.update(db.collection('ordenes_compra').doc(ordenCompraId), ocUpdate);
    }

    await batch.commit();
    res.status(201).json({ recepcionId: recepcionRef.id, creados, mergeados });
  } catch (error) {
    console.error('Error en ingreso/confirmar:', error);
    res.status(500).json({ message: 'Error al registrar el ingreso.' });
  }
});

module.exports = router;
