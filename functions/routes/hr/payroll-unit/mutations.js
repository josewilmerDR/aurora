// HR/payroll-unit — POST + PUT + DELETE de planillas por unidad.
//
// Sub-archivo del split de routes/hr/payroll-unit.js. Concentra los
// mutadores del estado de planilla:
//
//   POST   /api/hr/planilla-unidad      crea planilla (asigna consecutivo
//                                        sólo cuando deja de ser borrador)
//   PUT    /api/hr/planilla-unidad/:id  edita; al pasar a 'aprobada' por
//                                        primera vez, materializa snapshot
//                                        immutable en hr_planilla_unidad_historial;
//                                        al pasar a 'pagada' emite audit WARNING
//                                        (PAYROLL_PAY)
//   DELETE /api/hr/planilla-unidad/:id  borra; bloquea aprobada/pagada salvo admin/rrhh
//
// Reglas de autorización clave:
//   - Encargado dueño puede crear/editar/borrar la suya
//   - Solo supervisor+ pueden actuar en nombre de otro encargado
//   - Solo supervisor/admin/rrhh pueden aprobar
//   - Solo administrador/rrhh pueden pagar o modificar planillas terminales

const { Router } = require('express');
const { db, Timestamp } = require('../../../lib/firebase');
const { authenticate } = require('../../../lib/middleware');
const { verifyOwnership } = require('../../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../../lib/auditLog');
const {
  FECHA_RE,
  PLANILLA_LIMITS,
  PLANILLA_ESTADOS,
  canActOnBehalf,
  trimStr,
  clampNumber,
  resolveAuthUserId,
  buildHistoryEntry,
  appendHistory,
  planillaRateLimit,
} = require('../helpers');
const {
  isHoraUnit,
  enrichPlanilla,
  sanitizeSegmentos,
  sanitizeTrabajadores,
} = require('./helpers');

const router = Router();

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

module.exports = router;
