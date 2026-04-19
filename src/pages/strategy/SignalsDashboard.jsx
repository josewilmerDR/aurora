import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiActivity, FiRefreshCw, FiUpload } from 'react-icons/fi';
import Toast from '../../components/Toast';
import { useApiFetch } from '../../hooks/useApiFetch';
import './strategy.css';

const SIGNAL_TYPE_LABELS = {
  weather: 'Clima',
  commodity_price: 'Precio commodity',
  fertilizer_price: 'Precio fertilizante',
};

function emptyManualForm() {
  return {
    signalType: 'commodity_price',
    value: '',
    unit: 'USD/kg',
    confidence: 0.7,
    observedAt: new Date().toISOString().slice(0, 10),
    metadata: '',
    note: '',
  };
}

function fmtTs(ts) {
  if (!ts) return '—';
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString();
  return '—';
}

function fmtValue(s) {
  if (s.value == null) return '—';
  return `${Number(s.value).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${s.unit || ''}`;
}

function confidenceBadge(c) {
  if (c == null) return '—';
  if (c >= 0.85) return 'Alta';
  if (c >= 0.6) return 'Media';
  return 'Baja';
}

function SignalsDashboard() {
  const apiFetch = useApiFetch();
  const [signals, setSignals] = useState([]);
  const [sources, setSources] = useState([]);
  const [filterType, setFilterType] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterSource) qs.set('sourceId', filterSource);
      if (filterType) qs.set('signalType', filterType);
      const [signalsRes, sourcesRes] = await Promise.all([
        apiFetch(`/api/signals${qs.toString() ? `?${qs}` : ''}`),
        apiFetch('/api/signals/sources'),
      ]);
      const [sigData, srcData] = await Promise.all([signalsRes.json(), sourcesRes.json()]);
      setSignals(Array.isArray(sigData) ? sigData : []);
      setSources(Array.isArray(srcData) ? srcData : []);
    } catch (e) {
      setToast({ type: 'error', message: 'No se pudieron cargar las señales.' });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filterSource, filterType]);

  useEffect(() => { load(); }, [load]);

  const sourcesById = useMemo(
    () => Object.fromEntries(sources.map(s => [s.id, s])),
    [sources]
  );

  const submitManual = async () => {
    setSubmitting(true);
    try {
      const body = {
        signalType: manual.signalType,
        value: Number(manual.value),
        unit: manual.unit,
        confidence: Number(manual.confidence),
        observedAt: manual.observedAt,
        note: manual.note || undefined,
      };
      if (manual.metadata?.trim()) {
        try { body.metadata = JSON.parse(manual.metadata); }
        catch { throw new Error('Metadata debe ser JSON válido.'); }
      }
      const res = await apiFetch('/api/signals/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'manual failed');
      setManual(null);
      load();
      setToast({ type: 'success', message: 'Observación cargada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo cargar.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiActivity /> Señales Externas</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Observaciones recientes de las fuentes configuradas. Cada registro incluye confianza (declarada por la fuente) y
        metadatos originales para auditoría.
      </p>

      <div className="strategy-filters">
        <div className="strategy-field">
          <label>Tipo</label>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="strategy-field">
          <label>Fuente</label>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}>
            <option value="">Todas</option>
            {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button className="primary-button" onClick={load} disabled={loading}>
          <FiRefreshCw /> {loading ? 'Cargando…' : 'Actualizar'}
        </button>
        <button className="primary-button" onClick={() => setManual(emptyManualForm())}>
          <FiUpload /> Cargar observación manual
        </button>
      </div>

      {manual && (
        <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
          <div>
            <div className="strategy-filters">
              <div className="strategy-field">
                <label>Tipo</label>
                <select value={manual.signalType} onChange={e => setManual({ ...manual, signalType: e.target.value })}>
                  {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="strategy-field">
                <label>Fecha</label>
                <input type="date" value={manual.observedAt} onChange={e => setManual({ ...manual, observedAt: e.target.value })} />
              </div>
              <div className="strategy-field">
                <label>Valor</label>
                <input type="number" step="any" value={manual.value} onChange={e => setManual({ ...manual, value: e.target.value })} />
              </div>
              <div className="strategy-field">
                <label>Unidad</label>
                <input type="text" maxLength={32} value={manual.unit} onChange={e => setManual({ ...manual, unit: e.target.value })} />
              </div>
              <div className="strategy-field">
                <label>Confianza (0..1)</label>
                <input type="number" step="0.05" min={0} max={1} value={manual.confidence} onChange={e => setManual({ ...manual, confidence: e.target.value })} />
              </div>
              <div className="strategy-field" style={{ flex: '1 1 260px' }}>
                <label>Nota</label>
                <input type="text" maxLength={512} value={manual.note} onChange={e => setManual({ ...manual, note: e.target.value })} />
              </div>
              <div className="strategy-field" style={{ flex: '1 1 260px' }}>
                <label>Metadata JSON (opcional)</label>
                <input
                  type="text"
                  placeholder='{"fuente":"SIPSA","producto":"tomate"}'
                  value={manual.metadata}
                  onChange={e => setManual({ ...manual, metadata: e.target.value })}
                />
              </div>
            </div>
            <div className="temporadas-header-actions" style={{ marginTop: 8, marginBottom: 0 }}>
              <button className="primary-button" onClick={submitManual} disabled={submitting}>
                <FiUpload /> {submitting ? 'Cargando…' : 'Guardar'}
              </button>
              <button className="primary-button" onClick={() => setManual(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="strategy-empty">Cargando…</div>
      ) : signals.length === 0 ? (
        <div className="strategy-empty">Sin observaciones.</div>
      ) : (
        <div className="strategy-table-wrap">
          <table className="strategy-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Fuente</th>
                <th>Tipo</th>
                <th>Valor</th>
                <th>Confianza</th>
                <th>Ingresado</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => {
                const src = sourcesById[s.sourceId];
                return (
                  <tr key={s.id}>
                    <td>{s.observedAt}</td>
                    <td>{src?.name || s.sourceId}</td>
                    <td>{SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}</td>
                    <td className="strategy-amount">{fmtValue(s)}</td>
                    <td>{confidenceBadge(s.confidence)}</td>
                    <td>{fmtTs(s.fetchedAt)}</td>
                    <td style={{ maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.metadata ? JSON.stringify(s.metadata) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

export default SignalsDashboard;
