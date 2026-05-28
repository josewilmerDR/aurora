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
//   since     — ISO timestamp (preferred) or YYYY-MM-DD. The UI sends ISO with
//               the user's TZ offset baked in (local midnight) so the filter
//               respects the user's day boundaries, not the server's UTC day.
//               Bare YYYY-MM-DD is still accepted for backwards compat and
//               parsed as UTC midnight by `new Date()`.
//   until     — same shape as `since`. UI sends end-of-day in user TZ.
//   after     — ISO timestamp cursor (the timestamp of the last event in the
//               previous page). Used together with the same filters to paginate
//               backwards in time. Implemented via Firestore `startAfter`.
//   limit     — max rows (default 100, cap 500).
//
// Indexing: composites for the realistic filter combinations live in
// firestore.indexes.json (collectionGroup: audit_events). When the user
// combines action + severity + timestamp range we need the 4-field composite
// (fincaId, action, severity, timestamp desc). If a query still misses an
// index, Firestore throws FAILED_PRECONDITION with a console URL in the
// message — we surface that as INDEX_REQUIRED instead of a vanilla 500 so the
// frontend can show a clearer message and the dev follows the link from logs.

function parseClientDate(v) {
  if (!v) return null;
  // Accepts ISO (with or without offset) or bare YYYY-MM-DD. `new Date` is
  // tolerant of both. We validate the result is a real date before using it.
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}

router.get('/api/audit/events', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'administrador')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrators can read audit events.', 403);
  }

  try {
    const { action, severity, since, until, after } = req.query;
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100, 500);

    let query = db.collection('audit_events').where('fincaId', '==', req.fincaId);
    if (action)   query = query.where('action', '==', action);
    if (severity) query = query.where('severity', '==', severity);
    const sinceTs = parseClientDate(since);
    const untilTs = parseClientDate(until);
    if (sinceTs) query = query.where('timestamp', '>=', sinceTs);
    if (untilTs) query = query.where('timestamp', '<=', untilTs);
    query = query.orderBy('timestamp', 'desc');
    // Cursor de paginación. startAfter debe ir entre orderBy y limit. El valor
    // pasado debe coincidir con el tipo del campo del orderBy — un Timestamp.
    const afterTs = parseClientDate(after);
    if (afterTs) query = query.startAfter(afterTs);
    query = query.limit(limit);

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
    // Firestore admin SDK throws gRPC FAILED_PRECONDITION (code 9) when the
    // composite index for the requested filter combo doesn't exist; the message
    // includes the console URL to create it. Surface as a distinct code so the
    // UI shows "missing index" and the dev can click the URL from logs.
    const missingIndex = err?.code === 9 || /requires an index/i.test(err?.message || '');
    if (missingIndex) {
      return sendApiError(res, 'INDEX_REQUIRED', 'Audit query needs a composite index — see the Firebase console URL in function logs.', 500);
    }
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch audit events.', 500);
  }
});

module.exports = router;
