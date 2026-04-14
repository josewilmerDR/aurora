const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { getTwilioClient } = require('../lib/clients');
const { twilioWhatsappFrom } = require('../lib/firebase');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: RECURSOS HUMANOS
// ─────────────────────────────────────────────────────────────────────────────

// ── Fichas del Trabajador ────────────────────────────────────────────────────
const FICHA_TIPOS_CONTRATO = ['permanente', 'temporal', 'por_obra'];
const FICHA_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const PHONE_RE_FICHA = /^[\d\s+\-()]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FICHA_LIMITS = {
  puesto: 80, departamento: 80, cedula: 30, direccion: 200,
  contactoEmergencia: 80, telefonoEmergencia: 20, notas: 2000,
};
const FICHA_SALARIO_MAX = 10_000_000;

function validateFichaPayload(body) {
  const allowed = [
    'puesto', 'departamento', 'fechaIngreso', 'tipoContrato',
    'salarioBase', 'precioHora', 'cedula', 'encargadoId',
    'direccion', 'contactoEmergencia', 'telefonoEmergencia',
    'notas', 'horarioSemanal',
  ];
  const clean = {};
  for (const k of allowed) if (body[k] !== undefined) clean[k] = body[k];

  const errs = [];
  for (const [k, max] of Object.entries(FICHA_LIMITS)) {
    if (typeof clean[k] === 'string') {
      clean[k] = clean[k].trim();
      if (clean[k].length > max) errs.push(`${k} excede ${max} caracteres.`);
    } else if (clean[k] != null) {
      errs.push(`${k} debe ser texto.`);
    }
  }
  if (typeof clean.telefonoEmergencia === 'string' && clean.telefonoEmergencia && !PHONE_RE_FICHA.test(clean.telefonoEmergencia)) {
    errs.push('Teléfono de emergencia inválido.');
  }

  if (clean.fechaIngreso !== undefined && clean.fechaIngreso !== '' && clean.fechaIngreso !== null) {
    if (typeof clean.fechaIngreso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(clean.fechaIngreso)) {
      errs.push('Fecha de ingreso inválida.');
    } else {
      const d = new Date(clean.fechaIngreso);
      if (Number.isNaN(d.getTime())) errs.push('Fecha de ingreso inválida.');
    }
  }

  if (clean.tipoContrato != null && clean.tipoContrato !== '' && !FICHA_TIPOS_CONTRATO.includes(clean.tipoContrato)) {
    errs.push('Tipo de contrato inválido.');
  }

  for (const k of ['salarioBase', 'precioHora']) {
    if (clean[k] === '' || clean[k] == null) { clean[k] = null; continue; }
    const n = Number(clean[k]);
    if (!Number.isFinite(n) || n < 0 || n > FICHA_SALARIO_MAX) {
      errs.push(`${k} debe ser un número entre 0 y ${FICHA_SALARIO_MAX}.`);
    } else {
      clean[k] = n;
    }
  }

  if (clean.encargadoId != null && typeof clean.encargadoId !== 'string') {
    errs.push('encargadoId inválido.');
  }

  if (clean.horarioSemanal !== undefined) {
    if (clean.horarioSemanal == null || typeof clean.horarioSemanal !== 'object' || Array.isArray(clean.horarioSemanal)) {
      errs.push('horarioSemanal inválido.');
    } else {
      const norm = {};
      for (const d of FICHA_DIAS) {
        const day = clean.horarioSemanal[d];
        const activo = !!(day && day.activo === true);
        const inicio = day && typeof day.inicio === 'string' ? day.inicio : '';
        const fin = day && typeof day.fin === 'string' ? day.fin : '';
        if (activo) {
          if (!TIME_RE.test(inicio) || !TIME_RE.test(fin)) { errs.push(`Horario de ${d} inválido.`); continue; }
          const [h1, m1] = inicio.split(':').map(Number);
          const [h2, m2] = fin.split(':').map(Number);
          if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push(`Salida ≤ entrada en ${d}.`);
        }
        norm[d] = { activo, inicio, fin };
      }
      clean.horarioSemanal = norm;
    }
  }

  return { errs, clean };
}

