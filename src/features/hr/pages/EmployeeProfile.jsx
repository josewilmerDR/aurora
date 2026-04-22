import { useState, useEffect, useRef } from 'react';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import '../styles/hr.css';
import {
  FiSave, FiUserPlus, FiX, FiClipboard,
  FiEdit, FiTrash2, FiArrowLeft, FiMail, FiPhone, FiChevronRight,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, ROLE_LABELS } from '../../../contexts/UserContext';

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

const DIAS_LABORALES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const TIPOS_CONTRATO = ['permanente', 'temporal', 'por_obra'];
const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];

const LIMITS = {
  nombre: 80, email: 120, telefono: 20, cedula: 30,
  puesto: 80, departamento: 80, direccion: 200,
  contactoEmergencia: 80, telefonoEmergencia: 20, notas: 2000,
};
const SALARIO_MAX = 10_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function validateForms(userForm, fichaForm) {
  const errors = {};

  const nombre = (userForm.nombre || '').trim();
  if (nombre.length < 2) errors.nombre = 'Mínimo 2 caracteres.';
  else if (nombre.length > LIMITS.nombre) errors.nombre = `Máximo ${LIMITS.nombre} caracteres.`;

  const email = (userForm.email || '').trim();
  if (!email) errors.email = 'Email requerido.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Email con formato inválido.';
  else if (email.length > LIMITS.email) errors.email = `Máximo ${LIMITS.email} caracteres.`;

  const tel = (userForm.telefono || '').trim();
  if (tel) {
    if (!PHONE_RE.test(tel)) errors.telefono = 'Solo dígitos, espacios, +, -, ( ).';
    else if (tel.length > LIMITS.telefono) errors.telefono = `Máximo ${LIMITS.telefono} caracteres.`;
  }

  if (!ROLES_VALIDOS.includes(userForm.rol)) errors.rol = 'Rol inválido.';

  ['cedula', 'puesto', 'departamento', 'direccion', 'contactoEmergencia', 'notas'].forEach((k) => {
    const v = fichaForm[k];
    if (typeof v === 'string' && v.length > LIMITS[k]) errors[k] = `Máximo ${LIMITS[k]} caracteres.`;
  });

  const telEm = (fichaForm.telefonoEmergencia || '').trim();
  if (telEm) {
    if (!PHONE_RE.test(telEm)) errors.telefonoEmergencia = 'Formato inválido.';
    else if (telEm.length > LIMITS.telefonoEmergencia) errors.telefonoEmergencia = `Máximo ${LIMITS.telefonoEmergencia} caracteres.`;
  }

  if (fichaForm.fechaIngreso) {
    const d = new Date(fichaForm.fechaIngreso);
    if (Number.isNaN(d.getTime())) {
      errors.fechaIngreso = 'Fecha inválida.';
    } else {
      const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
      if (d > hoy) errors.fechaIngreso = 'No puede ser futura.';
    }
  }

  ['salarioBase', 'precioHora'].forEach((k) => {
    const raw = fichaForm[k];
    if (raw === '' || raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) errors[k] = 'Debe ser un número ≥ 0.';
    else if (n > SALARIO_MAX) errors[k] = `Máximo ₡${SALARIO_MAX.toLocaleString('es-CR')}.`;
  });

  if (fichaForm.tipoContrato && !TIPOS_CONTRATO.includes(fichaForm.tipoContrato)) {
    errors.tipoContrato = 'Contrato inválido.';
  }

  DIAS_SEMANA.forEach(({ key, label }) => {
    const dia = fichaForm.horarioSemanal?.[key];
    if (!dia?.activo) return;
    if (!dia.inicio || !dia.fin) {
      errors[`horario_${key}`] = `${label}: ingrese entrada y salida.`;
      return;
    }
    if (toMinutes(dia.fin) <= toMinutes(dia.inicio)) {
      errors[`horario_${key}`] = `${label}: salida debe ser posterior a entrada.`;
    }
  });

  return errors;
}

