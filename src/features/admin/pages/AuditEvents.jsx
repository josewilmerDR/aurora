import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiShield, FiFilter, FiRefreshCw, FiChevronDown, FiChevronRight,
  FiAlertTriangle, FiAlertCircle, FiInfo, FiClock, FiUser,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/audit-events.css';

// Ordered so the filter dropdown matches the natural grouping in auditLog.js.
// Adding a new action to the backend ACTIONS constant requires a matching row
// here so the filter chip renders the Spanish label instead of the raw key.
const ACTION_OPTIONS = [
  { value: '',                              label: 'Todas las acciones' },
  { value: 'finca.create',                  label: 'Creación de finca' },
  { value: 'membership.claim',              label: 'Reclamación de membresía' },
  { value: 'user.create',                   label: 'Creación de usuario' },
  { value: 'user.update',                   label: 'Actualización de usuario' },
  { value: 'user.delete',                   label: 'Eliminación de usuario' },
  { value: 'user.role.change',              label: 'Cambio de rol' },
  { value: 'user.restrictedTo.change',      label: 'Cambio de restricciones' },
  { value: 'security.prompt_injection.detected', label: 'Inyección de prompt' },
  { value: 'security.token.rejected',       label: 'Token rechazado' },
  { value: 'producto.delete',               label: 'Eliminación de producto' },
  { value: 'lote.delete',                   label: 'Eliminación de lote' },
  { value: 'stock.adjust',                  label: 'Ajuste manual de stock' },
  { value: 'payroll.pay',                   label: 'Pago de planilla' },
  { value: 'purchase_order.create',         label: 'Orden de compra creada' },
  { value: 'purchase.receipt',              label: 'Recepción de mercancía' },
  { value: 'income.create',                 label: 'Ingreso registrado' },
  { value: 'income.delete',                 label: 'Ingreso eliminado' },
];

const ACTION_LABEL = Object.fromEntries(ACTION_OPTIONS.filter(o => o.value).map(o => [o.value, o.label]));

const SEVERITY_OPTIONS = [
  { value: '',         label: 'Todas' },
  { value: 'info',     label: 'Info' },
  { value: 'warning',  label: 'Advertencia' },
  { value: 'critical', label: 'Crítico' },
];

// Map severity → icon + accent class for the row indicator.
const SEVERITY_META = {
  info:     { Icon: FiInfo,           cls: 'audit-sev--info',     label: 'Info' },
  warning:  { Icon: FiAlertTriangle,  cls: 'audit-sev--warning',  label: 'Advertencia' },
  critical: { Icon: FiAlertCircle,    cls: 'audit-sev--critical', label: 'Crítico' },
};

