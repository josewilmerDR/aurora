// HR — Endpoints menores: subordinados (lookup) de un encargado.

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { canActOnBehalf, resolveAuthUserId } = require('./helpers');

const router = Router();

// ─── Subordinados (workers asignados a un encargado) ────────────────────

router.get('/api/hr/subordinados', authenticate, rateLimit('hr_subordinados_read', 'costly_read'), async (req, res) => {
  try {
    const { encargadoId } = req.query;
    if (!encargadoId) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'encargadoId is required.', 400);
    // Un encargado sólo puede consultar SUS propios subordinados; supervisor/
    // admin/rrhh pueden consultar los de cualquier encargado. Sin este gate,
    // cualquier miembro de la finca (incl. trabajador) podía enumerar los
    // subordinados de cualquier encargado pasando su id.
    const authUserId = await resolveAuthUserId(req);
    if (encargadoId !== authUserId && !canActOnBehalf(req))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Cannot read subordinates of another encargado.', 403);
    const fichasSnap = await db.collection('hr_fichas')
      .where('fincaId', '==', req.fincaId)
      .where('encargadoId', '==', encargadoId)
      .get();
    const trabajadorIds = fichasSnap.docs.map(d => d.id);
    if (trabajadorIds.length === 0) return res.status(200).json([]);
    const idSet = new Set(trabajadorIds);
    const usersSnap = await db.collection('users').where('fincaId', '==', req.fincaId).get();
    // Proyección mínima sin PII (sin email/teléfono/rol): la página sólo usa
    // id/nombre, y empleadoPlanilla para filtrar. Mismo contrato que /users/lite.
    const subordinados = usersSnap.docs
      .filter(d => idSet.has(d.id))
      .map(d => {
        const u = d.data() || {};
        return { id: d.id, nombre: u.nombre || '', empleadoPlanilla: !!u.empleadoPlanilla };
      });
    res.status(200).json(subordinados);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch subordinates.', 500);
  }
});

module.exports = router;
