import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiBookOpen, FiCpu, FiCheck, FiX, FiClock, FiLayers, FiRefreshCw,
  FiSliders, FiList, FiCalendar,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const LEVEL_OPTIONS = [
  { value: 'nivel1', label: 'Nivel 1 — propuesta' },
  { value: 'nivel2', label: 'Nivel 2 — auto en secciones seguras' },
  { value: 'nivel3', label: 'Nivel 3 — aplicación con delay 24h' },
];

// Mapeo centralizado del status del plan al variant de aur-badge.
// active = positivo (verde); proposed/scheduled = en proceso (violeta/amarillo);
// draft/superseded/cancelled = neutro (gris).
const STATUS_BADGE_VARIANT = {
  draft:                'aur-badge--gray',
  proposed:             'aur-badge--violet',
  active:               'aur-badge--green',
  scheduled_activation: 'aur-badge--yellow',
  superseded:           'aur-badge--gray',
  cancelled:            'aur-badge--gray',
};
const STATUS_LABELS = {
  draft:                'Borrador',
  proposed:             'Propuesta',
  active:               'Activo',
  scheduled_activation: 'Programado',
  superseded:           'Superseded',
  cancelled:            'Cancelado',
};

// Mapeo del status al modifier de strategy-card (left-border tonal).
const CARD_VARIANT = {
  draft:                'rejected',
  proposed:             'issued',
  active:               'executed',
  scheduled_activation: 'scheduled',
  superseded:           'rejected',
  cancelled:            'rolled_back',
};

