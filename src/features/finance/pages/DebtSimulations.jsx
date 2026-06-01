import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FiPlus, FiTrendingUp, FiTrendingDown, FiPackage, FiTrash2, FiDownload,
  FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import { useToast } from '../../../contexts/ToastContext';
import PageHeader from '../../../components/PageHeader';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import DebtSimulatorForm from '../components/DebtSimulatorForm';
import DebtSimulationDetail from '../components/DebtSimulationDetail';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { formatMoney, formatPct } from '../../../lib/formatMoney';
import { formatShortDate } from '../../../lib/formatDate';
import { translateApiError } from '../../../lib/errorMessages';
import { RECOMMENDATION_VARIANT } from '../lib/recommendation';
import '../../planting/styles/siembra.css';
import '../../planting/styles/siembra-historial.css';
import '../styles/finance.css';
import '../styles/financing.css';
import '../styles/debt-simulator.css';

const COLUMNS = [
  { key: 'fecha',     label: 'Fecha',         type: 'date'   },
  { key: 'proveedor', label: 'Proveedor',     type: 'text'   },
  { key: 'monto',     label: 'Monto',         type: 'number', align: 'right' },
  { key: 'plazo',     label: 'Plazo (m)',     type: 'number', align: 'right' },
  { key: 'apr',       label: 'APR %',         type: 'number', align: 'right' },
  { key: 'dMargen',   label: 'Δ Margen',      type: 'number', align: 'right' },
  { key: 'rec',       label: 'Recomendación', type: 'text'   },
];

function getColVal(r, key) {
  switch (key) {
    case 'fecha':     return r.createdAt || '';
    case 'proveedor': return (r.providerName || '').toLowerCase();
    case 'monto':     return Number(r.amount) || 0;
    case 'plazo':     return Number(r.plazoMeses) || 0;
    case 'apr':       return Number(r.apr) || 0;
    case 'dMargen':   return Number(r.marginDelta) || 0;
    case 'rec':       return (r.recommendation || '').toLowerCase();
    default:          return '';
  }
}

