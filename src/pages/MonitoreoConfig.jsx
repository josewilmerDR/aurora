import { useState, useEffect } from 'react';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiToggleLeft, FiToggleRight } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Monitoreo.css';

const FIELD_TYPES = [
  { value: 'number',  label: 'Número' },
  { value: 'percent', label: 'Porcentaje (0–100)' },
  { value: 'text',    label: 'Texto' },
  { value: 'date',    label: 'Fecha' },
  { value: 'select',  label: 'Lista de opciones' },
];

const EMPTY_CAMPO = { key: '', label: '', type: 'number', opciones: '' };

function MonitoreoConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]         = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData]   = useState(null);
  const [showNew, setShowNew]     = useState(false);
  const [newTipo, setNewTipo]     = useState({ nombre: '', campos: [{ ...EMPTY_CAMPO }] });
  const [toast, setToast]         = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/monitoreo/tipos').then(r => r.json()).then(setTipos).catch(console.error);
  }, []);

  // ── Toggle activo ──────────────────────────────────────────────────────────
  const toggleActivo = async (tipo) => {
    try {
      await apiFetch(`/api/monitoreo/tipos/${tipo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !tipo.activo }),
      });
      setTipos(prev => prev.map(t => t.id === tipo.id ? { ...t, activo: !t.activo } : t));
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  // ── Editar tipo ────────────────────────────────────────────────────────────
  const startEdit = (tipo) => {
    setEditingId(tipo.id);
    setEditData({
      nombre: tipo.nombre,
      campos: tipo.campos.map(c => ({ ...c, opciones: Array.isArray(c.opciones) ? c.opciones.join(', ') : (c.opciones || '') })),
    });
  };

  const saveEdit = async () => {
    try {
      const campos = editData.campos.map(c => ({
        ...c,
        key: c.key || c.label.toLowerCase().replace(/\s+/g, '_'),
        opciones: c.type === 'select' ? c.opciones.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      }));
      await apiFetch(`/api/monitoreo/tipos/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: editData.nombre, campos }),
      });
      setTipos(prev => prev.map(t => t.id === editingId ? { ...t, nombre: editData.nombre, campos } : t));
      setEditingId(null);
      showToast('Tipo actualizado.');
    } catch {
      showToast('Error al guardar.', 'error');
    }
  };

  // ── Nuevo tipo ─────────────────────────────────────────────────────────────
  const saveNew = async () => {
    if (!newTipo.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    try {
      const campos = newTipo.campos.map(c => ({
        ...c,
        key: c.key || c.label.toLowerCase().replace(/\s+/g, '_'),
        opciones: c.type === 'select' ? c.opciones.split(',').map(s => s.trim()).filter(Boolean) : undefined,
      }));
      const res = await apiFetch('/api/monitoreo/tipos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: newTipo.nombre, campos }),
      });
      const { id } = await res.json();
      setTipos(prev => [...prev, { id, nombre: newTipo.nombre, campos, activo: true }]);
      setNewTipo({ nombre: '', campos: [{ ...EMPTY_CAMPO }] });
      setShowNew(false);
      showToast('Tipo de monitoreo creado.');
    } catch {
      showToast('Error al crear.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este tipo de monitoreo?')) return;
    try {
      await apiFetch(`/api/monitoreo/tipos/${id}`, { method: 'DELETE' });
      setTipos(prev => prev.filter(t => t.id !== id));
      showToast('Tipo eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // ── Campo editor helpers ───────────────────────────────────────────────────
  const CampoRow = ({ campo, idx, campos, setCampos }) => (
    <div className="campo-row">
      <input
        placeholder="Nombre del campo"
        value={campo.label}
        onChange={e => { const c = [...campos]; c[idx] = { ...c[idx], label: e.target.value }; setCampos(c); }}
      />
      <select
        value={campo.type}
        onChange={e => { const c = [...campos]; c[idx] = { ...c[idx], type: e.target.value }; setCampos(c); }}
      >
        {FIELD_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
      </select>
      {campo.type === 'select' && (
        <input
          placeholder="Opciones separadas por coma"
          value={campo.opciones}
          onChange={e => { const c = [...campos]; c[idx] = { ...c[idx], opciones: e.target.value }; setCampos(c); }}
        />
      )}
      <button type="button" className="btn-icon btn-danger" onClick={() => setCampos(campos.filter((_, i) => i !== idx))}>
        <FiTrash2 size={14} />
      </button>
    </div>
  );

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-toolbar">
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>
          <FiPlus size={16} /> Nuevo tipo
        </button>
      </div>

      {/* Formulario nuevo tipo */}
      {showNew && (
        <div className="form-card" style={{ marginBottom: '1rem' }}>
          <p className="form-section-title">Nuevo Tipo de Monitoreo</p>
          <div className="form-control">
            <label>Nombre</label>
            <input
              value={newTipo.nombre}
              onChange={e => setNewTipo(prev => ({ ...prev, nombre: e.target.value }))}
              placeholder="Ej: Muestreo de pH"
            />
          </div>
          <p className="form-section-title" style={{ marginTop: '0.75rem' }}>Campos</p>
          {newTipo.campos.map((c, i) => (
            <CampoRow
              key={i} campo={c} idx={i} campos={newTipo.campos}
              setCampos={campos => setNewTipo(prev => ({ ...prev, campos }))}
            />
          ))}
          <button
            type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }}
            onClick={() => setNewTipo(prev => ({ ...prev, campos: [...prev.campos, { ...EMPTY_CAMPO }] }))}
          >
            <FiPlus size={14} /> Agregar campo
          </button>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={saveNew}>Crear tipo</button>
            <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista de tipos */}
      <div className="items-list">
        {tipos.map(tipo => (
          <div key={tipo.id} className="item-card">
            <div className="item-card-header">
              {editingId === tipo.id ? (
                <input
                  className="tipo-nombre-input"
                  value={editData.nombre}
                  onChange={e => setEditData(prev => ({ ...prev, nombre: e.target.value }))}
                />
              ) : (
                <span className={`item-main-text${!tipo.activo ? ' tipo-inactivo' : ''}`}>
                  {tipo.nombre}
                  {!tipo.activo && <span className="label-optional"> (inactivo)</span>}
                </span>
              )}
              <div className="item-actions">
                {editingId === tipo.id ? (
                  <>
                    <button className="btn-icon btn-success" onClick={saveEdit} title="Guardar"><FiCheck size={16} /></button>
                    <button className="btn-icon" onClick={() => setEditingId(null)} title="Cancelar"><FiX size={16} /></button>
                  </>
                ) : (
                  <>
                    <button className="btn-icon" onClick={() => toggleActivo(tipo)} title={tipo.activo ? 'Desactivar' : 'Activar'}>
                      {tipo.activo ? <FiToggleRight size={18} style={{ color: 'var(--aurora-green)' }} /> : <FiToggleLeft size={18} />}
                    </button>
                    <button className="btn-icon" onClick={() => startEdit(tipo)} title="Editar"><FiEdit2 size={15} /></button>
                    <button className="btn-icon btn-danger" onClick={() => handleDelete(tipo.id)} title="Eliminar"><FiTrash2 size={15} /></button>
                  </>
                )}
              </div>
            </div>

            {editingId === tipo.id ? (
              <div className="tipo-campos-edit">
                {editData.campos.map((c, i) => (
                  <CampoRow
                    key={i} campo={c} idx={i} campos={editData.campos}
                    setCampos={campos => setEditData(prev => ({ ...prev, campos }))}
                  />
                ))}
                <button
                  type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }}
                  onClick={() => setEditData(prev => ({ ...prev, campos: [...prev.campos, { ...EMPTY_CAMPO }] }))}
                >
                  <FiPlus size={14} /> Agregar campo
                </button>
              </div>
            ) : (
              <div className="tipo-campos-preview">
                {tipo.campos?.map(c => (
                  <span key={c.key} className="campo-chip">{c.label}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MonitoreoConfig;
