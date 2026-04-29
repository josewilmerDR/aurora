// Field-records — creación de cédulas.
//
// Sub-archivo del split de routes/field-records.js. Dos puntos de entrada:
//   - POST /api/cedulas        genera cédula(s) desde una scheduled_task
//                              existente; si la tarea cubre múltiples lotes,
//                              divide en una cédula por lote (split lógico)
//   - POST /api/cedulas/manual cédula sin tarea preprogramada — el operador
//                              registra una aplicación reactiva, el sistema
//                              crea la scheduled_task asociada inline
//
// Ambas terminan con la cédula en status='pendiente'. La transición a
// 'en_transito' ocurre en mix.js, y la final 'aplicada_en_campo' en apply.js.

const { Router } = require('express');
const { db, Timestamp, FieldPath } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership, enrichTask } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  MAX_ACTIVITY_LEN, MAX_TECNICO_LEN, MAX_PRODUCTOS,
  MAX_BLOQUES, MAX_CANTIDAD_POR_HA, MAX_FUTURE_DAYS,
  sanitizeStr, sanitizeStrStrict,
  isValidYmd, isWithinFutureLimit, requireRole,
  nextCedulaConsecutivo, nextCedulasConsecutivos,
  serializeCedula, serializeProductoOriginal,
} = require('./helpers');

const router = Router();

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

module.exports = router;
