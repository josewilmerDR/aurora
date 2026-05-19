import { useState, useEffect, useMemo } from 'react';
import { FiTrash2, FiSearch, FiAlertCircle, FiCheckCircle, FiFilter } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import SamplingRegisterModal from '../components/SamplingRegisterModal';
import '../styles/sampling-center.css';

const fmt = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CR', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const STATUS_LABEL = { pending: 'Pendiente', completed_by_user: 'Completado', skipped: 'Omitido' };
const STATUS_BADGE = { pending: 'yellow', completed_by_user: 'green', skipped: 'gray' };

const STATUS_FILTERS = [
  { value: 'pending',            label: 'Pendientes' },
  { value: 'completed_by_user',  label: 'Completadas' },
  { value: 'all',                label: 'Todas' },
];

const URGENCY = {
  overdue: { label: 'Atrasada', tone: 'magenta' },
  today:   { label: 'Hoy',      tone: 'yellow'  },
  soon:    { label: 'Pronto',   tone: 'blue'    },
};

const getUrgency = (fechaProgramada, status) => {
  if (status !== 'pending' || !fechaProgramada) return null;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const fecha = new Date(fechaProgramada);
  fecha.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.round((fecha - today) / 86400000);
  if (diffDays < 0)  return URGENCY.overdue;
  if (diffDays === 0) return URGENCY.today;
  if (diffDays <= 3) return URGENCY.soon;
  return null;
};

// Columnas que aceptan sort + filtro de columna (embudo on hover).
// Las claves coinciden con campos del objeto orden.
const SORTABLE_COLS = {
  fechaProgramada:   { type: 'date', label: 'Fecha programada' },
  loteNombre:        { type: 'text', label: 'Lote' },
  grupoNombre:       { type: 'text', label: 'Grupo' },
  responsableNombre: { type: 'text', label: 'Responsable' },
  tipoMuestreo:      { type: 'text', label: 'Tipo de muestreo' },
};

