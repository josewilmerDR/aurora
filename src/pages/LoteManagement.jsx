import { useState, useEffect, useCallback } from 'react';
import './LoteManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiCalendar, FiLayers, FiPackage, FiChevronRight } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';

// ── Siembras Tab ──────────────────────────────────────────────────────────────
function groupSiembrasByBloque(siembras) {
  const map = new Map();
  for (const r of siembras) {
    const key = r.bloque || '__sin_bloque__';
    if (!map.has(key)) {
      map.set(key, { bloque: r.bloque || '', plantas: 0, area: 0, cerrado: false, fechaMs: 0, responsableNombre: '', materiales: new Set() });
    }
    const g = map.get(key);
    g.plantas += r.plantas || 0;
    g.area += parseFloat(r.areaCalculada) || 0;
    if (r.cerrado) g.cerrado = true;
    const ms = new Date(r.fecha).getTime();
    if (ms > g.fechaMs) {
      g.fechaMs = ms;
      g.responsableNombre = r.responsableNombre || '';
    }
    if (r.materialNombre) {
      const mat = r.materialNombre + (r.variedad ? ` · ${r.variedad}` : '') + (r.rangoPesos ? ` (${r.rangoPesos})` : '');
      g.materiales.add(mat);
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.bloque === '') return 1;
    if (b.bloque === '') return -1;
    return a.bloque.localeCompare(b.bloque, 'es', { numeric: true });
  });
}

