import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  FiPlus, FiBriefcase, FiFilter, FiX, FiSliders,
  FiMoreVertical, FiEdit2, FiTrash2, FiPackage, FiArrowLeft,
} from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import CreditOfferForm from '../../components/finance/CreditOfferForm';
import { useApiFetch } from '../../hooks/useApiFetch';
import { formatMoney, formatNumber } from '../../lib/formatMoney';
import '../Siembra.css';
import '../SiembraHistorial.css';
import './finance.css';
import './financing.css';

const PROVIDER_LABELS = {
  banco: 'Banco',
  cooperativa: 'Cooperativa',
  microfinanciera: 'Microfinanciera',
  fintech: 'Fintech',
};

const TIPO_LABELS = {
  agricola: 'Agrícola',
  capital_trabajo: 'Capital trabajo',
  leasing: 'Leasing',
  rotativo: 'Rotativo',
};

const ESQUEMA_LABELS = {
  cuota_fija: 'Cuota fija',
  amortizacion_constante: 'Amort. const.',
  bullet: 'Bullet',
};

const COLUMNS = [
  { key: 'proveedor', label: 'Proveedor',  type: 'text'   },
  { key: 'tipoProv',  label: 'Tipo prov.', type: 'text'   },
  { key: 'tipo',      label: 'Crédito',    type: 'text'   },
  { key: 'monto',     label: 'Monto',      type: 'number' },
  { key: 'moneda',    label: 'Moneda',     type: 'text'   },
  { key: 'plazo',     label: 'Plazo (m)',  type: 'number' },
  { key: 'apr',       label: 'APR %',      type: 'number' },
  { key: 'esquema',   label: 'Esquema',    type: 'text'   },
  { key: 'estado',    label: 'Estado',     type: 'text'   },
];

const ALL_COLS_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

const STATUS_PILL = {
  activo:   { label: 'Activa',   cls: 'finance-pill--paid'     },
  inactivo: { label: 'Archivada', cls: 'finance-pill--inactive' },
};

