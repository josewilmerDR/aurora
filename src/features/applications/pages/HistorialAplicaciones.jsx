import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiFilter, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/historial.css';

const PAGE_SIZE = 50;

const DATE_FIELDS = [
  { value: 'snap_dueDate',             label: 'F. Prog. Aplicación' },
  { value: 'snap_fechaCosecha',        label: 'F. Prog. Cosecha' },
  { value: 'snap_fechaCreacionGrupo',  label: 'F. Creación Grupo' },
  { value: 'aplicadaAt',               label: 'Fecha Aplicación' },
  { value: 'editadaAt',                label: 'Fecha Edición' },
];


const STATUS_LABEL = {
  pendiente:         'Pendiente',
  en_transito:       'En Tránsito',
  aplicada_en_campo: 'Aplicada',
};

const STATUS_CLASS = {
  pendiente:         'aur-badge--yellow',
  en_transito:       'aur-badge--blue',
  aplicada_en_campo: 'aur-badge--green',
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

// Formato de costo con separador de miles y 2 decimales, opcionalmente con moneda.
const fmtCosto = (v, moneda) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const str = Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda ? `${str} ${moneda}` : str;
};

const CAMBIO_BADGE_CLASS = {
  'Sustitución':     'aur-badge--blue',
  'Ajuste de dosis': 'aur-badge--yellow',
  'Añadido':         'aur-badge--green',
  'Retirado':        'aur-badge--gray',
  'Otro':            'aur-badge--violet',
};

// Character threshold: if the text is longer, the "see more" button appears.
// Row height defaults to 1 line (see CSS), so at ~480px wide
// con font 0.78rem caben aproximadamente 70-80 caracteres antes de truncar.
const OBS_TRUNCATE_AT = 70;

const prodLabel = (p) => p
  ? [p.nombreComercial, p.ingredienteActivo].filter(Boolean).join(' — ')
  : '';

