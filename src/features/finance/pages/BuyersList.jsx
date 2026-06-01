import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FiPlus, FiUsers, FiFilter, FiX, FiSliders, FiLayout, FiPower,
  FiMoreVertical, FiEdit2, FiTrash2, FiSearch, FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import BuyerForm from '../components/BuyerForm';
import { ColMenu, ColFilterPopover } from '../components/table/SortableTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { translateApiError } from '../../../lib/errorMessages';
import { formatMoney } from '../../../lib/formatMoney';
import '../../planting/styles/siembra.css';
import '../../planting/styles/siembra-historial.css';
import '../styles/finance.css';

// ── Tabla: configuración de columnas ─────────────────────────────────────────
const COLUMNS = [
  { key: 'nombre',   label: 'Nombre',       type: 'text'   },
  { key: 'taxId',    label: 'Cédula',       type: 'text'   },
  { key: 'contacto', label: 'Contacto',     type: 'text'   },
  { key: 'telefono', label: 'Teléfono',     type: 'text'   },
  { key: 'email',    label: 'Email',        type: 'text'   },
  { key: 'pago',     label: 'Forma pago',   type: 'text'   },
  { key: 'credito',  label: 'Días créd.',   type: 'number' },
  { key: 'limite',   label: 'Límite créd.', type: 'number' },
  { key: 'moneda',   label: 'Moneda',       type: 'text'   },
  { key: 'pais',     label: 'País',         type: 'text'   },
  { key: 'estado',   label: 'Estado',       type: 'text'   },
];

// `useTableColumnPreset` indexa por `id`; lo derivamos de `key`.
const COLUMN_DEFS = COLUMNS.map(c => ({ id: c.key, ...c }));
// Preset compacto (audit UX): nombre · cédula · teléfono · forma pago · estado.
const COMPACT_KEYS = ['nombre', 'taxId', 'telefono', 'pago', 'estado'];

const PAYMENT_LABELS = { contado: 'Contado', credito: 'Crédito' };

const STATUS_BADGE_VARIANT = {
  activo:   { label: 'Activo',   cls: 'aur-badge--green' },
  inactivo: { label: 'Inactivo', cls: 'aur-badge--gray' },
};

const statusOf = (r) => STATUS_BADGE_VARIANT[r.status] || STATUS_BADGE_VARIANT.activo;
const paymentLabelOf = (r) => PAYMENT_LABELS[r.paymentType] || r.paymentType || '';

// Normaliza para búsqueda/filtros: minúsculas + sin diacríticos, así
// "Crédito", "credito" y "CRÉDITO" matchean indistintamente (audit UX #13).
const norm = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

function getColVal(r, key) {
  switch (key) {
    case 'nombre':   return norm(r.name);
    case 'taxId':    return norm(r.taxId);
    case 'contacto': return norm(r.contact);
    case 'telefono': return norm(r.phone);
    case 'email':    return norm(r.email);
    case 'pago':     return norm(paymentLabelOf(r));
    case 'credito':  return r.paymentType === 'credito' ? Number(r.creditDays) || 0 : 0;
    case 'limite':   return Number(r.creditLimit) || 0;
    case 'moneda':   return norm(r.currency);
    case 'pais':     return norm(r.country);
    case 'estado':   return norm(statusOf(r).label);
    default:         return '';
  }
}

const limitLabel = (r) =>
  r.creditLimit === null || r.creditLimit === undefined || r.creditLimit === ''
    ? '—'
    : formatMoney(r.creditLimit, r.currency, { decimals: 0 });

// Extrae el mensaje en español del cuerpo de error del backend, con fallback.
async function apiErrorMessage(res, fallback) {
  const body = await res.json().catch(() => null);
  return translateApiError(body, fallback);
}

// ── TH ordenable (hoisteado a módulo: evita remount de todo el header en cada
//    tecla tipeada en la búsqueda — audit UX #8) ─────────────────────────────
function SortTh({ col, sortField, sortDir, hasFilter, onSort, onOpenFilter }) {
  const isSort = sortField === col.key;
  return (
    <th
      className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
      aria-sort={isSort ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
      tabIndex={0}
      onClick={() => onSort(col.key)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(col.key); } }}
    >
      <span className="sh-th-content">
        {col.label}
        <span className="sh-th-arrow" aria-hidden="true">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
        <span
          className={`sh-th-funnel${hasFilter ? ' is-active' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Filtrar por ${col.label}${hasFilter ? ' (filtro activo)' : ''}`}
          title={`Filtrar por ${col.label}`}
          onClick={e => onOpenFilter(e, col.key, col.type)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenFilter(e, col.key, col.type); } }}
        >
          <FiFilter size={13} />
        </span>
      </span>
    </th>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
