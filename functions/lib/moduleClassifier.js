// Classifies domain objects (tasks, feed events, chat tools, Firestore
// collections) into sidebar module ids so the `restrictedTo` middleware can
// filter content that does not belong to a user's allowed modules.
//
// This file complements `moduleMap.js` (which maps URL prefixes → modules).
// Together they let a membership like `restrictedTo: ['monitoreo']` restrict
// BOTH what the user can hit via HTTP AND what content slips through on the
// public-prefix endpoints (feed, tasks, chat).
//
// Defaults favor caution: unknown tasks/events fall back to 'campo' (the most
// populated module) so a restricted user does not see stray data from modules
// they have no access to. Unknown chat tools fall back to 'admin' (strict) so
// a new tool cannot sneak past the restriction without an explicit mapping.

// Task `type` field (scheduled_tasks.type) → module id.
const TASK_TYPE_MODULE = {
  MANUAL_APLICACION: 'campo',
  MANUAL: 'campo',
  REMINDER_DUE_DAY: 'campo',
  MUESTREO: 'monitoreo',
  SOLICITUD_COMPRA: 'contabilidad',
  PLANILLA_PAGO: 'rrhh',
};
const TASK_DEFAULT_MODULE = 'campo';

// Feed `eventType` → module id. `signal_alert_*` is handled by prefix below.
const FEED_EVENT_MODULE = {
  lote_created: 'campo',
  // task_completed defaults to 'campo' unless activityType narrows it (future).
  task_completed: 'campo',
  autopilot_analysis: 'admin',
  autopilot_command: 'admin',
  autopilot_action_executed: 'admin',
  autopilot_action_escalated: 'admin',
  annual_plan_generated: 'estrategia',
  rotation_recommendation_created: 'estrategia',
};

// Chat tool name → module id. `null` means the tool is always allowed
// (personal utilities that do not touch module-scoped data).
const TOOL_MODULE = {
  consultar_datos: null, // handled with collection-level filtering, below
  crear_lote: 'campo',
  escanear_formulario_siembra: 'campo',
  registrar_siembras: 'campo',
  consultar_siembras: 'campo',
  registrar_horimetro: 'campo',
  previsualizar_horimetro: 'campo',
  editar_producto: 'bodega',
  ajustar_stock: 'bodega',
  registrar_permiso: 'rrhh',
  previsualizar_planilla: 'rrhh',
  crear_empleado: 'rrhh',
  editar_empleado: 'rrhh',
  crear_recordatorio: null,
  listar_recordatorios: null,
  eliminar_recordatorio: null,
};
const TOOL_DEFAULT_MODULE = 'admin';

// Chat tool name → minimum role required. The chat dispatcher writes directly
// to Firestore via the Admin SDK so the HTTP-level `requireAdmin` and similar
// guards do NOT apply. Without this map a `trabajador` could, for example, ask
// the chat to `crear_empleado` and succeed despite the REST endpoint being
// admin-only. The map mirrors the role gates that each corresponding HTTP
// endpoint enforces (or should). Unknown tools default to `administrador`
// because an unmapped tool has not been reviewed.
const TOOL_MIN_ROLE = {
  // read-only
  consultar_datos: 'trabajador',
  consultar_siembras: 'trabajador',
  escanear_formulario_siembra: 'trabajador',
  previsualizar_horimetro: 'trabajador',
  previsualizar_planilla: 'encargado',
  // personal (same user's own data)
  registrar_horimetro: 'trabajador',
  crear_recordatorio: 'trabajador',
  listar_recordatorios: 'trabajador',
  eliminar_recordatorio: 'trabajador',
  // module-level writes
  crear_lote: 'encargado',
  registrar_siembras: 'encargado',
  editar_producto: 'encargado',
  ajustar_stock: 'encargado',
  registrar_permiso: 'encargado',
  // admin-only writes (mirrors requireAdmin on /api/users)
  crear_empleado: 'administrador',
  editar_empleado: 'administrador',
};
const TOOL_MIN_ROLE_DEFAULT = 'administrador';

// Firestore collections `consultar_datos` can reach, per module. Union of
// allowed collections across the user's restrictedTo modules is what the tool
// actually gets to query. Without restriction, the full whitelist applies.
const COLLECTIONS_FULL = [
  'lotes', 'siembras', 'grupos', 'scheduled_tasks',
  'productos', 'users', 'materiales_siembra', 'packages',
];
const COLLECTIONS_BY_MODULE = {
  campo:        ['lotes', 'siembras', 'grupos', 'scheduled_tasks', 'materiales_siembra', 'packages'],
  bodega:       ['productos', 'scheduled_tasks'],
  rrhh:         ['users', 'scheduled_tasks'],
  monitoreo:    ['scheduled_tasks'],
  contabilidad: ['productos', 'scheduled_tasks'],
  estrategia:   ['lotes', 'scheduled_tasks'],
  admin:        COLLECTIONS_FULL,
};

function taskTypeToModule(type) {
  return TASK_TYPE_MODULE[type] || TASK_DEFAULT_MODULE;
}

function feedEventToModule(eventType, activityType) {
  if (typeof eventType === 'string' && eventType.startsWith('signal_alert_')) {
    return 'estrategia';
  }
  if (eventType === 'task_completed' && activityType) {
    // activityType is 'aplicacion' | 'notificacion' | 'siembra' | etc. All
    // currently live in 'campo'; kept explicit so adding a new activityType
    // in another module is a trivial one-line change.
    return 'campo';
  }
  return FEED_EVENT_MODULE[eventType] || null;
}

function toolToModule(toolName) {
  if (toolName in TOOL_MODULE) return TOOL_MODULE[toolName];
  return TOOL_DEFAULT_MODULE;
}

function toolMinRole(toolName) {
  if (toolName in TOOL_MIN_ROLE) return TOOL_MIN_ROLE[toolName];
  return TOOL_MIN_ROLE_DEFAULT;
}

function allowedCollections(restrictedTo) {
  if (!Array.isArray(restrictedTo) || restrictedTo.length === 0) {
    return new Set(COLLECTIONS_FULL);
  }
  const set = new Set();
  for (const mod of restrictedTo) {
    const cols = COLLECTIONS_BY_MODULE[mod];
    if (cols) cols.forEach(c => set.add(c));
  }
  return set;
}

// Called by task/feed/chat filters. A null moduleId means "always allowed"
// (e.g. personal reminder tools). An empty restrictedTo means no restriction.
function isModuleAllowed(moduleId, restrictedTo) {
  if (moduleId == null) return true;
  if (!Array.isArray(restrictedTo) || restrictedTo.length === 0) return true;
  return restrictedTo.includes(moduleId);
}

module.exports = {
  taskTypeToModule,
  feedEventToModule,
  toolToModule,
  toolMinRole,
  allowedCollections,
  isModuleAllowed,
  COLLECTIONS_FULL,
};
