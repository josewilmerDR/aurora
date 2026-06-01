import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  FiPlus, FiBriefcase, FiFilter, FiX, FiSliders,
  FiMoreVertical, FiEdit2, FiTrash2, FiPackage, FiArrowLeft,
  FiSearch, FiFileText,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import CreditOfferForm from '../components/CreditOfferForm';
import { ColMenu, ColFilterPopover, RowKebabMenu } from '../components/table/SortableTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { formatMoney, formatNumber } from '../../../lib/formatMoney';
import '../../planting/styles/siembra.css';
import '../../planting/styles/siembra-historial.css';
import '../styles/finance.css';
import '../styles/financing.css';

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
  amortizacion_constante: 'Amortización constante',
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

const STATUS_BADGE_VARIANT = {
  activo:   { label: 'Activa',    cls: 'aur-badge--green' },
  inactivo: { label: 'Archivada', cls: 'aur-badge--gray' },
};

// getColVal devuelve el valor que se ORDENA y FILTRA. Para columnas con label
// mapeado devolvemos el label visible en minúsculas (no el enum crudo): así
// filtrar por "Archivada" / "Agrícola" / "Cuota fija" coincide con lo que el
// usuario ve en la celda. Para APR devolvemos el porcentaje (×100), la misma
// unidad que muestra la columna — si devolviéramos el decimal (0.14) el rango
// del filtro nunca matchearía lo que el usuario tipea (14).
function getColVal(r, key) {
  switch (key) {
    case 'proveedor': return (r.providerName || '').toLowerCase();
    case 'tipoProv':  return (PROVIDER_LABELS[r.providerType] || r.providerType || '').toLowerCase();
    case 'tipo':      return (TIPO_LABELS[r.tipo] || r.tipo || '').toLowerCase();
    case 'monto':     return Number(r.monedaMin) || 0;
    case 'moneda':    return (r.moneda || '').toLowerCase();
    case 'plazo':     return Number(r.plazoMesesMin) || 0;
    case 'apr':       return Number(r.aprMin) * 100 || 0;
    case 'esquema':   return (ESQUEMA_LABELS[r.esquemaAmortizacion] || r.esquemaAmortizacion || '').toLowerCase();
    case 'estado':    return r.activo === false ? 'archivada' : 'activa';
    default:          return '';
  }
}

