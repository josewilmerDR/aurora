import { useState, useEffect, useMemo } from 'react';
import { useApiFetch } from '../hooks/useApiFetch';
import './HistorialAplicaciones.css';

const PAGE_SIZE = 50;

const DATE_FIELDS = [
  { value: 'generadaAt',    label: 'Fecha de generación' },
  { value: 'mezclaListaAt', label: 'Fecha mezcla lista' },
  { value: 'aplicadaAt',    label: 'Fecha de aplicación' },
  { value: 'dueDate',       label: 'Fecha programada' },
];

const SORT_FIELDS = [
  { value: '',              label: '— Ninguno —' },
  { value: 'consecutivo',   label: 'Consecutivo' },
  { value: 'status',        label: 'Estado' },
  { value: 'generadaAt',    label: 'Fecha generación' },
  { value: 'mezclaListaAt', label: 'Fecha mezcla' },
  { value: 'aplicadaAt',    label: 'Fecha aplicación' },
  { value: 'dueDate',       label: 'Fecha programada' },
  { value: 'activityName',  label: 'Tarea' },
  { value: 'loteName',      label: 'Lote / Grupo' },
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

// ─────────────────────────────────────────────────────────────────────────────
function HistorialAplicaciones() {
  const apiFetch = useApiFetch();
  const [cedulas,  setCedulas]  = useState([]);
  const [tasks,    setTasks]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);

  // Filtros de período
  const [filterDateField, setFilterDateField] = useState('generadaAt');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');

  // Ordenamiento: tres niveles
  const [sorts, setSorts] = useState([
    { field: 'generadaAt', dir: 'desc' },
    { field: '',           dir: 'asc'  },
    { field: '',           dir: 'asc'  },
  ]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/cedulas').then(r => r.json()),
      apiFetch('/api/tasks').then(r => r.json()),
    ]).then(([c, t]) => {
      setCedulas(Array.isArray(c) ? c : []);
      setTasks(Array.isArray(t) ? t : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Join cedulas con datos de la tarea
  const enriched = useMemo(() => {
    const taskMap = {};
    for (const t of tasks) taskMap[t.id] = t;
    return cedulas.map(c => {
      const task = taskMap[c.taskId] || {};
      return {
        ...c,
        activityName: task.activityName || task.activity?.name || '—',
        loteName:     task.loteName     || '—',
        dueDate:      task.dueDate      || null,
      };
    });
  }, [cedulas, tasks]);

  // Filtrado por período
  const filtered = useMemo(() => {
    if (!filterFrom && !filterTo) return enriched;
    return enriched.filter(c => {
      const raw = c[filterDateField];
      if (!raw) return false;
      const d = new Date(raw);
      if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
      if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      return true;
    });
  }, [enriched, filterDateField, filterFrom, filterTo]);

  // Ordenamiento multi-nivel
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

  // Paginación
  const visible  = useMemo(() => sorted.slice(0, page * PAGE_SIZE), [sorted, page]);
  const hasMore  = visible.length < sorted.length;

  const updateSort = (i, key, value) => {
    setSorts(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: value };
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilterFrom('');
    setFilterTo('');
    setPage(1);
  };

  if (loading) return <div className="empty-state">Cargando historial…</div>;

  return (
    <div className="historial-wrap">

      {/* ── Panel de controles ── */}
      <div className="historial-controls">

        {/* Filtro por período */}
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

        {/* Ordenamiento */}
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
          : `Mostrando ${visible.length} de ${sorted.length} cédula${sorted.length !== 1 ? 's' : ''}${sorted.length !== enriched.length ? ` (${enriched.length} en total)` : ''}`
        }
      </div>

      {/* ── Tabla ── */}
      {sorted.length > 0 && (
        <>
          <div className="historial-table-wrap">
            <table className="historial-table">
              <thead>
                <tr>
                  <th>Consecutivo</th>
                  <th>Estado</th>
                  <th>Tarea</th>
                  <th>Lote / Grupo</th>
                  <th>F. Programada</th>
                  <th>Generada</th>
                  <th>Mezcla Lista</th>
                  <th>Aplicada</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => (
                  <tr key={c.id}>
                    <td className="historial-consecutivo">{c.consecutivo}</td>
                    <td>
                      <span className={`historial-badge ${STATUS_CLASS[c.status] || ''}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td>{c.activityName}</td>
                    <td>{c.loteName}</td>
                    <td>{fmt(c.dueDate)}</td>
                    <td>{fmt(c.generadaAt)}</td>
                    <td>{fmt(c.mezclaListaAt)}</td>
                    <td>{fmt(c.aplicadaAt)}</td>
                  </tr>
                ))}
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
