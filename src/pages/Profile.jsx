import { useState, useEffect, useCallback } from 'react';
import { linkWithPopup, unlink, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { FiBell, FiTrash2 } from 'react-icons/fi';
import Toast from '../components/Toast';
import './Profile.css';

const GOOGLE_PROVIDER_ID = 'google.com';
const PASSWORD_PROVIDER_ID = 'password';

function formatReminderDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('es-CR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Profile() {
  const { firebaseUser, currentUser } = useUser();
  const apiFetch = useApiFetch();
  const [loading, setLoading] = useState(null); // 'link' | 'unlink' | 'reset'
  const [toast, setToast] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const loadReminders = useCallback(async () => {
    setRemindersLoading(true);
    try {
      const res = await apiFetch('/api/reminders');
      if (res.ok) setReminders(await res.json());
    } catch { /* ignore */ } finally {
      setRemindersLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { loadReminders(); }, [loadReminders]);

  const handleDeleteReminder = async (id) => {
    setDeletingId(id);
    try {
      const res = await apiFetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (res.ok) setReminders(prev => prev.filter(r => r.id !== id));
      else showToast('No se pudo eliminar el recordatorio.', 'error');
    } catch { showToast('Error de conexión.', 'error'); } finally {
      setDeletingId(null);
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

      <div className="form-card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginBottom: '1.5rem' }}>Mi perfil</h2>

        {/* Datos básicos */}
        <p className="form-section-title" style={{ marginTop: 0 }}>Información</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '2rem', color: 'var(--aurora-light)', fontSize: '0.9rem', opacity: 0.85 }}>
          <span><strong>Nombre:</strong> {currentUser?.nombre || '—'}</span>
          <span><strong>Correo:</strong> {firebaseUser?.email || '—'}</span>
          <span><strong>Rol:</strong> {currentUser?.rol || '—'}</span>
        </div>

        {/* Métodos de acceso */}
        <p className="form-section-title">Métodos de acceso</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>

          {/* Email / contraseña */}
          <div className="provider-row">
            <div className="provider-info">
              <span className="provider-icon">🔑</span>
              <div>
                <span className="provider-name">Correo y contraseña</span>
                {hasPassword
                  ? <span className="provider-badge active">Activo</span>
                  : <span className="provider-badge inactive">No configurado</span>
                }
              </div>
            </div>
            {hasPassword && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handlePasswordReset}
                disabled={loading === 'reset'}
              >
                {loading === 'reset' ? 'Enviando...' : 'Restablecer contraseña'}
              </button>
            )}
          </div>

          {/* Google */}
          <div className="provider-row">
            <div className="provider-info">
              <span className="provider-icon">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                  <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                  <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                  <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                </svg>
              </span>
              <div>
                <span className="provider-name">Google</span>
                {hasGoogle
                  ? <span className="provider-badge active">Vinculado</span>
                  : <span className="provider-badge inactive">No vinculado</span>
                }
              </div>
            </div>
            {hasGoogle ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleUnlinkGoogle}
                disabled={loading === 'unlink'}
              >
                {loading === 'unlink' ? 'Desvinculando...' : 'Desvincular'}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleLinkGoogle}
                disabled={loading === 'link'}
              >
                {loading === 'link' ? 'Vinculando...' : 'Vincular Google'}
              </button>
            )}
          </div>
        </div>

        {!hasGoogle && hasPassword && (
          <p style={{ fontSize: '0.78rem', color: 'var(--aurora-light)', opacity: 0.5, lineHeight: 1.5 }}>
            Vincula tu cuenta de Google para poder iniciar sesión con ambos métodos sin necesidad de recordar tu contraseña.
          </p>
        )}
      </div>

      {/* Mis Recordatorios */}
      <div className="form-card" style={{ maxWidth: 520, marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <FiBell size={16} style={{ color: '#f59e0b' }} />
          <h2 style={{ margin: 0 }}>Mis recordatorios</h2>
        </div>

        {remindersLoading ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aurora-light)', opacity: 0.5 }}>Cargando…</p>
        ) : reminders.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--aurora-light)', opacity: 0.5 }}>
            No tienes recordatorios activos. Puedes crear uno hablándole a Aurora en el chat.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {reminders.map(r => (
              <div key={r.id} className="provider-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1 }}>
                  <span style={{ fontSize: '0.88rem', color: 'var(--aurora-light)', fontWeight: 500 }}>{r.message}</span>
                  <span style={{ fontSize: '0.76rem', color: '#f59e0b', opacity: 0.85 }}>{formatReminderDate(r.remindAt)}</span>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleDeleteReminder(r.id)}
                  disabled={deletingId === r.id}
                  title="Eliminar recordatorio"
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}
                >
                  <FiTrash2 size={13} />
                  {deletingId === r.id ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
