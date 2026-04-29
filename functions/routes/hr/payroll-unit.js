// HR — Planilla por unidad/hora + plantillas reutilizables.
//
// Sub-archivo del split de routes/hr.js. La planilla por unidad permite que
// un encargado registre el avance diario en distintos lotes/labores con
// segmentos (cada uno con su propia unidad: hora, kg, tarea, etc.) y reparta
// el costo por trabajador. Es el flujo más complejo del dominio HR:
//   - 5 endpoints sobre hr_planilla_unidad (CRUD + historial)
//   - 3 endpoints de plantillas (hr_plantillas_planilla) que persisten
//     configuraciones reutilizables por encargado
//
// Helpers locales (enrichPlanilla, sanitizeSegmentos, sanitizeTrabajadores,
// computeWorkerTotal, isHoraUnit) viven aquí — sólo este archivo los usa.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const {
  FECHA_RE,
  PLANILLA_LIMITS,
  PLANILLA_ESTADOS,
  canActOnBehalf,
  trimStr,
  clampNumber,
  resolveAuthUserId,
  loadFichasMap,
  loadUnidadesMap,
  loadUsersMap,
  buildHistoryEntry,
  appendHistory,
  planillaRateLimit,
} = require('./helpers');

const router = Router();

// ─── Helpers locales ─────────────────────────────────────────────────────

const isHoraUnit = (u) => /^horas?$/i.test((u || '').trim());

