const { admin } = require('./firebase');
const { sendApiError, ERROR_CODES } = require('./errors');

// Firebase App Check verification for the public `api` Cloud Function.
//
// Purpose: ensure requests come from *our* registered web app, not from arbitrary
// clients (scripts, bots, curl). App Check does NOT replace authentication — it
// runs *before* it and gates whether the caller is a legitimate client at all.
//
// Modes (controlled by APP_CHECK_MODE env var on the Cloud Function):
//   - 'enforce' (default): reject requests with missing/invalid tokens.
//   - 'warn':              log but allow. Use this for the initial rollout so a
//                           misconfigured client does not take down the API.
//   - 'off':               skip the check entirely. Only for emergency bypass.
//
// In the Functions emulator the check is always bypassed.

const IS_EMULATOR = !!process.env.FUNCTIONS_EMULATOR;
const MODE = (process.env.APP_CHECK_MODE || 'enforce').toLowerCase();

// Paths that should never require App Check (health probes, public webhooks).
// Add here if/when we introduce legitimate third-party webhook endpoints.
const PUBLIC_PATHS = new Set([
  // e.g. '/api/_health'
]);

function shouldSkip(req) {
  if (IS_EMULATOR) return true;
  if (MODE === 'off') return true;
  if (PUBLIC_PATHS.has(req.path)) return true;
  return false;
}

async function verifyAppCheck(req, res, next) {
  if (shouldSkip(req)) return next();

  const token = req.header('X-Firebase-AppCheck');
  if (!token) {
    if (MODE === 'warn') {
      console.warn('[AppCheck] missing token', req.method, req.originalUrl);
      return next();
    }
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'App Check token required.', 401);
  }

  try {
    await admin.appCheck().verifyToken(token);
    return next();
  } catch (err) {
    if (MODE === 'warn') {
      console.warn('[AppCheck] invalid token', req.method, req.originalUrl, '-', err.message);
      return next();
    }
    return sendApiError(res, ERROR_CODES.UNAUTHORIZED, 'Invalid App Check token.', 401);
  }
}

module.exports = { verifyAppCheck, APP_CHECK_MODE: MODE };
