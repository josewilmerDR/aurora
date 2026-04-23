// Module-restriction mapping. The authenticate middleware uses this to enforce
// that a member with `memberships.restrictedTo = ['monitoreo']` cannot hit
// `/api/lotes` (owned by the `campo` module) even if they know the URL.
//
// Design choices:
//   - Path matching is by prefix. Cheap, predictable, and easy to keep in sync
//     with the sidebar MODULES definition in src/components/Sidebar.jsx.
//   - Paths that match no module fall back to "allow + warn" when STRICT is
//     false, so an unmapped endpoint does not lock users out silently. Flip
//     STRICT to true once logs are clean, analogous to the App Check warn →
//     enforce rollout.
//   - PUBLIC_PREFIXES covers endpoints that every member must be able to
//     reach regardless of their module restriction: auth, dashboard feed,
//     own-task list, reminders, push, and the conversational assistant.
//     Keep this list tight — each entry is a potential bypass.

const STRICT = false;

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/feed',
  '/api/reminders',
  '/api/webpush',
  '/api/chat',
  '/api/tasks',
];

// Module ids must match MODULES[].id in src/components/Sidebar.jsx.
const MODULE_PREFIXES = {
  campo: [
    '/api/lotes', '/api/grupos', '/api/siembra', '/api/cosecha',
    '/api/packages', '/api/cedulas', '/api/horimetro', '/api/templates',
  ],
  bodega: [
    '/api/productos', '/api/bodegas', '/api/movimientos', '/api/recepciones',
  ],
  rrhh: [
    '/api/hr', '/api/autopilot-hr',
  ],
  monitoreo: [
    '/api/monitoreo',
  ],
  contabilidad: [
    '/api/compras', '/api/ordenes-compra', '/api/solicitudes-compra',
    '/api/proveedores', '/api/rfqs', '/api/procurement', '/api/suppliers',
    '/api/costos', '/api/budgets', '/api/income', '/api/buyers',
    '/api/treasury', '/api/financing', '/api/roi',
    '/api/autopilot-procurement', '/api/autopilot-finance',
  ],
  estrategia: [
    '/api/strategy', '/api/signals', '/api/scenarios', '/api/annualPlans',
    '/api/analytics',
  ],
  admin: [
    '/api/users', '/api/maquinaria', '/api/labores', '/api/unidades',
    '/api/calibraciones', '/api/config', '/api/combustible',
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