function DebtSimulations() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [sims, setSims] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Snapshot de la data filtrada+ordenada que muestra el data-table, para que
  // el export CSV respete exactamente la vista actual.
  const displayRef = useRef([]);

  // ── Vista derivada de la URL (deep-link + back/refresh) ──────────────────
  const simId    = searchParams.get('sim');
  const showForm = searchParams.get('view') === 'form';
  const view     = showForm ? 'form' : simId ? 'detail' : 'list';

  const goList   = useCallback(() => setSearchParams({}), [setSearchParams]);
  const goForm   = useCallback(() => setSearchParams({ view: 'form' }), [setSearchParams]);
  const openSim  = useCallback((id) => setSearchParams({ sim: id }), [setSearchParams]);

  const loadSims = useCallback(() => {
    setLoadError(null);
    return apiFetch('/api/financing/debt-simulations')
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setSims(Array.isArray(data) ? data : []);
      })
      .catch(() => setLoadError('No se pudieron cargar las simulaciones.'));
  }, [apiFetch]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadSims(),
      apiFetch('/api/financing/profile/snapshots')
        .then(r => r.json())
        .then(data => setSnapshots(Array.isArray(data) ? data : []))
        .catch(() => setSnapshots([])),
      apiFetch('/api/financing/credit-products?activo=true')
        .then(r => r.json())
        .then(data => setOffers(Array.isArray(data) ? data : []))
        .catch(() => setOffers([])),
    ]).finally(() => setLoading(false));
  }, [apiFetch, loadSims]);

  // Carga del detalle cuando cambia el id en la URL. El flag `cancelled`
  // descarta respuestas stale: clics rápidos en filas distintas ya no pintan
  // la simulación equivocada (la última en navegar gana).
  useEffect(() => {
    if (!simId) { setDetail(null); setDetailLoading(false); return; }
    if (detail?.id === simId) return; // ya cargada (p.ej. recién simulada)
    let cancelled = false;
    setDetailLoading(true);
    apiFetch(`/api/financing/debt-simulations/${encodeURIComponent(simId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('No se pudo cargar la simulación.');
        return res.json();
      })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e.message);
        setSearchParams({}, { replace: true });
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [simId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC vuelve a la lista desde el detalle (vista read-only, descartar es
  // inofensivo). En el form NO se monta: ahí el cierre pasa por "Cancelar",
  // que tiene guard de datos sin guardar. En la lista tampoco, para no pisar
  // el popover de filtros del data-table.
  useEffect(() => {
    if (view !== 'detail') return;
    const onKey = (e) => { if (e.key === 'Escape') goList(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, goList]);

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/financing/debt-simulations/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Traducimos el código de error del backend a un mensaje en español;
        // nunca mostramos el devMessage interno (inglés) ni detalles del envelope.
        const err = await res.json().catch(() => ({}));
        throw new Error(translateApiError(err, 'La simulación falló.'));
      }
      const data = await res.json();
      await loadSims();
      setDetail(data);
      setSearchParams({ sim: data.id });
      toast.success('Simulación completada.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/financing/debt-simulations/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar la simulación.');
      await loadSims();
      toast.success('Simulación eliminada.');
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  // Faltantes acumulados: el usuario ve TODOS los requisitos de una vez, no de
  // a uno (antes el `||` corto escondía la oferta hasta resolver el snapshot).
  const blockReason = useMemo(() => {
    const missing = [];
    if (!snapshots.length) missing.push('un snapshot financiero (creálo desde el Perfil financiero)');
    if (!offers.length)    missing.push('una oferta de crédito activa (registrála en Ofertas de crédito)');
    if (!missing.length) return null;
    return `Para correr una simulación necesitás ${missing.join('; y ')}.`;
  }, [snapshots.length, offers.length]);

  const exportCSV = useCallback(() => {
    // Neutraliza inyección de fórmulas: una celda que empieza con = + - @ (tab
    // o CR incluidos) la interpreta Excel/Sheets como fórmula. Prefijamos con
    // comilla simple para forzar texto antes de entrecomillar el campo.
    const esc = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headers = ['Fecha', 'Proveedor', 'Monto', 'Plazo (m)', 'APR %', 'Δ Margen', 'Recomendación'];
    const rows = displayRef.current.map((r) => [
      esc(r.createdAt ? String(r.createdAt).slice(0, 10) : ''),
      esc(r.providerName || ''),
      esc(r.amount ?? ''),
      esc(r.plazoMeses ?? ''),
      esc((Number(r.apr) * 100).toFixed(2)),
      esc(r.marginDelta ?? ''),
      esc(RECOMMENDATION_VARIANT[r.recommendation]?.label || r.recommendation || ''),
    ]);
    const csv = [headers.map(esc), ...rows].map((row) => row.join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulaciones_deuda_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const renderRow = (r, vis) => {
    const rec = RECOMMENDATION_VARIANT[r.recommendation] || null;
    const marginDelta = Number(r.marginDelta) || 0;
    const positive = marginDelta >= 0;
    return (
      <>
        {vis.fecha     && <td>{formatShortDate(r.createdAt)}</td>}
        {vis.proveedor && <td>{r.providerName || '—'}</td>}
        {vis.monto     && <td className="aur-td-num">{formatMoney(r.amount)}</td>}
        {vis.plazo     && <td className="aur-td-num">{r.plazoMeses}</td>}
        {vis.apr       && <td className="aur-td-num">{formatPct(Number(r.apr) * 100, { decimals: 2 })}</td>}
        {vis.dMargen   && (
          <td className="aur-td-num">
            <span className={positive ? 'debt-sim-delta-positive' : 'debt-sim-delta-negative'}>
              {positive ? <FiTrendingUp size={11} /> : <FiTrendingDown size={11} />}
              {' '}{formatMoney(marginDelta)}
            </span>
          </td>
        )}
        {vis.rec && (
          <td>{rec ? <span className={`aur-badge ${rec.cls}`}>{rec.labelShort}</span> : '—'}</td>
        )}
      </>
    );
  };

  const trailingCell = (r) => (
    <td className="ds-actions-cell">
      <button
        type="button"
        className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
        onClick={() => setConfirmDelete(r)}
        title="Eliminar simulación"
        aria-label={`Eliminar simulación de ${r.providerName || 'proveedor'}`}
      >
        <FiTrash2 size={13} />
      </button>
    </td>
  );

  const renderSummary = (rows) => {
    const byRec = { tomar: 0, tomar_condicional: 0, no_tomar: 0 };
    rows.forEach((s) => { if (byRec[s.recommendation] !== undefined) byRec[s.recommendation] += 1; });
    return (
      <div className="sh-stats-bar">
        <div className="sh-stat">
          <span className="sh-stat-value sh-stat-green">{byRec.tomar}</span>
          <span className="sh-stat-label">Tomar</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{byRec.tomar_condicional}</span>
          <span className="sh-stat-label">Condicional</span>
        </div>
        <div className="sh-stat-divider sh-stat-hide-mobile" />
        <div className="sh-stat sh-stat-hide-mobile">
          <span className="sh-stat-value">{byRec.no_tomar}</span>
          <span className="sh-stat-label">No tomar</span>
        </div>
      </div>
    );
  };

  return (
    <div className="lote-page">
      <PageHeader
        level={2}
        icon={<FiTrendingUp />}
        title="Simulador de deuda"
        backLink={{ to: '/finance/financing', label: 'Financiamiento' }}
        actions={view === 'list' && (
          <button className="aur-btn-pill" onClick={goForm} disabled={loading || !!blockReason}>
            <FiPlus /> Nueva simulación
          </button>
        )}
      />

      {view === 'list' && (
        <AuroraSectionIntro
          expanderLabel="¿Cómo funciona Monte Carlo?"
          expanderContent={
            <p>
              La simulación corre 500 escenarios con y sin la deuda y compara
              cómo se mueve la caja mensual bajo incertidumbre de precio y
              rendimiento. El modelo de retorno esperado que ingreses es
              determinante — sin él, el crédito siempre luce mal.
            </p>
          }
        >
          Evaluamos si tomar un crédito mejora o empeora tu caja bajo
          escenarios de precio y rendimiento variables.
        </AuroraSectionIntro>
      )}

      {view === 'form' && (
        <DebtSimulatorForm
          snapshots={snapshots}
          offers={offers}
          onSubmit={handleSubmit}
          onCancel={goList}
          submitting={submitting}
        />
      )}

      {view === 'detail' && (
        detailLoading && !detail ? (
          <p className="finance-empty">Cargando simulación…</p>
        ) : detail ? (
          <DebtSimulationDetail simulation={detail} onBack={goList} />
        ) : null
      )}

      {view === 'list' && (
        loadError ? (
          <div className="siembra-empty-state" role="alert">
            <FiAlertTriangle size={36} />
            <p>{loadError}</p>
            <button
              className="aur-btn-pill"
              onClick={() => { setLoading(true); loadSims().finally(() => setLoading(false)); }}
            >
              <FiRefreshCw /> Reintentar
            </button>
          </div>
        ) : loading ? (
          <p className="finance-empty">Cargando…</p>
        ) : sims.length === 0 ? (
          <div className="siembra-empty-state">
            <FiPackage size={36} />
            <p>Aún no hay simulaciones.</p>
            <p className="fin-page-empty-hint">
              {blockReason || 'Corré la primera simulación con "Nueva simulación".'}
            </p>
          </div>
        ) : (
          <>
            {blockReason && (
              <div className="aur-banner aur-banner--warn">
                <FiPackage size={14} /> <span>{blockReason}</span>
              </div>
            )}
            <AuroraDataTable
              columns={COLUMNS}
              data={sims}
              getColVal={getColVal}
              initialSort={{ field: 'fecha', dir: 'desc' }}
              firstClickDir="desc"
              renderRow={renderRow}
              renderSummary={renderSummary}
              trailingHead={<th className="ds-actions-head" aria-hidden="true" />}
              trailingCell={trailingCell}
              onRowClick={(r) => openSim(r.id)}
              onDisplayDataChange={(d) => { displayRef.current = d; }}
              toolbarActions={
                <button type="button" className="fin-table-btn" onClick={exportCSV} title="Exportar CSV">
                  <FiDownload size={11} /> CSV
                </button>
              }
              resultLabel={(f, t) => (f === t ? `${t} simulaciones` : `${f} de ${t} simulaciones`)}
              emptyText="No hay simulaciones con los filtros aplicados."
              emptyIcon={FiPackage}
            />
          </>
        )
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar simulación"
          body={
            `Vas a eliminar la simulación de ${confirmDelete.providerName || 'proveedor'} ` +
            `por ${formatMoney(confirmDelete.amount)} a ` +
            `${confirmDelete.plazoMeses} meses (${formatShortDate(confirmDelete.createdAt)}). ` +
            `Esta acción no se puede deshacer.`
          }
          confirmLabel="Eliminar"
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default DebtSimulations;