// view: 'hub' | 'form'
function EmployeeProfile() {
  const apiFetch = useApiFetch();
  const { currentUser, refreshCurrentUser } = useUser();
  const [allUsers, setAllUsers] = useState([]);
  const [planillaUsers, setPlanillaUsers] = useState([]);
  const [fichasMap, setFichasMap] = useState({});
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
  const [errors, setErrors] = useState({});
  const formRef = useRef(null);
  const carouselRef = useRef(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Auto-scroll active bubble into view on mobile
  useEffect(() => {
    if (!selectedId || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedId]);

  const fetchUsers = () =>
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/fichas').then(r => r.json()).catch(() => []),
    ])
      .then(([users, fichas]) => {
        setAllUsers(users);
        setPlanillaUsers(users.filter(u => u.empleadoPlanilla));
        const map = {};
        (Array.isArray(fichas) ? fichas : []).forEach(f => { map[f.userId] = f; });
        setFichasMap(map);
        return users;
      })
      .catch(err => { console.error(err); return []; })
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
      const raw = await apiFetch(`/api/hr/fichas/${userId}`).then(r => r.json());
      const { id: _id, userId: _uid, fincaId: _fid, updatedAt: _ua, ...data } = raw || {};
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
    setErrors({});
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
    setErrors({});
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

  const clearFieldError = (name) => {
    setErrors(prev => {
      if (!prev[name]) return prev;
      const { [name]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleUserChange = (e) => {
    const { name, value } = e.target;
    setUserForm(prev => ({ ...prev, [name]: value }));
    clearFieldError(name);
  };

  const handleFichaChange = (e) => {
    const { name, value } = e.target;
    setFichaForm(prev => ({ ...prev, [name]: value }));
    clearFieldError(name);
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
    clearFieldError(`horario_${diaKey}`);
  };

  const aplicarHorarioLV = () => {
    setFichaForm(prev => {
      const nuevoDias = { ...prev.horarioSemanal };
      DIAS_LABORALES.forEach(key => {
        nuevoDias[key] = { activo: true, inicio: horarioDefault.inicio, fin: horarioDefault.fin };
      });
      return { ...prev, horarioSemanal: nuevoDias };
    });
  };

  const buildUserPayload = () => ({
    nombre: userForm.nombre.trim(),
    email: userForm.email.trim().toLowerCase(),
    telefono: (userForm.telefono || '').trim(),
    rol: userForm.rol,
    empleadoPlanilla: true,
  });

  const buildFichaPayload = () => {
    const s = (v) => (typeof v === 'string' ? v.trim() : v);
    return {
      puesto: s(fichaForm.puesto),
      departamento: s(fichaForm.departamento),
      fechaIngreso: fichaForm.fechaIngreso || '',
      tipoContrato: fichaForm.tipoContrato || 'permanente',
      salarioBase: fichaForm.salarioBase === '' || fichaForm.salarioBase == null ? null : Number(fichaForm.salarioBase),
      precioHora: fichaForm.precioHora === '' || fichaForm.precioHora == null ? null : Number(fichaForm.precioHora),
      cedula: s(fichaForm.cedula),
      encargadoId: fichaForm.encargadoId || '',
      direccion: s(fichaForm.direccion),
      contactoEmergencia: s(fichaForm.contactoEmergencia),
      telefonoEmergencia: s(fichaForm.telefonoEmergencia),
      notas: s(fichaForm.notas),
      horarioSemanal: fichaForm.horarioSemanal,
    };
  };

  const openSectionsForErrors = (errs) => {
    const keys = Object.keys(errs);
    if (keys.some(k => ['puesto', 'departamento', 'fechaIngreso', 'tipoContrato', 'salarioBase', 'precioHora', 'encargadoId'].includes(k))) {
      setLaboralCollapsed(false);
    }
    if (keys.some(k => k.startsWith('horario_'))) setHorarioCollapsed(false);
    if (keys.some(k => ['direccion', 'contactoEmergencia', 'telefonoEmergencia'].includes(k))) {
      setContactoCollapsed(false);
    }
    if (keys.includes('notas')) setNotasCollapsed(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validateForms(userForm, fichaForm);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      openSectionsForErrors(errs);
      showToast('Revisa los campos marcados.', 'error');
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector('.form-control--error input, .form-control--error select, .form-control--error textarea');
        el?.focus();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (isEditing) {
        const userRes = await apiFetch(`/api/users/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildUserPayload()),
        });
        if (!userRes.ok) {
          const msg = await userRes.json().catch(() => ({}));
          throw new Error(msg.message || 'Error al actualizar usuario.');
        }
        const fichaRes = await apiFetch(`/api/hr/fichas/${selectedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildFichaPayload()),
        });
        if (!fichaRes.ok) {
          const msg = await fichaRes.json().catch(() => ({}));
          throw new Error(msg.message || 'Error al guardar ficha.');
        }
        showToast('Ficha actualizada correctamente.');
        if (currentUser?.userId === selectedId) refreshCurrentUser();
        const refreshed = await fetchUsers();
        const found = refreshed.find(u => u.id === selectedId);
        if (found) setUserForm({ nombre: found.nombre, email: found.email, telefono: found.telefono || '', rol: found.rol || 'trabajador' });
        setView('hub');
        setIsEditing(false);
      } else {
        const res = await apiFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildUserPayload()),
        });
        if (!res.ok) {
          const msg = await res.json().catch(() => ({}));
          throw new Error(msg.message || 'Error al crear usuario.');
        }
        const { id } = await res.json();
        const fichaRes = await apiFetch(`/api/hr/fichas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildFichaPayload()),
        });
        if (!fichaRes.ok) {
          const msg = await fichaRes.json().catch(() => ({}));
          showToast(`Empleado creado, pero la ficha no se guardó: ${msg.message || 'error'}`, 'error');
        } else {
          showToast('Empleado creado correctamente.');
        }
        clearDraft();
        const refreshed = await fetchUsers();
        const found = refreshed.find(u => u.id === id);
        if (found) {
          setSelectedId(id);
          setUserForm({ nombre: found.nombre, email: found.email, telefono: found.telefono || '', rol: found.rol || 'trabajador' });
          await loadFicha(id);
        }
        setView('hub');
        setIsEditing(false);
      }
    } catch (err) {
      showToast(err?.message || 'Error al guardar. Verifica los datos.', 'error');
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
          {[...planillaUsers]
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
              <form onSubmit={handleSubmit} noValidate ref={formRef} className="lote-form" style={{ marginTop: 16 }}>

                <p className="form-section-title">Información Personal</p>
                <div className="form-grid">
                  <div className={`form-control${errors.nombre ? ' form-control--error' : ''}`}>
                    <label>Nombre Completo</label>
                    <input name="nombre" value={userForm.nombre} onChange={handleUserChange} required maxLength={LIMITS.nombre} placeholder="Nombre completo" aria-invalid={!!errors.nombre} />
                    {errors.nombre && <span className="form-control-error">{errors.nombre}</span>}
                  </div>
                  <div className={`form-control${errors.email ? ' form-control--error' : ''}`}>
                    <label>Email</label>
                    <input name="email" type="email" value={userForm.email} onChange={handleUserChange} required maxLength={LIMITS.email} placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} />
                    {errors.email && <span className="form-control-error">{errors.email}</span>}
                  </div>
                  <div className={`form-control${errors.telefono ? ' form-control--error' : ''}`}>
                    <label>Teléfono</label>
                    <input name="telefono" value={userForm.telefono} onChange={handleUserChange} maxLength={LIMITS.telefono} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefono} />
                    {errors.telefono && <span className="form-control-error">{errors.telefono}</span>}
                  </div>
                  <div className={`form-control${errors.rol ? ' form-control--error' : ''}`}>
                    <label>Rol en el sistema</label>
                    <select name="rol" value={userForm.rol} onChange={handleUserChange}>
                      <option value="ninguno">Ninguno (sin acceso al sistema)</option>
                      <option value="trabajador">Trabajador</option>
                      <option value="encargado">Encargado</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="administrador">Administrador</option>
                    </select>
                    {errors.rol && <span className="form-control-error">{errors.rol}</span>}
                  </div>
                  <div className={`form-control${errors.cedula ? ' form-control--error' : ''}`}>
                    <label>Cédula / Identificación</label>
                    <input name="cedula" value={fichaForm.cedula} onChange={handleFichaChange} maxLength={LIMITS.cedula} placeholder="1-1234-5678" aria-invalid={!!errors.cedula} />
                    {errors.cedula && <span className="form-control-error">{errors.cedula}</span>}
                  </div>
                </div>

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setLaboralCollapsed(v => !v)}>
                  <span>Información Laboral</span>
                  <span className={`collapsible-chevron${laboralCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
                </button>
                <div className={laboralCollapsed ? 'collapsible-content--hidden' : ''}>
                  <div className="form-grid">
                    <div className={`form-control${errors.puesto ? ' form-control--error' : ''}`}>
                      <label>Puesto</label>
                      <input name="puesto" value={fichaForm.puesto} onChange={handleFichaChange} maxLength={LIMITS.puesto} placeholder="Ej: Operario de campo" aria-invalid={!!errors.puesto} />
                      {errors.puesto && <span className="form-control-error">{errors.puesto}</span>}
                    </div>
                    <div className={`form-control${errors.departamento ? ' form-control--error' : ''}`}>
                      <label>Departamento</label>
                      <input name="departamento" value={fichaForm.departamento} onChange={handleFichaChange} maxLength={LIMITS.departamento} placeholder="Ej: Producción" aria-invalid={!!errors.departamento} />
                      {errors.departamento && <span className="form-control-error">{errors.departamento}</span>}
                    </div>
                    <div className={`form-control${errors.fechaIngreso ? ' form-control--error' : ''}`}>
                      <label>Fecha de Ingreso</label>
                      <input name="fechaIngreso" type="date" value={fichaForm.fechaIngreso} onChange={handleFichaChange} max={new Date().toISOString().slice(0, 10)} aria-invalid={!!errors.fechaIngreso} />
                      {errors.fechaIngreso && <span className="form-control-error">{errors.fechaIngreso}</span>}
                    </div>
                    <div className={`form-control${errors.tipoContrato ? ' form-control--error' : ''}`}>
                      <label>Tipo de Contrato</label>
                      <select name="tipoContrato" value={fichaForm.tipoContrato} onChange={handleFichaChange}>
                        <option value="permanente">Permanente</option>
                        <option value="temporal">Temporal</option>
                        <option value="por_obra">Por obra</option>
                      </select>
                      {errors.tipoContrato && <span className="form-control-error">{errors.tipoContrato}</span>}
                    </div>
                    <div className={`form-control${errors.salarioBase ? ' form-control--error' : ''}`}>
                      <label>Salario Base (₡)</label>
                      <input name="salarioBase" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.salarioBase} onChange={handleFichaChange} placeholder="0" aria-invalid={!!errors.salarioBase} />
                      {errors.salarioBase && <span className="form-control-error">{errors.salarioBase}</span>}
                    </div>
                    <div className={`form-control${errors.precioHora ? ' form-control--error' : ''}`}>
                      <label>Precio por Hora (₡)</label>
                      <input name="precioHora" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.precioHora} onChange={handleFichaChange} placeholder="0" aria-invalid={!!errors.precioHora} />
                      {errors.precioHora && <span className="form-control-error">{errors.precioHora}</span>}
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
                    const errKey = `horario_${key}`;
                    const hasErr = !!errors[errKey];
                    return (
                      <div key={key} className={`horario-row${dia.activo ? '' : ' horario-row--inactivo'}${hasErr ? ' horario-row--error' : ''}`}>
                        <label className="horario-toggle">
                          <input type="checkbox" checked={dia.activo} onChange={e => handleHorarioChange(key, 'activo', e.target.checked)} />
                          <span className="horario-toggle-track"><span className="horario-dia-letra">{letra}</span></span>
                        </label>
                        <div className="horario-times">
                          <input type="time" value={dia.inicio} disabled={!dia.activo} onChange={e => handleHorarioChange(key, 'inicio', e.target.value)} className="horario-time-input" />
                          <input type="time" value={dia.fin}    disabled={!dia.activo} onChange={e => handleHorarioChange(key, 'fin',   e.target.value)} className="horario-time-input" />
                        </div>
                        {hasErr && <span className="form-control-error horario-row-error">{errors[errKey]}</span>}
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
                    <div className={`form-control${errors.direccion ? ' form-control--error' : ''}`}>
                      <label>Dirección</label>
                      <input name="direccion" value={fichaForm.direccion} onChange={handleFichaChange} maxLength={LIMITS.direccion} placeholder="Dirección de residencia" aria-invalid={!!errors.direccion} />
                      {errors.direccion && <span className="form-control-error">{errors.direccion}</span>}
                    </div>
                    <div className={`form-control${errors.contactoEmergencia ? ' form-control--error' : ''}`}>
                      <label>Contacto de Emergencia</label>
                      <input name="contactoEmergencia" value={fichaForm.contactoEmergencia} onChange={handleFichaChange} maxLength={LIMITS.contactoEmergencia} placeholder="Nombre" aria-invalid={!!errors.contactoEmergencia} />
                      {errors.contactoEmergencia && <span className="form-control-error">{errors.contactoEmergencia}</span>}
                    </div>
                    <div className={`form-control${errors.telefonoEmergencia ? ' form-control--error' : ''}`}>
                      <label>Teléfono Emergencia</label>
                      <input name="telefonoEmergencia" value={fichaForm.telefonoEmergencia} onChange={handleFichaChange} maxLength={LIMITS.telefonoEmergencia} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefonoEmergencia} />
                      {errors.telefonoEmergencia && <span className="form-control-error">{errors.telefonoEmergencia}</span>}
                    </div>
                  </div>
                </div>

                <button type="button" className="form-section-title collapsible-section-header" onClick={() => setNotasCollapsed(v => !v)}>
                  <span>Notas</span>
                  <span className={`collapsible-chevron${notasCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
                </button>
                <div className={notasCollapsed ? 'collapsible-content--hidden' : ''}>
                  <div className={`form-control${errors.notas ? ' form-control--error' : ''}`}>
                    <textarea name="notas" value={fichaForm.notas} onChange={handleFichaChange} maxLength={LIMITS.notas} placeholder="Observaciones generales del trabajador..." aria-invalid={!!errors.notas} />
                    <span className="form-control-hint">{(fichaForm.notas || '').length}/{LIMITS.notas}</span>
                    {errors.notas && <span className="form-control-error">{errors.notas}</span>}
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
                {[...planillaUsers]
                  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
                  .map(u => {
                    const ficha = fichasMap[u.id] || {};
                    const subParts = [
                      ficha.cedula && `CI ${ficha.cedula}`,
                      ficha.puesto,
                      u.email,
                      u.telefono,
                      ROLE_LABELS[u.rol] || 'Trabajador',
                    ].filter(Boolean);
                    return (
                      <li
                        key={u.id}
                        className={`lote-list-item${selectedId === u.id ? ' active' : ''}`}
                        onClick={() => selectedId === u.id ? setSelectedId(null) : handleSelectEmployee(u)}
                      >
                        <div className="lote-list-info">
                          <span className="lote-list-code">{u.nombre}</span>
                          <span className="lote-list-name">{subParts.join(' · ')}</span>
                        </div>
                        <FiChevronRight size={14} className="lote-list-arrow" />
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default EmployeeProfile;
