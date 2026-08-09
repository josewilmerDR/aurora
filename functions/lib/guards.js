// Guard de rol compartido para routers de Express.
//
// Por qué existe: el proyecto ya tenía cuatro implementaciones locales del
// mismo control —`requireSupervisor` en routes/analytics.js, otra copia en
// routes/annualPlans.js, `requireRole` en routes/field-records/helpers.js y
// `requireEncargado` en routes/harvest/validation.js—. Los dominios que se
// acordaron de escribir la suya quedaron protegidos; el resto quedó con
// `authenticate` a secas, y así siete endpoints DELETE terminaron siendo
// ejecutables por un `trabajador`: borraba tipos de muestreo, calibraciones,
// registros de muestreo y horímetro de TODA la finca. El aislamiento de
// inquilino estaba bien (verifyOwnership); lo que faltaba era el escalón de
// rol. Un control que hay que reimplementar en cada dominio es un control que
// alguien va a omitir.
//
// Orden de montaje: SIEMPRE después de `authenticate`, que es quien resuelve
// `req.userRole` desde la membership. Montado sin él, `req.userRole` es
// undefined y el guard responde 403 — falla cerrado, que es lo correcto, pero
// convierte el endpoint en inútil. El test
// tests/unit/security.roleGuards.test.js verifica ese orden.
//
// Nota sobre `rrhh`: en ROLE_LEVELS_BE vale 3, el mismo nivel que
// `supervisor`. Un `requireRole('supervisor')` admite RRHH a propósito — es la
// semántica existente del proyecto, no un descuido de este módulo.

const { hasMinRoleBE } = require('./helpers');
const { sendApiError, ERROR_CODES } = require('./errors');

// Roles válidos, en el mismo orden que ROLE_LEVELS_BE de helpers.js.
const VALID_MIN_ROLES = new Set(['trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador']);

/**
 * Middleware que exige `minRole` o superior.
 * @param {'trabajador'|'encargado'|'supervisor'|'rrhh'|'administrador'} minRole
 */
const requireRole = (minRole) => {
  // Falla al CONSTRUIR el middleware, no al atender el request. hasMinRoleBE
  // hace `ROLE_LEVELS_BE[minRole] || 0`, así que un typo ('supervisior') da
  // nivel 0 y `cualquierRol >= 0` es true: el guard queda montado, se ve bien
  // en el código y deja pasar a todo el mundo. Un throw acá revienta el
  // require del router y el deploy, que es exactamente lo que queremos.
  if (!VALID_MIN_ROLES.has(minRole)) {
    throw new Error(
      `requireRole: rol inválido "${minRole}". Válidos: ${[...VALID_MIN_ROLES].join(', ')}.`,
    );
  }
  return (req, res, next) => {
    if (!hasMinRoleBE(req.userRole, minRole)) {
      return sendApiError(
        res,
        ERROR_CODES.INSUFFICIENT_ROLE,
        `Requires "${minRole}" role or above.`,
        403,
      );
    }
    return next();
  };
};

// Atajos para los tres escalones que el proyecto usa de verdad. Preferir
// éstos en los routers: leen mejor en la definición de la ruta y no dan
// lugar al typo que la validación de arriba tiene que atajar.
const requireEncargado = requireRole('encargado');
const requireSupervisor = requireRole('supervisor');
const requireAdmin = requireRole('administrador');

module.exports = { requireRole, requireEncargado, requireSupervisor, requireAdmin };
