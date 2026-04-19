import { useState, useEffect, useCallback } from 'react';
import { FiSave, FiCheck, FiCpu, FiShield } from 'react-icons/fi';
import Toast from '../components/Toast';
import AutopilotKillSwitch from '../components/AutopilotKillSwitch';
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

        {/* ── Kill switch (visible siempre) ── */}
        <AutopilotKillSwitch />

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

            <h3 className="ap-guardrail-subheading">Límites globales</h3>
            <p className="ap-objectives-hint">
              Límites acumulados por finca (no por sesión). Las acciones que los excedan se escalan.
            </p>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Máx. acciones por día</label>
                <input
                  type="number" min={1} max={500}
                  value={config.guardrails.maxActionsPerDay ?? 20}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxActionsPerDay: parseInt(e.target.value) || 20 },
                  }))}
                />
              </div>
              <div className="form-control">
                <label>Máx. OC por día</label>
                <input
                  type="number" min={1} max={100}
                  value={config.guardrails.maxOrdenesCompraPerDay ?? 3}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxOrdenesCompraPerDay: parseInt(e.target.value) || 3 },
                  }))}
                />
              </div>
            </div>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Monto máx. por OC (USD)</label>
                <input
                  type="number" min={0}
                  value={config.guardrails.maxOrdenCompraMonto ?? 5000}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxOrdenCompraMonto: parseFloat(e.target.value) || 0 },
                  }))}
                />
              </div>
              <div className="form-control">
                <label>Monto máx. mensual de OC (USD)</label>
                <input
                  type="number" min={0}
                  value={config.guardrails.maxOrdenesCompraMonthlyAmount ?? 30000}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxOrdenesCompraMonthlyAmount: parseFloat(e.target.value) || 0 },
                  }))}
                />
              </div>
            </div>

            <div className="form-control">
              <label>Máx. notificaciones al mismo trabajador por día</label>
              <input
                type="number" min={0} max={100}
                value={config.guardrails.maxNotificationsPerUserPerDay ?? 3}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, maxNotificationsPerUserPerDay: parseInt(e.target.value) || 0 },
                }))}
              />
            </div>

            <h3 className="ap-guardrail-subheading">Presupuestos y caja</h3>
            <p className="ap-objectives-hint">
              Guardrails financieros. Vacío = no enforcement. Aplican a órdenes y solicitudes de compra.
            </p>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Tope de consumo del presupuesto (%)</label>
                <input
                  type="number" min={0} max={500}
                  placeholder="Ej: 100 (no exceder el asignado)"
                  value={config.guardrails.maxBudgetConsumptionPct ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        maxBudgetConsumptionPct: v === '' ? null : parseFloat(v) || 0,
                      },
                    }));
                  }}
                />
                <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                  Bloquea acciones que llevarían la categoría por encima de este porcentaje del asignado del mes.
                </p>
              </div>
              <div className="form-control">
                <label>Saldo mínimo de caja (USD)</label>
                <input
                  type="number"
                  placeholder="Ej: 5000 (piso de caja)"
                  value={config.guardrails.minCajaProyectada ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        minCajaProyectada: v === '' ? null : parseFloat(v),
                      },
                    }));
                  }}
                />
                <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                  La acción se bloquea si dejaría la caja proyectada por debajo del piso dentro del horizonte.
                </p>
              </div>
            </div>

            <div className="form-control">
              <label>Horizonte de caja (semanas)</label>
              <input
                type="number" min={1} max={52}
                value={config.guardrails.cashFloorHorizonWeeks ?? 4}
                onChange={e => setConfig(c => ({
                  ...c,
                  guardrails: { ...c.guardrails, cashFloorHorizonWeeks: parseInt(e.target.value) || 4 },
                }))}
              />
            </div>

            <div className="form-control">
              <label>Categorías bloqueadas</label>
              <div className="ap-guardrail-checklist">
                {['combustible', 'depreciacion', 'planilla_directa', 'planilla_fija', 'insumos', 'mantenimiento', 'administrativo', 'otro'].map(cat => {
                  const blocked = config.guardrails.blockedBudgetCategories ?? [];
                  const checked = blocked.includes(cat);
                  return (
                    <label key={cat} className="ap-guardrail-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...blocked, cat]
                            : blocked.filter(c => c !== cat);
                          setConfig(c => ({
                            ...c,
                            guardrails: { ...c.guardrails, blockedBudgetCategories: next },
                          }));
                        }}
                      />
                      {cat.replace(/_/g, ' ')}
                    </label>
                  );
                })}
              </div>
              <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                Las categorías marcadas no pueden recibir acciones autónomas.
              </p>
            </div>

            <h3 className="ap-guardrail-subheading">Dominio financiero (Agente)</h3>
            <p className="ap-objectives-hint">
              Controles del agente financiero autónomo. El kill switch detiene solo este dominio; el resto del autopilot sigue funcionando.
            </p>

            <label className="ap-guardrail-check">
              <input
                type="checkbox"
                checked={config.guardrails.dominios?.financiera?.activo !== false}
                onChange={e => setConfig(c => ({
                  ...c,
                  guardrails: {
                    ...c.guardrails,
                    dominios: {
                      ...(c.guardrails.dominios || {}),
                      financiera: {
                        ...(c.guardrails.dominios?.financiera || {}),
                        activo: e.target.checked,
                      },
                    },
                  },
                }))}
              />
              Dominio financiero activo
            </label>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Nivel del dominio (opcional)</label>
                <select
                  value={config.guardrails.dominios?.financiera?.nivel || ''}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        dominios: {
                          ...(c.guardrails.dominios || {}),
                          financiera: {
                            ...(c.guardrails.dominios?.financiera || {}),
                            nivel: v || undefined,
                          },
                        },
                      },
                    }));
                  }}
                >
                  <option value="">Heredar del modo global</option>
                  <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                  <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                  <option value="nivel3">Nivel 3 — ejecución automática</option>
                </select>
                <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                  Default recomendado: heredar. Si defines explícitamente, puede ser más conservador que el modo global (nunca más agresivo).
                </p>
              </div>
              <div className="form-control">
                <label>Tope por reasignación (% del source)</label>
                <input
                  type="number" min={0} max={100}
                  placeholder="Ej: 25"
                  value={config.guardrails.maxDesviacionPresupuesto ?? 25}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        maxDesviacionPresupuesto: v === '' ? null : parseFloat(v) || 0,
                      },
                    }));
                  }}
                />
                <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                  Una sola reasignación no puede mover más de este % del monto asignado del budget origen.
                </p>
              </div>
            </div>

            <h3 className="ap-guardrail-subheading">Dominio RR.HH. (Agente)</h3>
            <p className="ap-objectives-hint">
              Controles del agente de recursos humanos. Por diseño, el dominio RR.HH. no admite Nivel 3
              — las decisiones sobre personas siempre requieren revisión humana. El backend rechaza
              cualquier intento de configurar nivel3 aquí.
            </p>

            <label className="ap-guardrail-check">
              <input
                type="checkbox"
                checked={config.guardrails.dominios?.rrhh?.activo !== false}
                onChange={e => setConfig(c => ({
                  ...c,
                  guardrails: {
                    ...c.guardrails,
                    dominios: {
                      ...(c.guardrails.dominios || {}),
                      rrhh: {
                        ...(c.guardrails.dominios?.rrhh || {}),
                        activo: e.target.checked,
                      },
                    },
                  },
                }))}
              />
              Dominio RR.HH. activo
            </label>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Nivel del dominio (opcional)</label>
                <select
                  value={config.guardrails.dominios?.rrhh?.nivel || ''}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        dominios: {
                          ...(c.guardrails.dominios || {}),
                          rrhh: {
                            ...(c.guardrails.dominios?.rrhh || {}),
                            nivel: v || undefined,
                          },
                        },
                      },
                    }));
                  }}
                >
                  <option value="">Heredar del modo global (cap a Nivel 2)</option>
                  <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                  <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                  {/* Nivel 3 NO se ofrece — rechazado por PUT /api/autopilot/config */}
                </select>
                <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                  Las acciones del agente (contratación, alertas) siempre quedan como propuestas,
                  independiente del nivel elegido. Esta barrera es arquitectónica.
                </p>
              </div>
            </div>

            <h3 className="ap-guardrail-subheading">Dominio Financiamiento externo (Agente)</h3>
            <p className="ap-objectives-hint">
              Controles del agente de financiamiento (Fase 5). Por política permanente,
              este dominio es <strong>Nivel 1 únicamente</strong> — produce recomendaciones
              pero nunca firma, aplica ni acepta crédito automáticamente. El backend
              rechaza cualquier intento de configurar nivel2 o nivel3. Ver
              <code>docs/financing-autonomy.md</code> para los fundamentos.
            </p>

            <label className="ap-guardrail-check">
              <input
                type="checkbox"
                checked={config.guardrails.dominios?.financing?.activo !== false}
                onChange={e => setConfig(c => ({
                  ...c,
                  guardrails: {
                    ...c.guardrails,
                    dominios: {
                      ...(c.guardrails.dominios || {}),
                      financing: {
                        ...(c.guardrails.dominios?.financing || {}),
                        activo: e.target.checked,
                      },
                    },
                  },
                }))}
              />
              Dominio Financiamiento activo
            </label>

            <div className="form-control">
              <label>Nivel del dominio</label>
              <select
                value="nivel1"
                disabled
              >
                <option value="nivel1">Nivel 1 — solo recomendaciones (permanente)</option>
              </select>
              <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                Fijo en Nivel 1. Revisar N2/N3 requiere revisión de política explícita con
                evidencia acumulada ≥ 24 meses de decisiones validadas en Fases 1-4.
              </p>
            </div>

            <h3 className="ap-guardrail-subheading">Horarios</h3>

            <label className="ap-guardrail-check">
              <input
                type="checkbox"
                checked={config.guardrails.weekendActions !== false}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, weekendActions: e.target.checked },
                }))}
              />
              Permitir acciones autónomas en fin de semana
            </label>

            <div className="form-control">
              <label>Horario silencioso (HH:MM — HH:MM)</label>
              <div className="ap-guardrail-time-row">
                <input
                  type="time"
                  value={config.guardrails.quietHours?.start || ''}
                  onChange={e => setConfig(c => ({
                    ...c,
                    guardrails: {
                      ...c.guardrails,
                      quietHours: { ...(c.guardrails.quietHours || {}), start: e.target.value },
                    },
                  }))}
                />
                <span style={{ opacity: 0.6 }}>—</span>
                <input
                  type="time"
                  value={config.guardrails.quietHours?.end || ''}
                  onChange={e => setConfig(c => ({
                    ...c,
                    guardrails: {
                      ...c.guardrails,
                      quietHours: { ...(c.guardrails.quietHours || {}), end: e.target.value },
                    },
                  }))}
                />
              </div>
              <p className="ap-objectives-hint" style={{ marginTop: 4 }}>
                Deja vacío para desactivar. Aplica por defecto a notificaciones; configura `enforce` por API para otros tipos.
              </p>
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
