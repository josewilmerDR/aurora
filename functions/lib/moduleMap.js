// Module-restriction mapping. The authenticate middleware uses this to enforce
// that a member with `memberships.restrictedTo = ['monitoreo']` cannot hit
// `/api/lotes` (owned by the `campo` module) even if they know the URL.
//
// Design choices:
//   - Path matching is by prefix. Cheap, predictable, and easy to keep in sync
//     with the sidebar MODULES definition in src/components/Sidebar.jsx.
//   - STRICT is now ENFORCED (true): a path that matches no module is DENIED
//     for members with a non-empty restrictedTo. Every live `/api` endpoint
//     must therefore be mapped to an owning module below (or live in
//     PUBLIC_PREFIXES). When you add a new route, add its prefix here or
//     restricted members will get a 403 on it. The warn → enforce rollout
//     (analogous to App Check) is complete.
//   - PUBLIC_PREFIXES covers endpoints that every member must be able to
//     reach regardless of their module restriction: auth, dashboard feed,
//     own-task list, reminders, push, and the conversational assistant.
//     Keep this list tight — each entry is a potential bypass.

const STRICT = true;

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/feed',
  '/api/reminders',
  '/api/push', // suscripción web-push: la consume MainLayout para todo miembro
  '/api/chat',
  '/api/tasks',
];

// Module ids must match MODULES[].id in src/components/Sidebar.jsx.
const MODULE_PREFIXES = {
  campo: [
    // Prefijos matchean por igualdad o por `path.startsWith(prefix + '/')`,
    // así que tienen que ser el path real del endpoint. `/api/siembra` (sin s)
    // no matcheaba ningún endpoint vivo — los reales son `/api/siembras` y
    // `/api/materiales-siembra`. Sin estos, al flipear STRICT=true en
    // moduleMap, ambos quedarían denegados para usuarios con restrictedTo.
    '/api/lotes', '/api/grupos', '/api/siembras', '/api/materiales-siembra',
    '/api/block-transitions', '/api/cosecha', '/api/packages', '/api/cedulas',
    // Plantillas de tareas y de cédulas son config de aplicaciones (campo). El
    // antiguo '/api/templates' estaba muerto (los endpoints reales son estos).
    '/api/cedula-templates', '/api/task-templates', '/api/horimetro',
    // Clima sólo lo consume AplicadaModal al aplicar una cédula (campo).
    '/api/weather',
  ],
  bodega: [
    '/api/productos', '/api/bodegas', '/api/movimientos', '/api/recepciones',
    // Toma física / ajuste de inventario, confirmación de ingreso de mercancía,
    // y cierre de combustible (su ítem de sidebar vive en el grupo Bodega).
    '/api/inventario', '/api/ingreso', '/api/cierres-combustible',
  ],
  rrhh: [
    // El agente de RRHH se monta en `/api/autopilot/hr/...` (no
    // `/api/autopilot-hr`); el guion era una entrada muerta que nunca matcheaba
    // y dejaba la ruta real clasificada bajo `admin` vía el prefijo
    // `/api/autopilot`. Va antes que `admin` en este objeto, así que el prefijo
    // específico gana por orden de iteración.
    '/api/hr', '/api/autopilot/hr',
  ],
  monitoreo: [
    '/api/muestreos',
    '/api/monitoreo',
  ],
  contabilidad: [
    '/api/compras', '/api/ordenes-compra', '/api/solicitudes-compra',
    '/api/proveedores', '/api/rfqs', '/api/procurement', '/api/suppliers',
    '/api/costos', '/api/budgets', '/api/income', '/api/buyers',
    '/api/treasury', '/api/financing', '/api/roi',
    // Agentes del autopilot del depto. financiero/compras. Las rutas reales son
    // `/api/autopilot/finance/...` y `/api/autopilot/procurement/...`; las
    // entradas previas con guion (`/api/autopilot-finance`) eran letra muerta y
    // hacían que estas rutas cayeran bajo `admin` (prefijo `/api/autopilot`),
    // negándolas a un supervisor restringido a `contabilidad`. Los prefijos
    // específicos van antes que `admin` por orden de iteración → ownerModule
    // correcto = contabilidad.
    '/api/autopilot/procurement', '/api/autopilot/finance',
  ],
  estrategia: [
    '/api/strategy', '/api/signals', '/api/scenarios', '/api/annualPlans',
    '/api/analytics',
  ],
  admin: [
    // `/api/unidades` (sin -medida) no matcheaba el endpoint real
    // `/api/unidades-medida`; sin esta corrección, al flipear STRICT quedaba
    // denegado para todos los usuarios con restrictedTo, incluso admin-only.
    '/api/users', '/api/maquinaria', '/api/labores', '/api/unidades-medida',
    // '/api/combustible' estaba muerto; el cierre de combustible real
    // (/api/cierres-combustible) se movió a `bodega`, donde vive su UI.
    '/api/calibraciones', '/api/config',
    '/api/meta', '/api/autopilot', '/api/autopilot-control',
    '/api/autopilot-orchestrator', '/api/audit',
  ],
};

function matchesPrefix(path, prefixes) {
  for (const p of prefixes) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

// Returns 'allow' | 'deny'. Callers should only invoke this when the member
// actually has a non-empty restrictedTo list; unrestricted members skip the
// check entirely.
function checkModuleAccess(path, restrictedTo) {
  if (matchesPrefix(path, PUBLIC_PREFIXES)) return 'allow';

  let ownerModule = null;
  for (const [modId, prefixes] of Object.entries(MODULE_PREFIXES)) {
    if (matchesPrefix(path, prefixes)) {
      ownerModule = modId;
      break;
    }
  }

  if (!ownerModule) {
    if (!STRICT) {
      console.warn('[restrictedTo] unmapped path', path, '— allowing (STRICT=false)');
      return 'allow';
    }
    // STRICT: an unmapped path is denied. Log it so a route added without a
    // moduleMap entry surfaces immediately instead of silently 403-ing members.
    console.warn('[restrictedTo] unmapped path', path, '— denying (STRICT=true)');
    return 'deny';
  }

  return restrictedTo.includes(ownerModule) ? 'allow' : 'deny';
}

module.exports = {
  PUBLIC_PREFIXES,
  MODULE_PREFIXES,
  checkModuleAccess,
  STRICT,
};
