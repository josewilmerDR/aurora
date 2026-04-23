const { admin, db } = require('./firebase');
const { sendApiError, ERROR_CODES } = require('./errors');

// Auth model: Firebase ID token verification + per-finca membership check.
//
// Two middlewares:
//   authenticate     — token + membership in req.fincaId. Default for /api/*.
//   authenticateOnly — token only. Used by pre-finca endpoints (registration,
//                      membership claim, listing memberships).
//
// Forward-compatibility: we reject tokens whose email is explicitly NOT verified.
// Google OAuth always sets email_verified=true, so this is a no-op today but
// blocks any future auth provider that lets users register with an unverified
// address.

function rejectUnverifiedEmail(decoded) {
  // If the token carries an email, it must be verified. Tokens without an
  // email (some identity providers) are allowed through because rejecting
  // them here would break legitimate flows.
  if (decoded.email && decoded.email_verified === false) {
    return 'Email address is not verified.';
  }
  return null;
}

// Verifies the Firebase ID Token and the user's membership in the requested finca.
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const fincaId = req.headers['x-finca-id'];

  if (!authHeader?.startsWith('Bearer ') || !fincaId) {
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Missing auth token or finca header.', 401);
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
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

    req.uid = uid;
    req.userEmail = decoded.email || '';
    req.fincaId = fincaId;
    req.userRole = membershipSnap.docs[0].data().rol;
    next();
  } catch (error) {
    console.error('[AUTH] Invalid token:', error.message);
    return sendApiError(res, ERROR_CODES.INVALID_SESSION, 'Invalid session token.', 401);
  }
};

// Token-only middleware (does not verify finca membership) — used by auth endpoints.
const authenticateOnly = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Missing auth token.', 401);
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);

    const emailProblem = rejectUnverifiedEmail(decoded);
    if (emailProblem) {
      return sendApiError(res, ERROR_CODES.UNAUTHORIZED, emailProblem, 401);
    }

    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.warn('[AUTH] authenticateOnly failed:', err?.message || err);
    return sendApiError(res, ERROR_CODES.INVALID_SESSION, 'Invalid session token.', 401);
  }
};

module.exports = { authenticate, authenticateOnly };
