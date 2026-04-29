// HR — Planilla legacy + Planilla salario fijo.
//
// Sub-archivo del split de routes/hr.js. Cubre dos esquemas de planilla con
// salario fijo:
//   - hr_planilla         → schema legacy (mes/año + total único). Mantenido
//                           para no romper datos históricos; sin features
//                           nuevas en F5.
//   - hr_planilla_fijo    → schema vigente con período custom, filas por
//                           empleado, deducciones, CCSS recalculada, audit
//                           trail e integración con scheduled_tasks para
//                           generar la tarea de aprobación de pago.
//
// La planilla por unidad/hora (hr_planilla_unidad + plantillas) vive en
// payroll-unit.js — son flujos lo suficientemente distintos como para no
// compartir archivo.

const { Router } = require('express');
const { db, Timestamp, twilioWhatsappFrom } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { getTwilioClient } = require('../../lib/clients');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const {
  FECHA_RE,
  PLANILLA_LIMITS,
  PLANILLA_ESTADOS,
  trimStr,
  clampNumber,
  resolveAuthUserId,
  loadFichasMap,
  loadUsersMap,
  buildHistoryEntry,
  appendHistory,
  planillaRateLimit,
} = require('./helpers');

const router = Router();

// ─── Planilla legacy (mes/anio) ──────────────────────────────────────────

router.get('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_planilla').where('fincaId', '==', req.fincaId);
    if (mes) query = query.where('mes', '==', Number(mes));
    if (anio) query = query.where('anio', '==', Number(anio));
    const snap = await query.orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planilla.', 500);
  }
});

router.post('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, mes, anio, diasTrabajados, horasExtra, salarioBase, deducciones, total } = req.body;
    if (!trabajadorId || !mes || !anio) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'trabajadorId, mes and anio are required.', 400);
    const ref = await db.collection('hr_planilla').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      mes: Number(mes), anio: Number(anio),
      diasTrabajados: Number(diasTrabajados) || 0,
      horasExtra: Number(horasExtra) || 0,
      salarioBase: Number(salarioBase) || 0,
      deducciones: Number(deducciones) || 0,
      total: Number(total) || 0,
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save planilla.', 500);
  }
});

