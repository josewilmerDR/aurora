import { useState } from 'react';
import { FiPlus, FiActivity, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { useToast } from '../../../contexts/ToastContext';
import PageHeader from '../../../components/PageHeader';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import CashBalanceModal from '../components/CashBalanceModal';
import CashBalanceList from '../components/CashBalanceList';
import ProjectionChart from '../components/ProjectionChart';
import ProjectionTable from '../components/ProjectionTable';
import TreasuryStats from '../components/TreasuryStats';
import HorizonSelector from '../components/HorizonSelector';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useTreasuryProjection } from '../../../hooks/useTreasuryProjection';
import { DEFAULT_CURRENCY, formatMoney } from '../../../lib/formatMoney';
import { translateApiError } from '../../../lib/errorMessages';
import '../styles/finance.css';

const DEFAULT_HORIZON_WEEKS = 26;
// La proyección se expresa siempre en CRC (moneda funcional).
const PROJECTION_CURRENCY = DEFAULT_CURRENCY;

function Treasury() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const [weeks, setWeeks] = useState(DEFAULT_HORIZON_WEEKS);
  const [showBalanceForm, setShowBalanceForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bump al registrar un saldo: fuerza a CashBalanceList a recargar su lista.
  const [balanceListKey, setBalanceListKey] = useState(0);

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
        // Traducimos el `code` del backend a español (errorMessages.js) en vez
        // de mostrar el devMessage en inglés/interno directo al usuario.
        const err = new Error(translateApiError(body, 'Error al guardar el saldo.'));
        err.status = res.status;
        throw err;
      }
      toast.success(`Saldo de ${formatMoney(payload.amount, payload.currency)} registrado al ${payload.dateAsOf}. La proyección parte de ahí.`);
      setShowBalanceForm(false);
      setBalanceListKey(k => k + 1);
      reload();
    } catch (e) {
      console.error('[Treasury] save balance failed', { status: e.status, err: e });
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const hasSource = !!projection?.startingBalanceSource;
  const hasProjection = !!projection;

  return (
    <div className="page-container">
      <PageHeader
        level={2}
        title="Tesorería"
        icon={<FiActivity />}
        actions={(
          <button className="aur-btn-pill" onClick={() => setShowBalanceForm(true)}>
            <FiPlus /> Registrar saldo
          </button>
        )}
      />

      <AuroraSectionIntro
        expanderContent={
          <>
            <p>
              La proyección arranca del <strong>último saldo de caja registrado</strong>:
              si su fecha es futura, proyectamos desde esa fecha; si es pasada, desde hoy.
              Si nunca registraste un saldo, parte de 0.
            </p>
            <p>
              Las <strong>entradas y salidas</strong> de cada semana se arman con tus
              movimientos registrados: órdenes de compra (salidas) e ingresos esperados
              (entradas). Tocá una semana en la tabla para ver qué la compone.
            </p>
          </>
        }
      >
        Predicción de cuánto dinero tendrás en caja semana por semana, basada en
        los movimientos registrados y tu saldo inicial. Cambiá el horizonte abajo
        para ver más o menos semanas hacia adelante.
      </AuroraSectionIntro>

      {!hasSource && !loading && !error && (
        <div className="aur-banner aur-banner--warn">
          <FiAlertTriangle size={14} />
          <span>No hay saldo de caja registrado. La proyección parte de 0.</span>
          <button
            className="aur-btn-text"
            style={{ marginLeft: 'auto', flexShrink: 0 }}
            onClick={() => setShowBalanceForm(true)}
          >
            Registrar saldo →
          </button>
        </div>
      )}

      {showBalanceForm && (
        <CashBalanceModal
          onSubmit={handleSaveBalance}
          onCancel={() => setShowBalanceForm(false)}
          saving={saving}
        />
      )}

      <div className="treasury-filters">
        <HorizonSelector
          value={weeks}
          onChange={setWeeks}
          min={1}
          max={104}
          fallback={DEFAULT_HORIZON_WEEKS}
        />
      </div>

      {/* Error durante un refetch: mantenemos la proyección previa visible y
          avisamos en un banner, en vez de borrar toda la pantalla. */}
      {error && hasProjection && (
        <div className="aur-banner aur-banner--danger">
          <FiAlertTriangle size={14} />
          <span>{error.message}</span>
          <button
            className="aur-btn-text"
            style={{ marginLeft: 'auto', flexShrink: 0 }}
            onClick={reload}
          >
            <FiRefreshCw /> Reintentar
          </button>
        </div>
      )}

      {/* Carga inicial (todavía no hay nada que mostrar) */}
      {loading && !hasProjection && (
        <p className="finance-empty">Cargando proyección…</p>
      )}

      {/* Error en la carga inicial: pantalla de error completa */}
      {!loading && error && !hasProjection && (
        <section className="aur-section treasury-error-state">
          <p>{error.message}</p>
          <button className="aur-btn-pill" onClick={reload}>
            <FiRefreshCw /> Reintentar
          </button>
        </section>
      )}

      {/* Proyección. Si hay un refetch en curso la mostramos atenuada
          (stale-while-revalidate) en vez de reemplazarla por un spinner. */}
      {hasProjection && (
        <div
          className={`treasury-content${loading ? ' treasury-content--revalidating' : ''}`}
          aria-busy={loading}
        >
          <section className="aur-section">
            <TreasuryStats
              startingBalance={projection.startingBalance}
              summary={projection.summary}
              currency={PROJECTION_CURRENCY}
              source={projection.startingBalanceSource}
            />
            <ProjectionChart series={projection.series} currency={PROJECTION_CURRENCY} />
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <h3 className="aur-section-title">Serie semanal</h3>
            </div>
            <div className="aur-table-wrap">
              <ProjectionTable series={projection.series} currency={PROJECTION_CURRENCY} />
            </div>
          </section>
        </div>
      )}

      <CashBalanceList
        refreshKey={balanceListKey}
        onDeleted={reload}
        onToast={(message, type = 'success') => toast[type]?.(message)}
      />
    </div>
  );
}

export default Treasury;
