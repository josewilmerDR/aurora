// Autopilot — Configuración por finca.
//
// Sub-archivo del split de routes/autopilot.js. Cubre los dos endpoints que
// leen y actualizan `autopilot_config`. La regla más sensible vive aquí: el
// dominio `rrhh` no admite nivel3 (decisiones sobre personas requieren
// revisión humana), y elevar `mode` a nivel3 emite un audit event CRITICAL.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

// GET /api/autopilot/config
router.get('/api/autopilot/config', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('autopilot_config').doc(req.fincaId).get();
    if (!doc.exists) {
      return res.json({ fincaId: req.fincaId, mode: 'off', objectives: '', guardrails: {} });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('[AUTOPILOT] Error al obtener config:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch Autopilot configuration.', 500);
  }
});

// PUT /api/autopilot/config  (minRole: supervisor)
router.put('/api/autopilot/config', authenticate, async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Supervisor role or higher required.', 403);
  }
  try {
    const { mode, objectives, guardrails } = req.body;
    const VALID_MODES = ['off', 'nivel1', 'nivel2', 'nivel3'];
    if (mode !== undefined && !VALID_MODES.includes(mode)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid mode.', 400);
    }
    const ref = db.collection('autopilot_config').doc(req.fincaId);
    const existing = await ref.get();
    const now = Timestamp.now();
    const payload = {
      fincaId: req.fincaId,
      ...(mode !== undefined && { mode }),
      ...(objectives !== undefined && { objectives }),
      updatedAt: now,
    };
    if (guardrails !== undefined && typeof guardrails === 'object') {
      const { ALL_ACTION_TYPES } = require('../../lib/autopilotGuardrails');
      const VALID_ACTION_TYPES = ALL_ACTION_TYPES;
      const VALID_DOMAIN_LEVELS = ['nivel1', 'nivel2', 'nivel3'];
      const VALID_HR_LEVELS = ['nivel1', 'nivel2']; // nivel3 prohibido para RRHH
      const clampInt = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
      const clampNum = (v, min, max) => Math.max(min, Math.min(max, v));
      const isHhMm = (s) => typeof s === 'string' && /^\d{1,2}:\d{2}$/.test(s);
      const g = {};
      // Session limits (existing)
      if (typeof guardrails.maxActionsPerSession === 'number') {
        g.maxActionsPerSession = clampInt(guardrails.maxActionsPerSession, 1, 50);
      }
      if (typeof guardrails.maxStockAdjustPercent === 'number') {
        g.maxStockAdjustPercent = clampInt(guardrails.maxStockAdjustPercent, 1, 100);
      }
      if (Array.isArray(guardrails.allowedActionTypes)) {
        g.allowedActionTypes = guardrails.allowedActionTypes.filter(t => VALID_ACTION_TYPES.includes(t));
      }
      if (Array.isArray(guardrails.blockedLotes)) {
        g.blockedLotes = guardrails.blockedLotes.filter(id => typeof id === 'string' && id.length > 0);
      }
      // Global limits (new in 0.4)
      if (typeof guardrails.maxActionsPerDay === 'number') {
        g.maxActionsPerDay = clampInt(guardrails.maxActionsPerDay, 1, 500);
      }
      if (typeof guardrails.maxOrdenesCompraPerDay === 'number') {
        g.maxOrdenesCompraPerDay = clampInt(guardrails.maxOrdenesCompraPerDay, 1, 100);
      }
      if (typeof guardrails.maxOrdenCompraMonto === 'number') {
        g.maxOrdenCompraMonto = clampNum(guardrails.maxOrdenCompraMonto, 0, 1e9);
      }
      if (typeof guardrails.maxOrdenesCompraMonthlyAmount === 'number') {
        g.maxOrdenesCompraMonthlyAmount = clampNum(guardrails.maxOrdenesCompraMonthlyAmount, 0, 1e9);
      }
      if (typeof guardrails.maxNotificationsPerUserPerDay === 'number') {
        g.maxNotificationsPerUserPerDay = clampInt(guardrails.maxNotificationsPerUserPerDay, 0, 100);
      }
      if (typeof guardrails.weekendActions === 'boolean') {
        g.weekendActions = guardrails.weekendActions;
      }
      if (guardrails.quietHours && typeof guardrails.quietHours === 'object') {
        const qh = {};
        if (isHhMm(guardrails.quietHours.start)) qh.start = guardrails.quietHours.start;
        if (isHhMm(guardrails.quietHours.end)) qh.end = guardrails.quietHours.end;
        if (Array.isArray(guardrails.quietHours.enforce)) {
          qh.enforce = guardrails.quietHours.enforce.filter(t => VALID_ACTION_TYPES.includes(t));
        }
        if (Object.keys(qh).length > 0) g.quietHours = qh;
      }
      // Dominios: kill switch + nivel por dominio. El dominio `rrhh` no
      // admite 'nivel3' — se rechaza el request con 400 (defensa en PUT,
      // complementaria al cap en runtime y al clamp del lib).
      if (guardrails.dominios && typeof guardrails.dominios === 'object') {
        const d = {};
        const domainNames = ['financiera', 'procurement', 'rrhh'];
        for (const name of domainNames) {
          const src = guardrails.dominios[name];
          if (!src || typeof src !== 'object') continue;
          const allowedLevels = name === 'rrhh' ? VALID_HR_LEVELS : VALID_DOMAIN_LEVELS;
          if (src.nivel !== undefined && src.nivel !== null && src.nivel !== '' && !allowedLevels.includes(src.nivel)) {
            if (name === 'rrhh' && src.nivel === 'nivel3') {
              return sendApiError(res, ERROR_CODES.INVALID_INPUT,
                'El dominio RRHH no admite nivel3. Decisiones sobre personas requieren revisión humana.', 400);
            }
            return sendApiError(res, ERROR_CODES.INVALID_INPUT, `Invalid nivel for dominio ${name}.`, 400);
          }
          const entry = {};
          if (typeof src.activo === 'boolean') entry.activo = src.activo;
          if (typeof src.nivel === 'string' && allowedLevels.includes(src.nivel)) entry.nivel = src.nivel;
          if (Object.keys(entry).length > 0) d[name] = entry;
        }
        if (Object.keys(d).length > 0) g.dominios = d;
      }
      payload.guardrails = g;
    }
    if (!existing.exists) payload.createdAt = now;
    await ref.set(payload, { merge: true });

    // Cambio de config = ajuste de "leash". El mode + guardrails determinan
    // cuánto puede hacer el autopilot sin revisión humana, así que cualquier
    // update es worth flagging. Severity = WARNING salvo cuando se sube a
    // nivel3 (lo más autónomo) → CRITICAL: relajar al nivel totalmente
    // autónomo es el dial más consecuente.
    const prevData = existing.exists ? existing.data() : {};
    const modeChanged = mode !== undefined && mode !== prevData.mode;
    const escalating = modeChanged && mode === 'nivel3';
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.AUTOPILOT_CONFIG_UPDATE,
      metadata: {
        modeFrom: prevData.mode || null,
        modeTo: mode !== undefined ? mode : prevData.mode || null,
        modeChanged,
        guardrailsChanged: guardrails !== undefined,
        objectivesChanged: objectives !== undefined,
      },
      severity: escalating ? SEVERITY.CRITICAL : SEVERITY.WARNING,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTOPILOT] Error al guardar config:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save configuration.', 500);
  }
});

module.exports = router;
