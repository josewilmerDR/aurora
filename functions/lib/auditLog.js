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

  // Security signals
  PROMPT_INJECTION_DETECTED: 'security.prompt_injection.detected',
  TOKEN_REJECTED: 'security.token.rejected',

  // High-value business operations — logged only where "who+when" has
  // forensic or recovery value. Routine creates/updates are intentionally
  // not audited to keep the stream focused on security + money + loss.
  PRODUCTO_DELETE: 'producto.delete',
  LOTE_DELETE: 'lote.delete',
  STOCK_ADJUST: 'stock.adjust',
  PAYROLL_PAY: 'payroll.pay',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  PURCHASE_RECEIPT: 'purchase.receipt',
  INCOME_CREATE: 'income.create',
  INCOME_DELETE: 'income.delete',
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
