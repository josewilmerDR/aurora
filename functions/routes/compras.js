const { Router } = require('express');
const { db, admin, Timestamp, FieldValue } = require('../lib/firebase');
const { getAnthropicClient } = require('../lib/clients');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');

const router = Router();

// --- API ENDPOINTS: COMPRAS (ESCANEO DE FACTURAS) ---

router.get('/api/compras', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('compras')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const compras = snapshot.docs.map(doc => {
      const data = doc.data();
      // No devolver la imagen en el listado (puede ser pesada)
      const { imageBase64, ...rest } = data;
      return { id: doc.id, tieneImagen: !!imageBase64, ...rest };
    });
    res.status(200).json(compras);
  } catch (error) {
    console.error("Error fetching compras:", error);
    res.status(500).json({ message: 'Error al obtener el historial de compras.' });
  }
});

router.post('/api/compras/escanear', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ message: 'Se requiere imageBase64 y mediaType.' });
    }
    const MEDIA_TYPES_VALIDOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!MEDIA_TYPES_VALIDOS.includes(mediaType)) {
      return res.status(400).json({ message: 'Tipo de imagen no soportado. Use jpeg, png, gif o webp.' });
    }

    // Obtener catálogo de productos actual para que Claude pueda hacer el match
    const productosSnap = await db.collection('productos')
      .where('fincaId', '==', req.fincaId)
      .get();
    const catalogo = productosSnap.docs.map(doc => ({
      id: doc.id,
      idProducto: doc.data().idProducto,
      nombreComercial: doc.data().nombreComercial,
      unidad: doc.data().unidad,
      stockActual: doc.data().stockActual,
    }));

    const client = getAnthropicClient();

    const catalogoTexto = catalogo.length > 0
      ? catalogo.map(p => `- ID: "${p.id}" | Código: ${p.idProducto} | Nombre: ${p.nombreComercial} | Unidad: ${p.unidad}`).join('\n')
      : '(catálogo vacío)';

    const prompt = `Eres un experto en inventario agrícola. Analiza esta imagen de factura de agroquímicos.

Catálogo de productos existente en nuestra bodega:
${catalogoTexto}

Extrae cada línea de producto de la factura y devuelve un arreglo JSON con este formato exacto:
[
  {
    "productoId": "ID del catálogo si hay coincidencia, o null si no hay",
    "nombreFactura": "nombre exacto como aparece en la factura",
    "cantidadFactura": 2.0,
    "unidadFactura": "unidad como aparece en factura (ej: Galón, Pichinga 5L, kg, L)",
    "cantidadCatalogo": 7.57,
    "unidadCatalogo": "unidad del catálogo (ej: L, kg, mL, g)",
    "subtotalLinea": 150.00,
    "notas": "conversión realizada u observación, o vacío"
  }
]

Reglas importantes:
1. Convierte automáticamente las unidades al sistema métrico del catálogo (ej: 1 Galón = 3.785 L, 1 Pichinga 5L = 5 L).
2. Si en el catálogo hay un producto con nombre similar, asigna su ID en "productoId".
3. Si no hay coincidencia, usa null en "productoId" y mantén la unidad de la factura.
4. "subtotalLinea" es el importe total de ESA FILA específica (cantidad × precio unitario). Ejemplo: si la fila dice "2 unidades × $75.00 = $150.00", entonces subtotalLinea = 150.00. NO uses el total general de la factura. Si el subtotal de la línea no aparece explícitamente, multiplica cantidad × precio unitario. Si ninguno de los dos está disponible, usa null.
5. Devuelve SOLO el arreglo JSON, sin texto adicional, sin markdown, sin bloques de código.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim();

    // Limpiar posibles bloques de código si Claude los incluyó de todas formas
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let lineas;
    try {
      lineas = JSON.parse(jsonText);
    } catch {
      console.error("Claude devolvió texto no parseable:", rawText);
      return res.status(422).json({ message: 'La IA no pudo interpretar la factura. Intenta con una imagen más clara.', raw: rawText });
    }

    res.status(200).json({ lineas, catalogo });
  } catch (error) {
    console.error("Error en escanear factura:", error);
    res.status(500).json({ message: 'Error al procesar la imagen con IA.' });
  }
});

router.post('/api/compras/confirmar', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType, proveedor, fecha, lineas } = req.body;

    if (!Array.isArray(lineas) || lineas.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos una línea de producto.' });
    }

    const batch = db.batch();
    let stockActualizados = 0;
    let productosCreados = 0;

    // Pre-generar ID de compra para referenciarlo en los movimientos
    const compraRef = db.collection('compras').doc();
    const motivoCompra = proveedor ? `Compra: ${proveedor}` : 'Compra de inventario';

    for (const linea of lineas) {
      const cantidad = parseFloat(linea.cantidadIngresada) || 0;
      if (cantidad <= 0) continue;

      if (linea.productoId) {
        // ── Producto existente: solo incrementar stock ──
        const prodRef = db.collection('productos').doc(linea.productoId);
        batch.update(prodRef, { stockActual: FieldValue.increment(cantidad) });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: linea.productoId,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          cantidad,
          unidad: linea.unidad || '',
          fecha: Timestamp.now(),
          motivo: motivoCompra,
          compraId: compraRef.id,
          fincaId: req.fincaId,
        });
        stockActualizados++;
      } else if (linea.ingredienteActivo) {
        // ── Producto nuevo: crear con todos los campos del formulario ──
        const newProdRef = db.collection('productos').doc();
        batch.set(newProdRef, {
          idProducto: linea.idProducto || `PD-${Date.now()}`,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          ingredienteActivo: linea.ingredienteActivo,
          tipo: linea.tipo || '',
          plagaQueControla: linea.plagaQueControla || '',
          periodoReingreso: parseFloat(linea.periodoReingreso) || 0,
          periodoACosecha: parseFloat(linea.periodoACosecha) || 0,
          unidad: linea.unidad || 'L',
          stockActual: cantidad,
          stockMinimo: parseFloat(linea.stockMinimo) || 0,
          moneda: linea.moneda || 'USD',
          tipoCambio: parseFloat(linea.tipoCambio) || 1,
          precioUnitario: parseFloat(linea.precioUnitario) || 0,
          proveedor: proveedor || '',
          fincaId: req.fincaId,
        });
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'ingreso',
          productoId: newProdRef.id,
          nombreComercial: linea.nombreComercial || linea.nombreFactura || '',
          cantidad,
          unidad: linea.unidad || 'L',
          fecha: Timestamp.now(),
          motivo: motivoCompra,
          compraId: compraRef.id,
          fincaId: req.fincaId,
        });
        productosCreados++;
      }
      // Si no tiene productoId ni ingredienteActivo: se ignora (incompleto)
    }

    // Guardar registro de compra (ref pre-generada arriba)
    batch.set(compraRef, {
      fincaId: req.fincaId,
      proveedor: proveedor || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      lineas: lineas.map(l => ({
        productoId: l.productoId || null,
        nombreFactura: l.nombreFactura || '',
        cantidadIngresada: parseFloat(l.cantidadIngresada) || 0,
        unidad: l.unidad || '',
      })),
      imageBase64: imageBase64 || null,
      mediaType: mediaType || null,
      createdAt: Timestamp.now(),
    });

    await batch.commit();
    res.status(201).json({
      id: compraRef.id,
      stockActualizados,
      productosCreados,
      message: 'Compra registrada exitosamente.',
    });
  } catch (error) {
    console.error("Error confirmando compra:", error);
    res.status(500).json({ message: 'Error al registrar la compra.' });
  }
});

// --- API ENDPOINTS: SOLICITUDES DE COMPRA ---
router.get('/api/solicitudes-compra', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('solicitudes_compra')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaCreacion', 'desc')
      .limit(50)
      .get();
    const solicitudes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fechaCreacion: doc.data().fechaCreacion.toDate().toISOString(),
    }));
    res.status(200).json(solicitudes);
  } catch (error) {
    console.error('Error fetching solicitudes:', error);
    res.status(500).json({ message: 'Error al obtener solicitudes.' });
  }
});

router.post('/api/solicitudes-compra', authenticate, async (req, res) => {
  try {
    const { responsableId, responsableNombre, notas, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un producto.' });
    }

    // Validate notas length
    if (notas && typeof notas === 'string' && notas.length > 288) {
      return res.status(400).json({ message: 'Las notas no pueden exceder 288 caracteres.' });
    }

    const resolvedResponsableId = responsableId || 'proveeduria';
    const resolvedResponsableNombre = typeof responsableNombre === 'string'
      ? responsableNombre.slice(0, 128) : 'Proveeduría';

    const mappedItems = items
      .map(i => ({
        productoId: i.productoId,
        nombreComercial: typeof i.nombreComercial === 'string' ? i.nombreComercial.slice(0, 64) : '',
        cantidadSolicitada: parseFloat(i.cantidadSolicitada) || 0,
        unidad: typeof i.unidad === 'string' ? i.unidad.slice(0, 40) : '',
        stockActual: parseFloat(i.stockActual) || 0,
        stockMinimo: parseFloat(i.stockMinimo) || 0,
      }))
      .filter(i => i.cantidadSolicitada > 0 && i.cantidadSolicitada < 32768);

    if (mappedItems.length === 0) {
      return res.status(400).json({ message: 'Todos los productos deben tener cantidad mayor a 0 y menor a 32768.' });
    }

    const batch = db.batch();

    // Crear la solicitud de compra
    const solicitudRef = db.collection('solicitudes_compra').doc();
    batch.set(solicitudRef, {
      fincaId: req.fincaId,
      fechaCreacion: Timestamp.now(),
      estado: 'pendiente',
      responsableId: resolvedResponsableId,
      responsableNombre: resolvedResponsableNombre,
      notas: notas || '',
      items: mappedItems,
    });

    // Crear tarea asociada en scheduled_tasks
    const productosResumen = mappedItems
      .map(i => `${i.nombreComercial} (${i.cantidadSolicitada} ${i.unidad})`)
      .join(', ');
    const taskRef = db.collection('scheduled_tasks').doc();
    batch.set(taskRef, {
      type: 'SOLICITUD_COMPRA',
      executeAt: Timestamp.now(),
      status: 'pending',
      loteId: null,
      fincaId: req.fincaId,
      solicitudId: solicitudRef.id,
      activity: {
        name: `Solicitud de compra: ${mappedItems.length} producto(s)`,
        type: 'notificacion',
        responsableId: resolvedResponsableId,
        responsableNombre: resolvedResponsableNombre,
        descripcion: productosResumen,
        productos: mappedItems.map(i => ({
          productoId: i.productoId,
          nombreComercial: i.nombreComercial,
          cantidad: i.cantidadSolicitada,
          unidad: i.unidad,
          stockActual: i.stockActual,
          stockMinimo: i.stockMinimo,
        })),
      },
      notas: notas || '',
    });

    await batch.commit();
    res.status(201).json({ id: solicitudRef.id, taskId: taskRef.id, message: 'Solicitud creada exitosamente.' });
  } catch (error) {
    console.error('Error creating solicitud:', error);
    res.status(500).json({ message: 'Error al crear la solicitud.' });
  }
});

router.put('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('solicitudes_compra', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { estado, items, responsableId, responsableNombre, notas } = req.body;
    const ESTADOS_VALIDOS = ['pendiente', 'aprobada', 'rechazada', 'completada'];
    if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ message: 'Estado inválido.' });
    const update = {};
    if (estado) update.estado = estado;
    if (items) update.items = items;
    if (responsableId !== undefined) update.responsableId = responsableId;
    if (responsableNombre !== undefined) update.responsableNombre = responsableNombre;
    if (notas !== undefined) update.notas = notas;
    await db.collection('solicitudes_compra').doc(id).update(update);
    res.status(200).json({ message: 'Solicitud actualizada.' });
  } catch (error) {
    console.error('Error updating solicitud:', error);
    res.status(500).json({ message: 'Error al actualizar la solicitud.' });
  }
});

router.delete('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('solicitudes_compra', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('solicitudes_compra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    console.error('Error deleting solicitud:', error);
    res.status(500).json({ message: 'Error al eliminar la solicitud.' });
  }
});

// --- API ENDPOINTS: MOVIMIENTOS ---
router.get('/api/movimientos', authenticate, async (req, res) => {
  try {
    const { productoId, fechaDesde, fechaHasta } = req.query;
    let query = db.collection('movimientos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc')
      .limit(500);
    if (productoId) {
      query = db.collection('movimientos')
        .where('fincaId', '==', req.fincaId)
        .where('productoId', '==', productoId)
        .orderBy('fecha', 'desc')
        .limit(500);
    }
    if (fechaDesde) {
      query = query.where('fecha', '>=', Timestamp.fromDate(new Date(fechaDesde + 'T00:00:00')));
    }
    if (fechaHasta) {
      query = query.where('fecha', '<=', Timestamp.fromDate(new Date(fechaHasta + 'T23:59:59')));
    }
    const snapshot = await query.get();
    const movimientos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha.toDate().toISOString(),
    }));
    res.status(200).json(movimientos);
  } catch (error) {
    console.error('Error fetching movimientos:', error);
    res.status(500).json({ message: 'Error al obtener movimientos.' });
  }
});

// --- API ENDPOINTS: ÓRDENES DE COMPRA ---
router.get('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('ordenes_compra')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    let ordenes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      fecha: doc.data().fecha ? doc.data().fecha.toDate().toISOString() : null,
      fechaEntrega: doc.data().fechaEntrega ? doc.data().fechaEntrega.toDate().toISOString() : null,
      createdAt: doc.data().createdAt ? doc.data().createdAt.toDate().toISOString() : null,
    }));
    const { estado } = req.query;
    if (estado) ordenes = ordenes.filter(o => o.estado === estado);
    res.status(200).json(ordenes);
  } catch (error) {
    console.error('Error fetching ordenes:', error);
    res.status(500).json({ message: 'Error al obtener órdenes de compra.' });
  }
});

router.post('/api/ordenes-compra', authenticate, async (req, res) => {
  try {
    const { fecha, fechaEntrega, proveedor, direccionProveedor, elaboradoPor, notas, items, taskId, solicitudId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un producto.' });
    }
    const counterRef = db.collection('counters').doc(`oc_${req.fincaId}`);
    let seq;
    await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      seq = (counterDoc.exists ? (counterDoc.data().value || 0) : 0) + 1;
      t.set(counterRef, { value: seq }, { merge: true });
    });
    const poNumber = `OC-${String(seq).padStart(6, '0')}`;
    const docRef = await db.collection('ordenes_compra').add({
      fincaId: req.fincaId,
      poNumber,
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fechaEntrega: fechaEntrega ? Timestamp.fromDate(new Date(fechaEntrega + 'T12:00:00')) : null,
      proveedor: proveedor || '',
      direccionProveedor: direccionProveedor || '',
      elaboradoPor: elaboradoPor || '',
      notas: notas || '',
      estado: 'activa',
      taskId: taskId || null,
      solicitudId: solicitudId || null,
      items: items.map(i => ({
        productoId: i.productoId || null,
        nombreComercial: i.nombreComercial || '',
        ingredienteActivo: i.ingredienteActivo || '',
        cantidad: parseFloat(i.cantidad) || 0,
        unidad: i.unidad || '',
        precioUnitario: parseFloat(i.precioUnitario) || 0,
        moneda: i.moneda || 'USD',
      })),
      createdAt: Timestamp.now(),
    });
    if (solicitudId) {
      await db.collection('scheduled_tasks').doc(solicitudId).update({
        status: 'completed_by_user',
        completedAt: Timestamp.now(),
        ordenCompraId: docRef.id,
      });
    }
    res.status(201).json({ id: docRef.id, poNumber, message: 'Orden de compra guardada.' });
  } catch (error) {
    console.error('Error saving orden:', error);
    res.status(500).json({ message: 'Error al guardar la orden de compra.' });
  }
});

router.patch('/api/ordenes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, items } = req.body;
    const valid = ['activa', 'completada', 'cancelada', 'recibida', 'recibida_parcialmente'];
    if (!valid.includes(estado)) return res.status(400).json({ message: 'Estado inválido.' });
    const docRef = db.collection('ordenes_compra').doc(id);
    const doc = await docRef.get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId)
      return res.status(404).json({ message: 'Orden no encontrada.' });
    const updateData = { estado, updatedAt: Timestamp.now() };
    if (Array.isArray(items)) updateData.items = items;
    await docRef.update(updateData);
    res.status(200).json({ message: 'Estado actualizado.' });
  } catch (error) {
    console.error('Error updating orden estado:', error);
    res.status(500).json({ message: 'Error al actualizar la orden.' });
  }
});

// --- API ENDPOINTS: RECEPCIONES DE PRODUCTOS ---
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
    console.error('Error fetching recepciones:', error);
    res.status(500).json({ message: 'Error al obtener recepciones.' });
  }
});

router.post('/api/recepciones', authenticate, async (req, res) => {
  try {
    const { ordenCompraId, poNumber, proveedor, items, notas, imageBase64, mediaType } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Se requiere al menos un ítem.' });
    }
    const recibidos = items.filter(i => parseFloat(i.cantidadRecibida) > 0);
    if (recibidos.length === 0) {
      return res.status(400).json({ message: 'Al menos un producto debe tener cantidad recibida mayor a cero.' });
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
        console.error('Storage upload failed:', storageErr.message);
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
    res.status(201).json({ id: recepcionRef.id, message: 'Recepción registrada y stock actualizado.' });
  } catch (error) {
    console.error('Error processing recepcion:', error);
    res.status(500).json({ message: 'Error al registrar la recepción.' });
  }
});

module.exports = router;
