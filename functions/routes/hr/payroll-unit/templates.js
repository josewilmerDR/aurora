// HR/payroll-unit — plantillas reutilizables (`hr_plantillas_planilla`).
//
// Sub-archivo del split de routes/hr/payroll-unit.js. Cada encargado puede
// guardar configuraciones de planilla (segmentos + trabajadores) que reusa
// día a día. La plantilla NO genera cantidades; sólo el "armazón" (qué
// lotes/labores/unidades se trabajan, qué trabajadores típicamente
// aparecen). Endpoints:
//
//   GET    /api/hr/plantillas-planilla?encargadoId=...
//   POST   /api/hr/plantillas-planilla
//   DELETE /api/hr/plantillas-planilla/:id
//
// Mismo guard que planilla-unidad: solo el dueño (o supervisor+) puede
// listar/crear/borrar plantillas en nombre de otro encargado.

const { Router } = require('express');
const { db, Timestamp } = require('../../../lib/firebase');
const { authenticate } = require('../../../lib/middleware');
const { verifyOwnership } = require('../../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');
const {
  PLANILLA_LIMITS,
  canActOnBehalf,
  trimStr,
  resolveAuthUserId,
  planillaRateLimit,
} = require('../helpers');
const { sanitizeSegmentos, sanitizeTrabajadores } = require('./helpers');

const router = Router();

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
