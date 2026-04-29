const { Router } = require('express');
const { db, Timestamp, FieldValue, FieldPath } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, enrichTask, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// ── VALIDATION HELPERS ──────────────────────────────────────────────────────
const MAX_STR = 200;
const MAX_SHORT = 60;
const MAX_ACTIVITY_LEN = 64;
const MAX_TECNICO_LEN = 48;
const MAX_PRODUCTOS = 50;
const MAX_BLOQUES = 500;
const MAX_CANTIDAD_POR_HA = 100000;
const MAX_OBS_LEN = 500;
// Limits specific to the Edit / Mezcla Lista modal — aligned with the
// frontend (MezclaListaModal.jsx). We don't reuse MAX_OBS_LEN because other
// endpoints (e.g. aplicada) keep the historical limit.
const MAX_OBS_MEZCLA_LEN = 288;
const MAX_NOMBRE_MEZCLA_LEN = 48;
const MAX_FUTURE_DAYS = 1825; // hard cap: ~5 years
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MOTIVOS_CAMBIO = new Set(['sustitucion', 'ajuste_dosis', 'otro']);

const sanitizeStr = (v, max = MAX_STR) => {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

// Like sanitizeStr, but rejects (returns null) when the value exceeds the max,
// instead of silently truncating. Used for fields with a hard cap that is also
// validated on the frontend.
const sanitizeStrStrict = (v, max) => {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
};

const isValidYmd = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime());
};

// True if the YYYY-MM-DD date is within the allowed range (<= today + MAX_FUTURE_DAYS).
const isWithinFutureLimit = (ymd) => {
  const sel = new Date(ymd + 'T12:00:00');
  if (isNaN(sel.getTime())) return false;
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  const diffDays = Math.round((sel - hoy) / 86400000);
  return diffDays <= MAX_FUTURE_DAYS;
};

const requireRole = (req, res, min) => {
  if (!hasMinRoleBE(req.userRole, min)) {
    sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role for this action.', 403);
    return false;
  }
  return true;
};

// ── LOCAL HELPERS ───────────────────────────────────────────────────────────

async function nextCedulaConsecutivo(fincaId) {
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  let consecutivo;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { ultimo: next }, { merge: true });
    consecutivo = `#CA-${String(next).padStart(5, '0')}`;
  });
  return consecutivo;
}

async function nextCedulasConsecutivos(fincaId, count) {
  if (count <= 1) return [await nextCedulaConsecutivo(fincaId)];
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  const consecutivos = [];
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    tx.set(counterRef, { ultimo: current + count }, { merge: true });
    for (let i = 0; i < count; i++) {
      consecutivos.push(`#CA-${String(current + 1 + i).padStart(5, '0')}`);
    }
  });
  return consecutivos;
}

const serializeCedula = (id, data) => ({
  id,
  ...data,
  generadaAt:        data.generadaAt?.toDate?.()?.toISOString()        || null,
  mezclaListaAt:     data.mezclaListaAt?.toDate?.()?.toISOString()     || null,
  aplicadaAt:        data.aplicadaAt?.toDate?.()?.toISOString()        || null,
  modificadaEnMezclaAt: data.modificadaEnMezclaAt?.toDate?.()?.toISOString() || null,
  editadaAt:         data.editadaAt?.toDate?.()?.toISOString()         || null,
});

// Snapshot of a product from the original plan (task.activity.productos) to
// store in cedula.productosOriginales when the cédula is created. Never changes afterwards.
const serializeProductoOriginal = (p) => {
  if (!p) return null;
  const cant = p.cantidadPorHa !== undefined
    ? parseFloat(p.cantidadPorHa)
    : (p.cantidad !== undefined ? parseFloat(p.cantidad) : null);
  return {
    productoId: p.productoId || null,
    nombreComercial: p.nombreComercial || '',
    cantidadPorHa: Number.isFinite(cant) ? cant : null,
    unidad: p.unidad || '',
    periodoReingreso: p.periodoReingreso ?? null,
    periodoACosecha: p.periodoACosecha ?? null,
  };
};

