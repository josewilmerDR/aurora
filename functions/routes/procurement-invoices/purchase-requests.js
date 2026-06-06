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
const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

// Whitelist + coacciona los campos de cada item; nunca persistimos el objeto
// user-controlled crudo. Compartido por POST y PUT.
function mapItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(i => ({
      productoId: typeof i.productoId === 'string' ? i.productoId.slice(0, 64) : '',
      nombreComercial: typeof i.nombreComercial === 'string' ? i.nombreComercial.slice(0, 64) : '',
      cantidadSolicitada: parseFloat(i.cantidadSolicitada) || 0,
      unidad: typeof i.unidad === 'string' ? i.unidad.slice(0, 40) : '',
      stockActual: parseFloat(i.stockActual) || 0,
      stockMinimo: parseFloat(i.stockMinimo) || 0,
    }))
    .filter(i => i.cantidadSolicitada > 0 && i.cantidadSolicitada < 32768);
}

// Valida que las referencias del payload pertenezcan a la finca antes de
// persistirlas: el responsable (salvo el sentinel 'proveeduria') debe ser un
// usuario de la finca, y cada productoId debe existir en su catálogo. Evita
// asignar la solicitud/tarea a un usuario de otra finca (cross-tenant) o dejar
// productoIds colgantes/inyectados. Devuelve { ok, message }.
async function validateRefs(fincaId, responsableId, productoIds) {
  if (responsableId && responsableId !== 'proveeduria') {
    const userSnap = await db.collection('users').doc(responsableId).get();
    if (!userSnap.exists || userSnap.data().fincaId !== fincaId) {
      return { ok: false, message: 'responsableId does not belong to this finca.' };
    }
  }
  const uniqueIds = [...new Set(productoIds.filter(Boolean))];
  const prodSnaps = await Promise.all(
    uniqueIds.map(id => db.collection('productos').doc(id).get()),
  );
  const invalid = prodSnaps.some(s => !s.exists || s.data().fincaId !== fincaId);
  if (invalid) return { ok: false, message: 'One or more productoId values are invalid for this finca.' };
  return { ok: true };
}

// Rate-limited + encargado floor: las solicitudes exponen items con nombres
// comerciales, cantidades y niveles de stock; un trabajador autenticado no debe
// poder polearlas vía API aunque la UI le niegue la ruta.
router.get('/api/solicitudes-compra', authenticate, rateLimit('solicitudes_read', 'public_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can list solicitudes.', 403);
    }
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
    console.error('[solicitudes-compra:list]', error?.message);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch solicitudes.', 500);
  }
});

// Encargado floor: crear una solicitud genera además una scheduled_task que
// llega al feed de un responsable; un trabajador autenticado no debe poder
// dispararla vía API aunque la UI le niegue la ruta. Rate-limited porque cada
// POST hace un batch.commit() de 2 docs (solicitud + tarea).
router.post('/api/solicitudes-compra', authenticate, rateLimit('solicitudes_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create solicitudes.', 403);
    }
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

    const mappedItems = mapItems(items);

    if (mappedItems.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'All products must have quantity > 0 and < 32768.', 400);
    }

    const refsCheck = await validateRefs(req.fincaId, resolvedResponsableId, mappedItems.map(i => i.productoId));
    if (!refsCheck.ok) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, refsCheck.message, 400);
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

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.SOLICITUD_COMPRA_CREATE,
      target: { type: 'solicitud_compra', id: solicitudRef.id },
      metadata: {
        taskId: taskRef.id,
        responsableId: resolvedResponsableId,
        itemsCount: mappedItems.length,
      },
      severity: SEVERITY.INFO,
    });

    res.status(201).json({ id: solicitudRef.id, taskId: taskRef.id, message: 'Solicitud created.' });
  } catch (error) {
    console.error('[solicitudes-compra:post]', error?.message);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create solicitud.', 500);
  }
});

router.put('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update solicitudes.', 403);
    }
    const { id } = req.params;
    const ownership = await verifyOwnership('solicitudes_compra', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { estado, items, responsableId, responsableNombre, notas } = req.body;
    const VALID_STATES = ['pendiente', 'aprobada', 'rechazada', 'completada'];
    if (estado && !VALID_STATES.includes(estado)) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    if (notas !== undefined && (typeof notas !== 'string' || notas.length > 288)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'notas must be a string of at most 288 characters.', 400);
    }
    const update = {};
    if (estado) update.estado = estado;
    // Nunca persistimos el array crudo: whitelist + coacción vía mapItems.
    if (items !== undefined) {
      const mappedItems = mapItems(items);
      if (mappedItems.length === 0) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'All products must have quantity > 0 and < 32768.', 400);
      }
      update.items = mappedItems;
    }
    if (responsableId !== undefined) update.responsableId = String(responsableId).slice(0, 64);
    if (responsableNombre !== undefined) update.responsableNombre = String(responsableNombre).slice(0, 128);
    if (notas !== undefined) update.notas = notas;

    // Si el PUT cambia responsable o items, validar que las referencias sigan
    // siendo de la finca (mismo criterio que el POST).
    if (update.responsableId !== undefined || update.items !== undefined) {
      const refsCheck = await validateRefs(
        req.fincaId,
        update.responsableId,
        (update.items || []).map(i => i.productoId),
      );
      if (!refsCheck.ok) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, refsCheck.message, 400);
      }
    }

    await db.collection('solicitudes_compra').doc(id).update(update);
    res.status(200).json({ message: 'Solicitud updated.' });
  } catch (error) {
    console.error('[solicitudes-compra:put]', error?.message);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update solicitud.', 500);
  }
});

router.delete('/api/solicitudes-compra/:id', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can delete solicitudes.', 403);
    }
    const ownership = await verifyOwnership('solicitudes_compra', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const prev = ownership.doc.data();
    await db.collection('solicitudes_compra').doc(req.params.id).delete();

    // Borrado duro irreversible: la solicitud desaparece y su scheduled_task
    // queda huérfana. Forensic: quién la borró y qué contenía.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.SOLICITUD_COMPRA_DELETE,
      target: { type: 'solicitud_compra', id: req.params.id },
      metadata: {
        estado: prev.estado || null,
        responsableId: prev.responsableId || null,
        itemsCount: Array.isArray(prev.items) ? prev.items.length : 0,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ message: 'Solicitud deleted.' });
  } catch (error) {
    console.error('[solicitudes-compra:delete]', error?.message);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete solicitud.', 500);
  }
});

module.exports = router;