// ─────────────────────────────────────────────────────────────────────────────
function HistorialAplicaciones() {
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
  const [expandedObs,   setExpandedObs]   = useState(() => new Set()); // keys "rowId-idx-m|a"

  const toggleObs = (key) => {
    setExpandedObs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderObs = (text, key) => {
    if (!text) return '—';
    const hasToggle  = text.length > OBS_TRUNCATE_AT;
    const isExpanded = hasToggle && expandedObs.has(key);
    return (
      <div className={`historial-obs-cell${isExpanded ? ' is-expanded' : ''}`}>
        <span
          className="historial-obs-text"
          title={hasToggle && !isExpanded ? text : undefined}
        >
          {text}
        </span>
        {hasToggle && (
          <button
            type="button"
            className="historial-obs-toggle"
            onClick={() => toggleObs(key)}
          >
            {isExpanded ? 'ver menos' : 'ver más'}
          </button>
        )}
      </div>
    );
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/cedulas').then(r => r.json())
      .then(c => {
        if (cancelled) return;
        setCedulas(Array.isArray(c) ? c.filter(ced => ced.status === 'aplicada_en_campo') : []);
      })
      .catch(e => { if (!cancelled) console.error(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch]);

  // Flatten: one row per (cedula × product). Each row is enriched with the
  // product originally prescribed by the system (when there was a substitution /
  // ajuste de dosis) y con una marca de cambio (`_prodCambio`). Los productos
  // que estaban en el plan original pero no fueron aplicados generan filas
  // fantasma marcadas como "Retirado" para preservar el audit trail.
  const flattened = useMemo(() => {
    return cedulas.flatMap(c => {
      const originales = Array.isArray(c.productosOriginales) ? c.productosOriginales : [];
      const origById = {};
      originales.forEach(o => { if (o?.productoId) origById[o.productoId] = o; });

      const aplicados = Array.isArray(c.snap_productos) ? c.snap_productos : [];

      const bloquesArr = Array.isArray(c.snap_bloques) ? c.snap_bloques : [];
      const _lotesStr  = [...new Set(bloquesArr.map(b => b.loteNombre).filter(Boolean))].sort().join(', ');
      const _bloquesStr = bloquesArr.map(b => b.bloque).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ');
      const _etapaStr  = [c.snap_cosecha, c.snap_etapa].filter(Boolean).join(' / ');
      const base = { _lotesStr, _bloquesStr, _etapaStr };

      const rows = [];
      const touchedOriginalIds = new Set();

      if (aplicados.length === 0) {
        // Cedula with no applied products: keep the current placeholder row.
        rows.push({
          ...c, ...base,
          _rowKey: `${c.id}::empty`,
          _prod: null,
          _prodIdProducto: '',
          _prodNombre:     '',
          _prodCantidad:   null,
          _prodUnidad:     '',
          _prodTotal:      null,
          _prodCostoTotal: null,
          _prodMoneda:     '',
          _prodCambio:          '',
          _prodOrigIdProducto:  '',
          _prodOrigNombre:      '',
          _prodOrigCantidad:    null,
          _prodOrigUnidad:      '',
        });
      } else {
        aplicados.forEach((prod, prodIdx) => {
          const origRef = prod?.productoOriginalId
            ? origById[prod.productoOriginalId]
            : origById[prod?.productoId];
          if (origRef) touchedOriginalIds.add(origRef.productoId);

          let _prodCambio = '';
          if (prod?.motivoCambio === 'sustitucion')       _prodCambio = 'Sustitución';
          else if (prod?.motivoCambio === 'ajuste_dosis') _prodCambio = 'Ajuste de dosis';
          else if (prod?.motivoCambio === 'otro')         _prodCambio = 'Otro';
          else if (originales.length > 0 && !origRef)     _prodCambio = 'Añadido';
          else if (origRef && Number.isFinite(parseFloat(origRef.cantidadPorHa))
                   && Number.isFinite(parseFloat(prod?.cantidadPorHa))
                   && parseFloat(origRef.cantidadPorHa) !== parseFloat(prod?.cantidadPorHa)) {
            _prodCambio = 'Ajuste de dosis';
          }

          // Costo snapshot = total aplicado × precioUnitario congelado en el momento
          // of the application (both live in snap_productos[]). If either is missing,
          // el costo es null (se renderiza como '—').
          const _prodTotalNum      = parseFloat(prod?.total);
          const _prodPrecioUnitNum = parseFloat(prod?.precioUnitario);
          const _prodCostoTotal =
            Number.isFinite(_prodTotalNum) && Number.isFinite(_prodPrecioUnitNum)
              ? parseFloat((_prodTotalNum * _prodPrecioUnitNum).toFixed(2))
              : null;

          rows.push({
            ...c, ...base,
            _rowKey: `${c.id}::a::${prod?.productoId ?? `i${prodIdx}`}`,
            _prod: prod,
            _prodIdProducto: prod?.idProducto ?? prod?.productoId ?? '',
            _prodNombre:     prodLabel(prod),
            _prodCantidad:   prod?.cantidadPorHa ?? null,
            _prodUnidad:     prod?.unidad ?? '',
            _prodTotal:      prod?.total ?? null,
            _prodCostoTotal,
            _prodMoneda:     prod?.moneda ?? '',
            _prodCambio,
            _prodOrigIdProducto: origRef?.idProducto ?? origRef?.productoId ?? '',
            _prodOrigNombre:     prodLabel(origRef),
            _prodOrigCantidad:   origRef?.cantidadPorHa ?? null,
            _prodOrigUnidad:     origRef?.unidad ?? '',
          });
        });
      }

      // Filas fantasma por productos del plan original que no fueron aplicados.
      originales.forEach(o => {
        if (!o?.productoId || touchedOriginalIds.has(o.productoId)) return;
        rows.push({
          ...c, ...base,
          _rowKey: `${c.id}::r::${o.productoId}`,
          _prod: null,
          _prodIdProducto: o.idProducto ?? o.productoId ?? '',
          _prodNombre:     prodLabel(o),
          _prodCantidad:   o.cantidadPorHa ?? null,
          _prodUnidad:     o.unidad ?? '',
          _prodTotal:      null,
          _prodCostoTotal: null, // producto no aplicado → sin costo real
          _prodMoneda:     '',
          _prodCambio:          'Retirado',
          _prodOrigIdProducto:  o.idProducto ?? o.productoId ?? '',
          _prodOrigNombre:      prodLabel(o),
          _prodOrigCantidad:    o.cantidadPorHa ?? null,
          _prodOrigUnidad:      o.unidad ?? '',
        });
      });

      return rows;
    });
  }, [cedulas]);

  // Period filtering
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

  // Multi-level sorting (on cedula fields)
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
    // Clamp al viewport para que el popover no se desborde en pantallas estrechas.
    const POPOVER_WIDTH = 260;
    const MARGIN        = 8;
    const maxLeft       = Math.max(MARGIN, window.innerWidth - POPOVER_WIDTH - MARGIN);
    const x             = Math.min(Math.max(rect.left, MARGIN), maxLeft);
    setFilterPopover({ field, x, y: rect.bottom + 4 });
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
        className={`aur-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-filter' : ''}${className ? ' ' + className : ''}`}
        onClick={() => handleThSort(field)}
        onContextMenu={e => openFilter(e, field)}
      >
        <span className="aur-th-content">
          {children}
          <span className="aur-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span
            className={`aur-th-funnel${hasFilter ? ' is-active' : ''}`}
            onClick={e => openFilter(e, field)}
            title="Filtrar columna (o click derecho)"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  const clearFilters = () => { setFilterFrom(''); setFilterTo(''); setPage(1); };

  return (
    <>
      {/* ── Spinner de carga ── */}
      {loading && <div className="historial-page-loading" />}

      {/* ── Contenido principal ── */}
      {!loading && (
    <div className="aur-sheet">

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Historial de aplicaciones</h2>
          <p className="aur-sheet-subtitle">Cédulas aplicadas con detalle por producto, cambios respecto al plan original y condiciones de campo.</p>
        </div>
        <Link to="/aplicaciones/cedulas" className="aur-chip aur-chip--ghost">
          Cédulas de aplicación
        </Link>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Filtros</h3>
          {(filterFrom || filterTo) && (
            <div className="aur-section-actions">
              <button type="button" className="aur-chip aur-chip--ghost" onClick={clearFilters}>
                <FiX size={11} /> Limpiar periodo
              </button>
            </div>
          )}
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ha-field">Filtrar por</label>
            <select
              id="ha-field"
              className="aur-select"
              value={filterDateField}
              onChange={e => { setFilterDateField(e.target.value); setPage(1); }}
            >
              {DATE_FIELDS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ha-from">Desde</label>
            <input
              id="ha-from"
              type="date"
              className="aur-input"
              value={filterFrom}
              onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ha-to">Hasta</label>
            <input
              id="ha-to"
              type="date"
              className="aur-input"
              value={filterTo}
              onChange={e => { setFilterTo(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Historial</h3>
          <span className="aur-section-count">{sorted.length}</span>
          {Object.values(colFilters).some(v => v.trim()) && (
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-chip aur-chip--ghost"
                onClick={() => { setColFilters({}); setPage(1); }}
              >
                <FiX size={11} /> Limpiar filtros de columna
              </button>
            </div>
          )}
        </div>

        <div className="ha-count">
          {sorted.length === 0
            ? (cedulas.length === 0
                ? (
                  <>
                    Aún no hay aplicaciones registradas. Registra la primera desde{' '}
                    <Link to="/aplicaciones/cedulas" state={{ openModal: true }} className="historial-cedula-link">
                      Cédulas de aplicación
                    </Link>.
                  </>
                )
                : 'Sin resultados para los filtros aplicados.')
            : `Mostrando ${visible.length} de ${sorted.length} fila${sorted.length !== 1 ? 's' : ''} · ${cedulas.length} cédula${cedulas.length !== 1 ? 's' : ''}`
          }
        </div>

      {/* ── Tabla ── */}
      {sorted.length > 0 && (
        <>
          <div className="ha-table-wrap">
            <table className="aur-table ha-table">
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
                  {/* Cambios respecto al plan original */}
                  <SortTh field="_prodCambio">Cambio</SortTh>
                  <SortTh field="_prodOrigIdProducto">Id Prod. Original</SortTh>
                  <SortTh field="_prodOrigNombre">Prod. Original</SortTh>
                  <SortTh field="_prodOrigCantidad">Cant. Orig./Ha</SortTh>
                  <SortTh field="_prodOrigUnidad">Unid. Orig.</SortTh>
                  {/* Costo */}
                  <SortTh field="_prodCostoTotal">Total Costo</SortTh>
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
                  {/* Edición de cédula */}
                  <SortTh field="editadaAt">F. Edición</SortTh>
                  <SortTh field="editadaPorNombre">Editada Por</SortTh>
                  {/* Observaciones libres */}
                  <SortTh field="observacionesMezcla">Obs. Mezcla</SortTh>
                  <SortTh field="observacionesAplicacion">Obs. Aplicación</SortTh>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const cambioClass = row._prodCambio ? CAMBIO_BADGE_CLASS[row._prodCambio] : '';
                  return (
                    <tr
                      key={row._rowKey}
                      className={row._prodCambio ? 'historial-row-changed' : ''}
                    >
                      {/* Identificación */}
                      <td className="historial-consecutivo">
                        {row.status === 'aplicada_en_campo'
                          ? <Link to={`/aplicaciones/cedula/${row.id}`} className="historial-cedula-link">{row.consecutivo}</Link>
                          : row.consecutivo}
                      </td>
                      <td>
                        <span className={`aur-badge ${STATUS_CLASS[row.status] || ''}`}>
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
                      <td className="historial-td-bloques" title={row._bloquesStr || undefined}>
                        {row._bloquesStr || '—'}
                      </td>
                      {/* Producto */}
                      <td>{row._prodIdProducto || '—'}</td>
                      <td className="historial-td-producto" title={row._prodNombre || undefined}>
                        {row._prodNombre || '—'}
                      </td>
                      <td>{row._prodCantidad != null ? n(row._prodCantidad) : '—'}</td>
                      <td>{row._prodUnidad || '—'}</td>
                      <td>{row._prodTotal != null ? n(row._prodTotal, 3) : '—'}</td>
                      {/* Cambios respecto al plan original */}
                      <td>
                        {row._prodCambio
                          ? <span className={`aur-badge ${cambioClass}`}>{row._prodCambio}</span>
                          : '—'}
                      </td>
                      <td>{row._prodOrigIdProducto || '—'}</td>
                      <td className="historial-td-producto" title={row._prodOrigNombre || undefined}>
                        {row._prodOrigNombre || '—'}
                      </td>
                      <td>{row._prodOrigCantidad != null ? n(row._prodOrigCantidad) : '—'}</td>
                      <td>{row._prodOrigUnidad || '—'}</td>
                      {/* Costo — snapshot: total aplicado × precioUnitario congelado en snap_productos */}
                      <td className="historial-td-nowrap">{fmtCosto(row._prodCostoTotal, row._prodMoneda)}</td>
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
                      {/* Edición de cédula */}
                      <td className="historial-td-nowrap">{fmt(row.editadaAt)}</td>
                      <td className="historial-td-nowrap">{row.editadaPorNombre || '—'}</td>
                      {/* Observaciones libres */}
                      <td className="historial-td-obs">
                        {renderObs(row.observacionesMezcla, `${row._rowKey}-m`)}
                      </td>
                      <td className="historial-td-obs">
                        {renderObs(row.observacionesAplicacion, `${row._rowKey}-a`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="ha-load-more">
              <button
                type="button"
                className="aur-chip aur-chip--ghost"
                onClick={() => setPage(p => p + 1)}
              >
                Ver más — {sorted.length - visible.length} restante{sorted.length - visible.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}
        </>
      )}
      </section>

    </div>
      )}

    {/* ── Popover filtro de columna ── */}
    {filterPopover && createPortal(
      <>
        <div className="aur-filter-backdrop" onClick={() => setFilterPopover(null)} />
        <div className="aur-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
          <FiFilter size={13} className="aur-filter-icon" />
          <input
            autoFocus
            className="aur-filter-input"
            placeholder="Filtrar…"
            value={colFilters[filterPopover.field] || ''}
            onChange={e => setColFilter(filterPopover.field, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
          />
          {colFilters[filterPopover.field] && (
            <button
              type="button"
              className="aur-filter-clear"
              title="Limpiar filtro"
              onClick={() => { setColFilter(filterPopover.field, ''); setFilterPopover(null); }}
            >
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