function CreditOffers() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const canManage = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [recentId, setRecentId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
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

  // Los overlays porteados se posicionan con coordenadas absolutas calculadas al
  // abrir; si el usuario scrollea o rota el dispositivo quedarían flotando
  // despegados de su ancla. Los cerramos ante scroll/resize.
  useEffect(() => {
    if (!colMenu && !filterPopover && rowMenu === null) return;
    const close = () => { setColMenu(null); setFilterPopover(null); setRowMenu(null); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [colMenu, filterPopover, rowMenu]);

  // Highlight temporal de la fila recién creada/editada.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId(null), 1600);
    return () => clearTimeout(t);
  }, [recentId]);

  // load(silent): el primer load muestra "Cargando…"; los refrescos posteriores
  // (tras guardar) son silenciosos para no desmontar la tabla y provocar un flash.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    apiFetch('/api/financing/credit-products')
      .then(r => r.json())
      .then(data => setOffers(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las ofertas.' }))
      .finally(() => { if (!silent) setLoading(false); });
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
      const saved = await res.json().catch(() => ({}));
      setToast({ type: 'success', message: isEdit ? 'Oferta actualizada.' : 'Oferta registrada.' });
      setShowForm(false);
      setEditing(null);
      if (saved?.id) setRecentId(saved.id);
      load(true);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/financing/credit-products/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      setToast({ type: 'success', message: 'Oferta eliminada.' });
      setOffers(prev => prev.filter(o => o.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setDeleting(false);
    }
  };

  // Archivar / reactivar sin abrir el form: PUT del doc completo con `activo`
  // invertido (el validador del backend ignora campos extra). Update optimista.
  const handleToggleStatus = async (offer) => {
    if (!canManage || togglingId) return;
    setTogglingId(offer.id);
    const newActivo = offer.activo === false;
    try {
      const { id: _id, ...body } = offer;
      const res = await apiFetch(`/api/financing/credit-products/${offer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, activo: newActivo }),
      });
      if (!res.ok) throw new Error('No se pudo cambiar el estado.');
      setOffers(prev => prev.map(o => o.id === offer.id ? { ...o, activo: newActivo } : o));
      setToast({ type: 'success', message: newActivo ? 'Oferta activada.' : 'Oferta archivada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setTogglingId(null);
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

  const hiddenColCount = useMemo(
    () => Object.values(visibleCols).filter(v => !v).length,
    [visibleCols],
  );

  const displayData = useMemo(() => {
    let data = [...offers];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      data = data.filter(r => [
        r.providerName,
        PROVIDER_LABELS[r.providerType], r.providerType,
        TIPO_LABELS[r.tipo], r.tipo,
        r.moneda,
        ESQUEMA_LABELS[r.esquemaAmortizacion],
        r.descripcion,
        r.activo === false ? 'archivada' : 'activa',
      ].some(v => v && String(v).toLowerCase().includes(q)));
    }

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
  }, [offers, searchQuery, colFilters, sortField, sortDir]);

  const stats = useMemo(() => {
    const activas    = displayData.filter(o => o.activo !== false).length;
    const archivadas = displayData.filter(o => o.activo === false).length;
    return { activas, archivadas };
  }, [displayData]);

  const hasActiveFilters = Object.keys(colFilters).length > 0 || !!searchQuery;

  const SortTh = ({ col, children }) => {
    const isSort  = sortField === col.key;
    const hasFilt = !!colFilters[col.key];
    if (!visibleCols[col.key]) return null;
    const ariaSort = isSort ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none';
    return (
      <th
        className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
        aria-sort={ariaSort}
        tabIndex={0}
        onClick={() => handleThSort(col.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleThSort(col.key); }
        }}
      >
        <span className="sh-th-content">
          {children}
          <span className="sh-th-arrow" aria-hidden="true">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
          <button
            type="button"
            className={`sh-th-funnel aur-touch-target${hasFilt ? ' is-active' : ''}`}
            onClick={e => openColFilter(e, col.key, col.type)}
            onKeyDown={e => e.stopPropagation()}
            aria-label={`Filtrar por ${col.label}`}
            title={`Filtrar por ${col.label}`}
          >
            <FiFilter size={13} />
          </button>
        </span>
      </th>
    );
  };

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <div className="lote-page-title-stack">
          <Link to="/finance/financing" className="aur-btn-text fin-back-link">
            <FiArrowLeft size={12} /> Financiamiento
          </Link>
          <h2 className="lote-page-title"><FiBriefcase /> Ofertas de crédito</h2>
        </div>
        {!showForm && canManage && (
          <button className="aur-btn-pill" onClick={startCreate}>
            <FiPlus /> Nueva oferta
          </button>
        )}
      </div>

      {!showForm && (
        <AuroraSectionIntro
          expanderLabel="¿Para qué sirven estas ofertas?"
          expanderContent={
            <p>
              Cada oferta que registres alimenta el análisis de elegibilidad y
              las simulaciones Monte Carlo del simulador de deuda. Solo las
              ofertas <strong>activas</strong> aparecen como opción al simular.
            </p>
          }
        >
          Registrá acá las ofertas concretas que recibís de bancos, cooperativas
          u otros proveedores de crédito.
        </AuroraSectionIntro>
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
            {canManage ? (
              <button className="aur-btn-pill" onClick={startCreate}>
                <FiPlus /> Registrar primera oferta
              </button>
            ) : (
              <p className="fin-page-empty-hint">Pedile a un administrador que registre la primera oferta.</p>
            )}
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
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value">{stats.archivadas}</span>
                <span className="sh-stat-label">Archivadas</span>
              </div>
            </div>

            <div className="fin-search-wrap">
              <FiSearch size={14} className="fin-search-icon" />
              <input
                className="fin-search-input"
                placeholder="Buscar por proveedor, tipo, moneda, notas…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar ofertas"
              />
              {searchQuery && (
                <button className="fin-search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
                  <FiX size={14} />
                </button>
              )}
            </div>

            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count">
                  {displayData.length === offers.length
                    ? `${offers.length} ofertas`
                    : `${displayData.length} de ${offers.length} ofertas`}
                </span>
                {hasActiveFilters && (
                  <button className="sh-clear-col-filters" onClick={() => { setColFilters({}); setSearchQuery(''); }}>
                    <FiX size={11} /> Limpiar filtros
                  </button>
                )}
              </div>

              {displayData.length === 0 ? (
                <p className="empty-state">No hay ofertas con los filtros aplicados.</p>
              ) : (
                <div className="siembra-table-wrapper">
                  <table className="siembra-table siembra-table-historial">
                    <caption className="co-sr-only">Ofertas de crédito registradas</caption>
                    <thead>
                      <tr>
                        {COLUMNS.map(col => visibleCols[col.key] && (
                          <SortTh key={col.key} col={col}>{col.label}</SortTh>
                        ))}
                        <th className="sh-th-settings">
                          <button
                            className={`sh-col-toggle-btn aur-touch-target${hiddenColCount > 0 ? ' sh-col-toggle-btn--active' : ''}`}
                            onClick={handleColBtnClick}
                            title="Personalizar columnas"
                            aria-label="Personalizar columnas visibles"
                          >
                            <FiSliders size={12} />
                            {hiddenColCount > 0 && (
                              <span className="sh-col-hidden-badge">{hiddenColCount}</span>
                            )}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map(r => {
                        const pillKey = r.activo === false ? 'inactivo' : 'activo';
                        const pill = STATUS_BADGE_VARIANT[pillKey];
                        const aprPct = Number(r.aprMin) * 100;
                        // row-inactive atenúa la fila archivada; row-recent le
                        // da un flash a la recién creada/editada.
                        const rowCls = `${r.activo === false ? 'row-inactive' : ''}${r.id === recentId ? ' row-recent' : ''}`.trim();
                        return (
                          <tr key={r.id} className={rowCls}>
                            {visibleCols.proveedor && (
                              <td>
                                <strong>{r.providerName || '—'}</strong>
                                {r.descripcion && (
                                  <FiFileText
                                    size={12}
                                    className="co-note-icon"
                                    title={r.descripcion}
                                    aria-label="Tiene notas"
                                  />
                                )}
                              </td>
                            )}
                            {visibleCols.tipoProv  && <td>{PROVIDER_LABELS[r.providerType] || r.providerType || '—'}</td>}
                            {visibleCols.tipo      && <td>{TIPO_LABELS[r.tipo] || r.tipo || '—'}</td>}
                            {visibleCols.monto     && <td className="td-num">{formatMoney(r.monedaMin, r.moneda, { decimals: 0 })}</td>}
                            {visibleCols.moneda    && <td>{r.moneda || '—'}</td>}
                            {visibleCols.plazo     && <td className="td-num">{formatNumber(r.plazoMesesMin, { decimals: 0 })}</td>}
                            {visibleCols.apr       && <td className="td-num">{formatNumber(aprPct, { decimals: 2 })}%</td>}
                            {visibleCols.esquema   && <td title={ESQUEMA_LABELS[r.esquemaAmortizacion] || ''}>{ESQUEMA_LABELS[r.esquemaAmortizacion] || r.esquemaAmortizacion || '—'}</td>}
                            {visibleCols.estado    && (
                              <td>
                                {canManage ? (
                                  <button
                                    type="button"
                                    className={`aur-badge ${pill.cls} aur-badge--clickable`}
                                    onClick={() => handleToggleStatus(r)}
                                    disabled={togglingId === r.id}
                                    title={r.activo === false ? 'Activar oferta' : 'Archivar oferta'}
                                  >
                                    {togglingId === r.id ? '…' : pill.label}
                                  </button>
                                ) : (
                                  <span className={`aur-badge ${pill.cls}`}>{pill.label}</span>
                                )}
                              </td>
                            )}
                            <td>
                              {canManage && (
                                <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                                  <button
                                    className="hist-kebab-btn aur-touch-target"
                                    title="Más acciones"
                                    aria-label="Más acciones"
                                    aria-haspopup="menu"
                                    aria-expanded={rowMenu === r.id}
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
                              )}
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
        <ColMenu x={colMenu.x} y={colMenu.y} columns={COLUMNS} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {filterPopover && (
        <ColFilterPopover
          popover={filterPopover}
          value={colFilters[filterPopover.field]}
          onChange={(key, val) => setColFilter(filterPopover.field, filterPopover.type, key, val)}
          onClear={() => {
            if (filterPopover.type === 'text') setColFilter(filterPopover.field, 'text', 'text', '');
            else { setColFilter(filterPopover.field, filterPopover.type, 'from', ''); setColFilter(filterPopover.field, filterPopover.type, 'to', ''); }
          }}
          onClose={() => setFilterPopover(null)}
        />
      )}

      {rowMenu !== null && (() => {
        const r = offers.find(x => x.id === rowMenu);
        if (!r) return null;
        return (
          <RowKebabMenu
            pos={rowMenuPos}
            onClose={() => setRowMenu(null)}
            items={[
              { icon: <FiEdit2 size={13} />, label: 'Editar', onClick: () => { setRowMenu(null); startEdit(r); } },
              { icon: <FiTrash2 size={13} />, label: 'Eliminar', danger: true, onClick: () => { setRowMenu(null); setConfirmDelete(r); } },
            ]}
          />
        );
      })()}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          loading={deleting}
          loadingLabel="Eliminando…"
          title="Eliminar oferta"
          body={
            `Vas a eliminar la oferta de ${confirmDelete.providerName || 'proveedor sin nombre'} ` +
            `por ${formatMoney(confirmDelete.monedaMin, confirmDelete.moneda, { decimals: 0 })} ` +
            `a ${formatNumber(confirmDelete.plazoMesesMin, { decimals: 0 })} meses · ` +
            `${formatNumber(Number(confirmDelete.aprMin) * 100, { decimals: 2 })}% APR. ` +
            'Esta acción no se puede deshacer; las simulaciones que la referencien quedarán con la oferta desvinculada.'
          }
          confirmLabel="Eliminar"
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
