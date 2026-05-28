const { Router } = require('express');
const { z } = require('zod');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { hasMinRoleBE } = require('../lib/helpers');
const { rateLimit } = require('../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');

const router = Router();

// GET /api/audit/events — admin-only query over audit_events.
//
// Query params (all optional):
//   action    — dotted lowercase identifier (e.g. 'user.role.change')
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

// Zod query schema. Whitelist enforcement (action regex, severity enum) cierra
// la puerta a strings arbitrarios que llegaban directo a Firestore .where(),
// y `coerce` normaliza limit cuando Express lo entrega como string. Las fechas
// se parsean a Date acá; el handler las convierte a Timestamp solo si pasan.
//
// `.passthrough()` no se usa: cualquier query key inesperada se ignora — la
// página solo envía las claves listadas, así que un extra es señal de tampering
// y no merece roundtrip al backend.
const ACTION_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const dateString = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'Invalid date.',
  });

// Firestore doc IDs son alfanuméricos + algunos signos; el SDK los genera con
// 20 chars [A-Za-z0-9]. Damos margen y aceptamos 1-128 chars del subset seguro.
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const querySchema = z.object({
  action:   z.string().max(64).regex(ACTION_RE).optional(),
  severity: z.enum([SEVERITY.INFO, SEVERITY.WARNING, SEVERITY.CRITICAL]).optional(),
  since:    dateString.optional(),
  until:    dateString.optional(),
  after:    dateString.optional(),
  afterId:  z.string().regex(DOC_ID_RE).optional(),
  limit:    z.coerce.number().int().positive().max(500).default(100),
});

// Whitelist explícito de campos serializados al cliente. Antes hacíamos
// `...data` y todo el doc se filtraba — agregar un campo sensible a
// audit_events lo habría leakeado automáticamente. Esta lista es el contrato
// público del audit log: si querés exponer algo nuevo, agrégalo acá a propósito.
function serializeEvent(d) {
  const data = d.data();
  return {
    id: d.id,
    fincaId: data.fincaId ?? null,
    action: data.action,
    severity: data.severity,
    target: data.target ?? null,
    metadata: data.metadata ?? {},
    actorUid: data.actorUid ?? null,
    actorEmail: data.actorEmail ?? null,
    actorRole: data.actorRole ?? null,
    timestamp: data.timestamp?.toDate().toISOString() ?? null,
  };
}

router.get(
  '/api/audit/events',
  authenticate,
  // Rate limit aunque sea admin-only: un token comprometido podría paginar
  // todo audit_events (500 reads × N páginas) facturablemente. `public_read`
  // (60/min, 1000/día) es holgado para uso humano y corta el abuso.
  rateLimit('audit_read', 'public_read'),
  async (req, res) => {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrators can read audit events.', 403);
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid audit query parameters.', 400);
    }
    const { action, severity, since, until, after, afterId, limit } = parsed.data;

    try {
      let query = db.collection('audit_events').where('fincaId', '==', req.fincaId);
      if (action)   query = query.where('action', '==', action);
      if (severity) query = query.where('severity', '==', severity);
      if (since) query = query.where('timestamp', '>=', Timestamp.fromDate(new Date(since)));
      if (until) query = query.where('timestamp', '<=', Timestamp.fromDate(new Date(until)));
      query = query.orderBy('timestamp', 'desc');
      // Cursor de paginación. Preferimos DocumentSnapshot cuando viene afterId
      // porque rompe empates por __name__ implícito — un cursor solo-timestamp
      // pierde docs adyacentes que comparten timestamp con el cursor (raro
      // pero posible: batch writes, cron sweeps). Si solo viene `after`,
      // fallback al cursor por valor para mantener compatibilidad.
      if (afterId) {
        const cursorDoc = await db.collection('audit_events').doc(afterId).get();
        if (cursorDoc.exists && cursorDoc.get('fincaId') === req.fincaId) {
          query = query.startAfter(cursorDoc);
        }
      } else if (after) {
        query = query.startAfter(Timestamp.fromDate(new Date(after)));
      }
      query = query.limit(limit);

      const snap = await query.get();
      res.status(200).json(snap.docs.map(serializeEvent));
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
  },
);

// POST /api/audit/exports — registra que un admin exfiltró el CSV.
//
// El CSV se genera client-side a partir de los eventos ya cargados; lo único
// que el backend ve es esta llamada de "notificación". Forensicamente vale: si
// un admin con credenciales comprometidas descarga el log completo, queda
// rastro de quién lo hizo, con qué filtros y cuántas filas. Best-effort desde
// el cliente: si falla, el CSV igual se descarga (no bloquear UX por audit).
const exportBodySchema = z.object({
  count: z.coerce.number().int().min(0).max(10_000),
  filters: z.object({
    action:   z.string().max(64).regex(ACTION_RE).nullish(),
    severity: z.enum([SEVERITY.INFO, SEVERITY.WARNING, SEVERITY.CRITICAL]).nullish(),
    since:    z.string().max(40).nullish(),
    until:    z.string().max(40).nullish(),
  }).optional().default({}),
});

router.post(
  '/api/audit/exports',
  authenticate,
  rateLimit('audit_export', 'write'),
  async (req, res) => {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrators can export audit events.', 403);
    }

    const parsed = exportBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Invalid audit export payload.', 400);
    }
    const { count, filters } = parsed.data;

    // writeAuditEvent es fail-open (no throws). La respuesta 204 no le promete
    // al cliente que el evento se persistió, solo que el endpoint lo aceptó.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.AUDIT_EXPORT,
      target: { type: 'collection', id: 'audit_events' },
      metadata: {
        count,
        action: filters.action ?? null,
        severity: filters.severity ?? null,
        since: filters.since ?? null,
        until: filters.until ?? null,
      },
      severity: SEVERITY.WARNING,
    });
    res.status(204).end();
  },
);

module.exports = router;