// Validates and enriches a productosAplicados array from the PUT mezcla-lista body.
// Throws { status, message } on error so the caller can catch and respond to the client.
async function validateAndEnrichProductosAplicados(input, fincaId) {
  if (!Array.isArray(input)) {
    throw { status: 400, message: 'productosAplicados must be an array.' };
  }
  if (input.length === 0) {
    throw { status: 400, message: 'productosAplicados cannot be empty.' };
  }
  if (input.length > MAX_PRODUCTOS) {
    throw { status: 400, message: `Maximum ${MAX_PRODUCTOS} products per cedula.` };
  }
  const enriched = [];
  for (const p of input) {
    if (!p || typeof p.productoId !== 'string' || !p.productoId) {
      throw { status: 400, message: 'Invalid product in productosAplicados.' };
    }
    const cant = parseFloat(p.cantidadPorHa);
    if (!Number.isFinite(cant) || cant <= 0 || cant > MAX_CANTIDAD_POR_HA) {
      throw { status: 400, message: `Invalid dose/Ha for product ${p.productoId}.` };
    }
    const doc = await db.collection('productos').doc(p.productoId).get();
    if (!doc.exists || doc.data().fincaId !== fincaId) {
      throw { status: 400, message: `Product ${p.productoId} not found.` };
    }
    const info = doc.data();
    const row = {
      productoId: p.productoId,
      nombreComercial: info.nombreComercial || '',
      cantidadPorHa: cant,
      unidad: info.unidad || '',
      periodoReingreso: info.periodoReingreso ?? null,
      periodoACosecha: info.periodoACosecha ?? null,
    };
    if (p.motivoCambio != null && p.motivoCambio !== '') {
      if (typeof p.motivoCambio !== 'string' || !MOTIVOS_CAMBIO.has(p.motivoCambio)) {
        throw { status: 400, message: `Invalid motivoCambio: ${p.motivoCambio}.` };
      }
      row.motivoCambio = p.motivoCambio;
    }
    if (p.productoOriginalId != null && p.productoOriginalId !== '') {
      if (typeof p.productoOriginalId !== 'string') {
        throw { status: 400, message: 'Invalid productoOriginalId.' };
      }
      row.productoOriginalId = p.productoOriginalId;
    }
    enriched.push(row);
  }
  return enriched;
}

// Compares productosOriginales vs productosAplicados ignoring motivos and metadata,
// detecting differences in productoId or cantidadPorHa.
function computeHuboCambios(originales, aplicados) {
  if (!Array.isArray(originales) || !Array.isArray(aplicados)) return true;
  if (originales.length !== aplicados.length) return true;
  const sig = (arr) => arr
    .map(p => `${p.productoId || ''}|${p.cantidadPorHa ?? ''}`)
    .sort()
    .join(',');
  return sig(originales) !== sig(aplicados);
}

// ── ROUTES ──────────────────────────────────────────────────────────────────

router.get('/api/cedulas', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const snap = await db.collection('cedulas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('generadaAt', 'desc')
      .get();
    res.json(snap.docs.map(d => serializeCedula(d.id, d.data())));
  } catch (error) {
    console.error('Error fetching cedulas:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedulas.', 500);
  }
});

router.get('/api/cedulas/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    const cedula = serializeCedula(ownership.doc.id, data);

    if (data.snap_calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(data.snap_calibracionId).get();
      if (calDoc.exists) {
        cedula.calibracion = { id: calDoc.id, ...calDoc.data() };
        const cal = calDoc.data();
        const maqIds = [cal.aplicadorId, cal.tractorId].filter(Boolean);
        if (maqIds.length > 0) {
          const maqDocs = await Promise.all(maqIds.map(mid => db.collection('maquinaria').doc(mid).get()));
          const maqMap = {};
          maqDocs.forEach(d => { if (d.exists) maqMap[d.id] = d.data(); });
          cedula.calibracionAplicador = cal.aplicadorId ? (maqMap[cal.aplicadorId] || null) : null;
          cedula.calibracionTractor   = cal.tractorId   ? (maqMap[cal.tractorId]   || null) : null;
        }
      }
    }

    res.json(cedula);
  } catch (error) {
    console.error('Error fetching cedula by id:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedula.', 500);
  }
});

