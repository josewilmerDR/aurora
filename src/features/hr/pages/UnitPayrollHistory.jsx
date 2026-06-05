import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiX, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import AuroraDataTable from '../../../components/AuroraDataTable';
import { fmtMoney, fmtNum, fmtHa, fmtDate } from '../lib/unit-payroll-shared';
import '../styles/unit-payroll-history.css';

// ── Column value extractor (sort + filter source of truth) ──────────────────
// Texto en lowercase para que el filter por texto sea case-insensitive.
function getColVal(r, field) {
  switch (field) {
    case 'consecutivo':       return r.consecutivo || '';
    case 'fecha':             return r.fecha?.slice(0, 10) || '';
    case 'encargadoNombre':   return (r.encargadoNombre || '').toLowerCase();
    case 'aprobadoPor':       return (r.aprobadoPor || '').toLowerCase();
    case 'loteNombre':        return (r.loteNombre || '').toLowerCase();
    case 'grupo':             return (r.grupo || '').toLowerCase();
    case 'labor':             return (r.labor || '').toLowerCase();
    case 'avanceHa':          return Number(r.avanceHa) || 0;
    case 'unidad':            return (r.unidad || '').toLowerCase();
    case 'costoUnitario':     return Number(r.costoUnitario) || 0;
    case 'trabajadorNombre':  return (r.trabajadorNombre || '').toLowerCase();
    case 'cantidad':          return Number(r.cantidad) || 0;
    case 'subtotal':          return Number(r.subtotal) || 0;
    default:                  return '';
  }
}

const COLUMNS = [
  { key: 'consecutivo',      label: 'N°',           type: 'text'   },
  // `fecha` no lleva funnel: el rango de fecha lo maneja el filtro de período
  // global (arriba de la tabla). Conserva el sort. Evita doble control. #5.
  { key: 'fecha',            label: 'Fecha',        type: 'date', filterable: false },
  { key: 'encargadoNombre',  label: 'Encargado',    type: 'text'   },
  { key: 'aprobadoPor',      label: 'Aprobado por', type: 'text'   },
  { key: 'loteNombre',       label: 'Lote',         type: 'text'   },
  { key: 'grupo',            label: 'Grupo',        type: 'text'   },
  { key: 'labor',            label: 'Labor',        type: 'text'   },
  { key: 'avanceHa',         label: 'Avance (Ha)',  type: 'number', align: 'right' },
  { key: 'unidad',           label: 'Unidad',       type: 'text'   },
  { key: 'costoUnitario',    label: 'Costo Unit.',  type: 'number', align: 'right' },
  { key: 'trabajadorNombre', label: 'Trabajador',   type: 'text'   },
  { key: 'cantidad',         label: 'Cantidad',     type: 'number', align: 'right' },
  { key: 'subtotal',         label: 'Total',        type: 'number', align: 'right' },
];

// Mapa key → label, fuente única para los `data-label` de la vista móvil
// (antes estaban hardcodeados en cada <td>, divergían si cambiaba COLUMNS). #11.
const LABELS = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));

// Columnas con `id` para el preset persistido + subset compacto. El default es
// 'full' (se ven todas); el usuario puede ocultar y se recuerda por usuario. #14.
const COLS_WITH_ID = COLUMNS.map(c => ({ ...c, id: c.key }));
const COMPACT_IDS = ['consecutivo', 'fecha', 'labor', 'trabajadorNombre', 'subtotal'];

