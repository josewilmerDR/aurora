import { useState } from 'react';
import { linkWithPopup, unlink, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider } from '../../../firebase';
import { useUser } from '../../../contexts/UserContext';
import { useReminders } from '../../../contexts/RemindersContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { FiBell, FiTrash2, FiPlus, FiX, FiCheck, FiChevronDown, FiChevronUp, FiUser, FiKey, FiInfo, FiSun, FiMoon } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useTheme } from '../../../hooks/useTheme';
import '../styles/profile.css';

const GOOGLE_PROVIDER_ID = 'google.com';
const PASSWORD_PROVIDER_ID = 'password';

const PROVIDER_BADGE_VARIANT = {
  on:  'aur-badge aur-badge--green',
  off: 'aur-badge aur-badge--gray',
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function formatReminderDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('es-CR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Profile() {
  const { firebaseUser, currentUser } = useUser();
  const apiFetch = useApiFetch();
  const { theme, setTheme } = useTheme();
  const {
    reminders, setReminders,
    doneReminders, setDoneReminders,
    loading: remindersLoading,
  } = useReminders();
  const [loading, setLoading] = useState(null); // 'link' | 'unlink' | 'reset'
  const [toast, setToast] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [markingDoneId, setMarkingDoneId] = useState(null);
  const [showCreateReminder, setShowCreateReminder] = useState(false);
  const [newReminderText, setNewReminderText] = useState('');
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [showDone, setShowDone] = useState(false);

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
    e.preventDefault();
    const text = newReminderText.trim();
    if (!text) return showToast('Describe tu recordatorio.', 'error');
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
        showToast(`Recordatorio creado para ${formatReminderDate(created.remindAt)}.`);
      } else {
        const err = await res.json().catch(() => null);
        showToast(err?.message || 'No se pudo interpretar el recordatorio. Intenta reformular.', 'error');
      }
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
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
    }
  };

  const handleMarkDone = async (id) => {
    setMarkingDoneId(id);
    try {
      const res = await apiFetch(`/api/reminders/${id}/done`, { method: 'POST' });
      if (res.ok) {
        const completed = await res.json();
        setReminders(prev => prev.filter(r => r.id !== id));
        setDoneReminders(prev => [completed, ...prev]);
      } else {
        showToast('No se pudo marcar como hecho.', 'error');
      }
    } catch { showToast('Error de conexión.', 'error'); } finally {
      setMarkingDoneId(null);
    }
  };

  const providers = firebaseUser?.providerData.map(p => p.providerId) ?? [];
  const hasGoogle = providers.includes(GOOGLE_PROVIDER_ID);
  const hasPassword = providers.includes(PASSWORD_PROVIDER_ID);

  const handleLinkGoogle = async () => {
    setLoading('link');
    try {
      await linkWithPopup(auth.currentUser, googleProvider);
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

  const handleUnlinkGoogle = async () => {
    if (!hasPassword) {
      showToast('Configura una contraseña antes de desvincular Google para no perder el acceso.', 'error');
      return;
    }
    setLoading('unlink');
    try {
      await unlink(auth.currentUser, GOOGLE_PROVIDER_ID);
      showToast('Cuenta de Google desvinculada.');
    } catch {
      showToast('No se pudo desvincular la cuenta de Google.', 'error');
    } finally {
      setLoading(null);
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
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="profile-form">
        <h2 className="profile-form-title">Mi perfil</h2>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num"><FiUser size={14} /></span>
            <h3 className="aur-section-title">Información</h3>
          </header>
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
              <div className="aur-row-content profile-theme-switch">
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
        </section>

        <section className="aur-section">
          <header className="aur-section-header">
            <span className="aur-section-num profile-reminders-icon"><FiBell size={14} /></span>
            <h3 className="aur-section-title">Mis recordatorios</h3>
            {reminders.length > 0 && <span className="aur-section-count">{reminders.length}</span>}
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
            <form onSubmit={handleCreateReminder} className="profile-reminder-create">
              <textarea
                className="aur-textarea"
                placeholder='Ej: "recuérdame hoy a las 12:30 pm revisar la fruta del lote 4"'
                value={newReminderText}
                onChange={e => setNewReminderText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleCreateReminder(e);
                  }
                }}
                rows={3}
                maxLength={500}
                autoFocus
                disabled={creatingReminder}
              />
              <div className="profile-reminder-create-footer">
                <p className="aur-field-hint">Aurora interpretará la fecha y hora</p>
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
            <p className="profile-reminder-empty">Cargando…</p>
          ) : reminders.length === 0 ? (
            <p className="profile-reminder-empty">
              No tienes recordatorios activos. Usa el botón + para crear uno o háblale a Aurora en el chat.
            </p>
          ) : (
            <ul className="aur-list">
              {reminders.map(r => (
                <li key={r.id} className="aur-row profile-reminder-row">
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
                      onClick={() => handleDeleteReminder(r.id)}
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
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => handleDeleteReminder(r.id)}
                          disabled={deletingId === r.id}
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
                <span className="profile-provider-icon" aria-hidden="true">🔑</span>
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
                    onClick={handleUnlinkGoogle}
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
    </div>
  );
}