function getColVal(r, key) {
  switch (key) {
    case 'proveedor': return (r.providerName || '').toLowerCase();
    case 'tipoProv':  return (r.providerType || '').toLowerCase();
    case 'tipo':      return (r.tipo || '').toLowerCase();
    case 'monto':     return Number(r.monedaMin) || 0;
    case 'moneda':    return (r.moneda || '').toLowerCase();
    case 'plazo':     return Number(r.plazoMesesMin) || 0;
    case 'apr':       return Number(r.aprMin) || 0;
    case 'esquema':   return (r.esquemaAmortizacion || '').toLowerCase();
    case 'estado':    return r.activo === false ? 'inactivo' : 'activo';
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

function CreditOffers() {
  const apiFetch = useApiFetch();
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [sortField, setSortField] = useState('proveedor');
  const [sortDir,   setSortDir]   = useState('asc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/financing/credit-products')
      .then(r => r.json())
      .then(data => setOffers(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las ofertas.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/financing/credit-products/${payload.id}` : '/api/financing/credit-products';
    const method = isEdit ? 'PUT' : 'POST';
    try {
      const { id: _id, ...body } = payload;
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar.');
      }
      setToast({ type: 'success', message: isEdit ? 'Oferta actualizada.' : 'Oferta registrada.' });
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await apiFetch(`/api/financing/credit-products/${confirmDelete}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Oferta eliminada.' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setConfirmDelete(null);
    }
  };

  const startEdit = (offer) => { setEditing(offer); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('asc'); }
    else if (sortDir === 'asc') { setSortDir('desc'); }
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
    let data = [...offers];

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
  }, [offers, colFilters, sortField, sortDir]);

  const stats = useMemo(() => {
    const activas   = displayData.filter(o => o.activo !== false).length;
    const archivadas = displayData.filter(o => o.activo === false).length;
    return { activas, archivadas };
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

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link to="/finance/financing" className="finance-back-link">
            <FiArrowLeft size={12} /> Financiamiento
          </Link>
          <h2 className="lote-page-title"><FiBriefcase /> Ofertas de crédito</h2>
        </div>
        {!showForm && (
          <button className="btn btn-primary" onClick={startCreate}>
            <FiPlus /> Nueva oferta
          </button>
        )}
      </div>

      {!showForm && (
        <p className="finance-empty" style={{ textAlign: 'left', margin: '0 0 6px 0', opacity: 0.75 }}>
          Registrá acá las ofertas concretas que hayas recibido de bancos, cooperativas u otros proveedores.
          Estas ofertas alimentan el análisis de elegibilidad y las simulaciones Monte Carlo del dashboard.
        </p>
      )}

      {showForm && (
        <CreditOfferForm
          initial={editing}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {!showForm && (
        loading ? (
          <p className="finance-empty">Cargando…</p>
        ) : offers.length === 0 ? (
          <div className="siembra-empty-state">
            <FiPackage size={36} />
            <p>Aún no hay ofertas registradas.</p>
            <p style={{ opacity: 0.7, fontSize: 13 }}>Ingresá la primera oferta que hayas recibido de un banco.</p>
          </div>
        ) : (
          <>
            <div className="sh-stats-bar">
              <div className="sh-stat">
                <span className="sh-stat-value">{displayData.length}</span>
                <span className="sh-stat-label">Ofertas</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value sh-stat-green">{stats.activas}</span>
                <span className="sh-stat-label">Activas</span>
              </div>
              <div className="sh-stat-divider sh-stat-hide-mobile" />
              <div className="sh-stat sh-stat-hide-mobile">
                <span className="sh-stat-value">{stats.archivadas}</span>
                <span className="sh-stat-label">Archivadas</span>
              </div>
            </div>

            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count">
                  {displayData.length === offers.length
                    ? `${offers.length} ofertas`
                    : `${displayData.length} de ${offers.length} ofertas`}
                </span>
                {Object.keys(colFilters).length > 0 && (
                  <button className="sh-clear-col-filters" onClick={() => setColFilters({})}>
                    <FiX size={11} /> Limpiar filtros de columna
                  </button>
                )}
              </div>

              {displayData.length === 0 ? (
                <p className="empty-state">No hay ofertas con los filtros aplicados.</p>
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
                        const pillKey = r.activo === false ? 'inactivo' : 'activo';
                        const pill = STATUS_PILL[pillKey];
                        const aprPct = Number(r.aprMin) * 100;
                        return (
                          <tr key={r.id} className={r.activo === false ? 'row-anulado' : ''}>
                            {visibleCols.proveedor && <td><strong>{r.providerName || '—'}</strong></td>}
                            {visibleCols.tipoProv  && <td>{PROVIDER_LABELS[r.providerType] || r.providerType || '—'}</td>}
                            {visibleCols.tipo      && <td>{TIPO_LABELS[r.tipo] || r.tipo || '—'}</td>}
                            {visibleCols.monto     && <td className="td-num">{formatMoney(r.monedaMin, r.moneda, { decimals: 0 })}</td>}
                            {visibleCols.moneda    && <td>{r.moneda || '—'}</td>}
                            {visibleCols.plazo     && <td className="td-num">{formatNumber(r.plazoMesesMin, { decimals: 0 })}</td>}
                            {visibleCols.apr       && <td className="td-num">{formatNumber(aprPct, { decimals: 2 })}%</td>}
                            {visibleCols.esquema   && <td>{ESQUEMA_LABELS[r.esquemaAmortizacion] || r.esquemaAmortizacion || '—'}</td>}
                            {visibleCols.estado    && <td><span className={`finance-pill ${pill.cls}`}>{pill.label}</span></td>}
                            <td>
                              <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                                <button
                                  className="hist-kebab-btn"
                                  onClick={e => {
                                    if (rowMenu === r.id) { setRowMenu(null); return; }
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setRowMenuPos({
                                      top: rect.bottom + 4,
                                      right: window.innerWidth - rect.right,
                                    });
                                    setRowMenu(r.id);
                                  }}
                                >
                                  <FiMoreVertical size={16} />
                                </button>
                              </div>
                            </td>
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
                  type="number"
                  value={colFilters[filterPopover.field]?.from || ''}
                  onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'from', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                <span className="sh-filter-range-label">A</span>
                <input className="sh-filter-input sh-filter-input-range"
                  type="number"
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

      {rowMenu !== null && (() => {
        const r = offers.find(x => x.id === rowMenu);
        if (!r) return null;
        return createPortal(
          <div
            className="hist-kebab-dropdown hist-kebab-dropdown-fixed"
            style={{ top: rowMenuPos.top, right: rowMenuPos.right }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button className="hist-kebab-item" onClick={() => { setRowMenu(null); startEdit(r); }}>
              <FiEdit2 size={13} />
              Editar
            </button>
            <button className="hist-kebab-item hist-kebab-item-danger" onClick={() => { setRowMenu(null); setConfirmDelete(r.id); }}>
              <FiTrash2 size={13} />
              Eliminar
            </button>
          </div>,
          document.body,
        );
      })()}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar oferta"
          message="Esta acción no se puede deshacer. Las simulaciones existentes que referencien esta oferta quedarán huérfanas."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

export default CreditOffers;
