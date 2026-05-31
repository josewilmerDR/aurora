import { useState, useRef, useEffect } from 'react';
import { linkWithPopup, unlink, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { useReminders } from '../../../contexts/RemindersContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { FiBell, FiTrash2, FiPlus, FiX, FiCheck, FiChevronDown, FiChevronUp, FiUser, FiKey, FiInfo, FiSun, FiMoon, FiRotateCcw } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import GoogleIcon from '../../../components/ui/GoogleIcon';
import { formatReminderDate } from '../../../lib/reminderFormat';
import { translateApiError } from '../../../lib/errorMessages';
import { useTheme } from '../../../hooks/useTheme';
import '../styles/profile.css';

const GOOGLE_PROVIDER_ID = 'google.com';
const PASSWORD_PROVIDER_ID = 'password';

const PROVIDER_BADGE_VARIANT = {
  on:  'aur-badge aur-badge--green',
  off: 'aur-badge aur-badge--gray',
};

// MODELO DE EDICIÓN (divergencia intencional con AccountSettings): esta página
// aplica cada acción de inmediato y por fila (cambiar tema, vincular/desvincular
// Google, crear/completar/eliminar recordatorio) porque son operaciones
// individuales e idempotentes — no hay un "modo edición" global ni un botón
// Guardar. AccountSettings, en cambio, usa Editar→Guardar con dirty-state
// porque escribe un doc de config compartido y multi-campo de forma atómica.
// No unificar a ciegas: la asimetría entre las dos páginas del dominio es
// deliberada.
export default function Profile({ onClose }) {
  const { firebaseUser, currentUser } = useUser();
  const apiFetch = useApiFetch();
  const { theme, setTheme } = useTheme();
  const {
    reminders, setReminders,
    doneReminders, setDoneReminders,
    loading: remindersLoading,
    error: remindersError,
    overdueCount,
    reload: reloadReminders,
  } = useReminders();
  const [loading, setLoading] = useState(null); // 'link' | 'unlink' | 'reset'
  const [toast, setToast] = useState(null);
  // deletingId/markingDoneId son por-id (no globales): bloquean solo la row en
  // vuelo, no toda la lista. Activos y hechos comparten deletingId pero los ids
  // de reminders son únicos entre ambas listas, así que no colisionan.
  const [deletingId, setDeletingId] = useState(null);
  const [markingDoneId, setMarkingDoneId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // reminder pendiente de confirmar borrado
  const [confirmUnlink, setConfirmUnlink] = useState(false); // confirmar desvincular Google
  const [highlightId, setHighlightId] = useState(null);      // row recién creada (flash)
  const [showCreateReminder, setShowCreateReminder] = useState(false);
  const [newReminderText, setNewReminderText] = useState('');
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const createFormRef = useRef(null);
  const submittingReminderRef = useRef(false); // guard síncrono anti doble-submit

  // providerData del firebaseUser del context no se re-renderiza tras link/unlink
  // (linkWithPopup muta auth.currentUser en sitio). Mantenemos copia local que
  // re-sincronizamos manualmente tras cada acción para que badges y botones
  // reflejen el estado real sin esperar un refresh.
  const [providers, setProviders] = useState(() => firebaseUser?.providerData.map(p => p.providerId) ?? []);
  useEffect(() => {
    setProviders(firebaseUser?.providerData.map(p => p.providerId) ?? []);
  }, [firebaseUser]);
  const syncProviders = () => setProviders(auth.currentUser?.providerData.map(p => p.providerId) ?? []);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const openCreateReminder = () => {
    setNewReminderText('');
    setShowCreateReminder(true);
  };

  const cancelCreateReminder = () => {
    setShowCreateReminder(false);
    setNewReminderText('');
  };

  const handleCreateReminder = async (e) => {
    e?.preventDefault();
    // Guard síncrono: setCreatingReminder es async respecto al render, y el
    // parse de Claude es lento → sin esto un Enter + click en "Crear" dispara
    // dos POST y crea recordatorios duplicados.
    if (submittingReminderRef.current) return;
    const text = newReminderText.trim();
    if (!text) return showToast('Describe tu recordatorio.', 'error');
    submittingReminderRef.current = true;
    setCreatingReminder(true);
    try {
      const now = new Date();
      const res = await apiFetch('/api/reminders/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          clientTime: now.toISOString(),
          clientTzName: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientTzOffset: now.getTimezoneOffset(),
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setReminders(prev => [...prev, created].sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt)));
        cancelCreateReminder();
        // Flash de la row recién creada: entra ordenada por fecha (en medio de
        // la lista), así que el toast solo no basta para ubicarla.
        setHighlightId(created.id);
        setTimeout(() => setHighlightId(curr => (curr === created.id ? null : curr)), 2200);
        showToast(`Recordatorio creado para ${formatReminderDate(created.remindAt)}.`);
      } else {
        const err = await res.json().catch(() => null);
        showToast(translateApiError(err, 'No se pudo interpretar el recordatorio. Intenta reformular.'), 'error');
      }
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      submittingReminderRef.current = false;
      setCreatingReminder(false);
    }
  };

  const handleDeleteReminder = async (id) => {
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setReminders(prev => prev.filter(r => r.id !== id));
        setDoneReminders(prev => prev.filter(r => r.id !== id));
      } else {
        showToast('No se pudo eliminar el recordatorio.', 'error');
      }
    } catch { showToast('Error de conexión.', 'error'); } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  };

  // Ordena la lista de hechos por completedAt desc, igual que el backend
  // (GET /api/reminders/done) — así el orden no depende de en qué sesión se
  // marcó cada uno y se mantiene tras un reload.
  const sortByCompleted = (list) =>
    [...list].sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));

  const handleMarkDone = async (id) => {
    setMarkingDoneId(id);
    try {
      const res = await apiFetch(`/api/reminders/${id}/done`, { method: 'POST' });
      if (res.ok) {
        const completed = await res.json();
        setReminders(prev => prev.filter(r => r.id !== id));
        setDoneReminders(prev => sortByCompleted([completed, ...prev]));
      } else {
        showToast('No se pudo marcar como hecho.', 'error');
      }
    } catch { showToast('Error de conexión.', 'error'); } finally {
      setMarkingDoneId(null);
    }
  };

  const handleReactivateReminder = async (id) => {
    setMarkingDoneId(id);
    try {
      const res = await apiFetch(`/api/reminders/${id}/undone`, { method: 'POST' });
      if (res.ok) {
        const reactivated = await res.json();
        setDoneReminders(prev => prev.filter(r => r.id !== id));
        setReminders(prev => [...prev, reactivated].sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt)));
        showToast('Recordatorio reactivado.');
      } else {
        showToast('No se pudo reactivar el recordatorio.', 'error');
      }
    } catch { showToast('Error de conexión.', 'error'); } finally {
      setMarkingDoneId(null);
    }
  };

  const hasGoogle = providers.includes(GOOGLE_PROVIDER_ID);
  const hasPassword = providers.includes(PASSWORD_PROVIDER_ID);

  const handleLinkGoogle = async () => {
    setLoading('link');
    try {
      await linkWithPopup(auth.currentUser, googleProvider);
      await auth.currentUser.reload();
      syncProviders();
      showToast('Cuenta de Google vinculada correctamente.');
    } catch (err) {
      if (err.code === 'auth/credential-already-in-use' || err.code === 'auth/email-already-in-use') {
        showToast('Esta cuenta de Google ya está asociada a otro usuario.', 'error');
      } else if (err.code === 'auth/popup-closed-by-user') {
        // no-op
      } else {
        showToast('No se pudo vincular la cuenta de Google.', 'error');
      }
    } finally {
      setLoading(null);
    }
  };

  const requestUnlinkGoogle = () => {
    if (!hasPassword) {
      showToast('Configura una contraseña antes de desvincular Google para no perder el acceso.', 'error');
      return;
    }
    setConfirmUnlink(true);
  };

  const handleUnlinkGoogle = async () => {
    setLoading('unlink');
    try {
      await unlink(auth.currentUser, GOOGLE_PROVIDER_ID);
      syncProviders();
      showToast('Cuenta de Google desvinculada.');
    } catch {
      showToast('No se pudo desvincular la cuenta de Google.', 'error');
    } finally {
      setLoading(null);
      setConfirmUnlink(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!firebaseUser?.email) return;
    setLoading('reset');
    try {
      await sendPasswordResetEmail(auth, firebaseUser.email);
      showToast(`Se envió un enlace para restablecer la contraseña a ${firebaseUser.email}.`);
    } catch {
      showToast('No se pudo enviar el correo. Intenta de nuevo.', 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="aur-sheet">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="profile-form">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Mi perfil</h2>
            <p className="aur-sheet-subtitle">Tus datos, preferencias y recordatorios personales.</p>
          </div>
          {onClose && (
            <div className="aur-sheet-header-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={onClose}
                title="Cerrar"
                aria-label="Cerrar"
              >
                <FiX size={16} />
              </button>
            </div>
          )}
        </header>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiUser size={14} /></span>
            <h3 className="aur-section-title">Información</h3>
          </header>
          {/* Fuentes distintas a propósito: nombre/rol salen del doc Firestore
              (currentUser), email del Firebase Auth user (firebaseUser) — que es
              donde se cambia y verifica. Si llegaran a divergir, manda Auth. */}
          <ul className="aur-list">
            <li className="aur-row">
              <span className="aur-row-label">Nombre</span>
              <span>{currentUser?.nombre || '—'}</span>
            </li>
            <li className="aur-row">
              <span className="aur-row-label">Correo</span>
              <span>{firebaseUser?.email || '—'}</span>
            </li>
            <li className="aur-row">
              <span className="aur-row-label">Rol</span>
              <span>{currentUser?.rol || '—'}</span>
            </li>
          </ul>
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num">{theme === 'light' ? <FiSun size={14} /> : <FiMoon size={14} />}</span>
            <h3 className="aur-section-title">Apariencia</h3>
          </header>
          <ul className="aur-list">
            <li className="aur-row aur-row--action">
              <span className="aur-row-label">Tema</span>
              <div className="aur-row-content profile-theme-switch" role="group" aria-label="Tema">
                <button
                  type="button"
                  className={`aur-chip${theme === 'dark' ? ' is-active' : ''}`}
                  onClick={() => setTheme('dark')}
                  aria-pressed={theme === 'dark'}
                >
                  <FiMoon size={13} /> Oscuro
                </button>
                <button
                  type="button"
                  className={`aur-chip${theme === 'light' ? ' is-active' : ''}`}
                  onClick={() => setTheme('light')}
                  aria-pressed={theme === 'light'}
                >
                  <FiSun size={13} /> Claro
                </button>
              </div>
            </li>
          </ul>
          <p className="aur-field-hint profile-theme-hint">Se aplica solo en este dispositivo.</p>
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num profile-reminders-icon"><FiBell size={14} /></span>
            <h3 className="aur-section-title">Mis recordatorios</h3>
            {reminders.length > 0 && <span className="aur-section-count">{reminders.length}</span>}
            {overdueCount > 0 && (
              <span className="aur-section-count profile-overdue-count">{overdueCount} vencido{overdueCount === 1 ? '' : 's'}</span>
            )}
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={showCreateReminder ? cancelCreateReminder : openCreateReminder}
                title={showCreateReminder ? 'Cancelar' : 'Crear recordatorio'}
                aria-label={showCreateReminder ? 'Cancelar' : 'Crear recordatorio'}
              >
                {showCreateReminder ? <FiX size={14} /> : <FiPlus size={14} />}
              </button>
            </div>
          </header>

          {showCreateReminder && (
            <form ref={createFormRef} onSubmit={handleCreateReminder} className="profile-reminder-create">
              <textarea
                className="aur-textarea"
                placeholder='Ej: "recuérdame hoy a las 12:30 pm revisar la fruta del lote 4"'
                value={newReminderText}
                onChange={e => setNewReminderText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    createFormRef.current?.requestSubmit();
                  }
                }}
                rows={3}
                maxLength={500}
                autoFocus
                disabled={creatingReminder}
              />
              <div className="profile-reminder-create-footer">
                <p className="aur-field-hint">Aurora interpretará la fecha y hora · {newReminderText.length}/500</p>
                <div className="aur-form-actions profile-reminder-create-actions">
                  <button type="button" className="aur-btn-text" onClick={cancelCreateReminder} disabled={creatingReminder}>
                    Cancelar
                  </button>
                  <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={creatingReminder}>
                    {creatingReminder ? 'Creando…' : 'Crear'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {remindersLoading ? (
            <AuroraSkeleton variant="row" count={2} label="Cargando recordatorios…" />
          ) : remindersError ? (
            <p className="profile-reminder-empty profile-reminder-error">
              No se pudieron cargar tus recordatorios.{' '}
              <button type="button" className="aur-btn-text" onClick={() => reloadReminders()}>
                Reintentar
              </button>
            </p>
          ) : reminders.length === 0 ? (
            <p className="profile-reminder-empty">
              No tienes recordatorios activos. Usa el botón + para crear uno.
            </p>
          ) : (
            <ul className="aur-list">
              {reminders.map(r => (
                <li key={r.id} className={`aur-row profile-reminder-row${r.id === highlightId ? ' profile-reminder-row--new' : ''}`}>
                  <div className="profile-reminder-content">
                    <span className="profile-reminder-message">{r.message}</span>
                    <span className="profile-reminder-date">{formatReminderDate(r.remindAt)}</span>
                  </div>
                  <div className="profile-reminder-actions">
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success"
                      onClick={() => handleMarkDone(r.id)}
                      disabled={markingDoneId === r.id || deletingId === r.id}
                      title="Marcar como hecho"
                      aria-label="Marcar como hecho"
                    >
                      <FiCheck size={14} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                      onClick={() => setConfirmDelete(r)}
                      disabled={deletingId === r.id || markingDoneId === r.id}
                      title="Eliminar recordatorio"
                      aria-label="Eliminar recordatorio"
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {doneReminders.length > 0 && (
            <div className="profile-reminders-done">
              <button
                type="button"
                className="aur-btn-text profile-reminders-done-toggle"
                onClick={() => setShowDone(v => !v)}
              >
                {showDone ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                {showDone ? 'Ocultar hechos' : 'Mostrar hechos'}
                <span className="profile-reminders-done-count">({doneReminders.length})</span>
              </button>

              {showDone && (
                <ul className="aur-list profile-reminders-done-list">
                  {doneReminders.map(r => (
                    <li key={r.id} className="aur-row profile-reminder-row profile-reminder-row--done">
                      <div className="profile-reminder-content">
                        <span className="profile-reminder-message">{r.message}</span>
                        <span className="profile-reminder-date profile-reminder-date--done">
                          Programado para {formatReminderDate(r.remindAt)}
                        </span>
                      </div>
                      <div className="profile-reminder-actions">
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm"
                          onClick={() => handleReactivateReminder(r.id)}
                          disabled={markingDoneId === r.id || deletingId === r.id}
                          title="Reactivar"
                          aria-label="Reactivar recordatorio"
                        >
                          <FiRotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => setConfirmDelete(r)}
                          disabled={deletingId === r.id || markingDoneId === r.id}
                          title="Eliminar definitivamente"
                          aria-label="Eliminar definitivamente"
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiKey size={14} /></span>
            <h3 className="aur-section-title">Métodos de acceso</h3>
          </header>
          <ul className="aur-list">
            <li className="aur-row aur-row--action profile-provider-row">
              <span className="aur-row-label profile-provider-label">
                <span className="profile-provider-icon" aria-hidden="true"><FiKey size={16} /></span>
                <span>Correo y contraseña</span>
              </span>
              <div className="aur-row-content">
                <span className={hasPassword ? PROVIDER_BADGE_VARIANT.on : PROVIDER_BADGE_VARIANT.off}>
                  {hasPassword ? 'Activo' : 'No configurado'}
                </span>
                {hasPassword && (
                  <button
                    type="button"
                    className="aur-btn-text"
                    onClick={handlePasswordReset}
                    disabled={loading === 'reset'}
                  >
                    {loading === 'reset' ? 'Enviando…' : 'Restablecer contraseña'}
                  </button>
                )}
              </div>
            </li>

            <li className="aur-row aur-row--action profile-provider-row">
              <span className="aur-row-label profile-provider-label">
                <span className="profile-provider-icon" aria-hidden="true"><GoogleIcon /></span>
                <span>Google</span>
              </span>
              <div className="aur-row-content">
                <span className={hasGoogle ? PROVIDER_BADGE_VARIANT.on : PROVIDER_BADGE_VARIANT.off}>
                  {hasGoogle ? 'Vinculado' : 'No vinculado'}
                </span>
                {hasGoogle ? (
                  <button
                    type="button"
                    className="aur-btn-text"
                    onClick={requestUnlinkGoogle}
                    disabled={loading === 'unlink'}
                  >
                    {loading === 'unlink' ? 'Desvinculando…' : 'Desvincular'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={handleLinkGoogle}
                    disabled={loading === 'link'}
                  >
                    {loading === 'link' ? 'Vinculando…' : 'Vincular'}
                  </button>
                )}
              </div>
            </li>
          </ul>

          {!hasGoogle && hasPassword && (
            <div className="aur-banner aur-banner--info profile-section-footnote">
              <FiInfo size={14} />
              <span>Vincula tu cuenta de Google para poder iniciar sesión con ambos métodos sin necesidad de recordar tu contraseña.</span>
            </div>
          )}
        </section>
      </div>

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar recordatorio"
          body={`Se eliminará «${confirmDelete.message}» (${formatReminderDate(confirmDelete.remindAt)}). Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          loading={deletingId === confirmDelete.id}
          loadingLabel="Eliminando…"
          onConfirm={() => handleDeleteReminder(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {confirmUnlink && (
        <AuroraConfirmModal
          danger
          title="Desvincular Google"
          body="Ya no podrás iniciar sesión con Google. Seguirás entrando con tu correo y contraseña."
          confirmLabel="Desvincular"
          loading={loading === 'unlink'}
          loadingLabel="Desvinculando…"
          onConfirm={handleUnlinkGoogle}
          onCancel={() => setConfirmUnlink(false)}
        />
      )}
    </div>
  );
}
