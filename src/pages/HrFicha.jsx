import { useState, useEffect, useRef } from 'react';
import { markDraftActive, clearDraftActive } from '../hooks/useDraft';
import './HR.css';
import {
  FiSave, FiUserPlus, FiX, FiClipboard,
  FiEdit, FiTrash2, FiArrowLeft, FiMail, FiPhone, FiChevronRight,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser, ROLE_LABELS } from '../contexts/UserContext';

const DIAS_SEMANA = [
  { key: 'lunes',     label: 'Lunes',     letra: 'L' },
  { key: 'martes',    label: 'Martes',    letra: 'M' },
  { key: 'miercoles', label: 'Miércoles', letra: 'M' },
  { key: 'jueves',    label: 'Jueves',    letra: 'J' },
  { key: 'viernes',   label: 'Viernes',   letra: 'V' },
  { key: 'sabado',    label: 'Sábado',    letra: 'S' },
  { key: 'domingo',   label: 'Domingo',   letra: 'D' },
];

const EMPTY_HORARIO = Object.fromEntries(
  DIAS_SEMANA.map(d => [d.key, { activo: false, inicio: '', fin: '' }])
);

const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', precioHora: '', cedula: '', encargadoId: '',
  direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '',
  horarioSemanal: EMPTY_HORARIO,
};

function calcHorasSemanales(horario = {}) {
  return DIAS_SEMANA.reduce((sum, { key }) => {
    const dia = horario[key];
    if (!dia?.activo || !dia.inicio || !dia.fin) return sum;
    const [h1, m1] = dia.inicio.split(':').map(Number);
    const [h2, m2] = dia.fin.split(':').map(Number);
    return sum + Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
  }, 0);
}

