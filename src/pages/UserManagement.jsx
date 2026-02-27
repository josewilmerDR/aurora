import { useState, useEffect } from 'react';

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ id: null, nombre: '', email: '', telefono: '' });
  const [isEditing, setIsEditing] = useState(false);

  // Cargar usuarios al iniciar
  const fetchUsers = () => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data))
      .catch(err => console.error("Error fetching users:", err));
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Manejadores de eventos
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
    window.scrollTo(0, 0); // Opcional: mover la vista al formulario
  };

  const handleDelete = async (userId) => {
    if (confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
      try {
        const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error al eliminar el usuario');
        fetchUsers(); // Recargar la lista de usuarios
      } catch (error) {
        console.error("Delete user error:", error);
        alert('Error al eliminar.');
      }
    }
  };

  // Submit (Crear o Actualizar)
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/users/${formData.id}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error(isEditing ? 'Error al actualizar' : 'Error al crear');
      
      fetchUsers(); // Recargar la lista
      resetForm(); // Limpiar el formulario

    } catch (error) {
      console.error("Submit user error:", error);
      alert('Ocurrió un error al guardar.');
    }
  };

  return (
    <div>
      <h2>Gestión de Usuarios</h2>

      <form onSubmit={handleSubmit} className="user-form">
        <h3>{isEditing ? 'Editando Usuario' : 'Añadir Nuevo Usuario'}</h3>
        <input name="nombre" value={formData.nombre} onChange={handleInputChange} placeholder="Nombre Completo" required />
        <input name="email" value={formData.email} onChange={handleInputChange} placeholder="Email" type="email" required />
        <input name="telefono" value={formData.telefono} onChange={handleInputChange} placeholder="Teléfono (ej: +1234567890)" required />
        <button type="submit">{isEditing ? 'Actualizar Usuario' : 'Guardar Usuario'}</button>
        {isEditing && <button type="button" onClick={resetForm}>Cancelar Edición</button>}
      </form>

      <hr />

      <div className="user-list">
        <h3>Usuarios Registrados</h3>
        {users.map(user => (
          <div key={user.id} className="user-card">
            <div>
                <p><strong>Nombre:</strong> {user.nombre}</p>
                <p><strong>Email:</strong> {user.email}</p>
                <p><strong>Teléfono:</strong> {user.telefono}</p>
            </div>
            <div className="user-actions">
                <button onClick={() => handleEdit(user)}>Editar</button>
                <button onClick={() => handleDelete(user.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default UserManagement;