router.post('/api/cedulas', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const { taskId } = req.body || {};
    if (typeof taskId !== 'string' || !taskId.trim()) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'taskId is required.', 400);
    }

    const ownership = await verifyOwnership('scheduled_tasks', taskId, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const existing = await db.collection('cedulas')
      .where('taskId', '==', taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    // Block only if active (non-voided) cedulas exist; if all were voided allow regeneration
    const activeExisting = existing.docs.filter(d => d.data().status !== 'anulada');
    if (activeExisting.length > 0) {
      return res.status(409).json({
        code: ERROR_CODES.CONFLICT, message: 'This task already has generated cedulas.',
        cedulas: activeExisting.map(d => serializeCedula(d.id, d.data())),
      });
    }

    const taskData = ownership.doc.data();
    if (taskData.grupoId && !taskData.loteId) {
      const grupoDoc = await db.collection('grupos').doc(taskData.grupoId).get();
      const grupoData = grupoDoc.exists ? grupoDoc.data() : {};
      const allBloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
        ? taskData.bloques
        : (Array.isArray(grupoData.bloques) ? grupoData.bloques : []);
      if (allBloqueIds.length > 0) {
        const allBloques = [];
        for (let i = 0; i < allBloqueIds.length; i += 10) {
          const chunk = allBloqueIds.slice(i, i + 10);
          const snap = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
          snap.docs.forEach(d => allBloques.push({ id: d.id, ...d.data() }));
        }
        const loteMap = {};
        for (const b of allBloques) {
          const key = b.loteNombre || b.loteId || '_sin_lote';
          if (!loteMap[key]) loteMap[key] = [];
          loteMap[key].push(b.id);
        }
        const loteEntries = Object.entries(loteMap);
        if (loteEntries.length > 1) {
          const productosOriginalesSplit = Array.isArray(taskData.activity?.productos)
            ? taskData.activity.productos.map(serializeProductoOriginal).filter(Boolean)
            : [];
          const consecutivos = await nextCedulasConsecutivos(req.fincaId, loteEntries.length);
          const batch = db.batch();
          const now = Timestamp.now();
          const cedulasCreated = [];
          loteEntries.forEach(([loteNombre, bloqueIds], i) => {
            const ref = db.collection('cedulas').doc();
            const cedula = {
              consecutivo: consecutivos[i],
              taskId,
              fincaId: req.fincaId,
              status: 'pendiente',
              generadaAt: now,
              generadaPor: req.uid,
              mezclaListaAt: null,
              mezclaListaPor: null,
              aplicadaAt: null,
              aplicadaPor: null,
              splitLoteNombre: loteNombre,
              splitBloqueIds: bloqueIds,
              productosOriginales: productosOriginalesSplit,
            };
            batch.set(ref, cedula);
            cedulasCreated.push(serializeCedula(ref.id, cedula));
          });
          await batch.commit();
          return res.status(201).json(cedulasCreated);
        }
      }
    }

    const productosOriginales = Array.isArray(taskData.activity?.productos)
      ? taskData.activity.productos.map(serializeProductoOriginal).filter(Boolean)
      : [];

    const consecutivo = await nextCedulaConsecutivo(req.fincaId);
    const cedula = {
      consecutivo,
      taskId,
      fincaId: req.fincaId,
      status: 'pendiente',
      generadaAt: Timestamp.now(),
      generadaPor: req.uid,
      mezclaListaAt: null,
      mezclaListaPor: null,
      aplicadaAt: null,
      aplicadaPor: null,
      productosOriginales,
    };
    const docRef = await db.collection('cedulas').add(cedula);
    res.status(201).json(serializeCedula(docRef.id, cedula));
  } catch (error) {
    console.error('Error creating cedula:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to generate cedula.', 500);
  }
});

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

