import { useState, useEffect } from 'react';
import { FiTrash2, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import Toast from '../components/Toast';
import './Monitoreo.css';

function MonitoreoHistorial() {
  const [registros, setRegistros] = useState([]);
  const [lotes, setLotes]         = useState([]);
  const [tipos, setTipos]         = useState([]);
  const [filtros, setFiltros]     = useState({ loteId: '', tipoId: '', desde: '', hasta: '' });
  const [expanded, setExpanded]   = useState(null);
  const [loading, setLoading]     = useState(false);
  const [toast, setToast]         = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    fetch('/api/monitoreo/tipos').then(r => r.json()).then(setTipos).catch(console.error);
    cargar({});
  }, []);

  const cargar = async (f = filtros) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.loteId) params.set('loteId', f.loteId);
      if (f.tipoId) params.set('tipoId', f.tipoId);
      if (f.desde)  params.set('desde',  f.desde);
      if (f.hasta)  params.set('hasta',  f.hasta);
      const data = await fetch(`/api/monitoreo?${params}`).then(r => r.json());
      setRegistros(Array.isArray(data) ? data : []);
    } catch {
      showToast('Error al cargar registros.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFiltro = (e) => {
    const next = { ...filtros, [e.target.name]: e.target.value };
    setFiltros(next);
  };

  const handleBuscar = (e) => {
    e.preventDefault();
    cargar(filtros);
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este registro de monitoreo?')) return;
    try {
      await fetch(`/api/monitoreo/${id}`, { method: 'DELETE' });
      setRegistros(prev => prev.filter(r => r.id !== id));
      showToast('Registro eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const formatFecha = (iso) => new Date(iso).toLocaleDateString('es-CR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const renderDatos = (datos) => {
    if (!datos || Object.keys(datos).length === 0) return <span className="label-optional">Sin datos registrados</span>;
    return (
      <div className="monitoreo-datos-grid">
        {Object.entries(datos).map(([k, v]) => (
          <div key={k} className="monitoreo-dato-item">
            <span className="monitoreo-dato-key">{k.replace(/_/g, ' ')}</span>
            <span className="monitoreo-dato-val">{v}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Filtros */}
      <div className="form-card" style={{ marginBottom: '1rem' }}>
        <form onSubmit={handleBuscar} className="monitoreo-filtros">
          <div className="form-control">
            <label>Lote</label>
            <select name="loteId" value={filtros.loteId} onChange={handleFiltro}>
              <option value="">Todos</option>
              {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label>Tipo</label>
            <select name="tipoId" value={filtros.tipoId} onChange={handleFiltro}>
              <option value="">Todos</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label>Desde</label>
            <input type="date" name="desde" value={filtros.desde} onChange={handleFiltro} />
          </div>
          <div className="form-control">
            <label>Hasta</label>
            <input type="date" name="hasta" value={filtros.hasta} onChange={handleFiltro} />
          </div>
          <div className="form-control form-control-btn">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
        </form>
      </div>

      {/* Listado */}
      <div className="items-list">
        {registros.length === 0 && !loading && (
          <p className="empty-state">No hay registros de monitoreo para los filtros seleccionados.</p>
        )}

        {registros.map(r => {
          const isOpen = expanded === r.id;
          return (
            <div key={r.id} className="item-card">
              <div
                className="item-card-header monitoreo-row"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="monitoreo-row-main">
                  <span className="monitoreo-tipo-badge">{r.tipoNombre || r.tipoId}</span>
                  <span className="item-main-text">{r.loteNombre || r.loteId}</span>
                  {r.bloque && <span className="label-optional">· {r.bloque}</span>}
                </div>
                <div className="monitoreo-row-meta">
                  <span className="label-optional">{formatFecha(r.fecha)}</span>
                  <span className="label-optional">{r.responsableNombre}</span>
                  {isOpen ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                </div>
              </div>

              {isOpen && (
                <div className="monitoreo-detalle">
                  {renderDatos(r.datos)}
                  {r.observaciones && (
                    <p className="monitoreo-obs"><strong>Observaciones:</strong> {r.observaciones}</p>
                  )}
                  <div className="monitoreo-detalle-actions">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(r.id)}
                    >
                      <FiTrash2 size={14} /> Eliminar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MonitoreoHistorial;
