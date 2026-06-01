// Router para el agente financiero del autopilot.

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { analyze } = require('./analyze');

const router = Router();

// Disparar el agente financiero lee presupuestos + costos consolidados y, en
// nivel3, ejecuta reasignaciones de presupuesto autónomas — un acto privilegiado
// que debe quedar por encima del piso de lectura del dominio (encargado lee/edita
// presupuestos). Exigimos supervisor+, alineado con las lecturas de financing y
// el hard-delete de tesorería. NOTA: este gate sólo aplica al POST HTTP directo;
// el orquestador (`autopilot-orchestrator`) invoca `analyze` en proceso con su
// propio `req` ya autorizado, por lo que su fan-out NO pasa por este middleware.
function requireRole(min) {
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, min)) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, `${min} role required.`, 403);
    }
    next();
  };
}

router.post('/api/autopilot/finance/analyze', authenticate, requireRole('supervisor'), rateLimit('autopilot_finance', 'ai_heavy'), analyze);

module.exports = router;
