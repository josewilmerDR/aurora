// Router for the procurement autopilot agent (phase 2.2).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze } = require('./analyze');

const router = Router();

// Disparar un agente del autopilot es un acto privilegiado (lee datos sensibles
// del dominio y, según el nivel, ejecuta acciones autónomas). Exigimos
// supervisor+ para el POST HTTP directo, consistente con autopilot-finance. El
// orquestador invoca `analyze` en proceso con su propio `req` autorizado y NO
// pasa por este middleware.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

router.post('/api/autopilot/procurement/analyze', authenticate, requireRole('supervisor'), rateLimit('autopilot_procurement', 'ai_heavy'), analyze);

module.exports = router;
