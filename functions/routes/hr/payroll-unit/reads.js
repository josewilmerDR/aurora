// HR/payroll-unit — endpoints de lectura.
//
// Sub-archivo del split de routes/hr/payroll-unit.js. Dos GETs:
//   - /api/hr/planilla-unidad             planillas activas (incl. borradores y aprobadas)
//   - /api/hr/planilla-unidad/historial   snapshots inmutables creados al aprobar
//
// El historial se materializa al aprobar (ver mutations.js) precisamente
// para que esta lectura no tenga que recomputar nada — los reportes leen
// snapshot frio.

const { Router } = require('express');
const { db } = require('../../../lib/firebase');
const { authenticate } = require('../../../lib/middleware');
const { hasMinRoleBE } = require('../../../lib/helpers');
const { rateLimit } = require('../../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');

const router = Router();

router.get('/api/hr/planilla-unidad', authenticate, rateLimit('hr_planilla_read', 'costly_read'), async (req, res) => {
  try {
    // Las planillas llevan salarios (precioHora) y totales de pago de cada
    // trabajador. Gate a encargado+ para que un trabajador no pueda enumerar
    // la nómina de la finca por API directa (igual que GET /api/hr/fichas).
    if (!hasMinRoleBE(req.userRole, 'encargado'))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read planillas.', 403);
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

router.get('/api/hr/planilla-unidad/historial', authenticate, rateLimit('hr_planilla_read', 'costly_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado'))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read planilla history.', 403);
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

module.exports = router;
