import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraDataTable from '../../../components/AuroraDataTable';
import '../styles/unit-payroll-history.css';

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtMoney = (n) =>
  n == null ? '—' : '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtNum = (n) =>
  n == null ? '—' : Number(n).toLocaleString('es-CR');

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
  { key: 'fecha',            label: 'Fecha',        type: 'date'   },
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

function UnitPayrollHistory() {
  const apiFetch = useApiFetch();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');

  useEffect(() => {
    apiFetch('/api/hr/planilla-unidad/historial')
      .then(r => r.json())
      .then(data => { setRows(Array.isArray(data) ? data : []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // El filtro por período vive fuera de la tabla (es global a la pantalla);
  // el filtro/sort por columna lo maneja AuroraDataTable.
  const periodFiltered = useMemo(() => {
    const fromMs = filterFrom ? new Date(filterFrom + 'T00:00:00').getTime() : null;
    const toMs   = filterTo   ? new Date(filterTo   + 'T23:59:59').getTime() : null;
    if (fromMs == null && toMs == null) return rows;
    return rows.filter(row => {
      const d = row.fecha ? new Date(row.fecha).getTime() : NaN;
      if (Number.isNaN(d)) return false;
      if (fromMs != null && d < fromMs) return false;
      if (toMs   != null && d > toMs)   return false;
      return true;
    });
  }, [rows, filterFrom, filterTo]);

  const clearPeriod = () => { setFilterFrom(''); setFilterTo(''); };

  // Cada celda lleva data-label para que en móvil (≤720px) la tabla colapse
  // a tarjetas verticales — la transformación vive en unit-payroll-history.css.
  const renderRow = (row, vc) => (
    <>
      {vc.consecutivo      && <td data-label="N°"           className="uph-td-consecutivo">{row.consecutivo || '—'}</td>}
      {vc.fecha            && <td data-label="Fecha"        className="uph-td-nowrap">{fmtDate(row.fecha)}</td>}
      {vc.encargadoNombre  && <td data-label="Encargado"    className="uph-td-nowrap">{row.encargadoNombre || '—'}</td>}
      {vc.aprobadoPor      && <td data-label="Aprobado por" className="uph-td-nowrap">{row.aprobadoPor    || '—'}</td>}
      {vc.loteNombre       && <td data-label="Lote"         className="uph-td-nowrap">{row.loteNombre     || '—'}</td>}
      {vc.grupo            && <td data-label="Grupo">{row.grupo || '—'}</td>}
      {vc.labor            && <td data-label="Labor">{row.labor || '—'}</td>}
      {vc.avanceHa         && <td data-label="Avance (Ha)" className="aur-td-num">{row.avanceHa != null ? fmtNum(row.avanceHa) : '—'}</td>}
      {vc.unidad           && <td data-label="Unidad">{row.unidad || '—'}</td>}
      {vc.costoUnitario    && <td data-label="Costo Unit." className="aur-td-num">{fmtMoney(row.costoUnitario)}</td>}
      {vc.trabajadorNombre && <td data-label="Trabajador"  className="uph-td-nowrap">{row.trabajadorNombre || '—'}</td>}
      {vc.cantidad         && <td data-label="Cantidad" className="aur-td-num">{row.cantidad != null ? fmtNum(row.cantidad) : '—'}</td>}
      {vc.subtotal         && <td data-label="Total" className="aur-td-num uph-td-total">{fmtMoney(row.subtotal)}</td>}
    </>
  );

  if (loading) {
    return (
      <div className="aur-sheet uph-page">
        <div className="aur-page-loading" />
      </div>
    );
  }

  return (
    <div className="aur-sheet uph-page">

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h1 className="aur-sheet-title">Historial Salario por Unidad</h1>
          <p className="aur-sheet-subtitle">
            Planillas aprobadas con detalle por fila — encargado, lote, labor, trabajador y total devengado.{' '}
            <Link to="/hr/planilla/horas" className="uph-header-link">Ir a Salario por Unidad →</Link>
          </p>
        </div>
      </header>

      {/* ── Filtro de período (fuera de la tabla) ── */}
      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Filtros</h3>
          {(filterFrom || filterTo) && (
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
        initialSort={{ field: 'fecha', dir: 'desc' }}
        firstClickDir="desc"
        renderRow={renderRow}
        pageSize={50}
        tableClassName="uph-table"
        wrapClassName="uph-table-wrap"
        emptyText={
          rows.length === 0
            ? 'No hay planillas aprobadas en el historial.'
            : 'Sin resultados para los filtros aplicados.'
        }
      />

    </div>
  );
}

export default UnitPayrollHistory;
