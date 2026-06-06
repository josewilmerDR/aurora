// HR — Asistencia diaria.
//
// Sub-archivo del split de routes/hr.js. Maneja la colección hr_asistencia:
// asistencia diaria con horasExtra opcionales. El endpoint batch usa doc id
// determinista `${trabajadorId}_${fecha}` (upsert idempotente) para que
// reenviar el mismo día sobreescriba en lugar de duplicar.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership, hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

const ASISTENCIA_ESTADOS = ['presente', 'ausente', 'vacaciones', 'incapacidad', 'permiso'];
const ASISTENCIA_BATCH_MAX = 200;
const ASISTENCIA_FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ASISTENCIA_NOTAS_MAX = 500;

router.get('/api/hr/asistencia', authenticate, rateLimit('hr_asistencia_read', 'costly_read'), async (req, res) => {
  try {
    // La asistencia (estado/horas extra/notas de cada trabajador) es dato de
    // nómina — encargado+ only, igual que fichas/planilla. Sin esto cualquier
    // trabajador leía la cuadrilla completa por llamada directa.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read attendance.', 403);
    }
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch attendance.', 500);
  }
});

async function registerAsistencia(req, res) {
  try {
    // Mismo boundary que el batch: escribe la base de nómina, así que exige
    // encargado+, valida estado contra la enum, la fecha con regex y que el
    // trabajador pertenezca a la finca (no se confía el nombre del cliente —
    // se canoniza desde users).
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register attendance.', 403);
    }
    const { trabajadorId, fecha, estado, horasExtra, notas } = req.body || {};
    const id = String(trabajadorId || '').trim();
    if (!id || !ASISTENCIA_FECHA_RE.test(String(fecha)) || !ASISTENCIA_ESTADOS.includes(String(estado))) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `trabajadorId, fecha (YYYY-MM-DD) and a valid estado (${ASISTENCIA_ESTADOS.join(', ')}) are required.`, 400);
    }
    const workerDoc = await db.collection('users').doc(id).get();
    if (!workerDoc.exists || workerDoc.data().fincaId !== req.fincaId) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid worker.', 400);
    }
    // Upsert idempotente con doc id determinista `${trabajadorId}_${fecha}`, igual
    // que el endpoint /batch: la asistencia es naturalmente "una por trabajador por
    // día". Con `.add()` (id aleatorio) reenviar el mismo día creaba registros
    // duplicados que el aggregator de scoring sumaba (horasExtra inflado, estado
    // ambiguo). merge:true sobreescribe en lugar de duplicar.
    const docId = `${id}_${fecha}`;
    await db.collection('hr_asistencia').doc(docId).set({
      trabajadorId: id,
      trabajadorNombre: workerDoc.data().nombre || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      estado,
      horasExtra: Math.max(0, Math.min(24, Number(horasExtra) || 0)),
      notas: String(notas || '').slice(0, ASISTENCIA_NOTAS_MAX),
      fincaId: req.fincaId, updatedAt: Timestamp.now(),
    }, { merge: true });
    res.status(201).json({ id: docId });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register attendance.', 500);
  }
}

router.post('/api/hr/asistencia', authenticate, rateLimit('hr_asistencia_write', 'write'), registerAsistencia);

// Batch upsert: registra la asistencia de toda la cuadrilla para una fecha
// en un solo request. Usa doc id determinista `${trabajadorId}_${fecha}`
// para que reenviar el mismo día sobreescriba en lugar de duplicar — la
// asistencia es naturalmente "una por trabajador por día".
router.post('/api/hr/asistencia/batch', authenticate, rateLimit('hr_asistencia_write', 'write'), async (req, res) => {
  try {
    // Escribe la base de nómina (estado/horas extra) de toda la cuadrilla.
    // encargado+ only, igual que el resto del módulo HR — la UI lo gatea a
    // encargado pero el backend es el boundary real ante una llamada directa.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can save attendance.', 403);
    }
    const { fecha, registros } = req.body || {};
    if (!fecha || !ASISTENCIA_FECHA_RE.test(String(fecha))) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'fecha must be YYYY-MM-DD.', 400);
    }
    if (!Array.isArray(registros) || registros.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'registros must be a non-empty array.', 400);
    }
    if (registros.length > ASISTENCIA_BATCH_MAX) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Maximum ${ASISTENCIA_BATCH_MAX} registros per batch.`, 400);
    }

    // Cargo users de la finca una sola vez para validar trabajadorIds y
    // canonizar el nombre desde fuente autoritativa (no confío en cliente).
    const usersSnap = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    const userMap = new Map(usersSnap.docs.map(d => [d.id, d.data()]));

    const errors = [];
    const cleaned = [];
    const seenIds = new Set();
    for (let i = 0; i < registros.length; i++) {
      const r = registros[i] || {};
      const id = String(r.trabajadorId || '').trim();
      const estado = String(r.estado || '').trim();
      if (!id || !userMap.has(id)) {
        errors.push({ index: i, msg: 'trabajadorId is invalid or does not belong to the finca.' });
        continue;
      }
      if (seenIds.has(id)) {
        errors.push({ index: i, msg: 'Duplicate trabajadorId in the same batch.' });
        continue;
      }
      if (!ASISTENCIA_ESTADOS.includes(estado)) {
        errors.push({ index: i, msg: `estado must be one of: ${ASISTENCIA_ESTADOS.join(', ')}.` });
        continue;
      }
      seenIds.add(id);
      cleaned.push({
        trabajadorId: id,
        trabajadorNombre: userMap.get(id).nombre || '',
        estado,
        horasExtra: Math.max(0, Math.min(24, Number(r.horasExtra) || 0)),
        notas: String(r.notas || '').slice(0, ASISTENCIA_NOTAS_MAX),
      });
    }

    if (errors.length) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, JSON.stringify(errors), 400);
    }

    const fechaTs = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
    const now = Timestamp.now();
    const batch = db.batch();
    cleaned.forEach(r => {
      const docId = `${r.trabajadorId}_${fecha}`;
      const ref = db.collection('hr_asistencia').doc(docId);
      // merge:true sobre id determinista da upsert idempotente. Sólo
      // escribimos updatedAt; createdAt requeriría un read previo por doc
      // (~200 reads extra) que no aporta — el doc snapshot ya guarda su
      // creation time, y el caso operativo (auditoría) usa updatedAt.
      batch.set(ref, {
        ...r,
        fecha: fechaTs,
        fincaId: req.fincaId,
        updatedAt: now,
      }, { merge: true });
    });
    await batch.commit();

    res.status(200).json({ saved: cleaned.length });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save batch attendance.', 500);
  }
});

router.delete('/api/hr/asistencia/:id', authenticate, async (req, res) => {
  try {
    // Los doc id son deterministas (`${trabajadorId}_${fecha}`) → adivinables.
    // Sin verifyOwnership cualquier autenticado borraría registros de OTRA
    // finca. Y borrar asistencia es irreversible y altera la nómina, así que
    // exigimos encargado+ y dejamos rastro forense.
    const ownership = await verifyOwnership('hr_asistencia', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role to delete attendance.', 403);
    }
    const prev = ownership.doc.data() || {};
    await db.collection('hr_asistencia').doc(req.params.id).delete();
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.ASISTENCIA_DELETE,
      target: { type: 'asistencia', id: req.params.id },
      metadata: {
        trabajadorId: prev.trabajadorId || null,
        estado: prev.estado || null,
        horasExtra: prev.horasExtra ?? null,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(200).json({ message: 'Record deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

module.exports = router;
// Exportado para tests.
module.exports.registerAsistencia = registerAsistencia;
