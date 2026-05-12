import { useState, useEffect, useMemo } from 'react';
import { FiTrash2, FiSearch, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
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

export default function SamplingCenter() {
  const apiFetch = useApiFetch();
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [deleting, setDeleting] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [modalOrden, setModalOrden] = useState(null);

  useEffect(() => {
    apiFetch('/api/muestreos/ordenes')
      .then(r => r.json())
      .then(data => { setOrdenes(data); setLoading(false); })
      .catch(() => { setError('No se pudieron cargar las órdenes de muestreo.'); setLoading(false); });
  }, []);

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
    // Pendientes: más urgente primero. Completadas: más recientes primero.
    const sorted = [...result].sort((a, b) => {
      const fa = a.fechaProgramada || '';
      const fb = b.fechaProgramada || '';
      return statusFilter === 'completed_by_user' ? fb.localeCompare(fa) : fa.localeCompare(fb);
    });
    return sorted;
  }, [ordenes, search, statusFilter]);

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
            placeholder="Buscar por lote, grupo, responsable, tipo..."
            value={search}
            maxLength={100}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="aur-table-result-count">
          {filtered.length} orden{filtered.length !== 1 ? 'es' : ''}
        </span>
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
                    <th>Fecha programada</th>
                    <th>Lote</th>
                    <th>Grupo</th>
                    <th>Responsable</th>
                    <th>Tipo de muestreo</th>
                    <th>Nota</th>
                    <th>Estado</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => (
                    <tr key={o.id}>
                      <td className="mo-td-date">{fmt(o.fechaProgramada)}</td>
                      <td>{o.loteNombre}</td>
                      <td>{o.grupoNombre}</td>
                      <td>{o.responsableNombre}</td>
                      <td>{o.tipoMuestreo}</td>
                      <td className="mo-td-nota">{o.nota || <span className="mo-empty-val">—</span>}</td>
                      <td>
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
