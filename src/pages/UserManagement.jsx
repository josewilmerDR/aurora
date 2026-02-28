import { useState, useEffect } from 'react';
import './UserManagement.css'; // Importamos los estilos reutilizados
import { FiEdit, FiTrash2, FiPlus, FiUserPlus } from 'react-icons/fi';

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ id: null, nombre: '', email: '', telefono: '' });
  const [isEditing, setIsEditing] = useState(false);

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
    setFormData({ id: null, nombre: '', email: '', telefono: '' });
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
      } catch (error) {
        alert('Error al eliminar el usuario.');
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
    } catch (error) {
      alert('Ocurrió un error al guardar.');
    }
  };
  // --- FIN DE LA LÓGICA ---

  return (
    <div className="lote-management-layout"> {/* Reutilizamos la clase principal de layout */}
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
                <div className="item-main-text">{user.nombre}</div>
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
