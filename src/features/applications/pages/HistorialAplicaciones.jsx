import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiX, FiArrowRight, FiDownload, FiSearch, FiClipboard, FiPlusCircle } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import FilterButton from '../../../components/ui/FilterButton';
import FiltroPeriodoModal from '../components/FiltroPeriodoModal';
import { formatShortDate as fmt, getCedulaStatusMeta } from '../lib/cedulas-helpers';
import '../styles/historial.css';

const DATE_FIELDS = [
  { value: 'snap_dueDate',             label: 'F. Prog. Aplicación' },
  { value: 'snap_fechaCosecha',        label: 'F. Prog. Cosecha' },
  { value: 'snap_fechaCreacionGrupo',  label: 'F. Creación Grupo' },
  { value: 'aplicadaAt',               label: 'Fecha Aplicación' },
  { value: 'editadaAt',                label: 'Fecha Edición' },
];

// Status label + badge class viven en cedulas-helpers (CEDULA_STATUS_META)
// como single source of truth — antes acá teníamos dos mapping locales que
// divergían silenciosamente de los de CedulaCard / CedulaSplitCard / Viewer.

const CAMBIO_BADGE_CLASS = {
  'Sustitución':     'aur-badge--blue',
  'Ajuste de dosis': 'aur-badge--yellow',
  'Añadido':         'aur-badge--green',
  'Retirado':        'aur-badge--gray',
  'Otro':            'aur-badge--violet',
};

// Formato numérico: con `decimals` explícito → toFixed(d). Sin él →
// toLocaleString con hasta 2 decimales y sin trailing zeros, evitando casos
// como "5.500000000001" que aparecían cuando la API devolvía flotantes
// (#20 audit). Si v no es número finito, '—'.
const n = (v, decimals) => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  if (decimals != null) return num.toFixed(decimals);
  return num.toLocaleString('es-ES', { maximumFractionDigits: 2 });
};

// Formato de costo con separador de miles y 2 decimales, opcionalmente con moneda.
const fmtCosto = (v, moneda) => {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const str = Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda ? `${str} ${moneda}` : str;
};

const prodLabel = (p) => p
  ? [p.nombreComercial, p.ingredienteActivo].filter(Boolean).join(' — ')
  : '';

