import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FiShield, FiFilter, FiRefreshCw, FiChevronDown, FiChevronRight,
  FiAlertTriangle, FiAlertCircle, FiInfo, FiClock, FiUser, FiX,
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
  { value: 'autopilot.pause',               label: 'Autopilot pausado' },
  { value: 'autopilot.resume',              label: 'Autopilot reanudado' },
  { value: 'autopilot.config.update',       label: 'Autopilot — config cambiada' },
  { value: 'autopilot.action.approve',      label: 'Autopilot — acción aprobada' },
  { value: 'autopilot.action.reject',       label: 'Autopilot — acción rechazada' },
  { value: 'autopilot.action.rollback',     label: 'Autopilot — rollback aplicado' },
  { value: 'autopilot.guardrail.auto_apply', label: 'Autopilot — guardrail auto-aplicado' },
  { value: 'autopilot.chain.execute',       label: 'Autopilot — cadena ejecutada' },
  { value: 'autopilot.chain.abort',         label: 'Autopilot — cadena abortada' },
];

const ACTION_LABEL = Object.fromEntries(ACTION_OPTIONS.filter(o => o.value).map(o => [o.value, o.label]));

const SEVERITY_OPTIONS = [
  { value: '',         label: 'Todas' },
  { value: 'info',     label: 'Info' },
  { value: 'warning',  label: 'Advertencia' },
  { value: 'critical', label: 'Crítico' },
];

const SEVERITY_META = {
  info:     { Icon: FiInfo,           label: 'Info' },
  warning:  { Icon: FiAlertTriangle,  label: 'Advertencia' },
  critical: { Icon: FiAlertCircle,    label: 'Crítico' },
};

const SEVERITY_BADGE_VARIANT = {
  info:     'aur-badge--blue',
  warning:  'aur-badge--yellow',
  critical: 'aur-badge--magenta',
};

const LIMIT_OPTIONS = [50, 100, 250, 500];

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

  if (loading) {
    return <div className="aur-page-loading" />;
  }

  if (events.length === 0 && !hasFilters) {
    return (
      <>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <div className="aur-sheet aur-sheet--empty">
          <div className="audit-empty">
            <FiShield size={36} />
            <p>No hay eventos registrados todavía.</p>
            <p className="audit-empty-hint">
              Los eventos aparecen aquí cuando se crean usuarios, se cambian roles o el sistema detecta actividad sospechosa.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Registro de auditoría</h2>
            <p className="aur-sheet-subtitle">
              Eventos críticos del sistema: creaciones, cambios de rol, autopilot y seguridad.
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={fetchEvents}
              disabled={loading}
            >
              <FiRefreshCw size={13} className={loading ? 'audit-spin' : ''} />
              Actualizar
            </button>
          </div>
        </header>

        <section className="aur-section">
          <div className="aur-section-header">
            <h3>Filtros</h3>
            {hasFilters && (
              <div className="aur-section-actions">
                <button type="button" className="aur-chip aur-chip--ghost" onClick={resetFilters}>
                  <FiX size={11} /> Limpiar
                </button>
              </div>
            )}
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="audit-action">
                <FiFilter size={12} /> Acción
              </label>
              <select
                id="audit-action"
                className="aur-select"
                value={filterAction}
                onChange={e => setFilterAction(e.target.value)}
              >
                {ACTION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="audit-severity">Severidad</label>
              <select
                id="audit-severity"
                className="aur-select"
                value={filterSeverity}
                onChange={e => setFilterSeverity(e.target.value)}
              >
                {SEVERITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="audit-since">Desde</label>
              <input
                id="audit-since"
                type="date"
                className="aur-input"
                value={filterSince}
                onChange={e => setFilterSince(e.target.value)}
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="audit-until">Hasta</label>
              <input
                id="audit-until"
                type="date"
                className="aur-input"
                value={filterUntil}
                onChange={e => setFilterUntil(e.target.value)}
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="audit-limit">Límite</label>
              <select
                id="audit-limit"
                className="aur-select"
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
              >
                {LIMIT_OPTIONS.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="aur-section">
          <div className="aur-section-header">
            <h3>Eventos</h3>
            <span className="aur-section-count">{events.length}</span>
          </div>

          {events.length === 0 ? (
            <p className="audit-no-matches">Ningún evento coincide con los filtros.</p>
          ) : (
            <ul className="audit-event-list">
              {events.map(ev => {
                const sev = SEVERITY_META[ev.severity] || SEVERITY_META.info;
                const SevIcon = sev.Icon;
                const isOpen = expanded.has(ev.id);
                const actionLabel = ACTION_LABEL[ev.action] || ev.action;
                const targetStr = formatTarget(ev.target);
                const badgeVariant = SEVERITY_BADGE_VARIANT[ev.severity] || 'aur-badge--gray';

                return (
                  <li key={ev.id} className={`audit-event audit-event--${ev.severity || 'info'}`}>
                    <button
                      type="button"
                      className="audit-event-header"
                      onClick={() => toggleExpand(ev.id)}
                      aria-expanded={isOpen}
                    >
                      <span className={`aur-badge ${badgeVariant}`} title={sev.label}>
                        <SevIcon size={11} /> {sev.label}
                      </span>
                      <span className="audit-event-time">
                        <FiClock size={12} />
                        {formatTimestamp(ev.timestamp)}
                      </span>
                      <span className="audit-event-action">{actionLabel}</span>
                      <span className="audit-event-actor">
                        <FiUser size={12} />
                        {ev.actorEmail || ev.actorUid || 'sistema'}
                        {ev.actorRole && <span className="audit-event-role">· {ev.actorRole}</span>}
                      </span>
                      {targetStr && <span className="audit-event-target">{targetStr}</span>}
                      <span className="audit-event-chevron">
                        {isOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="audit-event-body">
                        <MetadataRow metadata={ev.metadata} />
                        <div className="audit-event-ids">
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

          {events.length >= limit && (
            <p className="audit-limit-hint">
              Se muestran los {events.length} eventos más recientes. Ajusta los filtros o aumenta el límite para ver más.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

export default AuditEvents;
