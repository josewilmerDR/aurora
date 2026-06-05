import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import '../styles/hr.css';
import { FiUserPlus, FiUsers } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useHrActiveEmployee } from '../../../contexts/HrContext';
import { translateApiError } from '../../../lib/errorMessages';
import EmployeeForm from '../components/EmployeeForm';
import EmployeeHubPanel from '../components/EmployeeHubPanel';
import EmployeeTerminationModal from '../components/EmployeeTerminationModal';
import { EmployeeCarousel, EmployeeListPanel } from '../components/EmployeeListPanel';
import {
  EMPTY_FICHA, EMPTY_HORARIO, EMPTY_USER, DRAFT_KEY,
  DIAS_LABORALES, validateForms, userToForm,
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
  const { activeEmployeeId, setActiveEmployee, clearActiveEmployee } = useHrActiveEmployee();
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
  // Secuencia de carga de ficha: descarta respuestas obsoletas cuando el
  // usuario cambia rápido de empleado (la última selección gana).
  const fichaReqRef = useRef(0);
  // Una sola vez por montaje: evita que la auto-selección del empleado activo
  // (contexto de dominio) vuelva a dispararse si el usuario deselecciona a mano.
  const autoSelectedRef = useRef(false);
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
    // Si llegamos con una orden de seleccionar/editar un empleado puntual
    // (router-state desde UserManagement), esa intención gana sobre cualquier
    // borrador de "nuevo empleado" a medias: no restauramos el draft acá.
    if (location.state?.selectUserId) return;
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

  // Continuidad de dominio: al entrar a la ficha sin una selección explícita,
  // pre-seleccionamos el empleado activo heredado de otra página HR. Sólo una
  // vez por montaje (autoSelectedRef) para no re-seleccionar tras un "volver".
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (loading || !allUsers.length) return;
    if (location.state?.selectUserId) return; // el flujo de router-state manda
    if (selectedId || view !== 'hub') return; // ya hay selección o estamos en form/draft
    autoSelectedRef.current = true;
    if (!activeEmployeeId) return;
    const target = allUsers.find(u => u.id === activeEmployeeId);
    if (target) handleSelectEmployee(target);
  }, [loading, allUsers, activeEmployeeId, location.state, selectedId, view]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const seq = ++fichaReqRef.current;
    try {
      const raw = await apiFetch(`/api/hr/fichas/${userId}`).then(r => r.json());
      if (seq !== fichaReqRef.current) return; // llegó tarde: ya hay otra selección
      const { id: _id, userId: _uid, fincaId: _fid, updatedAt: _ua, ...data } = raw || {};
      setFichaForm({
        ...EMPTY_FICHA,
        ...data,
        horarioSemanal: { ...EMPTY_HORARIO, ...(data.horarioSemanal || {}) },
      });
    } catch {
      if (seq === fichaReqRef.current) setFichaForm(EMPTY_FICHA);
    }
  };

  const handleSelectEmployee = async (user) => {
    setSelectedId(user.id);
    // Propaga al contexto de dominio: las demás páginas HR (asistencia, permisos,
    // planilla) heredan esta persona como "empleado activo" sin re-buscarla.
    setActiveEmployee(user.id);
    setUserForm(userToForm(user));
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
    // Al dar de alta, abrimos "Información Laboral": son los campos que dan
    // valor a la ficha (puesto, salario, ingreso) y no deben nacer escondidos.
    setLaboralCollapsed(false);
    setView('form');
    setIsEditing(false);
    window.scrollTo(0, 0);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setView('form');
    window.scrollTo(0, 0);
  };

  // Navega a otro submódulo HR propagando el empleado seleccionado por query
  // param (?empleadoId=). Cada destino lo consume para pre-filtrar/pre-seleccionar
  // a esta persona, evitando re-buscarla en cada pantalla. `path` puede traer su
  // propio query (ej: ?tab=historial), así que elegimos el separador correcto.
  const handleNavigateModule = (path) => {
    if (!selectedId) return;
    const sep = path.includes('?') ? '&' : '?';
    navigate(`${path}${sep}empleadoId=${encodeURIComponent(selectedId)}`);
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
      // Rescindido: deja de ser el "empleado activo" del dominio.
      if (activeEmployeeId === userId) clearActiveEmployee();
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
      if (orig) setUserForm(userToForm(orig));
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
      // Al CREAR, la persona nace en planilla. Al EDITAR, preservamos el
      // estado actual del doc: editar la ficha de un ex-empleado NO debe
      // re-contratarlo (re-activar planilla es exclusivo del flujo de alta).
      empleadoPlanilla: isEditing ? (selectedUser?.empleadoPlanilla === true) : true,
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
    // encargadoId no se valida (no genera error), así que no se lista acá.
    if (keys.some(k => ['puesto', 'departamento', 'fechaIngreso', 'tipoContrato', 'salarioBase', 'precioHora'].includes(k))) {
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
        // Mantenemos el subtítulo de la lista en sync sin esperar al refetch
        // (evita la ventana en que lista y hub muestran datos distintos).
        setFichasMap(prev => ({ ...prev, [selectedId]: { ...prev[selectedId], ...buildFichaPayload() } }));
        const refreshed = await fetchUsers();
        const found = refreshed.find(u => u.id === selectedId);
        if (found) setUserForm(userToForm(found));
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
        const refreshed = await fetchUsers();
        const found = refreshed.find(u => u.id === id);
        if (!fichaRes.ok) {
          // El usuario quedó creado pero la ficha falló. NO recargamos la ficha
          // (borraría lo que el admin tipeó) ni limpiamos el draft: pasamos a
          // modo edición del recién creado con los datos intactos en estado
          // para que reintente el guardado de la ficha sin re-tipear nada.
          const msg = await fichaRes.json().catch(() => ({}));
          showToast(`Empleado creado, pero la ficha no se guardó: ${msg.message || 'error'}. Revisá y volvé a guardar.`, 'error');
          setSelectedId(id);
          if (found) setUserForm(userToForm(found));
          setIsEditing(true);
          setView('form');
          return;
        }
        showToast('Empleado creado correctamente.');
        clearDraft();
        setFichasMap(prev => ({ ...prev, [id]: { ...prev[id], ...buildFichaPayload() } }));
        if (found) {
          setSelectedId(id);
          setUserForm(userToForm(found));
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
  // Memoizado: el form vive en este componente y se re-renderiza en cada
  // keystroke; sin memo recalcularíamos este filtro/lookup en cada tecla.
  const encargados = useMemo(
    () => allUsers.filter(u =>
      u.tieneAcceso !== false && ['encargado', 'supervisor', 'administrador'].includes(u.rol)
    ),
    [allUsers]
  );
  const usersById = useMemo(() => {
    const m = new Map();
    allUsers.forEach(u => m.set(u.id, u));
    return m;
  }, [allUsers]);
  const selectedUser = selectedId ? usersById.get(selectedId) : undefined;
  // Ex-empleados (rescindidos): no aparecen en planillaUsers, así que la lista
  // necesita esta fuente para poder mostrarlos bajo un toggle (ver #3).
  const exEmployees = useMemo(
    () => allUsers.filter(u => u.empleadoPlanilla !== true && u.tuvoEmpleo === true),
    [allUsers]
  );

  if (loading) {
    return (
      <div className="ficha-page-loading">
        <div className="ficha-spinner" />
      </div>
    );
  }

  // Select desde lista o carrusel. En mobile, re-tocar el seleccionado lo
  // colapsa (vuelve a la lista). En desktop NO deseleccionamos: dejaría el
  // panel de detalle en blanco, lo cual se lee como un bug.
  const handleListSelect = (user) => {
    if (selectedId === user.id) {
      if (window.innerWidth <= 768) setSelectedId(null);
      return;
    }
    handleSelectEmployee(user);
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

        {view === 'hub' && selectedUser && (
          <EmployeeHubPanel
            selectedUser={selectedUser}
            fichaForm={fichaForm}
            allUsers={allUsers}
            onBack={() => setSelectedId(null)}
            onEdit={handleEdit}
            onRequestTerminate={setConfirmTerminate}
            onNavigateModule={handleNavigateModule}
          />
        )}

        {view === 'hub' && !selectedUser && (
          <div className="lote-hub lote-hub--idle">
            <div className="empty-state">
              <FiUsers size={36} />
              <p>Seleccioná un empleado de la lista para ver su ficha, o creá uno nuevo.</p>
            </div>
          </div>
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
            exEmployees={exEmployees}
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
