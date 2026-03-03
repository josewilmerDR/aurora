import { useState, useEffect } from 'react';
import './HR.css';
import { FiSave } from 'react-icons/fi';
import Toast from '../components/Toast';

const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', cedula: '', direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '',
};

function HrFicha() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [ficha, setFicha] = useState(EMPTY_FICHA);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedUser) { setFicha(EMPTY_FICHA); return; }
    fetch(`/api/hr/fichas/${selectedUser}`)
      .then(r => r.json())
      .then(data => setFicha({ ...EMPTY_FICHA, ...data }))
      .catch(console.error);
  }, [selectedUser]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFicha(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedUser) { showToast('Selecciona un trabajador primero.', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/fichas/${selectedUser}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ficha),
      });
      if (!res.ok) throw new Error();
      showToast('Ficha guardada correctamente.');
    } catch {
      showToast('Error al guardar la ficha.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const selected = users.find(u => u.id === selectedUser);

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="form-card">
        {/* Worker selector */}
        <div className="form-control" style={{ marginBottom: 0 }}>
          <label htmlFor="trabajador">Trabajador</label>
          <select id="trabajador" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
            <option value="">-- Seleccionar trabajador --</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>

        {selectedUser && (
          <>
            {selected && (
              <div className="ficha-header">
                <div className="ficha-avatar">{selected.nombre.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="ficha-worker-name">{selected.nombre}</div>
                  <div className="ficha-worker-role">{selected.email} · {selected.telefono}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="lote-form">
              <p className="form-section-title">Información Laboral</p>
              <div className="form-grid">
                <div className="form-control">
                  <label htmlFor="puesto">Puesto</label>
                  <input id="puesto" name="puesto" value={ficha.puesto} onChange={handleChange} placeholder="Ej: Operario de campo" />
                </div>
                <div className="form-control">
                  <label htmlFor="departamento">Departamento</label>
                  <input id="departamento" name="departamento" value={ficha.departamento} onChange={handleChange} placeholder="Ej: Producción" />
                </div>
                <div className="form-control">
                  <label htmlFor="fechaIngreso">Fecha de Ingreso</label>
                  <input id="fechaIngreso" name="fechaIngreso" type="date" value={ficha.fechaIngreso} onChange={handleChange} />
                </div>
                <div className="form-control">
                  <label htmlFor="tipoContrato">Tipo de Contrato</label>
                  <select id="tipoContrato" name="tipoContrato" value={ficha.tipoContrato} onChange={handleChange}>
                    <option value="permanente">Permanente</option>
                    <option value="temporal">Temporal</option>
                    <option value="por_obra">Por obra</option>
                  </select>
                </div>
                <div className="form-control">
                  <label htmlFor="salarioBase">Salario Base (₡)</label>
                  <input id="salarioBase" name="salarioBase" type="number" min="0" value={ficha.salarioBase} onChange={handleChange} placeholder="0" />
                </div>
                <div className="form-control">
                  <label htmlFor="cedula">Cédula / Identificación</label>
                  <input id="cedula" name="cedula" value={ficha.cedula} onChange={handleChange} placeholder="1-1234-5678" />
                </div>
              </div>

              <p className="form-section-title">Información de Contacto</p>
              <div className="form-grid">
                <div className="form-control">
                  <label htmlFor="direccion">Dirección</label>
                  <input id="direccion" name="direccion" value={ficha.direccion} onChange={handleChange} placeholder="Dirección de residencia" />
                </div>
                <div className="form-control">
                  <label htmlFor="contactoEmergencia">Contacto de Emergencia</label>
                  <input id="contactoEmergencia" name="contactoEmergencia" value={ficha.contactoEmergencia} onChange={handleChange} placeholder="Nombre" />
                </div>
                <div className="form-control">
                  <label htmlFor="telefonoEmergencia">Teléfono Emergencia</label>
                  <input id="telefonoEmergencia" name="telefonoEmergencia" value={ficha.telefonoEmergencia} onChange={handleChange} placeholder="8888-8888" />
                </div>
              </div>

              <p className="form-section-title">Notas</p>
              <div className="form-control">
                <textarea name="notas" value={ficha.notas} onChange={handleChange} placeholder="Observaciones generales del trabajador..." />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  <FiSave />
                  {loading ? 'Guardando...' : 'Guardar Ficha'}
                </button>
              </div>
            </form>
          </>
        )}

        {!selectedUser && (
          <p className="empty-state" style={{ marginTop: 20 }}>Selecciona un trabajador para ver o editar su ficha.</p>
        )}
      </div>
    </div>
  );
}

export default HrFicha;
