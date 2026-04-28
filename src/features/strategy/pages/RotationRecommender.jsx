import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiCompass, FiCheck, FiX, FiAlertTriangle, FiShield, FiCpu, FiList, FiSliders,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const LEVELS = [
  { value: 'nivel1', label: 'Nivel 1 — Recomendación', help: 'Claude propone; tú ejecutas manualmente.' },
  { value: 'nivel2', label: 'Nivel 2 — Supervisada', help: 'Claude propone; tú apruebas y ejecuta en un clic.' },
  { value: 'nivel3', label: 'Nivel 3 — Total', help: 'Claude propone y ejecuta si guardrails permiten (tope mensual aplicado).' },
];

// Mapeo centralizado: estado del flujo → variante de aur-badge.
// issued = propuesta sin actuar; executed = positivo; failed/rejected/rolled_back = neutro o danger.
const STATUS_BADGE_VARIANT = {
  issued:      'aur-badge--violet',
  executed:    'aur-badge--green',
  failed:      'aur-badge--magenta',
  rejected:    'aur-badge--gray',
  rolled_back: 'aur-badge--gray',
};
const STATUS_LABELS = {
  issued:      'Propuesta',
  executed:    'Ejecutada',
  failed:      'Falló',
  rejected:    'Rechazada',
  rolled_back: 'Rollback',
};

function fmtDate(ts) {
  if (!ts) return '—';
  // Firestore Timestamp serialized as {_seconds, _nanoseconds} por el admin SDK.
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString();
  if (ts.toDate) return ts.toDate().toLocaleString();
  return '—';
}

