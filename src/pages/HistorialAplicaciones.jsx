import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './HistorialAplicaciones.css';

const PAGE_SIZE = 50;

const DATE_FIELDS = [
  { value: 'generadaAt',       label: 'Fecha de generación' },
  { value: 'mezclaListaAt',    label: 'Fecha mezcla lista' },
  { value: 'aplicadaAt',       label: 'Fecha de aplicación' },
  { value: 'snap_dueDate',     label: 'F. Prog. Aplicación' },
  { value: 'snap_fechaCosecha',label: 'F. Prog. Cosecha' },
];

const SORT_FIELDS = [
  { value: '',                       label: '— Ninguno —' },
  { value: 'consecutivo',            label: 'Consecutivo' },
  { value: 'status',                 label: 'Estado' },
  { value: 'generadaAt',             label: 'Fecha generación' },
  { value: 'mezclaListaAt',          label: 'Fecha mezcla' },
  { value: 'aplicadaAt',             label: 'Fecha aplicación' },
  { value: 'snap_dueDate',           label: 'F. Prog. Aplicación' },
  { value: 'snap_fechaCosecha',      label: 'F. Prog. Cosecha' },
  { value: 'snap_activityName',      label: 'Aplicación' },
  { value: 'snap_sourceName',        label: 'Grupo / Lote' },
  { value: 'snap_paqueteTecnico',    label: 'Paq. Técnico' },
  { value: 'snap_calibracionNombre', label: 'Calibración' },
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

  const [filterDateField, setFilterDateField] = useState('generadaAt');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');

  const [sorts, setSorts] = useState([
    { field: 'generadaAt', dir: 'desc' },
    { field: '',           dir: 'asc'  },
    { field: '',           dir: 'asc'  },
  ]);

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
      return prods.map(prod => ({ ...c, _prod: prod }));
    });
  }, [cedulas]);

  // Filtrado por período
  const filtered = useMemo(() => {
    if (!filterFrom && !filterTo) return flattened;
    return flattened.filter(row => {
      const raw = row[filterDateField];
      if (!raw) return false;
      const d = new Date(raw);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      return true;
    });
  }, [flattened, filterDateField, filterFrom, filterTo]);

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

  const updateSort = (i, key, value) => {
    setSorts(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => { setFilterFrom(''); setFilterTo(''); setPage(1); };

  if (loading) return <div className="empty-state">Cargando historial…</div>;

  return (
    <div className="historial-wrap">

      <button className="historial-back-btn" onClick={() => navigate(-1)}>
        <FiArrowLeft size={15} /> Volver
      </button>

      {/* ── Panel de controles ── */}
      <div className="historial-controls">

        <div className="historial-control-block">
          <span className="historial-control-title">Período</span>
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

        <div className="historial-control-block">
          <span className="historial-control-title">Ordenamiento</span>
          <div className="historial-sort-rows">
            {sorts.map((s, i) => (
              <div key={i} className="historial-sort-row">
                <span className="historial-sort-prefix">
                  {i === 0 ? 'Ordenar por' : 'Luego por'}
                </span>
                <select
                  className="historial-select"
                  value={s.field}
                  onChange={e => updateSort(i, 'field', e.target.value)}
                >
                  {SORT_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  className="historial-select historial-dir-select"
                  value={s.dir}
                  disabled={!s.field}
                  onChange={e => updateSort(i, 'dir', e.target.value)}
                >
                  <option value="asc">Ascendente ↑</option>
                  <option value="desc">Descendente ↓</option>
                </select>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Contador ── */}
      <div className="historial-count">
        {sorted.length === 0
          ? 'Sin resultados para los filtros aplicados.'
          : `Mostrando ${visible.length} de ${sorted.length} fila${sorted.length !== 1 ? 's' : ''} (${cedulas.length} cédula${cedulas.length !== 1 ? 's' : ''})`
        }
      </div>

      {/* ── Tabla ── */}
      {sorted.length > 0 && (
        <>
          <div className="historial-table-wrap">
            <table className="historial-table historial-table--wide">
              <thead>
                <tr>
                  {/* Identificación */}
                  <th className="historial-th-group">Consecutivo</th>
                  <th className="historial-th-group">Estado</th>
                  {/* Datos de la aplicación */}
                  <th>Aplicación</th>
                  <th>F. Prog. Aplic.</th>
                  <th>F. Prog. Cosecha</th>
                  <th>F. Creación Grupo</th>
                  <th>Per. Carencia (d)</th>
                  <th>Per. Reingreso (h)</th>
                  <th>Método Aplicación</th>
                  <th>Paq. Técnico</th>
                  <th>Grupo</th>
                  <th>Etapa</th>
                  <th>Área (ha)</th>
                  <th>Total Plantas</th>
                  <th>Volumen (Lt/Ha)</th>
                  <th>Litros Aplicador</th>
                  <th>Total Boones Req.</th>
                  <th>Calibración</th>
                  {/* Bloques */}
                  <th>Lote</th>
                  <th>Bloques</th>
                  {/* Producto (se repite por fila) */}
                  <th>Id Producto</th>
                  <th>Nombre Comercial — Ing. Activo</th>
                  <th>Cant./Ha</th>
                  <th>Unidad</th>
                  <th>Total Prod.</th>
                  {/* Campo */}
                  <th>Sobrante</th>
                  <th>Depositado en</th>
                  <th>Cond. del Tiempo</th>
                  <th>Temperatura</th>
                  <th>% Hum. Relativa</th>
                  <th>Fecha Aplicación</th>
                  <th>Hora Inicial</th>
                  <th>Hora Final</th>
                  <th>Operario</th>
                  {/* Responsables */}
                  <th>Enc. de Finca</th>
                  <th>Enc. de Bodega</th>
                  <th>Sup. Aplicaciones / Regente</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, idx) => {
                  const prod = row._prod;
                  // Lotes y bloques del snapshot
                  const bloquesArr = Array.isArray(row.snap_bloques) ? row.snap_bloques : [];
                  const lotesUnicos = [...new Set(bloquesArr.map(b => b.loteNombre).filter(Boolean))].join(', ');
                  const bloqueNombres = bloquesArr
                    .map(b => b.bloque)
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
                    .join(', ');

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
                      <td className="historial-td-nowrap">
                        {[row.snap_cosecha, row.snap_etapa].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td>{n(row.snap_areaHa, 2)}</td>
                      <td>{row.snap_totalPlantas ? Number(row.snap_totalPlantas).toLocaleString('es-ES') : '—'}</td>
                      <td>{n(row.snap_volumenPorHa)}</td>
                      <td>{n(row.snap_litrosAplicador)}</td>
                      <td>{n(row.snap_totalBoones, 2)}</td>
                      <td className="historial-td-nowrap">{row.snap_calibracionNombre || '—'}</td>
                      {/* Bloques */}
                      <td className="historial-td-nowrap">{lotesUnicos || '—'}</td>
                      <td className="historial-td-bloques">{bloqueNombres || '—'}</td>
                      {/* Producto */}
                      <td>{prod?.idProducto ?? '—'}</td>
                      <td className="historial-td-producto">
                        {prod
                          ? [prod.nombreComercial, prod.ingredienteActivo].filter(Boolean).join(' — ') || '—'
                          : '—'}
                      </td>
                      <td>{prod ? n(prod.cantidadPorHa) : '—'}</td>
                      <td>{prod?.unidad ?? '—'}</td>
                      <td>{prod ? n(prod.total, 3) : '—'}</td>
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
                      <td className="historial-td-nowrap">{row.encargadoFinca   || '—'}</td>
                      <td className="historial-td-nowrap">{row.encargadoBodega  || '—'}</td>
                      <td className="historial-td-nowrap">{row.supAplicaciones  || '—'}</td>
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
  );
}

export default HistorialAplicaciones;
