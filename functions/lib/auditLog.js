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

  // User management
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',
  USER_ROLE_CHANGE: 'user.role.change',
  USER_RESTRICTED_TO_CHANGE: 'user.restrictedTo.change',
  USER_ACCESS_GRANT: 'user.access.grant',
  USER_ACCESS_REVOKE: 'user.access.revoke',
  USER_PLANILLA_GRANT: 'user.planilla.grant',
  USER_PLANILLA_REVOKE: 'user.planilla.revoke',

  // Security signals
  PROMPT_INJECTION_DETECTED: 'security.prompt_injection.detected',
  TOKEN_REJECTED: 'security.token.rejected',

  // High-value business operations — logged only where "who+when" has
  // forensic or recovery value. Routine creates/updates are intentionally
  // not audited to keep the stream focused on security + money + loss.
  PRODUCTO_DELETE: 'producto.delete',
  LOTE_DELETE: 'lote.delete',
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
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  PURCHASE_RECEIPT: 'purchase.receipt',
  PURCHASE_RECEIPT_VOID: 'purchase.receipt.void',
  INCOME_CREATE: 'income.create',
  INCOME_DELETE: 'income.delete',

  // Task operations that change ownership, timing, or stock — routine
  // creation is not audited (too noisy), but these three are.
  TASK_COMPLETE: 'task.complete',
  TASK_RESCHEDULE: 'task.reschedule',
  TASK_REASSIGN: 'task.reassign',

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
