// Summary inline para el card de auditoría: a partir del metadata real que
// escribe el backend (ver call sites de writeAuditEvent en functions/routes/*),
// derivamos UNA línea legible que responde "qué cambió" sin obligar al admin
// a expandir el evento. El MetadataRow crudo sigue disponible al expandir,
// para forense profundo; esto es el at-a-glance.
//
// Reglas:
//   · Si la acción no está mapeada, devolvemos null y el card cae al render
//     normal (sin línea de resumen).
//   · Cada renderer recibe (metadata, target) y devuelve un React node o null.
//   · El patrón "from → to" se centraliza en <Diff/> para que role.change,
//     task.reschedule, task.reassign, grupo.package.change compartan layout.
//
// Cuando agregues una acción nueva al backend con metadata estructurada,
// agregá su renderer acá si vale la pena tener resumen en línea.

import { FiArrowRight } from 'react-icons/fi';

function Diff({ from, to }) {
  return (
    <span className="audit-event-diff">
      <span className="audit-diff-from">{formatValue(from)}</span>
      <FiArrowRight size={11} aria-hidden="true" />
      <span className="audit-diff-to">{formatValue(to)}</span>
    </span>
  );
}

function formatValue(v) {
  if (v == null || v === '') return '∅';
  if (Array.isArray(v)) return v.length === 0 ? '∅' : v.join(', ');
  if (typeof v === 'number') return v.toLocaleString('es-CR');
  return String(v);
}

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  const n = Number(amount);
  const fmt = n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${fmt}` : fmt;
}

function formatDate(v) {
  if (!v) return '∅';
  // El backend manda fechas ISO o YYYY-MM-DD según la acción; mostramos
  // dd/mm/yyyy abreviado para que entre en una línea.
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-CR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const SUMMARIZERS = {
  // ── Usuarios ──────────────────────────────────────────────────────────────
  'user.role.change': (m) => (
    <>
      {m?.email && <span className="audit-event-subject">{m.email}</span>}
      <Diff from={m?.from} to={m?.to} />
      {m?.escalating && <span className="audit-event-flag">escalación</span>}
    </>
  ),
  'user.restrictedTo.change': (m) => (
    <>
      {m?.email && <span className="audit-event-subject">{m.email}</span>}
      <Diff from={m?.from} to={m?.to} />
    </>
  ),
  'user.access.grant': (m) => (
    <>
      {m?.email && <span className="audit-event-subject">{m.email}</span>}
      {m?.rol && <span>rol: {m.rol}</span>}
      {m?.previouslyHadAccess && <span className="audit-event-flag">re-otorgado</span>}
    </>
  ),
  'user.access.revoke': (m) => (
    <>
      {m?.email && <span className="audit-event-subject">{m.email}</span>}
      {m?.previousRol && <span>rol previo: {m.previousRol}</span>}
      {m?.stillEmpleado && <span className="audit-event-flag">sigue en planilla</span>}
    </>
  ),

  // ── Tareas ────────────────────────────────────────────────────────────────
  'task.reschedule': (m) => (
    <>
      {m?.activityName && <span className="audit-event-subject">{m.activityName}</span>}
      <Diff from={formatDate(m?.from)} to={formatDate(m?.to)} />
    </>
  ),
  'task.reassign': (m) => (
    <>
      {m?.activityName && <span className="audit-event-subject">{m.activityName}</span>}
      <Diff from={m?.from} to={m?.to} />
    </>
  ),
  'task.complete': (m) => (
    <>
      {m?.activityName && <span className="audit-event-subject">{m.activityName}</span>}
      {m?.activityType && <span>tipo: {m.activityType}</span>}
      {typeof m?.productosCount === 'number' && <span>{m.productosCount} productos</span>}
    </>
  ),
  'task.skip': (m) => (
    <>
      {m?.activityName && <span className="audit-event-subject">{m.activityName}</span>}
      {m?.previousStatus && <span>antes: {m.previousStatus}</span>}
    </>
  ),

  // ── Stock / recursos ──────────────────────────────────────────────────────
  'producto.delete': (m) => (
    <>
      {m?.nombreComercial && <span className="audit-event-subject">{m.nombreComercial}</span>}
      {m?.idProducto && <span>id: {m.idProducto}</span>}
      {m?.tipo && <span>tipo: {m.tipo}</span>}
    </>
  ),
  'lote.delete': (m) => (
    <>
      {m?.nombreLote && <span className="audit-event-subject">{m.nombreLote}</span>}
      {m?.codigoLote && <span>cód: {m.codigoLote}</span>}
      {typeof m?.tasksDeleted === 'number' && <span>{m.tasksDeleted} tareas eliminadas</span>}
    </>
  ),
  'stock.adjust': (m) => (
    <>
      {typeof m?.ajustesCount === 'number' && (
        <span className="audit-event-subject">{m.ajustesCount} ítems</span>
      )}
      {typeof m?.totalDelta === 'number' && (
        <span>Δ {m.totalDelta > 0 ? '+' : ''}{m.totalDelta}</span>
      )}
      {m?.nota && <span className="audit-event-note">«{m.nota}»</span>}
    </>
  ),

  // ── Siembras / grupos ─────────────────────────────────────────────────────
  'siembra.block.close': (m) => (
    <>
      {m?.loteNombre && <span className="audit-event-subject">{m.loteNombre}</span>}
      {m?.bloque != null && <span>bloque: {m.bloque}</span>}
      {m?.via && <span>vía: {m.via}</span>}
    </>
  ),
  'grupo.package.change': (m) => (
    <>
      {m?.nombreGrupo && <span className="audit-event-subject">{m.nombreGrupo}</span>}
      {m?.packageChange && (
        <Diff from={m.packageChange.from} to={m.packageChange.to} />
      )}
      {m?.muestreoPackageChange && !m?.packageChange && (
        <Diff from={m.muestreoPackageChange.from} to={m.muestreoPackageChange.to} />
      )}
    </>
  ),

  // ── Cédulas de aplicación ─────────────────────────────────────────────────
  'cedula.apply': (m) => (
    <>
      {m?.consecutivo && <span className="audit-event-subject">#{m.consecutivo}</span>}
      {m?.activityName && <span>{m.activityName}</span>}
      {m?.areaHa != null && <span>{m.areaHa} ha</span>}
      {typeof m?.productosCount === 'number' && <span>{m.productosCount} productos</span>}
    </>
  ),
  'cedula.edit': (m) => (
    <>
      {m?.consecutivo && <span className="audit-event-subject">#{m.consecutivo}</span>}
      {typeof m?.productosCount === 'number' && <span>{m.productosCount} productos</span>}
      <span className="audit-event-flag">{m?.huboCambios ? 'con cambios' : 'sin cambios'}</span>
    </>
  ),
  'cedula.void': (m) => (
    <>
      {m?.consecutivo && <span className="audit-event-subject">#{m.consecutivo}</span>}
      {m?.previousStatus && <span>antes: {m.previousStatus}</span>}
      {typeof m?.reversalCount === 'number' && <span>{m.reversalCount} productos revertidos</span>}
      {m?.context && <span className="audit-event-note">«{m.context}»</span>}
    </>
  ),

  // ── Planilla / compras / ingresos ─────────────────────────────────────────
  'payroll.pay': (m) => (
    <>
      {m?.consecutivo && <span className="audit-event-subject">#{m.consecutivo}</span>}
      {m?.encargadoNombre && <span>{m.encargadoNombre}</span>}
      {m?.totalGeneral != null && <span>{formatMoney(m.totalGeneral, 'CRC')}</span>}
      {typeof m?.trabajadoresCount === 'number' && <span>{m.trabajadoresCount} trabajadores</span>}
    </>
  ),
  'purchase.receipt': (m) => (
    <>
      {m?.proveedor && <span className="audit-event-subject">{m.proveedor}</span>}
      {m?.poNumber && <span>OC: {m.poNumber}</span>}
      {typeof m?.itemsCount === 'number' && <span>{m.itemsCount} ítems</span>}
    </>
  ),
  'income.create': (m) => (
    <>
      {m?.buyerName && <span className="audit-event-subject">{m.buyerName}</span>}
      {m?.amount != null && <span>{formatMoney(m.amount, m?.currency)}</span>}
      {m?.date && <span>{formatDate(m.date)}</span>}
    </>
  ),

  // ── Autopilot ─────────────────────────────────────────────────────────────
  'autopilot.pause': (m) => m?.reason ? (
    <span className="audit-event-note">«{m.reason}»</span>
  ) : null,
  'autopilot.action.rollback': (m) => m?.rollbackResult ? (
    <span>resultado: {String(m.rollbackResult)}</span>
  ) : null,
};

/**
 * Devuelve un React node con el resumen forense del evento, o null si no
 * hay summarizer para esa acción (o el metadata no aporta info legible).
 */
export function summarizeAuditEvent(event) {
  if (!event || !event.action) return null;
  const renderer = SUMMARIZERS[event.action];
  if (!renderer) return null;
  return renderer(event.metadata || {}, event.target || null);
}
