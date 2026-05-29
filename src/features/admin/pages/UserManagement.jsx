import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/user-management.css';
import { FiEdit, FiTrash2, FiUserPlus, FiChevronRight, FiArrowLeft, FiMail, FiPhone, FiLock, FiBriefcase, FiExternalLink, FiClock, FiSearch, FiX, FiAlertTriangle } from 'react-icons/fi';
import { ROLE_LABELS, hasMinRole } from '../../../contexts/UserContext';
import { MODULES, roleCanAccessModule } from '../../../components/Sidebar';
import { useToast } from '../../../contexts/ToastContext';
import PageHeader from '../../../components/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import UserDeleteWithEmploymentModal from '../components/UserDeleteWithEmploymentModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import { useUser } from '../../../contexts/UserContext';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { translateApiError } from '../../../lib/errorMessages';
import { getInitials, firstName } from '../../../lib/names';

// Namespaced under aurora_draft_ so clearAllDrafts() (called on logout) purges
// it — the draft holds PII (email, teléfono) and must not survive logout on a
// shared machine.
const DRAFT_KEY = 'aurora_draft_user-mgmt';
const EMPTY_FORM = { id: null, nombre: '', email: '', telefono: '', rol: 'trabajador', restrictedTo: [] };
const LIMITS = { nombre: 80, email: 120, telefono: 20 };
const VALID_ROLES = ['trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;

// i18n-safe: quita acentos y baja a lowercase para que "José" matchee "jose".
const normalize = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function validate(form) {
  const errors = {};
  const nombre   = (form.nombre   || '').trim();
  const email    = (form.email    || '').trim();
  const telefono = (form.telefono || '').trim();
  if (nombre.length < 2 || nombre.length > LIMITS.nombre) errors.nombre = `2–${LIMITS.nombre} caracteres.`;
  if (!email || !EMAIL_RE.test(email) || email.length > LIMITS.email) errors.email = 'Email inválido.';
  if (telefono && (!PHONE_RE.test(telefono) || telefono.length > LIMITS.telefono)) errors.telefono = 'Teléfono inválido.';
  if (!VALID_ROLES.includes(form.rol)) errors.rol = 'Rol inválido.';
  return errors;
}
const VALID_MODULE_IDS = new Set(MODULES.map(m => m.id));

// Constante centralizada de mapping rol → variante de aur-badge.
// Reemplaza .role-badge--{ninguno,trabajador,encargado,supervisor,administrador}
// del CSS legacy + añade el caso 'rrhh' que el CSS anterior no contemplaba.
const ROLE_BADGE_VARIANT = {
  ninguno:       'aur-badge--gray',
  trabajador:    'aur-badge--gray',
  encargado:     'aur-badge--green',
  supervisor:    'aur-badge--magenta',
  rrhh:          'aur-badge--violet',
  administrador: 'aur-badge--blue',
};

function UserManagement() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const { firebaseUser, currentUser } = useUser();

  // ¿La fila es el propio usuario logueado? Match por email (único por finca y
  // siempre presente) para evitar que un admin se elimine o se baje el rol a sí
  // mismo y quede sin acceso.
  const isSelf = (user) =>
    !!firebaseUser?.email && !!user?.email &&
    firebaseUser.email.toLowerCase() === user.email.toLowerCase();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [flashId, setFlashId] = useState(null);
  // confirmDelete now distinguishes two modes: the simple AuroraConfirmModal
  // (for a pure user with no HR history) or the dual-action modal that lets
  // the admin also rescind the employment contract.
  const [confirmDelete, setConfirmDelete] = useState(null); // { user, mode: 'simple' | 'with-employment' }
  const [deleting, setDeleting] = useState(false);
  const [grantingPlanilla, setGrantingPlanilla] = useState(false);
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);
  const carouselRef = useRef(null);

  // Toast global (cola con aria-live). `opts` permite, p.ej., subir la duración
  // de la confirmación de una acción destructiva para que no se evapore.
  const pushToast = useToast();
  const showToast = (message, type = 'success', opts) => pushToast(message, { type, ...opts });

  // The page lists *system users*. People who exist only as payroll employees
  // (tieneAcceso === false) belong to the HR ficha screen and are intentionally
  // hidden here. The filter is forgiving with undefined to keep a transitional
  // safety net for any doc that pre-dates the migration.
  const accessibleUsers = useMemo(
    () => users.filter(u => u.tieneAcceso !== false),
    [users],
  );

  // visibleUsers = accessibleUsers + filtro de búsqueda (nombre, email o rol).
  // accessibleUsers.length distingue "no hay usuarios" de "la búsqueda no
  // matcheó nada" en los empty states de abajo.
  const visibleUsers = useMemo(() => {
    const q = normalize(search.trim());
    if (!q) return accessibleUsers;
    return accessibleUsers.filter(u =>
      normalize(u.nombre).includes(q) ||
      normalize(u.email).includes(q) ||
      normalize(ROLE_LABELS[u.rol] || '').includes(q)
    );
  }, [accessibleUsers, search]);

  // Cantidad de módulos que el rol actualmente elegido en el form sí alcanza.
  // Denominador del contador "X/Y" de la sección "Acceso por módulo".
  const reachableCount = useMemo(
    () => MODULES.filter(m => roleCanAccessModule(m, formData.rol)).length,
    [formData.rol],
  );

  // Auto-scroll active bubble into view on mobile
  useEffect(() => {
    if (!selectedUser || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedUser]);

  // Highlight transitorio de la fila recién guardada: en desktop la lista
  // convive con el panel, lejos del toast, así que un flash señala qué cambió.
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1500);
    return () => clearTimeout(t);
  }, [flashId]);

  // Devuelve la lista cargada (o null si falló) para que los callers que
  // necesitan el array recién traído —p.ej. handleSubmit, para reseleccionar
  // el usuario guardado— lo reusen sin duplicar el fetch.
  const fetchUsers = () => {
    setError(false);
    return apiFetch('/api/users')
      .then(res => {
        if (!res.ok) throw new Error('No se pudo cargar la lista de usuarios.');
        return res.json();
      })
      .then(data => { setUsers(data); return data; })
      .catch(() => { setError(true); return null; })
      .finally(() => setLoading(false));
  };

  // Toggle de selección compartido por la lista derecha y el carrusel móvil:
  // clic en el usuario activo lo deselecciona; clic en otro lo selecciona.
  const toggleSelectUser = (user) =>
    selectedUser?.id === user.id ? setSelectedUser(null) : handleSelectUser(user);

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
      const f = draft?.formData;
      if (!f || typeof f !== 'object') { clearDraft(); return; }
      setFormData({
        id: null,
        nombre: typeof f.nombre === 'string' ? f.nombre : '',
        email: typeof f.email === 'string' ? f.email : '',
        telefono: typeof f.telefono === 'string' ? f.telefono : '',
        rol: VALID_ROLES.includes(f.rol) ? f.rol : 'trabajador',
        restrictedTo: Array.isArray(f.restrictedTo)
          ? f.restrictedTo.filter(id => VALID_MODULE_IDS.has(id))
          : [],
      });
      setView('form');
      setIsEditing(false);
      setDraftRestored(true);
    } catch { clearDraft(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar borrador solo al crear (no al editar)
  useEffect(() => {
    if (view !== 'form' || isEditing) return;
    const { nombre, email, telefono } = formData;
    if (nombre || email || telefono) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ formData }));
      markDraftActive('user-mgmt');
    } else {
      clearDraft();
    }
  }, [formData, view, isEditing]);

  // Scroll del contenedor scrolleable de la app (la página vive dentro de
  // .content-area, no del window). Un solo target para que abrir el form y
  // seleccionar un usuario se comporten igual.
  const scrollToTop = () => {
    const area = document.querySelector('.content-area');
    (area || window).scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      // Al cambiar el rol, podan las restricciones a módulos que el nuevo rol
      // ya no alcanza: dejar ids muertos confundiría y se enviarían al backend.
      if (name === 'rol') {
        const restrictedTo = prev.restrictedTo.filter(id => {
          const mod = MODULES.find(m => m.id === id);
          return mod && roleCanAccessModule(mod, value);
        });
        return { ...prev, rol: value, restrictedTo };
      }
      return { ...prev, [name]: value };
    });
    clearField(name);
  };

  const toggleModule = (modId) => {
    setFormData(prev => {
      const has = prev.restrictedTo.includes(modId);
      const next = has
        ? prev.restrictedTo.filter(id => id !== modId)
        : [...prev.restrictedTo, modId];
      return { ...prev, restrictedTo: next };
    });
  };

  const resetForm = () => {
    clearDraft();
    setFormData(EMPTY_FORM);
    setIsEditing(false);
    setDraftRestored(false);
    setView('hub');
  };

  const handleNew = () => {
    setFormData(EMPTY_FORM);
    setIsEditing(false);
    setDraftRestored(false);
    setSelectedUser(null);
    setView('form');
    scrollToTop();
  };

  const handleSelectUser = (user) => {
    setSelectedUser(user);
    setView('hub');
    if (window.innerWidth <= 768) scrollToTop();
  };

  const handleEdit = (user) => {
    setIsEditing(true);
    setDraftRestored(false);
    setFormData({
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      telefono: user.telefono,
      rol: user.rol,
      restrictedTo: Array.isArray(user.restrictedTo)
        ? user.restrictedTo.filter(id => VALID_MODULE_IDS.has(id))
        : [],
    });
    setView('form');
    scrollToTop();
  };

  // Helper: invoke an API endpoint and surface the backend error message in
  // Spanish (via translateApiError) when it fails. Throws so the caller can
  // bail out of a multi-step flow.
  const callOrThrow = async (path, options) => {
    const res = await apiFetch(path, options);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(translateApiError(body, 'Error en la operación.'));
    }
    return res.json().catch(() => null);
  };

  // Pure-user delete: hard-delete from the backend. Only valid when the user
  // has no HR footprint (the backend enforces this; the modal mode already
  // gates it on the frontend).
  const handleDeleteSimple = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await callOrThrow(`/api/users/${confirmDelete.user.id}`, { method: 'DELETE' });
      if (selectedUser?.id === confirmDelete.user.id) setSelectedUser(null);
      setConfirmDelete(null);
      fetchUsers();
      showToast('Usuario eliminado correctamente');
    } catch (err) {
      showToast(err.message || 'Error al eliminar el usuario.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Compound delete: the target is also an employee (or was). Always revokes
  // system access; optionally also rescinds the employment contract. The two
  // API calls are sequential because revoke-planilla relies on revoke-access
  // having already cleared memberships when both apply.
  const handleDeleteWithEmployment = async ({ rescindirContrato, motivo, fechaSalida }) => {
    if (!confirmDelete) return;
    const { user } = confirmDelete;
    setDeleting(true);
    try {
      if (user.tieneAcceso !== false) {
        await callOrThrow(`/api/users/${user.id}/revoke-access`, { method: 'POST' });
      }
      if (rescindirContrato) {
        await callOrThrow(`/api/users/${user.id}/revoke-planilla`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo: motivo || '', fecha: fechaSalida }),
        });
      }
      // After revoke-access the person no longer appears in this page's list
      // (filtered by tieneAcceso). Drop the selection to avoid showing a
      // stale hub panel for someone who just disappeared.
      setSelectedUser(null);
      setConfirmDelete(null);
      fetchUsers();
      // Acción destructiva de doble efecto: duración extendida para que el
      // admin alcance a leer qué pasó antes de que el toast se cierre.
      showToast(
        rescindirContrato
          ? 'Acceso revocado y contrato rescindido.'
          : 'Acceso al sistema revocado.',
        'success',
        { duration: 7000 },
      );
    } catch (err) {
      showToast(err.message || 'Error al procesar la acción.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Click "Marcar también como empleado" from the hub panel. Promotes the
  // user to also be on payroll, then redirects to the HR ficha page so the
  // admin can fill out the employment details immediately. The redirect
  // carries the user id in router state so the ficha page can preselect
  // them (handled in paso 4; harmless to send today).
  const handleMarkAsEmployee = async (user) => {
    if (!user) return;
    setGrantingPlanilla(true);
    try {
      await callOrThrow(`/api/users/${user.id}/grant-planilla`, { method: 'POST' });
      showToast('Marcado como empleado. Completa los datos laborales.');
      navigate('/hr/ficha', { state: { selectUserId: user.id, openEdit: true } });
    } catch (err) {
      showToast(err.message || 'Error al marcar como empleado.', 'error');
    } finally {
      setGrantingPlanilla(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!validateAll(formData)) return;
    // No dejar que el admin se baje su propio rol y pierda acceso a esta
    // pantalla. hasMinRole(nuevo, actual)===false ⇒ el nuevo rol es inferior.
    if (isEditing && isSelf(formData) && currentUser?.rol && !hasMinRole(formData.rol, currentUser.rol)) {
      showToast('No podés reducir tu propio rol.', 'error');
      return;
    }
    setSubmitting(true);
    const url = isEditing ? `/api/users/${formData.id}` : '/api/users';
    const method = isEditing ? 'PUT' : 'POST';
    // This form *is* the "create a system user" flow, so tieneAcceso is
    // always true. The flag is sent explicitly so the backend can enforce
    // its email+rol cross-field rules from a single source of truth.
    const payload = { ...formData, tieneAcceso: true };
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Use the code → Spanish map (errorMessages.js) so the user sees a
        // localized message; the backend now sends English devMessages keyed
        // by ERROR_CODES (e.g., VALIDATION_FAILED, ALREADY_EXISTS, FORBIDDEN).
        throw new Error(translateApiError(data, 'Error al guardar'));
      }
      const saved = await res.json();
      const savedId = isEditing ? formData.id : saved.id;
      const newUsers = await fetchUsers();
      if (savedId && newUsers) {
        const found = newUsers.find(u => u.id === savedId);
        if (found) setSelectedUser(found);
      }
      if (savedId) setFlashId(savedId);
      resetForm();
      showToast(isEditing ? 'Usuario actualizado correctamente' : 'Usuario guardado correctamente');
    } catch (err) {
      showToast(err.message || 'Ocurrió un error al guardar.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Open the appropriate delete modal based on the user's HR history. The
  // mode flag lets us render two different modals in the JSX section below
  // without leaking the branching into the trigger sites.
  const openDeleteFlow = (user) => {
    if (isSelf(user)) {
      showToast('No podés eliminar tu propio usuario.', 'error');
      return;
    }
    const hasEmploymentHistory = user.empleadoPlanilla === true || user.tuvoEmpleo === true;
    setConfirmDelete({
      user,
      mode: hasEmploymentHistory ? 'with-employment' : 'simple',
    });
  };

  // Render the fechaSalidaPlanilla timestamp as a YYYY-MM-DD string regardless
  // of the wire format (Firestore Timestamp from the SDK, or already-serialized
  // string when proxied through the REST layer).
  const formatFechaSalida = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'string') return raw.slice(0, 10);
    if (raw._seconds) return new Date(raw._seconds * 1000).toISOString().slice(0, 10);
    if (typeof raw.toDate === 'function') return raw.toDate().toISOString().slice(0, 10);
    return null;
  };

  // ── Panel de detalle (solo lectura) ──────────────────────────────────────
  const renderHubPanel = () => {
    if (!selectedUser) return null;
    const restricted = Array.isArray(selectedUser.restrictedTo) ? selectedUser.restrictedTo : [];
    const restrictedLabels = restricted
      .map(id => MODULES.find(m => m.id === id)?.nombre)
      .filter(Boolean);
    const roleKey = selectedUser.rol || 'trabajador';
    const badgeVariant = ROLE_BADGE_VARIANT[roleKey] || 'aur-badge--gray';
    const isEmpleado = selectedUser.empleadoPlanilla === true;
    const wasEmpleado = !isEmpleado && selectedUser.tuvoEmpleo === true;
    const fechaSalida = formatFechaSalida(selectedUser.fechaSalidaPlanilla);
    const selfSelected = isSelf(selectedUser);
    return (
      <div className="lote-hub">
        <button className="lote-hub-back" onClick={() => setSelectedUser(null)}>
          <FiArrowLeft size={13} aria-hidden="true" /> Todos los usuarios
        </button>
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedUser.nombre}</h2>
            <span className={`aur-badge ${badgeVariant}`}>
              {ROLE_LABELS[roleKey] || 'Trabajador'}
            </span>
          </div>
          <div className="hub-header-actions">
            <button
              type="button"
              onClick={() => handleEdit(selectedUser)}
              className="aur-icon-btn"
              title="Editar"
              aria-label={`Editar usuario ${selectedUser.nombre}`}
            >
              <FiEdit size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => openDeleteFlow(selectedUser)}
              className="aur-icon-btn aur-icon-btn--danger"
              title={selfSelected ? 'No podés eliminar tu propio usuario' : 'Eliminar'}
              aria-label={selfSelected ? 'No podés eliminar tu propio usuario' : `Eliminar usuario ${selectedUser.nombre}`}
              disabled={selfSelected}
            >
              <FiTrash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="hub-info-pills">
          <span className="hub-pill"><FiMail size={13} aria-hidden="true" />{selectedUser.email}</span>
          {selectedUser.telefono && (
            <span className="hub-pill"><FiPhone size={13} aria-hidden="true" />{selectedUser.telefono}</span>
          )}
        </div>
        {restrictedLabels.length > 0 && (
          <div className="hub-info-pills">
            <span className="aur-badge aur-badge--blue" title="Acceso restringido a estos módulos">
              <FiLock size={11} aria-hidden="true" />Solo: {restrictedLabels.join(', ')}
            </span>
          </div>
        )}

        {/* Empleo: facet independiente del usuario. Mostrar el estado real y
            ofrecer la acción complementaria (marcar como empleado / ver ficha). */}
        <div className="usr-employment-section">
          <p className="usr-employment-title">Empleo</p>
          {isEmpleado && (
            <div className="usr-employment-row">
              <span className="aur-badge aur-badge--green">
                <FiBriefcase size={11} aria-hidden="true" /> Empleado en planilla
              </span>
              <button
                type="button"
                className="aur-btn-text usr-employment-link"
                onClick={() => navigate('/hr/ficha', { state: { selectUserId: selectedUser.id } })}
              >
                Ver ficha laboral <FiExternalLink size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {wasEmpleado && (
            <div className="usr-employment-row">
              <span
                className="aur-badge aur-badge--gray"
                title={fechaSalida ? `Contrato rescindido el ${fechaSalida}` : 'Contrato rescindido'}
              >
                <FiClock size={11} aria-hidden="true" /> Ex-empleado
                {fechaSalida && <> · {fechaSalida}</>}
              </span>
            </div>
          )}
          {!isEmpleado && !wasEmpleado && (
            <div className="usr-employment-row">
              <span className="usr-employment-hint">
                Esta persona no está en planilla.
              </span>
              <button
                type="button"
                className="aur-btn-pill aur-btn-pill--sm"
                onClick={() => handleMarkAsEmployee(selectedUser)}
                disabled={grantingPlanilla}
              >
                <FiBriefcase size={12} aria-hidden="true" />
                {grantingPlanilla ? 'Marcando…' : 'Marcar también como empleado'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`lote-page${selectedUser && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {confirmDelete?.mode === 'simple' && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar a ${confirmDelete.user.nombre}?`}
          body="Esta acción no se puede deshacer. El usuario perderá el acceso al sistema y dejará de aparecer en los listados."
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleDeleteSimple}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmDelete?.mode === 'with-employment' && (
        <UserDeleteWithEmploymentModal
          user={confirmDelete.user}
          loading={deleting}
          onConfirm={handleDeleteWithEmployment}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* --- SPINNER DE CARGA --- */}
      {loading && <div className="aur-page-loading" role="status" aria-label="Cargando usuarios" />}

      {/* --- CABECERA DE PÁGINA --- */}
      {!loading && view !== 'form' && (
        <PageHeader
          title="Gestión de Usuarios"
          actions={
            <button type="button" className="aur-btn-pill" onClick={handleNew}>
              <FiUserPlus size={14} /> Nuevo Usuario
            </button>
          }
        />
      )}

      {/* --- ESTADO DE ERROR DE CARGA --- */}
      {!loading && error && accessibleUsers.length === 0 && view !== 'form' && (
        <EmptyState
          icon={FiAlertTriangle}
          title="No se pudo cargar la lista de usuarios."
          subtitle="Probablemente hay un problema de conexión. Probá reintentar."
          action={(
            <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={fetchUsers}>
              Reintentar
            </button>
          )}
        />
      )}

      {/* --- ESTADO VACÍO --- */}
      {!loading && !error && accessibleUsers.length === 0 && view !== 'form' && (
        <EmptyState
          icon={FiUserPlus}
          title="No hay usuarios registrados."
          subtitle="Creá el primero para darle acceso al sistema."
          action={(
            <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
              <FiUserPlus size={14} /> Crear primer usuario
            </button>
          )}
        />
      )}

      {/* --- CARRUSEL MÓVIL --- */}
      {!loading && selectedUser && view === 'hub' && (
        <div className="lote-carousel" ref={carouselRef}>
          {visibleUsers.map(user => (
            <button
              key={user.id}
              className={`lote-bubble${selectedUser?.id === user.id ? ' lote-bubble--active' : ''}`}
              onClick={() => toggleSelectUser(user)}
              aria-label={user.nombre}
              aria-current={selectedUser?.id === user.id ? 'true' : undefined}
            >
              <span className="lote-bubble-avatar" aria-hidden="true">{getInitials(user.nombre)}</span>
              <span className="lote-bubble-label">{firstName(user.nombre)}</span>
            </button>
          ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNew} aria-label="Crear nuevo usuario">
            <span className="lote-bubble-avatar lote-bubble-avatar--add" aria-hidden="true">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* --- LAYOUT PRINCIPAL --- */}
      {!loading && (accessibleUsers.length > 0 || view === 'form') && (
        <div className="lote-management-layout">

          {/* Izquierda: formulario o hub de detalle */}
          {view === 'form' && (
            <div className="aur-sheet">
              <header className="aur-sheet-header">
                <div className="aur-sheet-header-text">
                  <h1 className="aur-sheet-title">{isEditing ? 'Editando Usuario' : 'Nuevo Usuario'}</h1>
                </div>
              </header>

              {!isEditing && draftRestored && (
                <div className="usr-draft-banner" role="status">
                  <span>Recuperamos un borrador sin guardar.</span>
                  <button type="button" className="aur-btn-text" onClick={resetForm}>
                    Descartar
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <section className="aur-section">
                  <div className="aur-section-header">
                    <h3>Identidad</h3>
                  </div>
                  <div className="aur-list">
                    <div className="aur-row aur-row--multiline">
                      <label className="aur-row-label" htmlFor="usr-nombre">Nombre completo</label>
                      <input
                        id="usr-nombre"
                        className={inputClass('nombre')}
                        name="nombre"
                        value={formData.nombre}
                        onChange={handleInputChange}
                        onBlur={() => blurField('nombre', formData)}
                        maxLength={LIMITS.nombre}
                        autoComplete="off"
                        required
                      />
                      {fieldErrors.nombre && <span className="aur-field-error">{fieldErrors.nombre}</span>}
                    </div>
                    <div className="aur-row aur-row--multiline">
                      <label className="aur-row-label" htmlFor="usr-email">Email</label>
                      <input
                        id="usr-email"
                        className={inputClass('email')}
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        onBlur={() => blurField('email', formData)}
                        maxLength={LIMITS.email}
                        autoComplete="off"
                        required
                      />
                      {fieldErrors.email && <span className="aur-field-error">{fieldErrors.email}</span>}
                    </div>
                    <div className="aur-row aur-row--multiline">
                      <label className="aur-row-label" htmlFor="usr-telefono">Teléfono (opcional)</label>
                      <input
                        id="usr-telefono"
                        className={inputClass('telefono')}
                        name="telefono"
                        type="tel"
                        value={formData.telefono}
                        onChange={handleInputChange}
                        onBlur={() => blurField('telefono', formData)}
                        maxLength={LIMITS.telefono}
                        autoComplete="off"
                      />
                      {fieldErrors.telefono && <span className="aur-field-error">{fieldErrors.telefono}</span>}
                    </div>
                    <div className="aur-row aur-row--multiline">
                      <label className="aur-row-label" htmlFor="usr-rol">Rol</label>
                      {/* El <select> sólo ofrece roles válidos, así que no puede
                          producir un error de validación: no lleva onBlur ni
                          inputClass (el chequeo de rol en validate() queda como
                          defensa de backend ante drafts manipulados). */}
                      <select
                        id="usr-rol"
                        className="aur-select"
                        name="rol"
                        value={formData.rol}
                        onChange={handleInputChange}
                      >
                        <option value="trabajador">Trabajador</option>
                        <option value="encargado">Encargado</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="rrhh">RR.HH.</option>
                        <option value="administrador">Administrador</option>
                      </select>
                    </div>
                  </div>
                </section>

                <section className="aur-section">
                  <div className="aur-section-header">
                    <h3>Acceso por módulo</h3>
                    <div className="usr-modules-header-right">
                      {formData.restrictedTo.length > 0 && (
                        <button
                          type="button"
                          className="aur-btn-text usr-modules-clear"
                          onClick={() => setFormData(prev => ({ ...prev, restrictedTo: [] }))}
                        >
                          Limpiar
                        </button>
                      )}
                      <span className="aur-section-count">{formData.restrictedTo.length}/{reachableCount}</span>
                    </div>
                  </div>
                  <p className="usr-modules-hint">
                    Si no marcas ninguno, el usuario verá todos los módulos que su rol permita.
                    Si marcas uno o más, solo verá esos. Los módulos que el rol no
                    alcanza aparecen deshabilitados.
                  </p>
                  <div className="aur-list">
                    {MODULES.map(mod => {
                      const reachable = roleCanAccessModule(mod, formData.rol);
                      const checked = formData.restrictedTo.includes(mod.id) && reachable;
                      return (
                        <div key={mod.id} className={`aur-row${reachable ? '' : ' usr-module-row--disabled'}`}>
                          <span className="aur-row-label">
                            {mod.nombre}
                            {!reachable && <span className="usr-module-norole"> · el rol no accede</span>}
                          </span>
                          <label className="aur-toggle">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!reachable}
                              onChange={() => toggleModule(mod.id)}
                            />
                            <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="aur-form-actions">
                  <button type="button" className="aur-btn-text" onClick={resetForm} disabled={submitting}>
                    Cancelar
                  </button>
                  <button type="submit" className="aur-btn-pill" disabled={submitting}>
                    <FiUserPlus size={14} />
                    {submitting ? 'Guardando...' : (isEditing ? 'Actualizar Usuario' : 'Guardar Usuario')}
                  </button>
                </div>
              </form>
            </div>
          )}
          {view === 'hub' && renderHubPanel()}

          {/* Derecha: lista de usuarios */}
          {view !== 'form' && (
            <div className="lote-list-panel">
              <div className="usr-list-toolbar">
                <div className="usr-search">
                  <FiSearch size={13} aria-hidden="true" />
                  <input
                    type="search"
                    className="usr-search-input"
                    placeholder="Buscar por nombre, email o rol…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    aria-label="Buscar usuarios"
                  />
                  {search && (
                    <button
                      type="button"
                      className="usr-search-clear"
                      onClick={() => setSearch('')}
                      aria-label="Limpiar búsqueda"
                    >
                      <FiX size={12} />
                    </button>
                  )}
                </div>
                <span className="usr-list-count">{visibleUsers.length} de {accessibleUsers.length}</span>
              </div>
              {visibleUsers.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={FiSearch}
                  title="Sin resultados para la búsqueda."
                />
              ) : (
                <ul className="lote-list">
                  {visibleUsers.map(user => {
                    const roleKey = user.rol || 'trabajador';
                    const badgeVariant = ROLE_BADGE_VARIANT[roleKey] || 'aur-badge--gray';
                    const isActive = selectedUser?.id === user.id;
                    return (
                      <li
                        key={user.id}
                        className={`lote-list-item${isActive ? ' active' : ''}${user.id === flashId ? ' usr-list-item--flash' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        onClick={() => toggleSelectUser(user)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleSelectUser(user);
                          }
                        }}
                      >
                        <div className="usr-list-info">
                          <span className="lote-list-code">{user.nombre}</span>
                          <span className={`aur-badge ${badgeVariant} usr-list-role`}>
                            {ROLE_LABELS[roleKey] || 'Trabajador'}
                          </span>
                        </div>
                        <FiChevronRight size={14} className="lote-list-arrow" aria-hidden="true" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default UserManagement;
