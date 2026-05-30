// Router para ROI (rentabilidad).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { rateLimit } = require('../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { getLive } = require('./live');

const router = Router();

// ROI expone margen/ingresos consolidados de la finca — mismo nivel sensible
// que el Centro de Costos que lo embebe (tab Rentabilidad). El sidebar gatea a
// encargado+; replicamos el mínimo en backend y acotamos el endpoint, que une
// tres fuentes pesadas por request.
function requireEncargado(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'encargado role required.', 403);
  }
  next();
}

router.get('/api/roi/live', authenticate, requireEncargado, rateLimit('roi_live', 'costly_read'), getLive);

module.exports = router;
