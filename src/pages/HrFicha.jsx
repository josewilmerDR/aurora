import { useState, useEffect } from 'react';
import { markDraftActive, clearDraftActive } from '../hooks/useDraft';
import './HR.css';
import { FiSave, FiUserPlus, FiX } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';

const DIAS_SEMANA = [
  { key: 'lunes',     label: 'Lunes',      letra: 'L' },
  { key: 'martes',    label: 'Martes',     letra: 'M' },
  { key: 'miercoles', label: 'Miércoles',  letra: 'M' },
  { key: 'jueves',    label: 'Jueves',     letra: 'J' },
  { key: 'viernes',   label: 'Viernes',    letra: 'V' },
  { key: 'sabado',    label: 'Sábado',     letra: 'S' },
  { key: 'domingo',   label: 'Domingo',    letra: 'D' },
];

const EMPTY_HORARIO = Object.fromEntries(
  DIAS_SEMANA.map(d => [d.key, { activo: false, inicio: '', fin: '' }])
);

const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', cedula: '', direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '',
  horarioSemanal: EMPTY_HORARIO,
};

function calcHorasSemanales(horario = {}) {
  return DIAS_SEMANA.reduce((sum, { key }) => {
    const dia = horario[key];
    if (!dia?.activo || !dia.inicio || !dia.fin) return sum;
    const [h1, m1] = dia.inicio.split(':').map(Number);
    const [h2, m2] = dia.fin.split(':').map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    return sum + Math.max(0, mins / 60);
  }, 0);
}

const EMPTY_USER = { nombre: '', email: '', telefono: '', rol: 'trabajador' };

const DRAFT_KEY = 'aurora_hr_ficha_draft';

