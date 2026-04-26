import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FiSave, FiShield, FiCpu, FiTarget, FiSliders, FiClock,
  FiDollarSign, FiUsers, FiCreditCard, FiGitBranch,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import DirectivesPanel from '../components/DirectivesPanel';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/autopilot-dashboard.css';

const ACTION_TYPES = [
  { id: 'crear_tarea', label: 'Crear tarea' },
  { id: 'reprogramar_tarea', label: 'Reprogramar tarea' },
  { id: 'reasignar_tarea', label: 'Reasignar tarea' },
  { id: 'ajustar_inventario', label: 'Ajustar inventario' },
  { id: 'enviar_notificacion', label: 'Enviar notificación' },
];

const BUDGET_CATEGORIES = [
  { id: 'combustible', label: 'combustible' },
  { id: 'depreciacion', label: 'depreciacion' },
  { id: 'planilla_directa', label: 'planilla directa' },
  { id: 'planilla_fija', label: 'planilla fija' },
  { id: 'insumos', label: 'insumos' },
  { id: 'mantenimiento', label: 'mantenimiento' },
  { id: 'administrativo', label: 'administrativo' },
  { id: 'otro', label: 'otro' },
];

/* Row primitives — slim wrappers sobre aur-row del sistema */

function ConfigRow({ label, hint, children }) {
  return (
    <div className="aur-row aur-row--multiline">
      <span className="aur-row-label">{label}</span>
      <div className="ap-row-control">
        {children}
        {hint && <p className="ap-row-hint">{hint}</p>}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="aur-row">
      <span className="aur-row-label">{label}</span>
      <div className="ap-row-control ap-row-control--toggle">
        <label className="aur-toggle">
          <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
          <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
        </label>
        {hint && <p className="ap-row-hint">{hint}</p>}
      </div>
    </div>
  );
}

