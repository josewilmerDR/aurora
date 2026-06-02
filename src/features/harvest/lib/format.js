// Formatters compartidos del dominio harvest (CosechaRegistro / CosechaDespachos).
// Antes vivían duplicados byte-a-byte en ambas páginas. Punto #13 audit.

// Fecha corta es-ES ("02 jun 26"). Tolera valores no parseables devolviendo
// el crudo, y null/'' devolviendo guion.
export const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
};

// Número con separador de miles es-ES. null/'' → guion. `dec` opcional fija
// los decimales (con locale, no toFixed) — útil para magnitudes fraccionarias
// como cajas, donde redondear a entero esconde producto. Sin `dec` formatea
// como entero localizado (comportamiento histórico que consumen las hermanas).
export const num = (v, dec) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (dec != null) {
    return n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  return n.toLocaleString('es-ES');
};
