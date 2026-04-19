// Ingestor de señales externas — orquesta fetch + persistencia + alertas.
//
// Puntos clave:
//   - Dedup por (fincaId, sourceId, observedAt): si ya hay una señal con la
//     misma fecha observada, la más reciente la reemplaza lógicamente pero
//     NO se sobre-escribe: external_signals es append-only, así que
//     guardamos igual (con `supersedes` al id previo) para preservar historial.
//     Excepción: si la misma hora (misma `fetchedAt` redondeada al minuto),
//     dedupamos para no inflar el almacenamiento cuando el cron corre por
//     duplicado.
//   - Por cada señal nueva corre el detector de alertas; cada alerta se
//     persiste como `feed_event` y (best-effort) como push a supervisores.
//   - Actualiza `signal_sources.lastFetchedAt`, `lastSuccessfulFetchAt`,
//     `lastError`, `consecutiveFailures` después de cada intento.
//
// La orquestación es pura en el sentido de que acepta un `db` inyectable y
// un `providerFactory` para facilitar tests. En producción, usa el registry
// por defecto.

const { db: defaultDb, Timestamp } = require('../firebase');
const { getProvider: defaultGetProvider } = require('../external');
const { detectAlerts } = require('./signalAlerts');

const DEFAULT_DEDUP_WINDOW_MS = 60_000;  // 1 minuto

// Recupera la ventana histórica necesaria para correr alertas de precio
// (requieren al menos 1 señal previa). Limitado a 30 observaciones para
// mantener reads acotados.
async function loadRecentSignalsForSource(db, fincaId, sourceId, limit = 30) {
  const snap = await db.collection('external_signals')
    .where('fincaId', '==', fincaId)
    .where('sourceId', '==', sourceId)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || ''))
    .slice(0, limit);
}

function shouldDedup(existing, fetchedAtMs, dedupWindowMs) {
  if (!existing) return false;
  const existingMs = existing.fetchedAt?.toMillis?.() || 0;
  return Math.abs(existingMs - fetchedAtMs) < dedupWindowMs;
}

// Ejecuta una ingesta para UNA source. Devuelve el resultado del intento.
// No lanza si el fetch falla — lo registra en el source y devuelve
// `{ ok: false, error }`.
async function ingestSource({
  db = defaultDb,
  getProvider = defaultGetProvider,
  sourceDoc,          // { id, fincaId, provider, config, ... }
  apiKeyResolver,     // (providerId) => string|null
  now = new Date(),
  dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS,
  executor = {},      // { writeFeedEvent?, sendPush? } — opcionales
}) {
  const fincaId = sourceDoc.fincaId;
  const sourceId = sourceDoc.id;
  const provider = getProvider(sourceDoc.provider);
  if (!provider) {
    await updateSourceHealth(db, sourceId, { error: `Unknown provider "${sourceDoc.provider}".` });
    return { ok: false, error: 'UNKNOWN_PROVIDER' };
  }
  if (typeof provider.fetchSignal !== 'function') {
    await updateSourceHealth(db, sourceId, { error: `Provider "${provider.id}" does not support fetch.` });
    return { ok: false, error: 'PROVIDER_NOT_FETCHABLE' };
  }

  const apiKey = apiKeyResolver ? apiKeyResolver(provider.id) : null;
  let fetched;
  try {
    fetched = await provider.fetchSignal({ config: sourceDoc.config || {}, apiKey, now });
  } catch (err) {
    await updateSourceHealth(db, sourceId, { error: err.message || String(err), failure: true });
    return { ok: false, error: err.code || 'FETCH_FAILED', message: err.message };
  }

  // Dedup: miramos la última observación del mismo día para esta source.
  const recent = await loadRecentSignalsForSource(db, fincaId, sourceId, 30);
  const sameDay = recent.find(s => s.observedAt === fetched.observedAt);
  const fetchedAtMs = now.getTime();
  if (shouldDedup(sameDay, fetchedAtMs, dedupWindowMs)) {
    await updateSourceHealth(db, sourceId, { error: null, failure: false });
    return { ok: true, dedup: true, signalId: sameDay.id };
  }

  const signalDoc = {
    fincaId,
    sourceId,
    sourceName: sourceDoc.name || null,
    signalType: sourceDoc.signalType,
    provider: provider.id,
    value: Number.isFinite(Number(fetched.value)) ? Number(fetched.value) : null,
    unit: fetched.unit || null,
    confidence: Number.isFinite(Number(fetched.confidence)) ? Number(fetched.confidence) : 0.5,
    observedAt: fetched.observedAt,
    fetchedAt: Timestamp.fromMillis(fetchedAtMs),
    raw: fetched.raw || null,
    metadata: fetched.metadata || {},
    supersedes: sameDay ? sameDay.id : null,
  };
  const ref = await db.collection('external_signals').add(signalDoc);
  await updateSourceHealth(db, sourceId, { error: null, failure: false });

  // Alertas.
  const alerts = detectAlerts({
    signal: { ...signalDoc, id: ref.id },
    previousSignals: recent,
    thresholds: sourceDoc.alertThresholds || {},
  });
  if (alerts.length > 0 && executor.writeFeedEvent) {
    for (const alert of alerts) {
      try {
        await executor.writeFeedEvent({
          fincaId,
          uid: 'system',
          userEmail: null,
          eventType: `signal_alert_${alert.code}`,
          activityType: 'external_signal',
          title: `Alerta ${alert.severity}: ${alert.message}`,
          loteNombre: null,
          userName: 'Señales externas',
        });
      } catch (err) {
        console.error('[signals] feed event failed:', err.message);
      }
    }
    if (executor.sendPush) {
      try {
        await executor.sendPush(fincaId, ['supervisor', 'administrador'], {
          title: `Alerta — ${alerts[0].code}`,
          body: alerts[0].message,
          url: '/strategy/senales',
        });
      } catch (err) {
        console.error('[signals] push failed:', err.message);
      }
    }
  }

  return { ok: true, signalId: ref.id, alerts, dedup: false };
}

async function updateSourceHealth(db, sourceId, { error, failure }) {
  const ref = db.collection('signal_sources').doc(sourceId);
  const updates = {
    lastFetchedAt: Timestamp.now(),
  };
  if (failure === true) {
    updates.lastError = String(error || '').slice(0, 512);
    updates.consecutiveFailures = (await ref.get()).data()?.consecutiveFailures
      ? ((await ref.get()).data().consecutiveFailures + 1)
      : 1;
  } else {
    updates.lastSuccessfulFetchAt = Timestamp.now();
    updates.lastError = null;
    updates.consecutiveFailures = 0;
  }
  await ref.update(updates).catch(() => {});
}

// Indica si una source está "debida" para ingesta según su `ingestIntervalDays`.
function isSourceDue(sourceDoc, now = new Date()) {
  const interval = Number(sourceDoc.ingestIntervalDays) || 1;
  const lastMs = sourceDoc.lastFetchedAt?.toMillis?.()
    || sourceDoc.lastSuccessfulFetchAt?.toMillis?.()
    || 0;
  if (!lastMs) return true;
  const elapsedDays = (now.getTime() - lastMs) / (1000 * 60 * 60 * 24);
  return elapsedDays >= interval;
}

module.exports = {
  ingestSource,
  isSourceDue,
  shouldDedup,
  loadRecentSignalsForSource,
};
