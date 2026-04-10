const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { getTwilioClient } = require('../lib/clients');
const { twilioWhatsappFrom } = require('../lib/firebase');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: RECURSOS HUMANOS
// ─────────────────────────────────────────────────────────────────────────────

// ── Fichas del Trabajador ────────────────────────────────────────────────────
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
    const doc = await db.collection('hr_fichas').doc(req.params.userId).get();
    res.status(200).json(doc.exists ? { id: doc.id, ...doc.data() } : {});
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener ficha.' });
  }
});

router.put('/api/hr/fichas/:userId', authenticate, async (req, res) => {
  try {
    await db.collection('hr_fichas').doc(req.params.userId).set(
      { ...req.body, fincaId: req.fincaId, updatedAt: Timestamp.now() },
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
router.get('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_permisos')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaInicio', 'desc').get();
    const data = snap.docs.map(d => ({
      id: d.id, ...d.data(),
      fechaInicio: d.data().fechaInicio.toDate().toISOString(),
      fechaFin: d.data().fechaFin.toDate().toISOString(),
      createdAt: d.data().createdAt ? d.data().createdAt.toDate().toISOString() : null,
    }));
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener permisos.' });
  }
});

router.post('/api/hr/permisos', authenticate, async (req, res) => {
  try {
    const { trabajadorId, trabajadorNombre, tipo, fechaInicio, fechaFin, dias, motivo, conGoce,
            esParcial, horaInicio, horaFin, horas } = req.body;
    if (!trabajadorId || !tipo || !fechaInicio) return res.status(400).json({ message: 'Faltan campos requeridos.' });
    const ref = await db.collection('hr_permisos').add({
      trabajadorId, trabajadorNombre: trabajadorNombre || '', tipo,
      fechaInicio: Timestamp.fromDate(new Date(fechaInicio + 'T12:00:00')),
      fechaFin: Timestamp.fromDate(new Date((fechaFin || fechaInicio) + 'T12:00:00')),
      dias: Number(dias) || 0,
      esParcial: esParcial === true,
      horaInicio: esParcial ? (horaInicio || null) : null,
      horaFin:    esParcial ? (horaFin    || null) : null,
      horas:      esParcial ? (Number(horas) || 0)  : 0,
      motivo: motivo || '',
      conGoce: conGoce !== false,
      estado: 'pendiente', fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear permiso.' });
  }
});

router.put('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_permisos').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Permiso actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar permiso.' });
  }
});

router.delete('/api/hr/permisos/:id', authenticate, async (req, res) => {
  try {
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
