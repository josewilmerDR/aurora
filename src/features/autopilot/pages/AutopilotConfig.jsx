import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiSave, FiShield, FiCpu } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import DirectivesPanel from '../components/DirectivesPanel';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/autopilot-dashboard.css';

export default function AutopilotConfig() {
  const apiFetch = useApiFetch();

  const [config, setConfig] = useState({ objectives: '', guardrails: {} });
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
          setConfig({ objectives: data.objectives || '', guardrails: data.guardrails || {} });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Cargar lotes (para el selector de lotes bloqueados). Se cargan siempre
  // porque las barandillas son visibles aun cuando el modo no es nivel3.
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/lotes')
      .then(r => r.json())
      .then(data => { if (!cancelled) setLotes(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectives: config.objectives, guardrails: config.guardrails }),
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

      {/* ── Header ── */}
      <div className="ap-header">
        <div className="ap-header-left">
          <h1 className="ap-title"><FiCpu size={18} /> Configuración — Aurora Copilot</h1>
        </div>
        <div className="ap-header-right">
          <Link to="/autopilot" className="ap-config-link">
            Panel de Aurora Copilot
          </Link>
        </div>
      </div>

      <div className="ap-config-layout">

        {/* ── Objetivos ── */}
        <div className="form-card">
          <h2>Objetivos</h2>
          <p className="ap-objectives-hint">
            Autopilot funciona mejor cuando tiene un objetivo definido, proporciónale uno o varios para mejorar las respuestas.
          </p>
          <div className="form-control">
            <textarea
              rows={5}
              value={config.objectives}
              onChange={e => setConfig(c => ({ ...c, objectives: e.target.value }))}
              placeholder="Ej: Maximizar rendimiento de la cosecha 2026, reducir uso de fungicidas, mejorar monitoreo de plagas en lotes norte..."
            />
          </div>
        </div>

        {/* ── Mis preferencias ── */}
        <DirectivesPanel />

        {/* ── Barandillas de Seguridad ── */}
        <div className="form-card">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiShield size={16} /> Barandillas de Seguridad
          </h2>
          <p className="ap-objectives-hint" style={{ fontWeight: 600, opacity: 0.9 }}>
            Estas barandillas sólo se aplican cuando Aurora Copilot opera en <strong>Nivel 3 — Agencia Total</strong>.
            Puedes configurarlas en cualquier momento; los valores quedarán guardados y entrarán en vigor automáticamente
            cuando actives el Nivel 3. En Niveles 1 y 2 no tienen efecto porque ninguna acción se ejecuta sin aprobación humana.
          </p>
          <p className="ap-objectives-hint">
            Configura los límites de las acciones autónomas. Las acciones que excedan estos límites serán escaladas para aprobación manual.
          </p>

            <div className="form-control">
              <label>Máximo de acciones por análisis</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Tope por cada ejecución del análisis autónomo. Para el acumulado por día, ver más abajo.
              </p>
              <input
                type="number" min={1} max={20}
                value={config.guardrails.maxActionsPerSession ?? 5}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, maxActionsPerSession: parseInt(e.target.value) || 5 },
                }))}
              />
            </div>

            <div className="form-control">
              <label>Cambio máximo en la cantidad en bodega de un producto (%)</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Cuando Aurora corrige la cantidad registrada de un producto (por pérdida, daño o error de conteo),
                no podrá subir ni bajar esa cantidad más de este porcentaje en un solo movimiento.
                Ejemplo con 30%: si hay 100 unidades, solo podrá dejarlas entre 70 y 130.
                Cambios mayores se envían a un supervisor para aprobación.
              </p>
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
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Marca los tipos de acción que Aurora puede hacer por su cuenta. Desmarca los que siempre deben pasar por revisión humana.
              </p>
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
              <label>Lotes bloqueados</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Marca los lotes donde Aurora no podrá actuar por su cuenta. Cualquier acción sobre estos lotes se enviará a un supervisor para aprobación.
              </p>
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
              Estos límites se suman en toda la finca, no en un solo análisis. Si Aurora quiere hacer una acción que los supere, se envía a un supervisor para aprobación.
            </p>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Máximo de acciones por día</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Total de acciones que Aurora puede hacer en un día, sumando todos los análisis. Al llegar a este tope se detiene hasta el día siguiente.
                </p>
                <input
                  type="number" min={1} max={500}
                  value={config.guardrails.maxActionsPerDay ?? 20}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxActionsPerDay: parseInt(e.target.value) || 20 },
                  }))}
                />
              </div>
              <div className="form-control">
                <label>Máximo de órdenes de compra por día</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Cuántas compras diferentes puede generar Aurora en un mismo día. Evita que concentre muchas compras en una sola jornada.
                </p>
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
                <label>Precio máximo de una sola compra (USD)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Valor tope de una sola orden de compra. Si una compra cuesta más, se envía a un supervisor para aprobación.
                </p>
                <input
                  type="number" min={0}
                  value={config.guardrails.maxOrdenCompraMonto ?? 5000}
                  onChange={e => setConfig(c => ({
                    ...c, guardrails: { ...c.guardrails, maxOrdenCompraMonto: parseFloat(e.target.value) || 0 },
                  }))}
                />
              </div>
              <div className="form-control">
                <label>Gasto máximo en compras al mes (USD)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Suma total que Aurora puede gastar en compras durante un mes. Al llegar a este tope no podrá generar más compras hasta el mes siguiente.
                </p>
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
              <label>Máximo de notificaciones al mismo trabajador por día</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Cuántos mensajes (WhatsApp, push, etc.) puede enviarle Aurora a una misma persona en un solo día, para no saturarla.
              </p>
              <input
                type="number" min={0} max={100}
                value={config.guardrails.maxNotificationsPerUserPerDay ?? 3}
                onChange={e => setConfig(c => ({
                  ...c, guardrails: { ...c.guardrails, maxNotificationsPerUserPerDay: parseInt(e.target.value) || 0 },
                }))}
              />
            </div>

            <h3 className="ap-guardrail-subheading">Dinero: presupuestos y caja</h3>
            <p className="ap-objectives-hint">
              Son límites sobre el dinero de la finca. Los campos que dejes vacíos no se revisan.
              Aplican cuando Aurora quiere crear una orden o una solicitud de compra.
            </p>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Tope de consumo del presupuesto (%)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Si una compra haría que una categoría (combustible, insumos, planilla, etc.) gaste más de este porcentaje del presupuesto del mes, Aurora no la ejecutará y la enviará a un supervisor. Con 100%, la categoría no pasa de lo presupuestado.
                </p>
                <input
                  type="number" min={0} max={500}
                  placeholder="Ej: 100% (no exceder el asignado)"
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
              </div>
              <div className="form-control">
                <label>Dinero mínimo que debe quedar en caja (USD)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Si una compra haría que el dinero en caja baje de este monto en las próximas semanas, Aurora no la ejecutará y la enviará a un supervisor.
                </p>
                <input
                  type="number"
                  placeholder="Ej: 5000 USD (no bajar de aquí)"
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
              </div>
            </div>

            <div className="form-control">
              <label>Semanas que Aurora mira hacia adelante para proteger la caja</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Cuántas semanas a futuro revisa Aurora al decidir si una compra dejará la caja por debajo del mínimo.
                Suma el saldo actual, los ingresos esperados, las compras ya pactadas y la planilla por pagar dentro de este plazo.
                Más semanas = Aurora es más cuidadosa; menos semanas = más permisiva. El valor típico (4 semanas) cubre un mes de pagos.
              </p>
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
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Marca las categorías en las que Aurora no podrá gastar por su cuenta. Cualquier compra en una categoría marcada se enviará a un supervisor para aprobación.
              </p>
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
            </div>

            <h3 className="ap-guardrail-subheading">Agente de finanzas</h3>
            <p className="ap-objectives-hint">
              Aquí controlas al agente que se ocupa del dinero de la finca (presupuestos, caja, compras). Puedes apagarlo por separado del resto: si lo desactivas, los demás agentes de Aurora siguen funcionando.
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
              Agente de finanzas activo
            </label>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Nivel de este agente (opcional)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Deja "usar nivel global" para que el agente funcione igual que Autopilot en general. Si eliges un nivel específico, solo puede ser igual o más cuidadoso que el global, nunca más agresivo.
                </p>
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
                  <option value="">Usar nivel global</option>
                  <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                  <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                  <option value="nivel3">Nivel 3 — ejecución automática</option>
                </select>
              </div>
              <div className="form-control">
                <label>Cambio máximo al mover dinero entre presupuestos (%)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Cuando el agente mueve dinero de una categoría (ej: combustible) a otra (ej: insumos), no podrá mover más de este porcentaje del total que tiene asignado la categoría de origen en una sola operación.
                </p>
                <input
                  type="number" min={0} max={100}
                  placeholder="Ej: 25%"
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
              </div>
            </div>

            <h3 className="ap-guardrail-subheading">Agente de recursos humanos</h3>
            <p className="ap-objectives-hint">
              Este agente analiza asuntos de personal: productividad, alertas y sugerencias de contratación. Por regla permanente, las decisiones sobre personas nunca se ejecutan automáticamente: siempre pasan por revisión humana. Por eso aquí no existe la opción de Nivel 3.
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
              Agente de recursos humanos activo
            </label>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Nivel de este agente (opcional)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Deja "usar nivel global" para que el agente use el mismo nivel que Autopilot en general (con tope en Nivel 2). Aunque elijas un nivel específico, todas las sugerencias sobre personal siempre quedan como propuestas que un supervisor debe aprobar.
                </p>
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
                  <option value="">Usar nivel global (máximo Nivel 2)</option>
                  <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                  <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                  {/* Nivel 3 NO se ofrece — rechazado por PUT /api/autopilot/config */}
                </select>
              </div>
            </div>

            <h3 className="ap-guardrail-subheading">Agente de financiamiento</h3>
            <p className="ap-objectives-hint">
              Este agente analiza oportunidades de crédito y financiamiento. Por regla permanente solo da recomendaciones: <strong>nunca firma, aplica ni acepta créditos por su cuenta</strong>. Este nivel no se puede cambiar en la configuración.
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
              Agente de financiamiento activo
            </label>

            <div className="form-control">
              <label>Nivel de este agente</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Siempre en Nivel 1 (solo recomendaciones). No se puede cambiar: las decisiones de crédito siempre requieren intervención humana.
              </p>
              <select
                value="nivel1"
                disabled
              >
                <option value="nivel1">Nivel 1 — solo recomendaciones (permanente)</option>
              </select>
            </div>

            <h3 className="ap-guardrail-subheading">Agente orquestador</h3>
            <p className="ap-objectives-hint">
              Este agente coordina al resto de los agentes (finanzas, compras, RR.HH., financiamiento). Las reglas permanentes de los otros agentes (por ejemplo, que RR.HH. nunca ejecute solo) siguen aplicando: aquí solo cambias cómo actúa el coordinador, no los permisos de cada agente por separado.
            </p>

            <label className="ap-guardrail-check">
              <input
                type="checkbox"
                checked={config.guardrails.dominios?.meta?.activo !== false}
                onChange={e => setConfig(c => ({
                  ...c,
                  guardrails: {
                    ...c.guardrails,
                    dominios: {
                      ...(c.guardrails.dominios || {}),
                      meta: {
                        ...(c.guardrails.dominios?.meta || {}),
                        activo: e.target.checked,
                      },
                    },
                  },
                }))}
              />
              Agente orquestador activo
            </label>

            <div className="ap-guardrail-row">
              <div className="form-control">
                <label>Nivel de este agente (opcional)</label>
                <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                  Deja "usar nivel global" para que el coordinador funcione como Autopilot en general. En niveles más altos puede coordinar acciones entre varios agentes a la vez y ajustar sus propios límites. Cualquier ajuste es reversible durante 7 días.
                </p>
                <select
                  value={config.guardrails.dominios?.meta?.nivel || ''}
                  onChange={e => {
                    const v = e.target.value;
                    setConfig(c => ({
                      ...c,
                      guardrails: {
                        ...c.guardrails,
                        dominios: {
                          ...(c.guardrails.dominios || {}),
                          meta: {
                            ...(c.guardrails.dominios?.meta || {}),
                            nivel: v || undefined,
                          },
                        },
                      },
                    }));
                  }}
                >
                  <option value="">Usar nivel global</option>
                  <option value="nivel1">Nivel 1 — solo recomendaciones (planes y propuestas)</option>
                  <option value="nivel2">Nivel 2 — delega a los agentes y ajusta sus límites cuando hace falta</option>
                  <option value="nivel3">Nivel 3 — delega, ajusta límites en ambos sentidos y ejecuta cadenas de acciones coordinadas</option>
                </select>
              </div>
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
              Permitir que Aurora actúe en fin de semana
            </label>

            <div className="form-control">
              <label>Horas en las que Aurora no envía notificaciones</label>
              <p className="ap-objectives-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Franja del día (por ejemplo, de 22:00 a 06:00) en la que Aurora no enviará notificaciones al personal, para no interrumpir el descanso. Deja los dos campos vacíos para permitir notificaciones a cualquier hora.
              </p>
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
            </div>
          </div>

        {/* ── Guardar ── */}
        <div className="ap-config-actions">
          <button
            type="button"
            className="aur-btn-pill"
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
