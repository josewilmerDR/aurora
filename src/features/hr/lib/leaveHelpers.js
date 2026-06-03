// Helpers puros y constantes del módulo de permisos/ausencias (LeaveRequests
// + LeaveCalendar). Centralizados acá para que la lista y el calendario no
// dupliquen las etiquetas de tipo/estado ni los cálculos de duración (antes
// vivían en dos fuentes que podían divergir).

/** Tipos de permiso. `conGoce` decide si el permiso paga salario. */
export const TIPOS = [
  { value: 'vacaciones',        label: 'Vacaciones',          conGoce: true  },
  { value: 'enfermedad',        label: 'Enfermedad',          conGoce: true  },
  { value: 'permiso_con_goce',  label: 'Permiso con goce',    conGoce: true  },
  { value: 'permiso_sin_goce',  label: 'Permiso sin goce',    conGoce: false },
  { value: 'licencia',          label: 'Licencia',            conGoce: true  },
];

/** value → label, derivado de TIPOS (única fuente de verdad). */
export const TIPO_LABELS = Object.fromEntries(TIPOS.map(t => [t.value, t.label]));

/** Etiqueta legible del tipo, tolerante a values desconocidos. */
export const tipoLabel = (value) => TIPO_LABELS[value] || value;

/** Etiquetas capitalizadas de estado para la UI. */
export const ESTADO_LABELS = {
  pendiente: 'Pendiente',
  aprobado:  'Aprobado',
  rechazado: 'Rechazado',
};

export const estadoLabel = (estado) => ESTADO_LABELS[estado] || estado;

export const MOTIVO_MAX = 500;
export const MAX_DIAS = 365;

/** Días calendario (inclusivos) entre dos fechas YYYY-MM-DD. Mínimo 1. */
export function calcDias(inicio, fin) {
  if (!inicio || !fin) return 1;
  const ms = new Date(fin) - new Date(inicio);
  if (!Number.isFinite(ms)) return 1;
  const d = Math.round(ms / 86400000) + 1;
  return Math.max(1, d);
}

/** Horas (1 decimal) entre dos horas HH:MM del mismo día. 0 si fin <= inicio. */
export function calcHoras(horaInicio, horaFin) {
  if (!horaInicio || !horaFin) return 0;
  const [h1, m1] = horaInicio.split(':').map(Number);
  const [h2, m2] = horaFin.split(':').map(Number);
  const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  return Math.max(0, Math.round(mins / 60 * 10) / 10);
}

/** Valida el form de permiso. Devuelve un mapa field → mensaje. */
export function validateLeave(form, esParcial) {
  const errors = {};
  if (!form.trabajadorId) errors.trabajadorId = 'Selecciona un trabajador.';
  if (!form.fechaInicio) errors.fechaInicio = 'Fecha inicio requerida.';
  if (esParcial) {
    const h = calcHoras(form.horaInicio, form.horaFin);
    if (!form.horaInicio || !form.horaFin || h <= 0) errors.horaFin = 'La hora fin debe ser posterior a la hora inicio.';
    else if (h > 24) errors.horaFin = 'Las horas no pueden exceder 24.';
  } else {
    if (!form.fechaFin) {
      errors.fechaFin = 'Fecha fin requerida.';
    } else if (form.fechaFin < form.fechaInicio) {
      errors.fechaFin = 'La fecha fin no puede ser anterior a la fecha inicio.';
    } else if (calcDias(form.fechaInicio, form.fechaFin) > MAX_DIAS) {
      errors.fechaFin = `El rango no puede exceder ${MAX_DIAS} días.`;
    }
  }
  if (form.motivo && form.motivo.length > MOTIVO_MAX) errors.motivo = `El motivo no puede exceder ${MOTIVO_MAX} caracteres.`;
  return errors;
}