function formatTimestamp(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTarget(target) {
  if (!target || typeof target !== 'object') return null;
  const { type, id } = target;
  if (!type && !id) return null;
  return `${type || 'obj'}: ${id || '—'}`;
}

function MetadataRow({ metadata }) {
  const entries = metadata && typeof metadata === 'object' ? Object.entries(metadata) : [];
  if (entries.length === 0) {
    return <div className="audit-meta-empty">Sin metadatos adicionales.</div>;
  }
  return (
    <dl className="audit-meta-grid">
      {entries.map(([k, v]) => (
        <div key={k} className="audit-meta-item">
          <dt>{k}</dt>
          <dd>
            {typeof v === 'object'
              ? <pre>{JSON.stringify(v, null, 2)}</pre>
              : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AuditEvents() {
  const apiFetch = useApiFetch();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const [filterAction, setFilterAction] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterSince, setFilterSince] = useState('');
  const [filterUntil, setFilterUntil] = useState('');
  const [limit, setLimit] = useState(100);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filterAction)   params.set('action', filterAction);
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterSince)    params.set('since', filterSince);
    if (filterUntil)    params.set('until', filterUntil);
    params.set('limit', String(limit));
    return params.toString();
  }, [filterAction, filterSeverity, filterSince, filterUntil, limit]);

  const fetchEvents = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/audit/events?${queryString}`)
      .then(r => {
        if (r.status === 403) throw new Error('forbidden');
        if (!r.ok) throw new Error('fetch_failed');
        return r.json();
      })
      .then(data => setEvents(Array.isArray(data) ? data : []))
      .catch(err => {
        if (err.message === 'forbidden') {
          showToast('Solo administradores pueden leer el registro de auditoría.', 'error');
        } else {
          showToast('Error al cargar el registro de auditoría.', 'error');
        }
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, [apiFetch, queryString]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const resetFilters = () => {
    setFilterAction('');
    setFilterSeverity('');
    setFilterSince('');
    setFilterUntil('');
    setLimit(100);
  };

  const hasFilters = filterAction || filterSeverity || filterSince || filterUntil || limit !== 100;

  return (
    <div className="audit-page-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="audit-header">
        <div className="audit-header-title">
          <FiShield size={18} />
          <h2>Registro de auditoría</h2>
        </div>
        <button className="btn btn-secondary audit-refresh-btn" onClick={fetchEvents} disabled={loading}>
          <FiRefreshCw size={14} className={loading ? 'audit-spin' : ''} />
          Actualizar
        </button>
      </div>

      <div className="audit-filters">
        <div className="audit-filter-item">
          <label><FiFilter size={12} /> Acción</label>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)}>
            {ACTION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="audit-filter-item">
          <label>Severidad</label>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
            {SEVERITY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="audit-filter-item">
          <label>Desde</label>
          <input type="date" value={filterSince} onChange={e => setFilterSince(e.target.value)} />
        </div>
        <div className="audit-filter-item">
          <label>Hasta</label>
          <input type="date" value={filterUntil} onChange={e => setFilterUntil(e.target.value)} />
        </div>
        <div className="audit-filter-item audit-filter-item--narrow">
          <label>Límite</label>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
          </select>
        </div>
        {hasFilters && (
          <button className="audit-reset-btn" onClick={resetFilters}>
            Limpiar
          </button>
        )}
      </div>

      {loading ? (
        <div className="audit-loading" />
      ) : events.length === 0 ? (
        <div className="audit-empty">
          <FiShield size={32} />
          <p>{hasFilters ? 'Ningún evento coincide con los filtros.' : 'No hay eventos registrados todavía.'}</p>
          {!hasFilters && (
            <p className="audit-empty-hint">
              Los eventos aparecen aquí cuando se crean usuarios, se cambian roles o el sistema detecta actividad sospechosa.
            </p>
          )}
        </div>
      ) : (
        <ul className="audit-list">
          {events.map(ev => {
            const sev = SEVERITY_META[ev.severity] || SEVERITY_META.info;
            const SevIcon = sev.Icon;
            const isOpen = expanded.has(ev.id);
            const actionLabel = ACTION_LABEL[ev.action] || ev.action;
            const targetStr = formatTarget(ev.target);

            return (
              <li key={ev.id} className={`audit-row ${sev.cls}`}>
                <button
                  className="audit-row-header"
                  onClick={() => toggleExpand(ev.id)}
                  aria-expanded={isOpen}
                >
                  <span className="audit-row-sev" title={sev.label}>
                    <SevIcon size={14} />
                  </span>
                  <span className="audit-row-time">
                    <FiClock size={12} />
                    {formatTimestamp(ev.timestamp)}
                  </span>
                  <span className="audit-row-action">{actionLabel}</span>
                  <span className="audit-row-actor">
                    <FiUser size={12} />
                    {ev.actorEmail || ev.actorUid || 'sistema'}
                    {ev.actorRole && <span className="audit-row-role">· {ev.actorRole}</span>}
                  </span>
                  {targetStr && <span className="audit-row-target">{targetStr}</span>}
                  <span className="audit-row-chevron">
                    {isOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                  </span>
                </button>
                {isOpen && (
                  <div className="audit-row-body">
                    <MetadataRow metadata={ev.metadata} />
                    <div className="audit-row-ids">
                      <span>ID evento: <code>{ev.id}</code></span>
                      {ev.fincaId && <span>Finca: <code>{ev.fincaId}</code></span>}
                      {ev.actorUid && <span>UID: <code>{ev.actorUid}</code></span>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && events.length >= limit && (
        <p className="audit-limit-hint">
          Se muestran los {events.length} eventos más recientes. Ajusta los filtros o aumenta el límite para ver más.
        </p>
      )}
    </div>
  );
}

export default AuditEvents;