router.delete('/api/hr/planilla/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

// ─── Planilla salario fijo (período custom, audit trail) ────────────────

const FIJO_CCSS_RATE = 0.1083;
const FIJO_JORNADA_HORAS_DEFAULT = 48;

// Sanitiza un día de la fila fija: acepta ISO completo o YYYY-MM-DD.
function sanitizeFijoDia(d) {
  const fechaRaw = typeof d?.fecha === 'string' ? d.fecha : '';
  const fechaStr = fechaRaw.slice(0, 10);
  if (!FECHA_RE.test(fechaStr)) return null;
  return {
    fecha: fechaRaw.length >= 10 ? fechaRaw.slice(0, 30) : fechaStr,
    ausente: d?.ausente === true,
    horasParciales: clampNumber(d?.horasParciales, 24),
    salarioExtra: clampNumber(d?.salarioExtra, PLANILLA_LIMITS.numeric),
  };
}

function sanitizeFijoDeduccion(d) {
  return {
    concepto: trimStr(d?.concepto, PLANILLA_LIMITS.conceptoDeduccion).trim(),
    monto: clampNumber(d?.monto, PLANILLA_LIMITS.numeric),
  };
}

// Sanitiza filas de planilla fija. Verifica trabajadorId contra users/fichas
// de la finca y canoniza nombre / cédula / puesto / salarioBase / fechaIngreso
// desde fuentes autoritativas. Descarta filas con trabajadorId inválido.
function sanitizeFijoFilas(filas, usersMap, fichasMap) {
  if (!Array.isArray(filas))
    return { ok: false, msg: 'filas must be an array.' };
  if (filas.length > PLANILLA_LIMITS.filasPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.filasPorPlanilla} employees per planilla.` };

  const cleaned = [];
  for (const f of filas) {
    const trabajadorId = trimStr(f?.trabajadorId, 64);
    if (!trabajadorId || !usersMap.has(trabajadorId)) continue; // descarta silenciosamente

    const userDoc  = usersMap.get(trabajadorId) || {};
    const ficha    = fichasMap.get(trabajadorId) || {};
    const nombre   = trimStr(userDoc.nombre, PLANILLA_LIMITS.string);
    const cedula   = trimStr(ficha.cedula || f?.cedula, 30);
    const puesto   = trimStr(ficha.puesto || f?.puesto, PLANILLA_LIMITS.string);
    const fechaIng = (typeof ficha.fechaIngreso === 'string' && FECHA_RE.test(ficha.fechaIngreso))
      ? ficha.fechaIngreso
      : ((typeof f?.fechaIngreso === 'string' && FECHA_RE.test(f.fechaIngreso)) ? f.fechaIngreso : '');

    // salarioMensual: autoritativo desde ficha si existe; fallback al valor recibido (clamp).
    const salarioMensual = ficha.salarioBase != null
      ? clampNumber(ficha.salarioBase, PLANILLA_LIMITS.numeric)
      : clampNumber(f?.salarioMensual, PLANILLA_LIMITS.numeric);

    // salarioDiario: editable por el usuario (override de salarioMensual/30). Clamp.
    const salarioDiario = clampNumber(f?.salarioDiario, PLANILLA_LIMITS.numeric);

    // horasSemanales: derivar desde ficha.horarioSemanal si existe, si no fallback.
    let horasSemanales = 0;
    const horario = ficha.horarioSemanal;
    if (horario && typeof horario === 'object') {
      const dias = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
      for (const k of dias) {
        const d = horario[k];
        if (!d?.activo || typeof d.inicio !== 'string' || typeof d.fin !== 'string') continue;
        const [h1, m1] = d.inicio.split(':').map(Number);
        const [h2, m2] = d.fin.split(':').map(Number);
        if ([h1, m1, h2, m2].some(n => !Number.isFinite(n))) continue;
        horasSemanales += Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
      }
    }
    if (!(horasSemanales > 0)) horasSemanales = FIJO_JORNADA_HORAS_DEFAULT;
    horasSemanales = clampNumber(horasSemanales, 168); // máx 7*24

    const dias = Array.isArray(f?.dias)
      ? f.dias.slice(0, PLANILLA_LIMITS.diasPorFila).map(sanitizeFijoDia).filter(Boolean)
      : [];
    const deduccionesExtra = Array.isArray(f?.deduccionesExtra)
      ? f.deduccionesExtra.slice(0, PLANILLA_LIMITS.deduccionesPorFila).map(sanitizeFijoDeduccion)
      : [];

    const efectivoDesdeRaw = typeof f?.efectivoDesde === 'string' ? f.efectivoDesde.slice(0, 10) : '';
    const efectivoDesde = FECHA_RE.test(efectivoDesdeRaw) ? efectivoDesdeRaw : '';

    // Totales: confiar en el cómputo del cliente pero clampear.
    const salarioOrdinario      = clampNumber(f?.salarioOrdinario, PLANILLA_LIMITS.numeric);
    const salarioExtraordinario = clampNumber(f?.salarioExtraordinario, PLANILLA_LIMITS.numeric);
    const salarioBruto          = clampNumber(f?.salarioBruto, PLANILLA_LIMITS.numeric);
    // CCSS debe ser consistente con salarioBruto; recalcular server-side.
    const deduccionCCSS         = Math.round(salarioBruto * FIJO_CCSS_RATE);
    const otrasDeduccionesTotal = deduccionesExtra.reduce((s, d) => s + d.monto, 0);
    const totalDeducciones      = deduccionCCSS + otrasDeduccionesTotal;
    const totalNeto             = Math.max(0, salarioBruto - totalDeducciones);

    cleaned.push({
      trabajadorId,
      trabajadorNombre: nombre,
      cedula, puesto,
      fechaIngreso: fechaIng,
      periodoParcial: f?.periodoParcial === true,
      efectivoDesde,
      salarioMensual, salarioDiario,
      horasSemanales,
      dias, deduccionesExtra,
      salarioOrdinario, salarioExtraordinario, salarioBruto,
      deduccionCCSS,
      otrasDeduccionesTotal: Math.round(otrasDeduccionesTotal),
      totalDeducciones: Math.round(totalDeducciones),
      totalNeto: Math.round(totalNeto),
    });
  }
  return { ok: true, value: cleaned };
}

function sumTotalGeneral(filas) {
  const total = (filas || []).reduce((s, f) => s + (Number(f.totalNeto) || 0), 0);
  return clampNumber(total, PLANILLA_LIMITS.numeric);
}

// Valida rango de período (string ISO). Acepta YYYY-MM-DD o ISO datetime
// completo. Devuelve Date objects o ok:false con msg.
function parsePeriodoISO(periodoInicio, periodoFin) {
  if (typeof periodoInicio !== 'string' || typeof periodoFin !== 'string')
    return { ok: false, msg: 'Invalid periodo.' };
  const ini = new Date(periodoInicio);
  const fin = new Date(periodoFin);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime()))
    return { ok: false, msg: 'Invalid dates.' };
  if (fin < ini)
    return { ok: false, msg: 'End date must be equal or later than start date.' };
  const diffDays = Math.floor((fin - ini) / 86400000) + 1;
  if (diffDays > PLANILLA_LIMITS.periodoDiasMax)
    return { ok: false, msg: `periodo cannot exceed ${PLANILLA_LIMITS.periodoDiasMax} days.` };
  return { ok: true, ini, fin };
}

// Solo supervisor/administrador/rrhh pueden crear, editar contenido, borrar
// o cambiar el estado de planillas fijas. Trabajador/encargado solo lectura.
const PLANILLA_FIJO_ROLES_WRITE = ['supervisor', 'administrador', 'rrhh'];
const canEditarFijo = (req) => PLANILLA_FIJO_ROLES_WRITE.includes(req.userRole);

router.get('/api/hr/planilla-fijo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_planilla_fijo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      periodoInicio: d.data().periodoInicio?.toDate().toISOString(),
      periodoFin: d.data().periodoFin?.toDate().toISOString(),
      createdAt: d.data().createdAt?.toDate().toISOString(),
    }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planillas.', 500);
  }
});

router.post('/api/hr/planilla-fijo', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to create planillas.', 403);

    const { periodoInicio, periodoFin, periodoLabel, filas } = req.body;
    const periodo = parsePeriodoISO(periodoInicio, periodoFin);
    if (!periodo.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, periodo.msg, 400);

    const [usersMap, fichasMap] = await Promise.all([
      loadUsersMap(req.fincaId),
      loadFichasMap(req.fincaId),
    ]);
    const san = sanitizeFijoFilas(filas, usersMap, fichasMap);
    if (!san.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, san.msg, 400);
    if (san.value.length === 0)
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Planilla must contain at least one valid employee.', 400);

    const totalGeneral = sumTotalGeneral(san.value);
    const labelClean = trimStr(periodoLabel, PLANILLA_LIMITS.string);

    // Generar consecutivo atómico PL-00001, PL-00002, ...
    const counterRef = db.collection('counters').doc(`planilla_fijo_${req.fincaId}`);
    const nextNum = await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      const next = (counterDoc.exists ? (counterDoc.data().last || 0) : 0) + 1;
      t.set(counterRef, { last: next }, { merge: true });
      return next;
    });
    const numeroConsecutivo = `PL-${String(nextNum).padStart(5, '0')}`;

    const authUserId = await resolveAuthUserId(req);
    const ref = await db.collection('hr_planilla_fijo').add({
      periodoInicio: Timestamp.fromDate(periodo.ini),
      periodoFin: Timestamp.fromDate(periodo.fin),
      periodoLabel: labelClean,
      filas: san.value,
      totalGeneral,
      estado: 'pendiente',
      numeroConsecutivo,
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
      createdBy: { userId: authUserId || null, email: req.userEmail || null },
      history: [buildHistoryEntry({ userId: authUserId, email: req.userEmail, action: 'created:pendiente' })],
    });

    // Notificar supervisores/admins vía WhatsApp (best-effort).
    try {
      const client = getTwilioClient();
      const usersSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('rol', 'in', ['supervisor', 'administrador'])
        .get();
      const total = totalGeneral.toLocaleString('es-CR');
      const body = `📋 *Planilla Pendiente de Pago*\nPeríodo: ${labelClean}\nTotal a pagar: ₡${total}\nRevise y apruebe el pago en el sistema Aurora.`;
      const from = `whatsapp:${twilioWhatsappFrom.value()}`;
      const notifPromises = [];
      usersSnap.forEach(doc => {
        const u = doc.data();
        if (u.telefono) {
          const to = `whatsapp:${u.telefono.replace(/\s+/g, '')}`;
          notifPromises.push(
            client.messages.create({ body, from, to })
              .catch(e => console.warn('Notif planilla fallida para', u.nombre, e.message))
          );
        }
      });
      await Promise.all(notifPromises);
    } catch (notifErr) {
      console.warn('Failed to send planilla notifications:', notifErr.message);
    }

    // Crear tarea de dashboard sin asignar para aprobación de pago.
    await db.collection('scheduled_tasks').add({
      type: 'PLANILLA_PAGO',
      status: 'pending',
      executeAt: Timestamp.now(),
      fincaId: req.fincaId,
      planillaId: ref.id,
      activity: {
        name: `Aprobar pago de planilla: ${labelClean}`,
        responsableId: null,
        responsableNombre: 'Sin asignar',
      },
    });

    res.status(201).json({ id: ref.id, numeroConsecutivo });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save planilla.', 500);
  }
});

router.put('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { estado, filas, periodoInicio, periodoFin, periodoLabel } = req.body;
    const currentDoc = ownership.doc.data();
    const currentEstado = currentDoc.estado || 'pendiente';

    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    const isAdminLike = canPagar;

    // Solo roles de write pueden modificar planillas fijas.
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to modify planillas.', 403);

    if (estado !== undefined && !PLANILLA_ESTADOS.includes(estado))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid estado.', 400);
    if (estado === 'aprobada' && !canAprobar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to approve planillas.', 403);
    if (estado === 'pagada' && !canPagar)
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to pay planillas.', 403);

    // Una vez pagada, solo admin/rrhh puede modificar (reverso contable).
    if (currentEstado === 'pagada' && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already paid; only administrador or rrhh may modify it.', 403);

    // Aprobada: solo transición a pagada, o modificaciones de admin/rrhh.
    if (currentEstado === 'aprobada' && !isAdminLike && estado !== 'pagada')
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Planilla already approved; only admin/rrhh may modify outside of pay transition.', 403);

    const update = { updatedAt: Timestamp.now() };

    // Cambio de período (solo con nuevas filas, para evitar inconsistencia).
    if (periodoInicio !== undefined || periodoFin !== undefined) {
      const periodo = parsePeriodoISO(
        periodoInicio || currentDoc.periodoInicio?.toDate().toISOString(),
        periodoFin    || currentDoc.periodoFin?.toDate().toISOString(),
      );
      if (!periodo.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, periodo.msg, 400);
      update.periodoInicio = Timestamp.fromDate(periodo.ini);
      update.periodoFin    = Timestamp.fromDate(periodo.fin);
    }
    if (periodoLabel !== undefined)
      update.periodoLabel = trimStr(periodoLabel, PLANILLA_LIMITS.string);

    if (filas !== undefined) {
      const [usersMap, fichasMap] = await Promise.all([
        loadUsersMap(req.fincaId),
        loadFichasMap(req.fincaId),
      ]);
      const san = sanitizeFijoFilas(filas, usersMap, fichasMap);
      if (!san.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, san.msg, 400);
      if (san.value.length === 0)
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Planilla must contain at least one valid employee.', 400);
      update.filas = san.value;
      update.totalGeneral = sumTotalGeneral(san.value);
    }

    if (estado !== undefined) update.estado = estado;

    // Audit trail
    const authUserId = await resolveAuthUserId(req);
    const actions = [];
    if (estado !== undefined && estado !== currentEstado) actions.push(`estado:${currentEstado}→${estado}`);
    if (filas !== undefined) actions.push('filas');
    if ((periodoInicio !== undefined || periodoFin !== undefined) && actions.length === 0) actions.push('periodo');
    if (periodoLabel !== undefined && actions.length === 0) actions.push('label');
    if (actions.length > 0) {
      update.history = appendHistory(currentDoc.history, buildHistoryEntry({
        userId: authUserId, email: req.userEmail, action: actions.join(','),
      }));
      update.updatedBy = { userId: authUserId || null, email: req.userEmail || null };
    }

    await db.collection('hr_planilla_fijo').doc(req.params.id).update(update);

    // Si se marca como pagada, completar la tarea de dashboard asociada.
    if (estado === 'pagada') {
      const taskSnap = await db.collection('scheduled_tasks')
        .where('fincaId', '==', req.fincaId)
        .where('planillaId', '==', req.params.id)
        .where('type', '==', 'PLANILLA_PAGO')
        .limit(1).get();
      if (!taskSnap.empty) {
        await taskSnap.docs[0].ref.update({ status: 'completed_by_user' });
      }

      // Pago de planilla: dinero real. Auditar siempre con WARNING.
      writeAuditEvent({
        fincaId: req.fincaId,
        actor: req,
        action: ACTIONS.PAYROLL_PAY,
        target: { type: 'planilla_fijo', id: req.params.id },
        metadata: {
          tipo: 'fijo',
          periodoLabel: currentDoc.periodoLabel || update.periodoLabel || null,
          totalGeneral: update.totalGeneral ?? currentDoc.totalGeneral ?? null,
          empleadosCount: (update.filas || currentDoc.filas || []).length,
        },
        severity: SEVERITY.WARNING,
      });
    }

    res.status(200).json({ id: req.params.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update planilla.', 500);
  }
});

router.delete('/api/hr/planilla-fijo/:id', authenticate, planillaRateLimit(), async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_fijo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    const estadoActual = data.estado || 'pendiente';
    const isAdminLike = ['administrador', 'rrhh'].includes(req.userRole);
    // Solo pendientes son borrables libremente por roles de write.
    if (!canEditarFijo(req))
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to delete planillas.', 403);
    if (['aprobada', 'pagada'].includes(estadoActual) && !isAdminLike)
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Approved or paid planillas can only be deleted by admin/rrhh.', 403);

    await db.collection('hr_planilla_fijo').doc(req.params.id).delete();
    const taskSnap = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('planillaId', '==', req.params.id)
      .where('type', '==', 'PLANILLA_PAGO')
      .limit(1).get();
    if (!taskSnap.empty) {
      await taskSnap.docs[0].ref.delete();
    }
    res.status(200).json({ message: 'Planilla deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete planilla.', 500);
  }
});

module.exports = router;
