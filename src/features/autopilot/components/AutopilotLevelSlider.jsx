import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiX, FiAlertTriangle, FiInfo } from 'react-icons/fi';

const LEVELS = [
  { id: 'off',    index: 0, short: 'Off',     label: 'Off' },
  { id: 'nivel1', index: 1, short: 'Nivel 1', label: 'Nivel 1' },
  { id: 'nivel2', index: 2, short: 'Nivel 2', label: 'Nivel 2' },
  { id: 'nivel3', index: 3, short: 'Nivel 3', label: 'Nivel 3' },
];
const LEVEL_BY_ID = Object.fromEntries(LEVELS.map(l => [l.id, l]));

const LEVEL_COPY = {
  off: {
    title: 'Desactivar Aurora Copilot',
    intro: 'Vas a desactivar Aurora Copilot.',
    body: 'Aurora dejará de analizar el estado de la finca y no generará recomendaciones ni propondrá acciones. Las sesiones autónomas programadas quedarán en pausa. Puedes reactivarlo en cualquier momento sin perder tu configuración.',
    confirmLabel: 'Desactivar',
    tone: 'neutral',
  },
  nivel1: {
    title: 'Activar Nivel 1 — Recomendaciones',
    intro: 'Vas a activar el Nivel 1 ("Recomendaciones") de Aurora Copilot.',
    body: 'Al hacerlo, Aurora leerá el estado actual del proyecto y generará recomendaciones sobre acciones específicas que podrían tomarse. Ten en cuenta en todo momento que en este nivel Aurora es sólo un sistema de recomendaciones: cualquier acción debe ser evaluada y ejecutada por ti o tu equipo de trabajo.',
    confirmLabel: 'Activar',
    tone: 'info',
  },
  nivel2: {
    title: 'Activar Nivel 2 — Agencia Supervisada',
    intro: 'Vas a activar el Nivel 2 ("Agencia Supervisada") de Aurora Copilot.',
    body: 'En este nivel, Aurora no sólo recomienda: también propone acciones concretas (crear tareas, reprogramar, ajustar inventario, enviar notificaciones, etc.) que quedarán pendientes hasta que tú o un supervisor las aprueben. Ninguna acción se ejecuta sin tu visto bueno.',
    confirmLabel: 'Activar',
    tone: 'info',
  },
  nivel3: {
    title: 'Activar Nivel 3 — Agencia Total',
    intro: 'Vas a activar el Nivel 3 ("Agencia Total") de Aurora Copilot.',
    body: 'Aurora ejecutará acciones de forma autónoma dentro de las barandillas de seguridad que hayas configurado, y te informará en tiempo real. Este es el nivel más consecuente: te recomendamos revisar las barandillas (límites por sesión, montos, lotes bloqueados, horarios) antes de continuar. Los dominios de RR.HH. y Financiamiento permanecen con revisión humana por política.',
    confirmLabel: 'Activar',
    tone: 'warning',
  },
};

