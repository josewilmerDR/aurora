import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  FiPlus, FiTrendingUp, FiTrendingDown, FiFilter, FiX,
  FiSliders, FiPackage, FiArrowLeft,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import DebtSimulatorForm from '../components/DebtSimulatorForm';
import DebtSimulationDetail from '../components/DebtSimulationDetail';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { formatMoney } from '../../../lib/formatMoney';
import '../../../pages/Siembra.css';
import '../../../pages/SiembraHistorial.css';
import '../styles/finance.css';
import '../styles/financing.css';
import '../styles/debt-simulator.css';

const RECOMMENDATION_LABELS = {
  tomar: { label: 'Tomar', cls: 'fin-badge--ok' },
  tomar_condicional: { label: 'Condicional', cls: 'fin-badge--warn' },
  no_tomar: { label: 'No tomar', cls: 'fin-badge--bad' },
};

const COLUMNS = [
  { key: 'fecha',     label: 'Fecha',       type: 'date'   },
  { key: 'proveedor', label: 'Proveedor',   type: 'text'   },
  { key: 'monto',     label: 'Monto',       type: 'number' },
  { key: 'plazo',     label: 'Plazo (m)',   type: 'number' },
  { key: 'apr',       label: 'APR %',       type: 'number' },
  { key: 'dMargen',   label: 'Δ Margen',    type: 'number' },
  { key: 'rec',       label: 'Recomendación', type: 'text' },
];

const ALL_COLS_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return iso; }
};

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

