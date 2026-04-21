import { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiActivity, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../components/Toast';
import CashBalanceModal from '../../components/finance/CashBalanceModal';
import ProjectionChart from '../../components/finance/ProjectionChart';
import ProjectionTable from '../../components/finance/ProjectionTable';
import { useApiFetch } from '../../hooks/useApiFetch';
import { formatMoney, DEFAULT_CURRENCY } from '../../lib/formatMoney';
import './finance.css';

function Treasury() {
  const apiFetch = useApiFetch();
  const [weeks, setWeeks] = useState(26);
  const [weeksInput, setWeeksInput] = useState('26');
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBalanceForm, setShowBalanceForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    apiFetch(`/api/treasury/projection?weeks=${weeks}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data || typeof data !== 'object' || !data.summary || !Array.isArray(data.series)) {
          throw new Error('Respuesta inválida del servidor.');
        }
        setProjection(data);
      })
      .catch((e) => {
        if (cancelled || e.name === 'AbortError') return;
        setProjection(null);
        setToast({ type: 'error', message: 'No se pudo cargar la proyección.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [apiFetch, weeks, reloadKey]);

  const handleSaveBalance = async (payload) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/treasury/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar el saldo.');
      }
      setToast({ type: 'success', message: 'Saldo registrado.' });
      setShowBalanceForm(false);
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const hasSource = !!projection?.startingBalanceSource;
  // La proyección siempre se expresa en CRC (moneda funcional).
  const currency = DEFAULT_CURRENCY;

  return (
    <div className="page-container">
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiActivity /> Tesorería</h2>
        {!showBalanceForm && (
          <button className="btn btn-primary" onClick={() => setShowBalanceForm(true)}>
            <FiPlus /> Registrar saldo
          </button>
        )}
      </div>

      {!hasSource && !loading && (
        <div className="treasury-cash-banner">
          <span>
            <FiAlertTriangle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            No hay saldo de caja registrado. La proyección parte de 0.
          </span>
        </div>
      )}

      {showBalanceForm && (
        <CashBalanceModal
          onSubmit={handleSaveBalance}
          onCancel={() => setShowBalanceForm(false)}
          saving={saving}
        />
      )}

      <div className="finance-filters">
        <div className="finance-field">
          <label>Horizonte (semanas)</label>
          <input
            type="number"
            min="1"
            max="104"
            value={weeksInput}
            onChange={(e) => {
              const raw = e.target.value;
              setWeeksInput(raw);
              const n = Number(raw);
              if (raw !== '' && Number.isFinite(n) && n >= 1 && n <= 104) {
                setWeeks(n);
              }
            }}
            onBlur={() => {
              const n = Number(weeksInput);
              if (weeksInput === '' || !Number.isFinite(n) || n < 1 || n > 104) {
                setWeeks(26);
                setWeeksInput('26');
              } else {
                setWeeksInput(String(n));
              }
            }}
          />
        </div>
      </div>

      {loading ? (
        <p className="finance-empty">Cargando proyección…</p>
      ) : projection ? (
        <>
          <div className="treasury-card">
            <div className="treasury-stats" style={{ marginBottom: 12 }}>
              <div>Saldo inicial: <strong>{formatMoney(projection.startingBalance, currency)}</strong></div>
              <div>Entradas: <strong>{formatMoney(projection.summary.totalInflows, currency)}</strong></div>
              <div>Salidas: <strong>{formatMoney(projection.summary.totalOutflows, currency)}</strong></div>
              <div className={projection.summary.endingBalance < 0 ? 'treasury-stat--negative' : ''}>
                Saldo final: <strong>{formatMoney(projection.summary.endingBalance, currency)}</strong>
              </div>
              <div className={projection.summary.minBalance < 0 ? 'treasury-stat--negative' : ''}>
                Mínimo: <strong>{formatMoney(projection.summary.minBalance, currency)}</strong>
                {projection.summary.minBalanceDate && ` (${projection.summary.minBalanceDate})`}
              </div>
              {projection.summary.negativeWeeks > 0 && (
                <div className="treasury-stat--negative">
                  <strong>{projection.summary.negativeWeeks} semanas en negativo</strong>
                </div>
              )}
            </div>
            <ProjectionChart series={projection.series} />
          </div>

          <div className="treasury-card">
            <strong style={{ display: 'block', marginBottom: 10 }}>Serie semanal</strong>
            <div className="finance-execution-table-wrap">
              <ProjectionTable series={projection.series} currency={currency} />
            </div>
          </div>
        </>
      ) : (
        <p className="finance-empty">Sin datos.</p>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Treasury;