router.put('/api/cedulas/:id/aplicada', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'trabajador')) return;

    const body = req.body || {};
    // Range and format validation before touching DB
    if (body.temperatura != null && body.temperatura !== '') {
      const t = Number(body.temperatura);
      if (!Number.isFinite(t) || t < -60 || t > 70) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Temperature out of range (-60 to 70 °C).', 400);
      }
    }
    if (body.humedadRelativa != null && body.humedadRelativa !== '') {
      const h = Number(body.humedadRelativa);
      if (!Number.isFinite(h) || h < 0 || h > 100) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Relative humidity out of range (0 to 100 %).', 400);
      }
    }
    if (body.horaInicio && !TIME_RE.test(body.horaInicio)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid start time (HH:MM).', 400);
    }
    if (body.horaFinal && !TIME_RE.test(body.horaFinal)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid end time (HH:MM).', 400);
    }
    if (body.horaInicio && body.horaFinal && body.horaInicio >= body.horaFinal) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Start time must be before end time.', 400);
    }

    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const cedula = ownership.doc.data();
    if (cedula.status !== 'en_transito') {
      return sendApiError(res, ERROR_CODES.CONFLICT, `Cedula is not in en_transito state (current: ${cedula.status}).`, 409);
    }

    const taskDoc = await db.collection('scheduled_tasks').doc(cedula.taskId).get();
    const taskData = taskDoc.exists ? taskDoc.data() : {};

    let sourceData = null, sourceType = null, sourceId = null;
    if (taskData.loteId) {
      const d = await db.collection('lotes').doc(taskData.loteId).get();
      if (d.exists) { sourceData = d.data(); sourceType = 'lote'; sourceId = taskData.loteId; }
    } else if (taskData.grupoId) {
      const d = await db.collection('grupos').doc(taskData.grupoId).get();
      if (d.exists) { sourceData = d.data(); sourceType = 'grupo'; sourceId = taskData.grupoId; }
    }

    let pkgData = null;
    if (sourceData?.paqueteId) {
      const d = await db.collection('packages').doc(sourceData.paqueteId).get();
      if (d.exists) pkgData = d.data();
    }

    const configDoc = await db.collection('config').doc(req.fincaId).get();
    const configData = configDoc.exists ? configDoc.data() : {};

    let calData = null;
    let calibracionId = taskData.activity?.calibracionId || cedula.calibracionId || null;
    if (!calibracionId && pkgData?.activities) {
      const actName = taskData.activity?.name;
      const actDay  = taskData.activity?.day;
      const pkgAct  = pkgData.activities.find(a =>
        (actName && a.name === actName) || (actDay != null && String(a.day) === String(actDay))
      );
      calibracionId = pkgAct?.calibracionId || null;
    }
    if (calibracionId) {
      const d = await db.collection('calibraciones').doc(calibracionId).get();
      if (d.exists) calData = { id: d.id, ...d.data() };
    }

    let litrosAplicador = null;
    if (calData?.aplicadorId) {
      const d = await db.collection('maquinaria').doc(calData.aplicadorId).get();
      if (d.exists) litrosAplicador = parseFloat(d.data().capacidad) || null;
    }

    const allBloqueIds = (Array.isArray(taskData.bloques) && taskData.bloques.length > 0)
      ? taskData.bloques
      : (Array.isArray(sourceData?.bloques) ? sourceData.bloques : []);
    const bloqueIds = (cedula.splitBloqueIds?.length > 0) ? cedula.splitBloqueIds : allBloqueIds;
    let bloquesList = [];
    if (bloqueIds.length > 0) {
      for (let i = 0; i < bloqueIds.length; i += 10) {
        const chunk = bloqueIds.slice(i, i + 10);
        const snap = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
        snap.docs.forEach(d => bloquesList.push({ id: d.id, ...d.data() }));
      }
    }

    // If the cedula has productosAplicados (mezcla-lista adjustment), the snapshot
    // must reflect what was ACTUALLY applied, not what the package scheduled.
    const productos = (Array.isArray(cedula.productosAplicados) && cedula.productosAplicados.length > 0)
      ? cedula.productosAplicados
      : (taskData.activity?.productos || []);
    const productoIds = [...new Set(productos.map(p => p.productoId).filter(Boolean))];
    const catMap = {};
    for (let i = 0; i < productoIds.length; i += 10) {
      const chunk = productoIds.slice(i, i + 10);
      const snap = await db.collection('productos').where(FieldPath.documentId(), 'in', chunk).get();
      snap.docs.forEach(d => { catMap[d.id] = d.data(); });
    }

    const areaHa = bloquesList.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0)
                || parseFloat(sourceData?.hectareas || 0) || 0;
    const totalPlantas = bloquesList.reduce((s, b) => s + (Number(b.plantas) || 0), 0);

    const cosecha = sourceData?.cosecha || pkgData?.tipoCosecha || '';
    const etapa   = sourceData?.etapa   || pkgData?.etapaCultivo || '';

    const PARAM_DEFAULTS = { diasSiembraICosecha: 400, diasForzaICosecha: 150, diasChapeaIICosecha: 215, diasForzaIICosecha: 150 };
    const cfg = { ...PARAM_DEFAULTS, ...configData };
    let fechaCosecha = null;
    if (sourceData?.fechaCreacion) {
      let dias = null;
      if      (cosecha === 'I Cosecha'  && etapa === 'Desarrollo')   dias = cfg.diasSiembraICosecha;
      else if (cosecha === 'I Cosecha'  && etapa === 'Postforza')    dias = cfg.diasForzaICosecha;
      else if (cosecha === 'II Cosecha' && etapa === 'Desarrollo')   dias = cfg.diasChapeaIICosecha;
      else if (cosecha === 'II Cosecha' && etapa === 'Postforza')    dias = cfg.diasForzaIICosecha;
      if (dias != null) {
        const base = sourceData.fechaCreacion.toDate ? sourceData.fechaCreacion.toDate() : new Date(sourceData.fechaCreacion);
        const fc = new Date(base);
        fc.setUTCDate(fc.getUTCDate() + Number(dias));
        fechaCosecha = fc.toISOString().split('T')[0];
      }
    }

    const volumenPorHa = calData ? (parseFloat(calData.volumen) || null) : null;
    const totalBoones  = (volumenPorHa && litrosAplicador && areaHa)
      ? (volumenPorHa * areaHa) / litrosAplicador : null;

    let periodoCarenciaMax = 0, periodoReingresoMax = 0;
    const productosSnap = productos.map(prod => {
      const cat = catMap[prod.productoId] || {};
      const cantPorHa = prod.cantidadPorHa !== undefined
        ? parseFloat(prod.cantidadPorHa)
        : (prod.cantidad !== undefined ? parseFloat(prod.cantidad) : null);
      const total = cantPorHa != null && areaHa ? parseFloat((cantPorHa * areaHa).toFixed(4)) : null;
      const perCarencia  = Number(cat.periodoACosecha)  || 0;
      const perReingreso = Number(cat.periodoReingreso) || 0;
      if (perCarencia  > periodoCarenciaMax)  periodoCarenciaMax  = perCarencia;
      if (perReingreso > periodoReingresoMax) periodoReingresoMax = perReingreso;
      let cantBoom = null, cantFraccion = null;
      if (cantPorHa != null && volumenPorHa && litrosAplicador && totalBoones) {
        cantBoom = parseFloat(((cantPorHa * litrosAplicador) / volumenPorHa).toFixed(4));
        const fracDecimal = totalBoones % 1;
        cantFraccion = fracDecimal > 0 ? parseFloat((cantBoom * fracDecimal).toFixed(4)) : null;
      }
      const row = {
        productoId: prod.productoId || null,
        idProducto: cat.idProducto || null,
        nombreComercial: cat.nombreComercial || prod.nombreComercial || null,
        ingredienteActivo: cat.ingredienteActivo || null,
        cantidadPorHa: cantPorHa,
        unidad: cat.unidad || prod.unidad || null,
        total,
        precioUnitario: parseFloat(cat.precioUnitario) || null,
        moneda: cat.moneda || null,
        periodoCarencia:  perCarencia  || null,
        periodoReingreso: perReingreso || null,
        cantBoom,
        cantFraccion,
      };
      if (prod.motivoCambio)       row.motivoCambio       = prod.motivoCambio;
      if (prod.productoOriginalId) row.productoOriginalId = prod.productoOriginalId;
      return row;
    });

    const bloquesSnap = bloquesList.map(b => ({
      id: b.id,
      bloque:        b.bloque        || null,
      loteNombre:    b.loteNombre    || null,
      areaCalculada: parseFloat(b.areaCalculada) || null,
      plantas:       Number(b.plantas) || null,
    }));

    const snapDueDate = taskData.executeAt
      ? (taskData.executeAt.toDate ? taskData.executeAt.toDate().toISOString().split('T')[0] : taskData.executeAt)
      : null;
    const snapFechaCreacionGrupo = sourceData?.fechaCreacion
      ? (sourceData.fechaCreacion.toDate ? sourceData.fechaCreacion.toDate().toISOString().split('T')[0] : sourceData.fechaCreacion)
      : null;

    // Free-text application observations: do NOT affect products or inventory.
    let observacionesAplicacion = null;
    if (body.observacionesAplicacion != null && body.observacionesAplicacion !== '') {
      observacionesAplicacion = sanitizeStrStrict(body.observacionesAplicacion, MAX_OBS_LEN);
      if (observacionesAplicacion == null) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Observations cannot exceed ${MAX_OBS_LEN} characters.`, 400);
      }
    }

    const sobrante          = body.sobrante === true;
    const sobranteLoteId    = sanitizeStr(body.sobranteLoteId);
    const sobranteLoteNombre = sanitizeStr(body.sobranteLoteNombre);
    const condicionesTiempo = sanitizeStr(body.condicionesTiempo, MAX_SHORT);
    const operario          = sanitizeStr(body.operario);
    const metodoAplicacion  = sanitizeStr(body.metodoAplicacion);
    const encargadoFinca    = sanitizeStr(body.encargadoFinca);
    const encargadoBodega   = sanitizeStr(body.encargadoBodega);
    const supAplicaciones   = sanitizeStr(body.supAplicaciones);
    const horaInicio        = body.horaInicio || null;
    const horaFinal         = body.horaFinal  || null;
    const temperatura       = (body.temperatura != null && body.temperatura !== '') ? Number(body.temperatura) : null;
    const humedadRelativa   = (body.humedadRelativa != null && body.humedadRelativa !== '') ? Number(body.humedadRelativa) : null;

    // Verify ownership of sobranteLoteId if provided
    if (sobrante && sobranteLoteId) {
      const loteOwn = await verifyOwnership('lotes', sobranteLoteId, req.fincaId);
      if (!loteOwn.ok) return sendApiError(res, loteOwn.code, loteOwn.message, loteOwn.status);
    }

    const updateData = {
      status: 'aplicada_en_campo',
      aplicadaAt: Timestamp.now(),
      aplicadaPor: req.uid,
      sobrante,
      metodoAplicacion: metodoAplicacion || calData?.metodo || null,
      encargadoFinca:   encargadoFinca   || null,
      encargadoBodega:  encargadoBodega  || null,
      supAplicaciones:  supAplicaciones  || pkgData?.tecnicoResponsable || null,
      snap_activityName:         taskData.activity?.name || null,
      snap_dueDate:              snapDueDate,
      snap_fechaCosecha:         taskData.type === 'MANUAL' ? (cedula.snap_fechaCosecha       || null) : fechaCosecha,
      snap_fechaCreacionGrupo:   taskData.type === 'MANUAL' ? (cedula.snap_fechaCreacionGrupo || null) : snapFechaCreacionGrupo,
      snap_sourceType:           sourceType,
      snap_sourceName:           taskData.type === 'MANUAL'
        ? (cedula.snap_sourceName || null)
        : (sourceData?.nombreGrupo || sourceData?.nombreLote || null),
      snap_cosecha:              taskData.type === 'MANUAL' ? (cedula.snap_cosecha || null) : (cosecha || null),
      snap_etapa:                taskData.type === 'MANUAL' ? (cedula.snap_etapa   || null) : (etapa   || null),
      snap_paqueteTecnico:       pkgData?.nombrePaquete || null,
      snap_areaHa:               areaHa  || null,
      snap_totalPlantas:         totalPlantas || null,
      snap_periodoCarenciaMax:   periodoCarenciaMax  || null,
      snap_periodoReingresoMax:  periodoReingresoMax || null,
      snap_calibracionId:        calibracionId       || null,
      snap_calibracionNombre:    calData?.nombre     || null,
      snap_volumenPorHa:         volumenPorHa,
      snap_litrosAplicador:      litrosAplicador,
      snap_totalBoones:          totalBoones != null ? parseFloat(totalBoones.toFixed(2)) : null,
      snap_productos:            productosSnap,
      snap_bloques:              bloquesSnap,
    };
    if (sobrante) {
      if (sobranteLoteId)     updateData.sobranteLoteId     = sobranteLoteId;
      if (sobranteLoteNombre) updateData.sobranteLoteNombre = sobranteLoteNombre;
    }
    if (condicionesTiempo != null) updateData.condicionesTiempo = condicionesTiempo;
    if (temperatura     != null && Number.isFinite(temperatura))     updateData.temperatura     = temperatura;
    if (humedadRelativa != null && Number.isFinite(humedadRelativa)) updateData.humedadRelativa = humedadRelativa;
    if (horaInicio) updateData.horaInicio = horaInicio;
    if (horaFinal)  updateData.horaFinal  = horaFinal;
    if (operario)   updateData.operario   = operario;
    if (observacionesAplicacion != null) updateData.observacionesAplicacion = observacionesAplicacion;

    const siblingsSnap = await db.collection('cedulas')
      .where('taskId', '==', cedula.taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    const allSiblingsApplied = siblingsSnap.docs.every(d => {
      if (d.id === req.params.id) return true;
      const s = d.data().status;
      return s === 'aplicada_en_campo' || s === 'anulada';
    });

    const batch = db.batch();
    batch.update(db.collection('cedulas').doc(req.params.id), updateData);
    if (allSiblingsApplied) {
      batch.update(db.collection('scheduled_tasks').doc(cedula.taskId), {
        status: 'completed_by_user',
        completedAt: Timestamp.now(),
        cedulaId: req.params.id,
      });
    }
    await batch.commit();
    res.json({ id: req.params.id, status: 'aplicada_en_campo' });
  } catch (error) {
    console.error('Error in cedula aplicada:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register the application.', 500);
  }
});

router.post('/api/cedulas/manual', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;

    const body = req.body || {};
    const fecha = body.fecha;
    const activityName = sanitizeStrStrict(body.activityName, MAX_ACTIVITY_LEN);
    const loteId  = sanitizeStr(body.loteId);
    const grupoId = sanitizeStr(body.grupoId);
    const bloques = Array.isArray(body.bloques) ? body.bloques : null;
    const productos = Array.isArray(body.productos) ? body.productos : null;
    const calibracionId = sanitizeStr(body.calibracionId);
    // tecnicoResponsable is optional: if present but exceeds the cap, reject.
    const tecnicoRaw = body.tecnicoResponsable;
    const tecnicoProvided = typeof tecnicoRaw === 'string' && tecnicoRaw.trim().length > 0;
    const tecnicoResponsable = tecnicoProvided
      ? sanitizeStrStrict(tecnicoRaw, MAX_TECNICO_LEN)
      : null;
    if (tecnicoProvided && !tecnicoResponsable) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Technician name too long (max ${MAX_TECNICO_LEN}).`, 400);
    }

    if (!fecha || !isValidYmd(fecha)) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fecha is required (YYYY-MM-DD).', 400);
    }
    if (!isWithinFutureLimit(fecha)) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Date cannot exceed ${MAX_FUTURE_DAYS} days in the future.`, 400);
    }
    if (!activityName) {
      if (typeof body.activityName === 'string' && body.activityName.trim().length > MAX_ACTIVITY_LEN) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Activity name too long (max ${MAX_ACTIVITY_LEN}).`, 400);
      }
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Activity name is required.', 400);
    }
    if (!loteId && !grupoId) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'A lote or grupo must be specified.', 400);
    }
    if (!productos || productos.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'At least one product is required.', 400);
    }
    if (productos.length > MAX_PRODUCTOS) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Maximum ${MAX_PRODUCTOS} products per cedula.`, 400);
    }
    if (bloques && bloques.length > MAX_BLOQUES) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Maximum ${MAX_BLOQUES} bloques.`, 400);
    }
    if (bloques && !bloques.every(b => typeof b === 'string' && b.length > 0)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid bloques list.', 400);
    }
    for (const p of productos) {
      if (!p || typeof p.productoId !== 'string' || !p.productoId) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid product.', 400);
      }
      const cant = parseFloat(p.cantidadPorHa);
      if (!Number.isFinite(cant) || cant <= 0 || cant > MAX_CANTIDAD_POR_HA) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, `Invalid dose/Ha for product ${p.productoId}.`, 400);
      }
    }

    if (loteId) {
      const o = await verifyOwnership('lotes', loteId, req.fincaId);
      if (!o.ok) return sendApiError(res, o.code, o.message, o.status);
    } else {
      const o = await verifyOwnership('grupos', grupoId, req.fincaId);
      if (!o.ok) return sendApiError(res, o.code, o.message, o.status);
    }

    if (calibracionId) {
      const o = await verifyOwnership('calibraciones', calibracionId, req.fincaId);
      if (!o.ok) return sendApiError(res, o.code, o.message, o.status);
    }

    // Validate ownership of each productoId and enrich
    const enrichedProductos = [];
    for (const p of productos) {
      const doc = await db.collection('productos').doc(p.productoId).get();
      if (!doc.exists || doc.data().fincaId !== req.fincaId) {
        return sendApiError(res, ERROR_CODES.NOT_FOUND, `Product ${p.productoId} not found.`, 400);
      }
      const info = doc.data();
      enrichedProductos.push({
        productoId: p.productoId,
        nombreComercial: info.nombreComercial || '',
        cantidadPorHa: parseFloat(p.cantidadPorHa),
        unidad: info.unidad || '',
        periodoReingreso: info.periodoReingreso ?? null,
        periodoACosecha: info.periodoACosecha ?? null,
      });
    }

    const executeAt = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    const taskData = {
      type: 'MANUAL',
      status: 'pending',
      fincaId: req.fincaId,
      ...(loteId ? { loteId } : { grupoId }),
      ...(bloques && bloques.length > 0 ? { bloques } : {}),
      activity: { name: activityName, type: 'aplicacion', productos: enrichedProductos, ...(calibracionId ? { calibracionId } : {}) },
      executeAt,
      createdAt: Timestamp.now(),
    };
    const taskRef = await db.collection('scheduled_tasks').add(taskData);

    let calData = null;
    let litrosAplicador = null;
    if (calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(calibracionId).get();
      if (calDoc.exists) {
        calData = { id: calDoc.id, ...calDoc.data() };
        if (calData.aplicadorId) {
          const maqDoc = await db.collection('maquinaria').doc(calData.aplicadorId).get();
          if (maqDoc.exists) litrosAplicador = parseFloat(maqDoc.data().capacidad) || null;
        }
      }
    }

    let snapSourceName = 'N/A';
    let snapCosecha = null, snapEtapa = null, snapFechaCosecha = null, snapFechaCreacionGrupo = null;
    if (bloques && bloques.length > 0 && loteId) {
      const [siembrasSnap, gruposSnap, configDoc] = await Promise.all([
        db.collection('siembras').where('loteId', '==', loteId).get(),
        db.collection('grupos').where('fincaId', '==', req.fincaId).get(),
        db.collection('config').doc(req.fincaId).get(),
      ]);
      const configData = configDoc.exists ? configDoc.data() : {};
      const PARAM_DEFAULTS = { diasSiembraICosecha: 400, diasForzaICosecha: 150, diasChapeaIICosecha: 215, diasForzaIICosecha: 150 };
      const cfg = { ...PARAM_DEFAULTS, ...configData };

      const loteBloqueIds = new Set(siembrasSnap.docs.map(d => d.id));
      const selectedSet   = new Set(bloques);
      let matchedData = null, matchCount = 0;
      for (const gDoc of gruposSnap.docs) {
        const gData   = gDoc.data();
        const gInLote = (gData.bloques || []).filter(id => loteBloqueIds.has(id));
        if (gInLote.length === 0) continue;
        const gSet = new Set(gInLote);
        if (selectedSet.size === gSet.size && [...selectedSet].every(id => gSet.has(id))) {
          matchCount++;
          matchedData = gData;
        }
      }
      if (matchCount === 1 && matchedData) {
        snapSourceName = matchedData.nombreGrupo || 'N/A';
        snapCosecha    = matchedData.cosecha || null;
        snapEtapa      = matchedData.etapa   || null;
        const fc = matchedData.fechaCreacion;
        snapFechaCreacionGrupo = fc?.toDate ? fc.toDate().toISOString().split('T')[0] : (fc || null);
        if (fc && snapCosecha && snapEtapa) {
          let dias = null;
          if      (snapCosecha === 'I Cosecha'  && snapEtapa === 'Desarrollo')  dias = cfg.diasSiembraICosecha;
          else if (snapCosecha === 'I Cosecha'  && snapEtapa === 'Postforza')   dias = cfg.diasForzaICosecha;
          else if (snapCosecha === 'II Cosecha' && snapEtapa === 'Desarrollo')  dias = cfg.diasChapeaIICosecha;
          else if (snapCosecha === 'II Cosecha' && snapEtapa === 'Postforza')   dias = cfg.diasForzaIICosecha;
          if (dias != null) {
            const base = fc.toDate ? fc.toDate() : new Date(fc);
            const d = new Date(base);
            d.setDate(d.getDate() + dias);
            snapFechaCosecha = d.toISOString().split('T')[0];
          }
        }
      }
    }

    const productosOriginalesManual = enrichedProductos.map(serializeProductoOriginal).filter(Boolean);

    const consecutivo = await nextCedulaConsecutivo(req.fincaId);
    const cedulaData = {
      consecutivo,
      taskId: taskRef.id,
      fincaId: req.fincaId,
      status: 'pendiente',
      generadaAt: Timestamp.now(),
      generadaPor: req.uid,
      mezclaListaAt: null,
      mezclaListaPor: null,
      aplicadaAt: null,
      aplicadaPor: null,
      productosOriginales: productosOriginalesManual,
      snap_sourceName:           snapSourceName,
      snap_sourceType:           'lote',
      snap_cosecha:              snapCosecha,
      snap_etapa:                snapEtapa,
      snap_fechaCosecha:         snapFechaCosecha,
      snap_fechaCreacionGrupo:   snapFechaCreacionGrupo,
      snap_calibracionId:     calData?.id           || null,
      snap_calibracionNombre: calData?.nombre        || null,
      snap_volumenPorHa:      calData ? (parseFloat(calData.volumen) || null) : null,
      snap_litrosAplicador:   litrosAplicador,
      ...(tecnicoResponsable ? { tecnicoResponsable } : {}),
    };
    const cedulaRef = await db.collection('cedulas').add(cedulaData);

    const enrichedTask = await enrichTask(await taskRef.get());
    res.status(201).json({ cedula: serializeCedula(cedulaRef.id, cedulaData), task: enrichedTask });
  } catch (error) {
    console.error('Error creating manual cedula:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create cedula.', 500);
  }
});

