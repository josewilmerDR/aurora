import { useState, useEffect, useMemo } from 'react';
import './GrupoManagement.css';
import { FiEdit, FiTrash2, FiPlus } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';

function GrupoManagement() {
  const [grupos, setGrupos] = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [packages, setPackages] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [formData, setFormData] = useState({
    id: null,
    nombreGrupo: '',
    cosecha: '',
    etapa: '',
    fechaCreacion: '',
    bloques: [],   // array of siembraId strings
    paqueteId: '',
  });

  const fetchAll = () => {
    fetch('/api/grupos').then(r => r.json()).then(setGrupos).catch(console.error);
    fetch('/api/siembras').then(r => r.json()).then(data => setSiembras(Array.isArray(data) ? data : [])).catch(console.error);
    fetch('/api/packages').then(r => r.json()).then(setPackages).catch(console.error);
  };

  useEffect(() => { fetchAll(); }, []);

  // Only cerrado siembras are eligible for groups
  const cerradoSiembras = useMemo(() => siembras.filter(s => s.cerrado), [siembras]);

  // Grouped by loteNombre for display
  const byLote = useMemo(() =>
    cerradoSiembras.reduce((acc, s) => {
      const key = s.loteNombre || s.loteId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    }, {}),
  [cerradoSiembras]);

  // Derived unique cosecha/etapa options from packages
  const cosechas = useMemo(() => [...new Set(packages.map(p => p.tipoCosecha).filter(Boolean))], [packages]);
  const etapas = useMemo(() => [...new Set(
    packages
      .filter(p => !formData.cosecha || p.tipoCosecha === formData.cosecha)
      .map(p => p.etapaCultivo)
      .filter(Boolean)
  )], [packages, formData.cosecha]);

  const filteredPackages = useMemo(() =>
    packages.filter(p =>
      (!formData.cosecha || p.tipoCosecha === formData.cosecha) &&
      (!formData.etapa || p.etapaCultivo === formData.etapa)
    ),
  [packages, formData.cosecha, formData.etapa]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'cosecha') { next.etapa = ''; next.paqueteId = ''; }
      if (name === 'etapa') { next.paqueteId = ''; }
      return next;
    });
  };

  const toggleBloque = (siembraId) => {
    setFormData(prev => ({
      ...prev,
      bloques: prev.bloques.includes(siembraId)
        ? prev.bloques.filter(id => id !== siembraId)
        : [...prev.bloques, siembraId],
    }));
  };

  const resetForm = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '' });
  };

  const formatDateForInput = (timestamp) => {
    const date = new Date(timestamp._seconds * 1000);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const handleEdit = (grupo) => {
    setIsEditing(true);
    setFormData({
      id: grupo.id,
      nombreGrupo: grupo.nombreGrupo || '',
      cosecha: grupo.cosecha || '',
      etapa: grupo.etapa || '',
      fechaCreacion: grupo.fechaCreacion ? formatDateForInput(grupo.fechaCreacion) : '',
      bloques: Array.isArray(grupo.bloques) ? grupo.bloques : [],
      paqueteId: grupo.paqueteId || '',
    });
    window.scrollTo(0, 0);
  };

  const handleDeleteClick = (grupo) => {
    setConfirmModal({ grupoId: grupo.id, grupoName: grupo.nombreGrupo });
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/grupos/${confirmModal.grupoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmModal(null);
      fetchAll();
      showToast('Grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.bloques.length === 0) {
      showToast('Selecciona al menos un bloque.', 'error');
      return;
    }
    const url = isEditing ? `/api/grupos/${formData.id}` : '/api/grupos';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error();
      fetchAll();
      resetForm();
      showToast(isEditing ? 'Grupo actualizado correctamente' : 'Grupo creado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // For list display: resolve siembra info from loaded records
  const getBloquesSummary = (bloqueIds) => {
    if (!bloqueIds?.length) return '—';
    return bloqueIds.map(id => {
      const s = siembras.find(s => s.id === id);
      return s ? `${s.loteNombre} · Bloque ${s.bloque}` : id;
    }).join(', ');
  };

  const getPackageName = (id) => packages.find(p => p.id === id)?.nombrePaquete || '—';

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && (
        <ConfirmModal
          title={`¿Eliminar "${confirmModal.grupoName}"?`}
          message="Esta acción eliminará permanentemente el grupo. No se puede deshacer."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {/* FORMULARIO */}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Grupo' : 'Crear Nuevo Grupo'}</h2>
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombreGrupo">Nombre de Grupo</label>
              <input id="nombreGrupo" name="nombreGrupo" value={formData.nombreGrupo} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="fechaCreacion">Fecha de Creación</label>
              <input id="fechaCreacion" name="fechaCreacion" type="date" value={formData.fechaCreacion} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="cosecha">Cosecha</label>
              <select id="cosecha" name="cosecha" value={formData.cosecha} onChange={handleInputChange}>
                <option value="">-- Seleccionar Cosecha --</option>
                {cosechas.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="etapa">Etapa</label>
              <select id="etapa" name="etapa" value={formData.etapa} onChange={handleInputChange}>
                <option value="">-- Seleccionar Etapa --</option>
                {etapas.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="form-control" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="paqueteId">Paquete de Aplicaciones</label>
              <select
                id="paqueteId"
                name="paqueteId"
                value={formData.paqueteId}
                onChange={handleInputChange}
                disabled={filteredPackages.length === 0}
              >
                <option value="">
                  {filteredPackages.length === 0
                    ? '-- Sin paquetes para esta cosecha/etapa --'
                    : '-- Seleccionar Paquete --'}
                </option>
                {filteredPackages.map(p => (
                  <option key={p.id} value={p.id}>{p.nombrePaquete}</option>
                ))}
              </select>
            </div>
          </div>

          {/* BLOQUES — seleccionados de siembras cerradas */}
          <div className="bloques-section">
            <div className="bloques-header">
              <span className="bloques-title">Bloques</span>
              <span className="bloques-count">
                {formData.bloques.length} seleccionado(s)
              </span>
            </div>

            {Object.keys(byLote).length === 0 ? (
              <p className="bloques-empty">
                No hay bloques cerrados disponibles. Cierra bloques desde el Historial de Siembra.
              </p>
            ) : (
              Object.entries(byLote).map(([loteNombre, registros]) => (
                <div key={loteNombre} className="bloque-lote-group">
                  <div className="bloque-lote-label">{loteNombre}</div>
                  {registros.map(s => (
                    <label key={s.id} className={`bloque-checkbox-row${formData.bloques.includes(s.id) ? ' checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={formData.bloques.includes(s.id)}
                        onChange={() => toggleBloque(s.id)}
                      />
                      <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                      <span className="bloque-meta">
                        {s.plantas?.toLocaleString()} plantas
                        {s.areaCalculada ? ` · ${s.areaCalculada} ha` : ''}
                        {s.variedad ? ` · ${s.variedad}` : ''}
                      </span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiPlus />
              {isEditing ? 'Actualizar Grupo' : 'Crear Grupo'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
            )}
          </div>
        </form>
      </div>

      {/* LISTA */}
      <div className="list-card">
        <h2>Grupos Existentes</h2>
        <ul className="info-list">
          {grupos.map(grupo => (
            <li key={grupo.id}>
              <div>
                <div className="item-main-text">{grupo.nombreGrupo}</div>
                <div className="item-sub-text">
                  {[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}
                  {grupo.bloques?.length ? ` · ${grupo.bloques.length} bloque(s)` : ''}
                </div>
                {grupo.paqueteId && (
                  <div className="item-sub-text">{getPackageName(grupo.paqueteId)}</div>
                )}
              </div>
              <div className="lote-actions">
                <button onClick={() => handleEdit(grupo)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDeleteClick(grupo)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {grupos.length === 0 && <p className="empty-state">No hay grupos creados.</p>}
      </div>
    </div>
  );
}

export default GrupoManagement;
