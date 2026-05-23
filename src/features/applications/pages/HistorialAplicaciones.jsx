import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiFilter, FiX, FiPlusCircle, FiSliders } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import FilterButton from '../../../components/ui/FilterButton';
import '../styles/historial.css';

// Filtro por columna: 'date' y 'number' usan rango (De/A), el resto texto.
const COLUMN_FILTER_TYPES = {
  snap_dueDate:             'date',
  snap_fechaCosecha:        'date',
  snap_fechaCreacionGrupo:  'date',
  aplicadaAt:               'date',
  editadaAt:                'date',
  snap_periodoCarenciaMax:  'number',
  snap_periodoReingresoMax: 'number',
  snap_areaHa:              'number',
  snap_totalPlantas:        'number',
  snap_volumenPorHa:        'number',
  snap_litrosAplicador:     'number',
  snap_totalBoones:         'number',
  _prodCantidad:            'number',
  _prodTotal:               'number',
  _prodOrigCantidad:        'number',
  _prodCostoTotal:          'number',
  temperatura:              'number',
  humedadRelativa:          'number',
};
const getFilterType = (field) => COLUMN_FILTER_TYPES[field] || 'text';

const hasFilterValue = (f) => {
  if (!f) return false;
  if (f.type === 'range') return !!((f.from || '').trim() || (f.to || '').trim());
  return !!(f.value || '').trim();
};

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