export default function AutopilotLevelSlider({ mode, disabled, onChange, onNavigate, onAnalyze, objectives }) {
  const current = LEVEL_BY_ID[mode] || LEVELS[0];
  const [pendingId, setPendingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);

  const copy = pendingId ? LEVEL_COPY[pendingId] : null;
  const fillPct = (current.index / (LEVELS.length - 1)) * 100;
  const busy = saving || analyzing;

  const propose = (id) => {
    if (disabled || busy) return;
    if (id === mode) return;
    setError(null);
    setPendingId(id);
  };

  const cancel = () => {
    if (busy) return;
    setPendingId(null);
    setError(null);
  };

  const confirm = async () => {
    if (!pendingId || busy) return;
    setSaving(true);
    setError(null);
    try {
      await onChange(pendingId);
      setPendingId(null);
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el nivel.');
    } finally {
      setSaving(false);
    }
  };

  const confirmAndAnalyze = async () => {
    if (!pendingId || busy || !onAnalyze) return;
    setSaving(true);
    setError(null);
    try {
      await onChange(pendingId);
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el nivel.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setAnalyzing(true);
    try {
      await onAnalyze();
      setPendingId(null);
    } catch (err) {
      setError(err?.message || 'Nivel activado, pero el análisis falló. Intenta desde "Analizar ahora".');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!pendingId) return;
    const onKey = (e) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, busy]);

  return (
    <div
      className={`ap-level-slider ap-level-slider--${mode}${disabled ? ' ap-level-slider--disabled' : ''}`}
      style={{ '--ap-level-fill': `${fillPct}%` }}
    >
      <div className="ap-level-slider-track-wrap">
        <div className="ap-level-slider-track" aria-hidden="true" />
        <div className="ap-level-slider-fill" aria-hidden="true" />
        <div className="ap-level-slider-ticks" aria-hidden="true">
          {LEVELS.map((l) => (
            <span
              key={l.id}
              className={`ap-level-slider-tick${current.index >= l.index ? ' is-filled' : ''}`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={LEVELS.length - 1}
          step={1}
          value={current.index}
          onChange={(e) => propose(LEVELS[Number(e.target.value)].id)}
          disabled={disabled}
          aria-label="Nivel de agencia de Aurora Copilot"
          className="ap-level-slider-range"
        />
      </div>
      <div className="ap-level-slider-labels">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`ap-level-slider-label${current.index === l.index ? ' is-active' : ''} ap-level-slider-label--${l.id}`}
            onClick={() => propose(l.id)}
            disabled={disabled}
            title={disabled ? 'Sólo un supervisor puede cambiar este nivel' : `Cambiar a ${l.label}`}
          >
            {l.short}
          </button>
        ))}
      </div>

      {copy && (
        <div
          className="ap-level-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ap-level-modal-title"
          onClick={cancel}
        >
          <div
            className={`ap-level-modal ap-level-modal--${copy.tone}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ap-level-modal-header">
              <h3 id="ap-level-modal-title">{copy.title}</h3>
              <button
                type="button"
                className="ap-level-modal-close"
                onClick={cancel}
                disabled={busy}
                aria-label="Cancelar"
              >
                <FiX size={16} />
              </button>
            </div>
            <div className="ap-level-modal-body">
              <p className="ap-level-modal-intro">{copy.intro}</p>
              <p className="ap-level-modal-text">{copy.body}</p>
              {copy.tone === 'warning' && (
                <p className="ap-level-modal-warn">
                  <FiAlertTriangle size={13} />
                  <span>
                    Revisa las barandillas en{' '}
                    <Link
                      to="/autopilot/configuracion"
                      className="ap-level-modal-warn-link"
                      onClick={() => {
                        cancel();
                        if (onNavigate) onNavigate();
                      }}
                    >
                      Configuración
                    </Link>{' '}
                    antes de continuar.
                  </span>
                </p>
              )}
              {pendingId !== 'off' && !(objectives && String(objectives).trim()) && (
                <p className="ap-level-modal-info">
                  <FiInfo size={13} />
                  <span>
                    Aurora Copilot da mejores recomendaciones cuando tiene un objetivo definido. Define uno en{' '}
                    <Link
                      to="/autopilot/configuracion"
                      className="ap-level-modal-info-link"
                      onClick={() => {
                        cancel();
                        if (onNavigate) onNavigate();
                      }}
                    >
                      Configuración
                    </Link>.
                  </span>
                </p>
              )}
              {error && <p className="ap-level-modal-error">{error}</p>}
            </div>
            <div className="ap-level-modal-actions">
              <button
                type="button"
                className="ap-level-modal-cancel"
                onClick={cancel}
                disabled={busy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={`ap-level-modal-confirm ap-level-modal-confirm--${copy.tone}`}
                onClick={confirm}
                disabled={busy}
              >
                {saving ? 'Guardando…' : copy.confirmLabel}
              </button>
              {pendingId !== 'off' && onAnalyze && (
                <button
                  type="button"
                  className={`ap-level-modal-confirm ap-level-modal-confirm--${copy.tone} ap-level-modal-confirm--analyze`}
                  onClick={confirmAndAnalyze}
                  disabled={busy}
                  title="Guarda el nivel y genera un análisis inmediato"
                >
                  {analyzing ? 'Analizando…' : saving ? 'Guardando…' : 'Activar y analizar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
