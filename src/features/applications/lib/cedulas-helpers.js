// ═══════════════════════════════════════════════════════════════════════════
// CEDULAS — helpers puros + constantes de dominio
//
// Extraído de CedulasAplicacion.jsx (Fase 1 del refactor del punto #7 del
// audit UX/UI — ver docs/code-standards.md §9 para el límite de 600 LOC en
// React pages). Mismo patrón que packages-helpers.js / packages-draft.js.
//
// Solo funciones puras y constantes — nada de React, nada de fetch. Cada uno
// puede importarse desde el orquestador (CedulasAplicacion) o desde los
// componentes extraídos (AplicadaModal, próximamente CedulaDocumento, etc.)
// sin recrear dependencias circulares.
// ═══════════════════════════════════════════════════════════════════════════

/** Convierte timestamp de Firestore (`{_seconds}`) o string ISO a Date. */
export const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return new Date(ts);
};

/** Fecha en formato dd/mm/aaaa, UTC para no shiftear por zona horaria. */
export const formatDateLong = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

/** Versión corta del formato fecha — alias intencional para que el call site
 *  comunique "fecha cortita para tarjetas" vs "fecha larga para documentos". */
export const formatShortDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

/** "12 ha" / "12.5 ha" / null si el valor no es numérico positivo. Sin
 *  decimal cuando es entero (12 ha en vez de 12.0 ha). Usado por los
 *  chips informativos en las cards del listing (punto #15 audit). */
export const formatHectareas = (ha) => {
  const n = Number(ha);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(1).replace(/\.0$/, '')} ha`;
};

/** Defaults de días por ciclo (siembra → I cosecha, etc.). El admin puede
 *  pisarlos en /config y `calcFechaCosecha` los mergea on top. */
export const PARAM_DEFAULTS = {
  diasSiembraICosecha: 400,
  diasForzaICosecha:   150,
  diasChapeaIICosecha: 215,
  diasForzaIICosecha:  150,
};

/** Fecha proyectada de cosecha a partir del source (lote/grupo) + config. */
export const calcFechaCosecha = (source, config) => {
  if (!source?.fechaCreacion) return null;
  const cosecha = source.cosecha || '';
  const etapa   = source.etapa   || '';
  const cfg = { ...PARAM_DEFAULTS, ...config };
  let dias = null;
  if (cosecha === 'I Cosecha') {
    if (etapa === 'Desarrollo')  dias = cfg.diasSiembraICosecha;
    else if (etapa === 'Postforza') dias = cfg.diasForzaICosecha;
  } else if (cosecha === 'II Cosecha') {
    if (etapa === 'Desarrollo')  dias = cfg.diasChapeaIICosecha;
    else if (etapa === 'Postforza') dias = cfg.diasForzaIICosecha;
  }
  if (dias == null) return null;
  const base = tsToDate(source.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + Number(dias));
  return result;
};

/** True si la task está pasada y no completada. Comparación por día (no hora)
 *  para que una task de hoy NO sea vencida aunque el hour-of-day ya pasó. */
export const isOverdue = (task) => {
  if (task.status === 'completed_by_user') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  return new Date(due.getFullYear(), due.getMonth(), due.getDate())
    < new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

/** Tarea creada manualmente por el usuario (fuera del paquete) → type 'MANUAL'. */
export const isManualTask = (task) => task?.type === 'MANUAL';

/** Mapping legible del status de cédula. Hoy sólo usado para futuras
 *  extracciones de cards/badges (CedulaCard fase 5 del refactor). */
export const CEDULA_STATUS_LABEL = {
  pendiente:         'Pendiente',
  en_transito:       'En Tránsito',
  aplicada_en_campo: 'Aplicada',
};

/** Opciones del select de condiciones del tiempo en AplicadaModal. */
export const CONDICIONES_TIEMPO = [
  'Soleado', 'Despejado', 'Parcialmente nublado', 'Nublado',
  'Llovizna', 'Lluvia', 'Ventoso', 'Niebla', 'Tormenta',
];

/** HH:MM de ahora — default del campo Hora Final al abrir AplicadaModal. */
export const nowTimeStr = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
};
