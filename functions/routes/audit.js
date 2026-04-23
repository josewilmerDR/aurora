const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// GET /api/audit/events — admin-only query over audit_events.
//
// Query params (all optional):
//   action    — exact action string (e.g. 'user.role.change')
//   severity  — info | warning | critical
//   since     — YYYY-MM-DD, inclusive
//   until     — YYYY-MM-DD, inclusive (end of day)
//   limit     — max rows (default 100, cap 500)
//
// Indexing: the simple (fincaId, timestamp desc) composite already exists via
// the default auto-index. Filter combinations are applied best-effort via the
// query API; callers hitting a missing-index error will see the Firebase
// console link in logs and can wire the composite then.

router.get('/api/audit/events', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrators can read audit events.', 403);
  }

  try {
    const { action, severity, since, until } = req.query;
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100, 500);

    let query = db.collection('audit_events').where('fincaId', '==', req.fincaId);
    if (action)   query = query.where('action', '==', action);
    if (severity) query = query.where('severity', '==', severity);
    if (since)    query = query.where('timestamp', '>=', Timestamp.fromDate(new Date(since + 'T00:00:00')));
    if (until)    query = query.where('timestamp', '<=', Timestamp.fromDate(new Date(until + 'T23:59:59')));
    query = query.orderBy('timestamp', 'desc').limit(limit);

    const snap = await query.get();
    const events = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        timestamp: data.timestamp?.toDate().toISOString() || null,
      };
    });
    res.status(200).json(events);
  } catch (err) {
    console.error('[audit:list]', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch audit events.', 500);
  }
});

module.exports = router;