export default function SamplingCenter() {
  const apiFetch = useApiFetch();
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [tipoFilter, setTipoFilter] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [modalOrden, setModalOrden] = useState(null);

  // Sort por columna (tri-estado: null → asc → desc → null). Si está en null,
  // el orden por defecto sigue siendo el de urgencia (pendientes asc, completadas desc).
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir]     = useState(null);
  // Filtros por columna (text: { text } | date: { from, to }). Vacío = sin filtro.
  const [colFilters, setColFilters] = useState({});
  // Popover de filtro activo (qué columna abrió el embudo, posición x/y).
  const [filterPop, setFilterPop] = useState(null);

  useEffect(() => {
    apiFetch('/api/muestreos/ordenes')
      .then(r => r.json())
      .then(data => { setOrdenes(data); setLoading(false); })
      .catch(() => { setError('No se pudieron cargar las órdenes de muestreo.'); setLoading(false); });
  }, []);

  const tipoOptions = useMemo(() =>
    [...new Set(ordenes.map(o => o.tipoMuestreo).filter(Boolean))].sort(),
  [ordenes]);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, completed_by_user: 0, all: ordenes.length };
    for (const o of ordenes) {
      if (o.status === 'pending') counts.pending++;
      else if (o.status === 'completed_by_user') counts.completed_by_user++;
    }
    return counts;
  }, [ordenes]);

  const filtered = useMemo(() => {
    let result = ordenes;
    if (statusFilter !== 'all') result = result.filter(o => o.status === statusFilter);
    if (tipoFilter) result = result.filter(o => o.tipoMuestreo === tipoFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(o =>
        o.grupoNombre?.toLowerCase().includes(q) ||
        o.loteNombre?.toLowerCase().includes(q) ||
        o.responsableNombre?.toLowerCase().includes(q) ||
        o.tipoMuestreo?.toLowerCase().includes(q) ||
        o.nota?.toLowerCase().includes(q)
      );
    }
    // Filtros por columna (funnel)
    for (const [field, fv] of Object.entries(colFilters)) {
      const col = SORTABLE_COLS[field];
      if (!col) continue;
      if (col.type === 'text' && fv.text) {
        const needle = fv.text.toLowerCase();
        result = result.filter(o => String(o[field] || '').toLowerCase().includes(needle));
      } else if (col.type === 'date') {
        if (fv.from) result = result.filter(o => (o[field] || '') >= fv.from);
        if (fv.to)   result = result.filter(o => (o[field] || '') <= fv.to);
      }
    }
    // Sort: si el usuario eligió una columna, usar eso. Si no, fallback al
    // ordenamiento por urgencia (pendientes asc, completadas desc por fecha).
    const sorted = [...result];
    if (sortField && sortDir) {
      sorted.sort((a, b) => {
        const av = a[sortField] || '';
        const bv = b[sortField] || '';
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else {
      sorted.sort((a, b) => {
        const fa = a.fechaProgramada || '';
        const fb = b.fechaProgramada || '';
        return statusFilter === 'completed_by_user' ? fb.localeCompare(fa) : fa.localeCompare(fb);
      });
    }
    return sorted;
  }, [ordenes, search, statusFilter, tipoFilter, colFilters, sortField, sortDir]);

  // Sort tri-estado: null → asc → desc → null.
  const handleSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); return; }
    if (sortDir === 'asc')   { setSortDir('desc'); return; }
    setSortField(null); setSortDir(null);
  };

  const setColFilter = (field, key, val) => {
    setColFilters(prev => {
      const col = SORTABLE_COLS[field];
      const cur = prev[field] || (col?.type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = col?.type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: updated };
    });
  };

  const clearColFilter = (field) => {
    setColFilters(prev => {
      const { [field]: _, ...rest } = prev;
      return rest;
    });
  };

  const openFunnel = (e, field) => {
    e.stopPropagation();
    if (filterPop?.field === field) { setFilterPop(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPop({ field, x: rect.left, y: rect.bottom + 4 });
  };

  const handleComplete = async (id, formularioData = null, metadata = {}) => {
    const res = await apiFetch(`/api/muestreos/ordenes/${id}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formularioData, ...metadata }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'No se pudo completar la orden.');
    }
    setOrdenes(prev => prev.map(o => o.id === id ? { ...o, status: 'completed_by_user' } : o));
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await apiFetch(`/api/muestreos/ordenes/${id}`, { method: 'DELETE' });
      setOrdenes(prev => prev.filter(o => o.id !== id));
    } catch {
      // keep item on error
    } finally {
      setDeleting(null);
      setConfirmId(null);
    }
  };

  return (
    <section className="aur-section mo-page">
      <div className="aur-section-header">
        <h3>Órdenes de muestreo</h3>
        <span className="aur-section-count">{filtered.length}</span>
      </div>
      <p className="mo-section-hint">Registra los hallazgos de cada inspección realizada a tus cultivos</p>

      <div className="mo-status-filter" role="tablist" aria-label="Filtrar por estado">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={statusFilter === f.value}
            className={`mo-status-pill${statusFilter === f.value ? ' is-active' : ''}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
            <span className="mo-status-pill-count">{statusCounts[f.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="aur-table-toolbar">
        <div className="mo-search-wrap">
          <FiSearch size={15} className="mo-search-icon" />
          <input
            className="aur-input mo-search"
            type="text"
            placeholder="Buscar por lote, grupo, responsable..."
            value={search}
            maxLength={100}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {tipoOptions.length > 0 && (
          <select
            className="aur-select mo-tipo-select"
            value={tipoFilter}
            onChange={e => setTipoFilter(e.target.value)}
            aria-label="Filtrar por tipo de muestreo"
          >
            <option value="">Todos los tipos</option>
            {tipoOptions.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="mo-state">Cargando órdenes...</div>}
      {error && (
        <div className="mo-state mo-state--error">
          <FiAlertCircle size={18} /> {error}
        </div>
      )}

      {modalOrden && (
        <SamplingRegisterModal
          orden={modalOrden}
          onClose={() => setModalOrden(null)}
          onComplete={async (id, formularioData, metadata) => {
            await handleComplete(id, formularioData, metadata);
            setModalOrden(null);
          }}
        />
      )}

      {filterPop && (
        <AuroraFilterPopover
          x={filterPop.x}
          y={filterPop.y}
          filterType={SORTABLE_COLS[filterPop.field]?.type === 'date' ? 'date' : 'text'}
          textValue={colFilters[filterPop.field]?.text || ''}
          onTextChange={(v) => setColFilter(filterPop.field, 'text', v)}
          textPlaceholder={`Filtrar ${SORTABLE_COLS[filterPop.field]?.label.toLowerCase()}…`}
          fromValue={colFilters[filterPop.field]?.from || ''}
          toValue={colFilters[filterPop.field]?.to || ''}
          onFromChange={(v) => setColFilter(filterPop.field, 'from', v)}
          onToChange={(v) => setColFilter(filterPop.field, 'to', v)}
          onClear={() => clearColFilter(filterPop.field)}
          onClose={() => setFilterPop(null)}
        />
      )}

      {!loading && !error && (
        <>
          {filtered.length === 0 ? (
            <div className="mo-state mo-state--empty">
              {search
                ? 'Sin resultados para la búsqueda.'
                : statusFilter === 'pending'
                  ? 'No hay órdenes pendientes.'
                  : statusFilter === 'completed_by_user'
                    ? 'No hay órdenes completadas.'
                    : 'No hay órdenes de muestreo programadas.'}
            </div>
          ) : (
            <div className="aur-table-wrap">
              <table className="aur-table mo-table">
                <thead>
                  <tr>
                    {Object.entries(SORTABLE_COLS).map(([field, col]) => {
                      const isSort  = sortField === field;
                      const hasFilt = !!colFilters[field];
                      return (
                        <th
                          key={field}
                          className={`aur-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-filter' : ''}`}
                          onClick={() => handleSort(field)}
                        >
                          <span className="aur-th-content">
                            {col.label}
                            <span className="aur-th-arrow">{isSort ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
                            <button
                              type="button"
                              className={`aur-th-funnel${hasFilt ? ' is-active' : ''}`}
                              title="Filtrar columna"
                              aria-label={hasFilt ? `Editar filtro de ${col.label}` : `Filtrar ${col.label}`}
                              onClick={(e) => openFunnel(e, field)}
                            >
                              <FiFilter size={10} />
                            </button>
                          </span>
                        </th>
                      );
                    })}
                    <th>Nota</th>
                    <th>Estado</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => (
                    <tr key={o.id}>
                      <td data-label="Fecha" className="mo-td-date">{fmt(o.fechaProgramada)}</td>
                      <td data-label="Lote">{o.loteNombre}</td>
                      <td data-label="Grupo">{o.grupoNombre}</td>
                      <td data-label="Responsable">{o.responsableNombre}</td>
                      <td data-label="Tipo">{o.tipoMuestreo}</td>
                      <td data-label="Nota" className="mo-td-nota">{o.nota || <span className="mo-empty-val">—</span>}</td>
                      <td data-label="Estado">
                        {(() => {
                          const u = getUrgency(o.fechaProgramada, o.status);
                          if (u) return <span className={`aur-badge aur-badge--${u.tone}`}>{u.label}</span>;
                          return (
                            <span className={`aur-badge aur-badge--${STATUS_BADGE[o.status] || 'gray'}`}>
                              {STATUS_LABEL[o.status] || o.status}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="mo-td-action">
                        {confirmId === o.id ? (
                          <div className="aur-inline-confirm">
                            <span className="aur-inline-confirm-text">¿Eliminar?</span>
                            <button
                              type="button"
                              className="aur-inline-confirm-yes"
                              onClick={() => handleDelete(o.id)}
                              disabled={deleting === o.id}
                            >
                              {deleting === o.id ? '...' : 'Sí'}
                            </button>
                            <button
                              type="button"
                              className="aur-inline-confirm-no"
                              onClick={() => setConfirmId(null)}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <div className="mo-actions">
                            {o.status === 'pending' && (
                              <button
                                type="button"
                                className="mo-complete-btn"
                                title="Registrar resultado del muestreo"
                                onClick={() => setModalOrden(o)}
                              >
                                <FiCheckCircle size={14} />
                                Registrar
                              </button>
                            )}
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                              title="Eliminar orden"
                              onClick={() => setConfirmId(o.id)}
                            >
                              <FiTrash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
