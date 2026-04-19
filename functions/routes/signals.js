// Rutas de señales externas — Fase 4.3.
//
// Superficies:
//   1. `signal_sources` CRUD — supervisor+
//   2. `external_signals` read + manual upload — supervisor+
//   3. Trigger manual de ingesta por source — supervisor+
//   4. Kill switch `external_signals_enabled` dentro de autopilot_config — supervisor+
//
// El cron (`signals-cron.js`) es el consumidor principal de esta ingesta;
// el endpoint de trigger manual existe para que el usuario pueda pedir una
// refresh on-demand (ej. al configurar una fuente nueva).

const { Router } = require('express');
const { db, Timestamp, openWeatherApiKey, alphaVantageApiKey } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE, writeFeedEvent, sendPushToFincaRoles } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { getProvider, listProviders } = require('../lib/external');
const { ingestSource } = require('../lib/strategy/signalsIngestor');

const router = Router();

const SIGNAL_TYPES = ['weather', 'commodity_price', 'fertilizer_price'];
const MAX_SOURCES_PER_FINCA = 20;
const MAX_SIGNALS_RETURNED = 500;

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Signals require supervisor+.', 403);
    return false;
  }
  return true;
}

function resolveApiKey(providerId) {
  try {
    if (providerId === 'openweathermap') return openWeatherApiKey.value() || null;
    if (providerId === 'alphavantage') return alphaVantageApiKey.value() || null;
  } catch (err) {
    // Secret unavailable (local dev sin .env.local) — devolvemos null.
    return null;
  }
  return null;
}

async function isDomainEnabled(fincaId) {
  const doc = await db.collection('autopilot_config').doc(fincaId).get();
  if (!doc.exists) return true; // default active
  // Flag opcional: si no existe, asumimos true; solo false explícito deshabilita.
  return doc.data().external_signals_enabled !== false;
}

function validateSourcePayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') return 'Payload required.';
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 64) {
      return 'name is required (≤ 64 chars).';
    }
  }
  if (!partial || body.signalType !== undefined) {
    if (!SIGNAL_TYPES.includes(body.signalType)) {
      return `signalType must be one of: ${SIGNAL_TYPES.join(', ')}.`;
    }
  }
  if (!partial || body.provider !== undefined) {
    const provider = getProvider(body.provider);
    if (!provider) return `Unknown provider "${body.provider}".`;
    if (!provider.signalTypes.includes(body.signalType || 'weather')) {
      // Esta validación se repite en PUT parcial si signalType viene junto.
    }
  }
  if (body.ingestIntervalDays !== undefined && body.ingestIntervalDays !== null) {
    const n = Number(body.ingestIntervalDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      return 'ingestIntervalDays must be integer in [1, 90].';
    }
  }
  if (body.alertThresholds !== undefined && body.alertThresholds !== null) {
    if (typeof body.alertThresholds !== 'object' || Array.isArray(body.alertThresholds)) {
      return 'alertThresholds must be an object.';
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return 'enabled must be boolean.';
  }
  return null;
}

function normalizeSourcePayload(body) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 64);
  if (body.signalType !== undefined) out.signalType = body.signalType;
  if (body.provider !== undefined) out.provider = body.provider;
  if (body.enabled !== undefined) out.enabled = !!body.enabled;
  if (body.ingestIntervalDays !== undefined) {
    out.ingestIntervalDays = Math.max(1, Math.min(90, Number(body.ingestIntervalDays) || 1));
  }
  if (body.config !== undefined) out.config = body.config || {};
  if (body.alertThresholds !== undefined) out.alertThresholds = body.alertThresholds || {};
  if (body.notas !== undefined) {
    out.notas = typeof body.notas === 'string' ? body.notas.slice(0, 512) : null;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// Providers catalog
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/signals/providers', authenticate, async (req, res) => {
  if (!requireSupervisor(req, res)) return;
  res.status(200).json(listProviders());
});

// ══════════════════════════════════════════════════════════════════════════
// Config flag (kill switch por dominio)
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/signals/config', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const doc = await db.collection('autopilot_config').doc(req.fincaId).get();
    const data = doc.exists ? doc.data() : {};
    res.status(200).json({ external_signals_enabled: data.external_signals_enabled !== false });
  } catch (error) {
    console.error('[signals] get config failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch config.', 500);
  }
});

router.put('/api/signals/config', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const enabled = req.body?.external_signals_enabled;
    if (typeof enabled !== 'boolean') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'external_signals_enabled must be boolean.', 400);
    }
    const ref = db.collection('autopilot_config').doc(req.fincaId);
    await ref.set({
      external_signals_enabled: enabled,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    res.status(200).json({ external_signals_enabled: enabled });
  } catch (error) {
    console.error('[signals] set config failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update config.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Signal sources CRUD
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/signals/sources', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('signal_sources')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.status(200).json(items);
  } catch (error) {
    console.error('[signals] list sources failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list signal sources.', 500);
  }
});

