import { useState, useEffect } from 'react';

function App() {
  // Estado para la lista de paquetes
  const [packages, setPackages] = useState([]);
  // Estado para la lista de usuarios
  const [users, setUsers] = useState([]);
  // Estado para el formulario (datos del paquete)
  const [formData, setFormData] = useState({ 
    id: null, 
    nombrePaquete: '', 
    tipoCosecha: '', 
    etapaCultivo: '', 
    activities: [] 
  });
  const [isEditing, setIsEditing] = useState(false);

  // --- FETCH DE DATOS INICIALES ---
  useEffect(() => {
    // Cargar paquetes
    fetch('/api/packages')
      .then(res => res.json())
      .then(data => setPackages(data))
      .catch(err => console.error("Error fetching packages:", err));

    // Cargar usuarios
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data))
      .catch(err => console.error("Error fetching users:", err));
  }, []);

  // --- MANEJADORES DE EVENTOS ---

  // Manejar cambios en los inputs principales del formulario
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Manejar cambios en los campos de una actividad
  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index][field] = value;
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  // Añadir una nueva fila de actividad vacía
  const addActivity = () => {
    setFormData(prev => ({ 
      ...prev, 
      activities: [...prev.activities, { day: '', name: '', responsableId: '' }] 
    }));
  };

  // Eliminar una fila de actividad
  const removeActivity = (index) => {
    const updatedActivities = formData.activities.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  // Cargar datos de un paquete en el formulario para editar
  const handleEdit = (pkg) => {
    setFormData({ ...pkg });
    setIsEditing(true);
  };
  
  // Limpiar y resetear el formulario
  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', tipoCosecha: '', etapaCultivo: '', activities: [] });
    setIsEditing(false);
  }

  // --- SUBMIT (CREAR/ACTUALIZAR) ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/packages/${formData.id}` : '/api/packages';
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      
      // Recargar la lista de paquetes y resetear el formulario
      const updatedPackages = await fetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();

    } catch (error) {
      console.error("Error en el submit:", error);
    }
  };

  // --- DELETE ---
  const handleDelete = async (id) => {
    if (confirm('¿Estás seguro de que quieres eliminar este paquete?')) {
      try {
        const response = await fetch(`/api/packages/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error al eliminar el paquete');
        setPackages(packages.filter(p => p.id !== id));
      } catch (error) {
        console.error("Error al eliminar:", error);
      }
    }
  };

  // --- RENDERIZADO DEL COMPONENTE ---
  return (
    <div>
      <h1>Panel de Administración</h1>
      
      <div className="package-list">
        <h2>Paquetes Existentes</h2>
        {packages.map(pkg => (
          <div key={pkg.id} className="package-card">
            <span>{pkg.nombrePaquete} ({pkg.tipoCosecha})</span>
            <div>
              <button onClick={() => handleEdit(pkg)}>Editar</button>
              <button onClick={() => handleDelete(pkg.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="package-form">
        <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete'}</h2>
        
        <input name="nombrePaquete" value={formData.nombrePaquete} onChange={handleInputChange} placeholder="Nombre del Paquete" required />
        <input name="tipoCosecha" value={formData.tipoCosecha} onChange={handleInputChange} placeholder="Tipo de Cosecha" required />
        <input name="etapaCultivo" value={formData.etapaCultivo} onChange={handleInputChange} placeholder="Etapa del Cultivo" required />

        <h3>Actividades</h3>
        {formData.activities.map((activity, index) => (
          <div key={index} className="activity-row">
            <input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} placeholder="Día" type="number" />
            <input value={activity.name} onChange={(e) => handleActivityChange(index, 'name', e.target.value)} placeholder="Nombre Actividad" />
            
            <select value={activity.responsableId} onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)} required>
              <option value="">-- Asignar a --</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.nombre}
                </option>
              ))}
            </select>

            <button type="button" onClick={() => removeActivity(index)}>Quitar</button>
          </div>
        ))}
        <button type="button" onClick={addActivity}>Añadir Actividad</button>

        <hr />
        <button type="submit">{isEditing ? 'Actualizar Paquete' : 'Guardar Paquete'}</button>
        {isEditing && <button type="button" onClick={resetForm}>Cancelar Edición</button>}
      </form>
    </div>
  );
}

export default App;
