// Audit log — writes immutable records of security-relevant events to
// Firestore for forensic review and admin dashboards.
//
// Design:
//   - Always fail-open. Audit logging must never break the primary request
//     flow; a Firestore write error here is logged and swallowed.
//   - Actor normalization. Accepts either a raw Express `req` (most common
//     call site) or an explicit `{uid, email, role}` object. The former is
//     convenient inside route handlers that already have req bound; the
//     latter is for background jobs / cron tasks with no request context.
//   - Action naming. Dot-separated noun.verb-style strings (`user.role.change`,
//     `security.prompt_injection.detected`). Prefixes let downstream
//     dashboards filter by domain (`user.*`, `security.*`).
//   - Severity is explicit rather than inferred per-action, so a single
//     ACTION can be logged at different severities by different callers
//     (e.g. a claim that creates a pre-existing membership is `info`, but a
//     claim that grants `administrador` role is `warning`).
//
// Schema (Firestore collection `audit_events`):
//   fincaId:    string | null   — tenancy key (null for pre-finca events)
//   actorUid:   string | null   — Firebase UID of the caller, null if system
//   actorEmail: string | null   — email captured at event time
//   actorRole:  string | null   — role at event time (may differ from now)
//   action:     string          — dotted identifier (see ACTIONS)
//   target:     { type, id }    — subject of the action (optional)
//   metadata:   object          — free-form context (old/new values, etc.)
//   severity:   'info' | 'warning' | 'critical'
//   timestamp:  Firestore Timestamp

const { db, Timestamp } = require('./firebase');

// Retention for audit events. After this many days the Firestore TTL policy
// (configured on the `expireAt` field in Google Cloud Console) deletes the
// doc automatically. Long enough for forensic reviews and compliance,
// short enough that the collection does not grow unboundedly.
const AUDIT_TTL_DAYS = 365;

