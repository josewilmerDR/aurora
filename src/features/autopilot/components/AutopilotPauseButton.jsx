import { useState, useEffect, useCallback } from 'react';
import { FiPause, FiPlay, FiX, FiAlertTriangle } from 'react-icons/fi';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';

function formatTimestamp(ts) {
  if (!ts) return '';
  const ms =
    typeof ts === 'object' && ts._seconds ? ts._seconds * 1000 :
    typeof ts === 'object' && ts.seconds  ? ts.seconds * 1000 :
    typeof ts === 'string'                 ? Date.parse(ts) :
    null;
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Compact pause/resume control for the Autopilot panel header. Admin-only
 * mutation; non-admins see a read-only "Pausado" tag when the autopilot is
 * paused. Status is refetched whenever `open` flips to true.
 *
 * The pause button is hidden when mode === 'off' AND paused === false, since
 * there's nothing to pause in that state. It still renders when paused=true
 * even if mode=off, so an admin can clear a stale pause flag.
 */
export default function AutopilotPauseButton({ open, mode }) {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const isAdmin = hasMinRole(currentUser?.rol, 'administrador');

  const [status, setStatus] = useState(null);
  const [dialog, setDialog] = useState(null); // 'pause' | 'resume' | null
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/autopilot/status');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError(err.message);
    }
  }, [apiFetch]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setReason('');
    setError(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e) => { if (e.key === 'Escape') closeDialog(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, busy]);

  const submitPause = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      await refresh();
      setReason('');
      setDialog(null);
      window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitResume = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/resume', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      await refresh();
      setDialog(null);
      window.dispatchEvent(new CustomEvent('aurora-autopilot-changed'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return null;

  // Hide entirely when mode=off and not paused — nothing to pause in that state.
  // Mode-off + paused=true still renders so admins can clear the stale flag.
  if (mode === 'off' && !status.paused) return null;

  // Non-admin: read-only tag (only when paused, so the label is visible to all users).
  if (!isAdmin) {
    if (!status.paused) return null;
    return (
      <span className="aur-badge aur-badge--yellow ap-pause-tag" title="Aurora Copilot está pausado">
        <FiAlertTriangle size={11} /> Pausado
      </span>
    );
  }

  const isPause = dialog === 'pause';

  return (
    <>
      {status.paused ? (
        <button
          type="button"
          className="ap-pause-btn ap-pause-btn--resume"
          onClick={() => setDialog('resume')}
          disabled={busy}
          title={
            status.pausedByEmail
              ? `Pausado por ${status.pausedByEmail}${status.pausedAt ? ` · ${formatTimestamp(status.pausedAt)}` : ''}${status.pausedReason ? ` · "${status.pausedReason}"` : ''}`
              : 'Reanudar Aurora Copilot'
          }
        >
          <FiPlay size={13} /> Reanudar
        </button>
      ) : (
        <button
          type="button"
          className="ap-pause-btn ap-pause-btn--pause"
          onClick={() => setDialog('pause')}
          disabled={busy}
          title="Pausar Aurora Copilot"
        >
          <FiPause size={13} /> Pausar
        </button>
      )}

      {dialog && (
        <div
          className="aur-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ap-pause-dialog-title"
          onPointerDown={closeDialog}
        >
          <div
            className={`aur-modal ap-level-modal ap-level-modal--${isPause ? 'warning' : 'info'}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="aur-modal-header">
              <span className={`aur-modal-icon${isPause ? ' aur-modal-icon--warn' : ''}`}>
                {isPause ? <FiPause size={16} /> : <FiPlay size={16} />}
              </span>
              <span className="aur-modal-title" id="ap-pause-dialog-title">
                {isPause ? 'Pausar Aurora Copilot' : 'Reanudar Aurora Copilot'}
              </span>
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
                onClick={closeDialog}
                disabled={busy}
                aria-label="Cancelar"
              >
                <FiX size={16} />
              </button>
            </div>
            <div className="aur-modal-body ap-level-body">
              {isPause ? (
                <>
                  <p className="ap-level-intro">
                    Vas a pausar Aurora Copilot.
                  </p>
                  <p className="ap-level-text">
                    Mientras esté pausado, Aurora no ejecutará análisis programados ni acciones autónomas. Las propuestas ya registradas quedarán intactas y podrás reanudarlo en cualquier momento.
                  </p>
                  <div className="aur-field ap-pause-reason">
                    <label htmlFor="ap-pause-reason-input" className="aur-field-label">
                      Motivo (opcional)
                    </label>
                    <input
                      id="ap-pause-reason-input"
                      type="text"
                      placeholder="Ej: mantenimiento, revisión de barandillas…"
                      value={reason}
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={busy}
                      autoFocus
                      className="aur-input"
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="ap-level-intro">
                    ¿Reanudar Aurora Copilot?
                  </p>
                  <p className="ap-level-text">
                    Aurora volverá a ejecutar acciones según el modo configurado y las barandillas de seguridad vigentes.
                  </p>
                  {status.pausedReason && (
                    <p className="ap-level-text ap-level-text--muted">
                      Motivo de la pausa: <em>"{status.pausedReason}"</em>
                    </p>
                  )}
                </>
              )}
              {error && <p className="ap-level-error">{error}</p>}
            </div>
            <div className="aur-modal-actions">
              <button
                type="button"
                className="aur-btn-text"
                onClick={closeDialog}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`aur-btn-pill aur-btn-pill--sm${isPause ? ' ap-level-confirm--warn' : ''}`}
                onClick={isPause ? submitPause : submitResume}
                disabled={busy}
              >
                {busy
                  ? (isPause ? 'Pausando…' : 'Reanudando…')
                  : (isPause ? 'Confirmar pausa' : 'Reanudar')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
