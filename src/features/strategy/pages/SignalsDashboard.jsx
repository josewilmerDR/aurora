import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiActivity, FiRefreshCw, FiUpload, FiFilter, FiX, FiList } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const SIGNAL_TYPE_LABELS = {
  weather: 'Clima',
  commodity_price: 'Precio commodity',
  fertilizer_price: 'Precio fertilizante',
};

const CONFIDENCE_VARIANT = {
  high:  'aur-badge--green',
  med:   'aur-badge--yellow',
  low:   'aur-badge--gray',
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

function confidenceTier(c) {
  if (c == null) return null;
  if (c >= 0.85) return { key: 'high', label: 'Alta' };
  if (c >= 0.6)  return { key: 'med',  label: 'Media' };
  return { key: 'low', label: 'Baja' };
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
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiActivity /> Señales Externas</h2>
          <p className="aur-sheet-subtitle">
            Observaciones recientes de las fuentes configuradas. Cada registro incluye confianza (declarada por la
            fuente) y metadatos originales para auditoría.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={load}
            disabled={loading}
          >
            <FiRefreshCw size={14} /> {loading ? 'Cargando…' : 'Actualizar'}
          </button>
          {!manual && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setManual(emptyManualForm())}
            >
              <FiUpload size={14} /> Cargar observación
            </button>
          )}
        </div>
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiFilter size={14} /></span>
          <h3 className="aur-section-title">Filtros</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="sd-tipo">Tipo</label>
            <div className="aur-field">
              <select
                id="sd-tipo"
                className="aur-select"
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
              >
                <option value="">Todos</option>
                {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="sd-fuente">Fuente</label>
            <div className="aur-field">
              <select
                id="sd-fuente"
                className="aur-select"
                value={filterSource}
                onChange={e => setFilterSource(e.target.value)}
              >
                <option value="">Todas</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      {manual && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiUpload size={14} /></span>
            <h3 className="aur-section-title">Cargar observación manual</h3>
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={() => setManual(null)}
                title="Cancelar"
              >
                <FiX size={14} />
              </button>
            </div>
          </div>
          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-tipo">Tipo</label>
              <div className="aur-field">
                <select
                  id="sd-m-tipo"
                  className="aur-select"
                  value={manual.signalType}
                  onChange={e => setManual({ ...manual, signalType: e.target.value })}
                >
                  {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-fecha">Fecha</label>
              <div className="aur-field">
                <input
                  id="sd-m-fecha"
                  type="date"
                  className="aur-input"
                  value={manual.observedAt}
                  onChange={e => setManual({ ...manual, observedAt: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-valor">Valor</label>
              <div className="aur-field">
                <input
                  id="sd-m-valor"
                  type="number"
                  step="any"
                  className="aur-input aur-input--num"
                  value={manual.value}
                  onChange={e => setManual({ ...manual, value: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-unidad">Unidad</label>
              <div className="aur-field">
                <input
                  id="sd-m-unidad"
                  type="text"
                  className="aur-input"
                  maxLength={32}
                  value={manual.unit}
                  onChange={e => setManual({ ...manual, unit: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-conf">Confianza (0..1)</label>
              <div className="aur-field">
                <input
                  id="sd-m-conf"
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  className="aur-input aur-input--num"
                  value={manual.confidence}
                  onChange={e => setManual({ ...manual, confidence: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-nota">Nota</label>
              <div className="aur-field">
                <input
                  id="sd-m-nota"
                  type="text"
                  className="aur-input"
                  maxLength={512}
                  value={manual.note}
                  onChange={e => setManual({ ...manual, note: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="sd-m-meta">Metadata JSON</label>
              <div className="aur-field">
                <input
                  id="sd-m-meta"
                  type="text"
                  className="aur-input"
                  placeholder='{"fuente":"SIPSA","producto":"tomate"}'
                  value={manual.metadata}
                  onChange={e => setManual({ ...manual, metadata: e.target.value })}
                />
                <p className="aur-field-hint">Opcional. Debe ser JSON válido si se llena.</p>
              </div>
            </div>
          </div>
          <div className="aur-form-actions">
            <button
              type="button"
              className="aur-btn-text"
              onClick={() => setManual(null)}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={submitManual}
              disabled={submitting}
            >
              <FiUpload size={14} /> {submitting ? 'Cargando…' : 'Guardar'}
            </button>
          </div>
        </section>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Observaciones</h3>
          {signals.length > 0 && <span className="aur-section-count">{signals.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : signals.length === 0 ? (
          <p className="strategy-empty">Sin observaciones.</p>
        ) : (
          <div className="aur-table-wrap">
            <table className="aur-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Fuente</th>
                  <th>Tipo</th>
                  <th className="aur-td-num">Valor</th>
                  <th>Confianza</th>
                  <th>Ingresado</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {signals.map(s => {
                  const src = sourcesById[s.sourceId];
                  const conf = confidenceTier(s.confidence);
                  return (
                    <tr key={s.id}>
                      <td className="aur-td-strong">{s.observedAt}</td>
                      <td>{src?.name || s.sourceId}</td>
                      <td>{SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}</td>
                      <td className="aur-td-num">{fmtValue(s)}</td>
                      <td>
                        {conf ? (
                          <span className={`aur-badge ${CONFIDENCE_VARIANT[conf.key]}`}>{conf.label}</span>
                        ) : '—'}
                      </td>
                      <td>{fmtTs(s.fetchedAt)}</td>
                      <td className="strategy-meta-cell">
                        {s.metadata ? JSON.stringify(s.metadata) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

export default SignalsDashboard;
