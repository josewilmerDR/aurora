import { useMemo } from 'react';
import { FiSliders } from 'react-icons/fi';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { fmt, fmtKg } from '../lib/format';
import DesgloseBar from './DesgloseBar';

/**
 * Tabla de costos por entidad (lote, grupo, bloque, finca completa).
 *
 * 10 columnas en total — `name`, las 5 categorías de desglose
 * (combustible/planilla/insumos/depreciación/indirectos), `total`, `kg`,
 * `costoPorKg` y `composicion` (la mini stacked bar). Los 5 desgloses son
 * útiles para análisis profundo pero abruman en uso casual; por eso la
 * vista compacta deja sólo `name + total + kg + costoPorKg + composicion`
 * (la barra ya transmite la mezcla visualmente).
 *
 * El preset es persistido por navegador via `useTableColumnPreset` con la
 * llave `aurora_cost_table_columns`. Todas las instancias de CostTable
 * (vista principal, snapshot detail, compare side-by-side) comparten el
 * mismo modo — toggling en una se refleja en la siguiente que monte.
 *
 * Props:
 *   - rows              array · filas a mostrar (cada una con desglose,
 *                              costoTotal, kg, costoPorKg, displayName)
 *   - nameLabel         string · header de la primera columna ("Lote", "Grupo"…)
 *   - showColumnToggle  bool  · si true, renderiza el botón "Vista compacta /
 *                              Mostrar todas" arriba de la tabla. Default: true.
 *                              Pasar false en contextos secundarios (snapshot
 *                              detail, compare) para no duplicar el control.
 *   - emptyMessage      string · mensaje cuando no hay filas. Default sugiere
 *                              ampliar el rango de fechas.
 */

const ALL_COLUMNS = (nameLabel) => [
  { id: 'name',         label: nameLabel,    accessor: (r) => r.displayName,                                            tdClass: 'cost-td-name' },
  { id: 'combustible',  label: 'Combustible', accessor: (r) => fmt(r.desglose?.combustible),                            thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'planilla',     label: 'Planilla',    accessor: (r) => fmt(r.desglose?.planilla),                               thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'insumos',      label: 'Insumos',     accessor: (r) => fmt(r.desglose?.insumos),                                thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'depreciacion', label: 'Deprec.',     accessor: (r) => fmt(r.desglose?.depreciacion),                           thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'indirectos',   label: 'Indirectos',  accessor: (r) => fmt(r.desglose?.indirectos),                             thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'total',        label: 'Total',       accessor: (r) => fmt(r.costoTotal),                                       thClass: 'aur-td-num', tdClass: 'aur-td-num cost-td-total' },
  { id: 'kg',           label: 'Kg',          accessor: (r) => fmtKg(r.kg),                                             thClass: 'aur-td-num', tdClass: 'aur-td-num' },
  { id: 'costoPorKg',   label: 'Costo/Kg',    accessor: (r) => (r.costoPorKg != null ? fmt(r.costoPorKg) : '—'),        thClass: 'aur-td-num', tdClass: 'aur-td-num cost-td-costkg' },
  { id: 'composicion',  label: 'Composición', accessor: (r) => <DesgloseBar desglose={r.desglose} /> },
];

const COMPACT_IDS = ['name', 'total', 'kg', 'costoPorKg', 'composicion'];
const STORAGE_KEY = 'aurora_cost_table_columns';

export default function CostTable({
  rows,
  nameLabel,
  showColumnToggle = true,
  emptyMessage = 'Sin datos para el rango seleccionado. Probá ampliar las fechas o cambiar de pestaña.',
}) {
  const columns = useMemo(() => ALL_COLUMNS(nameLabel), [nameLabel]);
  const { visibleColumns, isCompact, setMode } = useTableColumnPreset(
    columns,
    COMPACT_IDS,
    STORAGE_KEY
  );

  if (!rows || rows.length === 0) {
    return <div className="cost-empty">{emptyMessage}</div>;
  }

  return (
    <div className="cost-table-container">
      {showColumnToggle && (
        <div className="cost-table-toolbar">
          <button
            type="button"
            className="cost-table-btn aur-touch-target"
            onClick={() => setMode(isCompact ? 'full' : 'compact')}
            title={isCompact ? 'Ver todas las columnas' : 'Volver a la vista compacta'}
          >
            <FiSliders size={12} />
            {isCompact ? 'Mostrar todas (10 cols)' : 'Vista compacta (5 cols)'}
          </button>
        </div>
      )}
      <div className="aur-table-wrap">
        <table className="aur-table">
          <thead>
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.id} className={c.thClass}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {visibleColumns.map((c) => (
                  <td key={c.id} className={c.tdClass}>{c.accessor(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
