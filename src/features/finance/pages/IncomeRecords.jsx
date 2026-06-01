import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiPlus, FiDollarSign, FiX, FiMoreVertical, FiEdit2, FiTrash2,
  FiSearch, FiLayout, FiDownload, FiAlertTriangle, FiRefreshCw,
} from 'react-icons/fi';
import { useToast } from '../../../contexts/ToastContext';
import PageHeader from '../../../components/PageHeader';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import IncomeForm from '../components/IncomeForm';
import { RowKebabMenu } from '../components/table/SortableTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import { translateApiError } from '../../../lib/errorMessages';
import { formatMoney, formatNumber, formatPrice } from '../../../lib/formatMoney';
import { formatShortDate } from '../../../lib/formatDate';
import '../../planting/styles/siembra.css';
import '../../planting/styles/siembra-historial.css';
import '../styles/finance.css';

// ── Tabla: configuración de columnas ─────────────────────────────────────────
const COLUMNS = [
  { key: 'fecha',     label: 'Fecha',       type: 'date'   },
  { key: 'comprador', label: 'Comprador',   type: 'text'   },
  { key: 'lote',      label: 'Lote',        type: 'text'   },
  { key: 'despachos', label: 'Despachos',   type: 'number', align: 'right' },
  { key: 'cantidad',  label: 'Cantidad',    type: 'number', align: 'right' },
  { key: 'unidad',    label: 'Unidad',      type: 'text'   },
  { key: 'precio',    label: 'P. unit.',    type: 'number', align: 'right' },
  { key: 'total',     label: 'Total',       type: 'number', align: 'right' },
  { key: 'moneda',    label: 'Moneda',      type: 'text'   },
  { key: 'estado',    label: 'Estado',      type: 'text'   },
  { key: 'fespera',   label: 'F. esperada', type: 'date'   },
  { key: 'fcobro',    label: 'F. cobrada',  type: 'date'   },
];

// `useTableColumnPreset` indexa por `id`; lo derivamos de `key`.
const COLUMN_DEFS = COLUMNS.map(c => ({ id: c.key, ...c }));
// Preset compacto (audit UX): la vista de 12 columnas abruma al usuario casual.
const COMPACT_KEYS = ['fecha', 'comprador', 'lote', 'total', 'estado'];

const STATUS_BADGE_VARIANT = {
  pendiente: { label: 'Pendiente', cls: 'aur-badge--magenta' },
  cobrado:   { label: 'Cobrado',   cls: 'aur-badge--green' },
  anulado:   { label: 'Anulado',   cls: 'aur-badge--gray' },
};

const dispatchCount = (r) =>
  Array.isArray(r.despachoIds) ? r.despachoIds.length : (r.despachoId ? 1 : 0);

// getColVal devuelve el valor que se ORDENA y FILTRA. Las fechas se recortan a
// `YYYY-MM-DD`: si el doc trae componente de hora, la comparación lexicográfica
// del filtro de rango excluía el día exacto del límite "A" (audit #20).
function getColVal(r, key) {
  switch (key) {
    case 'fecha':     return (r.date || '').slice(0, 10);
    case 'comprador': return (r.buyerName || '').toLowerCase();
    case 'lote':      return (r.loteNombre || '').toLowerCase();
    case 'despachos': return dispatchCount(r);
    case 'cantidad':  return Number(r.quantity) || 0;
    case 'unidad':    return (r.unit || '').toLowerCase();
    case 'precio':    return Number(r.unitPrice) || 0;
    case 'total':     return Number(r.totalAmountCRC) || Number(r.totalAmount) || 0;
    case 'moneda':    return (r.currency || '').toLowerCase();
    case 'estado':    return (r.collectionStatus || '').toLowerCase();
    case 'fespera':   return (r.expectedCollectionDate || '').slice(0, 10);
    case 'fcobro':    return (r.actualCollectionDate || '').slice(0, 10);
    default:          return '';
  }
}