function RotationRecommender() {
  const apiFetch = useApiFetch();
  const [lotes, setLotes] = useState([]);
  const [loteId, setLoteId] = useState('');
  const [horizonte, setHorizonte] = useState(3);
  const [level, setLevel] = useState('nivel1');
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAccept, setConfirmAccept] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const loadLotes = useCallback(() => {
    apiFetch('/api/lotes')
      .then(r => r.json())
      .then(data => setLotes(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [apiFetch]);

  const loadRecs = useCallback(() => {
    setLoadingRecs(true);
    apiFetch('/api/strategy/rotation-recommendations')
      .then(r => r.json())
      .then(data => setRecommendations(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingRecs(false));
  }, [apiFetch]);

  useEffect(() => { loadLotes(); loadRecs(); }, [loadLotes, loadRecs]);

  const lotesById = useMemo(
    () => Object.fromEntries(lotes.map(l => [l.id, l])),
    [lotes]
  );

  const runRecommender = async () => {
    if (!loteId) {
      setToast({ type: 'error', message: 'Selecciona un lote.' });
      return;
    }
    setRunning(true);
    try {
      const res = await apiFetch('/api/strategy/rotation/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loteId, horizonteCiclos: Number(horizonte), level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'recommend failed');
      setToast({
        type: 'success',
        message: level === 'nivel3' && data.status === 'executed'
          ? 'Recomendación generada y ejecutada.'
          : 'Recomendación generada.',
      });
      loadRecs();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo generar.' });
    } finally {
      setRunning(false);
    }
  };

  const acceptRecommendation = async (rec) => {
    setConfirmAccept(null);
    try {
      const res = await apiFetch(
        `/api/strategy/rotation-recommendations/${rec.id}/accept`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'accept failed');
      setToast({
        type: data.status === 'executed' ? 'success' : 'error',
        message: data.status === 'executed'
          ? 'Recomendación aceptada y siembras creadas.'
          : 'Aceptación falló en una o más propuestas; revisa el historial.',
      });
      loadRecs();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo aceptar.' });
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await apiFetch(
        `/api/strategy/rotation-recommendations/${rejectTarget.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: rejectReason || '' }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'reject failed');
      setToast({ type: 'success', message: 'Recomendación rechazada.' });
      setRejectTarget(null);
      setRejectReason('');
      loadRecs();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo rechazar.' });
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiCompass /> Recomendador de Rotación</h2>
          <p className="aur-sheet-subtitle">
            Aurora analiza el histórico del lote, los rendimientos agregados y las restricciones agronómicas, y
            propone una secuencia de cultivos para los próximos ciclos. Las violaciones de guardrails se muestran
            explícitamente antes de ejecutar.
          </p>
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiSliders size={14} /></span>
          <h3 className="aur-section-title">Generar recomendación</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="rr-lote">Lote</label>
            <div className="aur-field">
              <select
                id="rr-lote"
                className="aur-select"
                value={loteId}
                onChange={e => setLoteId(e.target.value)}
              >
                <option value="">— Selecciona —</option>
                {lotes.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.nombreLote || l.codigoLote || l.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="rr-horizonte">Horizonte (ciclos)</label>
            <div className="aur-field">
              <input
                id="rr-horizonte"
                type="number"
                min={1}
                max={6}
                className="aur-input aur-input--num"
                value={horizonte}
                onChange={e => setHorizonte(e.target.value)}
              />
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="rr-level">Nivel de autonomía</label>
            <div className="aur-field">
              <select
                id="rr-level"
                className="aur-select"
                value={level}
                onChange={e => setLevel(e.target.value)}
              >
                {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <p className="aur-field-hint">
                {LEVELS.find(l => l.value === level)?.help}
              </p>
            </div>
          </div>
        </div>
        <div className="aur-form-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={runRecommender}
            disabled={running}
          >
            <FiCpu size={14} /> {running ? 'Pensando…' : 'Generar recomendación'}
          </button>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Recomendaciones recientes</h3>
          {recommendations.length > 0 && <span className="aur-section-count">{recommendations.length}</span>}
        </div>

        {loadingRecs ? (
          <p className="strategy-empty">Cargando…</p>
        ) : recommendations.length === 0 ? (
          <p className="strategy-empty">Aún no has generado recomendaciones.</p>
        ) : (
          <div className="strategy-cards">
            {recommendations.map(rec => {
              const variant = STATUS_BADGE_VARIANT[rec.status] || 'aur-badge--gray';
              const label = STATUS_LABELS[rec.status] || rec.status;
              const lote = lotesById[rec.loteId];
              const hasBlocking = rec.guardrailsCheck?.violations?.some(v => v.severity === 'block');
              return (
                <article
                  key={rec.id}
                  className={`strategy-card strategy-card--${rec.status}`}
                >
                  <div className="strategy-card-header">
                    <span className="strategy-card-title">
                      {rec.loteNombre || lote?.nombreLote || rec.loteId}
                    </span>
                    <span className={`aur-badge ${variant}`}>{label}</span>
                    <span className="aur-badge aur-badge--blue">{rec.level}</span>
                  </div>

                  <div className="strategy-card-body">
                    <div className="strategy-item-meta">
                      Generada: {fmtDate(rec.createdAt)} · {rec.propuestas?.length || 0} ciclos · horizonte {rec.horizonteCiclos}
                    </div>
                    {rec.comentarioGeneral && (
                      <div className="strategy-card-quote">"{rec.comentarioGeneral}"</div>
                    )}

                    {(rec.propuestas || []).length > 0 && (
                      <div className="strategy-proposals">
                        {rec.propuestas.map(p => (
                          <div key={`${rec.id}_${p.orden}`} className="strategy-proposal">
                            <div className="strategy-item-head">
                              <span className="strategy-item-title">
                                #{p.orden} — {p.nombrePaquete || p.paqueteId || '⚠ paquete inválido'}
                              </span>
                              {p.cultivo && (
                                <span className="aur-badge aur-badge--green">{p.cultivo}</span>
                              )}
                              {p.familiaBotanica && (
                                <span className="aur-badge aur-badge--blue">{p.familiaBotanica}</span>
                              )}
                            </div>
                            <div className="strategy-item-sub">
                              Siembra: {p.fechaSiembra} · Duración estimada: {p.duracionEstimadaDias || '—'} días
                            </div>
                            {p.razon && <div className="strategy-item-meta">{p.razon}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {rec.guardrailsCheck && (
                      <div className={`aur-banner ${rec.guardrailsCheck.allowed ? 'aur-banner--info' : 'aur-banner--danger'}`}>
                        <FiShield size={14} />
                        <div>
                          <div>
                            <strong>Guardrails:</strong>{' '}
                            {rec.guardrailsCheck.allowed ? 'OK' : 'Bloquean ejecución'}
                          </div>
                          {(rec.guardrailsCheck.violations || []).map((v, i) => (
                            <div
                              key={i}
                              className={v.severity === 'block' ? 'strategy-num--neg' : 'strategy-num--warn'}
                            >
                              <FiAlertTriangle size={11} /> [{v.code}] {v.message}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {rec.executedSiembrasIds?.length > 0 && (
                      <div className="strategy-item-meta">
                        Siembras creadas: {rec.executedSiembrasIds.length}
                      </div>
                    )}
                    {rec.executionErrors?.length > 0 && (
                      <div className="strategy-item-meta strategy-num--neg">
                        Errores: {rec.executionErrors.map(e => `#${e.orden}: ${e.message}`).join(' · ')}
                      </div>
                    )}
                    {rec.rejectionReason && (
                      <div className="strategy-item-meta">
                        Motivo del rechazo: {rec.rejectionReason}
                      </div>
                    )}

                    {rec.reasoning?.thinking && (
                      <details className="strategy-reasoning">
                        <summary>Ver razonamiento del modelo</summary>
                        <pre className="strategy-reasoning-pre">{rec.reasoning.thinking}</pre>
                      </details>
                    )}
                  </div>

                  {rec.status === 'issued' && (
                    <div className="strategy-card-actions">
                      <button
                        type="button"
                        className="aur-btn-pill aur-btn-pill--sm"
                        disabled={hasBlocking}
                        onClick={() => setConfirmAccept(rec)}
                        title={hasBlocking ? 'Los guardrails bloquean la ejecución.' : 'Ejecutar'}
                      >
                        <FiCheck size={14} /> Aceptar y ejecutar
                      </button>
                      <button
                        type="button"
                        className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger"
                        onClick={() => { setRejectReason(''); setRejectTarget(rec); }}
                      >
                        <FiX size={14} /> Rechazar
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      {confirmAccept && (
        <AuroraConfirmModal
          title="Ejecutar recomendación"
          body={`Se crearán ${confirmAccept.propuestas?.length || 0} siembras programadas y quedarán registradas como acciones de Aurora Copilot (reversibles).`}
          confirmLabel="Sí, ejecutar"
          onConfirm={() => acceptRecommendation(confirmAccept)}
          onCancel={() => setConfirmAccept(null)}
        />
      )}

      {rejectTarget && (
        <AuroraConfirmModal
          danger
          title="Rechazar recomendación"
          body={`Se marcará como rechazada la recomendación para "${rejectTarget.loteNombre || rejectTarget.loteId}". Puedes anotar el motivo.`}
          confirmLabel="Rechazar"
          loading={rejecting}
          loadingLabel="Rechazando…"
          onConfirm={confirmReject}
          onCancel={() => { setRejectTarget(null); setRejectReason(''); }}
        >
          <div className="aur-field strategy-reject-field">
            <label className="aur-field-label" htmlFor="rr-reject-reason">Motivo (opcional)</label>
            <textarea
              id="rr-reject-reason"
              className="aur-textarea"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Razón del rechazo…"
              rows={3}
              maxLength={512}
            />
          </div>
        </AuroraConfirmModal>
      )}
    </div>
  );
}

export default RotationRecommender;
