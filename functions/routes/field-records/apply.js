// Field-records — aplicación en campo (transición en_transito → aplicada).
//
// Sub-archivo del split de routes/field-records.js. Único endpoint pero
// el más grande del dominio: PUT /api/cedulas/:id/aplicada congela en la
// cédula un snapshot completo de la aplicación (productos, bloques,
// hectareas, cosecha, calibración, períodos de carencia/reingreso) y
// marca la scheduled_task asociada como completed cuando todas las
// cédulas hermanas terminaron.
//
// Es read-heavy: cruza productos, lotes/grupos, paquetes, calibraciones,
// maquinaria, siembras y config en un único request para producir el
// snapshot histórico que sobrevive a cambios futuros del catálogo.

const { Router } = require('express');
const { db, Timestamp, FieldPath } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const {
  MAX_SHORT, MAX_OBS_LEN, TIME_RE,
  sanitizeStr, sanitizeStrStrict, requireRole,
} = require('./helpers');

const router = Router();

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

module.exports = router;
