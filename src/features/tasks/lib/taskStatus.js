// Helpers de estado de tarea basados en fecha de vencimiento.
//
// El estado de una tarea se deriva de su `status` (completada o no) y, si no lo
// está, de comparar `dueDate` contra hoy a nivel de día (ignorando la hora).
// Antes esta lógica estaba duplicada en Dashboard y TaskTracking; ahora es la
// única fuente de verdad para mantener ambos consistentes.

// Normaliza una fecha al inicio del día local (00:00) para comparar solo días.
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Devuelve el estado lógico de una tarea: 'completed' | 'overdue' | 'pending'.
 * @param {{status?: string, dueDate?: string|number|Date}} task
 * @param {Date} [now] inyectable para tests
 */
export function getTaskStatus(task, now = new Date()) {
  if (task.status === 'completed_by_user') return 'completed';
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return 'pending'; // dueDate inválida → no la contamos como vencida
  if (startOfDay(dueDate) < startOfDay(now)) return 'overdue';
  return 'pending';
}

// Tareas que nunca deben contar como accionables en los resúmenes/listados:
// recordatorios de 3 días (ruido) y tareas saltadas por el usuario.
export function isCountableTask(task) {
  return task.type !== 'REMINDER_3_DAY' && task.status !== 'skipped';
}

// Lee un Set de ids desde una key de localStorage con JSON array. Tolerante a
// errores de parseo (devuelve Set vacío).
export function readIdSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}

// Keys de localStorage compartidas entre Dashboard y TaskTracking. Deben
// coincidir exactamente o los conteos del Dashboard divergirán del listado.
export const archivedTasksKey = (uid) => `aurora_archived_tasks_${uid || 'guest'}`;
export const dismissedTasksKey = (uid) => `aurora_dismissed_tasks_${uid || 'guest'}`;
