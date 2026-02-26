import { useState, useEffect } from 'react';

function App() {
  // Estado para la lista de paquetes
  const [packages, setPackages] = useState([]);
  // Estado para el formulario (datos del paquete)
  const [formData, setFormData] = useState({ 
    id: null, 
    packageName: '', 
    harvestType: '', 
    cropStage: '', 
    activities: [] 
  });
  const [isEditing, setIsEditing] = useState(false);

  // --- FETCH (LEER) --- 
  // Obtener paquetes del API al cargar el componente
  useEffect(() => {
    fetch('/api/packages')
      .then(res => res.json())
      .then(data => setPackages(data))
      .catch(err => console.error("Error fetching packages:", err));
  }, []);

  // --- HANDLERS (MANEJADORES DE EVENTOS) ---

  // Manejar cambios en los inputs del formulario
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Manejar cambios en las actividades
  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index][field] = value;
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  // Añadir una nueva fila de actividad
  const addActivity = () => {
    setFormData(prev => ({ 
      ...prev, 
      activities: [...prev.activities, { day: '', name: '', responsible: '' }] 
    }));
  };

  // Eliminar una fila de actividad
  const removeActivity = (index) => {
    const updatedActivities = formData.activities.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  // Preparar formulario para edición
  const handleEdit = (pkg) => {
    setFormData({ ...pkg });
    setIsEditing(true);
  };
  
  // Limpiar el formulario
  const resetForm = () => {
    setFormData({ id: null, packageName: '', harvestType: '', cropStage: '', activities: [] });
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
      if (!response.ok) throw new Error('Error saving package');
      
      // Recargar la lista y resetear el formulario
      const updatedPackages = await fetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();

    } catch (error) {
      console.error("Submit error:", error);
    }
  };

  // --- DELETE (BORRAR) ---
  const handleDelete = async (id) => {
    if (confirm('¿Seguro que quieres eliminar este paquete?')) {
      try {
        const response = await fetch(`/api/packages/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error deleting package');
        setPackages(packages.filter(p => p.id !== id)); // Actualizar lista en el estado
      } catch (error) {
        console.error("Delete error:", error);
      }
    }
  };


  // --- RENDERIZADO DEL COMPONENTE ---
  return (
    <div>
      <h1>Panel de Administración (React)</h1>
      
      {/* SECCIÓN DE LISTA DE PAQUETES */}
      <div className="package-list">
        <h2>Paquetes Existentes</h2>
        {packages.map(pkg => (
          <div key={pkg.id} className="package-card">
            <span>{pkg.packageName} ({pkg.harvestType})</span>
            <div>
              <button onClick={() => handleEdit(pkg)}>Editar</button>
              <button onClick={() => handleDelete(pkg.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>

      {/* FORMULARIO DE CREACIÓN/EDICIÓN */}
      <form onSubmit={handleSubmit} className="package-form">
        <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete'}</h2>
        
        <input name="packageName" value={formData.packageName} onChange={handleInputChange} placeholder="Nombre del Paquete" required />
        <input name="harvestType" value={formData.harvestType} onChange={handleInputChange} placeholder="Tipo de Cosecha" required />
        <input name="cropStage" value={formData.cropStage} onChange={handleInputChange} placeholder="Etapa del Cultivo" required />

        <h3>Actividades</h3>
        {formData.activities.map((activity, index) => (
          <div key={index} className="activity-row">
            <input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} placeholder="Día" type="number" />
            <input value={activity.name} onChange={(e) => handleActivityChange(index, 'name', e.target.value)} placeholder="Nombre Actividad" />
            <input value={activity.responsible} onChange={(e) => handleActivityChange(index, 'responsible', e.target.value)} placeholder="Responsable" />
            <button type="button" onClick={() => removeActivity(index)}>Quitar</button>
          </div>
        ))}
        <button type="button" onClick={addActivity}>Añadir Actividad</button>

        <hr />
        <button type="submit">{isEditing ? 'Actualizar' : 'Guardar'}</button>
        {isEditing && <button type="button" onClick={resetForm}>Cancelar</button>}
      </form>
    </div>
  );
}

export default App;