router.post('/api/signals/sources', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const allowed = ['name', 'signalType', 'provider', 'enabled', 'ingestIntervalDays', 'config', 'alertThresholds', 'notas'];
    const raw = pick(req.body, allowed);
    const vErr = validateSourcePayload(raw);
    if (vErr) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, vErr, 400);
    const provider = getProvider(raw.provider);
    if (!provider.signalTypes.includes(raw.signalType)) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        `Provider "${provider.id}" does not support signalType "${raw.signalType}".`,
        400,
      );
    }
    const configError = provider.validateConfig?.(raw.config || {});
    if (configError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, configError, 400);

    const existingCount = (await db.collection('signal_sources')
      .where('fincaId', '==', req.fincaId).get()).size;
    if (existingCount >= MAX_SOURCES_PER_FINCA) {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Max ${MAX_SOURCES_PER_FINCA} signal sources per finca reached.`,
        409,
      );
    }

    const payload = normalizeSourcePayload(raw);
    const toStore = {
      ...payload,
      enabled: payload.enabled === undefined ? true : payload.enabled,
      ingestIntervalDays: payload.ingestIntervalDays || 1,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || null,
      createdAt: Timestamp.now(),
      lastFetchedAt: null,
      lastSuccessfulFetchAt: null,
      lastError: null,
      consecutiveFailures: 0,
    };
    const ref = await db.collection('signal_sources').add(toStore);
    res.status(201).json({ id: ref.id, ...toStore });
  } catch (error) {
    console.error('[signals] create source failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create source.', 500);
  }
});

router.put('/api/signals/sources/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('signal_sources', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const allowed = ['name', 'enabled', 'ingestIntervalDays', 'config', 'alertThresholds', 'notas'];
    const raw = pick(req.body, allowed);
    const vErr = validateSourcePayload(raw, { partial: true });
    if (vErr) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, vErr, 400);

    // Si viene `config`, validamos con el provider actual (no cambiamos provider vía PUT).
    if (raw.config !== undefined) {
      const currentProvider = getProvider(ownership.doc.data().provider);
      const configError = currentProvider?.validateConfig?.(raw.config || {});
      if (configError) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, configError, 400);
    }

    const payload = normalizeSourcePayload(raw);
    const toUpdate = {
      ...payload,
      updatedBy: req.uid,
      updatedAt: Timestamp.now(),
    };
    await db.collection('signal_sources').doc(id).update(toUpdate);
    res.status(200).json({ id, ...toUpdate });
  } catch (error) {
    console.error('[signals] update source failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update source.', 500);
  }
});

router.delete('/api/signals/sources/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('signal_sources', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('signal_sources').doc(id).delete();
    res.status(200).json({ id, deleted: true });
  } catch (error) {
    console.error('[signals] delete source failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete source.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Trigger fetch manual
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/signals/sources/:id/trigger', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (!(await isDomainEnabled(req.fincaId))) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'External signals are disabled for this finca.', 423);
    }
    const { id } = req.params;
    const ownership = await verifyOwnership('signal_sources', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const sourceDoc = { id, ...ownership.doc.data() };

    const result = await ingestSource({
      sourceDoc,
      apiKeyResolver: resolveApiKey,
      executor: {
        writeFeedEvent,
        sendPush: sendPushToFincaRoles,
      },
    });
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    console.error('[signals] trigger failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to trigger fetch.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// List recent signals
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/signals', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { sourceId, signalType, since } = req.query;
    let query = db.collection('external_signals').where('fincaId', '==', req.fincaId);
    if (sourceId) query = query.where('sourceId', '==', String(sourceId));
    if (signalType && SIGNAL_TYPES.includes(String(signalType))) {
      query = query.where('signalType', '==', String(signalType));
    }
    const snap = await query.get();
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since)) {
      items = items.filter(s => (s.observedAt || '') >= since);
    }
    items.sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || ''));
    res.status(200).json(items.slice(0, MAX_SIGNALS_RETURNED));
  } catch (error) {
    console.error('[signals] list signals failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list signals.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Manual observation upload
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/signals/manual', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (!(await isDomainEnabled(req.fincaId))) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'External signals are disabled for this finca.', 423);
    }
    const manualProvider = getProvider('manual');
    let normalized;
    try {
      normalized = manualProvider.normalizeManualObservation(req.body || {});
    } catch (err) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, err.message, 400);
    }

    // Requiere un source con provider='manual' del mismo signalType. Si no
    // existe, lo creamos on-demand (una source por cada signalType manual).
    let sourceId = req.body?.sourceId;
    if (!sourceId) {
      const snap = await db.collection('signal_sources')
        .where('fincaId', '==', req.fincaId)
        .where('provider', '==', 'manual')
        .where('signalType', '==', normalized.signalType)
        .limit(1).get();
      if (!snap.empty) {
        sourceId = snap.docs[0].id;
      } else {
        const ref = await db.collection('signal_sources').add({
          fincaId: req.fincaId,
          name: `Manual ${normalized.signalType}`,
          signalType: normalized.signalType,
          provider: 'manual',
          enabled: true,
          ingestIntervalDays: 1,
          config: {},
          alertThresholds: {},
          createdBy: req.uid,
          createdByEmail: req.userEmail || null,
          createdAt: Timestamp.now(),
        });
        sourceId = ref.id;
      }
    } else {
      const ownership = await verifyOwnership('signal_sources', sourceId, req.fincaId);
      if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }

    const signalDoc = {
      fincaId: req.fincaId,
      sourceId,
      signalType: normalized.signalType,
      provider: 'manual',
      value: normalized.value,
      unit: normalized.unit,
      confidence: normalized.confidence,
      observedAt: normalized.observedAt,
      fetchedAt: Timestamp.now(),
      raw: normalized.raw,
      metadata: normalized.metadata,
      supersedes: null,
      uploadedBy: req.uid,
      uploadedByEmail: req.userEmail || null,
    };
    const ref = await db.collection('external_signals').add(signalDoc);
    res.status(201).json({ id: ref.id, sourceId, ...signalDoc });
  } catch (error) {
    console.error('[signals] manual upload failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to upload manual signal.', 500);
  }
});

module.exports = router;
