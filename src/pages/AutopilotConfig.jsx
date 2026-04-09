import { useState, useEffect, useCallback } from 'react';
import { FiSave, FiCheck, FiCpu } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './AutopilotDashboard.css';

const MODE_OPTIONS = [
  {
    id: 'off',
    label: 'Desactivado',
    description: 'El Piloto Automático no realiza ningún análisis.',
    disabled: false,
  },
  {
    id: 'nivel1',
    label: 'Nivel 1 — Recomendaciones',
    description: 'Analiza el estado de la finca y genera recomendaciones priorizadas cuando lo solicites.',
    disabled: false,
  },
  {
    id: 'nivel2',
    label: 'Nivel 2 — Agencia Supervisada',
    description: 'Propone acciones concretas y espera tu aprobación antes de ejecutarlas.',
    disabled: true,
  },
  {
    id: 'nivel3',
    label: 'Nivel 3 — Agencia Total',
    description: 'Ejecuta acciones autónomamente e informa al productor en tiempo real.',
    disabled: true,
  },
];

export default function AutopilotConfig() {
  const apiFetch = useApiFetch();

  const [config, setConfig] = useState({ mode: 'off', objectives: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/autopilot/config')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setConfig({ mode: data.mode || 'off', objectives: data.objectives || '' });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: config.mode, objectives: config.objectives }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar');
      setToast({ message: 'Configuración guardada correctamente.', type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [config, apiFetch]);

  if (loading) return <div className="ap-page" />;

  return (
    <div className="ap-page">
      <div className="ap-config-layout">

        {/* ── Selector de modo ── */}
        <div className="form-card">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiCpu size={16} /> Modo de Operación
          </h2>
          <div className="ap-mode-grid">
            {MODE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                className={[
                  'ap-mode-card',
                  config.mode === opt.id ? 'ap-mode-card--selected' : '',
                  opt.disabled ? 'ap-mode-card--disabled' : '',
                ].join(' ')}
                onClick={() => !opt.disabled && setConfig(c => ({ ...c, mode: opt.id }))}
                disabled={opt.disabled}
              >
                <span className={`ap-mode-badge ap-mode-badge--${opt.id}`}>
                  {opt.disabled ? `${opt.label} — Próximamente` : opt.label}
                </span>
                <p className="ap-mode-desc">{opt.description}</p>
                {config.mode === opt.id && <FiCheck size={16} className="ap-mode-check" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Objetivos del ciclo ── */}
        <div className="form-card">
          <h2>Objetivos del Ciclo</h2>
          <p className="ap-objectives-hint">
            Describe qué esperas lograr en este ciclo de producción. Esto guía las recomendaciones del análisis.
          </p>
          <div className="form-control">
            <label>Objetivos del productor</label>
            <textarea
              rows={5}
              value={config.objectives}
              onChange={e => setConfig(c => ({ ...c, objectives: e.target.value }))}
              placeholder="Ej: Maximizar rendimiento de la cosecha 2026, reducir uso de fungicidas, mejorar monitoreo de plagas en lotes norte..."
            />
          </div>
        </div>

        {/* ── Guardar ── */}
        <div className="ap-config-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            <FiSave size={15} />
            {saving ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>

      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
