/**
 * Formateadores numéricos compartidos del dominio costs.
 *
 * Centralizados acá porque se usan en CostCenter (KPIs, lista de
 * indirectos, snapshot rows), CostTable y DesgloseBar — el umbral de
 * "tres usos" justifica extraer (docs/code-standards.md §5).
 */

const NUM_OPTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const KG_OPTS  = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

/** Formatea un número con 2 decimales en formato es-CR. Devuelve '—' si nulo. */
export const fmt = (n) =>
  n != null ? n.toLocaleString('es-CR', NUM_OPTS) : '—';

/** Formatea kilos sin decimales en formato es-CR. Devuelve '—' si nulo. */
export const fmtKg = (n) =>
  n != null ? n.toLocaleString('es-CR', KG_OPTS) : '—';
