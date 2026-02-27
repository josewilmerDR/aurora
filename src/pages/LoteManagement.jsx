import { useState, useEffect } from 'react';

function LoteManagement() {
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    id: null,
    nombreLote: '',
    fechaCreacion: '',
    paqueteId: ''
  });

  // Cargar datos iniciales
  const fetchLotes = () => {
    fetch('/api/lotes')
      .then(res => res.json())
      .then(data => setLotes(data))
      .catch(err => console.error("Error fetching lotes:", err));
  };

  const fetchPackages = () => {
    fetch('/api/packages')
      .then(res => res.json())
      .then(data => setPackages(data))
      .catch(err => console.error("Error fetching packages:", err));
  };

  useEffect(() => {
    fetchLotes();
    fetchPackages();
  }, []);

  // Convertir timestamp a formato YYYY-MM-DD para el input[type=date]
  const formatDateForInput = (timestamp) => {
    const date = new Date(timestamp._seconds * 1000);
    // Ajustar por la zona horaria para evitar el día anterior
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  }

  // Manejadores de eventos
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreLote: '', fechaCreacion: '', paqueteId: '' });
  };

  const handleEdit = (lote) => {
    setIsEditing(true);
    setFormData({
      id: lote.id,
      nombreLote: lote.nombreLote,
      fechaCreacion: formatDateForInput(lote.fechaCreacion),
      paqueteId: lote.paqueteId
    });
    window.scrollTo(0, 0);
  };

  const handleDelete = async (loteId) => {
    if (confirm('¿Seguro que quieres eliminar este lote? Todas sus tareas programadas también se borrarán.')) {
      try {
        const response = await fetch(`/api/lotes/${loteId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Error al eliminar el lote');
        fetchLotes(); // Recargar lista
      } catch (error) {
        console.error("Delete lote error:", error);
        alert('Error al eliminar.');
      }
    }
  };

  // Submit (Crear o Actualizar)
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/lotes/${formData.id}` : '/api/lotes';
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error(isEditing ? 'Error al actualizar' : 'Error al crear');
      
      fetchLotes();
      resetForm();

    } catch (error) {
      console.error("Submit lote error:", error);
      alert('Ocurrió un error al guardar.');
    }
  };

  return (
    <div>
      <h2>Gestión de Lotes</h2>

      <form onSubmit={handleSubmit} className="lote-form">
        <h3>{isEditing ? 'Editando Lote' : 'Crear Nuevo Lote'}</h3>
        <input name="nombreLote" value={formData.nombreLote} onChange={handleInputChange} placeholder="Nombre del Lote" required />
        <input name="fechaCreacion" value={formData.fechaCreacion} onChange={handleInputChange} type="date" required />
        <select name="paqueteId" value={formData.paqueteId} onChange={handleInputChange} required>
          <option value="">-- Seleccionar Paquete --</option>
          {packages.map(pkg => (
            <option key={pkg.id} value={pkg.id}>{pkg.nombrePaquete}</option>
          ))}
        </select>
        <button type="submit">{isEditing ? 'Actualizar Lote' : 'Crear y Programar'}</button>
        {isEditing && <button type="button" onClick={resetForm}>Cancelar Edición</button>}
      </form>

      <hr />

      <div className="lote-list">
        <h3>Lotes Existentes</h3>
        {lotes.map(lote => (
          <div key={lote.id} className="lote-card">
             <div>
                <p><strong>Nombre:</strong> {lote.nombreLote}</p>
                <p><strong>Fecha Creación:</strong> {new Date(lote.fechaCreacion._seconds * 1000).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</p>
             </div>
             <div className="user-actions">
                <button onClick={() => handleEdit(lote)}>Editar</button>
                <button onClick={() => handleDelete(lote.id)}>Eliminar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LoteManagement;
