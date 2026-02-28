import { useState, useEffect } from 'react';
import './PackageManagement.css'; // Importamos los nuevos estilos
import { FiEdit, FiTrash2, FiPlus, FiX } from 'react-icons/fi';

function PackageManagement() {
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ 
    id: null, 
    nombrePaquete: '', 
    tipoCosecha: '', 
    etapaCultivo: '', 
    activities: [] 
  });
  const [isEditing, setIsEditing] = useState(false);

  // --- LÓGICA DE DATOS (sin cambios) ---
  useEffect(() => {
    fetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error);
    fetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index][field] = value;
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const addActivity = () => {
    setFormData(prev => ({ 
      ...prev, 
      activities: [...prev.activities, { day: '', name: '', responsableId: '' }] 
    }));
  };

  const removeActivity = (index) => {
    const updatedActivities = formData.activities.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const handleEdit = (pkg) => {
    setFormData({ ...pkg });
    setIsEditing(true);
    window.scrollTo(0, 0);
  };
  
  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', tipoCosecha: '', etapaCultivo: '', activities: [] });
    setIsEditing(false);
  }

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
      const updatedPackages = await fetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();
    } catch (error) {
      console.error("Error en el submit:", error);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('¿Estás seguro?')) {
      try {
        const response = await fetch(`/api/packages/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error al eliminar el paquete');
        setPackages(packages.filter(p => p.id !== id));
      } catch (error) {
        console.error("Error al eliminar:", error);
      }
    }
  };
  // --- FIN DE LA LÓGICA ---

  return (
    <div className="lote-management-layout"> {/* Reutilizamos el layout principal */}
      {/* --- TARJETA DEL FORMULARIO --- */}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete de Tareas'}</h2>
        {/* AÑADIMOS LA CLASE `lote-form` QUE FALTABA */}
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombrePaquete">Nombre del Paquete</label>
              <input id="nombrePaquete" name="nombrePaquete" value={formData.nombrePaquete} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="tipoCosecha">Tipo de Cosecha</label>
              <input id="tipoCosecha" name="tipoCosecha" value={formData.tipoCosecha} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="etapaCultivo">Etapa del Cultivo</label>
              <input id="etapaCultivo" name="etapaCultivo" value={formData.etapaCultivo} onChange={handleInputChange} required />
            </div>
          </div>

          <h3>Actividades Programadas</h3>
          <table className="activities-table">
            <thead>
              <tr>
                <th className="col-day">Día</th>
                <th className="col-name">Actividad</th>
                <th className="col-user">Responsable</th>
                <th className="col-action"></th>
              </tr>
            </thead>
            <tbody>
              {formData.activities.map((activity, index) => (
                <tr key={index}>
                  <td><input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} type="number" required/></td>
                  <td><input value={activity.name} onChange={(e) => handleActivityChange(index, 'name', e.target.value)} required/></td>
                  <td>
                    <select value={activity.responsableId} onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)} required>
                      <option value="">-- Asignar --</option>
                      {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" onClick={() => removeActivity(index)} className="icon-btn delete" title="Eliminar Actividad">
                        <FiX size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="add-activity-btn-container">
            <button type="button" onClick={addActivity} className="btn btn-secondary">
                <FiPlus />
                Añadir Actividad
            </button>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{isEditing ? 'Actualizar Paquete' : 'Guardar Paquete'}</button>
            {isEditing && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
          </div>
        </form>
      </div>

      {/* --- TARJETA DE LA LISTA DE PAQUETES --- */}
      <div className="list-card">
        <h2>Paquetes Existentes</h2>
        <ul className="info-list">
          {packages.map(pkg => (
            <li key={pkg.id}>
              <div>
                <div className="item-main-text">{pkg.nombrePaquete}</div>
                <div className="package-sub-info">
                  <span>{pkg.tipoCosecha}</span> | <span>{pkg.etapaCultivo}</span> | <span>{pkg.activities.length} actividades</span>
                </div>
              </div>
              <div className="lote-actions"> { /* Reutilizamos la clase de lote-actions */}
                <button onClick={() => handleEdit(pkg)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDelete(pkg.id)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {packages.length === 0 && <p className="empty-state">No hay paquetes creados.</p>}
      </div>
    </div>
  );
}

export default PackageManagement;
