import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiPlus, FiBriefcase, FiX, FiLayout,
  FiMoreVertical, FiEdit2, FiTrash2, FiPackage,
  FiSearch, FiFileText, FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import PageHeader from '../../../components/PageHeader';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import AuroraSectionIntro from '../../../components/ui/AuroraSectionIntro';
import CreditOfferForm from '../components/CreditOfferForm';
import { RowKebabMenu } from '../components/table/SortableTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { formatMoney, formatNumber, formatPct } from '../../../lib/formatMoney';
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
  { key: 'monto',     label: 'Monto',      type: 'number', align: 'right' },
  { key: 'moneda',    label: 'Moneda',     type: 'text'   },
  { key: 'plazo',     label: 'Plazo (m)',  type: 'number', align: 'right' },
  { key: 'apr',       label: 'APR %',      type: 'number', align: 'right' },
  { key: 'esquema',   label: 'Esquema',    type: 'text'   },
  { key: 'estado',    label: 'Estado',     type: 'text'   },
];

// `useTableColumnPreset` indexa por `id`; lo derivamos de `key`. Preset compacto
// para alinear con Ingresos/Compradores (antes esta página no persistía columnas).
const COLUMN_DEFS = COLUMNS.map(c => ({ id: c.key, ...c }));
const COMPACT_KEYS = ['proveedor', 'tipo', 'monto', 'apr', 'estado'];

const STATUS_BADGE_VARIANT = {
  activo:   { label: 'Activa',    cls: 'aur-badge--green' },
  inactivo: { label: 'Archivada', cls: 'aur-badge--gray' },
};