// Valor crudo para el CSV (sin normalizar a minúsculas/CRC; eso lo agrega la
// columna "Total (CRC)" aparte).
function csvCellValue(r, key) {
  switch (key) {
    case 'fecha':     return r.date || '';
    case 'comprador': return r.buyerName || '';
    case 'lote':      return r.loteNombre || '';
    case 'despachos': return dispatchCount(r);
    case 'cantidad':  return r.quantity ?? '';
    case 'unidad':    return r.unit || '';
    case 'precio':    return r.unitPrice ?? '';
    case 'total':     return r.totalAmount ?? '';
    case 'moneda':    return r.currency || '';
    case 'estado':    return r.collectionStatus || '';
    case 'fespera':   return r.expectedCollectionDate || '';
    case 'fcobro':    return r.actualCollectionDate || '';
    default:          return '';
  }
}

// Extrae el mensaje en español del cuerpo de error del backend, con fallback.
async function apiErrorMessage(res, fallback) {
  const body = await res.json().catch(() => null);
  return translateApiError(body, fallback);
}

// ── Página principal ─────────────────────────────────────────────────────────
function IncomeRecords() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // registro completo
  const [deleting, setDeleting] = useState(false);
  const [recentId, setRecentId] = useState(null); // highlight de fila recién tocada
  const [searchQuery, setSearchQuery] = useState('');

  // Snapshot de la vista filtrada+ordenada del data-table, para que el CSV
  // exporte exactamente lo que se ve (lo alimenta AuroraDataTable).
  const displayRef = useRef([]);

  // Visibilidad de columnas con preset compacto/completo persistido. Se pasa
  // a AuroraDataTable en modo controlado (la persistencia vive acá).
  const { visibleColumns, isVisible, toggleColumn, isCompact, setMode } =
    useTableColumnPreset(COLUMN_DEFS, COMPACT_KEYS, 'aurora_income_columns');
  const visibleColsMap = useMemo(
    () => Object.fromEntries(COLUMNS.map(c => [c.key, isVisible(c.key)])),
    [isVisible]
  );

  const [rowMenu, setRowMenu] = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });

  // Cierra el kebab al click fuera / scroll / resize (el dropdown es fixed y
  // si no queda flotando desanclado de su fila).
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
    const t = setTimeout(() => setRecentId(null), 2000);
    return () => clearTimeout(t);
  }, [recentId]);

  // ── Carga ─────────────────────────────────────────────────────────────────
  // load(silent): el primer load muestra el skeleton; los refrescos posteriores
  // (tras guardar) son silenciosos para no desmontar la tabla y provocar flash.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setLoadError(null);
    apiFetch('/api/income')
      .then(async (r) => {
        if (!r.ok) {
          setRecords([]);
          setLoadError(await apiErrorMessage(r, 'No se pudo cargar el historial de ingresos.'));
          return;
        }
        const data = await r.json();
        setRecords(Array.isArray(data) ? data : []);
      })
      .catch(() => setLoadError('No se pudo cargar el historial de ingresos. Revisá tu conexión.'))
      .finally(() => { if (!silent) setLoading(false); });
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // ── Handlers CRUD ────────────────────────────────────────────────────────
  const handleSave = async (payload) => {
    setSaving(true);
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/income/${payload.id}` : '/api/income';
    const method = isEdit ? 'PUT' : 'POST';
    const { id: _omit, ...createBody } = payload; // no mandar id en el body del POST (#22)
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? payload : createBody),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo guardar el ingreso.'));
      const out = await res.json().catch(() => ({}));
      toast.success(isEdit ? 'Ingreso actualizado.' : 'Ingreso registrado.');
      setRecentId(out.id || payload.id || null);
      setShowForm(false);
      setEditing(null);
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
      const res = await apiFetch(`/api/income/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'No se pudo eliminar el ingreso.'));
      toast.success('Ingreso eliminado.');
      setRecords(prev => prev.filter(r => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = (record) => { setEditing(record); setShowForm(true); };
  const startCreate = () => { setEditing(null); setShowForm(true); };
  const cancel = () => { setShowForm(false); setEditing(null); };

  // ── Búsqueda global (page-level). AuroraDataTable hace el filtro por columna
  //    y el orden sobre este subconjunto ya buscado. ─────────────────────────
  const searchedData = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.trim().toLowerCase();
    return records.filter(r => [r.buyerName, r.loteNombre, r.unit, r.currency, r.collectionStatus]
      .some(v => v && String(v).toLowerCase().includes(q)));
  }, [records, searchQuery]);

  const exportCSV = useCallback(() => {
    // Anti CSV/formula injection: campos como comprador/lote/unidad son texto
    // libre del usuario. Un valor que empieza con = + - @ o tab/CR es
    // interpretado como fórmula por Excel/Sheets aun entre comillas, así que lo
    // prefijamos con comilla simple para forzar su lectura como texto.
    const escape = v => {
      const s = String(v ?? '');
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    // Insertamos "Total (CRC)" justo después de "Total": el CSV en moneda
    // original no se puede sumar mezclando CRC/USD; esta columna da el
    // equivalente normalizado que usan los stats (audit #14).
    const headerCells = [];
    COLUMNS.forEach(c => {
      headerCells.push(escape(c.label));
      if (c.key === 'total') headerCells.push(escape('Total (CRC)'));
    });
    const rows = displayRef.current.map(r => {
      const cells = [];
      COLUMNS.forEach(col => {
        cells.push(escape(csvCellValue(r, col.key)));
        if (col.key === 'total') cells.push(escape(r.totalAmountCRC ?? r.totalAmount ?? ''));
      });
      return cells;
    });
    const csv = [headerCells, ...rows].map(row => row.join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ingresos_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // ── Stats bar (renderSummary). Agrega en CRC vía totalAmountCRC y refleja
  //    búsqueda + filtros de columna (recibe la data ya filtrada). ───────────
  const renderSummary = (rows) => {
    const totalPendiente = rows
      .filter(r => r.collectionStatus === 'pendiente')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    const totalCobrado = rows
      .filter(r => r.collectionStatus === 'cobrado')
      .reduce((s, r) => s + (Number(r.totalAmountCRC) || Number(r.totalAmount) || 0), 0);
    return (
      <div className="sh-stats-bar">
        <div className="sh-stat">
          <span className="sh-stat-value">{rows.length}</span>
          <span className="sh-stat-label">Registros</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{formatMoney(totalPendiente)}</span>
          <span className="sh-stat-label">Pendiente (CRC)</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value sh-stat-green">{formatMoney(totalCobrado)}</span>
          <span className="sh-stat-label">Cobrado (CRC)</span>
        </div>
      </div>
    );
  };

  // ── Celdas de cada fila (AuroraDataTable provee thead/sort/filtros/col-menu) ─
  const renderRow = (r, vis) => {
    const pill = STATUS_BADGE_VARIANT[r.collectionStatus] || STATUS_BADGE_VARIANT.pendiente;
    const dispCount = dispatchCount(r);
    const isForeignCurrency = r.currency && r.currency !== 'CRC' && r.totalAmountCRC != null;
    return (
      <>
        {vis.fecha     && <td className="td-readonly">{formatShortDate(r.date)}</td>}
        {vis.comprador && <td>{r.buyerName || '—'}</td>}
        {vis.lote      && <td>{r.loteNombre || '—'}</td>}
        {vis.despachos && <td className="aur-td-num">{dispCount || '—'}</td>}
        {vis.cantidad  && <td className="aur-td-num">{formatNumber(r.quantity)}</td>}
        {vis.unidad    && <td>{r.unit || '—'}</td>}
        {vis.precio    && <td className="aur-td-num">{formatPrice(r.unitPrice)}</td>}
        {vis.total     && (
          <td
            className="aur-td-num td-calc"
            title={isForeignCurrency ? `≈ ${formatMoney(r.totalAmountCRC)}` : undefined}
          >
            {formatMoney(r.totalAmount, r.currency)}
          </td>
        )}
        {vis.moneda    && <td>{r.currency || '—'}</td>}
        {vis.estado    && <td><span className={`aur-badge ${pill.cls}`}>{pill.label}</span></td>}
        {vis.fespera   && <td className="td-readonly">{formatShortDate(r.expectedCollectionDate)}</td>}
        {vis.fcobro    && <td className="td-readonly">{formatShortDate(r.actualCollectionDate)}</td>}
      </>
    );
  };

  // Columna de acciones (kebab) — va como trailingCell del data-table.
  const trailingCell = (r) => (
    <td>
      <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
        <button
          className="hist-kebab-btn aur-touch-target"
          title="Más acciones"
          aria-label={`Acciones para el ingreso de ${r.buyerName || 'comprador'}`}
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
        icon={<FiDollarSign />}
        title="Ingresos"
        actions={!showForm && (
          <button className="aur-btn-pill" onClick={startCreate}>
            <FiPlus /> Nuevo ingreso
          </button>
        )}
      />

      {showForm && (
        <IncomeForm
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
          <AuroraSkeleton variant="row" count={6} label="Cargando ingresos…" />
        ) : records.length === 0 ? (
          <div className="siembra-empty-state">
            <FiDollarSign size={36} />
            <p>Aún no hay ingresos registrados.</p>
            <button className="aur-btn-pill" onClick={startCreate}>
              <FiPlus /> Registrar primer ingreso
            </button>
          </div>
        ) : (
          <>
            {/* ── Búsqueda global ────────────────────────────────────── */}
            <div className="fin-search-wrap">
              <FiSearch size={14} className="fin-search-icon" />
              <input
                className="fin-search-input"
                aria-label="Buscar ingresos"
                placeholder="Buscar por comprador, lote, estado…"
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
              initialSort={{ field: 'fecha', dir: 'desc' }}
              firstClickDir="desc"
              visibleCols={visibleColsMap}
              onToggleVisibleCol={toggleColumn}
              rowKey={(r) => r.id}
              renderRow={renderRow}
              rowClassName={(r) => [
                r.collectionStatus === 'anulado' ? 'row-inactive' : '',
                r.id === recentId ? 'row-recent' : '',
              ].filter(Boolean).join(' ')}
              tableClassName="fin-historial-table"
              trailingHead={<th aria-hidden="true" />}
              trailingCell={trailingCell}
              renderSummary={renderSummary}
              onDisplayDataChange={(d) => { displayRef.current = d; }}
              resultLabel={(f) => (f === records.length ? `${records.length} registros` : `${f} de ${records.length} registros`)}
              emptyText="No hay registros con los filtros aplicados."
              emptyIcon={FiDollarSign}
              toolbarActions={
                <>
                  <button
                    className={`fin-table-btn${isCompact ? ' is-active' : ''}`}
                    onClick={() => setMode(isCompact ? 'full' : 'compact')}
                    title={isCompact ? `Mostrar las ${COLUMNS.length} columnas` : 'Mostrar sólo Fecha · Comprador · Lote · Total · Estado'}
                  >
                    <FiLayout size={11} />
                    {isCompact ? `Mostrar todas (${COLUMNS.length} cols)` : 'Vista compacta'}
                  </button>
                  <button className="fin-table-btn" onClick={exportCSV} title="Exportar CSV">
                    <FiDownload size={11} /> CSV
                  </button>
                </>
              }
            />
          </>
        )
      )}

      {/* ── Kebab dropdown ──────────────────────────────────────────── */}
      {rowMenu !== null && (() => {
        const r = records.find(x => x.id === rowMenu);
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
          title="Eliminar ingreso"
          body={
            `Vas a eliminar el ingreso de ${confirmDelete.buyerName || 'comprador sin nombre'} ` +
            `por ${formatMoney(confirmDelete.totalAmount, confirmDelete.currency)} ` +
            `del ${formatShortDate(confirmDelete.date)}` +
            `${confirmDelete.loteNombre ? ` · lote ${confirmDelete.loteNombre}` : ''}. ` +
            'Esta acción no se puede deshacer.'
          }
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default IncomeRecords;
