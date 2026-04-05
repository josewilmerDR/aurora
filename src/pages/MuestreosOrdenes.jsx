import { useState, useEffect, useMemo } from 'react';
import { FiTrash2, FiSearch, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import FormularioMuestreoModal from './FormularioMuestreoModal';
import './MuestreosOrdenes.css';

const fmt = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

const STATUS_LABEL = { pending: 'Pendiente', completed_by_user: 'Completado', skipped: 'Omitido' };
const STATUS_CLASS = { pending: 'badge-yellow', completed_by_user: 'badge-green', skipped: 'badge-gray' };

export default function MuestreosOrdenes() {
  const apiFetch = useApiFetch();
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [deleting, setDeleting] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [modalOrden, setModalOrden] = useState(null);

  useEffect(() => {
    apiFetch('/api/muestreos/ordenes')
      .then(r => r.json())
      .then(data => { setOrdenes(data); setLoading(false); })
      .catch(() => { setError('No se pudieron cargar las órdenes de muestreo.'); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordenes;
    return ordenes.filter(o =>
      o.grupoNombre?.toLowerCase().includes(q) ||
      o.loteNombre?.toLowerCase().includes(q) ||
      o.responsableNombre?.toLowerCase().includes(q) ||
      o.tipoMuestreo?.toLowerCase().includes(q) ||
      o.nota?.toLowerCase().includes(q)
    );
  }, [ordenes, search]);

  const handleComplete = async (id, formularioData = null, metadata = {}) => {
    await apiFetch(`/api/muestreos/ordenes/${id}/complete`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formularioData, ...metadata }),
    });
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
    <div className="mo-wrap">
      <div className="mo-toolbar">
        <div className="mo-search-wrap">
          <FiSearch size={15} className="mo-search-icon" />
          <input
            className="mo-search"
            type="text"
            placeholder="Buscar por lote, grupo, responsable, tipo..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <span className="mo-count">{filtered.length} orden{filtered.length !== 1 ? 'es' : ''}</span>
      </div>

      {loading && <div className="mo-state">Cargando órdenes...</div>}
      {error   && (
        <div className="mo-state mo-state--error">
          <FiAlertCircle size={18} /> {error}
        </div>
      )}

      {modalOrden && (
        <FormularioMuestreoModal
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
              {search ? 'Sin resultados para la búsqueda.' : 'No hay órdenes de muestreo programadas.'}
            </div>
          ) : (
            <div className="mo-table-wrap">
              <table className="mo-table">
                <thead>
                  <tr>
                    <th>Fecha programada</th>
                    <th>Lote</th>
                    <th>Grupo</th>
                    <th>Responsable</th>
                    <th>Tipo de muestreo</th>
                    <th>Nota</th>
                    <th>Estado</th>
                    <th></th>
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
                        <span className={`badge ${STATUS_CLASS[o.status] || 'badge-gray'}`}>
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                      </td>
                      <td className="mo-td-action">
                        {confirmId === o.id ? (
                          <div className="mo-confirm">
                            <span>¿Eliminar?</span>
                            <button
                              className="mo-confirm-yes"
                              onClick={() => handleDelete(o.id)}
                              disabled={deleting === o.id}
                            >
                              {deleting === o.id ? '...' : 'Sí'}
                            </button>
                            <button className="mo-confirm-no" onClick={() => setConfirmId(null)}>No</button>
                          </div>
                        ) : (
                          <div className="mo-actions">
                            {o.status === 'pending' && (
                              <button
                                className="mo-complete-btn"
                                title="Registrar resultado y marcar como hecha"
                                onClick={() => setModalOrden(o)}
                              >
                                <FiCheckCircle size={15} />
                                Hecha
                              </button>
                            )}
                            <button
                              className="mo-delete-btn"
                              title="Eliminar orden"
                              onClick={() => setConfirmId(o.id)}
                            >
                              <FiTrash2 size={15} />
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
    </div>
  );
}