function CheckboxGroupRow({ label, hint, options, values, onChange, emptyText }) {
  return (
    <div className="aur-row aur-row--multiline">
      <span className="aur-row-label">{label}</span>
      <div className="ap-row-control">
        {hint && <p className="ap-row-hint">{hint}</p>}
        {options.length === 0 ? (
          <p className="ap-row-empty">{emptyText || 'No hay opciones disponibles.'}</p>
        ) : (
          <div className="ap-checkbox-group">
            {options.map(opt => (
              <label key={opt.id} className="ap-checkbox">
                <input
                  type="checkbox"
                  checked={values.includes(opt.id)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...values, opt.id]
                      : values.filter(id => id !== opt.id);
                    onChange(next);
                  }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

  const guardrails = config.guardrails;
  const setGuardrail = (key, value) => setConfig(c => ({
    ...c, guardrails: { ...c.guardrails, [key]: value },
  }));
  const setDominio = (dominio, key, value) => setConfig(c => ({
    ...c,
    guardrails: {
      ...c.guardrails,
      dominios: {
        ...(c.guardrails.dominios || {}),
        [dominio]: {
          ...(c.guardrails.dominios?.[dominio] || {}),
          [key]: value,
        },
      },
    },
  }));

  const allowedActionTypes = guardrails.allowedActionTypes ?? ACTION_TYPES.map(at => at.id);
  const blockedLotes = guardrails.blockedLotes ?? [];
  const blockedCategories = guardrails.blockedBudgetCategories ?? [];
  const dominios = guardrails.dominios || {};

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

        {/* ── 01 Objetivos ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiTarget size={14} /></span>
            <h3>Objetivos</h3>
          </div>
          <p className="ap-section-intro">
            Autopilot funciona mejor cuando tiene un objetivo definido, proporciónale uno o varios para mejorar las respuestas.
          </p>
          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <span className="aur-row-label">Objetivos</span>
              <textarea
                className="aur-textarea"
                rows={5}
                value={config.objectives}
                onChange={e => setConfig(c => ({ ...c, objectives: e.target.value }))}
                placeholder="Ej: Maximizar rendimiento de la cosecha 2026, reducir uso de fungicidas, mejorar monitoreo de plagas en lotes norte..."
              />
            </div>
          </div>
        </section>

        {/* ── 02 Mis preferencias ── */}
        <DirectivesPanel />

        {/* ── 03 Reglas básicas (barandillas) ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiShield size={14} /></span>
            <h3>Reglas básicas</h3>
          </div>
          <p className="ap-section-intro">
            Estas barandillas sólo se aplican cuando Aurora Copilot opera en <strong>Nivel 3 — Agencia Total</strong>.
            Puedes configurarlas en cualquier momento; los valores quedarán guardados y entrarán en vigor automáticamente
            cuando actives el Nivel 3. En Niveles 1 y 2 no tienen efecto porque ninguna acción se ejecuta sin aprobación humana.
            Configura los límites de las acciones autónomas. Las acciones que excedan estos límites serán escaladas para aprobación manual.
          </p>
          <div className="aur-list">
            <ConfigRow
              label="Máximo de acciones por análisis"
              hint="Tope por cada ejecución del análisis autónomo. Para el acumulado por día, ver más abajo."
            >
              <input
                type="number" min={1} max={20}
                className="aur-input"
                value={guardrails.maxActionsPerSession ?? 5}
                onChange={e => setGuardrail('maxActionsPerSession', parseInt(e.target.value) || 5)}
              />
            </ConfigRow>

            <ConfigRow
              label="Cambio máximo en cantidad de un producto (%)"
              hint="Cuando Aurora corrige la cantidad registrada de un producto (por pérdida, daño o error de conteo), no podrá subir ni bajar esa cantidad más de este porcentaje en un solo movimiento. Ejemplo con 30%: si hay 100 unidades, solo podrá dejarlas entre 70 y 130. Cambios mayores se envían a un supervisor para aprobación."
            >
              <input
                type="number" min={1} max={100}
                className="aur-input"
                value={guardrails.maxStockAdjustPercent ?? 30}
                onChange={e => setGuardrail('maxStockAdjustPercent', parseInt(e.target.value) || 30)}
              />
            </ConfigRow>

            <CheckboxGroupRow
              label="Tipos de acción permitidos"
              hint="Marca los tipos de acción que Aurora puede hacer por su cuenta. Desmarca los que siempre deben pasar por revisión humana."
              options={ACTION_TYPES}
              values={allowedActionTypes}
              onChange={next => setGuardrail('allowedActionTypes', next)}
            />

            <CheckboxGroupRow
              label="Lotes bloqueados"
              hint="Marca los lotes donde Aurora no podrá actuar por su cuenta. Cualquier acción sobre estos lotes se enviará a un supervisor para aprobación."
              options={lotes.map(l => ({
                id: l.id,
                label: `${l.codigoLote ? l.codigoLote + ' — ' : ''}${l.nombreLote || l.id}`,
              }))}
              values={blockedLotes}
              onChange={next => setGuardrail('blockedLotes', next)}
              emptyText="No hay lotes registrados."
            />
          </div>
        </section>

        {/* ── 04 Límites globales ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiSliders size={14} /></span>
            <h3>Límites globales</h3>
          </div>
          <p className="ap-section-intro">
            Estos límites se suman en toda la finca, no en un solo análisis. Si Aurora quiere hacer una acción que los supere, se envía a un supervisor para aprobación.
          </p>
          <div className="aur-list">
            <ConfigRow
              label="Máximo de acciones por día"
              hint="Total de acciones que Aurora puede hacer en un día, sumando todos los análisis. Al llegar a este tope se detiene hasta el día siguiente."
            >
              <input
                type="number" min={1} max={500}
                className="aur-input"
                value={guardrails.maxActionsPerDay ?? 20}
                onChange={e => setGuardrail('maxActionsPerDay', parseInt(e.target.value) || 20)}
              />
            </ConfigRow>

            <ConfigRow
              label="Máximo de órdenes de compra por día"
              hint="Cuántas compras diferentes puede generar Aurora en un mismo día. Evita que concentre muchas compras en una sola jornada."
            >
              <input
                type="number" min={1} max={100}
                className="aur-input"
                value={guardrails.maxOrdenesCompraPerDay ?? 3}
                onChange={e => setGuardrail('maxOrdenesCompraPerDay', parseInt(e.target.value) || 3)}
              />
            </ConfigRow>

            <ConfigRow
              label="Precio máximo de una sola compra (USD)"
              hint="Valor tope de una sola orden de compra. Si una compra cuesta más, se envía a un supervisor para aprobación."
            >
              <input
                type="number" min={0}
                className="aur-input"
                value={guardrails.maxOrdenCompraMonto ?? 5000}
                onChange={e => setGuardrail('maxOrdenCompraMonto', parseFloat(e.target.value) || 0)}
              />
            </ConfigRow>

            <ConfigRow
              label="Gasto máximo en compras al mes (USD)"
              hint="Suma total que Aurora puede gastar en compras durante un mes. Al llegar a este tope no podrá generar más compras hasta el mes siguiente."
            >
              <input
                type="number" min={0}
                className="aur-input"
                value={guardrails.maxOrdenesCompraMonthlyAmount ?? 30000}
                onChange={e => setGuardrail('maxOrdenesCompraMonthlyAmount', parseFloat(e.target.value) || 0)}
              />
            </ConfigRow>

            <ConfigRow
              label="Máximo de notificaciones al mismo trabajador por día"
              hint="Cuántos mensajes (WhatsApp, push, etc.) puede enviarle Aurora a una misma persona en un solo día, para no saturarla."
            >
              <input
                type="number" min={0} max={100}
                className="aur-input"
                value={guardrails.maxNotificationsPerUserPerDay ?? 3}
                onChange={e => setGuardrail('maxNotificationsPerUserPerDay', parseInt(e.target.value) || 0)}
              />
            </ConfigRow>
          </div>
        </section>

        {/* ── 05 Dinero: presupuestos y caja ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiDollarSign size={14} /></span>
            <h3>Dinero — presupuestos y caja</h3>
          </div>
          <p className="ap-section-intro">
            Son límites sobre el dinero de la finca. Los campos que dejes vacíos no se revisan.
            Aplican cuando Aurora quiere crear una orden o una solicitud de compra.
          </p>
          <div className="aur-list">
            <ConfigRow
              label="Tope de consumo del presupuesto (%)"
              hint="Si una compra haría que una categoría (combustible, insumos, planilla, etc.) gaste más de este porcentaje del presupuesto del mes, Aurora no la ejecutará y la enviará a un supervisor. Con 100%, la categoría no pasa de lo presupuestado."
            >
              <input
                type="number" min={0} max={500}
                className="aur-input"
                placeholder="Ej: 100% (no exceder el asignado)"
                value={guardrails.maxBudgetConsumptionPct ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setGuardrail('maxBudgetConsumptionPct', v === '' ? null : parseFloat(v) || 0);
                }}
              />
            </ConfigRow>

            <ConfigRow
              label="Dinero mínimo que debe quedar en caja (USD)"
              hint="Si una compra haría que el dinero en caja baje de este monto en las próximas semanas, Aurora no la ejecutará y la enviará a un supervisor."
            >
              <input
                type="number"
                className="aur-input"
                placeholder="Ej: 5000 USD (no bajar de aquí)"
                value={guardrails.minCajaProyectada ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setGuardrail('minCajaProyectada', v === '' ? null : parseFloat(v));
                }}
              />
            </ConfigRow>

            <ConfigRow
              label="Semanas que Aurora mira hacia adelante para proteger la caja"
              hint="Cuántas semanas a futuro revisa Aurora al decidir si una compra dejará la caja por debajo del mínimo. Suma el saldo actual, los ingresos esperados, las compras ya pactadas y la planilla por pagar dentro de este plazo. Más semanas = Aurora es más cuidadosa; menos semanas = más permisiva. El valor típico (4 semanas) cubre un mes de pagos."
            >
              <input
                type="number" min={1} max={52}
                className="aur-input"
                value={guardrails.cashFloorHorizonWeeks ?? 4}
                onChange={e => setGuardrail('cashFloorHorizonWeeks', parseInt(e.target.value) || 4)}
              />
            </ConfigRow>

            <CheckboxGroupRow
              label="Categorías bloqueadas"
              hint="Marca las categorías en las que Aurora no podrá gastar por su cuenta. Cualquier compra en una categoría marcada se enviará a un supervisor para aprobación."
              options={BUDGET_CATEGORIES}
              values={blockedCategories}
              onChange={next => setGuardrail('blockedBudgetCategories', next)}
            />
          </div>
        </section>

        {/* ── 06 Agente de finanzas ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiDollarSign size={14} /></span>
            <h3>Agente de finanzas</h3>
          </div>
          <p className="ap-section-intro">
            Aquí controlas al agente que se ocupa del dinero de la finca (presupuestos, caja, compras). Puedes apagarlo por separado del resto: si lo desactivas, los demás agentes de Aurora siguen funcionando.
          </p>
          <div className="aur-list">
            <ToggleRow
              label="Agente de finanzas activo"
              checked={dominios.financiera?.activo !== false}
              onChange={e => setDominio('financiera', 'activo', e.target.checked)}
            />
            <ConfigRow
              label="Nivel de este agente"
              hint='Deja "usar nivel global" para que el agente funcione igual que Autopilot en general. Si eliges un nivel específico, solo puede ser igual o más cuidadoso que el global, nunca más agresivo.'
            >
              <select
                className="aur-select"
                value={dominios.financiera?.nivel || ''}
                onChange={e => setDominio('financiera', 'nivel', e.target.value || undefined)}
              >
                <option value="">Usar nivel global</option>
                <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                <option value="nivel3">Nivel 3 — ejecución automática</option>
              </select>
            </ConfigRow>
            <ConfigRow
              label="Cambio máximo al mover dinero entre presupuestos (%)"
              hint="Cuando el agente mueve dinero de una categoría (ej: combustible) a otra (ej: insumos), no podrá mover más de este porcentaje del total que tiene asignado la categoría de origen en una sola operación."
            >
              <input
                type="number" min={0} max={100}
                className="aur-input"
                placeholder="Ej: 25%"
                value={guardrails.maxDesviacionPresupuesto ?? 25}
                onChange={e => {
                  const v = e.target.value;
                  setGuardrail('maxDesviacionPresupuesto', v === '' ? null : parseFloat(v) || 0);
                }}
              />
            </ConfigRow>
          </div>
        </section>

        {/* ── 07 Agente de RR.HH. ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiUsers size={14} /></span>
            <h3>Agente de recursos humanos</h3>
          </div>
          <p className="ap-section-intro">
            Este agente analiza asuntos de personal: productividad, alertas y sugerencias de contratación. Por regla permanente, las decisiones sobre personas nunca se ejecutan automáticamente: siempre pasan por revisión humana. Por eso aquí no existe la opción de Nivel 3.
          </p>
          <div className="aur-list">
            <ToggleRow
              label="Agente de RR.HH. activo"
              checked={dominios.rrhh?.activo !== false}
              onChange={e => setDominio('rrhh', 'activo', e.target.checked)}
            />
            <ConfigRow
              label="Nivel de este agente"
              hint='Deja "usar nivel global" para que el agente use el mismo nivel que Autopilot en general (con tope en Nivel 2). Aunque elijas un nivel específico, todas las sugerencias sobre personal siempre quedan como propuestas que un supervisor debe aprobar.'
            >
              <select
                className="aur-select"
                value={dominios.rrhh?.nivel || ''}
                onChange={e => setDominio('rrhh', 'nivel', e.target.value || undefined)}
              >
                <option value="">Usar nivel global (máximo Nivel 2)</option>
                <option value="nivel1">Nivel 1 — solo recomendaciones</option>
                <option value="nivel2">Nivel 2 — propuestas con aprobación</option>
                {/* Nivel 3 NO se ofrece — rechazado por PUT /api/autopilot/config */}
              </select>
            </ConfigRow>
          </div>
        </section>

        {/* ── 08 Agente de financiamiento ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiCreditCard size={14} /></span>
            <h3>Agente de financiamiento</h3>
          </div>
          <p className="ap-section-intro">
            Este agente analiza oportunidades de crédito y financiamiento. Por regla permanente solo da recomendaciones: <strong>nunca firma, aplica ni acepta créditos por su cuenta</strong>. Este nivel no se puede cambiar en la configuración.
          </p>
          <div className="aur-list">
            <ToggleRow
              label="Agente de financiamiento activo"
              checked={dominios.financing?.activo !== false}
              onChange={e => setDominio('financing', 'activo', e.target.checked)}
            />
            <ConfigRow
              label="Nivel de este agente"
              hint="Siempre en Nivel 1 (solo recomendaciones). No se puede cambiar: las decisiones de crédito siempre requieren intervención humana."
            >
              <select className="aur-select" value="nivel1" disabled>
                <option value="nivel1">Nivel 1 — solo recomendaciones (permanente)</option>
              </select>
            </ConfigRow>
          </div>
        </section>

        {/* ── 09 Agente orquestador ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiGitBranch size={14} /></span>
            <h3>Agente orquestador</h3>
          </div>
          <p className="ap-section-intro">
            Este agente coordina al resto de los agentes (finanzas, compras, RR.HH., financiamiento). Las reglas permanentes de los otros agentes (por ejemplo, que RR.HH. nunca ejecute solo) siguen aplicando: aquí solo cambias cómo actúa el coordinador, no los permisos de cada agente por separado.
          </p>
          <div className="aur-list">
            <ToggleRow
              label="Agente orquestador activo"
              checked={dominios.meta?.activo !== false}
              onChange={e => setDominio('meta', 'activo', e.target.checked)}
            />
            <ConfigRow
              label="Nivel de este agente"
              hint='Deja "usar nivel global" para que el coordinador funcione como Autopilot en general. En niveles más altos puede coordinar acciones entre varios agentes a la vez y ajustar sus propios límites. Cualquier ajuste es reversible durante 7 días.'
            >
              <select
                className="aur-select"
                value={dominios.meta?.nivel || ''}
                onChange={e => setDominio('meta', 'nivel', e.target.value || undefined)}
              >
                <option value="">Usar nivel global</option>
                <option value="nivel1">Nivel 1 — solo recomendaciones (planes y propuestas)</option>
                <option value="nivel2">Nivel 2 — delega a los agentes y ajusta sus límites cuando hace falta</option>
                <option value="nivel3">Nivel 3 — delega, ajusta límites en ambos sentidos y ejecuta cadenas de acciones coordinadas</option>
              </select>
            </ConfigRow>
          </div>
        </section>

        {/* ── 10 Horarios ── */}
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiClock size={14} /></span>
            <h3>Horarios</h3>
          </div>
          <div className="aur-list">
            <ToggleRow
              label="Permitir que Aurora actúe en fin de semana"
              checked={guardrails.weekendActions !== false}
              onChange={e => setGuardrail('weekendActions', e.target.checked)}
            />
            <ConfigRow
              label="Horas en las que Aurora no envía notificaciones"
              hint="Franja del día (por ejemplo, de 22:00 a 06:00) en la que Aurora no enviará notificaciones al personal, para no interrumpir el descanso. Deja los dos campos vacíos para permitir notificaciones a cualquier hora."
            >
              <div className="ap-time-row">
                <input
                  type="time"
                  className="aur-input"
                  value={guardrails.quietHours?.start || ''}
                  onChange={e => setGuardrail('quietHours', { ...(guardrails.quietHours || {}), start: e.target.value })}
                />
                <span className="ap-time-sep">—</span>
                <input
                  type="time"
                  className="aur-input"
                  value={guardrails.quietHours?.end || ''}
                  onChange={e => setGuardrail('quietHours', { ...(guardrails.quietHours || {}), end: e.target.value })}
                />
              </div>
            </ConfigRow>
          </div>
        </section>

        {/* ── Save ── */}
        <div className="aur-form-actions">
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
