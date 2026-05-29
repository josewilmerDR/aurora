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

/** Calcula el status que una task debería tener según el estado actual de
 *  sus cédulas. Pura, idempotente — apta para llamar desde un updater de
 *  `setCedulas(prev => ...)` sin stale closures.
 *
 *  Reglas:
 *   - 'pending'           si ≥1 cédula sigue activa (no terminó en
 *                         `aplicada_en_campo` ni `anulada`). Cualquier
 *                         status nuevo en el futuro (`'en_revision'`, etc.)
 *                         se trata como activo por default — fail-safe:
 *                         nunca completa una task por accidente.
 *   - 'completed_by_user' si todas las cédulas son terminales y al menos
 *                         una fue aplicada en campo.
 *   - 'skipped'           si todas las cédulas son terminales y ninguna
 *                         fue aplicada (todas anuladas).
 *   - 'pending'           defensivo si no hay cédulas para esa task —
 *                         situación degenerada, no debería ocurrir tras
 *                         un update válido. Punto #19 audit. */
export const computeTaskStatusFromCedulas = (cedulas, taskId) => {
  const siblings = cedulas.filter(c => c.taskId === taskId);
  if (siblings.length === 0) return 'pending';
  const stillActive = siblings.some(c =>
    c.status !== 'aplicada_en_campo' && c.status !== 'anulada'
  );
  if (stillActive) return 'pending';
  const anyApplied = siblings.some(c => c.status === 'aplicada_en_campo');
  return anyApplied ? 'completed_by_user' : 'skipped';
};

/** Filtra tasks por rango de fechas inclusivo en dueDate. `dateFrom` y
 *  `dateTo` son strings YYYY-MM-DD (como los devuelve <input type="date">).
 *  Si alguno está vacío, ese extremo del rango se ignora. Pure — sin side
 *  effects, OK para llamar desde useMemo y desde código no-React. */
export const filterTasksByDateRange = (tasks, dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return tasks;
  const start = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const end   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;
  return tasks.filter(t => {
    const due = new Date(t.dueDate);
    if (start && due < start) return false;
    if (end   && due > end)   return false;
    return true;
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

// ─────────────────────────────────────────────────────────────────────────────
// CEDULA_STATUS_META
//
// Single source of truth para el rendering del status de una cédula: label
// legible + clase de badge. Consumido por CedulaCard, CedulaSplitCard,
// CedulaViewer (StatusBadge) e HistorialAplicaciones — antes cada uno
// hardcodeaba su propio mapping y agregar un estado nuevo ('en_revision',
// 'anulada' en sitios donde faltaba) requería tocar 4 archivos sin que el
// linter avisara.
//
// `anulada` solo se renderiza desde el viewer (las cards del listing filtran
// las anuladas upstream y el historial filtra a 'aplicada_en_campo'), pero
// vive acá para que el día que se exponga "ver anuladas" en otra vista, el
// label/color ya esté definido.
// ─────────────────────────────────────────────────────────────────────────────
export const CEDULA_STATUS_META = {
  pendiente:         { label: 'Pendiente',   badgeClass: 'aur-badge--yellow' },
  en_transito:       { label: 'En Tránsito', badgeClass: 'aur-badge--blue' },
  aplicada_en_campo: { label: 'Aplicada',    badgeClass: 'aur-badge--green' },
  anulada:           { label: 'Anulada',     badgeClass: 'aur-badge--magenta' },
};

/** Mapping legible del status de cédula (compat — preferir CEDULA_STATUS_META). */
export const CEDULA_STATUS_LABEL = Object.fromEntries(
  Object.entries(CEDULA_STATUS_META).map(([k, v]) => [k, v.label])
);

/** Devuelve el meta de un status. Fail-safe a 'pendiente' para statuses
 *  desconocidos — nunca renderiza badge en blanco si llega 'en_revision'
 *  desde una migración futura. */
export const getCedulaStatusMeta = (status) =>
  CEDULA_STATUS_META[status] || CEDULA_STATUS_META.pendiente;

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

// ─────────────────────────────────────────────────────────────────────────────
// deriveCambiosLineas
//
// Reduce el par (productosOriginales, productosAplicados) a líneas de texto
// que describen qué cambió respecto al programa original: sustituciones,
// ajustes de dosis, productos añadidos y retirados. Las líneas se imprimen
// en el bloque "Observaciones / Ajustes" del documento auditable.
//
// Antes esto vivía duplicado entre CedulaDocumento.jsx (preview) y
// CedulaViewer.jsx (historial). Cualquier evolución del audit trail tenía
// que tocarse en dos lugares — y un motivo nuevo en el futuro se omitía sin
// aviso. Punto #3 audit.
//
// Pura, idempotente — apta para llamar inline en el render del documento o
// desde tests.
// ─────────────────────────────────────────────────────────────────────────────
export const deriveCambiosLineas = ({ originales, aplicados } = {}) => {
  const orig = Array.isArray(originales) ? originales : [];
  const apl  = Array.isArray(aplicados)  ? aplicados  : [];
  if (orig.length === 0) return [];

  const origById = {};
  orig.forEach(o => { if (o?.productoId) origById[o.productoId] = o; });
  const aplicadosByOrig = {};
  apl.forEach(a => {
    if (a?.productoOriginalId) aplicadosByOrig[a.productoOriginalId] = a;
  });

  const lineas = [];
  const touchedOriginalIds = new Set();

  apl.forEach(a => {
    if (!a) return;
    const origRef = a.productoOriginalId
      ? origById[a.productoOriginalId]
      : origById[a.productoId];
    if (origRef) touchedOriginalIds.add(origRef.productoId);

    if (a.productoOriginalId && a.productoOriginalId !== a.productoId) {
      const o = origById[a.productoOriginalId];
      // El default es 'Sustitución' cuando el id realmente cambió pero no se
      // especificó motivo (compat con cédulas viejas). 'otro' y 'ajuste_dosis'
      // se distinguen explícitamente.
      const motivo = a.motivoCambio === 'ajuste_dosis' ? 'Ajuste de dosis'
                   : a.motivoCambio === 'otro'         ? 'Otro'
                   : 'Sustitución';
      lineas.push(
        `${o?.nombreComercial || o?.productoId || '—'} (${o?.cantidadPorHa ?? '—'} ${o?.unidad || ''}/Ha) sustituido por ${a.nombreComercial || a.productoId} (${a.cantidadPorHa ?? '—'} ${a.unidad || ''}/Ha) — ${motivo}`
      );
    } else if (origRef && parseFloat(origRef.cantidadPorHa) !== parseFloat(a.cantidadPorHa)) {
      lineas.push(
        `${a.nombreComercial || a.productoId}: dosis ajustada de ${origRef.cantidadPorHa ?? '—'} a ${a.cantidadPorHa ?? '—'} ${a.unidad || origRef.unidad || ''}/Ha — Ajuste de dosis`
      );
    } else if (!origRef) {
      lineas.push(
        `${a.nombreComercial || a.productoId} (${a.cantidadPorHa ?? '—'} ${a.unidad || ''}/Ha) añadido respecto al programa original`
      );
    }
  });

  orig.forEach(o => {
    if (!touchedOriginalIds.has(o.productoId) && !aplicadosByOrig[o.productoId]) {
      lineas.push(
        `${o.nombreComercial || o.productoId} (${o.cantidadPorHa ?? '—'} ${o.unidad || ''}/Ha) retirado respecto al programa original`
      );
    }
  });

  return lineas;
};
