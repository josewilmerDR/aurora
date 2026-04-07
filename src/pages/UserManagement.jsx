import { useState, useEffect, useRef } from 'react';
import './UserManagement.css';
import { FiEdit, FiTrash2, FiUserPlus, FiChevronRight, FiArrowLeft, FiMail, FiPhone } from 'react-icons/fi';
import { ROLE_LABELS } from '../contexts/UserContext';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../hooks/useDraft';

const DRAFT_KEY = 'aurora_user_mgmt_draft';
const EMPTY_FORM = { id: null, nombre: '', email: '', telefono: '', rol: 'trabajador' };

const getInitials = (nombre) => {
  if (!nombre) return '?';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

function UserManagement() {
  const apiFetch = useApiFetch();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [toast, setToast] = useState(null);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Auto-scroll active bubble into view on mobile
  useEffect(() => {
    if (!selectedUser || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedUser]);

  const fetchUsers = () =>
    apiFetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error).finally(() => setLoading(false));

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    clearDraftActive('user-mgmt');
  };

  // Restaurar borrador al montar
  useEffect(() => {
    fetchUsers();
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setFormData(draft.formData);
      setView('form');
      setIsEditing(false);
    } catch { clearDraft(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar borrador solo al crear (no al editar)
  useEffect(() => {
    if (view !== 'form' || isEditing) return;
    const { nombre, email, telefono } = formData;
    if (nombre || email || telefono) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ formData }));
      markDraftActive('user-mgmt');
    } else {
      clearDraft();
    }
  }, [formData, view, isEditing]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    clearDraft();
    setFormData(EMPTY_FORM);
    setIsEditing(false);
    setView('hub');
  };

  const handleNew = () => {
    setFormData(EMPTY_FORM);
    setIsEditing(false);
    setSelectedUser(null);
    setView('form');
    window.scrollTo(0, 0);
  };

  const handleSelectUser = (user) => {
    setSelectedUser(user);
    setView('hub');
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEdit = (user) => {
    setIsEditing(true);
    setFormData({ id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, rol: user.rol });
    setView('form');
    window.scrollTo(0, 0);
  };

  const handleDelete = async (userId) => {
    if (window.confirm('¿Seguro que quieres eliminar a este usuario?')) {
      try {
        const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        if (selectedUser?.id === userId) setSelectedUser(null);
        fetchUsers();
        showToast('Usuario eliminado correctamente');
      } catch {
        showToast('Error al eliminar el usuario.', 'error');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/users/${formData.id}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Error al guardar');
      const saved = await res.json();
      const savedId = isEditing ? formData.id : saved.id;
      const newUsers = await apiFetch('/api/users').then(r => r.json());
      setUsers(newUsers);
      if (savedId) {
        const found = newUsers.find(u => u.id === savedId);
        if (found) setSelectedUser(found);
      }
      resetForm();
      showToast(isEditing ? 'Usuario actualizado correctamente' : 'Usuario guardado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // ── Panel de detalle (solo lectura) ──────────────────────────────────────
  const renderHubPanel = () => {
    if (!selectedUser) return null;
    return (
      <div className="lote-hub">
        <button className="lote-hub-back" onClick={() => setSelectedUser(null)}>
          <FiArrowLeft size={13} /> Todos los usuarios
        </button>
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedUser.nombre}</h2>
            <span className={`role-badge role-badge--${selectedUser.rol || 'trabajador'}`}>
              {ROLE_LABELS[selectedUser.rol] || 'Trabajador'}
            </span>
          </div>
          <div className="hub-header-actions">
            <button onClick={() => handleEdit(selectedUser)} className="icon-btn" title="Editar">
              <FiEdit size={16} />
            </button>
            <button onClick={() => handleDelete(selectedUser.id)} className="icon-btn delete" title="Eliminar">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>
        <div className="hub-info-pills">
          <span className="hub-pill"><FiMail size={13} />{selectedUser.email}</span>
          <span className="hub-pill"><FiPhone size={13} />{selectedUser.telefono}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={`lote-page${selectedUser && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* --- SPINNER DE CARGA --- */}
      {loading && <div className="usr-page-loading" />}

      {/* --- ESTADO VACÍO --- */}
      {!loading && users.length === 0 && view !== 'form' && (
        <div className="usr-empty-state">
          <FiUserPlus size={36} />
          <p>No hay usuarios registrados.</p>
          <button className="btn btn-primary" onClick={handleNew}>
            <FiUserPlus size={15} /> Crear el primero
          </button>
        </div>
      )}

      {/* --- CARRUSEL MÓVIL --- */}
      {!loading && selectedUser && view === 'hub' && (
        <div className="lote-carousel" ref={carouselRef}>
          {users.map(user => (
            <button
              key={user.id}
              className={`lote-bubble${selectedUser?.id === user.id ? ' lote-bubble--active' : ''}`}
              onClick={() => selectedUser?.id === user.id ? setSelectedUser(null) : handleSelectUser(user)}
            >
              <span className="lote-bubble-avatar">{getInitials(user.nombre)}</span>
              <span className="lote-bubble-label">{user.nombre.split(' ')[0]}</span>
            </button>
          ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNew}>
            <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* --- CABECERA DE PÁGINA --- */}
      {!loading && users.length > 0 && view !== 'form' && (
        <div className="usr-page-header">
          <h1 className="usr-page-title">Gestión de Usuarios</h1>
          <button className="btn btn-primary" onClick={handleNew}>
            <FiUserPlus size={15} /> Nuevo Usuario
          </button>
        </div>
      )}

      {/* --- LAYOUT PRINCIPAL --- */}
      {!loading && (users.length > 0 || view === 'form') && (
        <div className="lote-management-layout">

          {/* Izquierda: formulario o hub de detalle */}
          {view === 'form' && (
            <div className="form-card">
              <h2>{isEditing ? 'Editando Usuario' : 'Nuevo Usuario'}</h2>
              <form onSubmit={handleSubmit} className="lote-form">
                <div className="form-grid">
                  <div className="form-control">
                    <label htmlFor="nombre">Nombre Completo</label>
                    <input id="nombre" name="nombre" value={formData.nombre} onChange={handleInputChange} required />
                  </div>
                  <div className="form-control">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" value={formData.email} onChange={handleInputChange} type="email" required />
                  </div>
                  <div className="form-control">
                    <label htmlFor="telefono">Teléfono</label>
                    <input id="telefono" name="telefono" value={formData.telefono} onChange={handleInputChange} required />
                  </div>
                  <div className="form-control">
                    <label htmlFor="rol">Rol</label>
                    <select id="rol" name="rol" value={formData.rol} onChange={handleInputChange}>
                      <option value="trabajador">Trabajador</option>
                      <option value="encargado">Encargado</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="rrhh">RR.HH.</option>
                      <option value="administrador">Administrador</option>
                    </select>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary">
                    <FiUserPlus />
                    {isEditing ? 'Actualizar Usuario' : 'Guardar Usuario'}
                  </button>
                  <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
                </div>
              </form>
            </div>
          )}
          {view === 'hub' && renderHubPanel()}

          {/* Derecha: lista de usuarios */}
          {view !== 'form' && (
            <div className="lote-list-panel">
<ul className="lote-list">
                {users.map(user => (
                  <li
                    key={user.id}
                    className={`lote-list-item${selectedUser?.id === user.id ? ' active' : ''}`}
                    onClick={() => selectedUser?.id === user.id ? setSelectedUser(null) : handleSelectUser(user)}
                  >
                    <div className="usr-list-info">
                      <span className="lote-list-code">{user.nombre}</span>
                      <span className="lote-list-name">{ROLE_LABELS[user.rol] || 'Trabajador'}</span>
                    </div>
                    <FiChevronRight size={14} className="lote-list-arrow" />
                  </li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default UserManagement;