// Calcula el total por trabajador a través de todos los segmentos.
// Regla idéntica al frontend / snapshot al aprobar.
function computeWorkerTotal(worker, segmentos) {
  return (segmentos || []).reduce((sum, seg) => {
    const cantidad = clampNumber(worker.cantidades?.[seg.id], PLANILLA_LIMITS.numeric);
    if (cantidad <= 0) return sum;
    const horaDirecta = isHoraUnit(seg.unidad);
    const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
    const precio = (horaDirecta || horaConFactor)
      ? (Number(worker.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
      : (Number(seg.costoUnitario) || 0);
    return sum + cantidad * precio;
  }, 0);
}

// Re-deriva precios desde fuentes autoritativas, valida identidades y recalcula
// totales:
// - precioHora viene de hr_fichas (no del cliente).
// - costoUnitario / factorConversion / unidadBase vienen del catálogo
//   unidades_medida cuando la unidad existe ahí; para unidades free-form
//   (sin catalogar), se acepta el valor sanitizado del cliente.
// - trabajadorId DEBE existir en `users` y pertenecer a la finca; los demás
//   se descartan silenciosamente (previene inyectar IDs falsos al snapshot).
// - trabajadorNombre se sobrescribe con el `nombre` canónico de `users`.
async function enrichPlanilla(fincaId, segmentos, trabajadores) {
  const [fichasMap, unidadesMap, usersMap] = await Promise.all([
    loadFichasMap(fincaId),
    loadUnidadesMap(fincaId),
    loadUsersMap(fincaId),
  ]);

  const enrichedSegs = (segmentos || []).map(s => {
    const key = String(s.unidad || '').trim().toLowerCase();
    const cat = key ? unidadesMap.get(key) : null;
    if (!cat) return s; // free-form / no catalogada → respetar valor del cliente
    return {
      ...s,
      // Sólo overridear costoUnitario si el catálogo define un precio explícito.
      costoUnitario: (cat.precio != null && cat.precio !== '')
        ? clampNumber(cat.precio, PLANILLA_LIMITS.numeric)
        : s.costoUnitario,
      factorConversion: cat.factorConversion != null
        ? clampNumber(cat.factorConversion, PLANILLA_LIMITS.numeric)
        : null,
      unidadBase: cat.unidadBase || '',
    };
  });

  const enrichedWorkers = (trabajadores || [])
    .filter(t => t.trabajadorId && usersMap.has(t.trabajadorId))
    .map(t => {
      const userDoc = usersMap.get(t.trabajadorId) || {};
      const ficha = fichasMap.get(t.trabajadorId);
      const precioHora = ficha ? clampNumber(ficha.precioHora, PLANILLA_LIMITS.numeric) : 0;
      const next = {
        ...t,
        // Nombre canónico desde users (no del cliente) — previene falsificación cosmética.
        trabajadorNombre: trimStr(userDoc.nombre, PLANILLA_LIMITS.string),
        precioHora,
      };
      next.total = clampNumber(computeWorkerTotal(next, enrichedSegs), PLANILLA_LIMITS.numeric);
      return next;
    });

  const totalGeneral = clampNumber(
    enrichedWorkers.reduce((s, w) => s + (Number(w.total) || 0), 0),
    PLANILLA_LIMITS.numeric
  );

  return { segmentos: enrichedSegs, trabajadores: enrichedWorkers, totalGeneral, usersMap };
}

// Sanitiza segmentos: tipos, longitudes, números finitos.
function sanitizeSegmentos(segmentos) {
  if (!Array.isArray(segmentos)) return { ok: false, msg: 'segmentos must be an array.' };
  if (segmentos.length > PLANILLA_LIMITS.segmentos)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.segmentos} segmentos.` };
  const cleaned = segmentos.map(s => ({
    id: trimStr(s?.id, 64),
    loteId: trimStr(s?.loteId, 64),
    loteNombre: trimStr(s?.loteNombre, PLANILLA_LIMITS.string),
    labor: trimStr(s?.labor, PLANILLA_LIMITS.string),
    grupo: trimStr(s?.grupo, PLANILLA_LIMITS.string),
    avanceHa: clampNumber(s?.avanceHa, PLANILLA_LIMITS.numeric),
    unidad: trimStr(s?.unidad, PLANILLA_LIMITS.string),
    costoUnitario: clampNumber(s?.costoUnitario, PLANILLA_LIMITS.numeric),
    factorConversion: s?.factorConversion == null ? null : clampNumber(s.factorConversion, PLANILLA_LIMITS.numeric),
    unidadBase: trimStr(s?.unidadBase, PLANILLA_LIMITS.string),
  }));
  return { ok: true, value: cleaned };
}

// Sanitiza trabajadores: tipos, longitudes, cantidades finitas.
function sanitizeTrabajadores(trabajadores) {
  if (!Array.isArray(trabajadores)) return { ok: false, msg: 'trabajadores must be an array.' };
  if (trabajadores.length > PLANILLA_LIMITS.trabajadoresPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.trabajadoresPorPlanilla} trabajadores.` };
  const cleaned = trabajadores.map(t => {
    const cantsIn = (t && typeof t.cantidades === 'object' && t.cantidades) ? t.cantidades : {};
    const cantsOut = {};
    for (const k of Object.keys(cantsIn).slice(0, PLANILLA_LIMITS.segmentos)) {
      const segId = String(k).slice(0, 64);
      cantsOut[segId] = clampNumber(cantsIn[k], PLANILLA_LIMITS.numeric);
    }
    return {
      trabajadorId: trimStr(t?.trabajadorId, 64),
      trabajadorNombre: trimStr(t?.trabajadorNombre, PLANILLA_LIMITS.string),
      precioHora: clampNumber(t?.precioHora, PLANILLA_LIMITS.numeric),
      cantidades: cantsOut,
      total: clampNumber(t?.total, PLANILLA_LIMITS.numeric),
    };
  });
  return { ok: true, value: cleaned };
}

// ─── Endpoints planilla-unidad ──────────────────────────────────────────

router.get('/api/hr/planilla-unidad', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_unidad')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fecha: d.data().fecha ? d.data().fecha.toDate().toISOString() : null,
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planillas.', 500);
  }
});

router.get('/api/hr/planilla-unidad/historial', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_unidad_historial')
      .where('fincaId', '==', req.fincaId)
      .orderBy('aprobadoAt', 'desc')
      .get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fecha:      d.data().fecha?.toDate?.()?.toISOString()      || null,
      aprobadoAt: d.data().aprobadoAt?.toDate?.()?.toISOString() || null,
    }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planilla history.', 500);
  }
});

