import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiPlus, FiUsers, FiX, FiLayout, FiPower,
  FiMoreVertical, FiEdit2, FiTrash2, FiSearch, FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import PageHeader from '../../../components/PageHeader';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import BuyerForm from '../components/BuyerForm';
import { RowKebabMenu } from '../components/table/SortableTable';
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
  { key: 'credito',  label: 'Días créd.',   type: 'number', align: 'right' },
  { key: 'limite',   label: 'Límite créd.', type: 'number', align: 'right' },
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
    : formatMoney(r.creditLimit, r.currency);

// Extrae el mensaje en español del cuerpo de error del backend, con fallback.
async function apiErrorMessage(res, fallback) {
  const body = await res.json().catch(() => null);
  return translateApiError(body, fallback);
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
  const [togglingId, setTogglingId] = useState(null);

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });

  // Visibilidad de columnas con preset compacto/completo persistido (modo
  // controlado de AuroraDataTable).
  const { isVisible, toggleColumn, isCompact, setMode } =
    useTableColumnPreset(COLUMN_DEFS, COMPACT_KEYS, 'aurora_buyers_columns');
  const visibleColsMap = useMemo(
    () => Object.fromEntries(COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible]
  );

  // Cierra el kebab al click fuera / scroll / resize (dropdown fixed).
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [rowMenu]);

  // Limpia el highlight de la fila recién tocada tras un par de segundos.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId(null), 2200);
    return () => clearTimeout(t);
  }, [recentId]);

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

  // ── Búsqueda global (page-level, con normalización de diacríticos).
  //    AuroraDataTable hace el filtro por columna y el orden. ────────────────
  const searchedData = useMemo(() => {
    if (!searchQuery.trim()) return buyers;
    const q = norm(searchQuery.trim());
    return buyers.filter(r => [
      r.name, r.taxId, r.contact, r.phone, r.email,
      paymentLabelOf(r), r.currency, r.country, statusOf(r).label,
    ].some(v => v && norm(v).includes(q)));
  }, [buyers, searchQuery]);

  // ── Stats bar (renderSummary) ────────────────────────────────────────────
  const renderSummary = (rows) => {
    const activos = rows.filter(b => b.status !== 'inactivo').length;
    const inactivos = rows.filter(b => b.status === 'inactivo').length;
    return (
      <div className="sh-stats-bar">
        <div className="sh-stat">
          <span className="sh-stat-value">{rows.length}</span>
          <span className="sh-stat-label">Compradores</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value sh-stat-green">{activos}</span>
          <span className="sh-stat-label">Activos</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{inactivos}</span>
          <span className="sh-stat-label">Inactivos</span>
        </div>
      </div>
    );
  };

  const renderRow = (r, vis) => {
    const pill = statusOf(r);
    const creditLabel = r.paymentType === 'credito' ? `${r.creditDays || 0}d` : '—';
    return (
      <>
        {vis.nombre   && <td><strong>{r.name || '—'}</strong></td>}
        {vis.taxId    && <td>{r.taxId || '—'}</td>}
        {vis.contacto && <td>{r.contact || '—'}</td>}
        {vis.telefono && <td>{r.phone || '—'}</td>}
        {vis.email    && <td>{r.email || '—'}</td>}
        {vis.pago     && <td>{paymentLabelOf(r) || '—'}</td>}
        {vis.credito  && <td className="aur-td-num">{creditLabel}</td>}
        {vis.limite   && <td className="aur-td-num">{limitLabel(r)}</td>}
        {vis.moneda   && <td>{r.currency || '—'}</td>}
        {vis.pais     && <td>{r.country || '—'}</td>}
        {vis.estado   && <td><span className={`aur-badge ${pill.cls}`}>{pill.label}</span></td>}
      </>
    );
  };

  // Columna de acciones (kebab) — solo si el usuario puede escribir.
  const trailingCell = (r) => (
    <td>
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
            setRowMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
            setRowMenu(r.id);
          }}
        >
          <FiMoreVertical size={16} />
        </button>
      </div>
    </td>
  );

  return (
    <div className="lote-page">
      <PageHeader
        level={2}
        icon={<FiUsers />}
        title="Compradores"
        actions={!showForm && canWrite && (
          <button className="aur-btn-pill" onClick={startCreate}>
            <FiPlus /> Nuevo comprador
          </button>
        )}
      />

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

            <AuroraDataTable
              columns={COLUMNS}
              data={searchedData}
              getColVal={getColVal}
              initialSort={{ field: 'nombre', dir: 'asc' }}
              firstClickDir="asc"
              visibleCols={visibleColsMap}
              onToggleVisibleCol={toggleColumn}
              rowKey={(r) => r.id}
              renderRow={renderRow}
              rowClassName={(r) => [
                r.status === 'inactivo' ? 'row-inactive' : '',
                r.id === recentId ? 'row-recent' : '',
              ].filter(Boolean).join(' ')}
              tableClassName="fin-historial-table"
              trailingHead={canWrite ? <th aria-hidden="true" /> : undefined}
              trailingCell={canWrite ? trailingCell : undefined}
              renderSummary={renderSummary}
              resultLabel={(f) => (f === buyers.length ? `${buyers.length} compradores` : `${f} de ${buyers.length} compradores`)}
              emptyText="No hay compradores con los filtros aplicados."
              emptyIcon={FiUsers}
              toolbarActions={
                <button
                  className={`fin-table-btn${isCompact ? ' is-active' : ''}`}
                  onClick={() => setMode(isCompact ? 'full' : 'compact')}
                  title={isCompact ? `Mostrar las ${COLUMNS.length} columnas` : 'Mostrar sólo Nombre · Cédula · Teléfono · Forma pago · Estado'}
                >
                  <FiLayout size={11} />
                  {isCompact ? `Mostrar todas (${COLUMNS.length} cols)` : 'Vista compacta'}
                </button>
              }
            />
          </>
        )
      )}

      {/* ── Kebab dropdown ──────────────────────────────────────────── */}
      {rowMenu !== null && canWrite && (() => {
        const r = buyers.find(x => x.id === rowMenu);
        if (!r) return null;
        const isInactive = r.status === 'inactivo';
        return (
          <RowKebabMenu
            pos={rowMenuPos}
            onClose={() => setRowMenu(null)}
            items={[
              { icon: <FiEdit2 size={13} />, label: 'Editar', onClick: () => { setRowMenu(null); startEdit(r); } },
              {
                icon: <FiPower size={13} />,
                label: isInactive ? 'Activar' : 'Desactivar',
                disabled: togglingId === r.id,
                onClick: () => { setRowMenu(null); handleToggleStatus(r); },
              },
              { icon: <FiTrash2 size={13} />, label: 'Eliminar', danger: true, onClick: () => { setRowMenu(null); setConfirmDelete(r); } },
            ]}
          />
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
