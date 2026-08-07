// Logging de requests sin valores de query.
//
// El deep link /task/:id pasa su token HMAC como query param (?t=...), así
// que loguear req.originalUrl deja el token en Cloud Logging — una capability
// URL filtrada a cualquiera con acceso de lectura a los logs. Se loguean el
// path y las CLAVES del query, nunca los valores. Mismo criterio para
// cualquier log que hoy use originalUrl (ver lib/appcheck.js).

// Línea de log para un request: método, path y claves del query (sin valores).
const formatRequestLine = (req) => {
  const keys = Object.keys(req.query || {});
  const qs = keys.length > 0 ? `?${keys.join(',')}` : '';
  return `${req.method} ${req.path}${qs}`;
};

const requestLog = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${formatRequestLine(req)}`);
  next();
};

module.exports = { requestLog, formatRequestLine };