router.post('/api/hr/planilla-unidad', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { fecha, encargadoId, segmentos, trabajadores, estado, observaciones } = req.body;

    // Type / required / length validation
    if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha (expected YYYY-MM-DD).', 400);
    const fechaDate = new Date(fecha + 'T12:00:00');
    if (Number.isNaN(fechaDate.getTime()))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha.', 400);
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Encargado is required.', 400);
    if (estado != null && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);

    // El cliente no puede crear planillas en nombre de otro encargado salvo
    // que tenga rol supervisor/admin/rrhh.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot create planillas on behalf of another encargado.', 403);

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);

    // Re-derivar precios, validar identidades y recomputar totales desde
    // fuentes autoritativas (hr_fichas + unidades_medida + users).
    const enriched = await enrichPlanilla(req.fincaId, segs.value, tabs.value);

    // Resolver nombre canónico del encargado (no del cliente).
    const encargadoUser = enriched.usersMap.get(encargadoId.trim());
    const encargadoNombreCanon = trimStr(encargadoUser?.nombre, PLANILLA_LIMITS.string);

    // El consecutivo se asigna sólo cuando la planilla deja de ser borrador.
    // Si se guarda como borrador, se crea sin uno para no quemar números.
    const estadoFinal = estado || 'borrador';
    const esBorrador = estadoFinal === 'borrador';
    let consecutivo = null;
    if (!esBorrador) {
      const counterRef = db.collection('counters').doc(`planilla_unidad_${req.fincaId}`);
      await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        const next = counterDoc.exists ? (counterDoc.data().value || 0) + 1 : 1;
        t.set(counterRef, { value: next });
        consecutivo = `PU-${String(next).padStart(5, '0')}`;
      });
    }

    const auditEntry = buildHistoryEntry({
      userId: authUserId,
      email: req.userEmail,
      action: `created:${estadoFinal}`,
    });
    const docData = {
      fincaId: req.fincaId,
      fecha: Timestamp.fromDate(fechaDate),
      encargadoId: trimStr(encargadoId, 64),
      encargadoNombre: encargadoNombreCanon,
      segmentos: enriched.segmentos,
      trabajadores: enriched.trabajadores,
      totalGeneral: enriched.totalGeneral,
      estado: estadoFinal,
      observaciones: trimStr(observaciones, PLANILLA_LIMITS.observaciones),
      createdAt: Timestamp.now(),
      createdBy: { userId: authUserId || null, email: req.userEmail || null },
      history: [auditEntry],
    };
    if (consecutivo) docData.consecutivo = consecutivo;

    const ref = await db.collection('hr_planilla_unidad').add(docData);
    res.status(201).json({ id: ref.id, consecutivo });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create planilla.', 500);
  }
});