const getInitials = (nombre) => {
  if (!nombre) return '?';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const EMPTY_USER = { nombre: '', email: '', telefono: '', rol: 'trabajador' };
const DRAFT_KEY = 'aurora_hr_ficha_draft';

// view: 'hub' | 'form'
function HrFicha() {
  const apiFetch = useApiFetch();
  const { currentUser, refreshCurrentUser } = useUser();
  const [allUsers, setAllUsers] = useState([]);
  const [planillaUsers, setPlanillaUsers] = useState([]);
  const [view, setView] = useState('hub');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [fichaForm, setFichaForm] = useState(EMPTY_FICHA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [laboralCollapsed, setLaboralCollapsed] = useState(true);
  const [contactoCollapsed, setContactoCollapsed] = useState(true);
  const [notasCollapsed, setNotasCollapsed] = useState(true);
  const [horarioCollapsed, setHorarioCollapsed] = useState(true);
  const [horarioDefault, setHorarioDefault] = useState({ inicio: '06:00', fin: '14:00' });
  const carouselRef = useRef(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Auto-scroll active bubble into view on mobile
  useEffect(() => {
    if (!selectedId || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedId]);

  const fetchUsers = () =>
    apiFetch('/api/users')
      .then(r => r.json())
      .then(users => {
        setAllUsers(users);
        setPlanillaUsers(users.filter(u => u.empleadoPlanilla));
      })
      .catch(console.error)
      .finally(() => setLoading(false));

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
      setUserForm(draft.userForm);
      setFichaForm({
        ...EMPTY_FICHA,
        ...draft.fichaForm,
        horarioSemanal: { ...EMPTY_HORARIO, ...(draft.fichaForm?.horarioSemanal || {}) },
      });
      setView('form');
      setIsEditing(false);
    } catch { clearDraft(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar borrador solo al crear (no al editar)
  useEffect(() => {
    if (view !== 'form' || isEditing) return;
    const { nombre, email } = userForm;
    if (nombre || email) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ userForm, fichaForm }));
      markDraftActive('hr-ficha');
    } else {
      clearDraft();
    }
  }, [fichaForm, userForm, view, isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFicha = async (userId) => {
    try {
      const data = await apiFetch(`/api/hr/fichas/${userId}`).then(r => r.json());
      setFichaForm({
        ...EMPTY_FICHA,
        ...data,
        horarioSemanal: { ...EMPTY_HORARIO, ...(data.horarioSemanal || {}) },
      });
    } catch { setFichaForm(EMPTY_FICHA); }
  };

  const handleSelectEmployee = async (user) => {
    setSelectedId(user.id);
    setUserForm({ nombre: user.nombre, email: user.email, telefono: user.telefono || '', rol: user.rol || 'trabajador' });
    setFichaForm(EMPTY_FICHA);
    setView('hub');
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
    await loadFicha(user.id);
  };

  const handleNew = () => {
    setSelectedId(null);
    setUserForm(EMPTY_USER);
    setFichaForm(EMPTY_FICHA);
    setView('form');
    setIsEditing(false);
    window.scrollTo(0, 0);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setView('form');
    window.scrollTo(0, 0);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('¿Seguro que quieres eliminar a este empleado?')) return;
    try {
      const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSelectedId(null);
      setUserForm(EMPTY_USER);
      setFichaForm(EMPTY_FICHA);
      fetchUsers();
      showToast('Empleado eliminado correctamente.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleCancel = () => {
    clearDraft();
    setView('hub');
    setIsEditing(false);
    if (!isEditing) {
      setSelectedId(null);
      setUserForm(EMPTY_USER);
      setFichaForm(EMPTY_FICHA);
    } else if (selectedId) {
      const orig = allUsers.find(u => u.id === selectedId);
      if (orig) setUserForm({ nombre: orig.nombre, email: orig.email, telefono: orig.telefono || '', rol: orig.rol || 'trabajador' });
      loadFicha(selectedId);
    }
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
    setSaving(true);
    try {
      if (isEditing) {
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
        if (currentUser?.userId === selectedId) refreshCurrentUser();
        const newUsers = await apiFetch('/api/users').then(r => r.json());
        setAllUsers(newUsers);
        setPlanillaUsers(newUsers.filter(u => u.empleadoPlanilla));
        const found = newUsers.find(u => u.id === selectedId);
        if (found) setUserForm({ nombre: found.nombre, email: found.email, telefono: found.telefono || '', rol: found.rol || 'trabajador' });
        setView('hub');
        setIsEditing(false);
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
        clearDraft();
        const newUsers = await apiFetch('/api/users').then(r => r.json());
        setAllUsers(newUsers);
        const planilla = newUsers.filter(u => u.empleadoPlanilla);
        setPlanillaUsers(planilla);
        const found = planilla.find(u => u.id === id);
        if (found) {
          setSelectedId(id);
          setUserForm({ nombre: found.nombre, email: found.email, telefono: found.telefono || '', rol: found.rol || 'trabajador' });
          await loadFicha(id);
        }
        setView('hub');
        setIsEditing(false);
      }
    } catch {
      showToast('Error al guardar. Verifica los datos.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const encargados = allUsers.filter(u => ['encargado', 'supervisor', 'administrador'].includes(u.rol));
  const selectedUser = allUsers.find(u => u.id === selectedId);

  // ── Panel de detalle (solo lectura) ──────────────────────────────────────
  const renderHubPanel = () => {
    if (!selectedId || !selectedUser) return null;

    const encargado = allUsers.find(u => u.id === fichaForm.encargadoId);
    const tieneLaboral = fichaForm.puesto || fichaForm.departamento || fichaForm.fechaIngreso
      || fichaForm.salarioBase || fichaForm.precioHora || encargado;
    const tieneHorario = DIAS_SEMANA.some(d => fichaForm.horarioSemanal?.[d.key]?.activo);
    const tieneContacto = fichaForm.direccion || fichaForm.contactoEmergencia || fichaForm.telefonoEmergencia;

    return (
      <div className="lote-hub">
        <button className="lote-hub-back" onClick={() => setSelectedId(null)}>
          <FiArrowLeft size={13} /> Todos los empleados
        </button>

        <div className="hub-header">
          <div className="ficha-hub-identity">
            <div className="ficha-avatar">{getInitials(selectedUser.nombre)}</div>
            <div>
              <h2 className="hub-lote-code">{selectedUser.nombre}</h2>
              <span className={`role-badge role-badge--${selectedUser.rol || 'trabajador'}`}>
                {ROLE_LABELS[selectedUser.rol] || 'Trabajador'}
              </span>
            </div>
          </div>
          <div className="hub-header-actions">
            <button onClick={handleEdit} className="icon-btn" title="Editar ficha">
              <FiEdit size={16} />
            </button>
            <button onClick={() => handleDelete(selectedId)} className="icon-btn delete" title="Eliminar empleado">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          {selectedUser.email    && <span className="hub-pill"><FiMail  size={13} />{selectedUser.email}</span>}
          {selectedUser.telefono && <span className="hub-pill"><FiPhone size={13} />{selectedUser.telefono}</span>}
          {fichaForm.cedula      && <span className="hub-pill hub-pill-muted">CI: {fichaForm.cedula}</span>}
        </div>

        {tieneLaboral && (
          <div className="ficha-hub-section">
            <p className="ficha-hub-section-title">Información Laboral</p>
            <div className="ficha-hub-grid">
              {fichaForm.puesto       && <div className="ficha-hub-item"><span className="ficha-hub-label">Puesto</span><span className="ficha-hub-value">{fichaForm.puesto}</span></div>}
              {fichaForm.departamento && <div className="ficha-hub-item"><span className="ficha-hub-label">Departamento</span><span className="ficha-hub-value">{fichaForm.departamento}</span></div>}
              {fichaForm.fechaIngreso && <div className="ficha-hub-item"><span className="ficha-hub-label">Ingreso</span><span className="ficha-hub-value">{fichaForm.fechaIngreso}</span></div>}
              {fichaForm.tipoContrato && fichaForm.tipoContrato !== 'permanente' && (
                <div className="ficha-hub-item"><span className="ficha-hub-label">Contrato</span><span className="ficha-hub-value">{fichaForm.tipoContrato}</span></div>
              )}
              {fichaForm.salarioBase  && <div className="ficha-hub-item"><span className="ficha-hub-label">Salario Base</span><span className="ficha-hub-value">₡{Number(fichaForm.salarioBase).toLocaleString('es-CR')}</span></div>}
              {fichaForm.precioHora   && <div className="ficha-hub-item"><span className="ficha-hub-label">Precio/Hora</span><span className="ficha-hub-value">₡{Number(fichaForm.precioHora).toLocaleString('es-CR')}</span></div>}
              {encargado              && <div className="ficha-hub-item"><span className="ficha-hub-label">Encargado</span><span className="ficha-hub-value">{encargado.nombre}</span></div>}
            </div>
          </div>
        )}

        {tieneHorario && (
          <div className="ficha-hub-section">
            <p className="ficha-hub-section-title">Horario Semanal</p>
            <div className="ficha-hub-horario">
              {DIAS_SEMANA.map(({ key, letra }) => {
                const dia = fichaForm.horarioSemanal?.[key];
                return (
                  <div key={key} className={`ficha-hub-dia${dia?.activo ? ' ficha-hub-dia--activo' : ''}`}>
                    <span className="ficha-hub-dia-letra">{letra}</span>
                    {dia?.activo && <span className="ficha-hub-dia-horas">{dia.inicio}–{dia.fin}</span>}
                  </div>
                );
              })}
            </div>
            {(() => { const t = calcHorasSemanales(fichaForm.horarioSemanal); return t > 0 ? <p className="ficha-hub-total">{t % 1 === 0 ? t : t.toFixed(1)} h/semana</p> : null; })()}
          </div>
        )}

        {tieneContacto && (
          <div className="ficha-hub-section">
            <p className="ficha-hub-section-title">Contacto de Emergencia</p>
            <div className="ficha-hub-grid">
              {fichaForm.direccion         && <div className="ficha-hub-item ficha-hub-item--full"><span className="ficha-hub-label">Dirección</span><span className="ficha-hub-value">{fichaForm.direccion}</span></div>}
              {fichaForm.contactoEmergencia && <div className="ficha-hub-item"><span className="ficha-hub-label">Contacto</span><span className="ficha-hub-value">{fichaForm.contactoEmergencia}</span></div>}
              {fichaForm.telefonoEmergencia && <div className="ficha-hub-item"><span className="ficha-hub-label">Teléfono</span><span className="ficha-hub-value">{fichaForm.telefonoEmergencia}</span></div>}
            </div>
          </div>
        )}

        {fichaForm.notas && (
          <div className="ficha-hub-section">
            <p className="ficha-hub-section-title">Notas</p>
            <p className="ficha-hub-notas">{fichaForm.notas}</p>
          </div>
        )}
      </div>
    );
  };

  // ── Spinner de carga ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="ficha-page-loading">
        <div className="ficha-spinner" />
      </div>
    );
  }

  return (
    <div className={`lote-page${selectedId && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Estado vacío ── */}
      {planillaUsers.length === 0 && view !== 'form' && (
        <div className="ficha-empty-state">
          <FiClipboard size={36} />
          <p>No hay empleados registrados aún</p>
          <button className="btn btn-primary" onClick={handleNew}>Crear el primero</button>
        </div>
      )}

      {/* ── Carrusel móvil ── */}
      {selectedId && view === 'hub' && (
        <div className="lote-carousel" ref={carouselRef}>
          {planillaUsers
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
            .map(u => (
              <button
                key={u.id}
                className={`lote-bubble${selectedId === u.id ? ' lote-bubble--active' : ''}`}
                onClick={() => selectedId === u.id ? setSelectedId(null) : handleSelectEmployee(u)}
              >
                <span className="lote-bubble-avatar">{getInitials(u.nombre)}</span>
                <span className="lote-bubble-label">{u.nombre.split(' ')[0]}</span>
              </button>
            ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNew}>
            <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Cabecera de página ── */}
      {planillaUsers.length > 0 && view !== 'form' && (
        <div className="ficha-page-header">
          <h2 className="ficha-page-title">Ficha del Trabajador</h2>
          <button className="btn btn-primary" onClick={handleNew}>
            <FiUserPlus /> Nuevo Empleado
          </button>
        </div>
      )}

      {/* ── Layout principal ── */}
      {(planillaUsers.length > 0 || view === 'form') && (
        <div className="lote-management-layout">

          {/* Izquierda: detalle o formulario */}
          {view === 'hub' && renderHubPanel()}

          {view === 'form' && (
            <div className="form-card">
              <h2>{isEditing ? `Editando: ${selectedUser?.nombre || ''}` : 'Nuevo Empleado'}</h2>
              <form onSubmit={handleSubmit} className="lote-form" style={{ marginTop: 16 }}>

                <p className="form-section-title">Información Personal</p>
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
                  <div className="form-control">
                    <label>Cédula / Identificación</label>
                    <input name="cedula" value={fichaForm.cedula} onChange={handleFichaChange} placeholder="1-1234-5678" />
                  </div>
                </div>

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setLaboralCollapsed(v => !v)}>
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
                      <input name="salarioBase" type="number" min="0" step="any" value={fichaForm.salarioBase} onChange={handleFichaChange} placeholder="0" />
                    </div>
                    <div className="form-control">
                      <label>Precio por Hora (₡)</label>
                      <input name="precioHora" type="number" min="0" step="any" value={fichaForm.precioHora} onChange={handleFichaChange} placeholder="0" />
                    </div>
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
                </div>

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setHorarioCollapsed(v => !v)}>
                  <span>Horario Semanal</span>
                  <span className={`collapsible-chevron${horarioCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
                </button>
                <div className={`horario-grid${horarioCollapsed ? ' horario-grid--hidden' : ''}`}>
                  <div className="horario-quickfill">
                    <div className="horario-quickfill-inputs">
                      <label>Entrada</label>
                      <input type="time" value={horarioDefault.inicio} onChange={e => setHorarioDefault(p => ({ ...p, inicio: e.target.value }))} className="horario-time-input" />
                      <label>Salida</label>
                      <input type="time" value={horarioDefault.fin} onChange={e => setHorarioDefault(p => ({ ...p, fin: e.target.value }))} className="horario-time-input" />
                    </div>
                    <button type="button" className="btn-aplicar-lv" onClick={aplicarHorarioLV}>Aplicar L–S</button>
                  </div>
                  <div className="horario-grid-header">
                    <span>Labora</span><span>Entrada</span><span>Salida</span>
                  </div>
                  {DIAS_SEMANA.map(({ key, letra }) => {
                    const dia = fichaForm.horarioSemanal?.[key] || { activo: false, inicio: '', fin: '' };
                    return (
                      <div key={key} className={`horario-row${dia.activo ? '' : ' horario-row--inactivo'}`}>
                        <label className="horario-toggle">
                          <input type="checkbox" checked={dia.activo} onChange={e => handleHorarioChange(key, 'activo', e.target.checked)} />
                          <span className="horario-toggle-track"><span className="horario-dia-letra">{letra}</span></span>
                        </label>
                        <div className="horario-times">
                          <input type="time" value={dia.inicio} disabled={!dia.activo} onChange={e => handleHorarioChange(key, 'inicio', e.target.value)} className="horario-time-input" />
                          <input type="time" value={dia.fin}    disabled={!dia.activo} onChange={e => handleHorarioChange(key, 'fin',   e.target.value)} className="horario-time-input" />
                        </div>
                      </div>
                    );
                  })}
                  <div className="horario-total-row">
                    <span>Total semanal</span>
                    <strong>{(() => { const t = calcHorasSemanales(fichaForm.horarioSemanal); return t > 0 ? `${t % 1 === 0 ? t : t.toFixed(1)} horas/semana` : '—'; })()}</strong>
                  </div>
                </div>

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setContactoCollapsed(v => !v)}>
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

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setNotasCollapsed(v => !v)}>
                  <span>Notas</span>
                  <span className={`collapsible-chevron${notasCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
                </button>
                <div className={notasCollapsed ? 'collapsible-content--hidden' : ''}>
                  <div className="form-control">
                    <textarea name="notas" value={fichaForm.notas} onChange={handleFichaChange} placeholder="Observaciones generales del trabajador..." />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    <FiSave />
                    {saving ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Empleado'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                    <FiX /> Cancelar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Derecha: lista de empleados */}
          {view !== 'form' && (
            <div className="lote-list-panel">
              <ul className="lote-list">
                {planillaUsers
                  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
                  .map(u => (
                    <li
                      key={u.id}
                      className={`lote-list-item${selectedId === u.id ? ' active' : ''}`}
                      onClick={() => selectedId === u.id ? setSelectedId(null) : handleSelectEmployee(u)}
                    >
                      <div className="lote-list-info">
                        <span className="lote-list-code">{u.nombre}</span>
                        <span className="lote-list-name">{ROLE_LABELS[u.rol] || 'Trabajador'}</span>
                      </div>
                      <FiChevronRight size={14} className="lote-list-arrow" />
                    </li>
                  ))}
              </ul>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default HrFicha;
