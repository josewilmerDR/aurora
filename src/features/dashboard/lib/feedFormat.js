// Helpers de presentación para el feed de actividad reciente del Dashboard.

// Etiqueta + icono por tipo de evento. El icono es un glifo liviano inline
// (no react-icons) porque es decorativo y no semántico.
export const EVENT_LABELS = {
  aplicacion: { text: 'completó una aplicación', icon: '🧪' },
  notificacion: { text: 'completó una tarea', icon: '✓' },
  lote_created: { text: 'creó un lote', icon: '🌱' },
  autopilot_analysis: { text: 'completó un análisis', icon: '🤖' },
  autopilot_action_executed: { text: 'ejecutó una acción', icon: '⚡' },
  autopilot_action_escalated: { text: 'escaló una acción', icon: '⚠️' },
};

// Resuelve la clave de EVENT_LABELS para un evento del feed.
export function resolveEventKey(event) {
  if (event.eventType?.startsWith('autopilot_')) return event.eventType;
  if (event.eventType === 'lote_created') return 'lote_created';
  return event.activityType || 'notificacion';
}

// "hace 3 min" / "hace 2h" / "hace 5d". Devuelve null si el timestamp no es
// válido (el backend puede devolver timestamp: null para docs sin fecha).
export function timeAgo(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return 'ahora mismo';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora mismo';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

// Inicial del avatar. Los eventos de autopilot usan un glifo de engranaje;
// el resto, la primera letra del nombre del usuario (o '?' si falta).
export function avatarInitial(event) {
  if (event.eventType?.startsWith('autopilot_')) return '⚙';
  const name = event.userName?.trim();
  return name ? name[0].toUpperCase() : '?';
}
