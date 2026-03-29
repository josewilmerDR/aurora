import { useState, useEffect, useCallback, useRef } from 'react';
import './LoteManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiCalendar, FiLayers, FiPackage, FiChevronRight } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';

// ── Detalles Tab ──────────────────────────────────────────────────────────────
function DetallesTab({ siembras, grupos, loading }) {
  if (loading) return <p className="hub-loading">Cargando detalles...</p>;
  if (siembras.length === 0) return <p className="empty-state">No hay registros de siembra para este lote.</p>;

  // Agrega datos por etiqueta de bloque
  const bloqueData = new Map();
  for (const s of siembras) {
    const key = s.bloque || 'Sin bloque';
    if (!bloqueData.has(key)) bloqueData.set(key, { plantas: 0, area: 0, materiales: new Set(), cerrado: false });
    const d = bloqueData.get(key);
    d.plantas += s.plantas || 0;
    d.area    += parseFloat(s.areaCalculada) || 0;
    if (s.materialNombre) {
      const mat = s.materialNombre + (s.variedad ? ` · ${s.variedad}` : '') + (s.rangoPesos ? ` (${s.rangoPesos})` : '');
      d.materiales.add(mat);
    }
    if (s.cerrado) d.cerrado = true;
  }

  const siembraById = new Map(siembras.map(s => [s.id, s.bloque || 'Sin bloque']));
  const siembraIds  = new Set(siembras.map(s => s.id));

  const assignedIds = new Set();
  const gruposConBloques = [];
  for (const g of [...grupos].sort((a, b) => a.nombreGrupo.localeCompare(b.nombreGrupo, 'es', { numeric: true }))) {
    const bloques = [...new Set(
      (g.bloques || []).filter(id => siembraIds.has(id)).map(id => siembraById.get(id))
    )].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    if (!bloques.length) continue;
    (g.bloques || []).filter(id => siembraIds.has(id)).forEach(id => assignedIds.add(id));
    gruposConBloques.push({ id: g.id, nombre: g.nombreGrupo, bloques });
  }

  const sinGrupo = [...new Set(
    siembras.filter(s => !assignedIds.has(s.id)).map(s => s.bloque || 'Sin bloque')
  )].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));

  const BloqueItem = ({ label }) => {
    const d = bloqueData.get(label) || { plantas: 0, area: 0, materiales: new Set(), cerrado: false };
    return (
      <li className={`detalles-bloque${d.cerrado ? ' detalles-bloque--cerrado' : ''}`}>
        <div className="detalles-bloque-header">
          <span className="detalles-bloque-nombre">{label}</span>
          {d.cerrado && <span className="detalles-bloque-badge">Cerrado</span>}
        </div>
        <div className="detalles-bloque-info">
          {d.plantas > 0 && <span>{d.plantas.toLocaleString('es-ES')} plantas</span>}
          {d.area > 0 && <span>{d.area.toFixed(2)} ha</span>}
          {d.materiales.size > 0 && <span>{[...d.materiales].join(' / ')}</span>}
        </div>
      </li>
    );
  };

  return (
    <div className="hub-tab-content">
      {gruposConBloques.map(g => (
        <div key={g.id} className="detalles-grupo">
          <span className="detalles-grupo-nombre">{g.nombre}</span>
          <ul className="detalles-bloques">
            {g.bloques.map(b => <BloqueItem key={b} label={b} />)}
          </ul>
        </div>
      ))}
      {sinGrupo.length > 0 && (
        <div className="detalles-grupo detalles-grupo--sin-grupo">
          <span className="detalles-grupo-nombre">Sin grupo</span>
          <ul className="detalles-bloques">
            {sinGrupo.map(b => <BloqueItem key={b} label={b} />)}
          </ul>
        </div>
      )}
      {gruposConBloques.length === 0 && sinGrupo.length === 0 && (
        <p className="empty-state">No hay grupos ni bloques asignados a este lote.</p>
      )}
    </div>
  );
}

// ── Draft persistence ─────────────────────────────────────────────────────────
const DRAFT_LS = 'aurora_draft_lote-nuevo';
const DRAFT_SS = 'aurora_draftActive_lote-nuevo';
const EMPTY_FORM = { id: null, codigoLote: '', nombreLote: '', fechaCreacion: '' };

function loadLoteDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_LS)); } catch { return null; } }
function saveLoteDraft(data) {
  try {
    localStorage.setItem(DRAFT_LS, JSON.stringify(data));
    sessionStorage.setItem(DRAFT_SS, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function clearLoteDraft() {
  try {
    localStorage.removeItem(DRAFT_LS);
    sessionStorage.removeItem(DRAFT_SS);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function isLoteDraftMeaningful(d) { return d && (d.codigoLote || d.nombreLote || d.fechaCreacion); }

// ── Main Component ────────────────────────────────────────────────────────────
function LoteManagement() {
  const apiFetch = useApiFetch();
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [selectedLote, setSelectedLote] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [siembras, setSiembras] = useState([]);
  const [loadingSiembras, setLoadingSiembras] = useState(false);
  const [activeTab, setActiveTab] = useState('siembras');
  const carouselRef = useRef(null);

  // Centra la burbuja activa en el carousel cuando cambia el lote seleccionado
  useEffect(() => {
    if (!selectedLote || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedLote]);

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

  useEffect(() => {
    fetchLotes();
    fetchPackages();
    apiFetch('/api/grupos').then(res => res.json()).then(setGrupos).catch(console.error);
  }, []);

  // Restaura borrador al montar (sobrevive navegación y cierre de pestaña)
  useEffect(() => {
    const draft = loadLoteDraft();
    if (!isLoteDraftMeaningful(draft)) return;
    setFormData({ ...EMPTY_FORM, codigoLote: draft.codigoLote || '', nombreLote: draft.nombreLote || '', fechaCreacion: draft.fechaCreacion || '' });
    setView('form');
    setIsEditing(false);
    try { sessionStorage.setItem(DRAFT_SS, '1'); window.dispatchEvent(new CustomEvent('aurora-draft-change')); } catch {}
  }, []);

  // Guarda borrador en cada cambio del formulario de creación
  useEffect(() => {
    if (isEditing || view !== 'form') return;
    const { codigoLote, nombreLote, fechaCreacion } = formData;
    if (codigoLote || nombreLote || fechaCreacion) {
      saveLoteDraft({ codigoLote, nombreLote, fechaCreacion });
    } else {
      clearLoteDraft();
    }
  }, [formData, isEditing, view]);

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
    if (!isEditing) clearLoteDraft();
    setIsEditing(false);
    setFormData(EMPTY_FORM);
    setView('hub');
  };

  const handleSelectLote = (lote) => {
    setSelectedLote(lote);
    setView('hub');
    setActiveTab('siembras');
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNewLote = () => {
    const draft = loadLoteDraft();
    setIsEditing(false);
    setFormData(isLoteDraftMeaningful(draft)
      ? { ...EMPTY_FORM, codigoLote: draft.codigoLote || '', nombreLote: draft.nombreLote || '', fechaCreacion: draft.fechaCreacion || '' }
      : EMPTY_FORM
    );
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
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                <FiPlus />
                {isEditing ? 'Actualizar Lote' : 'Crear Lote'}
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
      return null;
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
            Detalles del lote
          </button>
        </div>

        {activeTab === 'siembras' && (
          <DetallesTab siembras={siembras} grupos={grupos} loading={loadingSiembras} />
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`lote-page${selectedLote && view === 'hub' ? ' lote-page--selected' : ''}`}>
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

      {/* ── Mobile sticky carousel ── */}
      {selectedLote && view === 'hub' && (
        <div className="lote-carousel" ref={carouselRef}>
          {lotes.map(lote => (
            <button
              key={lote.id}
              className={`lote-bubble${selectedLote?.id === lote.id ? ' lote-bubble--active' : ''}`}
              onClick={() => handleSelectLote(lote)}
            >
              <span className="lote-bubble-avatar">{lote.codigoLote.slice(0, 4)}</span>
              <span className="lote-bubble-label">
                {lote.nombreLote && lote.nombreLote !== lote.codigoLote ? lote.nombreLote : lote.codigoLote}
              </span>
            </button>
          ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNewLote}>
            <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      {view !== 'form' && (
        <div className="lote-page-header">
          <button onClick={handleNewLote} className="btn btn-primary">
            <FiPlus /> Crear nuevo lote
          </button>
        </div>
      )}

      <div className="lote-management-layout">
        {/* ── Left: form or hub ── */}
        {renderRightPanel()}

        {/* ── Right: lote list ── */}
        <div className="lote-list-panel">
          <h3 className="lote-list-title">Lotes Activos</h3>

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
    </div>
  );
}

export default LoteManagement;