function BuyersList() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const { currentUser } = useUser();
  // listBuyers está abierto a cualquier rol (alimenta selectores), pero
  // crear/editar/eliminar exige encargado+ en el backend. Gateamos la UI para
  // no mostrar acciones que terminarían en un 403 (audit UX #6).
  const canWrite = hasMinRole(currentUser?.rol || 'trabajador', 'encargado');

  const [buyers, setBuyers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // objeto buyer completo
  const [deleting, setDeleting] = useState(false);
  const [recentId, setRecentId] = useState(null); // highlight de fila recién tocada

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('nombre');
  const [sortDir,   setSortDir]   = useState('asc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [colMenu, setColMenu] = useState(null);

  const [togglingId, setTogglingId] = useState(null);
  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });

  // Visibilidad de columnas con preset compacto/completo persistido.
  const { visibleColumns, isVisible, toggleColumn, isCompact, setMode } =
    useTableColumnPreset(COLUMN_DEFS, COMPACT_KEYS, 'aurora_buyers_columns');
  const visibleColsMap = useMemo(
    () => Object.fromEntries(COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible]
  );
  const hiddenCount = COLUMNS.length - visibleColumns.length;

  // Cierra el kebab al hacer click fuera o al scrollear (si no, el dropdown
  // fixed queda flotando desanclado de su fila — audit UX #16).
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [rowMenu]);

  // Limpia el highlight de la fila recién tocada tras un par de segundos.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId(null), 2200);
    return () => clearTimeout(t);
  }, [recentId]);

  // Mueve el foco al primer item cuando abre el kebab (accesibilidad #16).
  const focusFirstMenuItem = useCallback((el) => {
    if (el && !el.contains(document.activeElement)) el.querySelector('button')?.focus();
  }, []);

  // ── Carga ─────────────────────────────────────────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    apiFetch('/api/buyers')
      .then(async (r) => {
        if (!r.ok) {
          setBuyers([]);
          setLoadError(await apiErrorMessage(r, 'No se pudo cargar la lista de compradores.'));
          return;
        }
        const data = await r.json();
        setBuyers(Array.isArray(data) ? data : []);
      })
      .catch(() => setLoadError('No se pudo cargar la lista de compradores. Revisá tu conexión.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers CRUD ────────────────────────────────────────────────────────
  const handleSave = async (form) => {
    setSaving(true);
    const isEdit = Boolean(form.id);
    const url = isEdit ? `/api/buyers/${form.id}` : '/api/buyers';
    const method = isEdit ? 'PUT' : 'POST';
    const { id: _omit, ...createBody } = form; // no mandar id en el body del POST (#20)
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? form : createBody),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo guardar el comprador.'));
      const out = await res.json().catch(() => ({}));
      if (isEdit) {
        toast.success('Comprador actualizado.');
      } else if (out.merged) {
        // El backend hace upsert por cédula: si ya existía uno con ese taxId,
        // se actualizó en vez de crear. No mentir con "creado" (#1).
        toast.info('Ya existía un comprador con esa cédula; se actualizó con los datos ingresados.');
      } else {
        toast.success('Comprador creado.');
      }
      setRecentId(out.id || form.id || null);
      setShowForm(false);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/buyers/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo eliminar el comprador.'));
      toast.success('Comprador eliminado.');
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = (buyer) => { setEditing(buyer); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  const handleToggleStatus = async (buyer) => {
    if (togglingId) return;
    setTogglingId(buyer.id);
    const newStatus = buyer.status === 'inactivo' ? 'activo' : 'inactivo';
    try {
      // PATCH de estado únicamente: el PUT completo reenviaría todo el doc y el
      // validador podría re-normalizar campos accesorios (creditDays) — audit #28.
      const res = await apiFetch(`/api/buyers/${buyer.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo actualizar el estado.'));
      setBuyers(prev => prev.map(b => b.id === buyer.id ? { ...b, status: newStatus } : b));
      setRecentId(buyer.id);
      toast.success(newStatus === 'activo' ? 'Comprador activado.' : 'Comprador desactivado.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  // ── Sort / filtros de columna ─────────────────────────────────────────────
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

  const clearColFilter = (field, type) => {
    if (type === 'text') setColFilter(field, type, 'text', '');
    else { setColFilter(field, type, 'from', ''); setColFilter(field, type, 'to', ''); }
  };

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // Clamp al viewport: con 185px de ancho estimado el menú no se sale por
    // la derecha ni por la izquierda (audit UX #27).
    const x = Math.max(8, Math.min(r.right - 185, window.innerWidth - 193));
    setColMenu({ x, y: r.bottom + 4 });
  };

  // ── Datos derivados ──────────────────────────────────────────────────────
  const displayData = useMemo(() => {
    let data = [...buyers];

    if (searchQuery.trim()) {
      const q = norm(searchQuery.trim());
      data = data.filter(r => [
        r.name, r.taxId, r.contact, r.phone, r.email,
        paymentLabelOf(r), r.currency, r.country, statusOf(r).label,
      ].some(v => v && norm(v).includes(q)));
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
            if (fv.text && !String(val).includes(norm(fv.text))) return false;
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
  }, [buyers, searchQuery, colFilters, sortField, sortDir]);

  const stats = useMemo(() => {
    const activos   = displayData.filter(b => b.status !== 'inactivo').length;
    const inactivos = displayData.filter(b => b.status === 'inactivo').length;
    return { activos, inactivos };
  }, [displayData]);

  const filtersActive = Object.keys(colFilters).length > 0 || Boolean(searchQuery);

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiUsers /> Compradores</h2>
        {!showForm && canWrite && (
          <button className="aur-btn-pill" onClick={startCreate}>
            <FiPlus /> Nuevo comprador
          </button>
        )}
      </div>

      {showForm && (
        <BuyerForm
          initial={editing}
          onSubmit={handleSave}
          onCancel={cancel}
          saving={saving}
        />
      )}

      {!showForm && (
        loadError ? (
          <div className="siembra-empty-state" role="alert">
            <FiAlertTriangle size={36} />
            <p>{loadError}</p>
            <button className="aur-btn-pill" onClick={load}>
              <FiRefreshCw /> Reintentar
            </button>
          </div>
        ) : loading ? (
          <AuroraSkeleton variant="row" count={6} label="Cargando compradores…" />
        ) : buyers.length === 0 ? (
          <div className="siembra-empty-state">
            <FiUsers size={36} />
            <p>Aún no hay compradores registrados.</p>
            {canWrite && (
              <button className="aur-btn-pill" onClick={startCreate}>
                <FiPlus /> Agregar primer comprador
              </button>
            )}
          </div>
        ) : (
          <>
            {/* ── Stats bar ──────────────────────────────────────────── */}
            <div className="sh-stats-bar">
              <div className="sh-stat">
                <span className="sh-stat-value">{displayData.length}</span>
                <span className="sh-stat-label">Compradores</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value sh-stat-green">{stats.activos}</span>
                <span className="sh-stat-label">Activos</span>
              </div>
              <div className="sh-stat-divider" />
              <div className="sh-stat">
                <span className="sh-stat-value">{stats.inactivos}</span>
                <span className="sh-stat-label">Inactivos</span>
              </div>
            </div>

            {/* ── Búsqueda global ────────────────────────────────────── */}
            <div className="fin-search-wrap">
              <FiSearch size={14} className="fin-search-icon" />
              <input
                className="fin-search-input"
                aria-label="Buscar compradores"
                placeholder="Buscar por nombre, cédula, email, país…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="fin-search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
                  <FiX size={14} />
                </button>
              )}
            </div>

            {/* ── Tabla ──────────────────────────────────────────────── */}
            <div className="siembra-historial sh-table-card">
              <div className="historial-top-row">
                <span className="sh-result-count">
                  {displayData.length === buyers.length
                    ? `${buyers.length} compradores`
                    : `${displayData.length} de ${buyers.length} compradores`}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                  <button
                    className={`fin-table-btn${isCompact ? ' is-active' : ''}`}
                    onClick={() => setMode(isCompact ? 'full' : 'compact')}
                    title={isCompact ? `Mostrar las ${COLUMNS.length} columnas` : 'Mostrar sólo Nombre · Cédula · Teléfono · Forma pago · Estado'}
                  >
                    <FiLayout size={11} />
                    {isCompact ? `Mostrar todas (${COLUMNS.length} cols)` : 'Vista compacta'}
                  </button>
                  {filtersActive && (
                    <button className="sh-clear-col-filters" onClick={() => { setColFilters({}); setSearchQuery(''); }}>
                      <FiX size={11} /> Limpiar filtros
                    </button>
                  )}
                </div>
              </div>

              {displayData.length === 0 ? (
                <p className="empty-state">No hay compradores con los filtros aplicados.</p>
              ) : (
                <div className="siembra-table-wrapper">
                  <table className="siembra-table siembra-table-historial">
                    <thead>
                      <tr>
                        {visibleColumns.map(col => (
                          <SortTh
                            key={col.key}
                            col={col}
                            sortField={sortField}
                            sortDir={sortDir}
                            hasFilter={!!colFilters[col.key]}
                            onSort={handleThSort}
                            onOpenFilter={openColFilter}
                          />
                        ))}
                        <th className="sh-th-settings">
                          <button
                            className={`sh-col-toggle-btn${hiddenCount > 0 ? ' sh-col-toggle-btn--active' : ''}`}
                            onClick={handleColBtnClick}
                            title="Personalizar columnas"
                            aria-label="Personalizar columnas visibles"
                          >
                            <FiSliders size={12} />
                            {hiddenCount > 0 && (
                              <span className="sh-col-hidden-badge">{hiddenCount}</span>
                            )}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayData.map(r => {
                        const pill = statusOf(r);
                        const creditLabel = r.paymentType === 'credito' ? `${r.creditDays || 0}d` : '—';
                        const rowCls = [
                          r.status === 'inactivo' ? 'row-inactive' : '',
                          r.id === recentId ? 'row-recent' : '',
                        ].filter(Boolean).join(' ');
                        return (
                          <tr key={r.id} className={rowCls}>
                            {isVisible('nombre')   && <td><strong>{r.name || '—'}</strong></td>}
                            {isVisible('taxId')    && <td>{r.taxId || '—'}</td>}
                            {isVisible('contacto') && <td>{r.contact || '—'}</td>}
                            {isVisible('telefono') && <td>{r.phone || '—'}</td>}
                            {isVisible('email')    && <td>{r.email || '—'}</td>}
                            {isVisible('pago')     && <td>{paymentLabelOf(r) || '—'}</td>}
                            {isVisible('credito')  && <td className="td-num">{creditLabel}</td>}
                            {isVisible('limite')   && <td className="td-num">{limitLabel(r)}</td>}
                            {isVisible('moneda')   && <td>{r.currency || '—'}</td>}
                            {isVisible('pais')     && <td>{r.country || '—'}</td>}
                            {isVisible('estado')   && (
                              <td><span className={`aur-badge ${pill.cls}`}>{pill.label}</span></td>
                            )}
                            <td>
                              {canWrite && (
                                <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                                  <button
                                    className="hist-kebab-btn aur-touch-target"
                                    title="Más acciones"
                                    aria-label={`Acciones para ${r.name || 'comprador'}`}
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

      {/* ── Menú de columnas ────────────────────────────────────────── */}
      {colMenu && (
        <ColMenu
          x={colMenu.x}
          y={colMenu.y}
          columns={COLUMNS}
          visibleCols={visibleColsMap}
          onToggle={toggleColumn}
          onClose={() => setColMenu(null)}
        />
      )}

      {/* ── Popover de filtro de columna ────────────────────────────── */}
      {filterPopover && (
        <ColFilterPopover
          popover={filterPopover}
          value={colFilters[filterPopover.field]}
          onChange={(key, val) => setColFilter(filterPopover.field, filterPopover.type, key, val)}
          onClear={() => clearColFilter(filterPopover.field, filterPopover.type)}
          onClose={() => setFilterPopover(null)}
        />
      )}

      {/* ── Kebab dropdown portal ───────────────────────────────────── */}
      {rowMenu !== null && canWrite && (() => {
        const r = buyers.find(x => x.id === rowMenu);
        if (!r) return null;
        const isInactive = r.status === 'inactivo';
        return createPortal(
          <div
            ref={focusFirstMenuItem}
            className="hist-kebab-dropdown hist-kebab-dropdown-fixed"
            style={{ top: rowMenuPos.top, right: rowMenuPos.right }}
            role="menu"
            aria-label={`Acciones para ${r.name || 'comprador'}`}
            onPointerDown={e => e.stopPropagation()}
          >
            <button role="menuitem" className="hist-kebab-item" onClick={() => { setRowMenu(null); startEdit(r); }}>
              <FiEdit2 size={13} />
              Editar
            </button>
            <button
              role="menuitem"
              className="hist-kebab-item"
              disabled={togglingId === r.id}
              onClick={() => { setRowMenu(null); handleToggleStatus(r); }}
            >
              <FiPower size={13} />
              {isInactive ? 'Activar' : 'Desactivar'}
            </button>
            <button role="menuitem" className="hist-kebab-item hist-kebab-item-danger" onClick={() => { setRowMenu(null); setConfirmDelete(r); }}>
              <FiTrash2 size={13} />
              Eliminar
            </button>
          </div>,
          document.body,
        );
      })()}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar comprador"
          body={
            <>
              Vas a eliminar a <strong>{confirmDelete.name || 'este comprador'}</strong>
              {confirmDelete.taxId ? ` (cédula ${confirmDelete.taxId})` : ''}. Esta acción no se puede deshacer.
              Los ingresos ya registrados a su nombre se conservan, pero dejará de estar disponible para nuevos ingresos.
            </>
          }
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default BuyersList;
