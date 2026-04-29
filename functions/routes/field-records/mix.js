// Field-records — preparación de mezcla (transición pendiente → en_transito).
//
// Sub-archivo del split de routes/field-records.js. Cubre los dos endpoints
// que actualizan los productos aplicados ANTES de la aplicación en campo:
//   - PUT /api/cedulas/:id/mezcla-lista     marca la cédula como en_transito,
//                                            deduce stock de inventario
//   - PUT /api/cedulas/:id/editar-productos  edita la receta sin transicionar
//                                            estado (solo permitido en pendiente)
//
// Solo /mezcla-lista deduce inventario; /editar-productos modifica la receta
// para que la deducción posterior refleje el cambio.

const { Router } = require('express');
const { db, Timestamp, FieldValue, FieldPath } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  MAX_OBS_MEZCLA_LEN, MAX_NOMBRE_MEZCLA_LEN,
  sanitizeStrStrict, requireRole,
  validateAndEnrichProductosAplicados, computeHuboCambios,
  serializeProductoOriginal,
} = require('./helpers');

const router = Router();

router.put('/api/cedulas/:id/mezcla-lista', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const cedula = ownership.doc.data();
    if (cedula.status !== 'pendiente') {
      return sendApiError(res, ERROR_CODES.CONFLICT, `Cedula is not in pendiente state (current: ${cedula.status}).`, 409);
    }

    const taskDoc = await db.collection('scheduled_tasks').doc(cedula.taskId).get();
    if (!taskDoc.exists) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Associated task not found.', 404);
    const taskData = taskDoc.data();

    // Products actually mixed. If the client sends productosAplicados (substitution
    // or dose adjustment), we validate and use them for stock deduction instead of
    // the original package plan.
    let productosAplicadosEnriched = null;
    try {
      if (req.body?.productosAplicados !== undefined) {
        productosAplicadosEnriched = await validateAndEnrichProductosAplicados(
          req.body.productosAplicados,
          req.fincaId
        );
      }
    } catch (e) {
      if (e && e.status && e.message) return res.status(e.status).json({ message: e.message });
      throw e;
    }

    // Validate observacionesMezcla (free text, max MAX_OBS_MEZCLA_LEN chars)
    let observacionesMezcla = null;
    if (req.body?.observacionesMezcla != null && req.body.observacionesMezcla !== '') {
      if (typeof req.body.observacionesMezcla !== 'string') {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'observacionesMezcla must be a string.', 400);
      }
      observacionesMezcla = sanitizeStrStrict(req.body.observacionesMezcla, MAX_OBS_MEZCLA_LEN);
      if (observacionesMezcla == null) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Observations cannot exceed ${MAX_OBS_MEZCLA_LEN} characters.`, 400);
      }
    }

    // Productos para deducir stock. Prioridad:
    //   1. productosAplicados enviados en este request (ajustes en mezcla-lista)
    //   2. cedula.productosAplicados (previous edits via /editar-productos)
    //   3. taskData.activity.productos (original package plan)
    // This ensures what is deducted from inventory matches what the operator
    // will actually mix, even if adjustments occurred in a prior action.
    const productos = productosAplicadosEnriched
      || (Array.isArray(cedula.productosAplicados) && cedula.productosAplicados.length > 0
            ? cedula.productosAplicados
            : taskData.activity?.productos);
    const productosTieneCambios = productosAplicadosEnriched != null;

    let hectareas = 1;
    let sourceNombre = '';
    if (cedula.splitBloqueIds?.length > 0) {
      sourceNombre = cedula.splitLoteNombre || '';
      const splitSnap = await db.collection('siembras')
        .where(FieldPath.documentId(), 'in', cedula.splitBloqueIds.slice(0, 10))
        .get();
      hectareas = splitSnap.docs.reduce((s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0) || 1;
    } else if (taskData.loteId) {
      const loteDoc = await db.collection('lotes').doc(taskData.loteId).get();
      hectareas = loteDoc.exists ? (parseFloat(loteDoc.data().hectareas) || 1) : 1;
      sourceNombre = loteDoc.exists ? (loteDoc.data().nombreLote || '') : '';
    } else if (taskData.grupoId) {
      const grupoDoc = await db.collection('grupos').doc(taskData.grupoId).get();
      sourceNombre = grupoDoc.exists ? (grupoDoc.data().nombreGrupo || '') : '';
      const bloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
        ? taskData.bloques.slice(0, 10)
        : (grupoDoc.exists && Array.isArray(grupoDoc.data().bloques) ? grupoDoc.data().bloques.slice(0, 10) : []);
      if (bloqueIds.length > 0) {
        const siembrasSnap = await db.collection('siembras')
          .where(FieldPath.documentId(), 'in', bloqueIds)
          .get();
        hectareas = siembrasSnap.docs.reduce((s, d) => s + (parseFloat(d.data().areaCalculada) || 0), 0) || 1;
      }
    }

    const batch = db.batch();
    if (Array.isArray(productos) && productos.length > 0) {
      const deduccionPorProducto = {};
      for (const prod of productos) {
        if (!prod.productoId) continue;
        const deduccion = prod.cantidad !== undefined
          ? parseFloat(prod.cantidad)
          : parseFloat(prod.cantidadPorHa || 0) * hectareas;
        if (isNaN(deduccion) || deduccion <= 0) continue;
        deduccionPorProducto[prod.productoId] =
          (deduccionPorProducto[prod.productoId] || 0) + deduccion;
        batch.set(db.collection('movimientos').doc(), {
          tipo: 'egreso',
          productoId: prod.productoId,
          nombreComercial: prod.nombreComercial || '',
          cantidad: deduccion,
          unidad: prod.unidad || '',
          fecha: Timestamp.now(),
          motivo: taskData.activity?.name || '',
          tareaId: cedula.taskId,
          cedulaId: req.params.id,
          cedulaConsecutivo: cedula.consecutivo,
          loteId: taskData.loteId || null,
          grupoId: taskData.grupoId || null,
          loteNombre: taskData.loteId  ? sourceNombre : '',
          grupoNombre: taskData.grupoId ? sourceNombre : '',
          fincaId: req.fincaId,
          ...(prod.motivoCambio ? { motivoCambio: prod.motivoCambio } : {}),
          ...(prod.productoOriginalId ? { productoOriginalId: prod.productoOriginalId } : {}),
        });
      }
      for (const [productoId, totalDeduccion] of Object.entries(deduccionPorProducto)) {
        batch.update(db.collection('productos').doc(productoId), {
          stockActual: FieldValue.increment(-totalDeduccion),
        });
      }
    }

    // Name of who prepared the mix: string, max MAX_NOMBRE_MEZCLA_LEN.
    // Reject with 400 if exceeded (no silent truncation) so the frontend
    // shows an error consistent with its own validation.
    if (req.body?.nombre != null && typeof req.body.nombre !== 'string') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'nombre must be a string.', 400);
    }
    const mezclaListaNombre = sanitizeStrStrict(req.body?.nombre, MAX_NOMBRE_MEZCLA_LEN);
    if (req.body?.nombre != null && req.body.nombre !== '' && mezclaListaNombre == null) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Name cannot exceed ${MAX_NOMBRE_MEZCLA_LEN} characters.`, 400);
    }

    // Compute huboCambios comparing applied products vs cedula originals
    let huboCambios = false;
    if (productosTieneCambios) {
      const originales = Array.isArray(cedula.productosOriginales)
        ? cedula.productosOriginales
        : (Array.isArray(taskData.activity?.productos)
            ? taskData.activity.productos.map(serializeProductoOriginal).filter(Boolean)
            : []);
      huboCambios = computeHuboCambios(originales, productosAplicadosEnriched);
    }

    const cedulaUpdate = {
      status: 'en_transito',
      mezclaListaAt: Timestamp.now(),
      mezclaListaPor: req.uid,
      mezclaListaNombre,
    };
    if (productosTieneCambios) {
      cedulaUpdate.productosAplicados = productosAplicadosEnriched;
      cedulaUpdate.huboCambios = huboCambios;
      if (huboCambios) {
        cedulaUpdate.modificadaEnMezclaPor = req.uid;
        cedulaUpdate.modificadaEnMezclaAt  = Timestamp.now();
      }
    }
    if (observacionesMezcla != null) {
      cedulaUpdate.observacionesMezcla = observacionesMezcla;
    }

    batch.update(db.collection('cedulas').doc(req.params.id), cedulaUpdate);
    await batch.commit();

    // Return written fields so the frontend can update local state without
    // reloading. Key: productosAplicados (with enriched fields) is needed so
    // the viewer shows what was actually mixed rather than the original recipe.
    const response = {
      id: req.params.id,
      status: 'en_transito',
      mezclaListaAt:     cedulaUpdate.mezclaListaAt.toDate().toISOString(),
      mezclaListaPor:    req.uid,
      mezclaListaNombre: mezclaListaNombre || null,
    };
    if (productosTieneCambios) {
      response.productosAplicados = productosAplicadosEnriched;
      response.huboCambios        = huboCambios;
      if (huboCambios) {
        response.modificadaEnMezclaAt  = cedulaUpdate.modificadaEnMezclaAt.toDate().toISOString();
        response.modificadaEnMezclaPor = req.uid;
      }
    }
    if (observacionesMezcla != null) {
      response.observacionesMezcla = observacionesMezcla;
    }
    res.json(response);
  } catch (error) {
    console.error('Error in mezcla-lista:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process mezcla.', 500);
  }
});

