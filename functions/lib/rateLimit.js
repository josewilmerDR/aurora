// Firestore-backed per-user rate limiter.
//
// Why Firestore: Cloud Functions Gen 2 scales to multiple instances, so an
// in-memory counter is not authoritative across cold starts or parallel
// invocations. Firestore transactions give atomic increments across
// instances without requiring extra infrastructure (no Redis, no
// Memorystore). Cost: one read + one write per protected request —
// negligible next to the Claude/Twilio spend we are trying to cap.
//
// Design: fixed-window counters. Each doc holds (bucket, count) pairs for
// two windows — one minute, one day. Fixed windows lose precision at
// boundaries but are cheaper than sliding windows and sufficient for abuse
// prevention at Aurora's scale.
//
// Fail-open: if the Firestore call throws (transient error, concurrency,
// etc.) we log and continue. A temporary infra glitch should not lock out
// a legitimate user; App Check + per-endpoint Claude timeouts catch the
// worst-case cost damage anyway.
//
// Key shape: `${uid}__${bucketKey}` — per-user, per-bucket. A bucket groups
// endpoints with similar cost profile (e.g. 'ai_heavy' for chat + autopilot
// analyze). Users who hit the same bucket share their budget.

const { db, Timestamp } = require('./firebase');
const { sendApiError, ERROR_CODES } = require('./errors');

// After this many days without any activity the doc is eligible for TTL
// deletion. The expireAt is re-written on every check so an active user's
// doc never becomes stale; only abandoned (uid, bucket) pairs get cleaned up.
const RATE_LIMIT_TTL_DAYS = 30;

// Preset tiers. Add new tiers rather than editing these in place, so
// endpoints that depend on a preset do not shift limits silently.
const LIMITS = {
  // Full Claude conversations and autopilot reasoning: bounded tightly
  // because each call may consume tens of thousands of tokens.
  ai_heavy:  { perMinute: 20,  perDay: 300  },
  // Single-shot Claude vision calls (invoice scan, sowing form scan).
  ai_medium: { perMinute: 15,  perDay: 200  },
  // Lighter AI-assisted endpoints (product classification, monitoreo
  // summaries, horimeter image parsing).
  ai_light:  { perMinute: 30,  perDay: 500  },
  // Non-AI write endpoints that could still be spammed.
  write:     { perMinute: 120, perDay: 5000 },
  // Write endpoints that fan out to paid external services (Twilio
  // WhatsApp, SendGrid, etc.). One abused call = one billable message.
  notify:    { perMinute: 10,  perDay: 100  },
  // Public/unauthenticated GETs keyed by IP instead of uid. Tighter than
  // 'write' because anyone on the internet can hit them.
  public_read: { perMinute: 60, perDay: 1000 },
};

// Fixed-window counter update. Returns { ok, retryAfter }. Fail-open — a
// transaction error resolves as { ok: true } so a Firestore hiccup does not
// cascade into a user-visible outage.
async function checkRateLimit(uid, bucketKey, limits) {
  if (!uid) return { ok: true };
  const ref = db.collection('rate_limits').doc(`${uid}__${bucketKey}`);
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const dayBucket    = Math.floor(now / 86_400_000);

  try {
    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      let minuteCount = 0;
      let dayCount = 0;
      if (doc.exists) {
        const d = doc.data();
        if (d.minuteBucket === minuteBucket) minuteCount = d.minuteCount || 0;
        if (d.dayBucket === dayBucket)       dayCount    = d.dayCount    || 0;
      }

      if (minuteCount >= limits.perMinute) {
        const retryAfter = 60 - Math.floor((now % 60_000) / 1000);
        return { ok: false, reason: 'minute', retryAfter };
      }
      if (dayCount >= limits.perDay) {
        const retryAfter = 86400 - Math.floor((now % 86_400_000) / 1000);
        return { ok: false, reason: 'day', retryAfter };
      }

      tx.set(ref, {
        uid,
        bucketKey,
        minuteBucket,
        minuteCount: minuteCount + 1,
        dayBucket,
        dayCount: dayCount + 1,
        updatedAt: now,
        // Consumed by the Firestore TTL policy on rate_limits.expireAt. Re-
        // written on every check, so active users never expire; only
        // abandoned (uid, bucket) pairs get cleaned up after
        // RATE_LIMIT_TTL_DAYS of inactivity.
        expireAt: Timestamp.fromMillis(now + RATE_LIMIT_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
      return { ok: true };
    });
  } catch (err) {
    console.error('[rateLimit] transaction failed — failing open', err?.message || err);
    return { ok: true };
  }
}

// Express middleware factory. Use after `authenticate` so req.uid is set.
// Example:
//   router.post('/api/chat', authenticate, rateLimit('chat', 'ai_heavy'), handler)
function rateLimit(bucketKey, tier) {
  const limits = typeof tier === 'string' ? LIMITS[tier] : tier;
  if (!limits) throw new Error(`rateLimit: unknown tier "${tier}"`);

  return async (req, res, next) => {
    const result = await checkRateLimit(req.uid, bucketKey, limits);
    if (!result.ok) {
      res.set('Retry-After', String(Math.max(1, result.retryAfter || 60)));
      console.warn('[rateLimit] blocked',
        req.uid, bucketKey, result.reason, 'retryAfter', result.retryAfter);
      return sendApiError(
        res,
        ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded (${result.reason}). Try again in ${result.retryAfter || 60}s.`,
        429,
      );
    }
    next();
  };
}

// Variant keyed by client IP, for endpoints that accept unauthenticated
// traffic (e.g. the public deep-link GET /api/tasks/:id). Uses the same
// Firestore-backed counter; the doc ID is `ip__<bucketKey>` instead of
// `uid__<bucketKey>`. Falls back to 'unknown' when Cloud Run strips the IP.
function rateLimitByIp(bucketKey, tier) {
  const limits = typeof tier === 'string' ? LIMITS[tier] : tier;
  if (!limits) throw new Error(`rateLimitByIp: unknown tier "${tier}"`);

  return async (req, res, next) => {
    const raw = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    // x-forwarded-for may be a CSV; the first entry is the origin client.
    const ip = String(raw).split(',')[0].trim().slice(0, 64) || 'unknown';
    const result = await checkRateLimit(`ip_${ip}`, bucketKey, limits);
    if (!result.ok) {
      res.set('Retry-After', String(Math.max(1, result.retryAfter || 60)));
      console.warn('[rateLimit] blocked by ip',
        ip, bucketKey, result.reason, 'retryAfter', result.retryAfter);
      return sendApiError(
        res,
        ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded (${result.reason}). Try again in ${result.retryAfter || 60}s.`,
        429,
      );
    }
    next();
  };
}

module.exports = { rateLimit, rateLimitByIp, checkRateLimit, LIMITS };
