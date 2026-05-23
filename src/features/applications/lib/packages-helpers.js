// ═══════════════════════════════════════════════════════════════════════════
// PACKAGES — Helpers puros (sin React, sin estado, sin DOM)
//
// Funciones extraídas de PackageManagement.jsx (Fase A del refactor para
// poner el archivo bajo el límite de 600 LOC de docs/code-standards.md §9).
//
// Convención: todo lo que esté aquí debe ser pura — entrada → salida, sin
// side effects ni dependencias de React. Para helpers que tocan localStorage
// (draft persistence) o calculan diffs sobre formData, ver packages-draft.js
// (Fase B, pendiente).
// ═══════════════════════════════════════════════════════════════════════════

// ── Límites de campos (validación + maxLength inputs) ───────────────────────
export const NOMBRE_MAX = 32;
export const DESCRIPCION_MAX = 1024;
export const TECNICO_MAX = 48;
export const ACT_NAME_MAX = 120;
export const ACT_DAY_MAX = 1825;
export const ACT_PRODUCTOS_MAX = 24;
export const PRODUCT_CANT_MAX = 1024;

// ── Reglas de validación reutilizables ───────────────────────────────────────
// Funciones puras compartidas entre el submit batch (`validateForm`) y los
// blur handlers (validación progresiva por campo). Centralizar acá previene
// drift entre ambos caminos — antes el submit definía las reglas inline y no
// había forma de validar por campo sin duplicar.

export function getPackageFieldError(field, value) {
  switch (field) {
    case 'nombrePaquete': {
      const v = (value || '').trim();
      if (!v) return 'El nombre es requerido.';
      if ((value || '').length > NOMBRE_MAX) return `Máximo ${NOMBRE_MAX} caracteres.`;
      return null;
    }
    case 'descripcion':
      return ((value || '').length > DESCRIPCION_MAX) ? `Máximo ${DESCRIPCION_MAX} caracteres.` : null;
    case 'tecnicoResponsable':
      return ((value || '').length > TECNICO_MAX) ? `Máximo ${TECNICO_MAX} caracteres.` : null;
    case 'tipoCosecha':
      return !value ? 'Selecciona el tipo de cosecha.' : null;
    case 'etapaCultivo':
      return !value ? 'Selecciona la etapa.' : null;
    default:
      return null;
  }
}

