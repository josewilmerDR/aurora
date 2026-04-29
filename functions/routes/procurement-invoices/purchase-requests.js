// Procurement-invoices — solicitudes de compra (`solicitudes_compra`).
//
// Sub-archivo del split de routes/procurement-invoices.js. CRUD de
// solicitudes que envía un encargado a Proveeduría/Compras. Cada solicitud
// genera además una scheduled_task de tipo SOLICITUD_COMPRA para que el
// responsable la vea en su feed.
//
// Endpoints:
//   - GET    /api/solicitudes-compra
//   - POST   /api/solicitudes-compra        crea solicitud + tarea asociada
//   - PUT    /api/solicitudes-compra/:id    cambia estado / items / notas
//   - DELETE /api/solicitudes-compra/:id    hard delete (la tarea sobrevive)

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

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
    console.error('[solicitudes-compra:list]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch solicitudes.', 500);
  }
});

router.post('/api/solicitudes-compra', authenticate, async (req, res) => {
  try {
    const { responsableId, responsableNombre, notas, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one product is required.', 400);
    }

    if (notas && typeof notas === 'string' && notas.length > 288) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'notas must not exceed 288 characters.', 400);
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
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'All products must have quantity > 0 and < 32768.', 400);
    }

    const batch = db.batch();

    // Create the purchase request
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

    // Create associated task in scheduled_tasks
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
    res.status(201).json({ id: solicitudRef.id, taskId: taskRef.id, message: 'Solicitud created.' });
  } catch (error) {
    console.error('[solicitudes-compra:post]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create solicitud.', 500);
  }
});

router.put('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('solicitudes_compra', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { estado, items, responsableId, responsableNombre, notas } = req.body;
    const VALID_STATES = ['pendiente', 'aprobada', 'rechazada', 'completada'];
    if (estado && !VALID_STATES.includes(estado)) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    const update = {};
    if (estado) update.estado = estado;
    if (items) update.items = items;
    if (responsableId !== undefined) update.responsableId = responsableId;
    if (responsableNombre !== undefined) update.responsableNombre = responsableNombre;
    if (notas !== undefined) update.notas = notas;
    await db.collection('solicitudes_compra').doc(id).update(update);
    res.status(200).json({ message: 'Solicitud updated.' });
  } catch (error) {
    console.error('[solicitudes-compra:put]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update solicitud.', 500);
  }
});

router.delete('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('solicitudes_compra', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('solicitudes_compra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud deleted.' });
  } catch (error) {
    console.error('[solicitudes-compra:delete]', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete solicitud.', 500);
  }
});

module.exports = router;
