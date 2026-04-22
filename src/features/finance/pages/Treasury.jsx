import { useState } from 'react';
import { FiPlus, FiActivity, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import CashBalanceModal from '../components/CashBalanceModal';
import ProjectionChart from '../components/ProjectionChart';
import ProjectionTable from '../components/ProjectionTable';
import TreasuryStats from '../components/TreasuryStats';
import HorizonSelector from '../components/HorizonSelector';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useTreasuryProjection, useIsMounted } from '../../../hooks/useTreasuryProjection';
import { DEFAULT_CURRENCY } from '../../../lib/formatMoney';
import '../styles/finance.css';

const DEFAULT_HORIZON_WEEKS = 26;
// La proyección se expresa siempre en CRC (moneda funcional).
const PROJECTION_CURRENCY = DEFAULT_CURRENCY;

function Treasury() {
  const apiFetch = useApiFetch();
  const isMounted = useIsMounted();
  const [weeks, setWeeks] = useState(DEFAULT_HORIZON_WEEKS);
  const [showBalanceForm, setShowBalanceForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const { projection, loading, error, reload } = useTreasuryProjection(weeks);

  const handleSaveBalance = async (payload) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/treasury/balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.message || 'Error al guardar el saldo.');
        err.status = res.status;
        throw err;
      }
      if (!isMounted.current) return;
      setToast({ type: 'success', message: 'Saldo registrado.' });
      setShowBalanceForm(false);
      reload();
    } catch (e) {
      console.error('[Treasury] save balance failed', { status: e.status, err: e });
      if (!isMounted.current) return;
      setToast({ type: 'error', message: e.message });
    } finally {
      if (isMounted.current) setSaving(false);
    }
  };

  const hasSource = !!projection?.startingBalanceSource;
  const hasProjection = !!projection;

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

      {!hasSource && !loading && !error && (
        <div className="treasury-cash-banner">
          <span>
            <FiAlertTriangle size={14} className="treasury-cash-banner-icon" />
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
        <HorizonSelector
          value={weeks}
          onChange={setWeeks}
          min={1}
          max={104}
          fallback={DEFAULT_HORIZON_WEEKS}
        />
      </div>

      {loading && (
        <p className="finance-empty">Cargando proyección…</p>
      )}

      {!loading && error && (
        <div className="treasury-card treasury-error-state">
          <p>{error.message}</p>
          <button className="btn btn-secondary" onClick={reload}>
            <FiRefreshCw /> Reintentar
          </button>
        </div>
      )}

      {!loading && !error && hasProjection && (
        <>
          <div className="treasury-card">
            <TreasuryStats
              startingBalance={projection.startingBalance}
              summary={projection.summary}
              currency={PROJECTION_CURRENCY}
            />
            <ProjectionChart series={projection.series} />
          </div>

          <div className="treasury-card">
            <strong className="treasury-section-title">Serie semanal</strong>
            <div className="finance-execution-table-wrap">
              <ProjectionTable series={projection.series} currency={PROJECTION_CURRENCY} />
            </div>
          </div>
        </>
      )}

      {!loading && !error && !hasProjection && (
        <p className="finance-empty">Sin datos.</p>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default Treasury;
