// Helpers puros de la planilla por unidad (formulario, historial, preview/PDF).
// Antes vivían dentro de UnitPayroll.jsx; el formato de moneda llegó a divergir
// entre la card del historial (sin decimales) y el form/PDF (2 decimales).
// Centralizar acá fuerza un único formato.
//
// Nota: la familia FixedPayroll usa `fmt`/`fmtSigned` (colones redondeados, sin
// decimales) en payroll-format.js. La planilla por unidad muestra 2 decimales
// porque el costo unitario por ítem puede tener fracción — contrato distinto a
// propósito, por eso vive aparte.

export function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  return '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function newSegId() {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
}

export function newSegmento() {
  return { id: newSegId(), loteId: '', loteNombre: '', labor: '', grupo: '', avanceHa: '', unidad: '-', costoUnitario: '', factorConversion: null, unidadBase: '' };
}

export function isHoraUnit(u) {
  return /^horas?$/i.test((u || '').trim());
}

// Accepts only http(s) or data:image URLs — blocks javascript:, data:text/html, etc.
export function safeImageUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  return '';
}

// Etiquetas y clases de estado de planilla (compartidas form/historial/PDF).
export const ESTADO_LABEL = { borrador: 'Borrador', pendiente: 'Pendiente', aprobada: 'Aprobada', pagada: 'Pagada' };
export const ESTADO_CLASS = { borrador: 'otro', pendiente: 'pendiente', aprobada: 'aprobado', pagada: 'active' };
