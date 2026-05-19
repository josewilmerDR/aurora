import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import '../styles/hr.css';
import { FiUserPlus } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { translateApiError } from '../../../lib/errorMessages';
import EmployeeForm from '../components/EmployeeForm';
import EmployeeHubPanel from '../components/EmployeeHubPanel';
import EmployeeTerminationModal from '../components/EmployeeTerminationModal';
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
  const location = useLocation();
  const navigate = useNavigate();
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
  const [confirmTerminate, setConfirmTerminate] = useState(null); // user being terminated
  const [terminating, setTerminating] = useState(false);
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

  // Consume the optional router state from UserManagement's "Marcar también
  // como empleado" / "Ver ficha laboral" actions. The state is one-shot: we
  // clear it via navigate(..., { replace: true }) once consumed so a manual
  // refresh on this page doesn't reapply it.
  useEffect(() => {
    const { selectUserId, openEdit } = location.state || {};
    if (!selectUserId || loading || !allUsers.length) return;
    const target = allUsers.find(u => u.id === selectUserId);
    if (!target) return;
    handleSelectEmployee(target).then(() => {
      if (openEdit) {
        setIsEditing(true);
        setView('form');
        window.scrollTo(0, 0);
      }
    });
    navigate(location.pathname, { replace: true, state: null });
  }, [loading, allUsers, location.state]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setUserForm({
      nombre: user.nombre,
      email: user.email || '',
      telefono: user.telefono || '',
      // Default rol/access values are aligned with the new model: if the
      // person has no system access we treat their rol as 'ninguno'
      // regardless of any legacy value lingering on the doc.
      rol: user.tieneAcceso === true ? (user.rol || 'trabajador') : 'ninguno',
      tieneAcceso: user.tieneAcceso === true,
    });
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

  // Terminate the employment relationship. Never hard-deletes the doc — the
  // backend rejects that when tuvoEmpleo===true, and the EmployeeTermination
  // modal is the only path here anyway. Optionally also revokes system
  // access in the same flow.
  const handleTerminate = async ({ motivo, fechaSalida, tambienQuitarAcceso }) => {
    if (!confirmTerminate) return;
    const userId = confirmTerminate.id;
    setTerminating(true);
    try {
      if (tambienQuitarAcceso && confirmTerminate.tieneAcceso === true) {
        const res = await apiFetch(`/api/users/${userId}/revoke-access`, { method: 'POST' });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(translateApiError(body, 'Error al revocar acceso.'));
        }
      }
      const res = await apiFetch(`/api/users/${userId}/revoke-planilla`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo || '', fecha: fechaSalida }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body, 'Error al rescindir contrato.'));
      }

      setSelectedId(null);
      setUserForm(EMPTY_USER);
      setFichaForm(EMPTY_FICHA);
      setConfirmTerminate(null);
      fetchUsers();
      showToast(
        tambienQuitarAcceso && confirmTerminate.tieneAcceso === true
          ? 'Contrato rescindido y acceso revocado.'
          : 'Contrato rescindido. Los registros laborales se conservan.'
      );
    } catch (err) {
      showToast(err?.message || 'Error al procesar la rescisión.', 'error');
    } finally {
      setTerminating(false);
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

  const buildUserPayload = () => {
    const tieneAcceso = userForm.tieneAcceso === true;
    return {
      nombre: userForm.nombre.trim(),
      // Send email even when access is off if the admin typed one — the
      // backend allows an optional email for payroll-only people and it's
      // useful for notifications. Sending '' explicitly clears the field
      // when the admin emptied the input.
      email: (userForm.email || '').trim().toLowerCase(),
      telefono: (userForm.telefono || '').trim(),
      rol: tieneAcceso ? userForm.rol : 'ninguno',
      tieneAcceso,
      empleadoPlanilla: true,
    };
  };

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

  // Only system users with leadership roles can be picked as encargados.
  // A payroll-only person (tieneAcceso=false) cannot supervise others because
  // they don't use the app — surfacing them in the dropdown would mislead.
  const encargados = allUsers.filter(u =>
    u.tieneAcceso !== false && ['encargado', 'supervisor', 'administrador'].includes(u.rol)
  );
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
            onRequestTerminate={setConfirmTerminate}
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

      {confirmTerminate && (
        <EmployeeTerminationModal
          user={confirmTerminate}
          loading={terminating}
          onConfirm={handleTerminate}
          onCancel={() => setConfirmTerminate(null)}
        />
      )}
    </div>
  );
}

export default EmployeeProfile;
