import { fmt } from '../lib/format';

/**
 * DesgloseBar — mini stacked bar que muestra la composición de un costo
 * (combustible, planilla, insumos, depreciación, indirectos) como segmentos
 * horizontales proporcionales. Usado en la columna "Composición" de CostTable
 * y en cualquier lugar que quiera resumir un desglose en una sola línea de 6px.
 *
 * Si el total es 0 o negativo, no renderiza nada (el caller decide qué mostrar
 * en su lugar — típicamente un guion).
 */
export default function DesgloseBar({ desglose }) {
  const {
    combustible = 0,
    planilla = 0,
    insumos = 0,
    depreciacion = 0,
    indirectos = 0,
  } = desglose || {};
  const total = combustible + planilla + insumos + depreciacion + indirectos;
  if (total <= 0) return null;
  const pct = (v) => `${((v / total) * 100).toFixed(1)}%`;

  return (
    <div className="cost-desglose-bar">
      {combustible > 0 && (
        <div className="cost-bar-comb" style={{ width: pct(combustible) }} title={`Combustible: ${fmt(combustible)}`} />
      )}
      {planilla > 0 && (
        <div className="cost-bar-plan" style={{ width: pct(planilla) }} title={`Planilla: ${fmt(planilla)}`} />
      )}
      {insumos > 0 && (
        <div className="cost-bar-ins" style={{ width: pct(insumos) }} title={`Insumos: ${fmt(insumos)}`} />
      )}
      {depreciacion > 0 && (
        <div className="cost-bar-dep" style={{ width: pct(depreciacion) }} title={`Depreciación: ${fmt(depreciacion)}`} />
      )}
      {indirectos > 0 && (
        <div className="cost-bar-ind" style={{ width: pct(indirectos) }} title={`Indirectos: ${fmt(indirectos)}`} />
      )}
    </div>
  );
}
