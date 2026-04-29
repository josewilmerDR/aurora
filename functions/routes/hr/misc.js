// HR — Endpoints menores: subordinados (lookup) y solicitudes de empleo (CRUD).
//
// Sub-archivo del split de routes/hr.js. Agrupa endpoints que no encajan en
// los demás sub-archivos pero son demasiado pequeños para tener su propio
// archivo. Si alguno crece sustancialmente, sale a un archivo separado.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

// ─── Subordinados (workers asignados a un encargado) ────────────────────

router.get('/api/hr/subordinados', authenticate, async (req, res) => {
  try {
    const { encargadoId } = req.query;
    if (!encargadoId) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'encargadoId is required.', 400);
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
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch subordinates.', 500);
  }
});

// ─── Solicitudes de empleo ──────────────────────────────────────────────

router.get('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('hr_solicitudes_empleo')
      .where('fincaId', '==', req.fincaId)
      .orderBy('fechaSolicitud', 'desc').get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data(), fechaSolicitud: d.data().fechaSolicitud.toDate().toISOString() }));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch applications.', 500);
  }
});

router.post('/api/hr/solicitudes-empleo', authenticate, async (req, res) => {
  try {
    const { nombre, email, telefono, puesto, notas } = req.body;
    if (!nombre || !puesto) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'nombre and puesto are required.', 400);
    const ref = await db.collection('hr_solicitudes_empleo').add({
      nombre, email: email || '', telefono: telefono || '',
      puesto, notas: notas || '', estado: 'pendiente',
      fechaSolicitud: Timestamp.now(), fincaId: req.fincaId,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create application.', 500);
  }
});

router.put('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Application updated.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update.', 500);
  }
});

router.delete('/api/hr/solicitudes-empleo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('hr_solicitudes_empleo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Application deleted.' });
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete.', 500);
  }
});

module.exports = router;