// Edits products/doses of a cedula as an independent action, before marking
// Mezcla Lista. Only allowed in 'pendiente' status. Records the editor in
// editadaAt/editadaPor/editadaPorNombre. Does not touch inventory (the
// deduction happens later, when mezcla-lista is marked).
router.put('/api/cedulas/:id/editar-productos', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const cedula = ownership.doc.data();
    if (cedula.status !== 'pendiente') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Only cedulas in pendiente state can be edited.', 409);
    }

    if (req.body?.productosAplicados === undefined) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'productosAplicados is required.', 400);
    }

    let productosAplicadosEnriched;
    try {
      productosAplicadosEnriched = await validateAndEnrichProductosAplicados(
        req.body.productosAplicados,
        req.fincaId
      );
    } catch (e) {
      if (e && e.status && e.message) return res.status(e.status).json({ message: e.message });
      throw e;
    }

    let observacionesMezcla = null;
    if (req.body?.observacionesMezcla != null && req.body.observacionesMezcla !== '') {
      if (typeof req.body.observacionesMezcla !== 'string') {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'observacionesMezcla must be a string.', 400);
      }
      observacionesMezcla = sanitizeStrStrict(req.body.observacionesMezcla, MAX_OBS_MEZCLA_LEN);
      if (observacionesMezcla == null) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Observations cannot exceed ${MAX_OBS_MEZCLA_LEN} characters.`, 400);
      }
    }

    // Name of who edits: string, max MAX_NOMBRE_MEZCLA_LEN, reject if exceeded.
    if (req.body?.nombre != null && typeof req.body.nombre !== 'string') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'nombre must be a string.', 400);
    }
    const editadaPorNombre = sanitizeStrStrict(req.body?.nombre, MAX_NOMBRE_MEZCLA_LEN);
    if (req.body?.nombre != null && req.body.nombre !== '' && editadaPorNombre == null) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Name cannot exceed ${MAX_NOMBRE_MEZCLA_LEN} characters.`, 400);
    }

    // huboCambios is recomputed against the immutable productosOriginales snapshot,
    // so the canonical audit trail survives successive edits.
    const originales = Array.isArray(cedula.productosOriginales)
      ? cedula.productosOriginales
      : [];
    const huboCambios = computeHuboCambios(originales, productosAplicadosEnriched);

    const cedulaUpdate = {
      productosAplicados: productosAplicadosEnriched,
      huboCambios,
      editadaAt: Timestamp.now(),
      editadaPor: req.uid,
      editadaPorNombre: editadaPorNombre || null,
    };
    if (observacionesMezcla != null) {
      cedulaUpdate.observacionesMezcla = observacionesMezcla;
    }

    await db.collection('cedulas').doc(req.params.id).update(cedulaUpdate);

    const response = {
      id: req.params.id,
      productosAplicados: productosAplicadosEnriched,
      huboCambios,
      editadaAt:       cedulaUpdate.editadaAt.toDate().toISOString(),
      editadaPor:      req.uid,
      editadaPorNombre: editadaPorNombre || null,
    };
    if (observacionesMezcla != null) {
      response.observacionesMezcla = observacionesMezcla;
    }
    res.json(response);
  } catch (error) {
    console.error('Error in editar-productos:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to edit cedula.', 500);
  }
});

module.exports = router;