router.get('/api/hr/fichas', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId).get();
    const data = snap.docs.map(d => ({ userId: d.id, ...d.data() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener fichas.' });
  }
});

router.get('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    const doc = await db.collection('hr_fichas').doc(req.params.userId).get();
    if (!doc.exists) return res.status(200).json({});
    if (doc.data().fincaId && doc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener ficha.' });
  }
});

router.put('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists || userDoc.data().fincaId !== req.fincaId) {
      return res.status(403).json({ message: 'Acceso no autorizado.' });
    }
    const { errs, clean } = validateFichaPayload(req.body || {});
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });
    if (clean.encargadoId) {
      const encDoc = await db.collection('users').doc(clean.encargadoId).get();
      if (!encDoc.exists || encDoc.data().fincaId !== req.fincaId) {
        return res.status(400).json({ message: 'Encargado no válido.' });
      }
    }
    await db.collection('hr_fichas').doc(req.params.userId).set(
      { ...clean, fincaId: req.fincaId, updatedAt: Timestamp.now() },
      { merge: true }
    );
    res.status(200).json({ message: 'Ficha actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar ficha.' });
  }
});

// ── Asistencia ───────────────────────────────────────────────────────────────
router.get('/api/hr/asistencia', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_asistencia').where('fincaId', '==', req.fincaId);
    if (mes && anio) {
      const start = Timestamp.fromDate(new Date(Number(anio), Number(mes) - 1, 1));
      const end   = Timestamp.fromDate(new Date(Number(anio), Number(mes), 1));
      query = query.where('fecha', '>=', start).where('fecha', '<', end);
    }
    const snap = await query.orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener asistencia.' });
  }
});

router.post('/api/hr/asistencia', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, estado, horasExtra, notas } = req.body;
    if (!trabajadorId || !fecha || !estado) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_asistencia').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      estado, horasExtra: Number(horasExtra) || 0, notas: notas || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar asistencia.' });
  }
});

router.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar registro.' });
  }
});

// ── Horas Extra ──────────────────────────────────────────────────────────────
router.get('/api/hr/horas-extra', authenticate, async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let query = db.collection('hr_horas_extra').where('fincaId', '==', req.fincaId);
    if (mes && anio) {
      const start = Timestamp.fromDate(new Date(Number(anio), Number(mes) - 1, 1));
      const end   = Timestamp.fromDate(new Date(Number(anio), Number(mes), 1));
      query = query.where('fecha', '>=', start).where('fecha', '<', end);
    }
    const snap = await query.orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener horas extra.' });
  }
});

router.post('/api/hr/horas-extra', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, fecha, horas, motivo } = req.body;
    if (!trabajadorId || !fecha || !horas) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_horas_extra').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      horas: Number(horas), motivo: motivo || '',
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar horas extra.' });
  }
});