const ACTIONS = Object.freeze({
  // Multi-tenant lifecycle
  FINCA_CREATE: 'finca.create',
  MEMBERSHIP_CLAIM: 'membership.claim',

  // Finca configuration. Privileged, admin-only mutation that touches legal/
  // fiscal identity, the logo embedded in every PDF, and the cultivation
  // parameters (días de desarrollo, kg/planta, mortalidad…) that feed harvest
  // projections and KPIs across ALL grupos. A bad write silently degrades the
  // whole platform's numbers, so "who+when+what changed" has forensic value.
  CONFIG_UPDATE: 'config.update',

  // User management
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role.change',
  // A users doc's auth uid was re-pointed during invitation claim (the email
  // had previously been linked to a different account, then re-claimed by a
  // new one). This is a security-relevant identity change, so it is audited
  // even though the claiming token's email is verified.
  USER_UID_REBIND: 'user.uid.rebind',
  USER_RESTRICTED_TO_CHANGE: 'user.restrictedTo.change',
  USER_ACCESS_GRANT: 'user.access.grant',
  USER_ACCESS_REVOKE: 'user.access.revoke',
  USER_PLANILLA_GRANT: 'user.planilla.grant',
  USER_PLANILLA_REVOKE: 'user.planilla.revoke',

  // Security signals
  PROMPT_INJECTION_DETECTED: 'security.prompt_injection.detected',
  TOKEN_REJECTED: 'security.token.rejected',
  // Exfiltración masiva: cuando un admin descarga el CSV del registro forense.
  // El CSV puede contener IPs, emails, montos, vendor names — su salida del
  // sistema debe quedar registrada (qué filtros, cuántos eventos, cuándo).
  AUDIT_EXPORT: 'audit.export',

  // High-value business operations — logged only where "who+when" has
  // forensic or recovery value. Routine creates/updates are intentionally
  // not audited to keep the stream focused on security + money + loss.
  PRODUCTO_DELETE: 'producto.delete',
  // Unidades de medida. Solo DELETE: es irreversible y rompe referencias por
  // nombre (productos con la unidad asignada + otras unidades que la usan como
  // unidadBase, sin cascada). Forensic: quién la borró y qué nombre tenía. Los
  // renames son reversibles → fuera del audit, alineado con la política del archivo.
  UNIDAD_MEDIDA_DELETE: 'unidad_medida.delete',
  LOTE_DELETE: 'lote.delete',
  // Grupos. Mismo criterio que lote/siembra: solo DELETE (irreversible, libera
  // bloques al pool y borra cedulas/tasks pendientes) y cambios destructivos
  // en UPDATE (paqueteId/fechaCreacion/paqueteMuestreoId, que wipean las
  // scheduled_tasks completas del grupo y regeneran desde cero). Los creates
  // y los renames quedan fuera del audit log alineado con la política del archivo.
  GRUPO_DELETE: 'grupo.delete',
  GRUPO_PACKAGE_CHANGE: 'grupo.package.change',
  // Paquetes de aplicaciones. DELETE rompe referencias en lotes/grupos
  // (forensic: quién lo borró, qué nombre tenía, cuántas actividades se
  // perdieron). Archive/unarchive son reversibles pero merecen rastro porque
  // condicionan qué paquetes aparecen al asignar a nuevos lotes/grupos.
  PACKAGE_DELETE: 'package.delete',
  PACKAGE_ARCHIVE: 'package.archive',
  PACKAGE_UNARCHIVE: 'package.unarchive',
  SIEMBRA_DELETE: 'siembra.delete',
  SIEMBRA_BLOCK_REOPEN: 'siembra.block.reopen',
  // Symmetric with REOPEN — emitted whenever a (lote, bloque) transitions
  // to closed, regardless of which endpoint did it (POST single, POST /bulk
  // cascade, PUT cerrado:true). Forensically valuable because once closed,
  // a bloque rejects further POSTs and shapes downstream harvest planning.
  SIEMBRA_BLOCK_CLOSE: 'siembra.block.close',
  // AI vision call that reads a physical sowing form. Audited because it
  // typically precedes a bulk save and gives "who scanned what when"
  // visibility on top of the per-user rate-limit accounting.
  SIEMBRA_SCAN: 'siembra.scan',
  MATERIAL_SIEMBRA_UPDATE: 'material_siembra.update',
  MATERIAL_SIEMBRA_DELETE: 'material_siembra.delete',
  STOCK_ADJUST: 'stock.adjust',
  PAYROLL_PAY: 'payroll.pay',
  // Ficha laboral. Solo el cambio de salario/precio-hora queda auditado: es la
  // base monetaria de la nómina (forensic: quién lo cambió, sobre qué trabajador
  // y de cuánto a cuánto). El resto de la ficha (puesto, horario, contacto,
  // notas) es edición rutinaria y queda fuera, alineado con la política del archivo.
  HR_FICHA_SALARY_CHANGE: 'hr.ficha.salary.change',
  // Asistencia diaria. Solo DELETE queda auditado: borrar un registro de
  // asistencia es irreversible y altera la base de cálculo de nómina del
  // trabajador (días/horas extra). Forensic: quién lo borró y de qué doc
  // determinista (`${trabajadorId}_${fecha}`). El batch upsert es reversible
  // por sobre-escritura y queda fuera, alineado con la política del archivo.
  ASISTENCIA_DELETE: 'asistencia.delete',
  // Permisos / vacaciones. DECISION (aprobar/rechazar) y DELETE quedan
  // auditados: aprobar un permiso lo vuelve efectivo y descuenta/justifica
  // nómina; rechazar o borrar revierte ese efecto. Forensic: quién decidió/
  // borró, sobre qué trabajador y a qué estado. El create (pendiente) es
  // reversible y queda fuera, alineado con la política del archivo.
  PERMISO_DECISION: 'permiso.decision',
  PERMISO_DELETE: 'permiso.delete',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  PURCHASE_RECEIPT: 'purchase.receipt',
  PURCHASE_RECEIPT_VOID: 'purchase.receipt.void',
  INCOME_CREATE: 'income.create',
  // UPDATE de un ingreso cambia montos, comprador o el estado/fecha de cobro de
  // un registro financiero — forensicamente relevante igual que budget.update
  // (va como INFO). Las lecturas no se auditan.
  INCOME_UPDATE: 'income.update',
  INCOME_DELETE: 'income.delete',
  // Compradores (buyers). Solo DELETE: es un borrado duro irreversible que
  // elimina términos de crédito + PII de contacto y deja huérfanas las
  // referencias desde ingresos ya registrados a su nombre. Create/update y el
  // toggle de estado quedan fuera del audit, alineado con la política del archivo.
  BUYER_DELETE: 'buyer.delete',
  // Cosecha. Solo las operaciones destructivas/irreversibles quedan auditadas,
  // alineado con la política del archivo. DISPATCH_VOID: anular un despacho
  // libera sus boletas y lo saca de la justificación de ingresos (rompe el
  // vínculo ingreso↔cosecha) → WARNING. RECORD_DELETE: borrar un registro de
  // cosecha es irreversible y elimina una boleta que pudo alimentar despachos
  // → WARNING. Creates/updates rutinarios no se auditan.
  COSECHA_DISPATCH_VOID: 'cosecha.dispatch.void',
  COSECHA_RECORD_DELETE: 'cosecha.record.delete',
  // Presupuestos. Mutaciones de la configuración financiera de la finca:
  // definen el techo de gasto por categoría/período contra el que se mide la
  // ejecución. CREATE/UPDATE van como INFO; DELETE como WARNING porque es
  // irreversible y borra el punto de comparación del período. Forensic:
  // quién cambió el presupuesto, de qué categoría/período y por cuánto.
  BUDGET_CREATE: 'budget.create',
  BUDGET_UPDATE: 'budget.update',
  BUDGET_DELETE: 'budget.delete',
  // Centro de Costos. Solo los DELETE quedan auditados: borrar un costo
  // indirecto o un snapshot es irreversible y distorsiona los agregados de
  // costo/ROI de toda la finca (los snapshots son la base de comparación
  // histórica). Creates/updates van fuera del audit, alineado con la política.
  COSTO_INDIRECTO_DELETE: 'costo_indirecto.delete',
  COSTO_SNAPSHOT_DELETE: 'costo_snapshot.delete',

  // Tesorería. El saldo de caja (`cash_balance`) es la base de TODA la
  // proyección de liquidez de la finca. CREATE va como INFO (fija el punto de
  // arranque); DELETE como WARNING porque es un borrado duro irreversible que
  // cambia la proyección de liquidez y borra junto al doc su autoría
  // (createdBy/createdByEmail) — sin este rastro no hay forense de quién/cuándo
  // manipuló el saldo. Mismo criterio que INCOME_DELETE / COSTO_SNAPSHOT_DELETE.
  CASH_BALANCE_CREATE: 'cash_balance.create',
  CASH_BALANCE_DELETE: 'cash_balance.delete',

  // Financiamiento externo (Fase 5). Snapshot del perfil financiero: corte
  // inmutable, admin-only, que alimenta elegibilidad y simulaciones de deuda
  // — "quién generó qué corte" tiene valor forense (va como INFO). Los DELETE
  // de catálogo de crédito y de simulaciones son borrados duros e
  // irreversibles → WARNING. Listas/lecturas no se auditan (ruido sin valor).
  // EXPORT del snapshot: saca del sistema el estado financiero completo
  // (balance, resultados, flujo) + el email del autor en un documento
  // bank-presentable. Mismo criterio que AUDIT_EXPORT del CSV forense: su
  // salida debe quedar registrada (quién, qué corte, en qué formato). INFO.
  FINANCING_SNAPSHOT_CREATE: 'financing.snapshot.create',
  FINANCING_SNAPSHOT_EXPORT: 'financing.snapshot.export',
  FINANCING_CREDIT_PRODUCT_DELETE: 'financing.credit_product.delete',
  FINANCING_DEBT_SIMULATION_DELETE: 'financing.debt_simulation.delete',

  // Task operations that change ownership, timing, or stock — routine
  // creation is not audited (too noisy), but these four are.
  TASK_COMPLETE: 'task.complete',
  TASK_RESCHEDULE: 'task.reschedule',
  TASK_REASSIGN: 'task.reassign',
  // Skip cancela una tarea programada sin generar cédula. Para la página
  // de Cédulas equivale a "Omitir tarea". Forensicamente relevante porque
  // significa que una aplicación planificada (potencialmente regulatoria)
  // no se ejecutó — quién y cuándo lo decidió tiene que quedar.
  TASK_SKIP: 'task.skip',

  // Cédulas de aplicación — todas las mutaciones quedan auditadas porque
  // este es el documento auditable de aplicación de agroquímicos: lleva
  // dosis, hectáreas, operario, condiciones, periodos de carencia/reingreso.
  // El trail completo (quién generó, quién preparó la mezcla, quién aplicó
  // en campo, quién anuló) sostiene la compliance regulatoria y permite
  // forense ante una disputa de inventario o un reclamo de residuos.
  // GENERATE/MANUAL_CREATE/MIX_READY/EDIT/APPLY van como INFO; VOID como
  // WARNING porque revierte inventario y cancela un registro regulatorio.
  CEDULA_GENERATE: 'cedula.generate',
  CEDULA_MANUAL_CREATE: 'cedula.manual_create',
  CEDULA_MIX_READY: 'cedula.mix_ready',
  CEDULA_EDIT: 'cedula.edit',
  CEDULA_APPLY: 'cedula.apply',
  CEDULA_VOID: 'cedula.void',

  // Autopilot / CEO agent — state-changing or autonomous decisions. Propose
  // stages are NOT audited: they're approved-or-rejected downstream and that
  // is where the trail lives. Cron sweeps / orchestrator ticks also not
  // audited (too noisy, no forensic value individually).
  AUTOPILOT_PAUSE: 'autopilot.pause',
  AUTOPILOT_RESUME: 'autopilot.resume',
  AUTOPILOT_CONFIG_UPDATE: 'autopilot.config.update',
  AUTOPILOT_ACTION_APPROVE: 'autopilot.action.approve',
  AUTOPILOT_ACTION_REJECT: 'autopilot.action.reject',
  AUTOPILOT_ACTION_ROLLBACK: 'autopilot.action.rollback',
  AUTOPILOT_GUARDRAIL_AUTO_APPLY: 'autopilot.guardrail.auto_apply',
  AUTOPILOT_CHAIN_EXECUTE: 'autopilot.chain.execute',
  AUTOPILOT_CHAIN_ABORT: 'autopilot.chain.abort',
});