function fmtTs(ts) {
  if (!ts) return '—';
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString();
  return '—';
}
function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function countdownTo(ts) {
  if (!ts || ts._seconds == null) return null;
  const remainingMs = ts._seconds * 1000 - Date.now();
  if (remainingMs <= 0) return 'Pendiente de activación';
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${hours}h ${mins}m`;
}

function AnnualPlan() {
  const apiFetch = useApiFetch();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [level, setLevel] = useState('nivel1');
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmActivate, setConfirmActivate] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/strategy/annual-plans?year=${year}`)
      .then(r => r.json())
      .then(data => setVersions(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las versiones.' }))
      .finally(() => setLoading(false));
  }, [apiFetch, year]);

  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => versions.find(v => v.isActive), [versions]);
  const scheduled = useMemo(() => versions.find(v => v.status === 'scheduled_activation'), [versions]);
  const proposed = useMemo(() => versions.filter(v => v.status === 'proposed' || v.status === 'draft'), [versions]);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch('/api/strategy/annual-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'generate failed');
      setToast({
        type: 'success',
        message: `Versión ${data.version} creada con status "${data.status}".`,
      });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo generar.' });
    } finally {
      setGenerating(false);
    }
  };

  const activate = async (plan) => {
    setConfirmActivate(null);
    try {
      const res = await apiFetch(`/api/strategy/annual-plans/${plan.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razon: 'Activada por supervisor' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'activate failed');
      setToast({ type: 'success', message: `Versión ${plan.version} activada.` });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo activar.' });
    }
  };

  const confirmCancelScheduled = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`/api/strategy/annual-plans/${cancelTarget.id}/cancel-scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason || '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'cancel failed');
      setToast({ type: 'success', message: 'Activación programada cancelada.' });
      setCancelTarget(null);
      setCancelReason('');
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo cancelar.' });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiBookOpen /> Plan Anual Vivo</h2>
          <p className="aur-sheet-subtitle">
            Documento versionado que integra rotaciones, escenarios y presupuesto. Cada actualización crea una
            versión nueva sin borrar las anteriores. El changelog es inmutable.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw size={14} /> Refrescar
          </button>
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiSliders size={14} /></span>
          <h3 className="aur-section-title">Generar nueva versión</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ap-year">Año</label>
            <div className="aur-field">
              <input
                id="ap-year"
                type="number"
                min={2020}
                max={2099}
                className="aur-input aur-input--num"
                value={year}
                onChange={e => setYear(Number(e.target.value) || currentYear)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ap-level">Nivel de autonomía</label>
            <div className="aur-field">
              <select
                id="ap-level"
                className="aur-select"
                value={level}
                onChange={e => setLevel(e.target.value)}
              >
                {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="aur-field-hint">
                N1 sólo propone; N2 ejecuta en secciones seguras; N3 aplica con delay 24h y permite cancelar.
              </p>
            </div>
          </div>
        </div>
        <div className="aur-form-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={generate}
            disabled={generating}
          >
            <FiCpu size={14} /> {generating ? 'Generando…' : 'Generar nueva versión'}
          </button>
        </div>
      </section>

      {active && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiCheck size={14} /></span>
            <h3 className="aur-section-title">Versión activa</h3>
            <span className="aur-section-count">v{active.version}</span>
          </div>
          <div className="strategy-cards">
            <VersionCard plan={active} headerLabel={`Versión activa ${active.year}-v${active.version}`} />
          </div>
        </section>
      )}

      {scheduled && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiClock size={14} /></span>
            <h3 className="aur-section-title">Activación programada</h3>
            <span className="aur-section-count">v{scheduled.version}</span>
          </div>
          <div className="strategy-cards">
            <VersionCard
              plan={scheduled}
              headerLabel={`Activación programada — v${scheduled.version}`}
              countdown={countdownTo(scheduled.activationScheduledFor)}
              onActivate={() => setConfirmActivate(scheduled)}
              onCancelScheduled={() => { setCancelReason(''); setCancelTarget(scheduled); }}
            />
          </div>
        </section>
      )}

      {proposed.length > 0 && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiList size={14} /></span>
            <h3 className="aur-section-title">Propuestas pendientes</h3>
            <span className="aur-section-count">{proposed.length}</span>
          </div>
          <div className="strategy-cards">
            {proposed.map(p => (
              <VersionCard
                key={p.id}
                plan={p}
                headerLabel={`Propuesta v${p.version}`}
                onActivate={() => setConfirmActivate(p)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiCalendar size={14} /></span>
          <h3 className="aur-section-title">Historial de versiones</h3>
          {versions.length > 0 && <span className="aur-section-count">{versions.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : versions.length === 0 ? (
          <p className="strategy-empty">Aún no hay plan para {year}. Genera la primera versión.</p>
        ) : (
          <div className="strategy-cards">
            {versions.map(v => {
              const variant = CARD_VARIANT[v.status] || 'rejected';
              const badgeVariant = STATUS_BADGE_VARIANT[v.status] || 'aur-badge--gray';
              const label = STATUS_LABELS[v.status] || v.status;
              return (
                <details
                  key={v.id}
                  className={`strategy-card strategy-card--${variant} strategy-card--collapsible`}
                >
                  <summary className="strategy-card-header">
                    <span className="strategy-card-title">v{v.version}</span>
                    <span className={`aur-badge ${badgeVariant}`}>{label}</span>
                    {v.level && <span className="aur-badge aur-badge--blue">{v.level}</span>}
                    {v.isActive && <span className="aur-badge aur-badge--green">ACTIVO</span>}
                    <span className="strategy-meta-text strategy-card-summary-meta">
                      {fmtTs(v.createdAt)} · {v.lastUpdatedReason || 'sin razón'}
                    </span>
                  </summary>
                  <div className="strategy-card-body">
                    <ChangelogView changelog={v.changelog} />
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {confirmActivate && (
        <AuroraConfirmModal
          title="Activar versión"
          body={`Se activará la versión ${confirmActivate.version}. La versión activa actual quedará como 'superseded' (no se elimina).`}
          confirmLabel="Activar"
          onConfirm={() => activate(confirmActivate)}
          onCancel={() => setConfirmActivate(null)}
        />
      )}

      {cancelTarget && (
        <AuroraConfirmModal
          danger
          title="Cancelar activación programada"
          body={`La versión ${cancelTarget.version} pasará a 'cancelled' y no se activará. Podrás generar una nueva propuesta en su lugar.`}
          confirmLabel="Cancelar activación"
          loading={cancelling}
          loadingLabel="Cancelando…"
          onConfirm={confirmCancelScheduled}
          onCancel={() => { setCancelTarget(null); setCancelReason(''); }}
        >
          <div className="aur-field strategy-reject-field">
            <label className="aur-field-label" htmlFor="ap-cancel-reason">Motivo (opcional)</label>
            <textarea
              id="ap-cancel-reason"
              className="aur-textarea"
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Razón de la cancelación…"
              rows={3}
              maxLength={512}
            />
          </div>
        </AuroraConfirmModal>
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function VersionCard({ plan, headerLabel, countdown, onActivate, onCancelScheduled }) {
  const sections = plan.sections || {};
  const variant = CARD_VARIANT[plan.status] || 'rejected';
  const badgeVariant = STATUS_BADGE_VARIANT[plan.status] || 'aur-badge--gray';
  const label = STATUS_LABELS[plan.status] || plan.status;

  return (
    <article className={`strategy-card strategy-card--${variant}`}>
      <div className="strategy-card-header">
        <span className="strategy-card-title">{headerLabel}</span>
        <span className={`aur-badge ${badgeVariant}`}>{label}</span>
        {plan.level && <span className="aur-badge aur-badge--blue">{plan.level}</span>}
        {countdown && (
          <span className="aur-badge aur-badge--yellow">
            <FiClock size={11} /> {countdown}
          </span>
        )}
      </div>

      <div className="strategy-card-body">
        <div className="strategy-item-meta">
          Creada: {fmtTs(plan.createdAt)} · {plan.lastUpdatedReason || 'sin razón'}
        </div>

        <div className="strategy-section-cards">
          {sections.escenarioBase && (
            <SectionCard title="Escenario base" safe>
              <div>{sections.escenarioBase.name || sections.escenarioBase.scenarioId}</div>
              {sections.escenarioBase.margenProyectado != null && (
                <div className="strategy-item-meta">
                  Margen proyectado: {fmtMoney(sections.escenarioBase.margenProyectado)}
                </div>
              )}
            </SectionCard>
          )}
          {sections.presupuesto && (
            <SectionCard title="Presupuesto">
              <div className="strategy-item-meta">
                Total asignado: {fmtMoney(sections.presupuesto.totalAsignado)} · Margen esperado: {fmtMoney(sections.presupuesto.margenEsperado)}
              </div>
              {sections.presupuesto.budgetsSnapshot?.length > 0 && (
                <ul className="strategy-section-list">
                  {sections.presupuesto.budgetsSnapshot.map((b, i) => (
                    <li key={i}>{b.categoria || b.id}: {fmtMoney(b.assignedAmount || b.monto)}</li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
          {sections.cultivos?.length > 0 && (
            <SectionCard title={`Cultivos por lote (${sections.cultivos.length})`}>
              <ul className="strategy-section-list">
                {sections.cultivos.map((c, i) => (
                  <li key={i}>
                    {c.loteNombre || c.loteId} → {c.nombrePaquete || c.paqueteId}
                    {c.fechaEstimada && <> · {c.fechaEstimada}</>}
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
          {sections.rotaciones?.length > 0 && (
            <SectionCard title={`Rotaciones referenciadas (${sections.rotaciones.length})`}>
              <ul className="strategy-section-list">
                {sections.rotaciones.map((r, i) => (
                  <li key={i}>{r.loteId} · ref {r.recommendationId}{r.summary ? ` — ${r.summary}` : ''}</li>
                ))}
              </ul>
            </SectionCard>
          )}
          {sections.hitos?.length > 0 && (
            <SectionCard title={`Hitos (${sections.hitos.length})`} safe>
              <ul className="strategy-section-list">
                {sections.hitos.map((h, i) => (
                  <li key={i}>{h.fecha}: {h.descripcion}</li>
                ))}
              </ul>
            </SectionCard>
          )}
          {sections.supuestos?.length > 0 && (
            <SectionCard title={`Supuestos (${sections.supuestos.length})`} safe>
              <ul className="strategy-section-list">
                {sections.supuestos.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </SectionCard>
          )}
        </div>

        {plan.changelog?.length > 0 && (
          <details className="strategy-reasoning">
            <summary>Changelog ({plan.changelog.length} entradas)</summary>
            <ChangelogView changelog={plan.changelog} />
          </details>
        )}

        {plan.reasoning?.thinking && (
          <details className="strategy-reasoning">
            <summary>Razonamiento del modelo</summary>
            <pre className="strategy-reasoning-pre">{plan.reasoning.thinking}</pre>
          </details>
        )}
      </div>

      {(onActivate || onCancelScheduled) && (
        <div className="strategy-card-actions">
          {onActivate && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={onActivate}
            >
              <FiCheck size={14} /> Activar
            </button>
          )}
          {onCancelScheduled && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger"
              onClick={onCancelScheduled}
            >
              <FiX size={14} /> Cancelar activación
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function SectionCard({ title, children, safe }) {
  return (
    <div className={`strategy-section-card ${safe ? 'strategy-section-card--safe' : 'strategy-section-card--unsafe'}`}>
      <div className="strategy-section-card-title">
        {title} {safe && <FiLayers size={11} />}
      </div>
      {children}
    </div>
  );
}

function ChangelogView({ changelog }) {
  if (!Array.isArray(changelog) || changelog.length === 0) return null;
  return (
    <div className="strategy-changelog-list">
      {changelog.map((c, i) => (
        <div key={i} className="strategy-changelog-entry">
          <div>
            <strong>v{c.version}</strong> · {fmtTs(c.fecha)} · por <em>{c.autor}{c.autorEmail ? ` (${c.autorEmail})` : ''}</em>
            {c.level && <> · <code>{c.level}</code></>}
          </div>
          <div>{c.razon}</div>
          {c.summary && <div className="strategy-item-meta">{c.summary}</div>}
        </div>
      ))}
    </div>
  );
}

export default AnnualPlan;