function ColMenu({ x, y, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="sh-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="sh-col-menu-title">Columnas visibles</div>
      {COLUMNS.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label key={col.key} className={`sh-col-menu-item${isLast ? ' sh-col-menu-item--disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)} />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body,
  );
}

function DebtSimulations() {
  const apiFetch = useApiFetch();
  const [sims, setSims] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // 'list' | 'form' | 'detail'
  const [detail, setDetail] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const [sortField, setSortField] = useState('fecha');
  const [sortDir,   setSortDir]   = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

  const loadSims = useCallback(() => {
    return apiFetch('/api/financing/debt-simulations')
      .then(r => r.json())
      .then(data => setSims(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las simulaciones.' }));
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

  const openDetail = async (simId) => {
    try {
      const res = await apiFetch(`/api/financing/debt-simulations/${simId}`);
      if (!res.ok) throw new Error('No se pudo cargar la simulación.');
      const data = await res.json();
      setDetail(data);
      setView('detail');
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/financing/debt-simulations/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'La simulación falló.');
      }
      const data = await res.json();
      await loadSims();
      setDetail(data);
      setView('detail');
      setToast({ type: 'success', message: 'Simulación completada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
  };

  const openColFilter = (e, field, type) => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, type, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, type, key, val) => {
    setColFilters(prev => {
      const cur = prev[field] || (type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: updated };
    });
  };

  const toggleCol = (key) => setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  const displayData = useMemo(() => {
    let data = [...sims];

    const activeColFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeColFilters.length > 0) {
      data = data.filter(r => {
        for (const [key, fv] of activeColFilters) {
          const col = COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getColVal(r, key);
          if (col.type === 'text') {
            if (fv.text && !String(val).includes(fv.text.toLowerCase())) return false;
          } else if (col.type === 'date') {
            if (!val) return false;
            const dateStr = String(val).slice(0, 10);
            if (fv.from && dateStr < fv.from) return false;
            if (fv.to   && dateStr > fv.to)   return false;
          } else if (col.type === 'number') {
            if (fv.from !== '' && fv.from !== undefined && Number(val) < Number(fv.from)) return false;
            if (fv.to   !== '' && fv.to   !== undefined && Number(val) > Number(fv.to))   return false;
          }
        }
        return true;
      });
    }

    if (sortField && sortDir) {
      data.sort((a, b) => {
        const av = getColVal(a, sortField);
        const bv = getColVal(b, sortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return data;
  }, [sims, colFilters, sortField, sortDir]);

  const stats = useMemo(() => {
    const byRec = { tomar: 0, tomar_condicional: 0, no_tomar: 0 };
    displayData.forEach(s => {
      if (s.recommendation && byRec[s.recommendation] !== undefined) byRec[s.recommendation] += 1;
    });
    return byRec;
  }, [displayData]);

  const SortTh = ({ col, children }) => {
    const isSort  = sortField === col.key;
    const hasFilt = !!colFilters[col.key];
    if (!visibleCols[col.key]) return null;
    return (
      <th
        className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(col.key)}
      >
        <span className="sh-th-content">
          {children}
          <span className="sh-th-arrow">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
          <span
            className={`sh-th-funnel${hasFilt ? ' is-active' : ''}`}
            onClick={e => openColFilter(e, col.key, col.type)}
            title="Filtrar columna"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  const startCreate = () => { setView('form'); };
  const cancelForm = () => { setView('list'); };
  const closeDetail = () => { setDetail(null); setView('list'); };

  const blockReason = (!snapshots.length && 'Necesitás al menos un snapshot financiero (creá uno desde el Perfil financiero).') ||
                      (!offers.length && 'Necesitás al menos una oferta de crédito activa.');

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link to="/finance/financing" className="finance-back-link">
            <FiArrowLeft size={12} /> Financiamiento
          </Link>
          <h2 className="lote-page-title"><FiTrendingUp /> Simulador de deuda</h2>
        </div>
        {view === 'list' && (
          <button
            className="btn btn-primary"
            onClick={startCreate}
            disabled={loading || !!blockReason}
            title={blockReason || ''}
          >
            <FiPlus /> Nueva simulación
          </button>
        )}
      </div>

      {view === 'form' && (
        <>
          <p className="finance-empty" style={{ textAlign: 'left', margin: '0 0 6px 0', opacity: 0.75 }}>
            La simulación corre {500} escenarios Monte Carlo con y sin la deuda y compara cómo se mueve la caja
            mensual bajo incertidumbre de precio y rendimiento. El modelo de retorno esperado que ingreses es
            determinante — sin él, el crédito siempre luce mal.
          </p>
          <DebtSimulatorForm
            snapshots={snapshots}
            offers={offers}
            onSubmit={handleSubmit}
            onCancel={cancelForm}
            submitting={submitting}
          />
        </>
      )}

      {view === 'detail' && detail && (
        <DebtSimulationDetail simulation={detail} onBack={closeDetail} />
      )}

      {view === 'list' && (
        loading ? (
          <p className="finance-empty">Cargando…</p>
        ) : sims.length === 0 ? (
          <div className="siembra-empty-state">
            <FiPackage size={36} />
            <p>Aún no hay simulaciones.</p>
            {blockReason ? (
              <p style={{ opacity: 0.7, fontSize: 13 }}>{blockReason}</p>
            ) : (
              <p style={{ opacity: 0.7, fontSize: 13 }}>Corré la primera simulación con "Nueva simulación".</p>
            )}
          </div>
        ) : (
          <>
            {blockReason && (
              <div className="debt-sim-block-banner">
                <FiPackage size={14} /> {blockReason}
              </div>
            )}
            <div className="sh-stats-bar">
              <div className="sh-stat">
                <span className="sh-stat-value">{displayData.length}</span>
                <span className="sh-stat-label">Simulaciones</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value sh-stat-green">{stats.tomar}</span>
                <span className="sh-stat-label">Tomar</span>
              </div>
              <div className="sh-stat-divider sh-stat-hide-mobile" />
              <div className="sh-stat sh-stat-hide-mobile">
                <span className="sh-stat-value">{stats.tomar_condicional}</span>
                <span className="sh-stat-label">Condicional</span>
              </div>
              <div className="sh-stat-divider sh-stat-hide-mobile" />
              <div className="sh-stat sh-stat-hide-mobile">
                <span className="sh-stat-value">{stats.no_tomar}</span>
                <span className="sh-stat-label">No tomar</span>
              </div>
            </div>

            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count">
                  {displayData.length === sims.length
                    ? `${sims.length} simulaciones`
                    : `${displayData.length} de ${sims.length} simulaciones`}
                </span>
                {Object.keys(colFilters).length > 0 && (
                  <button className="sh-clear-col-filters" onClick={() => setColFilters({})}>
                    <FiX size={11} /> Limpiar filtros de columna
                  </button>
                )}
              </div>

              {displayData.length === 0 ? (
                <p className="empty-state">No hay simulaciones con los filtros aplicados.</p>
              ) : (
                <div className="siembra-table-wrapper">
                  <table className="siembra-table siembra-table-historial">
                    <thead>
                      <tr>
                        {COLUMNS.map(col => visibleCols[col.key] && (
                          <SortTh key={col.key} col={col}>{col.label}</SortTh>
                        ))}
                        <th className="sh-th-settings">
                          <button
                            className={`sh-col-toggle-btn${Object.values(visibleCols).some(v => !v) ? ' sh-col-toggle-btn--active' : ''}`}
                            onClick={handleColBtnClick}
                            title="Personalizar columnas"
                          >
                            <FiSliders size={12} />
                            {Object.values(visibleCols).filter(v => !v).length > 0 && (
                              <span className="sh-col-hidden-badge">{Object.values(visibleCols).filter(v => !v).length}</span>
                            )}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map(r => {
                        const rec = RECOMMENDATION_LABELS[r.recommendation] || null;
                        const marginDelta = Number(r.marginDelta) || 0;
                        const positive = marginDelta >= 0;
                        const aprPct = (Number(r.apr) * 100).toFixed(2);
                        return (
                          <tr key={r.id} onClick={() => openDetail(r.id)} style={{ cursor: 'pointer' }}>
                            {visibleCols.fecha     && <td className="td-readonly">{fmtDate(r.createdAt)}</td>}
                            {visibleCols.proveedor && <td>{r.providerName || '—'}</td>}
                            {visibleCols.monto     && <td className="td-num">{formatMoney(r.amount, undefined, { decimals: 0 })}</td>}
                            {visibleCols.plazo     && <td className="td-num">{r.plazoMeses}</td>}
                            {visibleCols.apr       && <td className="td-num">{aprPct}%</td>}
                            {visibleCols.dMargen   && (
                              <td className="td-num">
                                <span className={positive ? 'debt-sim-delta-positive' : 'debt-sim-delta-negative'}>
                                  {positive ? <FiTrendingUp size={11} /> : <FiTrendingDown size={11} />}
                                  {' '}{formatMoney(marginDelta, undefined, { decimals: 0 })}
                                </span>
                              </td>
                            )}
                            {visibleCols.rec && (
                              <td>
                                {rec ? <span className={`fin-badge ${rec.cls}`}>{rec.label}</span> : '—'}
                              </td>
                            )}
                            <td />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {filterPopover && createPortal(
        <>
          <div className="sh-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div className="sh-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
            {filterPopover.type === 'text' ? (
              <>
                <FiFilter size={13} className="sh-filter-icon" />
                <input autoFocus className="sh-filter-input" placeholder="Filtrar…"
                  value={colFilters[filterPopover.field]?.text || ''}
                  onChange={e => setColFilter(filterPopover.field, 'text', 'text', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setFilterPopover(null); }}
                />
                {colFilters[filterPopover.field]?.text && (
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, 'text', 'text', ''); setFilterPopover(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            ) : (
              <div className="sh-filter-range">
                <span className="sh-filter-range-label">De</span>
                <input className="sh-filter-input sh-filter-input-range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.from || ''}
                  onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'from', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                <span className="sh-filter-range-label">A</span>
                <input className="sh-filter-input sh-filter-input-range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.to || ''}
                  onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'to', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, filterPopover.type, 'from', ''); setColFilter(filterPopover.field, filterPopover.type, 'to', ''); setFilterPopover(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </>,
        document.body,
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

export default DebtSimulations;
