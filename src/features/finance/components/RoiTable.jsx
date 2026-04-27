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

function tone(v) {
  if (v == null) return '';
  if (v > 0) return 'positive';
  if (v < 0) return 'negative';
  return '';
}
const numToneClass = (v) => { const t = tone(v); return t ? `cost-num--${t}` : ''; };
const kpiToneClass = (v) => { const t = tone(v); return t ? `cost-kpi--${t}` : ''; };

function RoiRow({ row, displayName }) {
  const tCls = numToneClass(row.margen);
  return (
    <tr>
      <td className="cost-td-name">{displayName}</td>
      <td className="aur-td-num">{fmt(row.ingresos)}</td>
      <td className="aur-td-num">{fmt(row.costos)}</td>
      <td className={`aur-td-num cost-td-total ${tCls}`}>{fmt(row.margen)}</td>
      <td className={`aur-td-num ${tCls}`}>{fmtPct(row.margenPct)}</td>
      <td className="aur-td-num">{fmtKg(row.kg)}</td>
      <td className="aur-td-num">{row.precioPromedio != null ? fmt(row.precioPromedio) : '—'}</td>
      <td className="aur-td-num">{row.costoPorKg != null ? fmt(row.costoPorKg) : '—'}</td>
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

  if (loading) return <div className="cost-loading">Calculando rentabilidad…</div>;
  if (error) return <div className="cost-empty cost-num--negative">{error}</div>;
  if (!data) return <div className="cost-empty">Sin datos.</div>;

  const kpiTone = kpiToneClass(data.resumen.margen);

  return (
    <div>
      {/* KPIs de rentabilidad */}
      <div className="cost-kpis cost-kpis--tight">
        <div className="cost-kpi">
          <span className="cost-kpi-label">Ingresos</span>
          <span className="cost-kpi-value">{fmt(data.resumen.ingresos)}</span>
        </div>
        <div className="cost-kpi">
          <span className="cost-kpi-label">Costos</span>
          <span className="cost-kpi-value">{fmt(data.resumen.costos)}</span>
        </div>
        <div className={`cost-kpi cost-kpi--accent ${kpiTone}`}>
          <span className="cost-kpi-label">Margen</span>
          <span className="cost-kpi-value">{fmt(data.resumen.margen)}</span>
        </div>
        <div className={`cost-kpi ${kpiTone}`}>
          <span className="cost-kpi-label">Margen %</span>
          <span className="cost-kpi-value">{fmtPct(data.resumen.margenPct)}</span>
        </div>
        <div className="cost-kpi">
          <span className="cost-kpi-label">Precio / Kg</span>
          <span className="cost-kpi-value">{data.resumen.precioPromedio != null ? fmt(data.resumen.precioPromedio) : '—'}</span>
        </div>
      </div>

      {/* Aviso si hubo prorrateo de ingresos no atribuidos */}
      {data.meta?.unattributedAmount > 0 && (
        <div className="cost-notice cost-notice--warn">
          {fmt(data.meta.unattributedAmount)} en ingresos no se pudo atribuir directamente a un lote.
          {data.meta.unattributedProrated
            ? ' Se prorrateó proporcional al kg cosechado del período.'
            : ' No se pudo prorratear (sin cosecha en el período); el monto queda solo en el resumen.'}
        </div>
      )}

      {/* Sub-tabs para lote/grupo/bloque */}
      <div className="cost-tabs" role="tablist">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={subTab === t.id}
            className={`cost-tabs-btn${subTab === t.id ? ' is-active' : ''}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      {rows.length === 0 ? (
        <div className="cost-empty">Sin datos para el rango seleccionado.</div>
      ) : (
        <div className="aur-table-wrap">
          <table className="aur-table">
            <thead>
              <tr>
                <th>{subTab === 'general' ? 'Finca' : subTab === 'lote' ? 'Lote' : subTab === 'grupo' ? 'Grupo' : 'Bloque'}</th>
                <th className="aur-td-num">Ingresos</th>
                <th className="aur-td-num">Costos</th>
                <th className="aur-td-num">Margen</th>
                <th className="aur-td-num">Margen %</th>
                <th className="aur-td-num">Kg</th>
                <th className="aur-td-num">Precio/Kg</th>
                <th className="aur-td-num">Costo/Kg</th>
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