// ObsCell — celda de observaciones con toggle "ver más / menos" basado en
// overflow REAL (ResizeObserver), no en charcount. El umbral fijo de 70
// caracteres tenía falsos positivos/negativos cuando el ancho de la celda
// cambia con el preset de columnas o el viewport. Punto #19 audit.
function ObsCell({ text, expanded, onToggle }) {
  const textRef = useRef(null);
  // hadOverflow: si una vez detectamos overflow, queda en true hasta que
  // cambie el texto. Sin esto, al expandir se quita el clamp y un re-cálculo
  // en vivo da scrollHeight === clientHeight → el toggle "ver menos"
  // desaparecería justo cuando es más útil.
  const [hadOverflow, setHadOverflow] = useState(false);

  useEffect(() => {
    setHadOverflow(false);
    const el = textRef.current;
    if (!el) return;
    const check = () => {
      // scrollHeight > clientHeight con un buffer de 1px para evitar
      // false positives por sub-pixel rounding en zooms.
      if (el.scrollHeight > el.clientHeight + 1) setHadOverflow(true);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  if (!text) return '—';
  return (
    <div className={`historial-obs-cell${expanded ? ' is-expanded' : ''}`}>
      <span
        ref={textRef}
        className="historial-obs-text"
        title={hadOverflow && !expanded ? text : undefined}
      >
        {text}
      </span>
      {hadOverflow && (
        <button
          type="button"
          className="historial-obs-toggle"
          onClick={onToggle}
        >
          {expanded ? 'ver menos' : 'ver más'}
        </button>
      )}
    </div>
  );
}

// Columnas — para AuroraDataTable:
//   - key       · id de la columna (también campo del row salvo agregados)
//   - label     · header visible
//   - type      · 'text' | 'date' | 'number' (define UI del filter popover)
//   - accessor  · opcional, valor crudo usado para sort/filter/export. Default
//                 lee row[key]. Definir cuando el valor es derivado (status
//                 label en vez de código) o necesita slice (fecha YYYY-MM-DD).
//   - render    · cómo se renderiza la celda en la tabla
//   - exportFmt · opcional, valor formateado para Excel. Default usa accessor.
//   - tdClass   · clase extra en la celda
//   - tdProps   · props extra (típicamente `title` para overflow visual)
const ALL_COLUMNS = [
  {
    key: 'consecutivo', label: 'Consecutivo', type: 'text',
    accessor: (r) => r.consecutivo || '',
    render: (row) => row.status === 'aplicada_en_campo'
      ? <Link to={`/aplicaciones/cedula/${row.id}`} className="historial-cedula-link">{row.consecutivo}</Link>
      : row.consecutivo,
    tdClass: 'historial-consecutivo',
  },
  {
    key: 'status', label: 'Estado', type: 'text',
    accessor: (r) => getCedulaStatusMeta(r.status).label,
    render: (row) => {
      const sb = getCedulaStatusMeta(row.status);
      return <span className={`aur-badge ${sb.badgeClass}`}>{sb.label}</span>;
    },
  },
  {
    key: 'snap_activityName', label: 'Aplicación', type: 'text',
    render: (row) => row.snap_activityName || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'snap_dueDate', label: 'F. Prog. Aplic.', type: 'date',
    accessor: (r) => r.snap_dueDate ? String(r.snap_dueDate).slice(0, 10) : '',
    render: (row) => fmt(row.snap_dueDate),
    exportFmt: (r) => fmt(r.snap_dueDate),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'snap_fechaCosecha', label: 'F. Prog. Cosecha', type: 'date',
    accessor: (r) => r.snap_fechaCosecha ? String(r.snap_fechaCosecha).slice(0, 10) : '',
    render: (row) => fmt(row.snap_fechaCosecha),
    exportFmt: (r) => fmt(r.snap_fechaCosecha),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'snap_fechaCreacionGrupo', label: 'F. Creación Grupo', type: 'date',
    accessor: (r) => r.snap_fechaCreacionGrupo ? String(r.snap_fechaCreacionGrupo).slice(0, 10) : '',
    render: (row) => fmt(row.snap_fechaCreacionGrupo),
    exportFmt: (r) => fmt(r.snap_fechaCreacionGrupo),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'snap_periodoCarenciaMax', label: 'Per. Carencia (d)', type: 'number',
    render: (row) => n(row.snap_periodoCarenciaMax),
  },
  {
    key: 'snap_periodoReingresoMax', label: 'Per. Reingreso (h)', type: 'number',
    render: (row) => n(row.snap_periodoReingresoMax),
  },
  {
    key: 'metodoAplicacion', label: 'Método Aplicación', type: 'text',
    render: (row) => row.metodoAplicacion || '—',
  },
  {
    key: 'snap_paqueteTecnico', label: 'Paquete', type: 'text',
    render: (row) => row.snap_paqueteTecnico || '—',
  },
  {
    key: 'snap_sourceName', label: 'Grupo', type: 'text',
    render: (row) => row.snap_sourceName || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: '_etapaStr', label: 'Etapa', type: 'text',
    render: (row) => row._etapaStr || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'snap_areaHa', label: 'Área (ha)', type: 'number',
    render: (row) => n(row.snap_areaHa, 2),
  },
  {
    key: 'snap_totalPlantas', label: 'Total Plantas', type: 'number',
    render: (row) => row.snap_totalPlantas ? Number(row.snap_totalPlantas).toLocaleString('es-ES') : '—',
  },
  {
    key: 'snap_volumenPorHa', label: 'Volumen (Lt/Ha)', type: 'number',
    render: (row) => n(row.snap_volumenPorHa),
  },
  {
    key: 'snap_litrosAplicador', label: 'Litros Aplicador', type: 'number',
    render: (row) => n(row.snap_litrosAplicador),
  },
  {
    key: 'snap_totalBoones', label: 'Tanques (boom)', type: 'number',
    render: (row) => n(row.snap_totalBoones, 2),
  },
  {
    key: 'snap_calibracionNombre', label: 'Calibración', type: 'text',
    render: (row) => row.snap_calibracionNombre || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: '_lotesStr', label: 'Lote', type: 'text',
    render: (row) => row._lotesStr || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: '_bloquesStr', label: 'Bloques', type: 'text',
    render: (row) => row._bloquesStr || '—',
    tdClass: 'historial-td-bloques',
    tdProps: (row) => ({ title: row._bloquesStr || undefined }),
  },
  {
    key: '_prodIdProducto', label: 'Id Producto', type: 'text',
    render: (row) => row._prodIdProducto || '—',
    // Si idProducto legible falta, exponemos el productoId Firestore en el
    // title para soporte / debugging — antes lo mostrábamos crudo en la
    // celda y el usuario lo confundía con un bug. Punto #23 audit.
    tdProps: (row) => (
      !row._prodIdProducto && row._prod?.productoId
        ? { title: `Sin Id legible — productoId interno: ${row._prod.productoId}` }
        : undefined
    ),
  },
  {
    key: '_prodNombre', label: 'Nombre Comercial — Ing. Activo', type: 'text',
    render: (row) => row._prodNombre || '—',
    tdClass: 'historial-td-producto',
    tdProps: (row) => ({ title: row._prodNombre || undefined }),
  },
  {
    key: '_prodCantidad', label: 'Cant./Ha', type: 'number',
    render: (row) => row._prodCantidad != null ? n(row._prodCantidad) : '—',
  },
  {
    key: '_prodUnidad', label: 'Unidad', type: 'text',
    render: (row) => row._prodUnidad || '—',
  },
  {
    key: '_prodTotal', label: 'Total Prod.', type: 'number',
    render: (row) => row._prodTotal != null ? n(row._prodTotal, 3) : '—',
  },
  {
    key: '_prodCambio', label: 'Cambio', type: 'text',
    render: (row) => row._prodCambio
      ? <span className={`aur-badge ${CAMBIO_BADGE_CLASS[row._prodCambio] || ''}`}>{row._prodCambio}</span>
      : '—',
    exportFmt: (r) => r._prodCambio || '',
  },
  {
    key: '_prodOrigIdProducto', label: 'Id Prod. Original', type: 'text',
    render: (row) => row._prodOrigIdProducto || '—',
  },
  // Nota: `_prodOrigIdProducto` se completa desde el plan original que sí
  // suele tener `idProducto` legible. Si en el futuro aparecen casos sin él,
  // espejar el tdProps del título de `_prodIdProducto`.
  {
    key: '_prodOrigNombre', label: 'Prod. Original', type: 'text',
    render: (row) => row._prodOrigNombre || '—',
    tdClass: 'historial-td-producto',
    tdProps: (row) => ({ title: row._prodOrigNombre || undefined }),
  },
  {
    key: '_prodOrigCantidad', label: 'Cant. Orig./Ha', type: 'number',
    render: (row) => row._prodOrigCantidad != null ? n(row._prodOrigCantidad) : '—',
  },
  {
    key: '_prodOrigUnidad', label: 'Unid. Orig.', type: 'text',
    render: (row) => row._prodOrigUnidad || '—',
  },
  {
    key: '_prodCostoTotal', label: 'Total Costo', type: 'number',
    render: (row) => fmtCosto(row._prodCostoTotal, row._prodMoneda),
    exportFmt: (r) => fmtCosto(r._prodCostoTotal, r._prodMoneda),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'sobrante', label: 'Sobrante', type: 'text',
    accessor: (r) => r.sobrante === true ? 'Sí' : r.sobrante === false ? 'No' : '',
    render: (row) => row.sobrante === true ? 'Sí' : row.sobrante === false ? 'No' : '—',
  },
  {
    key: 'sobranteLoteNombre', label: 'Depositado en', type: 'text',
    render: (row) => row.sobranteLoteNombre || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'condicionesTiempo', label: 'Cond. del Tiempo', type: 'text',
    render: (row) => row.condicionesTiempo || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'temperatura', label: 'Temperatura', type: 'number',
    render: (row) => row.temperatura != null ? `${row.temperatura}°C` : '—',
    exportFmt: (r) => r.temperatura != null ? `${r.temperatura}°C` : '',
  },
  {
    key: 'humedadRelativa', label: '% Hum. Relativa', type: 'number',
    render: (row) => row.humedadRelativa != null ? `${row.humedadRelativa}%` : '—',
    exportFmt: (r) => r.humedadRelativa != null ? `${r.humedadRelativa}%` : '',
  },
  {
    key: 'aplicadaAt', label: 'Fecha Aplicación', type: 'date',
    accessor: (r) => r.aplicadaAt ? String(r.aplicadaAt).slice(0, 10) : '',
    render: (row) => fmt(row.aplicadaAt),
    exportFmt: (r) => fmt(r.aplicadaAt),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'horaInicio', label: 'Hora Inicial', type: 'text',
    render: (row) => row.horaInicio || '—',
  },
  {
    key: 'horaFinal', label: 'Hora Final', type: 'text',
    render: (row) => row.horaFinal || '—',
  },
  {
    key: 'operario', label: 'Operario', type: 'text',
    render: (row) => row.operario || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'encargadoFinca', label: 'Enc. de Finca', type: 'text',
    render: (row) => row.encargadoFinca || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'encargadoBodega', label: 'Enc. de Bodega', type: 'text',
    render: (row) => row.encargadoBodega || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'supAplicaciones', label: 'Sup. Aplicaciones / Regente', type: 'text',
    render: (row) => row.supAplicaciones || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'editadaAt', label: 'F. Edición', type: 'date',
    accessor: (r) => r.editadaAt ? String(r.editadaAt).slice(0, 10) : '',
    render: (row) => fmt(row.editadaAt),
    exportFmt: (r) => fmt(r.editadaAt),
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'editadaPorNombre', label: 'Editada Por', type: 'text',
    render: (row) => row.editadaPorNombre || '—',
    tdClass: 'historial-td-nowrap',
  },
  {
    key: 'observacionesMezcla', label: 'Obs. Mezcla', type: 'text',
    render: (row, ctx) => {
      const key = `${row._rowKey}-m`;
      return (
        <ObsCell
          text={row.observacionesMezcla}
          expanded={ctx.expandedObs.has(key)}
          onToggle={() => ctx.toggleObs(key)}
        />
      );
    },
    exportFmt: (r) => r.observacionesMezcla || '',
    tdClass: 'historial-td-obs',
  },
  {
    key: 'observacionesAplicacion', label: 'Obs. Aplicación', type: 'text',
    render: (row, ctx) => {
      const key = `${row._rowKey}-a`;
      return (
        <ObsCell
          text={row.observacionesAplicacion}
          expanded={ctx.expandedObs.has(key)}
          onToggle={() => ctx.toggleObs(key)}
        />
      );
    },
    exportFmt: (r) => r.observacionesAplicacion || '',
    tdClass: 'historial-td-obs',
  },
];

// Preset compacto: 8 columnas que cubren la lectura operativa del día a día
// (consecutivo + estado + qué se aplicó + cuándo + dónde + qué producto + cuánto).
// El resto sigue disponible vía el menú "Personalizar columnas" del table.
const COMPACT_COLUMN_IDS = [
  'consecutivo',
  'status',
  'snap_activityName',
  'aplicadaAt',
  'snap_sourceName',
  '_lotesStr',
  '_prodNombre',
  '_prodTotal',
];

// useTableColumnPreset usa `id`; AuroraDataTable usa `key`. Mantenemos ambos.
const COLUMNS_WITH_ID = ALL_COLUMNS.map(c => ({ ...c, id: c.key }));

// ─────────────────────────────────────────────────────────────────────────────
function HistorialAplicaciones() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [cedulas, setCedulas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filtro global por rango de fechas (header modal). El filtro de columna
  // lo maneja AuroraDataTable internamente.
  const [filterDateField, setFilterDateField] = useState('snap_dueDate');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');
  const [mostrarFiltros,  setMostrarFiltros]  = useState(false);

  // Búsqueda libre sobre el listing. Filtra antes que el rango de fechas para
  // que el contador "X en el periodo" del modal refleje también el search.
  // No persiste — cada visita arranca limpia. Punto #8 audit.
  const [searchQuery, setSearchQuery] = useState('');

  // Observaciones con toggle "ver más" — UI puro de celda, no participa en
  // sort/filter/export. Las keys son `${rowKey}-m|a`.
  const [expandedObs, setExpandedObs] = useState(() => new Set());

  // Snapshot post-filter/sort que sale de AuroraDataTable. Lo usamos para que
  // el export Excel respete filtros + orden del usuario sin recomputar.
  const [displayData, setDisplayData] = useState([]);

  // Visibilidad persistida por usuario. Storage key incluye uid para no
  // compartir preferencias entre cuentas en el mismo browser.
  const uid = currentUser?.id || 'anon';
  const { isVisible, toggleColumn } = useTableColumnPreset(
    COLUMNS_WITH_ID,
    COMPACT_COLUMN_IDS,
    `aurora_historial_aplicaciones_cols_${uid}`,
  );

  // Adaptador del hook → Record<key, bool> que espera AuroraDataTable.
  // Re-derivar cuando cambia `isVisible` (toggle individual o cambio de modo).
  const visibleColsRecord = useMemo(
    () => Object.fromEntries(ALL_COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible],
  );

  const toggleObs = useCallback((key) => {
    setExpandedObs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    // include=costs opt-in: snap_productos[].precioUnitario + moneda solo
    // viajan al cliente cuando la página los pide explícito. El viewer y el
    // listing de cédulas reciben respuesta sin pricing por default. M2 audit.
    apiFetch('/api/cedulas?include=costs').then(r => r.json())
      .then(c => {
        if (cancelled) return;
        setCedulas(Array.isArray(c) ? c.filter(ced => ced.status === 'aplicada_en_campo') : []);
      })
      .catch(e => { if (!cancelled) console.error(e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch]);

  // Flatten: una fila por (cédula × producto). Cada row se enriquece con el
  // producto originalmente prescrito por el sistema (cuando hubo sustitución /
  // ajuste de dosis) y con la marca de cambio (`_prodCambio`). Los productos
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

          // Costo snapshot = total aplicado × precioUnitario congelado al
          // momento de la aplicación (ambos viven en snap_productos[]). Si
          // alguno falta, el costo queda null y se renderiza como '—'.
          //
          // NO redondear acá: precioUnitario puede tener 4+ decimales (dólares
          // por gramo de ingrediente activo) y total 3 decimales. El truncado
          // a 2 que vivía aquí perdía precisión en el snapshot persistido —
          // dejamos el float completo y `fmtCosto` se encarga del display.
          // Punto #21 audit.
          const _prodTotalNum      = parseFloat(prod?.total);
          const _prodPrecioUnitNum = parseFloat(prod?.precioUnitario);
          const _prodCostoTotal =
            Number.isFinite(_prodTotalNum) && Number.isFinite(_prodPrecioUnitNum)
              ? _prodTotalNum * _prodPrecioUnitNum
              : null;

          rows.push({
            ...c, ...base,
            _rowKey: `${c.id}::a::${prod?.productoId ?? `i${prodIdx}`}`,
            _prod: prod,
            // Solo el id legible (idProducto). Si falta, dejamos vacío y la
            // columna muestra '—' + el productoId Firestore va en title via
            // tdProps. Punto #23 audit.
            _prodIdProducto: prod?.idProducto ?? '',
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
          // _prod referencia el original para que el tdProps de
          // `_prodIdProducto` pueda exponer el productoId Firestore en title
          // si idProducto legible falta.
          _prod: o,
          _prodIdProducto: o.idProducto ?? '',
          _prodNombre:     prodLabel(o),
          _prodCantidad:   o.cantidadPorHa ?? null,
          _prodUnidad:     o.unidad ?? '',
          _prodTotal:      null,
          _prodCostoTotal: null,
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

  // Pipeline de filtrado del header (antes de pasar a AuroraDataTable):
  //   flattened → searchFiltered → periodFiltered → AuroraDataTable
  // Separar search de period mantiene el contador live del FiltroPeriodoModal
  // ("X filas en el periodo") respondiendo al search también; el orden
  // search → period es más natural: primero acotás qué buscás, luego filtrás
  // por rango.
  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return flattened;
    return flattened.filter(row =>
      (row.consecutivo        || '').toLowerCase().includes(q) ||
      (row.snap_activityName  || '').toLowerCase().includes(q) ||
      (row.snap_sourceName    || '').toLowerCase().includes(q) ||
      (row._lotesStr          || '').toLowerCase().includes(q) ||
      (row._bloquesStr        || '').toLowerCase().includes(q) ||
      (row._prodNombre        || '').toLowerCase().includes(q) ||
      (row.operario           || '').toLowerCase().includes(q)
    );
  }, [flattened, searchQuery]);

  const periodFiltered = useMemo(() => {
    if (!filterFrom && !filterTo) return searchFiltered;
    return searchFiltered.filter(row => {
      const raw = row[filterDateField];
      if (!raw) return false;
      const d = new Date(raw);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      return true;
    });
  }, [searchFiltered, filterDateField, filterFrom, filterTo]);

  // getColVal alimenta sort + filter de AuroraDataTable. Para text devolvemos
  // lowercase porque el filter del componente sólo lowercase del input, no del
  // val (#29 audit). Para date YYYY-MM-DD así matchea exacto contra el
  // `<input type="date">` del popover.
  //
  // useCallback: AuroraDataTable usa getColVal como dep del useMemo de
  // `displayData`. Una arrow nueva cada render invalida el memo en cada paso,
  // que dispara `onDisplayDataChange` en loop con setDisplayData. ALL_COLUMNS
  // es módulo-constante, así que no hay deps reales.
  const getColVal = useCallback((row, key) => {
    const col = ALL_COLUMNS.find(c => c.key === key);
    if (!col) return '';
    const raw = col.accessor ? col.accessor(row) : row[key];
    if (col.type === 'text')   return String(raw ?? '').toLowerCase();
    if (col.type === 'date')   return raw ? String(raw) : '';
    if (col.type === 'number') return raw == null || raw === '' ? '' : Number(raw);
    return raw ?? '';
  }, []);

  // renderRow itera sólo columnas visibles (vc viene de AuroraDataTable) y
  // delega al `render` de cada columna. El ctx expone `expandedObs` +
  // `toggleObs` para las celdas de observaciones (componente <ObsCell/>
  // mide el overflow real con ResizeObserver — #19 audit).
  const renderRow = (row, vc) => (
    <>
      {ALL_COLUMNS.map(col => {
        if (!vc[col.key]) return null;
        const extraProps = col.tdProps ? col.tdProps(row) : null;
        return (
          <td key={col.key} className={col.tdClass} {...extraProps}>
            {col.render(row, { expandedObs, toggleObs })}
          </td>
        );
      })}
    </>
  );

  // Export Excel — respeta orden + filtros + columnas visibles actuales
  // (displayData ya viene post-filtered/post-sorted desde AuroraDataTable).
  // Para campos con formato custom usamos exportFmt; el resto cae al accessor
  // o row[key] crudo.
  const exportXLSX = () => {
    const visible = ALL_COLUMNS.filter(c => isVisible(c.key));
    const headers = visible.map(c => c.label);
    const rows = displayData.map(row =>
      visible.map(c => {
        if (c.exportFmt) return c.exportFmt(row) ?? '';
        const raw = c.accessor ? c.accessor(row) : row[c.key];
        return raw == null ? '' : raw;
      }),
    );
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h, i) => ({
      wch: Math.max(
        String(h).length,
        ...rows.map(r => String(r[i] ?? '').length),
      ) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Historial');
    XLSX.writeFile(wb, `historial-aplicaciones_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const hasPeriodFilter = !!(filterFrom || filterTo);
  const hasData = periodFiltered.length > 0;

  // Contador de cédulas únicas en la vista actual — "Registros N" contaba
  // filas (cedula × producto) y un usuario lee "Registros 200" como 200
  // cédulas. Punto #14 audit.
  const cedulaCount = useMemo(
    () => new Set(displayData.map(r => r.id)).size,
    [displayData],
  );
  const resultLabel = useCallback((filtered /* , total */) => {
    const cedWord  = cedulaCount === 1 ? 'cédula'  : 'cédulas';
    const lineWord = filtered === 1    ? 'línea'   : 'líneas';
    return `${cedulaCount} ${cedWord} · ${filtered} ${lineWord}`;
  }, [cedulaCount]);

  // Click en fila → navega al CedulaViewer. Solo aplica a filas con cédula
  // aplicada (la página filtra status=aplicada_en_campo, así que esto es
  // 100% de los casos hoy; el guard queda por si algún día cambia). Punto
  // #15 audit. El consecutivo (Link en la celda) sigue siendo el atajo
  // formal — el row.onClick es affordance redundante para descubrimiento.
  const handleRowClick = useCallback((row) => {
    if (row?.id && row.status === 'aplicada_en_campo') {
      navigate(`/aplicaciones/cedula/${row.id}`);
    }
  }, [navigate]);

  // Empty-state diferenciado: cuando el dataset entero está vacío (cédulas
  // === 0) mostramos un EmptyState completo con icono + subtitle + CTA al
  // listing de cédulas activas. Cuando hay datos pero los filtros descartan
  // todo (search/periodo/columna), un compact sin icon. Punto #10 audit.
  const emptyProps = cedulas.length === 0
    ? {
        emptyIcon: FiClipboard,
        emptyText: 'Aún no hay registros que mostrar',
        emptySubtitle: 'Las cédulas aparecen aquí al marcarse como aplicadas en campo desde Cédulas pendientes.',
        emptyAction: (
          <Link to="/aplicaciones/cedulas" className="aur-btn-pill">
            <FiPlusCircle size={14} /> Ir a cédulas pendientes
          </Link>
        ),
      }
    : {
        emptyIcon: null,
        emptyText: searchQuery.trim()
          ? `No hay resultados para «${searchQuery.trim()}».`
          : 'Sin resultados para los filtros aplicados.',
      };

  return (
    <div className="aur-sheet ha-page">

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Historial de aplicaciones</h2>
          <p className="aur-sheet-subtitle">
            Cédulas aplicadas con detalle por producto, cambios respecto al plan original y condiciones de campo.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <FilterButton
            active={hasPeriodFilter}
            onClick={() => setMostrarFiltros(true)}
            disabled={loading}
          />
          <button
            type="button"
            className="aur-chip aur-chip--ghost ha-btn-export"
            onClick={exportXLSX}
            disabled={loading || !hasData}
            title={hasData ? 'Descargar Excel con los registros filtrados' : 'Sin registros para exportar'}
            aria-label="Descargar Excel"
          >
            <FiDownload size={12} />
            <span className="aur-btn-filter-label">Excel</span>
          </button>
          <Link
            to="/aplicaciones/cedulas"
            className="aur-btn-pill"
          >
            Ir a cédulas pendientes <FiArrowRight size={14} />
          </Link>
        </div>
      </header>

      {/* Loading: rendereamos header siempre (con buttons disabled) y solo
          la zona de datos cae en skeleton. Da contexto inmediato al usuario
          y evita el "spinner sobre fondo vacío" antiguo. Punto #12 audit. */}
      {loading ? (
        <div className="ha-loading-wrap">
          <AuroraSkeleton variant="row" count={8} label="Cargando historial…" />
        </div>
      ) : (
        <>
          {/* Búsqueda libre — aparece solo si hay dataset (sin datos no tiene
              sentido el input). Filtra por consecutivo, actividad, grupo,
              lote, bloques, producto, operario. Punto #8 audit. */}
          {cedulas.length > 0 && (
            <div className="aur-list-search">
              <FiSearch size={13} aria-hidden="true" />
              <input
                type="search"
                className="aur-list-search-input"
                placeholder="Buscar por consecutivo, actividad, lote, grupo, producto u operario…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar en historial"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="aur-list-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar búsqueda"
                >
                  <FiX size={12} />
                </button>
              )}
            </div>
          )}

          <AuroraDataTable
            columns={ALL_COLUMNS}
            data={periodFiltered}
            getColVal={getColVal}
            initialSort={{ field: 'aplicadaAt', dir: 'desc' }}
            firstClickDir="desc"
            visibleCols={visibleColsRecord}
            onToggleVisibleCol={toggleColumn}
            renderRow={renderRow}
            rowClassName={(r) => r._prodCambio ? 'historial-row-changed' : ''}
            rowKey={(r) => r._rowKey}
            onRowClick={handleRowClick}
            resultLabel={resultLabel}
            pageSize={50}
            // Resetea pagination cuando cambia search o el filtro de periodo
            // del header — sin esto un usuario en pagina 3 que aplica filtro
            // corto puede no ver la transición.
            resetPaginationKey={`${filterDateField}|${filterFrom}|${filterTo}|${searchQuery}`}
            tableClassName="ha-table"
            wrapClassName="ha-table-wrap"
            {...emptyProps}
            onDisplayDataChange={setDisplayData}
          />
        </>
      )}

      {/* Filtro de Periodo — componente compartido con CedulasAplicacion.
          Tiene useEscapeClose + live count integrados. Le pasamos los date
          fields para que renderice el selector "Filtrar por" arriba de los
          inputs (Historial filtra por uno de varios campos de fecha). */}
      {mostrarFiltros && (
        <FiltroPeriodoModal
          dateFrom={filterFrom}
          setDateFrom={setFilterFrom}
          dateTo={filterTo}
          setDateTo={setFilterTo}
          matchCount={periodFiltered.length}
          recordWord="fila"
          dateField={filterDateField}
          setDateField={setFilterDateField}
          dateFields={DATE_FIELDS}
          onClose={() => setMostrarFiltros(false)}
        />
      )}
    </div>
  );
}

export default HistorialAplicaciones;
