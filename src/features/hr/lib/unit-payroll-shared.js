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

// Formato de fecha para display. Recibe ISO completo o 'YYYY-MM-DD' y lo ancla a
// MEDIODÍA local: `new Date('2026-05-01')` se interpreta como medianoche UTC y en
// CR (UTC-6) se corre al día anterior. El ancla de mediodía evita ese off-by-one
// sin depender del huso.
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Cantidad genérica (avance, unidades): hasta 2 decimales, sin forzar mínimos
// para no inflar enteros ("12" en vez de "12,00").
export function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 });
}

// Hectáreas: SIEMPRE 2 decimales para que la columna numérica escanee pareja
// (todas las filas con la misma cantidad de dígitos fraccionarios).
export function fmtHa(n) {
  return n == null ? '—' : Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Parsea "220 - GUARDA DE SEGURIDAD" → { codigo: '220', descripcion: 'GUARDA DE SEGURIDAD' }.
// El formato persistido de labor es el string "codigo - descripcion"; este helper
// lo descompone para el preview/PDF (legend y celdas compactas).
export function parseLaborString(raw) {
  const s = raw || '';
  const dash = s.indexOf(' - ');
  return dash !== -1
    ? { codigo: s.slice(0, dash).trim(), descripcion: s.slice(dash + 3).trim() }
    : { codigo: s, descripcion: '' };
}

// Cuenta los trabajadores de una planilla guardada con al menos una cantidad > 0.
// El array `trabajadores` puede incluir gente sin cantidades; este conteo refleja
// lo que realmente aparece en el documento (coincide con el preview).
export function countTrabajadoresConCantidad(trabajadores) {
  return (trabajadores || []).filter(
    t => Object.values(t.cantidades || {}).some(v => v && Number(v) !== 0),
  ).length;
}