router.put('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const { fecha, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;

    // Solo el encargado dueño (o roles superiores) puede editar.
    const currentDoc = ownership.doc.data();
    const docEncargadoId = currentDoc.encargadoId;
    const currentEstado = currentDoc.estado || 'borrador';
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot edit planillas of another encargado.', 403);

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    if (estado === 'aprobada' && !canAprobar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to approve planillas.', 403);
    if (estado === 'pagada' && !canPagar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to pay planillas.', 403);

    // Bloquear rollback desde estados terminales (aprobada / pagada): solo
    // administrador o rrhh pueden modificar planillas ya aprobadas o pagadas.
    const lockedStates = ['aprobada', 'pagada'];
    if (lockedStates.includes(currentEstado) && !isAdminLike) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved/paid; only administrador or rrhh may modify it.', 403);
    }
    // Las transiciones rollback explícitas (aprobada → otro / pagada → otro)
    // las puede hacer admin-like si pasa el guard previo — registra acción
    // intencional, no accidental.

    const update = { updatedAt: Timestamp.now() };
    if (fecha !== undefined) {
      if (typeof fecha !== 'string' || !FECHA_RE.test(fecha))
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha (expected YYYY-MM-DD).', 400);
      const fechaDate = new Date(fecha + 'T12:00:00');
      if (Number.isNaN(fechaDate.getTime()))
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fecha.', 400);
      update.fecha = Timestamp.fromDate(fechaDate);
    }
    let segsClean = null;
    let tabsClean = null;
    if (segmentos !== undefined) {
      const segs = sanitizeSegmentos(segmentos);
      if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
      segsClean = segs.value;
    }
    if (trabajadores !== undefined) {
      const tabs = sanitizeTrabajadores(trabajadores);
      if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);
      tabsClean = tabs.value;
    }
    // Si segmentos o trabajadores vinieron, re-derivar precios y totales desde
    // fuentes autoritativas. Si solo uno fue enviado, completar con el valor
    // existente del doc para que el cómputo sea coherente.
    if (segsClean !== null || tabsClean !== null) {
      const enriched = await enrichPlanilla(
        req.fincaId,
        segsClean !== null ? segsClean : (currentDoc.segmentos || []),
        tabsClean !== null ? tabsClean : (currentDoc.trabajadores || []),
      );
      if (segsClean !== null) update.segmentos = enriched.segmentos;
      if (tabsClean !== null) update.trabajadores = enriched.trabajadores;
      // totalGeneral siempre se recalcula server-side: valor del cliente ignorado.
      update.totalGeneral = enriched.totalGeneral;
      // Resolver nombre canónico del encargado (puede haber cambiado en `users`).
      const encargadoUser = enriched.usersMap.get(docEncargadoId);
      if (encargadoUser) update.encargadoNombre = trimStr(encargadoUser.nombre, PLANILLA_LIMITS.string);
    } else if (totalGeneral !== undefined) {
      // Sólo cambió un campo "metadata" (estado, observaciones) — el cliente
      // pudo recomputar el total localmente; lo aceptamos sanitizado.
      update.totalGeneral = clampNumber(totalGeneral, PLANILLA_LIMITS.numeric);
    }
    if (estado !== undefined) update.estado = estado;
    if (observaciones !== undefined) update.observaciones = trimStr(observaciones, PLANILLA_LIMITS.observaciones);

    // Audit trail: registrar quién modificó y qué tipo de cambio fue.
    const actions = [];
    if (estado !== undefined && estado !== currentEstado) actions.push(`estado:${currentEstado}→${estado}`);
    if (segsClean !== null || tabsClean !== null) actions.push('updated');
    if (observaciones !== undefined && actions.length === 0) actions.push('observaciones');
    if (fecha !== undefined && actions.length === 0) actions.push('fecha');
    if (actions.length > 0) {
      const auditEntry = buildHistoryEntry({
        userId: authUserId,
        email: req.userEmail,
        action: actions.join(','),
      });
      update.history = appendHistory(currentDoc.history, auditEntry);
      update.updatedBy = { userId: authUserId || null, email: req.userEmail || null };
    }

    // Asignar consecutivo si la planilla aún no tiene y está saliendo de borrador.
    let consecutivo = currentDoc.consecutivo || null;
    if (!consecutivo && estado && estado !== 'borrador') {
      const counterRef = db.collection('counters').doc(`planilla_unidad_${req.fincaId}`);
      await db.runTransaction(async (t) => {
        const counterDoc = await t.get(counterRef);
        const next = counterDoc.exists ? (counterDoc.data().value || 0) + 1 : 1;
        t.set(counterRef, { value: next });
        consecutivo = `PU-${String(next).padStart(5, '0')}`;
      });
      update.consecutivo = consecutivo;
    }

    // Snapshot al aprobar
    if (estado === 'aprobada' && !currentDoc.snapshotCreado) {
      // Mergear datos viejos con cambios del body para usar la última versión.
      const doc = { ...currentDoc, ...update };

      // Resolver nombre del aprobador
      let aprobadoPor = req.userEmail;
      const userSnap = await db.collection('users')
        .where('email', '==', req.userEmail)
        .where('fincaId', '==', req.fincaId)
        .limit(1).get();
      if (!userSnap.empty) aprobadoPor = userSnap.docs[0].data().nombre;

      const aprobadoAt = Timestamp.now();
      const segs    = doc.segmentos   || [];
      const workers = doc.trabajadores || [];
      const batch = db.batch();

      workers.forEach(worker => {
        segs.forEach(seg => {
          const cantidad = Number(worker.cantidades?.[seg.id]) || 0;
          if (cantidad <= 0) return;
          const horaDirecta = isHoraUnit(seg.unidad);
          const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
          const costoUnitario = (horaDirecta || horaConFactor)
            ? (Number(worker.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
            : (Number(seg.costoUnitario) || 0);
          const ref = db.collection('hr_planilla_unidad_historial').doc();
          batch.set(ref, {
            fincaId:          req.fincaId,
            planillaId:       req.params.id,
            consecutivo:      doc.consecutivo   || '',
            fecha:            doc.fecha         || null,   // Timestamp
            encargadoNombre:  doc.encargadoNombre || '',
            aprobadoPor,
            aprobadoAt,
            observaciones:    doc.observaciones || '',
            totalGeneral:     Number(doc.totalGeneral) || 0,
            // Segment
            loteNombre:       seg.loteNombre   || '',
            grupo:            seg.grupo        || '',
            labor:            seg.labor        || '',
            avanceHa:         Number(seg.avanceHa) || 0,
            unidad:           seg.unidad       || '',
            costoUnitario,
            // Worker
            trabajadorId:     worker.trabajadorId   || '',
            trabajadorNombre: worker.trabajadorNombre || '',
            cantidad,
            subtotal:         cantidad * costoUnitario,
            totalTrabajador:  Number(worker.total) || 0,
          });
        });
      });

      await batch.commit();
      update.snapshotCreado = true;
    }

    await db.collection('hr_planilla_unidad').doc(req.params.id).update(update);

    // Pago de planilla: dinero real. Auditar con WARNING. Mismo patrón que el
    // handler de fijo: ambos flujos de pago aparecen en el feed igual.
    if (estado === 'pagada' && currentEstado !== 'pagada') {
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.PAYROLL_PAY,
        target: { type: 'planilla_unidad', id: req.params.id },
        metadata: {
          tipo: 'unidad',
          consecutivo: consecutivo || currentDoc.consecutivo || null,
          encargadoNombre: currentDoc.encargadoNombre || null,
          totalGeneral: update.totalGeneral ?? currentDoc.totalGeneral ?? null,
          trabajadoresCount: (update.trabajadores || currentDoc.trabajadores || []).length,
        },
        severity: SEVERITY.WARNING,
      });
    }

    res.status(200).json({ message: 'Planilla updated.', consecutivo });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update planilla.', 500);
  }
});

