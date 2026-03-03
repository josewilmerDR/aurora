import { useState, useEffect } from 'react';
import './UserManagement.css';
import { FiEdit, FiTrash2, FiUserPlus } from 'react-icons/fi';
import { ROLE_LABELS } from '../contexts/UserContext';
import Toast from '../components/Toast';

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ id: null, nombre: '', email: '', telefono: '', rol: 'trabajador' });
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // --- LÓGICA DE DATOS (sin cambios) ---
  const fetchUsers = () => {
    fetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData({ id: null, nombre: '', email: '', telefono: '', rol: 'trabajador' });
    setIsEditing(false);
  };

  const handleEdit = (user) => {
    setFormData(user);
    setIsEditing(true);
    window.scrollTo(0, 0);
  };

  const handleDelete = async (userId) => {
    if (window.confirm('¿Seguro que quieres eliminar a este usuario?')) {
      try {
        const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        fetchUsers();
        showToast('Usuario eliminado correctamente');
      } catch (error) {
        showToast('Error al eliminar el usuario.', 'error');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/users/${formData.id}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Error al guardar');
      fetchUsers();
      resetForm();
      showToast(isEditing ? 'Usuario actualizado correctamente' : 'Usuario guardado correctamente');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };
  // --- FIN DE LA LÓGICA ---

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {/* --- TARJETA DEL FORMULARIO --- */}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Usuario' : 'Añadir Nuevo Usuario'}</h2>
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
                <option value="administrador">Administrador</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiUserPlus />
              {isEditing ? 'Actualizar Usuario' : 'Guardar Usuario'}
            </button>
            {isEditing && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
          </div>
        </form>
      </div>

      {/* --- TARJETA DE LA LISTA DE USUARIOS --- */}
      <div className="list-card">
        <h2>Usuarios Registrados</h2>
        <ul className="info-list">
          {users.map(user => (
            <li key={user.id}>
              <div>
                <div className="item-main-text">
                  {user.nombre}
                  <span className={`role-badge role-badge--${user.rol || 'trabajador'}`}>{ROLE_LABELS[user.rol] || 'Trabajador'}</span>
                </div>
                <div className="item-sub-text">{user.email} | {user.telefono}</div>
              </div>
              <div className="lote-actions"> {/* Reutilizamos acciones */}
                <button onClick={() => handleEdit(user)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDelete(user.id)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {users.length === 0 && <p className="empty-state">No hay usuarios registrados.</p>}
      </div>
    </div>
  );
}

export default UserManagement;
