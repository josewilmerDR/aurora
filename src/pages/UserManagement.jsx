import { useState, useEffect, useRef } from 'react';
import './UserManagement.css';
import { FiEdit, FiTrash2, FiUserPlus } from 'react-icons/fi';
import { ROLE_LABELS } from '../contexts/UserContext';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../hooks/useDraft';

const DRAFT_KEY = 'aurora_user_mgmt_draft';

const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', cedula: '', direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '', encargadoId: '',
};

function UserManagement() {
  const apiFetch = useApiFetch();
  const [users, setUsers] = useState([]);
  const [formData, setFormData] = useState({ id: null, nombre: '', email: '', telefono: '', rol: 'trabajador', empleadoPlanilla: false });
  const [fichaForm, setFichaForm] = useState(EMPTY_FICHA);
  const [mode, setMode] = useState('idle'); // 'idle' | 'new' | 'edit'
  const [toast, setToast] = useState(null);
  const skipFichaLoadRef = useRef(false);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const encargados = users.filter(u => ['encargado', 'supervisor', 'administrador'].includes(u.rol));

  const fetchUsers = () => {
    apiFetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
  };

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
      skipFichaLoadRef.current = true;
      setMode(draft.mode);
      setFormData(draft.formData);
      setFichaForm({ ...EMPTY_FICHA, ...draft.fichaForm });
    } catch { clearDraft(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar borrador mientras hay cambios sin guardar
  useEffect(() => {
    if (mode === 'idle') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode, formData, fichaForm }));
    markDraftActive('user-mgmt');
  }, [mode, formData, fichaForm]);

  // Cargar ficha al editar un empleado en planilla (saltado si viene de borrador)
  useEffect(() => {
    if (skipFichaLoadRef.current) { skipFichaLoadRef.current = false; return; }
    if (mode === 'edit' && formData.empleadoPlanilla && formData.id) {
      apiFetch(`/api/hr/fichas/${formData.id}`)
        .then(r => r.json())
        .then(data => setFichaForm({ ...EMPTY_FICHA, ...data }))
        .catch(() => setFichaForm(EMPTY_FICHA));
    } else if (!formData.empleadoPlanilla) {
      setFichaForm(EMPTY_FICHA);
    }
  }, [mode, formData.id, formData.empleadoPlanilla]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleFichaChange = (e) => {
    const { name, value } = e.target;
    setFichaForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    clearDraft();
    setFormData({ id: null, nombre: '', email: '', telefono: '', rol: 'trabajador', empleadoPlanilla: false });
    setFichaForm(EMPTY_FICHA);
    setMode('idle');
  };

  const handleNew = () => {
    setFormData({ id: null, nombre: '', email: '', telefono: '', rol: 'trabajador', empleadoPlanilla: false });
    setFichaForm(EMPTY_FICHA);
    setMode('new');
    window.scrollTo(0, 0);
  };

  const handleEdit = (user) => {
    setFormData({ ...user, empleadoPlanilla: user.empleadoPlanilla === true });
    setMode('edit');
    window.scrollTo(0, 0);
  };

  const handleDelete = async (userId) => {
    if (window.confirm('¿Seguro que quieres eliminar a este usuario?')) {
      try {
        const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error al eliminar');
        fetchUsers();
        showToast('Usuario eliminado correctamente');
      } catch {
        showToast('Error al eliminar el usuario.', 'error');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = mode === 'edit' ? `/api/users/${formData.id}` : '/api/users';
    const method = mode === 'edit' ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Error al guardar');
      const saved = await res.json();
      const userId = saved.id || formData.id;

      if (formData.empleadoPlanilla) {
        await apiFetch(`/api/hr/fichas/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fichaForm),
        });
      }

      fetchUsers();
      resetForm();
      showToast(mode === 'edit' ? 'Usuario actualizado correctamente' : 'Usuario guardado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* --- TARJETA DEL FORMULARIO --- */}
      <div className="form-card">
        {mode === 'idle' && (
          <div className="ficha-idle-state">
            <p className="empty-state">Selecciona un usuario de la lista o crea uno nuevo.</p>
            <button className="btn btn-primary ficha-idle-new-btn" onClick={handleNew}>
              <FiUserPlus /> Crear Nuevo Usuario
            </button>
          </div>
        )}
        {mode !== 'idle' && <h2>{mode === 'edit' ? 'Editando Usuario' : 'Nuevo Usuario'}</h2>}
        {mode !== 'idle' && <form onSubmit={handleSubmit} className="lote-form">
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

          {/* Checkbox empleado en planilla */}
          <label className="planilla-check-label">
            <input
              type="checkbox"
              name="empleadoPlanilla"
              checked={formData.empleadoPlanilla}
              onChange={handleInputChange}
            />
            <span>Empleado en planilla</span>
          </label>

          {/* Sección ficha — solo si está marcado */}
          {formData.empleadoPlanilla && (
            <>
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

              <p className="form-section-title">Supervisión</p>
              <div className="form-grid">
                <div className="form-control">
                  <label>Encargado / Supervisor directo</label>
                  <select name="encargadoId" value={fichaForm.encargadoId} onChange={handleFichaChange}>
                    <option value="">— Sin asignar —</option>
                    {encargados.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre} ({ROLE_LABELS[e.rol] || e.rol})</option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="form-section-title">Notas</p>
              <div className="form-control">
                <textarea name="notas" value={fichaForm.notas} onChange={handleFichaChange} placeholder="Observaciones generales del trabajador..." />
              </div>
            </>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiUserPlus />
              {mode === 'edit' ? 'Actualizar Usuario' : 'Guardar Usuario'}
            </button>
            {mode === 'edit' && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
            {mode === 'new' && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
          </div>
        </form>}
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
                  {user.empleadoPlanilla && <span className="planilla-badge">Planilla</span>}
                </div>
                <div className="item-sub-text">{user.email} | {user.telefono}</div>
              </div>
              <div className="lote-actions">
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