function SiembrasTab({ siembras, loading }) {
  if (loading) return <p className="hub-loading">Cargando siembras...</p>;

  if (siembras.length === 0) {
    return <p className="empty-state">No hay registros de siembra para este lote.</p>;
  }

  const grupos = groupSiembrasByBloque(siembras);
  const totalPlantas = grupos.reduce((s, g) => s + g.plantas, 0);
  const totalArea = grupos.reduce((s, g) => s + g.area, 0);

  return (
    <div className="hub-tab-content">
      <div className="siembra-stats">
        <div className="siembra-stat">
          <span className="stat-value">{totalPlantas.toLocaleString('es-ES')}</span>
          <span className="stat-label">Plantas totales</span>
        </div>
        <div className="siembra-stat">
          <span className="stat-value">{totalArea.toFixed(2)} ha</span>
          <span className="stat-label">Área calculada</span>
        </div>
        <div className="siembra-stat">
          <span className="stat-value">{grupos.filter(g => g.bloque).length || '—'}</span>
          <span className="stat-label">Bloques</span>
        </div>
        <div className="siembra-stat">
          <span className="stat-value">{Math.round(totalPlantas * 1.6 * 0.9).toLocaleString('es-ES')}</span>
          <span className="stat-label">Kg esperados (1ª)</span>
        </div>
      </div>

      <div className="siembra-records">
        {grupos.map((g, i) => (
          <div key={i} className={`siembra-record ${g.cerrado ? 'cerrado' : ''}`}>
            <div className="siembra-record-main">
              <div className="siembra-record-title">
                <span className="siembra-bloque">{g.bloque ? `Bloque ${g.bloque}` : 'Sin bloque'}</span>
                {g.cerrado && <span className="siembra-badge-cerrado">Cerrado</span>}
              </div>
              <div className="siembra-record-meta">
                <FiCalendar size={12} />
                {new Date(g.fechaMs).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                {g.responsableNombre && <> · {g.responsableNombre}</>}
              </div>
            </div>
            <div className="siembra-record-data">
              <div className="siembra-data-item">
                <span className="data-label">Plantas</span>
                <span className="data-value">{g.plantas.toLocaleString('es-ES')}</span>
              </div>
              <div className="siembra-data-item">
                <span className="data-label">Área</span>
                <span className="data-value">{g.area.toFixed(2)} ha</span>
              </div>
              {g.materiales.size > 0 && (
                <div className="siembra-data-item siembra-data-material">
                  <span className="data-label">Material</span>
                  <span className="data-value">{[...g.materiales].join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
function LoteManagement() {
  const apiFetch = useApiFetch();
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [selectedLote, setSelectedLote] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({
    id: null, codigoLote: '', nombreLote: '', fechaCreacion: '', paqueteId: '', hectareas: ''
  });
  const [siembras, setSiembras] = useState([]);
  const [loadingSiembras, setLoadingSiembras] = useState(false);
  const [activeTab, setActiveTab] = useState('siembras');

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchLotes = useCallback(() => {
    return apiFetch('/api/lotes').then(res => res.json()).then(data => {
      setLotes(data);
      return data;
    }).catch(console.error);
  }, [apiFetch]);

  const fetchPackages = useCallback(() => {
    apiFetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error);
  }, [apiFetch]);

  useEffect(() => { fetchLotes(); fetchPackages(); }, []);

  useEffect(() => {
    if (!selectedLote) { setSiembras([]); return; }
    setLoadingSiembras(true);
    apiFetch(`/api/siembras?loteId=${selectedLote.id}`)
      .then(res => res.json())
      .then(data => { setSiembras(data); setLoadingSiembras(false); })
      .catch(() => setLoadingSiembras(false));
  }, [selectedLote]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const formatDateForInput = (timestamp) => {
    const date = new Date(timestamp._seconds * 1000);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const d = timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp);
    return d.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setIsEditing(false);
    setFormData({ id: null, codigoLote: '', nombreLote: '', fechaCreacion: '', paqueteId: '', hectareas: '' });
    setView('hub');
  };

  const handleSelectLote = (lote) => {
    setSelectedLote(lote);
    setView('hub');
    setActiveTab('siembras');
  };

  const handleNewLote = () => {
    setIsEditing(false);
    setFormData({ id: null, codigoLote: '', nombreLote: '', fechaCreacion: '', paqueteId: '', hectareas: '' });
    setView('form');
    setSelectedLote(null);
  };

  const handleEdit = (lote) => {
    setIsEditing(true);
    setFormData({
      id: lote.id,
      codigoLote: lote.codigoLote || '',
      nombreLote: lote.nombreLote || '',
      fechaCreacion: formatDateForInput(lote.fechaCreacion),
      paqueteId: lote.paqueteId || '',
      hectareas: lote.hectareas || ''
    });
    setView('form');
  };

  const handleDeleteClick = async (lote) => {
    try {
      const res = await apiFetch(`/api/lotes/${lote.id}/task-count`);
      const { count } = await res.json();
      setConfirmModal({ loteId: lote.id, loteName: lote.nombreLote || lote.codigoLote, taskCount: count });
    } catch {
      showToast('Error al verificar las tareas del lote.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/lotes/${confirmModal.loteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      if (selectedLote?.id === confirmModal.loteId) setSelectedLote(null);
      setConfirmModal(null);
      fetchLotes();
      showToast('Lote eliminado correctamente');
    } catch {
      showToast('Error al eliminar el lote.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/lotes/${formData.id}` : '/api/lotes';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Error al guardar el lote');
      const saved = await res.json();
      const newLotes = await fetchLotes();
      const savedId = isEditing ? formData.id : saved.id;
      if (savedId && newLotes) {
        const found = newLotes.find(l => l.id === savedId);
        if (found) setSelectedLote(found);
      }
      resetForm();
      showToast(isEditing ? 'Lote actualizado correctamente' : 'Lote creado y tareas programadas');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // ── Hub panel ─────────────────────────────────────────────────────────────
  const pkg = selectedLote ? packages.find(p => p.id === selectedLote.paqueteId) : null;

  const renderRightPanel = () => {
    if (view === 'form') {
      return (
        <div className="form-card">
          <h2>{isEditing ? 'Editando Lote' : 'Crear Nuevo Lote'}</h2>
          <form onSubmit={handleSubmit} className="lote-form">
            <div className="form-grid">
              <div className="form-control">
                <label htmlFor="codigoLote">Código del Lote</label>
                <input id="codigoLote" name="codigoLote" value={formData.codigoLote} onChange={handleInputChange} placeholder="Ej: L2604" required />
              </div>
              <div className="form-control">
                <label htmlFor="nombreLote">Nombre amigable <span style={{ fontWeight: 400, opacity: 0.7 }}>(opcional)</span></label>
                <input id="nombreLote" name="nombreLote" value={formData.nombreLote} onChange={handleInputChange} placeholder="Ej: 4, Lote de Aurora" />
              </div>
              <div className="form-control">
                <label htmlFor="fechaCreacion">Fecha de Creación</label>
                <input id="fechaCreacion" name="fechaCreacion" value={formData.fechaCreacion} onChange={handleInputChange} type="date" required />
              </div>
              <div className="form-control">
                <label htmlFor="paqueteId">Paquete de Tareas</label>
                <select id="paqueteId" name="paqueteId" value={formData.paqueteId} onChange={handleInputChange}>
                  <option value="">-- Seleccionar Paquete --</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.nombrePaquete}</option>)}
                </select>
              </div>
              <div className="form-control">
                <label htmlFor="hectareas">Hectáreas</label>
                <input id="hectareas" name="hectareas" type="number" step="0.01" min="0.01" value={formData.hectareas} onChange={handleInputChange} placeholder="Ej: 2.5" />
              </div>
            </div>

            {formData.paqueteId && (() => {
              const p = packages.find(pk => pk.id === formData.paqueteId);
              if (!p) return null;
              const sorted = [...p.activities].sort((a, b) => Number(a.day) - Number(b.day));
              return (
                <div className="package-preview">
                  <div className="package-preview-header">
                    <span className="package-preview-title">{p.activities.length} actividad(es) a programar</span>
                    <span className="package-preview-meta">{p.tipoCosecha} · {p.etapaCultivo}</span>
                  </div>
                  <ul className="package-preview-list">
                    {sorted.map((act, i) => {
                      let dateStr = null;
                      if (formData.fechaCreacion) {
                        const base = new Date(formData.fechaCreacion + 'T00:00:00Z');
                        const d = new Date(base.getTime() + Number(act.day) * 86400000);
                        dateStr = d.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short' });
                      }
                      return (
                        <li key={i} className="package-preview-item">
                          <span className="preview-day">Día {act.day}</span>
                          <span className="preview-name">{act.name}</span>
                          {dateStr && <span className="preview-date">{dateStr}</span>}
                          <span className={`preview-type-badge preview-badge-${act.type || 'notificacion'}`}>
                            {act.type === 'aplicacion' ? 'Aplicación' : 'Notificación'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <FiPlus />
                {isEditing ? 'Actualizar Lote' : 'Crear y Programar'}
              </button>
              <button type="button" onClick={resetForm} className="btn btn-secondary">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (!selectedLote) {
      return (
        <div className="lote-hub lote-hub-empty">
          <FiChevronRight size={32} opacity={0.3} />
          <p>Selecciona un lote para ver su bitácora</p>
        </div>
      );
    }

    return (
      <div className="lote-hub">
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedLote.codigoLote}</h2>
            {selectedLote.nombreLote && selectedLote.nombreLote !== selectedLote.codigoLote && (
              <span className="hub-lote-name">{selectedLote.nombreLote}</span>
            )}
          </div>
          <div className="hub-header-actions">
            <button onClick={() => handleEdit(selectedLote)} className="icon-btn" title="Editar lote">
              <FiEdit size={16} />
            </button>
            <button onClick={() => handleDeleteClick(selectedLote)} className="icon-btn delete" title="Eliminar lote">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          <span className="hub-pill">
            <FiCalendar size={13} />
            Siembra: {formatDate(selectedLote.fechaCreacion)}
          </span>
          {selectedLote.hectareas && (
            <span className="hub-pill">
              <FiLayers size={13} />
              {selectedLote.hectareas} ha
            </span>
          )}
          {pkg && (
            <span className="hub-pill">
              <FiPackage size={13} />
              {pkg.nombrePaquete}
            </span>
          )}
          {!selectedLote.paqueteId && (
            <span className="hub-pill hub-pill-muted">Sin paquete técnico</span>
          )}
        </div>

        <div className="hub-tabs">
          <button
            className={`hub-tab ${activeTab === 'siembras' ? 'active' : ''}`}
            onClick={() => setActiveTab('siembras')}
          >
            Siembras
          </button>
        </div>

        {activeTab === 'siembras' && (
          <SiembrasTab siembras={siembras} loading={loadingSiembras} />
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && (
        <ConfirmModal
          title={`¿Eliminar "${confirmModal.loteName}"?`}
          message={
            confirmModal.taskCount > 0
              ? `Esta acción eliminará permanentemente el lote y sus ${confirmModal.taskCount} tarea(s) programada(s). No se puede deshacer.`
              : 'Este lote no tiene tareas asociadas. Solo se eliminará el registro del lote. No se puede deshacer.'
          }
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {/* ── Left: form or hub ── */}
      {renderRightPanel()}

      {/* ── Right: lote list ── */}
      <div className="lote-list-panel">
        <button onClick={handleNewLote} className="btn btn-primary btn-full">
          <FiPlus /> Crear nuevo lote
        </button>
        {lotes.length === 0
          ? <p className="empty-state" style={{ marginTop: '1rem' }}>No hay lotes creados.</p>
          : (
            <ul className="lote-list">
              {lotes.map(lote => (
                <li
                  key={lote.id}
                  className={`lote-list-item ${selectedLote?.id === lote.id && view === 'hub' ? 'active' : ''}`}
                  onClick={() => handleSelectLote(lote)}
                >
                  <div className="lote-list-info">
                    <span className="lote-list-code">{lote.codigoLote}</span>
                    {lote.nombreLote && lote.nombreLote !== lote.codigoLote && (
                      <span className="lote-list-name">{lote.nombreLote}</span>
                    )}
                    <span className="lote-list-date">
                      {new Date(lote.fechaCreacion._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              ))}
            </ul>
          )
        }
      </div>
    </div>
  );
}

export default LoteManagement;