function UnitPayrollHistory() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');

  // Carga reutilizable: se vuelve a disparar al cambiar de finca (apiFetch
  // cambia con activeFincaId) y al pulsar Reintentar. Sin esto, abrir el tab
  // una vez dejaba la lista congelada — incluso tras aprobar una planilla
  // nueva en el Editor o cambiar de finca. #2.
  const loadData = useCallback(() => {
    setLoading(true);
    setError(false);
    apiFetch('/api/hr/planilla-unidad/historial')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setRows(Array.isArray(data) ? data : []); })
      .catch(err => { console.error(err); setError(true); })
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { loadData(); }, [loadData]);

  // Persistencia de columnas visibles por usuario.
  const uid = currentUser?.id || 'anon';
  const { isVisible, toggleColumn } = useTableColumnPreset(
    COLS_WITH_ID,
    COMPACT_IDS,
    `aurora_uph_cols_${uid}`,
    { defaultMode: 'full' },
  );
  const visibleCols = useMemo(
    () => Object.fromEntries(COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible],
  );

  // El filtro por período vive fuera de la tabla (es global a la pantalla);
  // el filtro/sort por columna lo maneja AuroraDataTable. Comparación por
  // string 'YYYY-MM-DD' — misma lógica que getColVal('fecha'), sin parseo de
  // Date ni problemas de huso. #19.
  const periodFiltered = useMemo(() => {
    if (!filterFrom && !filterTo) return rows;
    return rows.filter(row => {
      const d = row.fecha?.slice(0, 10);
      if (!d) return false;
      if (filterFrom && d < filterFrom) return false;
      if (filterTo   && d > filterTo)   return false;
      return true;
    });
  }, [rows, filterFrom, filterTo]);

  const hasPeriod = !!(filterFrom || filterTo);
  const clearPeriod = () => { setFilterFrom(''); setFilterTo(''); };

  // Cada celda lleva data-label (derivado de LABELS) para que en móvil (≤920px)
  // la tabla colapse a tarjetas verticales — la transformación vive en
  // unit-payroll-history.css.
  const renderRow = (row, vc) => (
    <>
      {vc.consecutivo      && <td data-label={LABELS.consecutivo}      className="uph-td-consecutivo">{row.consecutivo || '—'}</td>}
      {vc.fecha            && <td data-label={LABELS.fecha}            className="uph-td-nowrap">{fmtDate(row.fecha)}</td>}
      {vc.encargadoNombre  && <td data-label={LABELS.encargadoNombre}  className="uph-td-nowrap">{row.encargadoNombre || '—'}</td>}
      {vc.aprobadoPor      && <td data-label={LABELS.aprobadoPor}      className="uph-td-nowrap">{row.aprobadoPor    || '—'}</td>}
      {vc.loteNombre       && <td data-label={LABELS.loteNombre}       className="uph-td-nowrap">{row.loteNombre     || '—'}</td>}
      {vc.grupo            && <td data-label={LABELS.grupo}>{row.grupo || '—'}</td>}
      {vc.labor            && <td data-label={LABELS.labor}>{row.labor || '—'}</td>}
      {vc.avanceHa         && <td data-label={LABELS.avanceHa} className="aur-td-num">{fmtHa(row.avanceHa)}</td>}
      {vc.unidad           && <td data-label={LABELS.unidad}>{row.unidad || '—'}</td>}
      {vc.costoUnitario    && <td data-label={LABELS.costoUnitario} className="aur-td-num">{fmtMoney(row.costoUnitario)}</td>}
      {vc.trabajadorNombre && <td data-label={LABELS.trabajadorNombre} className="uph-td-nowrap">{row.trabajadorNombre || '—'}</td>}
      {vc.cantidad         && <td data-label={LABELS.cantidad} className="aur-td-num">{fmtNum(row.cantidad)}</td>}
      {vc.subtotal         && <td data-label={LABELS.subtotal} className="aur-td-num uph-td-total">{fmtMoney(row.subtotal)}</td>}
    </>
  );

  // Resumen sobre la data ya filtrada/ordenada por la tabla: total devengado
  // de la vista actual — el dato que el usuario viene a buscar. #4.
  const renderSummary = (displayData) => {
    const total = displayData.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
    return (
      <div className="uph-summary" aria-live="polite">
        <span className="uph-summary-label">Total devengado (vista actual)</span>
        <span className="uph-summary-value">{fmtMoney(total)}</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="aur-sheet uph-page" aria-busy="true">
        <span className="aur-sr-only" aria-live="polite">Cargando historial…</span>
        <div className="aur-page-loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="aur-sheet uph-page">
        <div className="uph-error" role="alert">
          <FiAlertTriangle size={18} aria-hidden="true" />
          <span>No se pudo cargar el historial de planillas.</span>
          <button type="button" className="aur-btn-pill" onClick={loadData}>
            <FiRefreshCw size={14} /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="aur-sheet uph-page">

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          {/* h2: el h1 de la página lo emite PayrollHub (sr-only). Evita doble h1. #6. */}
          <h2 className="aur-sheet-title">Historial — Planilla por unidad</h2>
          <p className="aur-sheet-subtitle">
            Planillas aprobadas con detalle por fila — encargado, lote, labor, trabajador y total devengado.{' '}
            {/* Cambio de tab dentro del hub (no re-navega la ruta). #9. */}
            <Link to="?tab=editor" className="uph-header-link">Ir al editor →</Link>
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button type="button" className="aur-chip aur-chip--ghost" onClick={loadData} title="Actualizar">
            <FiRefreshCw size={12} /> Actualizar
          </button>
        </div>
      </header>

      {/* ── Filtro de período (fuera de la tabla) ── */}
      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Filtros</h3>
          {hasPeriod && (
            <div className="aur-section-actions">
              <button type="button" className="aur-chip aur-chip--ghost" onClick={clearPeriod}>
                <FiX size={11} /> Limpiar periodo
              </button>
            </div>
          )}
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="uph-from">Desde</label>
            <input
              id="uph-from"
              type="date"
              className="aur-input"
              value={filterFrom}
              max={filterTo || undefined}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="uph-to">Hasta</label>
            <input
              id="uph-to"
              type="date"
              className="aur-input"
              value={filterTo}
              min={filterFrom || undefined}
              onChange={e => setFilterTo(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* ── Tabla — sort + filtros de columna + paginación delegados ── */}
      <AuroraDataTable
        columns={COLUMNS}
        data={periodFiltered}
        getColVal={getColVal}
        visibleCols={visibleCols}
        onToggleVisibleCol={toggleColumn}
        initialSort={{ field: 'fecha', dir: 'desc' }}
        firstClickDir="desc"
        renderRow={renderRow}
        renderSummary={renderSummary}
        pageSize={50}
        tableClassName="uph-table"
        wrapClassName="uph-table-wrap"
        resultLabel={(f, t) => f === t
          ? `${f} fila${f === 1 ? '' : 's'}`
          : `${f} de ${t} filas`}
        emptyText={
          rows.length === 0
            ? 'No hay planillas aprobadas en el historial.'
            : 'Sin resultados para los filtros aplicados.'
        }
        emptySubtitle={
          rows.length === 0
            ? 'Las planillas aprobadas en el editor aparecen aquí.'
            : hasPeriod
              ? 'Probá ampliar el rango de fechas o limpiar el período.'
              : 'Probá limpiar los filtros de columna.'
        }
        emptyAction={hasPeriod
          ? (
            <button type="button" className="aur-btn-pill" onClick={clearPeriod}>
              <FiX size={14} /> Limpiar periodo
            </button>
          )
          : undefined}
      />

    </div>
  );
}

export default UnitPayrollHistory;