router.put('/api/cedulas/:id/anular', authenticate, async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const cedula = ownership.doc.data();
    if (cedula.status === 'aplicada_en_campo') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot void a cedula that has already been applied in the field.', 409);
    }
    if (cedula.status === 'anulada') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cedula is already voided.', 409);
    }

    const batch = db.batch();

    if (cedula.status === 'en_transito') {
      const movSnap = await db.collection('movimientos')
        .where('cedulaId', '==', req.params.id)
        .where('fincaId', '==', req.fincaId)
        .get();

      const reversalPorProducto = {};
      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso' && d.productoId) {
          reversalPorProducto[d.productoId] = (reversalPorProducto[d.productoId] || 0) + d.cantidad;
        }
      }
      for (const [productoId, total] of Object.entries(reversalPorProducto)) {
        batch.update(db.collection('productos').doc(productoId), {
          stockActual: FieldValue.increment(total),
        });
      }
      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso') {
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: d.productoId,
            nombreComercial: d.nombreComercial,
            cantidad: d.cantidad,
            unidad: d.unidad,
            fecha: Timestamp.now(),
            motivo: `Anulación cédula ${cedula.consecutivo}`,
            tareaId: cedula.taskId,
            cedulaId: req.params.id,
            cedulaConsecutivo: cedula.consecutivo,
            loteId: d.loteId || null,
            grupoId: d.grupoId || null,
            loteNombre: d.loteNombre || '',
            fincaId: req.fincaId,
          });
        }
      }
    }

    batch.update(db.collection('cedulas').doc(req.params.id), {
      status: 'anulada',
      anuladaAt: Timestamp.now(),
      anuladaPor: req.uid,
    });
    const siblingsSnap = await db.collection('cedulas')
      .where('taskId', '==', cedula.taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    const allInactive = siblingsSnap.docs.every(d => {
      if (d.id === req.params.id) return true;
      const s = d.data().status;
      return s === 'anulada' || s === 'aplicada_en_campo';
    });
    if (allInactive) {
      const anyApplied = siblingsSnap.docs.some(d =>
        d.id !== req.params.id && d.data().status === 'aplicada_en_campo'
      );
      batch.update(db.collection('scheduled_tasks').doc(cedula.taskId), {
        status: anyApplied ? 'completed_by_user' : 'skipped',
      });
    }
    await batch.commit();
    res.json({ id: req.params.id, status: 'anulada' });
  } catch (error) {
    console.error('Error anulando cedula:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to void cedula.', 500);
  }
});

module.exports = router;
