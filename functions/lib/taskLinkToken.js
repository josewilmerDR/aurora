// HMAC capability-URL for the public task deep-link.
//
// The `/task/:taskId` route is intentionally unauthenticated so that a
// worker can tap the WhatsApp link and see the task without logging in
// first. Without a capability check, anyone who ever obtains a taskId
// (link forwarded, referer header, device cache) can read enriched PII:
// responsible's phone, product stock, finca name.
//
// Solution: when the backend sends the link via WhatsApp, it embeds a
// short HMAC-SHA256 signature tied to `${taskId}.${exp}`. The public
// GET /api/tasks/:id endpoint verifies the signature before responding.
//
// Rollout strategy (TASK_LINK_TOKEN_MODE env var):
//   - 'off'     : skip verification entirely. Emergency bypass.
//   - 'warn'    : accept missing/invalid tokens but log them. DEFAULT —
//                 ships harmless for users who click WhatsApp links sent
//                 before this code was deployed.
//   - 'enforce' : reject missing/invalid/expired tokens with 401. Flip
//                 after ~TTL_DAYS to guarantee all active links carry
//                 a valid token.
//
// Secret: TASK_LINK_SECRET (Firebase Functions secret). If unset, sign()
// returns null (no signature added) and verify() treats the token as
// "cannot verify" — effectively identical to warn mode regardless of
// the env var. This keeps the feature safe to deploy before the secret
// is populated.

const crypto = require('crypto');
const { taskLinkSecret } = require('./firebase');

const TTL_DAYS = 14;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

// Read the secret without blowing up if it's unset. defineSecret().value()
// throws when the secret isn't bound to the function; we want graceful
// degradation instead.
function readSecret() {
  try {
    const v = taskLinkSecret.value();
    return v && v.length >= 16 ? v : null;
  } catch {
    return null;
  }
}

// Returns a token string `${exp}.${sig}` (base64url) or null if the
// secret is unavailable. Callers that can't sign fall back to sending
// an un-tokened link, which the verifier accepts in warn mode.
function signTaskLink(taskId) {
  const secret = readSecret();
  if (!secret || !taskId) return null;
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = crypto.createHmac('sha256', secret)
    .update(`${taskId}.${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

const MODE = (process.env.TASK_LINK_TOKEN_MODE || 'warn').toLowerCase();

// Returns { ok: boolean, reason?: string, mode: 'off'|'warn'|'enforce' }.
// In warn/off the verifier never fails the request — the handler decides
// what to do with a "cannot verify" result. In enforce, the handler is
// expected to 401 on ok=false.
function verifyTaskLink(taskId, token) {
  if (MODE === 'off') return { ok: true, mode: MODE };

  if (!token) return { ok: false, reason: 'missing', mode: MODE };

  const parts = String(token).split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed', mode: MODE };
  const [expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'malformed', mode: MODE };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired', mode: MODE };

  const secret = readSecret();
  if (!secret) return { ok: false, reason: 'secret_unset', mode: MODE };

  const expected = crypto.createHmac('sha256', secret)
    .update(`${taskId}.${exp}`)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: 'invalid', mode: MODE };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid', mode: MODE };

  return { ok: true, mode: MODE };
}

module.exports = {
  signTaskLink,
  verifyTaskLink,
  TASK_LINK_MODE: MODE,
  TASK_LINK_TTL_DAYS: TTL_DAYS,
};