// Metadata de columnas: orden de render, label, clases y función render por fila.
// `ctx` expone helpers que dependen del componente (renderObs con estado de toggle).
const COLUMNS = [
  { key: 'consecutivo', label: 'Consecutivo', thClass: 'historial-th-group', tdClass: 'historial-consecutivo',
    render: (row) => row.status === 'aplicada_en_campo'
      ? <Link to={`/aplicaciones/cedula/${row.id}`} className="historial-cedula-link">{row.consecutivo}</Link>
      : row.consecutivo },
  { key: 'status', label: 'Estado', thClass: 'historial-th-group',
    render: (row) => <span className={`aur-badge ${STATUS_CLASS[row.status] || ''}`}>{STATUS_LABEL[row.status] || row.status}</span> },
  { key: 'snap_activityName', label: 'Aplicación', tdClass: 'historial-td-nowrap',
    render: (row) => row.snap_activityName || '—' },
  { key: 'snap_dueDate', label: 'F. Prog. Aplic.', tdClass: 'historial-td-nowrap',
    render: (row) => fmt(row.snap_dueDate) },
  { key: 'snap_fechaCosecha', label: 'F. Prog. Cosecha', tdClass: 'historial-td-nowrap',
    render: (row) => fmt(row.snap_fechaCosecha) },
  { key: 'snap_fechaCreacionGrupo', label: 'F. Creación Grupo', tdClass: 'historial-td-nowrap',
    render: (row) => fmt(row.snap_fechaCreacionGrupo) },
  { key: 'snap_periodoCarenciaMax', label: 'Per. Carencia (d)',
    render: (row) => n(row.snap_periodoCarenciaMax) },
  { key: 'snap_periodoReingresoMax', label: 'Per. Reingreso (h)',
    render: (row) => n(row.snap_periodoReingresoMax) },
  { key: 'metodoAplicacion', label: 'Método Aplicación',
    render: (row) => row.metodoAplicacion || '—' },
  { key: 'snap_paqueteTecnico', label: 'Paq. Técnico',
    render: (row) => row.snap_paqueteTecnico || '—' },
  { key: 'snap_sourceName', label: 'Grupo', tdClass: 'historial-td-nowrap',
    render: (row) => row.snap_sourceName || '—' },
  { key: '_etapaStr', label: 'Etapa', tdClass: 'historial-td-nowrap',
    render: (row) => row._etapaStr || '—' },
  { key: 'snap_areaHa', label: 'Área (ha)',
    render: (row) => n(row.snap_areaHa, 2) },
  { key: 'snap_totalPlantas', label: 'Total Plantas',
    render: (row) => row.snap_totalPlantas ? Number(row.snap_totalPlantas).toLocaleString('es-ES') : '—' },
  { key: 'snap_volumenPorHa', label: 'Volumen (Lt/Ha)',
    render: (row) => n(row.snap_volumenPorHa) },
  { key: 'snap_litrosAplicador', label: 'Litros Aplicador',
    render: (row) => n(row.snap_litrosAplicador) },
  { key: 'snap_totalBoones', label: 'Total Boones Req.',
    render: (row) => n(row.snap_totalBoones, 2) },
  { key: 'snap_calibracionNombre', label: 'Calibración', tdClass: 'historial-td-nowrap',
    render: (row) => row.snap_calibracionNombre || '—' },
  { key: '_lotesStr', label: 'Lote', tdClass: 'historial-td-nowrap',
    render: (row) => row._lotesStr || '—' },
  { key: '_bloquesStr', label: 'Bloques', tdClass: 'historial-td-bloques',
    tdProps: (row) => ({ title: row._bloquesStr || undefined }),
    render: (row) => row._bloquesStr || '—' },
  { key: '_prodIdProducto', label: 'Id Producto',
    render: (row) => row._prodIdProducto || '—' },
  { key: '_prodNombre', label: 'Nombre Comercial — Ing. Activo', tdClass: 'historial-td-producto',
    tdProps: (row) => ({ title: row._prodNombre || undefined }),
    render: (row) => row._prodNombre || '—' },
  { key: '_prodCantidad', label: 'Cant./Ha',
    render: (row) => row._prodCantidad != null ? n(row._prodCantidad) : '—' },
  { key: '_prodUnidad', label: 'Unidad',
    render: (row) => row._prodUnidad || '—' },
  { key: '_prodTotal', label: 'Total Prod.',
    render: (row) => row._prodTotal != null ? n(row._prodTotal, 3) : '—' },
  { key: '_prodCambio', label: 'Cambio',
    render: (row) => row._prodCambio
      ? <span className={`aur-badge ${CAMBIO_BADGE_CLASS[row._prodCambio] || ''}`}>{row._prodCambio}</span>
      : '—' },
  { key: '_prodOrigIdProducto', label: 'Id Prod. Original',
    render: (row) => row._prodOrigIdProducto || '—' },
  { key: '_prodOrigNombre', label: 'Prod. Original', tdClass: 'historial-td-producto',
    tdProps: (row) => ({ title: row._prodOrigNombre || undefined }),
    render: (row) => row._prodOrigNombre || '—' },
  { key: '_prodOrigCantidad', label: 'Cant. Orig./Ha',
    render: (row) => row._prodOrigCantidad != null ? n(row._prodOrigCantidad) : '—' },
  { key: '_prodOrigUnidad', label: 'Unid. Orig.',
    render: (row) => row._prodOrigUnidad || '—' },
  { key: '_prodCostoTotal', label: 'Total Costo', tdClass: 'historial-td-nowrap',
    render: (row) => fmtCosto(row._prodCostoTotal, row._prodMoneda) },
  { key: 'sobrante', label: 'Sobrante',
    render: (row) => row.sobrante === true ? 'Sí' : row.sobrante === false ? 'No' : '—' },
  { key: 'sobranteLoteNombre', label: 'Depositado en', tdClass: 'historial-td-nowrap',
    render: (row) => row.sobranteLoteNombre || '—' },
  { key: 'condicionesTiempo', label: 'Cond. del Tiempo', tdClass: 'historial-td-nowrap',
    render: (row) => row.condicionesTiempo || '—' },
  { key: 'temperatura', label: 'Temperatura',
    render: (row) => row.temperatura != null ? `${row.temperatura}°C` : '—' },
  { key: 'humedadRelativa', label: '% Hum. Relativa',
    render: (row) => row.humedadRelativa != null ? `${row.humedadRelativa}%` : '—' },
  { key: 'aplicadaAt', label: 'Fecha Aplicación', tdClass: 'historial-td-nowrap',
    render: (row) => fmt(row.aplicadaAt) },
  { key: 'horaInicio', label: 'Hora Inicial',
    render: (row) => row.horaInicio || '—' },
  { key: 'horaFinal', label: 'Hora Final',
    render: (row) => row.horaFinal || '—' },
  { key: 'operario', label: 'Operario', tdClass: 'historial-td-nowrap',
    render: (row) => row.operario || '—' },
  { key: 'encargadoFinca', label: 'Enc. de Finca', tdClass: 'historial-td-nowrap',
    render: (row) => row.encargadoFinca || '—' },
  { key: 'encargadoBodega', label: 'Enc. de Bodega', tdClass: 'historial-td-nowrap',
    render: (row) => row.encargadoBodega || '—' },
  { key: 'supAplicaciones', label: 'Sup. Aplicaciones / Regente', tdClass: 'historial-td-nowrap',
    render: (row) => row.supAplicaciones || '—' },
  { key: 'editadaAt', label: 'F. Edición', tdClass: 'historial-td-nowrap',
    render: (row) => fmt(row.editadaAt) },
  { key: 'editadaPorNombre', label: 'Editada Por', tdClass: 'historial-td-nowrap',
    render: (row) => row.editadaPorNombre || '—' },
  { key: 'observacionesMezcla', label: 'Obs. Mezcla', tdClass: 'historial-td-obs',
    render: (row, ctx) => ctx.renderObs(row.observacionesMezcla, `${row._rowKey}-m`) },
  { key: 'observacionesAplicacion', label: 'Obs. Aplicación', tdClass: 'historial-td-obs',
    render: (row, ctx) => ctx.renderObs(row.observacionesAplicacion, `${row._rowKey}-a`) },
];

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

  // colFilters: { [field]: { type: 'range', from, to } | { type: 'text', value } | null }
  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null); // { field, x, y }
  const [expandedObs,   setExpandedObs]   = useState(() => new Set()); // keys "rowId-idx-m|a"
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() =>
    Object.fromEntries(COLUMNS.map(c => [c.key, true]))
  );
  const [colMenu, setColMenu] = useState(null); // { x, y }

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
    const activeCol = Object.entries(colFilters).filter(([, f]) => hasFilterValue(f));
    return flattened.filter(row => {
      if (filterFrom || filterTo) {
        const raw = row[filterDateField];
        if (!raw) return false;
        const d = new Date(raw);
        if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
        if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      }
      for (const [field, filter] of activeCol) {
        const cell = row[field];
        if (cell == null) return false;
        if (filter.type === 'range') {
          const colType = getFilterType(field);
          if (colType === 'date') {
            const cellD = new Date(cell);
            if (Number.isNaN(cellD.getTime())) return false;
            if (filter.from) {
              const fromD = new Date(filter.from + 'T00:00:00');
              if (cellD < fromD) return false;
            }
            if (filter.to) {
              const toD = new Date(filter.to + 'T23:59:59');
              if (cellD > toD) return false;
            }
          } else {
            const num = Number(cell);
            if (Number.isNaN(num)) return false;
            if (filter.from && Number.isFinite(Number(filter.from)) && num < Number(filter.from)) return false;
            if (filter.to   && Number.isFinite(Number(filter.to))   && num > Number(filter.to))   return false;
          }
        } else {
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
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

  const setColFilter = (field, filter) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (filter == null || !hasFilterValue(filter)) delete next[field];
      else next[field] = filter;
      return next;
    });
    setPage(1);
  };

  const SortTh = ({ field, children, className }) => {
    const active    = sorts[0].field === field;
    const dir       = active ? sorts[0].dir : null;
    const hasFilter = hasFilterValue(colFilters[field]);
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

  const visibleColumns = useMemo(() => COLUMNS.filter(c => visibleCols[c.key] !== false), [visibleCols]);
  const hiddenCount = COLUMNS.length - visibleColumns.length;
  const toggleCol = (key) => setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleColBtnClick = (e) => {
    if (colMenu) { setColMenu(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const MENU_W = 240;
    const MARGIN = 8;
    const x = Math.min(Math.max(rect.right - MENU_W, MARGIN), window.innerWidth - MENU_W - MARGIN);
    setColMenu({ x, y: rect.bottom + 4 });
  };

  return (
    <>
      {/* ── Spinner de carga ── */}
      {loading && <div className="historial-page-loading" />}

      {/* ── Contenido principal ── */}
      {!loading && (
    <div className="aur-sheet ha-page">

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Registro de aplicaciones</h2>
          <p className="aur-sheet-subtitle">
            Cédulas aplicadas con detalle por producto, cambios respecto al plan original y condiciones de campo.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <FilterButton
            active={!!(filterFrom || filterTo)}
            onClick={() => setMostrarFiltros(true)}
          />
          <Link
            to="/aplicaciones/cedulas"
            state={{ openModal: true }}
            className="aur-btn-pill"
          >
            <FiPlusCircle size={14} /> Nueva cédula
          </Link>
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="ha-section-count">Registros {sorted.length}</span>
          {Object.values(colFilters).some(hasFilterValue) && (
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

        {sorted.length === 0 && (
          <div className={`ha-count${cedulas.length === 0 ? ' ha-count--empty-cta' : ''}`}>
            {cedulas.length === 0
              ? (
                <>
                  Aún no hay aplicaciones registradas. Registra la primera desde{' '}
                  <Link to="/aplicaciones/cedulas" state={{ openModal: true }} className="historial-cedula-link">
                    Cédulas de aplicación
                  </Link>.
                </>
              )
              : 'Sin resultados para los filtros aplicados.'}
          </div>
        )}

      {/* ── Tabla ── */}
      {sorted.length > 0 && (
        <>
          <div className="ha-table-wrap">
            <table className="aur-table ha-table">
              <thead>
                <tr>
                  {visibleColumns.map(c => (
                    <SortTh key={c.key} field={c.key} className={c.thClass}>{c.label}</SortTh>
                  ))}
                  <th className="aur-th-col-menu">
                    <button
                      type="button"
                      className={`aur-col-menu-trigger${hiddenCount > 0 ? ' is-active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas"
                      aria-label={hiddenCount > 0
                        ? `Personalizar columnas (${hiddenCount} oculta${hiddenCount === 1 ? '' : 's'})`
                        : 'Personalizar columnas'}
                      aria-haspopup="menu"
                    >
                      <FiSliders size={12} />
                      {hiddenCount > 0 && (
                        <span className="aur-col-hidden-badge" aria-hidden="true">{hiddenCount}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row._rowKey}
                    className={row._prodCambio ? 'historial-row-changed' : ''}
                  >
                    {visibleColumns.map(c => {
                      const extraProps = c.tdProps ? c.tdProps(row) : null;
                      return (
                        <td key={c.key} className={c.tdClass} {...extraProps}>
                          {c.render(row, { renderObs })}
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                ))}
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

    {/* ── Filtro de Periodo Modal ── */}
    {mostrarFiltros && createPortal(
      <div
        className="aur-modal-backdrop"
        onClick={() => setMostrarFiltros(false)}
      >
        <div
          className="aur-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ha-filtro-modal-title"
          onClick={e => e.stopPropagation()}
        >
          <div className="aur-modal-header">
            <span className="aur-modal-icon">
              <FiFilter size={16} />
            </span>
            <h3 className="aur-modal-title" id="ha-filtro-modal-title">
              Filtrar por periodo
            </h3>
            <button
              type="button"
              className="aur-icon-btn aur-modal-close"
              onClick={() => setMostrarFiltros(false)}
              aria-label="Cerrar"
            >
              <FiX size={16} />
            </button>
          </div>
          <div className="aur-modal-content">
            <div className="ha-filtro-grid">
              <div className="ha-filtro-field ha-filtro-field--full">
                <label htmlFor="ha-field">Filtrar por</label>
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
              <div className="ha-filtro-field">
                <label htmlFor="ha-from">Desde</label>
                <input
                  id="ha-from"
                  type="date"
                  className="aur-input"
                  value={filterFrom}
                  onChange={e => { setFilterFrom(e.target.value); setPage(1); }}
                />
              </div>
              <div className="ha-filtro-field">
                <label htmlFor="ha-to">Hasta</label>
                <input
                  id="ha-to"
                  type="date"
                  className="aur-input"
                  value={filterTo}
                  onChange={e => { setFilterTo(e.target.value); setPage(1); }}
                />
              </div>
            </div>
          </div>
          <div className="aur-modal-actions">
            {(filterFrom || filterTo) && (
              <button
                type="button"
                className="aur-chip aur-chip--ghost"
                onClick={clearFilters}
              >
                <FiX size={12} /> Limpiar
              </button>
            )}
            <button
              type="button"
              className="aur-btn-pill"
              onClick={() => setMostrarFiltros(false)}
            >
              Listo
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}

    {/* ── Menú "Personalizar columnas" ── */}
    {colMenu && createPortal(
      <>
        <div className="aur-filter-backdrop" onClick={() => setColMenu(null)} />
        <div
          className="aur-col-menu"
          style={{ position: 'fixed', top: colMenu.y, left: colMenu.x }}
        >
          <div className="aur-col-menu-title">Columnas visibles</div>
          {COLUMNS.map(col => {
            const checked   = visibleCols[col.key] !== false;
            const isLastOne = checked && (COLUMNS.length - hiddenCount) === 1;
            return (
              <label
                key={col.key}
                className={`aur-col-menu-item${isLastOne ? ' aur-col-menu-item--disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isLastOne}
                  onChange={() => !isLastOne && toggleCol(col.key)}
                />
                <span>{col.label}</span>
              </label>
            );
          })}
        </div>
      </>,
      document.body
    )}

    {/* ── Popover filtro de columna ── */}
    {filterPopover && (() => {
      const field = filterPopover.field;
      const colType = getFilterType(field);
      const filter  = colFilters[field];
      if (colType !== 'text') {
        return (
          <AuroraFilterPopover
            x={filterPopover.x}
            y={filterPopover.y}
            filterType={colType}
            fromValue={filter?.from || ''}
            toValue={filter?.to || ''}
            onFromChange={(from) => setColFilter(field, { type: 'range', from, to: filter?.to || '' })}
            onToChange={(to)   => setColFilter(field, { type: 'range', from: filter?.from || '', to })}
            onClear={() => setColFilter(field, null)}
            onClose={() => setFilterPopover(null)}
          />
        );
      }
      return (
        <AuroraFilterPopover
          x={filterPopover.x}
          y={filterPopover.y}
          filterType="text"
          textValue={filter?.value || ''}
          onTextChange={(value) => setColFilter(field, { type: 'text', value })}
          onClear={() => setColFilter(field, null)}
          onClose={() => setFilterPopover(null)}
        />
      );
    })()}
    </>
  );
}

export default HistorialAplicaciones;
