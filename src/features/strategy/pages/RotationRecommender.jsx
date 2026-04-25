import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiCompass, FiCheck, FiX, FiAlertTriangle, FiShield, FiCpu } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const LEVELS = [
  { value: 'nivel1', label: 'Nivel 1 — Recomendación', help: 'Claude propone; tú ejecutas manualmente.' },
  { value: 'nivel2', label: 'Nivel 2 — Supervisada', help: 'Claude propone; tú apruebas y ejecuta en un clic.' },
  { value: 'nivel3', label: 'Nivel 3 — Total', help: 'Claude propone y ejecuta si guardrails permiten (tope mensual aplicado).' },
];

const STATUS_BADGE = {
  issued: { label: 'Propuesta', cls: 'temporada-badge--auto' },
  executed: { label: 'Ejecutada', cls: 'temporada-badge--manual' },
  failed: { label: 'Falló', cls: 'temporada-badge--archived' },
  rejected: { label: 'Rechazada', cls: 'temporada-badge--archived' },
  rolled_back: { label: 'Rollback', cls: 'temporada-badge--archived' },
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

  // Carga lotes y recomendaciones existentes en paralelo.
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

  const rejectRecommendation = async (rec) => {
    const reason = window.prompt('Motivo del rechazo (opcional):', '') || '';
    try {
      const res = await apiFetch(
        `/api/strategy/rotation-recommendations/${rec.id}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'reject failed');
      setToast({ type: 'success', message: 'Recomendación rechazada.' });
      loadRecs();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo rechazar.' });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiCompass /> Recomendador de Rotación</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Aurora analiza el histórico del lote, los rendimientos agregados y las restricciones agronómicas, y propone una
        secuencia de cultivos para los próximos ciclos. Las violaciones de guardrails se muestran explícitamente
        antes de ejecutar.
      </p>

      {/* ── Generador ─────────────────────────────────────────────────── */}
      <div className="strategy-filters">
        <div className="strategy-field" style={{ minWidth: 260 }}>
          <label>Lote</label>
          <select value={loteId} onChange={e => setLoteId(e.target.value)}>
            <option value="">— Selecciona —</option>
            {lotes.map(l => (
              <option key={l.id} value={l.id}>
                {l.nombreLote || l.codigoLote || l.id}
              </option>
            ))}
          </select>
        </div>
        <div className="strategy-field">
          <label>Horizonte (ciclos)</label>
          <input
            type="number"
            min={1}
            max={6}
            value={horizonte}
            onChange={e => setHorizonte(e.target.value)}
          />
        </div>
        <div className="strategy-field" style={{ minWidth: 280 }}>
          <label>Nivel de autonomía</label>
          <select value={level} onChange={e => setLevel(e.target.value)}>
            {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <small style={{ opacity: 0.6, fontSize: 11 }}>
            {LEVELS.find(l => l.value === level)?.help}
          </small>
        </div>
        <button className="primary-button" onClick={runRecommender} disabled={running}>
          <FiCpu /> {running ? 'Pensando…' : 'Generar recomendación'}
        </button>
      </div>

      {/* ── Historial de recomendaciones ──────────────────────────────── */}
      <h3 style={{ margin: '18px 0 10px', fontSize: 14, opacity: 0.75 }}>
        Recomendaciones recientes
      </h3>

      {loadingRecs ? (
        <div className="strategy-empty">Cargando…</div>
      ) : recommendations.length === 0 ? (
        <div className="strategy-empty">Aún no has generado recomendaciones.</div>
      ) : (
        <div className="temporadas-list">
          {recommendations.map(rec => {
            const status = STATUS_BADGE[rec.status] || { label: rec.status, cls: 'temporada-badge--archived' };
            const lote = lotesById[rec.loteId];
            const hasBlocking = rec.guardrailsCheck?.violations?.some(v => v.severity === 'block');
            return (
              <div key={rec.id} className="temporada-card" style={{ gridTemplateColumns: '1fr' }}>
                <div>
                  <div className="temporada-card-header">
                    <span className="temporada-name">
                      {rec.loteNombre || lote?.nombreLote || rec.loteId}
                    </span>
                    <span className={`temporada-badge ${status.cls}`}>{status.label}</span>
                    <span className="temporada-badge temporada-badge--auto">{rec.level}</span>
                  </div>
                  <div className="temporada-meta">
                    Generada: {fmtDate(rec.createdAt)} · {rec.propuestas?.length || 0} ciclos · horizonte {rec.horizonteCiclos}
                  </div>
                  {rec.comentarioGeneral && (
                    <div className="temporada-meta" style={{ marginTop: 6, fontStyle: 'italic' }}>
                      "{rec.comentarioGeneral}"
                    </div>
                  )}

                  {/* Propuestas */}
                  <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                    {(rec.propuestas || []).map(p => (
                      <div
                        key={`${rec.id}_${p.orden}`}
                        className="temporada-proposal"
                        style={{ gridTemplateColumns: '1fr' }}
                      >
                        <div>
                          <div className="temporada-card-header">
                            <span className="temporada-name">#{p.orden} — {p.nombrePaquete || p.paqueteId || '⚠ paquete inválido'}</span>
                            {p.cultivo && <span className="temporada-badge temporada-badge--manual">{p.cultivo}</span>}
                            {p.familiaBotanica && <span className="temporada-badge temporada-badge--auto">{p.familiaBotanica}</span>}
                          </div>
                          <div className="temporada-range">
                            Siembra: {p.fechaSiembra} · Duración estimada: {p.duracionEstimadaDias || '—'} días
                          </div>
                          {p.razon && <div className="temporada-meta">{p.razon}</div>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Guardrails */}
                  {rec.guardrailsCheck && (
                    <div style={{ marginTop: 10 }}>
                      <div className="temporada-meta" style={{ fontWeight: 600 }}>
                        <FiShield style={{ marginRight: 4 }} />
                        Guardrails: {rec.guardrailsCheck.allowed ? 'OK' : 'Bloquean ejecución'}
                      </div>
                      {(rec.guardrailsCheck.violations || []).map((v, i) => (
                        <div
                          key={i}
                          className="temporada-meta"
                          style={{ color: v.severity === 'block' ? '#ff8080' : '#e0b000', marginTop: 4 }}
                        >
                          <FiAlertTriangle style={{ marginRight: 4 }} />
                          [{v.code}] {v.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Ejecución (si aplica) */}
                  {rec.executedSiembrasIds?.length > 0 && (
                    <div className="temporada-meta" style={{ marginTop: 6 }}>
                      Siembras creadas: {rec.executedSiembrasIds.length}
                    </div>
                  )}
                  {rec.executionErrors?.length > 0 && (
                    <div className="temporada-meta" style={{ marginTop: 6, color: '#ff8080' }}>
                      Errores: {rec.executionErrors.map(e => `#${e.orden}: ${e.message}`).join(' · ')}
                    </div>
                  )}

                  {rec.rejectionReason && (
                    <div className="temporada-meta" style={{ marginTop: 6 }}>
                      Motivo del rechazo: {rec.rejectionReason}
                    </div>
                  )}

                  {/* Reasoning (solo supervisor+) */}
                  {rec.reasoning?.thinking && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>
                        Ver razonamiento del modelo
                      </summary>
                      <pre style={{
                        whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6,
                        padding: 10, background: 'var(--aurora-dark-blue)',
                        border: '1px solid var(--aurora-border)', borderRadius: 6,
                      }}>
                        {rec.reasoning.thinking}
                      </pre>
                    </details>
                  )}

                  {/* Acciones */}
                  {rec.status === 'issued' && (
                    <div className="temporadas-header-actions" style={{ marginTop: 12, marginBottom: 0 }}>
                      <button
                        className="primary-button"
                        disabled={hasBlocking}
                        onClick={() => setConfirmAccept(rec)}
                        title={hasBlocking ? 'Los guardrails bloquean la ejecución.' : 'Ejecutar'}
                      >
                        <FiCheck /> Aceptar y ejecutar
                      </button>
                      <button className="primary-button" onClick={() => rejectRecommendation(rec)}>
                        <FiX /> Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

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
    </div>
  );
}

export default RotationRecommender;
