import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, Link } from 'react-router-dom';
import { FiArrowLeft, FiFilter, FiX } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './HistorialAplicaciones.css';

const PAGE_SIZE = 50;

const DATE_FIELDS = [
  { value: 'snap_dueDate',             label: 'F. Prog. Aplicación' },
  { value: 'snap_fechaCosecha',        label: 'F. Prog. Cosecha' },
  { value: 'snap_fechaCreacionGrupo',  label: 'F. Creación Grupo' },
  { value: 'aplicadaAt',               label: 'Fecha Aplicación' },
];


const STATUS_LABEL = {
  pendiente:         'Pendiente',
  en_transito:       'En Tránsito',
  aplicada_en_campo: 'Aplicada',
};

const STATUS_CLASS = {
  pendiente:         'badge-yellow',
  en_transito:       'badge-blue',
  aplicada_en_campo: 'badge-green',
};

const fmt = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
};

const n = (v, decimals) => {
  if (v == null) return '—';
  return decimals != null ? Number(v).toFixed(decimals) : String(v);
};

// ─────────────────────────────────────────────────────────────────────────────
function HistorialAplicaciones() {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [cedulas,  setCedulas]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);

  const [filterDateField, setFilterDateField] = useState('snap_dueDate');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');

  const [sorts, setSorts] = useState([{ field: 'generadaAt', dir: 'desc' }]);

  const [colFilters,    setColFilters]    = useState({});  // { field: string }
  const [filterPopover, setFilterPopover] = useState(null); // { field, x, y }

  useEffect(() => {
    apiFetch('/api/cedulas').then(r => r.json())
      .then(c => setCedulas(Array.isArray(c) ? c.filter(ced => ced.status === 'aplicada_en_campo') : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Aplanar: una fila por (cédula × producto). Cédulas sin productos → 1 fila con prod null.
  const flattened = useMemo(() => {
    return cedulas.flatMap(c => {
      const prods = Array.isArray(c.snap_productos) && c.snap_productos.length > 0
        ? c.snap_productos
        : [null];
      const bloquesArr = Array.isArray(c.snap_bloques) ? c.snap_bloques : [];
      const _lotesStr  = [...new Set(bloquesArr.map(b => b.loteNombre).filter(Boolean))].sort().join(', ');
      const _bloquesStr = bloquesArr.map(b => b.bloque).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ');
      const _etapaStr  = [c.snap_cosecha, c.snap_etapa].filter(Boolean).join(' / ');
      return prods.map(prod => ({
        ...c,
        _prod:           prod,
        _lotesStr,
        _bloquesStr,
        _etapaStr,
        _prodIdProducto: prod?.idProducto        ?? '',
        _prodNombre:     prod ? [prod.nombreComercial, prod.ingredienteActivo].filter(Boolean).join(' — ') : '',
        _prodCantidad:   prod?.cantidadPorHa      ?? null,
        _prodUnidad:     prod?.unidad             ?? '',
        _prodTotal:      prod?.total              ?? null,
      }));
    });
  }, [cedulas]);

  // Filtrado por período
  const filtered = useMemo(() => {
    const activeCol = Object.entries(colFilters).filter(([, v]) => v.trim());
    return flattened.filter(row => {
      if (filterFrom || filterTo) {
        const raw = row[filterDateField];
        if (!raw) return false;
        const d = new Date(raw);
        if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
        if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      }
      for (const [field, val] of activeCol) {
        const cell = row[field];
        if (cell == null) return false;
        if (!String(cell).toLowerCase().includes(val.toLowerCase())) return false;
      }
      return true;
    });
  }, [flattened, filterDateField, filterFrom, filterTo, colFilters]);

  // Ordenamiento multi-nivel (sobre campos de la cédula)
  const sorted = useMemo(() => {
    const active = sorts.filter(s => s.field);
    if (active.length === 0) return filtered;
    return [...filtered].sort((a, b) => {
      for (const { field, dir } of active) {
        const va = a[field] ?? '';
        const vb = b[field] ?? '';
        let cmp = 0;
        if (typeof va === 'string' && typeof vb === 'string') {
          cmp = va.localeCompare(vb, 'es');
        } else {
          cmp = va < vb ? -1 : va > vb ? 1 : 0;
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }, [filtered, sorts]);

  const visible = useMemo(() => sorted.slice(0, page * PAGE_SIZE), [sorted, page]);
  const hasMore = visible.length < sorted.length;

  const handleThSort = (field) => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
    setPage(1);
  };

  const openFilter = (e, field) => {
    e.stopPropagation();
    e.preventDefault();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th   = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, val) => {
    setColFilters(prev => val ? { ...prev, [field]: val } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field)));
    setPage(1);
  };

  const SortTh = ({ field, children, className }) => {
    const active    = sorts[0].field === field;
    const dir       = active ? sorts[0].dir : null;
    const hasFilter = !!(colFilters[field]?.trim());
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}${className ? ' ' + className : ''}`}
        onClick={() => handleThSort(field)}
        onContextMenu={e => openFilter(e, field)}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`} onClick={e => openFilter(e, field)} title="Filtrar columna (o click derecho)">
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  const clearFilters = () => { setFilterFrom(''); setFilterTo(''); setPage(1); };

  if (loading) return <div className="empty-state">Cargando historial…</div>;

  return (
    <>
    <div className="historial-wrap">

      <button className="historial-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft size={15} /> Volver
      </button>

      {/* ── Panel de controles ── */}
      <div className="historial-controls">

        <div className="historial-control-block">
          <div className="historial-control-row">
            <label className="historial-ctrl-label">Filtrar por</label>
            <select
              className="historial-select"
              value={filterDateField}
              onChange={e => { setFilterDateField(e.target.value); setPage(1); }}
            >
              {DATE_FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>

            <label className="historial-ctrl-label">De</label>
            <input
              type="date"
              className="historial-date-input"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
            />

            <label className="historial-ctrl-label">A</label>
            <input
              type="date"
              className="historial-date-input"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1); }}
            />

            {(filterFrom || filterTo) && (
              <button className="btn btn-secondary historial-clear-btn" onClick={clearFilters}>
                Limpiar
              </button>
            )}
          </div>
        </div>

      </div>

      {/* ── Contador + aviso filtros de columna ── */}
      <div className="historial-count">
        {sorted.length === 0
          ? 'Sin resultados para los filtros aplicados.'
          : `Mostrando ${visible.length} de ${sorted.length} fila${sorted.length !== 1 ? 's' : ''} (${cedulas.length} cédula${cedulas.length !== 1 ? 's' : ''})`
        }
        {Object.values(colFilters).some(v => v.trim()) && (
          <button className="historial-clear-col-filters" onClick={() => { setColFilters({}); setPage(1); }}>
            <FiX size={11} />
            Limpiar filtros de columna
          </button>
        )}
      </div>

      {/* ── Tabla ── */}
      {sorted.length > 0 && (
        <>
          <div className="historial-table-wrap">
            <table className="historial-table historial-table--wide">
              <thead>
                <tr>
                  {/* Identificación */}
                  <SortTh field="consecutivo" className="historial-th-group">Consecutivo</SortTh>
                  <SortTh field="status"      className="historial-th-group">Estado</SortTh>
                  {/* Datos de la aplicación */}
                  <SortTh field="snap_activityName">Aplicación</SortTh>
                  <SortTh field="snap_dueDate">F. Prog. Aplic.</SortTh>
                  <SortTh field="snap_fechaCosecha">F. Prog. Cosecha</SortTh>
                  <SortTh field="snap_fechaCreacionGrupo">F. Creación Grupo</SortTh>
                  <SortTh field="snap_periodoCarenciaMax">Per. Carencia (d)</SortTh>
                  <SortTh field="snap_periodoReingresoMax">Per. Reingreso (h)</SortTh>
                  <SortTh field="metodoAplicacion">Método Aplicación</SortTh>
                  <SortTh field="snap_paqueteTecnico">Paq. Técnico</SortTh>
                  <SortTh field="snap_sourceName">Grupo</SortTh>
                  <SortTh field="_etapaStr">Etapa</SortTh>
                  <SortTh field="snap_areaHa">Área (ha)</SortTh>
                  <SortTh field="snap_totalPlantas">Total Plantas</SortTh>
                  <SortTh field="snap_volumenPorHa">Volumen (Lt/Ha)</SortTh>
                  <SortTh field="snap_litrosAplicador">Litros Aplicador</SortTh>
                  <SortTh field="snap_totalBoones">Total Boones Req.</SortTh>
                  <SortTh field="snap_calibracionNombre">Calibración</SortTh>
                  {/* Bloques */}
                  <SortTh field="_lotesStr">Lote</SortTh>
                  <SortTh field="_bloquesStr">Bloques</SortTh>
                  {/* Producto (se repite por fila) */}
                  <SortTh field="_prodIdProducto">Id Producto</SortTh>
                  <SortTh field="_prodNombre">Nombre Comercial — Ing. Activo</SortTh>
                  <SortTh field="_prodCantidad">Cant./Ha</SortTh>
                  <SortTh field="_prodUnidad">Unidad</SortTh>
                  <SortTh field="_prodTotal">Total Prod.</SortTh>
                  {/* Campo */}
                  <SortTh field="sobrante">Sobrante</SortTh>
                  <SortTh field="sobranteLoteNombre">Depositado en</SortTh>
                  <SortTh field="condicionesTiempo">Cond. del Tiempo</SortTh>
                  <SortTh field="temperatura">Temperatura</SortTh>
                  <SortTh field="humedadRelativa">% Hum. Relativa</SortTh>
                  <SortTh field="aplicadaAt">Fecha Aplicación</SortTh>
                  <SortTh field="horaInicio">Hora Inicial</SortTh>
                  <SortTh field="horaFinal">Hora Final</SortTh>
                  <SortTh field="operario">Operario</SortTh>
                  {/* Responsables */}
                  <SortTh field="encargadoFinca">Enc. de Finca</SortTh>
                  <SortTh field="encargadoBodega">Enc. de Bodega</SortTh>
                  <SortTh field="supAplicaciones">Sup. Aplicaciones / Regente</SortTh>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, idx) => {
                  const prod = row._prod;
                  return (
                    <tr key={`${row.id}-${idx}`}>
                      {/* Identificación */}
                      <td className="historial-consecutivo">
                        {row.status === 'aplicada_en_campo'
                          ? <Link to={`/aplicaciones/cedula/${row.id}`} className="historial-cedula-link">{row.consecutivo}</Link>
                          : row.consecutivo}
                      </td>
                      <td>
                        <span className={`historial-badge ${STATUS_CLASS[row.status] || ''}`}>
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                      </td>
                      {/* Datos de la aplicación */}
                      <td className="historial-td-nowrap">{row.snap_activityName || '—'}</td>
                      <td className="historial-td-nowrap">{fmt(row.snap_dueDate)}</td>
                      <td className="historial-td-nowrap">{fmt(row.snap_fechaCosecha)}</td>
                      <td className="historial-td-nowrap">{fmt(row.snap_fechaCreacionGrupo)}</td>
                      <td>{n(row.snap_periodoCarenciaMax)}</td>
                      <td>{n(row.snap_periodoReingresoMax)}</td>
                      <td>{row.metodoAplicacion || '—'}</td>
                      <td>{row.snap_paqueteTecnico || '—'}</td>
                      <td className="historial-td-nowrap">{row.snap_sourceName || '—'}</td>
                      <td className="historial-td-nowrap">{row._etapaStr || '—'}</td>
                      <td>{n(row.snap_areaHa, 2)}</td>
                      <td>{row.snap_totalPlantas ? Number(row.snap_totalPlantas).toLocaleString('es-ES') : '—'}</td>
                      <td>{n(row.snap_volumenPorHa)}</td>
                      <td>{n(row.snap_litrosAplicador)}</td>
                      <td>{n(row.snap_totalBoones, 2)}</td>
                      <td className="historial-td-nowrap">{row.snap_calibracionNombre || '—'}</td>
                      {/* Bloques */}
                      <td className="historial-td-nowrap">{row._lotesStr || '—'}</td>
                      <td className="historial-td-bloques">{row._bloquesStr || '—'}</td>
                      {/* Producto */}
                      <td>{row._prodIdProducto || '—'}</td>
                      <td className="historial-td-producto">{row._prodNombre || '—'}</td>
                      <td>{row._prodCantidad != null ? n(row._prodCantidad) : '—'}</td>
                      <td>{row._prodUnidad || '—'}</td>
                      <td>{row._prodTotal != null ? n(row._prodTotal, 3) : '—'}</td>
                      {/* Campo */}
                      <td>{row.sobrante === true ? 'Sí' : row.sobrante === false ? 'No' : '—'}</td>
                      <td className="historial-td-nowrap">{row.sobranteLoteNombre || '—'}</td>
                      <td className="historial-td-nowrap">{row.condicionesTiempo || '—'}</td>
                      <td>{row.temperatura != null ? `${row.temperatura}°C` : '—'}</td>
                      <td>{row.humedadRelativa != null ? `${row.humedadRelativa}%` : '—'}</td>
                      <td className="historial-td-nowrap">{fmt(row.aplicadaAt)}</td>
                      <td>{row.horaInicio || '—'}</td>
                      <td>{row.horaFinal  || '—'}</td>
                      <td className="historial-td-nowrap">{row.operario || '—'}</td>
                      {/* Responsables */}
                      <td className="historial-td-nowrap">{row.encargadoFinca  || '—'}</td>
                      <td className="historial-td-nowrap">{row.encargadoBodega || '—'}</td>
                      <td className="historial-td-nowrap">{row.supAplicaciones || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="historial-load-more">
              <button
                className="btn btn-secondary"
                onClick={() => setPage(p => p + 1)}
              >
                Ver más — {sorted.length - visible.length} restante{sorted.length - visible.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}

    </div>

    {/* ── Popover filtro de columna ── */}
    {filterPopover && createPortal(
      <>
        <div className="historial-filter-backdrop" onClick={() => setFilterPopover(null)} />
        <div className="historial-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
          <FiFilter size={13} className="historial-filter-popover-icon" />
          <input
            autoFocus
            className="historial-filter-input"
            placeholder="Filtrar…"
            value={colFilters[filterPopover.field] || ''}
            onChange={e => setColFilter(filterPopover.field, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
          />
          {colFilters[filterPopover.field] && (
            <button className="historial-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, ''); setFilterPopover(null); }}>
              <FiX size={13} />
            </button>
          )}
        </div>
      </>,
      document.body
    )}
    </>
  );
}

export default HistorialAplicaciones;