router.delete('/api/hr/planilla-unidad/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    const docEncargadoId = data.encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot delete planillas of another encargado.', 403);
    // Bloquear delete de aprobada/pagada salvo admin/rrhh.
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    if (['aprobada', 'pagada'].includes(data.estado) && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved/paid; only administrador or rrhh may delete it.', 403);
    await db.collection('hr_planilla_unidad').doc(req.params.id).delete();
    res.status(200).json({ message: 'Planilla deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete planilla.', 500);
  }
});

// ─── Plantillas (templates de planilla por unidad) ──────────────────────

router.get('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const encargadoId = typeof req.query.encargadoId === 'string' ? req.query.encargadoId.trim() : '';
    if (!encargadoId)
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'encargadoId is required.', 400);
    // Solo el encargado dueño o roles superiores pueden listar plantillas ajenas.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot view templates of another encargado.', 403);

    const snap = await db.collection('hr_plantillas_planilla')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', encargadoId)
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch templates.', 500);
  }
});

router.post('/api/hr/plantillas-planilla', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const { nombre, segmentos, trabajadores, encargadoId } = req.body;
    const nombreClean = trimStr(nombre, PLANILLA_LIMITS.nombrePlantilla).trim();
    if (!nombreClean) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Nombre is required.', 400);
    if (typeof encargadoId !== 'string' || !encargadoId.trim())
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Encargado is required.', 400);

    // No permitir guardar plantillas en nombre de otro encargado.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot save templates on behalf of another encargado.', 403);

    const segs = sanitizeSegmentos(segmentos || []);
    if (!segs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, segs.msg, 400);
    const tabs = sanitizeTrabajadores(trabajadores || []);
    if (!tabs.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, tabs.msg, 400);

    const ref = await db.collection('hr_plantillas_planilla').add({
      fincaId: req.fincaId,
      nombre: nombreClean,
      segmentos: segs.value,
      trabajadores: tabs.value,
      encargadoId: trimStr(encargadoId, 64),
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save template.', 500);
  }
});

router.delete('/api/hr/plantillas-planilla/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_plantillas_planilla', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const docEncargadoId = ownership.doc.data().encargadoId;
    const authUserId = await resolveAuthUserId(req);
    if (docEncargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot delete templates of another encargado.', 403);
    await db.collection('hr_plantillas_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Template deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete template.', 500);
  }
});

module.exports = router;