router.delete('/api/hr/horas-extra/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_horas_extra').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Permisos y Vacaciones ────────────────────────────────────────────────────
const PERMISO_TIPOS = ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'];
const PERMISO_ESTADOS = ['pendiente', 'aprobado', 'rechazado'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERMISO_MOTIVO_MAX = 500;
const PERMISO_NOMBRE_MAX = 120;

function validatePermisoPayload(body) {
  const errs = [];
  const clean = {};

  clean.trabajadorId = typeof body.trabajadorId === 'string' ? body.trabajadorId.trim() : '';
  if (!clean.trabajadorId) errs.push('Trabajador requerido.');

  clean.trabajadorNombre = typeof body.trabajadorNombre === 'string'
    ? body.trabajadorNombre.trim().slice(0, PERMISO_NOMBRE_MAX) : '';

  clean.tipo = typeof body.tipo === 'string' ? body.tipo : '';
  if (!PERMISO_TIPOS.includes(clean.tipo)) errs.push('Tipo inválido.');

  clean.fechaInicio = typeof body.fechaInicio === 'string' ? body.fechaInicio : '';
  if (!DATE_RE.test(clean.fechaInicio) || Number.isNaN(new Date(clean.fechaInicio).getTime())) {
    errs.push('Fecha inicio inválida.');
  }

  clean.esParcial = body.esParcial === true;

  let fechaFin = typeof body.fechaFin === 'string' ? body.fechaFin : clean.fechaInicio;
  if (clean.esParcial) fechaFin = clean.fechaInicio;
  if (!DATE_RE.test(fechaFin) || Number.isNaN(new Date(fechaFin).getTime())) {
    errs.push('Fecha fin inválida.');
  } else if (DATE_RE.test(clean.fechaInicio) && fechaFin < clean.fechaInicio) {
    errs.push('Fecha fin no puede ser anterior a fecha inicio.');
  }
  clean.fechaFin = fechaFin;

  if (clean.esParcial) {
    const hi = typeof body.horaInicio === 'string' ? body.horaInicio : '';
    const hf = typeof body.horaFin === 'string' ? body.horaFin : '';
    if (!TIME_RE.test(hi) || !TIME_RE.test(hf)) {
      errs.push('Hora inicio/fin inválida.');
    } else {
      const [h1, m1] = hi.split(':').map(Number);
      const [h2, m2] = hf.split(':').map(Number);
      if ((h2 * 60 + m2) <= (h1 * 60 + m1)) errs.push('Hora fin debe ser posterior a hora inicio.');
    }
    clean.horaInicio = hi;
    clean.horaFin = hf;
    const horas = Number(body.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 24) errs.push('Horas debe estar entre 0 y 24.');
    clean.horas = Number.isFinite(horas) ? horas : 0;
    clean.dias = 0;
  } else {
    clean.horaInicio = null;
    clean.horaFin = null;
    clean.horas = 0;
    const dias = Number(body.dias);
    if (!Number.isFinite(dias) || dias < 1 || dias > 365) errs.push('Días debe estar entre 1 y 365.');
    clean.dias = Number.isFinite(dias) ? dias : 0;
  }

  clean.motivo = typeof body.motivo === 'string'
    ? body.motivo.trim().slice(0, PERMISO_MOTIVO_MAX) : '';

  clean.conGoce = body.conGoce !== false;

  return { errs, clean };
}

router.get('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_permisos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaInicio', 'desc').get();
    const data = snap.docs.map(d => {
      const dt = d.data();
      return {
        id: d.id, ...dt,
        fechaInicio: dt.fechaInicio?.toDate ? dt.fechaInicio.toDate().toISOString() : null,
        fechaFin:    dt.fechaFin?.toDate    ? dt.fechaFin.toDate().toISOString()    : null,
        createdAt:   dt.createdAt?.toDate   ? dt.createdAt.toDate().toISOString()   : null,
      };
    });
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener permisos.' });
  }
});

router.post('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const { errs, clean } = validatePermisoPayload(req.body || {});
    if (errs.length) return res.status(400).json({ message: errs.join(' ') });

    const workerDoc = await db.collection('users').doc(clean.trabajadorId).get();
    if (!workerDoc.exists || workerDoc.data().fincaId !== req.fincaId) {
      return res.status(400).json({ message: 'Trabajador no válido.' });
    }

    const ref = await db.collection('hr_permisos').add({
      trabajadorId: clean.trabajadorId,
      trabajadorNombre: clean.trabajadorNombre || workerDoc.data().nombre || '',
      tipo: clean.tipo,
      fechaInicio: Timestamp.fromDate(new Date(clean.fechaInicio + 'T12:00:00')),
      fechaFin:    Timestamp.fromDate(new Date(clean.fechaFin    + 'T12:00:00')),
      dias: clean.dias,
      esParcial: clean.esParcial,
      horaInicio: clean.horaInicio,
      horaFin:    clean.horaFin,
      horas:      clean.horas,
      motivo: clean.motivo,
      conGoce: clean.conGoce,
      estado: 'pendiente',
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear permiso.' });
  }
});

router.put('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const estado = (req.body || {}).estado;
    if (!PERMISO_ESTADOS.includes(estado)) {
      return res.status(400).json({ message: 'Estado inválido.' });
    }
    if ((estado === 'aprobado' || estado === 'rechazado') && !hasMinRoleBE(req.userRole, 'supervisor')) {
      return res.status(403).json({ message: 'No tienes permisos para aprobar o rechazar.' });
    }

    await db.collection('hr_permisos').doc(req.params.id).update({
      estado, updatedAt: Timestamp.now(),
    });
    res.status(200).json({ message: 'Permiso actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar permiso.' });
  }
});

