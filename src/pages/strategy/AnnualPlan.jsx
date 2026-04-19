import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiBookOpen, FiCpu, FiCheck, FiX, FiClock, FiLayers, FiRefreshCw } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import { useApiFetch } from '../../hooks/useApiFetch';
import './strategy.css';

const LEVEL_OPTIONS = [
  { value: 'nivel1', label: 'Nivel 1 — propuesta' },
  { value: 'nivel2', label: 'Nivel 2 — auto en secciones seguras' },
  { value: 'nivel3', label: 'Nivel 3 — aplicación con delay 24h' },
];

const STATUS_BADGE = {
  draft: { label: 'Borrador', cls: 'temporada-badge--archived' },
  proposed: { label: 'Propuesta', cls: 'temporada-badge--auto' },
  active: { label: 'Activo', cls: 'temporada-badge--manual' },
  scheduled_activation: { label: 'Programado', cls: 'temporada-badge--auto' },
  superseded: { label: 'Superseded', cls: 'temporada-badge--archived' },
  cancelled: { label: 'Cancelado', cls: 'temporada-badge--archived' },
};

const SAFE_SECTIONS = new Set(['supuestos', 'hitos', 'escenarioBase']);

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
  const [confirmCancel, setConfirmCancel] = useState(null);

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

  const cancelScheduled = async (plan) => {
    setConfirmCancel(null);
    const reason = window.prompt('Motivo de la cancelación:', '') || '';
    try {
      const res = await apiFetch(`/api/strategy/annual-plans/${plan.id}/cancel-scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'cancel failed');
      setToast({ type: 'success', message: 'Activación programada cancelada.' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo cancelar.' });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiBookOpen /> Plan Anual Vivo</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Documento versionado que integra rotaciones, escenarios y presupuesto. Cada actualización crea una versión
        nueva sin borrar las anteriores. El changelog es inmutable.
      </p>

      {/* Controles */}
      <div className="strategy-filters">
        <div className="strategy-field">
          <label>Año</label>
          <input
            type="number" min={2020} max={2099}
            value={year} onChange={e => setYear(Number(e.target.value) || currentYear)}
          />
        </div>
        <div className="strategy-field" style={{ minWidth: 260 }}>
          <label>Nivel de autonomía</label>
          <select value={level} onChange={e => setLevel(e.target.value)}>
            {LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button className="primary-button" onClick={generate} disabled={generating}>
          <FiCpu /> {generating ? 'Generando…' : 'Generar nueva versión'}
        </button>
        <button className="primary-button" onClick={load} disabled={loading}>
          <FiRefreshCw /> Refrescar
        </button>
      </div>

      {/* Estado activo */}
      {active && (
        <VersionCard
          plan={active}
          headerLabel={`Versión activa ${active.year}-v${active.version}`}
          onActivate={null}
          onCancelScheduled={null}
        />
      )}

      {/* Activación programada (N3) */}
      {scheduled && (
        <VersionCard
          plan={scheduled}
          headerLabel={`Activación programada — v${scheduled.version}`}
          countdown={countdownTo(scheduled.activationScheduledFor)}
          onActivate={() => setConfirmActivate(scheduled)}
          onCancelScheduled={() => setConfirmCancel(scheduled)}
        />
      )}

      {/* Propuestas pendientes */}
      {proposed.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ margin: '10px 0', fontSize: 14, opacity: 0.75 }}>
            Propuestas pendientes ({proposed.length})
          </h3>
          {proposed.map(p => (
            <VersionCard
              key={p.id}
              plan={p}
              headerLabel={`Propuesta v${p.version}`}
              onActivate={() => setConfirmActivate(p)}
              onCancelScheduled={null}
            />
          ))}
        </div>
      )}

      {/* Historial */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, opacity: 0.75 }}>
        Historial de versiones ({versions.length})
      </h3>
      {loading ? (
        <div className="strategy-empty">Cargando…</div>
      ) : versions.length === 0 ? (
        <div className="strategy-empty">Aún no hay plan para {year}. Genera la primera versión.</div>
      ) : (
        <div className="temporadas-list">
          {versions.map(v => (
            <details key={v.id} className="temporada-card" style={{ gridTemplateColumns: '1fr' }}>
              <summary style={{ cursor: 'pointer' }}>
                <div className="temporada-card-header">
                  <span className="temporada-name">v{v.version}</span>
                  <span className={`temporada-badge ${STATUS_BADGE[v.status]?.cls || ''}`}>
                    {STATUS_BADGE[v.status]?.label || v.status}
                  </span>
                  {v.level && <span className="temporada-badge temporada-badge--auto">{v.level}</span>}
                  {v.isActive && <span className="temporada-badge temporada-badge--manual">ACTIVO</span>}
                </div>
                <div className="temporada-meta">
                  {fmtTs(v.createdAt)} · {v.lastUpdatedReason || 'sin razón'}
                </div>
              </summary>
              <div style={{ marginTop: 10 }}>
                <ChangelogView changelog={v.changelog} />
              </div>
            </details>
          ))}
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmActivate && (
        <ConfirmModal
          title="Activar versión"
          message={`Se activará la versión ${confirmActivate.version}. La versión activa actual quedará como 'superseded' (no se elimina).`}
          confirmLabel="Activar"
          onConfirm={() => activate(confirmActivate)}
          onCancel={() => setConfirmActivate(null)}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Cancelar activación programada"
          message={`La versión ${confirmCancel.version} pasará a 'cancelled' y no se activará. Podrás generar una nueva propuesta en su lugar.`}
          confirmLabel="Cancelar activación"
          onConfirm={() => cancelScheduled(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function VersionCard({ plan, headerLabel, countdown, onActivate, onCancelScheduled }) {
  const sections = plan.sections || {};
  return (
    <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
      <div>
        <div className="temporada-card-header">
          <span className="temporada-name">{headerLabel}</span>
          <span className={`temporada-badge ${STATUS_BADGE[plan.status]?.cls || ''}`}>
            {STATUS_BADGE[plan.status]?.label || plan.status}
          </span>
          {plan.level && <span className="temporada-badge temporada-badge--auto">{plan.level}</span>}
          {countdown && (
            <span className="temporada-badge temporada-badge--auto">
              <FiClock style={{ marginRight: 4 }} />{countdown}
            </span>
          )}
        </div>
        <div className="temporada-meta">
          Creada: {fmtTs(plan.createdAt)} · {plan.lastUpdatedReason || 'sin razón'}
        </div>

        {/* Secciones */}
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          {sections.escenarioBase && (
            <SectionCard title="Escenario base" safe>
              <div>{sections.escenarioBase.name || sections.escenarioBase.scenarioId}</div>
              {sections.escenarioBase.margenProyectado != null && (
                <div className="temporada-meta">
                  Margen proyectado: {fmtMoney(sections.escenarioBase.margenProyectado)}
                </div>
              )}
            </SectionCard>
          )}
          {sections.presupuesto && (
            <SectionCard title="Presupuesto">
              <div className="temporada-meta">
                Total asignado: {fmtMoney(sections.presupuesto.totalAsignado)} · Margen esperado: {fmtMoney(sections.presupuesto.margenEsperado)}
              </div>
              {sections.presupuesto.budgetsSnapshot?.length > 0 && (
                <ul style={{ fontSize: 12, marginTop: 6 }}>
                  {sections.presupuesto.budgetsSnapshot.map((b, i) => (
                    <li key={i}>{b.categoria || b.id}: {fmtMoney(b.assignedAmount || b.monto)}</li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}
          {sections.cultivos?.length > 0 && (
            <SectionCard title={`Cultivos por lote (${sections.cultivos.length})`}>
              <ul style={{ fontSize: 12 }}>
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
              <ul style={{ fontSize: 12 }}>
                {sections.rotaciones.map((r, i) => (
                  <li key={i}>{r.loteId} · ref {r.recommendationId}{r.summary ? ` — ${r.summary}` : ''}</li>
                ))}
              </ul>
            </SectionCard>
          )}
          {sections.hitos?.length > 0 && (
            <SectionCard title={`Hitos (${sections.hitos.length})`} safe>
              <ul style={{ fontSize: 12 }}>
                {sections.hitos.map((h, i) => (
                  <li key={i}>{h.fecha}: {h.descripcion}</li>
                ))}
              </ul>
            </SectionCard>
          )}
          {sections.supuestos?.length > 0 && (
            <SectionCard title={`Supuestos (${sections.supuestos.length})`} safe>
              <ul style={{ fontSize: 12 }}>
                {sections.supuestos.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </SectionCard>
          )}
        </div>

        {/* Changelog colapsado */}
        {plan.changelog?.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>
              Changelog ({plan.changelog.length} entradas)
            </summary>
            <ChangelogView changelog={plan.changelog} />
          </details>
        )}

        {/* Reasoning */}
        {plan.reasoning?.thinking && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>Razonamiento del modelo</summary>
            <pre style={{
              whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6,
              padding: 10, background: 'var(--aurora-dark-blue)',
              border: '1px solid var(--aurora-border)', borderRadius: 6,
            }}>{plan.reasoning.thinking}</pre>
          </details>
        )}

        {/* Acciones */}
        {(onActivate || onCancelScheduled) && (
          <div className="temporadas-header-actions" style={{ marginTop: 12, marginBottom: 0 }}>
            {onActivate && (
              <button className="primary-button" onClick={onActivate}>
                <FiCheck /> Activar
              </button>
            )}
            {onCancelScheduled && (
              <button className="primary-button" onClick={onCancelScheduled}>
                <FiX /> Cancelar activación
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, children, safe }) {
  return (
    <div style={{
      border: '1px solid var(--aurora-border)',
      borderLeft: safe ? '3px solid var(--aurora-green)' : '3px solid var(--aurora-magenta)',
      padding: '8px 12px',
      borderRadius: 6,
      background: 'var(--aurora-dark-blue)',
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3px', opacity: 0.7, marginBottom: 4 }}>
        {title} {safe && <FiLayers style={{ marginLeft: 4 }} />}
      </div>
      {children}
    </div>
  );
}

function ChangelogView({ changelog }) {
  if (!Array.isArray(changelog) || changelog.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
      {changelog.map((c, i) => (
        <div key={i} style={{
          borderLeft: '2px solid var(--aurora-border)',
          paddingLeft: 10, fontSize: 12,
        }}>
          <div>
            <strong>v{c.version}</strong> · {fmtTs(c.fecha)} · por <em>{c.autor}{c.autorEmail ? ` (${c.autorEmail})` : ''}</em>
            {c.level && <> · <code>{c.level}</code></>}
          </div>
          <div>{c.razon}</div>
          {c.summary && <div style={{ opacity: 0.7 }}>{c.summary}</div>}
        </div>
      ))}
    </div>
  );
}

export default AnnualPlan;
