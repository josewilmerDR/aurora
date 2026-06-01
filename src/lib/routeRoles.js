// Route → minRole mapping for route-level access control (used by RoleRoute in
// App.jsx). Extracted from App.jsx so it can be unit-tested without importing
// the whole router/page graph (see routeRoles.test.js, the guardrail that
// every <RoleRoute path="…"> is mapped here).
//
// NOTE: this is defense-in-depth UX gating only — the real authorization
// boundary is the API. Every endpoint re-checks the role server-side.
import { ALL_ITEMS } from '../components/Sidebar';

export const ROUTE_MIN_ROLE = {
  ...Object.fromEntries(
    ALL_ITEMS.filter(item => item.to).map(item => [item.to, item.minRole || 'trabajador'])
  ),
  // Sub-routes not listed directly in MODULES
  // Account/company settings: read needs encargado+ at the API, but the page
  // is admin-only (PUT /api/config is administrador, and both UI entry points
  // already gate to administrador). Match that here so a deep-link can't load
  // the form for sub-admins.
  '/config/cuenta': 'administrador',
  '/productos/todos': 'encargado',
  '/bodega/agroquimicos/existencias': 'encargado',
  '/bodega/agroquimicos/recepcion': 'encargado',
  '/bodega/agroquimicos/movimientos': 'encargado',
  '/bodega/combustibles': 'encargado',
  '/admin/bodegas': 'administrador',
  '/cosecha/despacho': 'encargado',
  '/siembra/materiales': 'encargado',
  '/ordenes-compra/historial': 'encargado',
  '/hr/planilla/fijo': 'encargado',
  '/hr/planilla/horas': 'encargado',
  '/monitoreo/paquetes': 'supervisor',
  '/monitoreo/muestreos': 'encargado',
  // Autopilot — accessed via header icon, not sidebar
  '/autopilot': 'encargado',
  '/autopilot/configuracion': 'supervisor',
  // Procurement hub — children inherit the role gate from the parent route,
  // so only the canonical entry needs an explicit minRole here.
  '/procurement': 'encargado',
  // Financing (phase 5.5) — supervisor+ can read; admin gates write ops at API layer
  '/finance/financing': 'supervisor',
  '/finance/financing/offers': 'supervisor',
  '/finance/financing/simulations': 'supervisor',
  // CEO Dashboard (phase 6.5) — admin only; reflects meta-agent state
  '/ceo': 'administrador',
  // Strategy (phase 4.1)
  '/strategy/rendimiento': 'supervisor',
  '/strategy/temporadas': 'supervisor',
  '/strategy/rotacion/restricciones': 'supervisor',
  '/strategy/rotacion/recomendador': 'supervisor',
  '/strategy/senales/fuentes': 'supervisor',
  '/strategy/senales': 'supervisor',
  '/strategy/escenarios': 'supervisor',
  '/strategy/plan-anual': 'supervisor',
};

// Resolve the minimum role for a route path. FAIL-CLOSED: an unmapped path
// defaults to 'administrador', not 'trabajador'. A new route added to App.jsx
// without an entry above becomes admin-only (and its feature visibly breaks for
// lower roles → caught immediately) instead of silently world-readable to every
// authenticated user. The routeRoles.test.js guardrail also fails CI in that
// case so the omission is fixed at the source.
export function resolveRouteMinRole(path) {
  return ROUTE_MIN_ROLE[path] ?? 'administrador';
}