router.delete('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_permisos', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return res.status(403).json({ message: 'No tienes permisos para eliminar.' });
    }
    await db.collection('hr_permisos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Permiso eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar permiso.' });
  }
});

// ── Planilla ─────────────────────────────────────────────────────────────────
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
    res.status(500).json({ message: 'Error al obtener planilla.' });
  }
});

router.post('/api/hr/planilla', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, mes, anio, diasTrabajados, horasExtra, salarioBase, deducciones, total } = req.body;
    if (!trabajadorId || !mes || !anio) return res.status(400).json({ message: 'Faltan campos requeridos.' });
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
    res.status(500).json({ message: 'Error al guardar planilla.' });
  }
});

router.delete('/api/hr/planilla/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Planilla Salario Fijo ─────────────────────────────────────────────────────
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
    res.status(500).json({ message: 'Error al obtener planillas.' });
  }
});

router.post('/api/hr/planilla-fijo', authenticate, async (req, res) => {
  try {
    const { periodoInicio, periodoFin, periodoLabel, filas, totalGeneral } = req.body;
    if (!periodoInicio || !periodoFin || !filas)
      return res.status(400).json({ message: 'Faltan campos requeridos.' });

    // Generate atomic consecutive number PL-00001, PL-00002, ...
    const counterRef = db.collection('counters').doc(`planilla_fijo_${req.fincaId}`);
    const nextNum = await db.runTransaction(async (t) => {
      const counterDoc = await t.get(counterRef);
      const next = (counterDoc.exists ? (counterDoc.data().last || 0) : 0) + 1;
      t.set(counterRef, { last: next }, { merge: true });
      return next;
    });
    const numeroConsecutivo = `PL-${String(nextNum).padStart(5, '0')}`;

    const ref = await db.collection('hr_planilla_fijo').add({
      periodoInicio: Timestamp.fromDate(new Date(periodoInicio)),
      periodoFin: Timestamp.fromDate(new Date(periodoFin)),
      periodoLabel: periodoLabel || '',
      filas,
      totalGeneral: Number(totalGeneral) || 0,
      estado: 'pendiente',
      numeroConsecutivo,
      fincaId: req.fincaId,
      createdAt: Timestamp.now(),
    });

    // Notify supervisors/admins via WhatsApp
    try {
      const client = getTwilioClient();
      const usersSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('rol', 'in', ['supervisor', 'administrador'])
        .get();
      const total = Number(totalGeneral).toLocaleString('es-CR');
      const body = `📋 *Planilla Pendiente de Pago*\nPeríodo: ${periodoLabel}\nTotal a pagar: ₡${total}\nRevise y apruebe el pago en el sistema Aurora.`;
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
      console.warn('Error al enviar notificaciones de planilla:', notifErr.message);
    }

    // Create an unassigned dashboard task for payroll approval
    await db.collection('scheduled_tasks').add({
      type: 'PLANILLA_PAGO',
      status: 'pending',
      executeAt: Timestamp.now(),
      fincaId: req.fincaId,
      planillaId: ref.id,
      activity: {
        name: `Aprobar pago de planilla: ${periodoLabel || ''}`,
        responsableId: null,
        responsableNombre: 'Sin asignar',
      },
    });

    res.status(201).json({ id: ref.id, numeroConsecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar planilla.' });
  }
});

router.put('/api/hr/planilla-fijo/:id', authenticate, async (req, res) => {
  try {
    const { estado, filas, totalGeneral, periodoInicio, periodoFin, periodoLabel } = req.body;

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

    const update = { updatedAt: Timestamp.now() };
    if (estado) update.estado = estado;
    if (filas) {
      update.filas = filas;
      update.totalGeneral = Number(totalGeneral) || 0;
    }
    if (periodoInicio) update.periodoInicio = Timestamp.fromDate(new Date(periodoInicio));
    if (periodoFin)    update.periodoFin    = Timestamp.fromDate(new Date(periodoFin));
    if (periodoLabel)  update.periodoLabel  = periodoLabel;
    await db.collection('hr_planilla_fijo').doc(req.params.id).update(update);

    // If marking as pagada, complete the associated dashboard task
    if (estado === 'pagada') {
      const taskSnap = await db.collection('scheduled_tasks')
        .where('fincaId', '==', req.fincaId)
        .where('planillaId', '==', req.params.id)
        .where('type', '==', 'PLANILLA_PAGO')
        .limit(1).get();
      if (!taskSnap.empty) {
        await taskSnap.docs[0].ref.update({ status: 'completed_by_user' });
      }
    }

    res.status(200).json({ id: req.params.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar planilla.' });
  }
});

router.delete('/api/hr/planilla-fijo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_planilla_fijo').doc(req.params.id).delete();
    // Also delete the associated dashboard task
    const taskSnap = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('planillaId', '==', req.params.id)
      .where('type', '==', 'PLANILLA_PAGO')
      .limit(1).get();
    if (!taskSnap.empty) {
      await taskSnap.docs[0].ref.delete();
    }
    res.status(200).json({ message: 'Planilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar planilla.' });
  }
});

// ── Memorándums ───────────────────────────────────────────────────────────────
router.get('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_memorandums')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener memorándums.' });
  }
});

