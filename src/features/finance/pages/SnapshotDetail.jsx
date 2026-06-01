import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FiFileText, FiArrowLeft, FiDownload } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useFinanceResource } from '../hooks/useFinanceResource';
import { formatMoney, formatPct, FUNCTIONAL_CURRENCY } from '../lib/format';
import { formatShortDate } from '../../../lib/formatDate';
import '../styles/finance.css';
import '../styles/financing.css';

// Detalle de un snapshot financiero inmutable (Fase 5.1).
//
// Antes el dashboard ("Ver último" en el Perfil financiero) linkeaba a
// /finance/financing/snapshots/:id pero esa ruta NO existía → 404. Esta página
// la implementa: lee GET /api/financing/profile/snapshots/:id y muestra balance,
// estado de resultados y flujo de caja del corte, con export para administrador.

function StatRow({ label, value, sub, negative }) {
  return (
    <div className="snapshot-stat-row">
      <span className="snapshot-stat-label">
        {label}
        {sub && <span className="snapshot-stat-sub">{sub}</span>}
      </span>
      <strong className={`snapshot-stat-value${negative ? ' fin-widget-primary--negative' : ''}`}>
        {value}
      </strong>
    </div>
  );
}

function SnapshotDetail() {
  const { id } = useParams();
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canExport = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const { data, loading, error, reload } = useFinanceResource(
    `/api/financing/profile/snapshots/${id}`,
    { errorMessage: 'No se pudo cargar el snapshot.' }
  );

  const [toast, setToast] = useState(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/financing/profile/snapshots/${id}/export?format=json`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `perfil_financiero_${data?.asOf || id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast({ type: 'success', message: 'Snapshot exportado.' });
    } catch {
      setToast({ type: 'error', message: 'No se pudo exportar el snapshot.' });
    } finally {
      setExporting(false);
    }
  };

  const bs = data?.balanceSheet;
  const is = data?.incomeStatement;
  const cf = data?.cashFlow;

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <div className="lote-page-title-stack">
          <Link to="/finance/financing" className="aur-btn-text fin-back-link aur-touch-target">
            <FiArrowLeft size={12} /> Financiamiento
          </Link>
          <h2 className="lote-page-title"><FiFileText /> Snapshot financiero</h2>
        </div>
        {!loading && !error && data && canExport && (
          <button
            type="button"
            className="aur-btn-pill aur-touch-target"
            onClick={handleExport}
            disabled={exporting}
            aria-busy={exporting}
          >
            <FiDownload size={14} /> {exporting ? 'Exportando…' : 'Exportar JSON'}
          </button>
        )}
      </div>

      {loading && <p className="finance-empty">Cargando snapshot…</p>}

      {error && (
        <div className="fin-widget-error" role="alert">
          <span>{error}</span>
          <button type="button" className="aur-btn-text fin-widget-retry" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <p className="fin-page-intro">
            Corte <strong>{formatShortDate(data.asOf)}</strong> · generado el{' '}
            {formatShortDate(data.generatedAt)}
            {data.generatedByEmail ? ` por ${data.generatedByEmail}` : ''}. Es un
            registro inmutable: refleja el estado de la finca a esa fecha y no
            cambia aunque los datos de origen cambien después.
          </p>

          <div className="snapshot-grid">
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Balance</h3>
                <span className="aur-section-count">{FUNCTIONAL_CURRENCY}</span>
              </div>
              <div className="snapshot-stats">
                <StatRow label="Activos totales" value={formatMoney(bs?.assets?.totalAssets)} />
                <StatRow label="Caja" sub={bs?.assets?.cash?.dateAsOf ? `al ${formatShortDate(bs.assets.cash.dateAsOf)}` : null} value={formatMoney(bs?.assets?.cash?.amount)} />
                <StatRow label="Cuentas por cobrar" sub={`${bs?.assets?.accountsReceivable?.invoiceCount || 0} facturas`} value={formatMoney(bs?.assets?.accountsReceivable?.amount)} />
                <StatRow label="Inventario" sub={`${bs?.assets?.inventory?.itemCount || 0} ítems`} value={formatMoney(bs?.assets?.inventory?.amount)} />
                <StatRow label="Activos fijos (neto)" value={formatMoney(bs?.assets?.fixedAssets?.netBookValue)} />
                <StatRow label="Pasivos totales" value={formatMoney(bs?.liabilities?.totalLiabilities)} />
                <StatRow
                  label="Patrimonio"
                  value={formatMoney(bs?.equity?.totalEquity)}
                  negative={Number(bs?.equity?.totalEquity) < 0}
                />
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Estado de resultados</h3>
                <span className="aur-section-count">12m</span>
              </div>
              <div className="snapshot-stats">
                <StatRow label="Ingresos" sub={`${is?.revenue?.recordCount || 0} registros`} value={formatMoney(is?.revenue?.amount)} />
                <StatRow label="Costos" value={formatMoney(is?.costs?.totalCosts)} negative />
                <StatRow
                  label="Margen neto"
                  value={formatMoney(is?.netMargin)}
                  negative={Number(is?.netMargin) < 0}
                />
                <StatRow
                  label="Margen %"
                  value={formatPct(is?.marginRatio != null ? is.marginRatio * 100 : null)}
                  negative={Number(is?.netMargin) < 0}
                />
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Flujo de caja proyectado</h3>
                <span className="aur-section-count">{FUNCTIONAL_CURRENCY}</span>
              </div>
              <div className="snapshot-stats">
                <StatRow label="Saldo inicial" value={formatMoney(cf?.projection?.startingBalance)} />
                <StatRow label="Entradas proyectadas" value={formatMoney(cf?.projection?.summary?.totalInflows)} />
                <StatRow label="Salidas proyectadas" value={formatMoney(cf?.projection?.summary?.totalOutflows)} negative />
                <StatRow
                  label="Saldo final"
                  value={formatMoney(cf?.projection?.summary?.endingBalance)}
                  negative={Number(cf?.projection?.summary?.endingBalance) < 0}
                />
                <StatRow
                  label="Saldo mínimo"
                  value={formatMoney(cf?.projection?.summary?.minBalance)}
                  negative={Number(cf?.projection?.summary?.minBalance) < 0}
                />
              </div>
            </section>
          </div>
        </>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default SnapshotDetail;
