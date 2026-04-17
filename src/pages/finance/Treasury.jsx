import { useState, useEffect, useCallback } from 'react';
import { FiRefreshCw, FiPlus, FiActivity, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../components/Toast';
import CashBalanceForm from '../../components/finance/CashBalanceForm';
import ProjectionChart from '../../components/finance/ProjectionChart';
import ProjectionTable from '../../components/finance/ProjectionTable';
import { useApiFetch } from '../../hooks/useApiFetch';
import './finance.css';

function fmt(n, currency = 'USD') {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Treasury() {
  const apiFetch = useApiFetch();
  const [weeks, setWeeks] = useState(26);
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBalanceForm, setShowBalanceForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/treasury/projection?weeks=${weeks}`)
      .then(r => r.json())
      .then(setProjection)
      .catch(() => setToast({ type: 'error', message: 'No se pudo cargar la proyección.' }))
      .finally(() => setLoading(false));
  }, [apiFetch, weeks]);

  useEffect(() => { load(); }, [load]);

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
  const currency = projection?.startingBalanceSource?.currency || 'USD';

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiActivity /> Tesorería</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <FiRefreshCw /> Refrescar
          </button>
          {!showBalanceForm && (
            <button className="btn-primary" onClick={() => setShowBalanceForm(true)}>
              <FiPlus /> Registrar saldo
            </button>
          )}
        </div>
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
        <CashBalanceForm
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
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value) || 26)}
          />
        </div>
      </div>

      {loading ? (
        <p className="finance-empty">Cargando proyección…</p>
      ) : projection ? (
        <>
          <div className="treasury-card">
            <div className="treasury-stats" style={{ marginBottom: 12 }}>
              <div>Saldo inicial: <strong>{fmt(projection.startingBalance, currency)}</strong></div>
              <div>Entradas: <strong>{fmt(projection.summary.totalInflows, currency)}</strong></div>
              <div>Salidas: <strong>{fmt(projection.summary.totalOutflows, currency)}</strong></div>
              <div className={projection.summary.endingBalance < 0 ? 'treasury-stat--negative' : ''}>
                Saldo final: <strong>{fmt(projection.summary.endingBalance, currency)}</strong>
              </div>
              <div className={projection.summary.minBalance < 0 ? 'treasury-stat--negative' : ''}>
                Mínimo: <strong>{fmt(projection.summary.minBalance, currency)}</strong>
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
            <ProjectionTable series={projection.series} currency={currency} />
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
