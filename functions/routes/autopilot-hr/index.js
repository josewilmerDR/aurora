// Router for the HR autopilot agent (phase 3.4).
//
// Mirrors autopilot-procurement/index.js but with one crucial difference:
// actions under this router NEVER execute autonomously, regardless of
// the domain nivel. See `lib/hr/hrActionCaps.js` for the arch-level cap
// and `autopilot-hr/routeCandidate.js` for per-candidate enforcement.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze } = require('./analyze');

const router = Router();

// Disparar un agente del autopilot es un acto privilegiado. Exigimos supervisor+
// para el POST HTTP directo, consistente con autopilot-finance/procurement. (Las
// acciones de HR nunca se ejecutan autónomamente — ver hrActionCaps.js — pero el
// análisis igual lee datos de personal sensibles.) El orquestador invoca
// `analyze` en proceso con su propio `req` autorizado y NO pasa por este gate.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

router.post('/api/autopilot/hr/analyze', authenticate, requireRole('supervisor'), rateLimit('autopilot_hr', 'ai_heavy'), analyze);

module.exports = router;
