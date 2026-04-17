import { useState, useEffect, useCallback } from 'react';
import { FiPause, FiPlay, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import { useUser, hasMinRole } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { translateApiError } from '../lib/errorMessages';
import './AutopilotKillSwitch.css';

/**
 * Visualizes the Autopilot pause status and exposes the pause / resume
 * controls. Status is fetched on mount; admins (rol = administrador) get
 * the controls, anyone else only sees the banner.
 *
 * Props:
 *   onChange?: (status) => void   Called whenever the local status changes,
 *                                  so a parent page can react to pause state.
 */
export default function AutopilotKillSwitch({ onChange }) {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const isAdmin = hasMinRole(currentUser?.rol, 'administrador');

  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [showPauseForm, setShowPauseForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/autopilot/status');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      const data = await res.json();
      setStatus(data);
      onChange?.(data);
    } catch (err) {
      setError(err.message);
    }
  }, [apiFetch, onChange]);

  useEffect(() => { refresh(); }, [refresh]);

  const handlePause = async () => {
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
      setReason('');
      setShowPauseForm(false);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    if (!window.confirm('¿Reanudar el Piloto Automático? Volverá a ejecutar acciones según el modo configurado.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/resume', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(translateApiError(body));
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return null;

  return (
    <div className={`ap-killswitch ${status.paused ? 'ap-killswitch--paused' : 'ap-killswitch--active'}`}>
      <div className="ap-killswitch-header">
        {status.paused
          ? <FiAlertTriangle size={18} className="ap-killswitch-icon" />
          : <FiCheckCircle size={18} className="ap-killswitch-icon" />}

        <div className="ap-killswitch-text">
          <strong>
            {status.paused ? 'Piloto Automático PAUSADO' : 'Piloto Automático activo'}
          </strong>
          {status.paused && (
            <span className="ap-killswitch-detail">
              Pausado por {status.pausedByEmail || 'administrador'}
              {status.pausedAt ? ` · ${formatTimestamp(status.pausedAt)}` : ''}
              {status.pausedReason ? ` · "${status.pausedReason}"` : ''}
            </span>
          )}
        </div>

        {isAdmin && !status.paused && !showPauseForm && (
          <button type="button" className="btn btn-danger" onClick={() => setShowPauseForm(true)} disabled={busy}>
            <FiPause size={14} /> Pausar
          </button>
        )}
        {isAdmin && status.paused && (
          <button type="button" className="btn btn-primary" onClick={handleResume} disabled={busy}>
            <FiPlay size={14} /> {busy ? 'Reanudando…' : 'Reanudar'}
          </button>
        )}
      </div>

      {isAdmin && !status.paused && showPauseForm && (
        <div className="ap-killswitch-form">
          <input
            type="text"
            placeholder="Motivo (opcional, máx. 500 caracteres)"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div className="ap-killswitch-form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setShowPauseForm(false); setReason(''); }}
              disabled={busy}
            >
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={handlePause} disabled={busy}>
              {busy ? 'Pausando…' : 'Confirmar pausa'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="ap-killswitch-error">{error}</div>}
    </div>
  );
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const ms =
    typeof ts === 'object' && ts._seconds ? ts._seconds * 1000 :
    typeof ts === 'object' && ts.seconds  ? ts.seconds * 1000 :
    typeof ts === 'string'                 ? Date.parse(ts) :
    null;
  if (!ms) return '';
  return new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}
