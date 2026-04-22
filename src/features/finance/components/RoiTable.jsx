import { useState, useEffect, useMemo } from 'react';
import { useApiFetch } from '../../../hooks/useApiFetch';

const SUB_TABS = [
  { id: 'general', label: 'General' },
  { id: 'lote',    label: 'Por Lote' },
  { id: 'grupo',   label: 'Por Grupo' },
  { id: 'bloque',  label: 'Por Bloque' },
];

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtKg = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CR', { maximumFractionDigits: 0 }));
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`);

// Color de la celda de margen según signo.
function marginClass(margen) {
  if (margen == null) return '';
  if (margen > 0) return 'roi-positive';
  if (margen < 0) return 'roi-negative';
  return '';
}

function RoiRow({ row, displayName }) {
  return (
    <tr>
      <td className="cc-td-name">{displayName}</td>
      <td className="cc-td-num">{fmt(row.ingresos)}</td>
      <td className="cc-td-num">{fmt(row.costos)}</td>
      <td className={`cc-td-num ${marginClass(row.margen)}`} style={{ fontWeight: 600 }}>{fmt(row.margen)}</td>
      <td className={`cc-td-num ${marginClass(row.margen)}`}>{fmtPct(row.margenPct)}</td>
      <td className="cc-td-num">{fmtKg(row.kg)}</td>
      <td className="cc-td-num">{row.precioPromedio != null ? fmt(row.precioPromedio) : '—'}</td>
      <td className="cc-td-num">{row.costoPorKg != null ? fmt(row.costoPorKg) : '—'}</td>
    </tr>
  );
}

function RoiTable({ desde, hasta }) {
  const apiFetch = useApiFetch();
  const [subTab, setSubTab] = useState('lote');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!desde || !hasta) return;
    setLoading(true);
    setError(null);
    apiFetch(`/api/roi/live?desde=${desde}&hasta=${hasta}`)
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || 'No se pudo cargar el reporte.');
        }
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [desde, hasta, apiFetch]);

  const rows = useMemo(() => {
    if (!data) return [];
    switch (subTab) {
      case 'general':
        return [{ ...data.resumen, __displayName: 'Finca (Total)' }];
      case 'lote':
        return data.porLote.map(r => ({ ...r, __displayName: r.loteNombre }));
      case 'grupo':
        return data.porGrupo.map(r => ({ ...r, __displayName: `${r.loteNombre} / ${r.grupo}` }));
      case 'bloque':
        return data.porBloque.map(r => ({ ...r, __displayName: `${r.loteNombre} / ${r.bloque}` }));
      default: return [];
    }
  }, [data, subTab]);

  if (loading) return <div className="cc-loading">Calculando rentabilidad…</div>;
  if (error) return <div className="cc-empty" style={{ color: '#ff8080' }}>{error}</div>;
  if (!data) return <div className="cc-empty">Sin datos.</div>;

  return (
    <div>
      {/* KPIs de rentabilidad */}
      <div className="cc-kpis" style={{ marginBottom: 12 }}>
        <div className="cc-kpi">
          <span className="cc-kpi-label">Ingresos</span>
          <span className="cc-kpi-value">{fmt(data.resumen.ingresos)}</span>
        </div>
        <div className="cc-kpi">
          <span className="cc-kpi-label">Costos</span>
          <span className="cc-kpi-value">{fmt(data.resumen.costos)}</span>
        </div>
        <div className={`cc-kpi cc-kpi--highlight ${marginClass(data.resumen.margen)}`}>
          <span className="cc-kpi-label">Margen</span>
          <span className="cc-kpi-value">{fmt(data.resumen.margen)}</span>
        </div>
        <div className={`cc-kpi ${marginClass(data.resumen.margen)}`}>
          <span className="cc-kpi-label">Margen %</span>
          <span className="cc-kpi-value">{fmtPct(data.resumen.margenPct)}</span>
        </div>
        <div className="cc-kpi">
          <span className="cc-kpi-label">Precio / Kg</span>
          <span className="cc-kpi-value">{data.resumen.precioPromedio != null ? fmt(data.resumen.precioPromedio) : '—'}</span>
        </div>
      </div>

      {/* Aviso si hubo prorrateo de ingresos no atribuidos */}
      {data.meta?.unattributedAmount > 0 && (
        <div className="roi-notice">
          {fmt(data.meta.unattributedAmount)} en ingresos no se pudo atribuir directamente a un lote.
          {data.meta.unattributedProrated
            ? ' Se prorrateó proporcional al kg cosechado del período.'
            : ' No se pudo prorratear (sin cosecha en el período); el monto queda solo en el resumen.'}
        </div>
      )}

      {/* Sub-tabs para lote/grupo/bloque */}
      <div className="cc-tabs">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={`cc-tab${subTab === t.id ? ' cc-tab--active' : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <div className="cc-empty">Sin datos para el rango seleccionado.</div>
      ) : (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>{subTab === 'general' ? 'Finca' : subTab === 'lote' ? 'Lote' : subTab === 'grupo' ? 'Grupo' : 'Bloque'}</th>
                <th className="cc-th-num">Ingresos</th>
                <th className="cc-th-num">Costos</th>
                <th className="cc-th-num">Margen</th>
                <th className="cc-th-num">Margen %</th>
                <th className="cc-th-num">Kg</th>
                <th className="cc-th-num">Precio/Kg</th>
                <th className="cc-th-num">Costo/Kg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <RoiRow key={i} row={r} displayName={r.__displayName} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RoiTable;