// mode: 'idle' | 'new' | 'edit'
function HrFicha() {
  const apiFetch = useApiFetch();
  const { currentUser, refreshCurrentUser } = useUser();
  const [allUsers, setAllUsers] = useState([]);
  const [planillaUsers, setPlanillaUsers] = useState([]);
  const [mode, setMode] = useState('idle');
  const [selectedId, setSelectedId] = useState(null);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [fichaForm, setFichaForm] = useState(EMPTY_FICHA);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [laboralCollapsed, setLaboralCollapsed] = useState(true);
  const [contactoCollapsed, setContactoCollapsed] = useState(true);
  const [notasCollapsed, setNotasCollapsed] = useState(true);
  const [horarioCollapsed, setHorarioCollapsed] = useState(true);
  const [horarioDefault, setHorarioDefault] = useState({ inicio: '06:00', fin: '14:00' });
  const [busquedaEmpleado, setBusquedaEmpleado] = useState('');
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

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    clearDraftActive('hr-ficha');
  };

  // Restaurar borrador al montar
  useEffect(() => {
    fetchUsers();
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      setMode(draft.mode);
      setSelectedId(draft.selectedId);
      setUserForm(draft.userForm);
      setFichaForm({
        ...EMPTY_FICHA,
        ...draft.fichaForm,
        horarioSemanal: { ...EMPTY_HORARIO, ...(draft.fichaForm?.horarioSemanal || {}) },
      });
    } catch { clearDraft(); }
  }, []);

  // Guardar borrador mientras hay cambios sin guardar
  useEffect(() => {
    if (mode === 'idle') return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ mode, selectedId, userForm, fichaForm }));
    markDraftActive('hr-ficha');
  }, [fichaForm, userForm, mode, selectedId]);

  const handleSelectEmployee = async (user) => {
    setSelectedId(user.id);
    setUserForm({ nombre: user.nombre, email: user.email, telefono: user.telefono || '', rol: user.rol || 'trabajador' });
    setFichaForm(EMPTY_FICHA);
    setMode('edit');
    try {
      const data = await apiFetch(`/api/hr/fichas/${user.id}`).then(r => r.json());
      setFichaForm({
        ...EMPTY_FICHA,
        ...data,
        horarioSemanal: { ...EMPTY_HORARIO, ...(data.horarioSemanal || {}) },
      });
    } catch { /* sin ficha aún */ }
  };

  const handleNew = () => {
    setSelectedId(null);
    setUserForm(EMPTY_USER);
    setFichaForm(EMPTY_FICHA);
    setMode('new');
    document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancel = () => {
    clearDraft();
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

  const handleHorarioChange = (diaKey, field, value) => {
    setFichaForm(prev => {
      const diaActual = prev.horarioSemanal[diaKey];
      const updates = field === 'activo' && value === true
        ? { activo: true, inicio: diaActual.inicio || horarioDefault.inicio, fin: diaActual.fin || horarioDefault.fin }
        : { [field]: value };
      return {
        ...prev,
        horarioSemanal: { ...prev.horarioSemanal, [diaKey]: { ...diaActual, ...updates } },
      };
    });
  };

  const DIAS_LABORALES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const aplicarHorarioLV = () => {
    setFichaForm(prev => {
      const nuevoDias = { ...prev.horarioSemanal };
      DIAS_LABORALES.forEach(key => {
        nuevoDias[key] = { activo: true, inicio: horarioDefault.inicio, fin: horarioDefault.fin };
      });
      return { ...prev, horarioSemanal: nuevoDias };
    });
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
        clearDraft();
        showToast('Ficha actualizada correctamente.');
        if (currentUser?.userId === selectedId) refreshCurrentUser();
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

      {/* ── Panel de empleados — primero en DOM para que en móvil aparezca arriba sin trucos CSS ── */}
      <div className="empleados-panel">
        <div className="empleados-panel-header">
          <span>Empleados en Planilla</span>
          <div className="empleados-panel-header-right">
            <span className="empleados-panel-count">{planillaUsers.length}</span>
            <button className="empleados-panel-new-btn" onClick={handleNew} title="Crear nuevo empleado">
              <FiUserPlus size={14} />
            </button>
          </div>
        </div>

        <div className="empleados-search-wrap">
          <input
            className="empleados-search"
            type="text"
            placeholder="Buscar empleado..."
            value={busquedaEmpleado}
            onChange={e => setBusquedaEmpleado(e.target.value)}
          />
          {busquedaEmpleado && (
            <button className="empleados-search-clear" onClick={() => setBusquedaEmpleado('')}>✕</button>
          )}
        </div>

        {planillaUsers.length === 0 ? (
          <p style={{ padding: '20px 16px', fontSize: '0.83rem', color: 'var(--aurora-light)', opacity: 0.45, textAlign: 'center' }}>
            Sin empleados registrados.
          </p>
        ) : (
          <ul className="empleados-list">
            {planillaUsers
              .filter(u => u.nombre.toLowerCase().includes(busquedaEmpleado.toLowerCase()))
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
              .map(u => (
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
            {planillaUsers.filter(u => u.nombre.toLowerCase().includes(busquedaEmpleado.toLowerCase())).length === 0 && (
              <p style={{ padding: '16px', fontSize: '0.83rem', color: 'var(--aurora-light)', opacity: 0.45, textAlign: 'center' }}>
                Sin resultados.
              </p>
            )}
          </ul>
        )}
      </div>

      {/* ── Formulario — segundo en DOM, aparece a la izquierda en escritorio vía CSS grid ── */}
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
          <div className="ficha-idle-state">
            <p className="empty-state">
              Selecciona un empleado de la lista o crea uno nuevo.
            </p>
            <button className="btn btn-primary ficha-idle-new-btn" onClick={handleNew}>
              <FiUserPlus /> Crear Nuevo Empleado
            </button>
          </div>
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
              {mode === 'edit' ? 'Información Personal' : 'Nuevo Empleado en Planilla'}
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

            <button
              type="button"
              className="form-section-title collapsible-section-header"
              onClick={() => setLaboralCollapsed(v => !v)}
            >
              <span>Información Laboral</span>
              <span className={`collapsible-chevron${laboralCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
            </button>
            <div className={laboralCollapsed ? 'collapsible-content--hidden' : ''}>
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
            </div>

            <button
              type="button"
              className="form-section-title collapsible-section-header"
              onClick={() => setHorarioCollapsed(v => !v)}
            >
              <span>Horario Semanal</span>
              <span className={`collapsible-chevron${horarioCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
            </button>
            <div className={`horario-grid${horarioCollapsed ? ' horario-grid--hidden' : ''}`}>
              <div className="horario-quickfill">
                <div className="horario-quickfill-inputs">
                  <label>Entrada</label>
                  <input
                    type="time"
                    value={horarioDefault.inicio}
                    onChange={e => setHorarioDefault(p => ({ ...p, inicio: e.target.value }))}
                    className="horario-time-input"
                  />
                  <label>Salida</label>
                  <input
                    type="time"
                    value={horarioDefault.fin}
                    onChange={e => setHorarioDefault(p => ({ ...p, fin: e.target.value }))}
                    className="horario-time-input"
                  />
                </div>
                <button type="button" className="btn-aplicar-lv" onClick={aplicarHorarioLV}>
                  Aplicar L–S
                </button>
              </div>
              <div className="horario-grid-header">
                <span>Labora</span>
                <span>Entrada</span>
                <span>Salida</span>
              </div>
              {DIAS_SEMANA.map(({ key, label, letra }) => {
                const dia = fichaForm.horarioSemanal?.[key] || { activo: false, inicio: '', fin: '' };
                const [h1, m1] = (dia.inicio || '').split(':').map(Number);
                const [h2, m2] = (dia.fin    || '').split(':').map(Number);
                const horasDia = dia.activo && dia.inicio && dia.fin
                  ? Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60)
                  : 0;
                return (
                  <div key={key} className={`horario-row${dia.activo ? '' : ' horario-row--inactivo'}`}>
                    <label className="horario-toggle">
                      <input
                        type="checkbox"
                        checked={dia.activo}
                        onChange={e => handleHorarioChange(key, 'activo', e.target.checked)}
                      />
                      <span className="horario-toggle-track">
                        <span className="horario-dia-letra">{letra}</span>
                      </span>
                    </label>
                    <div className="horario-times">
                      <input
                        type="time"
                        value={dia.inicio}
                        disabled={!dia.activo}
                        onChange={e => handleHorarioChange(key, 'inicio', e.target.value)}
                        className="horario-time-input"
                      />
                      <input
                        type="time"
                        value={dia.fin}
                        disabled={!dia.activo}
                        onChange={e => handleHorarioChange(key, 'fin', e.target.value)}
                        className="horario-time-input"
                      />
                    </div>
                  </div>
                );
              })}
              <div className="horario-total-row">
                <span>Total semanal</span>
                <strong>
                  {(() => {
                    const t = calcHorasSemanales(fichaForm.horarioSemanal);
                    return t > 0 ? `${t % 1 === 0 ? t : t.toFixed(1)} horas/semana` : '—';
                  })()}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="form-section-title collapsible-section-header"
              onClick={() => setContactoCollapsed(v => !v)}
            >
              <span>Información de Contacto</span>
              <span className={`collapsible-chevron${contactoCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
            </button>
            <div className={contactoCollapsed ? 'collapsible-content--hidden' : ''}>
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
            </div>

            <button
              type="button"
              className="form-section-title collapsible-section-header"
              onClick={() => setNotasCollapsed(v => !v)}
            >
              <span>Notas</span>
              <span className={`collapsible-chevron${notasCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
            </button>
            <div className={notasCollapsed ? 'collapsible-content--hidden' : ''}>
              <div className="form-control">
                <textarea name="notas" value={fichaForm.notas} onChange={handleFichaChange} placeholder="Observaciones generales del trabajador..." />
              </div>
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

    </div>
  );
}

export default HrFicha;