router.post('/api/hr/memorandums', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, tipo, motivo, descripcion, fecha } = req.body;
    if (!trabajadorId || !tipo || !motivo) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_memorandums').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      motivo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear memorándum.' });
  }
});

router.delete('/api/hr/memorandums/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_memorandums').doc(req.params.id).delete();
    res.status(200).json({ message: 'Memorándum eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Documentos Adjuntos ───────────────────────────────────────────────────────
router.get('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_documentos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fecha', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fecha: d.data().fecha.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener documentos.' });
  }
});

router.post('/api/hr/documentos', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, nombre, tipo, descripcion, fecha } = req.body;
    if (!trabajadorId || !nombre || !tipo) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_documentos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '',
      nombre, tipo, descripcion: descripcion || '',
      fecha: fecha ? Timestamp.fromDate(new Date(fecha + 'T12:00:00')) : Timestamp.now(),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar documento.' });
  }
});

router.delete('/api/hr/documentos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_documentos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Documento eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

// ── Subordinados (trabajadores asignados a un encargado) ──────────────────────
router.get('/api/hr/subordinados', authenticate, async (req, res) => {
  try {
    const { encargadoId } = req.query;
    if (!encargadoId) return res.status(400).json({ message: 'encargadoId es requerido.' });
    const fichasSnap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', encargadoId)
      .get();
    const trabajadorIds = fichasSnap.docs.map(d => d.id);
    if (trabajadorIds.length === 0) return res.status(200).json([]);
    const usersSnap = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const subordinados = usersSnap.docs
      .filter(d => trabajadorIds.includes(d.id))
      .map(d => ({ id: d.id, ...d.data() }));
    res.status(200).json(subordinados);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener subordinados.' });
  }
});

// ── Planilla por Unidad / Hora ────────────────────────────────────────────────
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
    res.status(500).json({ message: 'Error al obtener planillas.' });
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
    res.status(500).json({ message: 'Error al obtener historial de planillas.' });
  }
});