const SEVERITY = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
});

// Extract actor fields from a raw Express req OR from an explicit object. The
// req form is preferred in route handlers because it captures role/email as
// they were at authentication time, not as they may have changed mid-request.
function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') return { uid: null, email: null, role: null };
  // Request objects carry these under req.uid / req.userEmail / req.userRole.
  const uid   = actor.uid ?? actor.actorUid ?? null;
  const email = actor.userEmail ?? actor.email ?? null;
  const role  = actor.userRole ?? actor.role ?? null;
  return { uid, email, role };
}

async function writeAuditEvent({
  fincaId = null,
  actor = null,
  action,
  target = null,
  metadata = null,
  severity = SEVERITY.INFO,
} = {}) {
  try {
    if (!action || typeof action !== 'string') {
      console.warn('[auditLog] refusing to write event with missing action');
      return;
    }
    const { uid, email, role } = normalizeActor(actor);

    const nowMs = Date.now();
    const expireAtMs = nowMs + AUDIT_TTL_DAYS * 24 * 60 * 60 * 1000;

    await db.collection('audit_events').add({
      fincaId,
      actorUid: uid,
      actorEmail: email,
      actorRole: role,
      action,
      target: target || null,
      metadata: metadata || {},
      severity,
      timestamp: Timestamp.fromMillis(nowMs),
      // Consumed by the Firestore TTL policy on audit_events.expireAt.
      // See docs/security-hardening.md for the console setup step.
      expireAt: Timestamp.fromMillis(expireAtMs),
    });
  } catch (err) {
    // Fail-open: never propagate to the caller. The primary request should
    // not fail because observability failed.
    console.error('[auditLog] write failed', action, err?.message || err);
  }
}

module.exports = { writeAuditEvent, ACTIONS, SEVERITY };
