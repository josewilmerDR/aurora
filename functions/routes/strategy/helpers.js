// Strategy — helpers cross-cutting.
//
// Sub-archivo del split de routes/strategy.js. Aglomera lo que más de un
// endpoint del dominio necesita: constantes, role gate, conteo mensual
// de ejecuciones (cap N3), y la función `executePropuestasAsSiembras`
// que tanto recommend (modo N3) como decisions (accept) llaman.

const { db, Timestamp } = require('../../lib/firebase');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { stripReasoning } = require('../../lib/autopilotReasoning');
const { executeAutopilotAction } = require('../../lib/autopilotActions');

const ALLOWED_LEVELS = ['nivel1', 'nivel2', 'nivel3'];
const MAX_HORIZONTE = 6;                      // tope duro
const MAX_MONTHLY_ROTATION_EXECUTIONS = 10;   // cap N3 por finca

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(
      res,
      ERROR_CODES.INSUFFICIENT_ROLE,
      'Strategy routes require supervisor role or higher.',
      403,
    );
    return false;
  }
  return true;
}

function isValidIso(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function startOfMonthUtcMillis(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

async function countMonthlyRotationExecutions(fincaId) {
  const since = Timestamp.fromMillis(startOfMonthUtcMillis());
  // Usamos una query normal (no .count()) para no depender de la extensión.
  // Si el volumen crece, se puede mover a aggregation query.
  const snap = await db.collection('autopilot_actions')
    .where('fincaId', '==', fincaId)
    .where('type', '==', 'crear_siembra')
    .where('status', '==', 'executed')
    .where('createdAt', '>=', since)
    .get();
  return snap.size;
}

// Crea una siembra por propuesta usando executeAutopilotAction. Cada ejecución
// se registra en autopilot_actions con su compensación. Las fallas por
// propuesta no abortan el ciclo: recopilamos errores y el caller decide el
// estado final del recommendation doc.
async function executePropuestasAsSiembras({ recommendationId, recDoc, fincaId, actor, level }) {
  const siembrasIds = [];
  const actionsIds = [];
  const errors = [];
  for (const propuesta of recDoc.propuestas || []) {
    if (!propuesta.paqueteId || !propuesta.fechaSiembra) {
      errors.push({
        orden: propuesta.orden,
        message: 'Propuesta sin paqueteId o fechaSiembra — omitida.',
      });
      continue;
    }
    const actionDocRef = db.collection('autopilot_actions').doc();
    actionsIds.push(actionDocRef.id);
    const initialDoc = {
      fincaId,
      sessionId: null,
      type: 'crear_siembra',
      params: {
        loteId: recDoc.loteId,
        paqueteId: propuesta.paqueteId,
        fecha: propuesta.fechaSiembra,
        razon: propuesta.razon || '',
      },
      titulo: `Siembra programada — ${propuesta.nombrePaquete || propuesta.paqueteId}`,
      descripcion: propuesta.razon || '',
      prioridad: 'media',
      categoria: 'rotacion',
      proposedBy: actor.uid || null,
      proposedByName: actor.email || null,
      reviewedBy: actor.uid || null,
      reviewedByName: actor.email || null,
      reviewedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      rotationRecommendationId: recommendationId,
      rotationOrden: propuesta.orden,
      reasoning: recDoc.reasoning || null,
    };
    try {
      const result = await executeAutopilotAction(
        'crear_siembra',
        initialDoc.params,
        fincaId,
        { level, actionDocRef, actionInitialDoc: initialDoc },
      );
      siembrasIds.push(result.siembraId);
    } catch (err) {
      errors.push({
        orden: propuesta.orden,
        actionId: actionDocRef.id,
        message: err.message || String(err),
      });
    }
  }
  return {
    allOk: errors.length === 0 && siembrasIds.length > 0,
    siembrasIds,
    actionsIds,
    errors,
  };
}

// Oculta `reasoning` para roles debajo de supervisor, igual que autopilot.
function stripReasoningForRole(data, userRole) {
  if (hasMinRoleBE(userRole, 'supervisor')) return data;
  return stripReasoning(data);
}

module.exports = {
  ALLOWED_LEVELS,
  MAX_HORIZONTE,
  MAX_MONTHLY_ROTATION_EXECUTIONS,
  requireSupervisor,
  isValidIso,
  startOfMonthUtcMillis,
  countMonthlyRotationExecutions,
  executePropuestasAsSiembras,
  stripReasoningForRole,
};
