import { useState, useEffect } from 'react';
import './HR.css';
import { FiSave, FiUserPlus, FiX } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', cedula: '', direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '',
};

const EMPTY_USER = { nombre: '', email: '', telefono: '', rol: 'trabajador' };

// mode: 'idle' | 'new' | 'edit'
function HrFicha() {
  const apiFetch = useApiFetch();
  const [allUsers, setAllUsers] = useState([]);
  const [planillaUsers, setPlanillaUsers] = useState([]);
  const [mode, setMode] = useState('idle');
  const [selectedId, setSelectedId] = useState(null);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [fichaForm, setFichaForm] = useState(EMPTY_FICHA);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchUsers = () => {
    apiFetch('/api/users')
      .then(r => r.json())
      .then(users => {
        setAllUsers(users);
        setPlanillaUsers(users.filter(u => u.empleadoPlanilla));
      })
      .catch(console.error);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleSelectEmployee = async (user) => {
    setSelectedId(user.id);
    setUserForm({ nombre: user.nombre, email: user.email, telefono: user.telefono || '', rol: user.rol || 'trabajador' });
    setFichaForm(EMPTY_FICHA);
    setMode('edit');
    try {
      const data = await apiFetch(`/api/hr/fichas/${user.id}`).then(r => r.json());
      setFichaForm({ ...EMPTY_FICHA, ...data });
    } catch { /* sin ficha aún */ }
  };

  const handleNew = () => {
    setSelectedId(null);
    setUserForm(EMPTY_USER);
    setFichaForm(EMPTY_FICHA);
    setMode('new');
  };

  const handleCancel = () => {
    setMode('idle');
    setSelectedId(null);
    setUserForm(EMPTY_USER);
    setFichaForm(EMPTY_FICHA);
  };

  const handleUserChange = (e) => {
    const { name, value } = e.target;
    setUserForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFichaChange = (e) => {
    const { name, value } = e.target;
    setFichaForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'edit') {
        await apiFetch(`/api/users/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...userForm, empleadoPlanilla: true }),
        });
        await apiFetch(`/api/hr/fichas/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fichaForm),
        });
        showToast('Ficha actualizada correctamente.');
        fetchUsers();
      } else {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...userForm, empleadoPlanilla: true }),
        });
        if (!res.ok) throw new Error();
        const { id } = await res.json();
        await apiFetch(`/api/hr/fichas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fichaForm),
        });
        showToast('Empleado creado correctamente.');
        fetchUsers();
        handleCancel();
      }
    } catch {
      showToast('Error al guardar. Verifica los datos.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const selectedUser = allUsers.find(u => u.id === selectedId);

  return (
    <div className="ficha-page-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario (izquierda) ── */}
      <div className="form-card">
        <div className="ficha-action-bar">
          <button
            className={`btn ${mode === 'new' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={handleNew}
          >
            <FiUserPlus /> Nuevo Empleado
          </button>
        </div>

        {mode === 'idle' && (
          <p className="empty-state" style={{ marginTop: 28 }}>
            Selecciona un empleado de la lista o crea uno nuevo.
          </p>
        )}

        {mode !== 'idle' && (
          <form onSubmit={handleSubmit} className="lote-form" style={{ marginTop: 20 }}>

            {mode === 'edit' && selectedUser && (
              <div className="ficha-header">
                <div className="ficha-avatar">{selectedUser.nombre.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="ficha-worker-name">{selectedUser.nombre}</div>
                  <div className="ficha-worker-role">{selectedUser.email}</div>
                </div>
              </div>
            )}

            <p className="form-section-title">
              {mode === 'edit' ? 'Editar Empleado' : 'Nuevo Empleado en Planilla'}
            </p>

            <div className="form-grid">
              <div className="form-control">
                <label>Nombre Completo</label>
                <input name="nombre" value={userForm.nombre} onChange={handleUserChange} required placeholder="Nombre completo" />
              </div>
              <div className="form-control">
                <label>Email</label>
                <input name="email" type="email" value={userForm.email} onChange={handleUserChange} required placeholder="correo@ejemplo.com" />
              </div>
              <div className="form-control">
                <label>Teléfono</label>
                <input name="telefono" value={userForm.telefono} onChange={handleUserChange} placeholder="8888-8888" />
              </div>
              <div className="form-control">
                <label>Rol en el sistema</label>
                <select name="rol" value={userForm.rol} onChange={handleUserChange}>
                  <option value="ninguno">Ninguno (sin acceso al sistema)</option>
                  <option value="trabajador">Trabajador</option>
                  <option value="encargado">Encargado</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>
            </div>

            <p className="form-section-title">Información Laboral</p>
            <div className="form-grid">
              <div className="form-control">
                <label>Puesto</label>
                <input name="puesto" value={fichaForm.puesto} onChange={handleFichaChange} placeholder="Ej: Operario de campo" />
              </div>
              <div className="form-control">
                <label>Departamento</label>
                <input name="departamento" value={fichaForm.departamento} onChange={handleFichaChange} placeholder="Ej: Producción" />
              </div>
              <div className="form-control">
                <label>Fecha de Ingreso</label>
                <input name="fechaIngreso" type="date" value={fichaForm.fechaIngreso} onChange={handleFichaChange} />
              </div>
              <div className="form-control">
                <label>Tipo de Contrato</label>
                <select name="tipoContrato" value={fichaForm.tipoContrato} onChange={handleFichaChange}>
                  <option value="permanente">Permanente</option>
                  <option value="temporal">Temporal</option>
                  <option value="por_obra">Por obra</option>
                </select>
              </div>
              <div className="form-control">
                <label>Salario Base (₡)</label>
                <input name="salarioBase" type="number" min="0" value={fichaForm.salarioBase} onChange={handleFichaChange} placeholder="0" />
              </div>
              <div className="form-control">
                <label>Cédula / Identificación</label>
                <input name="cedula" value={fichaForm.cedula} onChange={handleFichaChange} placeholder="1-1234-5678" />
              </div>
            </div>

            <p className="form-section-title">Información de Contacto</p>
            <div className="form-grid">
              <div className="form-control">
                <label>Dirección</label>
                <input name="direccion" value={fichaForm.direccion} onChange={handleFichaChange} placeholder="Dirección de residencia" />
              </div>
              <div className="form-control">
                <label>Contacto de Emergencia</label>
                <input name="contactoEmergencia" value={fichaForm.contactoEmergencia} onChange={handleFichaChange} placeholder="Nombre" />
              </div>
              <div className="form-control">
                <label>Teléfono Emergencia</label>
                <input name="telefonoEmergencia" value={fichaForm.telefonoEmergencia} onChange={handleFichaChange} placeholder="8888-8888" />
              </div>
            </div>

            <p className="form-section-title">Notas</p>
            <div className="form-control">
              <textarea name="notas" value={fichaForm.notas} onChange={handleFichaChange} placeholder="Observaciones generales del trabajador..." />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                <FiSave />
                {loading ? 'Guardando...' : mode === 'edit' ? 'Guardar Cambios' : 'Crear Empleado'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                <FiX /> Cancelar
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Panel de empleados (derecha) ── */}
      <div className="empleados-panel">
        <div className="empleados-panel-header">
          <span>Empleados en Planilla</span>
          <span className="empleados-panel-count">{planillaUsers.length}</span>
        </div>

        {planillaUsers.length === 0 ? (
          <p style={{ padding: '20px 16px', fontSize: '0.83rem', color: 'var(--aurora-light)', opacity: 0.45, textAlign: 'center' }}>
            Sin empleados registrados.
          </p>
        ) : (
          <ul className="empleados-list">
            {planillaUsers.map(u => (
              <li
                key={u.id}
                className={`empleados-list-item${selectedId === u.id ? ' empleados-list-item--active' : ''}`}
                onClick={() => handleSelectEmployee(u)}
              >
                <div className="empleados-list-avatar">{u.nombre.charAt(0).toUpperCase()}</div>
                <div className="empleados-list-info">
                  <div className="empleados-list-name">{u.nombre}</div>
                  <div className="empleados-list-sub">{u.email}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default HrFicha;