// getColVal devuelve el valor que se ORDENA y FILTRA. Para columnas con label
// mapeado devolvemos el label visible en minúsculas (no el enum crudo): así
// filtrar por "Archivada" / "Agrícola" / "Cuota fija" coincide con lo que el
// usuario ve en la celda. Para APR devolvemos el porcentaje (×100), la misma
// unidad que muestra la columna.
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
  const toast = useToast();
  const { currentUser } = useUser();
  const canManage = hasMinRole(currentUser?.rol || 'trabajador', 'administrador');

  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [recentId, setRecentId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });

  const { isVisible, toggleColumn, isCompact, setMode } =
    useTableColumnPreset(COLUMN_DEFS, COMPACT_KEYS, 'aurora_credit_offers_columns');
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

  // Highlight temporal de la fila recién creada/editada.
  useEffect(() => {
    if (!recentId) return;
    const t = setTimeout(() => setRecentId(null), 1600);
    return () => clearTimeout(t);
  }, [recentId]);

  // load(silent): el primer load muestra el skeleton; los refrescos posteriores
  // (tras guardar) son silenciosos para no desmontar la tabla y provocar flash.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    apiFetch('/api/financing/credit-products')
      .then(async (r) => {
        if (!r.ok) {
          setOffers([]);
          setLoadError('No se pudieron cargar las ofertas.');
          return;
        }
        const data = await r.json();
        setOffers(Array.isArray(data) ? data : []);
      })
      .catch(() => setLoadError('No se pudieron cargar las ofertas. Revisá tu conexión.'))
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
      toast.success(isEdit ? 'Oferta actualizada.' : 'Oferta registrada.');
      setShowForm(false);
      setEditing(null);
      if (saved?.id) setRecentId(saved.id);
      load(true);
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
      const res = await apiFetch(`/api/financing/credit-products/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar.');
      toast.success('Oferta eliminada.');
      setOffers(prev => prev.filter(o => o.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e.message);
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
      toast.success(newActivo ? 'Oferta activada.' : 'Oferta archivada.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setTogglingId(null);
    }
  };

  const startEdit = (offer) => { setEditing(offer); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  // ── Búsqueda global (page-level). AuroraDataTable filtra por columna y ordena. ─
  const searchedData = useMemo(() => {
    if (!searchQuery.trim()) return offers;
    const q = searchQuery.trim().toLowerCase();
    return offers.filter(r => [
      r.providerName,
      PROVIDER_LABELS[r.providerType], r.providerType,
      TIPO_LABELS[r.tipo], r.tipo,
      r.moneda,
      ESQUEMA_LABELS[r.esquemaAmortizacion],
      r.descripcion,
      r.activo === false ? 'archivada' : 'activa',
    ].some(v => v && String(v).toLowerCase().includes(q)));
  }, [offers, searchQuery]);

  const renderSummary = (rows) => {
    const activas = rows.filter(o => o.activo !== false).length;
    const archivadas = rows.filter(o => o.activo === false).length;
    return (
      <div className="sh-stats-bar">
        <div className="sh-stat">
          <span className="sh-stat-value">{rows.length}</span>
          <span className="sh-stat-label">Ofertas</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value sh-stat-green">{activas}</span>
          <span className="sh-stat-label">Activas</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{archivadas}</span>
          <span className="sh-stat-label">Archivadas</span>
        </div>
      </div>
    );
  };

  const renderRow = (r, vis) => {
    const pillKey = r.activo === false ? 'inactivo' : 'activo';
    const pill = STATUS_BADGE_VARIANT[pillKey];
    const aprPct = Number(r.aprMin) * 100;
    return (
      <>
        {vis.proveedor && (
          <td>
            <strong>{r.providerName || '—'}</strong>
            {r.descripcion && (
              <FiFileText size={12} className="co-note-icon" title={r.descripcion} aria-label="Tiene notas" />
            )}
          </td>
        )}
        {vis.tipoProv && <td>{PROVIDER_LABELS[r.providerType] || r.providerType || '—'}</td>}
        {vis.tipo     && <td>{TIPO_LABELS[r.tipo] || r.tipo || '—'}</td>}
        {vis.monto    && <td className="aur-td-num">{formatMoney(r.monedaMin, r.moneda)}</td>}
        {vis.moneda   && <td>{r.moneda || '—'}</td>}
        {vis.plazo    && <td className="aur-td-num">{formatNumber(r.plazoMesesMin, { decimals: 0 })}</td>}
        {vis.apr      && <td className="aur-td-num">{formatPct(aprPct, { decimals: 2 })}</td>}
        {vis.esquema  && <td title={ESQUEMA_LABELS[r.esquemaAmortizacion] || ''}>{ESQUEMA_LABELS[r.esquemaAmortizacion] || r.esquemaAmortizacion || '—'}</td>}
        {vis.estado   && (
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
      </>
    );
  };

  const trailingCell = (r) => (
    <td>
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
        icon={<FiBriefcase />}
        title="Ofertas de crédito"
        backLink={{ to: '/finance/financing', label: 'Financiamiento' }}
        actions={!showForm && canManage && (
          <button className="aur-btn-pill" onClick={startCreate}>
            <FiPlus /> Nueva oferta
          </button>
        )}
      />

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
        loadError ? (
          <div className="siembra-empty-state" role="alert">
            <FiAlertTriangle size={36} />
            <p>{loadError}</p>
            <button className="aur-btn-pill" onClick={() => load()}>
              <FiRefreshCw /> Reintentar
            </button>
          </div>
        ) : loading ? (
          <AuroraSkeleton variant="row" count={6} label="Cargando ofertas…" />
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
            {/* ── Búsqueda global ────────────────────────────────────── */}
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

            <AuroraDataTable
              columns={COLUMNS}
              data={searchedData}
              getColVal={getColVal}
              initialSort={{ field: 'proveedor', dir: 'asc' }}
              firstClickDir="asc"
              visibleCols={visibleColsMap}
              onToggleVisibleCol={toggleColumn}
              rowKey={(r) => r.id}
              renderRow={renderRow}
              rowClassName={(r) => [
                r.activo === false ? 'row-inactive' : '',
                r.id === recentId ? 'row-recent' : '',
              ].filter(Boolean).join(' ')}
              tableClassName="fin-historial-table"
              trailingHead={canManage ? <th aria-hidden="true" /> : undefined}
              trailingCell={canManage ? trailingCell : undefined}
              renderSummary={renderSummary}
              resultLabel={(f) => (f === offers.length ? `${offers.length} ofertas` : `${f} de ${offers.length} ofertas`)}
              emptyText="No hay ofertas con los filtros aplicados."
              emptyIcon={FiPackage}
              toolbarActions={
                <button
                  className={`fin-table-btn${isCompact ? ' is-active' : ''}`}
                  onClick={() => setMode(isCompact ? 'full' : 'compact')}
                  title={isCompact ? `Mostrar las ${COLUMNS.length} columnas` : 'Mostrar sólo Proveedor · Crédito · Monto · APR · Estado'}
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
      {rowMenu !== null && canManage && (() => {
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
            `por ${formatMoney(confirmDelete.monedaMin, confirmDelete.moneda)} ` +
            `a ${formatNumber(confirmDelete.plazoMesesMin, { decimals: 0 })} meses · ` +
            `${formatPct(Number(confirmDelete.aprMin) * 100, { decimals: 2 })} APR. ` +
            'Esta acción no se puede deshacer; las simulaciones que la referencien quedarán con la oferta desvinculada.'
          }
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default CreditOffers;