export function getActivityFieldError(field, value) {
  switch (field) {
    case 'name': {
      const v = (value || '').trim();
      if (!v) return 'Nombre requerido.';
      if ((value || '').length > ACT_NAME_MAX) return `Máximo ${ACT_NAME_MAX} caracteres.`;
      return null;
    }
    case 'day': {
      const n = Number(value);
      if (value === '' || value == null || !Number.isInteger(n) || n < 0 || n > ACT_DAY_MAX) {
        return `Día entre 0 y ${ACT_DAY_MAX}.`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function getProductCantidadError(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= PRODUCT_CANT_MAX) {
    return `Cantidad mayor a 0 y menor a ${PRODUCT_CANT_MAX}.`;
  }
  return null;
}

// ── Mensaje específico de validación del form ────────────────────────────────
// Convierte el objeto `formErrors` en un toast accionable: si hay un solo
// error, lo nombra; si hay varios, separa cuántos son de campos top-level
// vs cuántas actividades quedaron incompletas.
const PKG_FIELD_LABELS = {
  nombrePaquete: 'el nombre del paquete',
  descripcion: 'la descripción',
  tipoCosecha: 'el tipo de cosecha',
  etapaCultivo: 'la etapa del cultivo',
  tecnicoResponsable: 'el técnico responsable',
};

export function buildValidationToast(errors) {
  const keys = Object.keys(errors);
  if (keys.length === 0) return '';

  if (keys.length === 1) {
    const key = keys[0];
    if (PKG_FIELD_LABELS[key]) return `Revisa ${PKG_FIELD_LABELS[key]}.`;
    const m = key.match(/^act-(\d+)-(.+)$/);
    if (m) {
      const idx = Number(m[1]) + 1;
      const sub = m[2];
      if (sub === 'name') return `Falta el nombre de la actividad ${idx}.`;
      if (sub === 'day') return `Revisa el día de la actividad ${idx}.`;
      if (sub === 'prods') return `Demasiados productos en la actividad ${idx}.`;
      if (sub.startsWith('prod-')) return `Revisa la cantidad de un producto en la actividad ${idx}.`;
    }
    return 'Hay un campo con error.';
  }

  const topLevel = keys.filter(k => k in PKG_FIELD_LABELS).length;
  const actIndices = new Set();
  keys.forEach(k => {
    const m = k.match(/^act-(\d+)-/);
    if (m) actIndices.add(m[1]);
  });
  const acts = actIndices.size;

  if (topLevel > 0 && acts > 0) {
    const a = topLevel === 1 ? '1 campo del paquete' : `${topLevel} campos del paquete`;
    const b = acts === 1 ? '1 actividad incompleta' : `${acts} actividades incompletas`;
    return `Revisa ${a} y ${b}.`;
  }
  if (topLevel > 0) {
    return topLevel === 1
      ? 'Revisa 1 campo del paquete marcado en rojo.'
      : `Revisa ${topLevel} campos del paquete marcados en rojo.`;
  }
  return acts === 1
    ? '1 actividad está incompleta.'
    : `${acts} actividades están incompletas.`;
}

// ── Cálculo de costo de mezcla por hectárea ──────────────────────────────────
// Acepta una lista plana de productos usados ({productoId, cantidadPorHa}) y el
// catálogo. Retorna totales por moneda + flags para alertar al usuario cuando
// hay productos sin precio (que quedarían fuera del costo). Esto evita que el
// usuario crea que un paquete cuesta menos de lo real solo porque su catálogo
// está incompleto.
// Acepta el catálogo como array o como Map<id, producto>. El llamador
// debería pasar Map (via productosById useMemo) para evitar el .find() O(n)
// por cada producto de la mezcla — clave para listas con 30+ paquetes que
// se re-renderizan en cada keystroke del form.
export function calcularCosto(productosUsados, productosCatalogoOrMap) {
  const isMap = productosCatalogoOrMap instanceof Map;
  const lookup = isMap
    ? (id) => productosCatalogoOrMap.get(id)
    : (id) => (productosCatalogoOrMap || []).find(cp => cp.id === id);
  const totals = {};
  let withoutPrice = 0;
  const total = (productosUsados || []).length;
  (productosUsados || []).forEach(p => {
    const cat = lookup(p.productoId);
    const precio = parseFloat(cat?.precioUnitario) || 0;
    if (precio <= 0) {
      withoutPrice += 1;
      return;
    }
    const mon = cat?.moneda || 'USD';
    const qty = parseFloat(p.cantidadPorHa) || 0;
    totals[mon] = (totals[mon] || 0) + qty * precio;
  });
  return {
    totals: Object.entries(totals),
    total,
    withoutPrice,
    hasMissingPrice: withoutPrice > 0,
    allMissingPrice: total > 0 && withoutPrice === total,
  };
}

export function flattenActivityProducts(activities) {
  return (activities || []).flatMap(a => a.productos || []);
}

// Texto del tooltip de advertencia cuando hay productos sin precio en catálogo.
export function missingPriceTooltip(n) {
  return n === 1
    ? '1 producto sin precio en el catálogo no está incluido en este total.'
    : `${n} productos sin precio en el catálogo no están incluidos en este total.`;
}

// ── Avatar del paquete (bubble del carrusel) ─────────────────────────────────
// Reemplaza el viejo slice(0,4) que colisionaba en nombres similares
// ("Postforza Premium" y "Postforza Estándar" ambos mostraban "POST"). Ahora
// las iniciales se sacan de las primeras 3 palabras; si el nombre es de una
// sola palabra, se toman los 2 primeros caracteres. Además, el fondo del
// avatar se selecciona desde una paleta de 8 colores compatibles con Aurora
// mediante un hash determinista del nombre — el mismo paquete siempre tendrá
// el mismo color, y nombres distintos casi nunca se ven igual.
export function getPkgInitials(name) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

const PKG_AVATAR_PALETTE = [
  { bg: 'rgba(51, 255, 153, 0.14)', fg: '#33ff99' },   // aurora green
  { bg: 'rgba(204, 51, 255, 0.16)', fg: '#cc99ff' },   // magenta/lavender
  { bg: 'rgba(102, 178, 255, 0.16)', fg: '#66b2ff' },  // blue
  { bg: 'rgba(255, 184, 77, 0.16)', fg: '#ffb84d' },   // amber
  { bg: 'rgba(255, 102, 153, 0.16)', fg: '#ff6699' },  // pink
  { bg: 'rgba(102, 255, 204, 0.14)', fg: '#66ffcc' },  // teal
  { bg: 'rgba(204, 153, 255, 0.16)', fg: '#cc99ff' },  // lavender
  { bg: 'rgba(255, 204, 102, 0.16)', fg: '#ffcc66' },  // gold
];

export function pickPkgAvatarStyle(name) {
  const key = name || '';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PKG_AVATAR_PALETTE[Math.abs(hash) % PKG_AVATAR_PALETTE.length];
}