router.post('/api/hr/planilla-unidad', authenticate, async (req, res) => {
  try {
    const { fecha, encargadoId, encargadoNombre, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;
    if (!fecha || !encargadoId) return res.status(400).json({ message: 'Fecha y encargado son requeridos.' });

    // El consecutivo solo se asigna cuando la planilla sale del estado borrador.
    // Si se guarda como borrador, se crea sin consecutivo para no desperdiciar números.
    const esBorrador = !estado || estado === 'borrador';
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

    const docData = {
      fincaId: req.fincaId,
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      encargadoId, encargadoNombre: encargadoNombre || '',
      segmentos: segmentos || [],
      trabajadores: trabajadores || [],
      totalGeneral: Number(totalGeneral) || 0,
      estado: estado || 'borrador',
      observaciones: observaciones || '',
      createdAt: Timestamp.now(),
    };
    if (consecutivo) docData.consecutivo = consecutivo;

    const ref = await db.collection('hr_planilla_unidad').add(docData);
    res.status(201).json({ id: ref.id, consecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear planilla.' });
  }
});

router.put('/api/hr/planilla-unidad/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const { fecha, segmentos, trabajadores, totalGeneral, estado, observaciones } = req.body;

    // Role checks for state transitions
    const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(req.userRole);
    const canPagar   = ['administrador', 'rrhh'].includes(req.userRole);
    if (estado === 'aprobada' && !canAprobar)
      return res.status(403).json({ message: 'No tienes permisos para aprobar planillas.' });
    if (estado === 'pagada' && !canPagar)
      return res.status(403).json({ message: 'No tienes permisos para pagar planillas.' });

    const update = { updatedAt: Timestamp.now() };
    if (fecha !== undefined) update.fecha = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    if (segmentos !== undefined) update.segmentos = segmentos;
    if (trabajadores !== undefined) update.trabajadores = trabajadores;
    if (totalGeneral !== undefined) update.totalGeneral = Number(totalGeneral);
    if (estado !== undefined) update.estado = estado;
    if (observaciones !== undefined) update.observaciones = observaciones;

    // Asignar consecutivo si la planilla aún no tiene uno y está saliendo del borrador
    const currentData = ownership.doc.data();
    let consecutivo = currentData.consecutivo || null;
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

    // ── Snapshot al aprobar ────────────────────────────────────────────────────
    if (estado === 'aprobada' && !ownership.doc.data().snapshotCreado) {
      // Mezclar datos viejos con los cambios del body para usar siempre la versión más reciente
      const doc = { ...ownership.doc.data(), ...update };

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

      const isHoraUnit = (u) => /^horas?$/i.test((u || '').trim());
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
            // Segmento
            loteNombre:       seg.loteNombre   || '',
            grupo:            seg.grupo        || '',
            labor:            seg.labor        || '',
            avanceHa:         Number(seg.avanceHa) || 0,
            unidad:           seg.unidad       || '',
            costoUnitario,
            // Trabajador
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
    res.status(200).json({ message: 'Planilla actualizada.', consecutivo });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar planilla.' });
  }
});

router.delete('/api/hr/planilla-unidad/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_planilla_unidad', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('hr_planilla_unidad').doc(req.params.id).delete();
    res.status(200).json({ message: 'Planilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar planilla.' });
  }
});

// ── Plantillas de Planilla por Unidad / Hora ──────────────────────────────────
router.get('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_plantillas_planilla')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', req.query.encargadoId || '')
      .orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener plantillas.' });
  }
});

router.post('/api/hr/plantillas-planilla', authenticate, async (req, res) => {
  try {
    const { nombre, segmentos, trabajadores, encargadoId } = req.body;
    if (!nombre || !encargadoId) return res.status(400).json({ message: 'Nombre y encargado son requeridos.' });
    const ref = await db.collection('hr_plantillas_planilla').add({
      fincaId: req.fincaId,
      nombre: nombre.trim(),
      segmentos: segmentos || [],
      trabajadores: trabajadores || [],
      encargadoId,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar plantilla.' });
  }
});

router.delete('/api/hr/plantillas-planilla/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('hr_plantillas_planilla', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('hr_plantillas_planilla').doc(req.params.id).delete();
    res.status(200).json({ message: 'Plantilla eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar plantilla.' });
  }
});

// ── Solicitudes de Empleo ─────────────────────────────────────────────────────
router.get('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_solicitudes_empleo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaSolicitud', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fechaSolicitud: d.data().fechaSolicitud.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener solicitudes.' });
  }
});

router.post('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const { nombre, email, telefono, puesto, notas } = req.body;
    if (!nombre || !puesto) return res.status(400).json({ message: 'Nombre y puesto son obligatorios.' });
    const ref = await db.collection('hr_solicitudes_empleo').add({
      nombre, email: email || '', telefono: telefono || '',
      puesto, notas: notas || '', estado: 'pendiente',
      fechaSolicitud: Timestamp.now(), fincaId: req.fincaId,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear solicitud.' });
  }
});

router.put('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Solicitud actualizada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar.' });
  }
});

router.delete('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Solicitud eliminada.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar.' });
  }
});

module.exports = router;
