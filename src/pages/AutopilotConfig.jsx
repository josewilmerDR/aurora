import { useState, useEffect, useCallback } from 'react';
import { FiSave, FiCheck, FiCpu, FiShield } from 'react-icons/fi';
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
    disabled: false,
  },
  {
    id: 'nivel3',
    label: 'Nivel 3 — Agencia Total',
    description: 'Ejecuta acciones autónomamente e informa al productor en tiempo real.',
    disabled: false,
  },
];

export default function AutopilotConfig() {
  const apiFetch = useApiFetch();

  const [config, setConfig] = useState({ mode: 'off', objectives: '', guardrails: {} });
  const [lotes, setLotes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/autopilot/config')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setConfig({ mode: data.mode || 'off', objectives: data.objectives || '', guardrails: data.guardrails || {} });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Cargar lotes cuando el modo es nivel3 (para blockedLotes)
  useEffect(() => {
    if (config.mode !== 'nivel3') return;
    let cancelled = false;
    apiFetch('/api/lotes')
      .then(r => r.json())
      .then(data => { if (!cancelled) setLotes(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [config.mode]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: config.mode, objectives: config.objectives, guardrails: config.guardrails }),
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

        {/* ── Barandillas de Seguridad (solo nivel3) ── */}
        {config.mode === 'nivel3' && (
          <div className="form-card">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiShield size={16} /> Barandillas de Seguridad
            </h2>
            <p className="ap-objectives-hint">
              Configura los límites de las acciones autónomas. Las acciones que excedan estos límites serán escaladas para aprobación manual.
            </p>

            <div className="form-control">
              <label>Máximo de acciones por sesión</label>
              <input
                type="number" min={1} max={20}
                value={config.guardrails.maxActionsPerSession ?? 5}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, maxActionsPerSession: parseInt(e.target.value) || 5 },
                }))}
              />
            </div>

            <div className="form-control">
              <label>Cambio máximo de inventario por ajuste (%)</label>
              <input
                type="number" min={1} max={100}
                value={config.guardrails.maxStockAdjustPercent ?? 30}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, maxStockAdjustPercent: parseInt(e.target.value) || 30 },
                }))}
              />
            </div>

            <div className="form-control">
              <label>Tipos de acción permitidos</label>
              <div className="ap-guardrail-checkboxes">
                {[
                  { id: 'crear_tarea', label: 'Crear tarea' },
                  { id: 'reprogramar_tarea', label: 'Reprogramar tarea' },
                  { id: 'reasignar_tarea', label: 'Reasignar tarea' },
                  { id: 'ajustar_inventario', label: 'Ajustar inventario' },
                  { id: 'enviar_notificacion', label: 'Enviar notificación' },
                ].map(at => {
                  const allowed = config.guardrails.allowedActionTypes ??
                    ['crear_tarea', 'reprogramar_tarea', 'reasignar_tarea', 'ajustar_inventario', 'enviar_notificacion'];
                  return (
                    <label key={at.id} className="ap-guardrail-check">
                      <input
                        type="checkbox"
                        checked={allowed.includes(at.id)}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...allowed, at.id]
                            : allowed.filter(t => t !== at.id);
                          setConfig(c => ({ ...c, guardrails: { ...c.guardrails, allowedActionTypes: next } }));
                        }}
                      />
                      {at.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="form-control">
              <label>Lotes bloqueados (sin acciones autónomas)</label>
              <div className="ap-guardrail-checkboxes">
                {lotes.map(l => {
                  const blocked = config.guardrails.blockedLotes ?? [];
                  return (
                    <label key={l.id} className="ap-guardrail-check">
                      <input
                        type="checkbox"
                        checked={blocked.includes(l.id)}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...blocked, l.id]
                            : blocked.filter(id => id !== l.id);
                          setConfig(c => ({ ...c, guardrails: { ...c.guardrails, blockedLotes: next } }));
                        }}
                      />
                      {l.codigoLote ? `${l.codigoLote} — ` : ''}{l.nombreLote || l.id}
                    </label>
                  );
                })}
                {lotes.length === 0 && (
                  <span style={{ opacity: 0.5, fontSize: '0.82rem' }}>No hay lotes registrados.</span>
                )}
              </div>
            </div>
          </div>
        )}

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
