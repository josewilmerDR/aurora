import { useState, useEffect, useRef } from 'react';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import '../styles/hr.css';
import { FiUserPlus } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import EmployeeForm from '../components/EmployeeForm';
import EmployeeHubPanel from '../components/EmployeeHubPanel';
import { EmployeeCarousel, EmployeeListPanel } from '../components/EmployeeListPanel';
import {
  EMPTY_FICHA, EMPTY_HORARIO, EMPTY_USER, DRAFT_KEY,
  DIAS_LABORALES, validateForms,
} from '../lib/employeeProfileShared';

// EmployeeProfile orquesta el flujo: lista → detalle → formulario.
// La UI grande está extraída a 3 componentes:
//   - EmployeeForm       — formulario completo (Personal + Laboral + Horario + Contacto + Notas)
//   - EmployeeHubPanel   — vista detalle solo lectura
//   - EmployeeListPanel  — lista lateral + carrusel móvil
// State, fetch y save flow viven aquí porque son responsabilidad de la página.

function EmployeeProfile() {
  const apiFetch = useApiFetch();
  const { currentUser, refreshCurrentUser } = useUser();
  const [allUsers, setAllUsers] = useState([]);
  const [planillaUsers, setPlanillaUsers] = useState([]);
  const [fichasMap, setFichasMap] = useState({});
  const [view, setView] = useState('hub'); // 'hub' | 'form'
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
  const [confirmDelete, setConfirmDelete] = useState(null);
  const formRef = useRef(null);
  const carouselRef = useRef(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Auto-scroll del bubble activo en mobile
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

  if (loading) {
    return (
      <div className="ficha-page-loading">
        <div className="ficha-spinner" />
      </div>
    );
  }

  // Toggle/select desde lista o carrusel: si ya está seleccionado, deseleccionar.
  const handleListSelect = (user) => {
    if (selectedId === user.id) setSelectedId(null);
    else handleSelectEmployee(user);
  };

  return (
    <div className={`lote-page${selectedId && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {selectedId && view === 'hub' && (
        <EmployeeCarousel
          planillaUsers={planillaUsers}
          selectedId={selectedId}
          onSelect={handleListSelect}
          onNew={handleNew}
          carouselRef={carouselRef}
        />
      )}

      {view !== 'form' && (
        <div className="ficha-page-header">
          <div className="lote-page-title-block">
            <h2 className="ficha-page-title">Ficha del Trabajador</h2>
            <p className="lote-page-hint">
              Datos personales, laborales y de horario de cada empleado en planilla.
            </p>
          </div>
          <button className="aur-btn-pill" onClick={handleNew}>
            <FiUserPlus /> Nuevo Empleado
          </button>
        </div>
      )}

      <div className="lote-management-layout">

        {view === 'hub' && (
          <EmployeeHubPanel
            selectedUser={selectedUser}
            fichaForm={fichaForm}
            allUsers={allUsers}
            onBack={() => setSelectedId(null)}
            onEdit={handleEdit}
            onRequestDelete={setConfirmDelete}
          />
        )}

        {view === 'form' && (
          <EmployeeForm
            userForm={userForm}
            fichaForm={fichaForm}
            errors={errors}
            isEditing={isEditing}
            selectedUser={selectedUser}
            saving={saving}
            encargados={encargados}
            formRef={formRef}
            laboralCollapsed={laboralCollapsed}
            setLaboralCollapsed={setLaboralCollapsed}
            horarioCollapsed={horarioCollapsed}
            setHorarioCollapsed={setHorarioCollapsed}
            contactoCollapsed={contactoCollapsed}
            setContactoCollapsed={setContactoCollapsed}
            notasCollapsed={notasCollapsed}
            setNotasCollapsed={setNotasCollapsed}
            horarioDefault={horarioDefault}
            setHorarioDefault={setHorarioDefault}
            onUserChange={handleUserChange}
            onFichaChange={handleFichaChange}
            onHorarioChange={handleHorarioChange}
            onAplicarHorarioLV={aplicarHorarioLV}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        )}

        {view !== 'form' && (
          <EmployeeListPanel
            planillaUsers={planillaUsers}
            fichasMap={fichasMap}
            selectedId={selectedId}
            onSelect={handleListSelect}
          />
        )}

      </div>

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar empleado"
          body={`¿Eliminar a "${confirmDelete.nombre}" del sistema? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default EmployeeProfile;
