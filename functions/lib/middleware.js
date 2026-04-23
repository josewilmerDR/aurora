const { admin, db } = require('./firebase');
const { sendApiError, ERROR_CODES } = require('./errors');
const { checkModuleAccess } = require('./moduleMap');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('./auditLog');

// Auth model: Firebase ID token verification + per-finca membership check.
//
// Two middlewares:
//   authenticate     — token + membership in req.fincaId. Default for /api/*.
//   authenticateOnly — token only. Used by pre-finca endpoints (registration,
//                      membership claim, listing memberships).
//
// Forward-compatibility: we reject tokens whose email is explicitly NOT
// verified. Google OAuth always sets email_verified=true, so this is a no-op
// today but blocks any future auth provider that lets users register with an
// unverified address.
//
// Revocation: we pass `checkRevoked=true` to verifyIdToken. This costs one
// extra Admin-SDK RPC per authenticated request (~50–100ms latency) but lets
// us honour Firebase Auth revocation — when a user is disabled in the Auth
// console or admin.auth().revokeRefreshTokens(uid) is called, active tokens
// stop working on the next hit. Without this flag, revocation had no effect
// until the natural token expiry (~1h).

function rejectUnverifiedEmail(decoded) {
  // If the token carries an email, it must be verified. Tokens without an
  // email (some identity providers) are allowed through because rejecting
  // them here would break legitimate flows.
  if (decoded.email && decoded.email_verified === false) {
    return 'Email address is not verified.';
  }
  return null;
}

// ── Token rejection audit + sampling ─────────────────────────────────────────
// Emit security.token.rejected events for *interesting* failures (revoked,
// disabled, tampered) without flooding audit_events if a bot hammers with
// garbage tokens. Sampling bucket: (code, ip) per hour, kept in an in-memory
// Map. Running across multiple Cloud Functions instances produces at most
// one event per (instance, code, ip, hour) — perfectly adequate for the
// abuse-detection use case.
const REJECTION_SAMPLE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SAMPLE_ENTRIES = 1000;
const rejectionSeen = new Map();

function shouldLogRejection(key) {
  const now = Date.now();
  if (rejectionSeen.size > MAX_SAMPLE_ENTRIES) {
    for (const [k, exp] of rejectionSeen) if (exp < now) rejectionSeen.delete(k);
  }
  const existing = rejectionSeen.get(key);
  if (existing && existing > now) return false;
  rejectionSeen.set(key, now + REJECTION_SAMPLE_WINDOW_MS);
  return true;
}

// Decode a JWT payload *without* verifying the signature — safe for audit
// metadata because we treat the result as untrusted. For revoked/disabled
// tokens the signature actually did verify, so the claims are authentic.
function unverifiedPayload(token) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Expired tokens are the normal state of a long-idle user — not a signal.
// Everything else (revoked, disabled, malformed, tampered) is worth surfacing.
const IGNORED_REJECTION_CODES = new Set([
  'auth/id-token-expired',
]);

function auditTokenRejection(req, error, token) {
  const code = error?.code || 'unknown';
  if (IGNORED_REJECTION_CODES.has(code)) return;

  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const sampleKey = `${code}__${ip}`;
  if (!shouldLogRejection(sampleKey)) return;

  const payload = unverifiedPayload(token);
  writeAuditEvent({
    fincaId: null,
    actor: payload
      ? { uid: payload.user_id || payload.uid || null, email: payload.email || null, role: null }
      : null,
    action: ACTIONS.TOKEN_REJECTED,
    metadata: {
      code,
      message: String(error?.message || '').slice(0, 200),
      ip: String(ip).slice(0, 64),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      path: req.path,
    },
    severity: SEVERITY.WARNING,
  });
}

// ── Middlewares ──────────────────────────────────────────────────────────────
// Verifies the Firebase ID Token and the user's membership in the requested finca.
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const fincaId = req.headers['x-finca-id'];

  if (!authHeader?.startsWith('Bearer ') || !fincaId) {
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Missing auth token or finca header.', 401);
  }

  const token = authHeader.split('Bearer ')[1];
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token, true);
  } catch (error) {
    console.error('[AUTH] Invalid token:', error.code || error.message);
    auditTokenRejection(req, error, token);
    return sendApiError(res, ERROR_CODES.INVALID_SESSION, 'Invalid session token.', 401);
  }

  try {
    const uid = decoded.uid;

    const emailProblem = rejectUnverifiedEmail(decoded);
    if (emailProblem) {
      return sendApiError(res, ERROR_CODES.UNAUTHORIZED, emailProblem, 401);
    }

    const membershipSnap = await db.collection('memberships')
      .where('uid', '==', uid)
      .where('fincaId', '==', fincaId)
      .limit(1)
      .get();

    if (membershipSnap.empty) {
      return sendApiError(res, ERROR_CODES.NO_FINCA_ACCESS, 'User is not a member of the requested finca.', 403);
    }

    const membershipData = membershipSnap.docs[0].data();
    req.uid = uid;
    req.userEmail = decoded.email || '';
    req.fincaId = fincaId;
    req.userRole = membershipData.rol;

    // Module restriction (Ruta A of custom-roles design). When a membership
    // pins the user to one or more modules, every request path must either be
    // public or belong to an allowed module. Unmapped paths fall back to
    // "allow + warn" until moduleMap.js is flipped to STRICT.
    const restrictedTo = Array.isArray(membershipData.restrictedTo)
      ? membershipData.restrictedTo
      : null;
    req.userRestrictedTo = restrictedTo;
    if (restrictedTo && restrictedTo.length > 0) {
      const decision = checkModuleAccess(req.path, restrictedTo);
      if (decision === 'deny') {
        console.warn('[restrictedTo] deny', uid, req.method, req.path, 'allowed=', restrictedTo);
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'You do not have access to this module.', 403);
      }
    }

    next();
  } catch (error) {
    console.error('[AUTH] Membership / module check failed:', error.message);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to resolve session.', 500);
  }
};

// Token-only middleware (does not verify finca membership) — used by auth endpoints.
const authenticateOnly = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Missing auth token.', 401);
  }
  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token, true);

    const emailProblem = rejectUnverifiedEmail(decoded);
    if (emailProblem) {
      return sendApiError(res, ERROR_CODES.UNAUTHORIZED, emailProblem, 401);
    }

    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.warn('[AUTH] authenticateOnly failed:', err?.code || err?.message || err);
    auditTokenRejection(req, err, token);
    return sendApiError(res, ERROR_CODES.INVALID_SESSION, 'Invalid session token.', 401);
  }
};

module.exports = { authenticate, authenticateOnly };
