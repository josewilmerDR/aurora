// Cron de ingesta de señales externas — Fase 4.3.
//
// Corre cada 60 minutos. Por cada finca con el flag
// `autopilot_config.external_signals_enabled !== false`, itera las
// `signal_sources` habilitadas; si la source está "debida"
// (`elapsed >= ingestIntervalDays`), invoca el ingestor.
//
// Observaciones de diseño:
//   - El cron es idempotente por diseño: el ingestor dedupa observaciones del
//     mismo día si llegan dentro de 1 min.
//   - La frecuencia del cron es el límite superior; el `ingestIntervalDays`
//     de cada source decide cuánto tardará cada fuente entre ingestas reales.
//   - Si el secreto del provider está vacío (p. ej. OPENWEATHER_API_KEY sin
//     configurar), el ingestor registra el fallo y la source queda con
//     `consecutiveFailures` creciente. No hay llamadas inútiles.

const {
  functions, db,
  openWeatherApiKey, alphaVantageApiKey,
  vapidPublicKey, vapidPrivateKey,
} = require('../lib/firebase');
const { ingestSource, isSourceDue } = require('../lib/strategy/signalsIngestor');
const { writeFeedEvent, sendPushToFincaRoles } = require('../lib/helpers');

function resolveApiKey(providerId) {
  try {
    if (providerId === 'openweathermap') return openWeatherApiKey.value() || null;
    if (providerId === 'alphavantage') return alphaVantageApiKey.value() || null;
  } catch (err) {
    return null;
  }
  return null;
}

async function listEnabledFincas() {
  const snap = await db.collection('autopilot_config').get();
  // Devolvemos fincaId + toggle (si está en false, se excluye).
  return snap.docs
    .filter(d => d.data().external_signals_enabled !== false)
    .map(d => d.id);
}

async function listEnabledSourcesForFinca(fincaId) {
  const snap = await db.collection('signal_sources')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.enabled !== false && s.provider !== 'manual');
}

module.exports = functions.scheduler.onSchedule(
  {
    schedule: 'every 60 minutes',
    secrets: [openWeatherApiKey, alphaVantageApiKey, vapidPublicKey, vapidPrivateKey],
  },
  async () => {
    const now = new Date();
    const fincas = await listEnabledFincas();
    // También incluimos fincas sin doc `autopilot_config`: si tienen sources,
    // hay que ingerirlas (default enabled).
    const sourcesByFincaSnap = await db.collection('signal_sources')
      .where('enabled', '==', true)
      .get();
    const fincaIdsFromSources = new Set(sourcesByFincaSnap.docs.map(d => d.data().fincaId));
    for (const id of fincaIdsFromSources) {
      if (!fincas.includes(id)) fincas.push(id);
    }

    // Re-leemos excluyendo flags negativos (defensa si alguna finca está en
    // listEnabledFincas pero con el flag false — caso imposible por filtro previo).
    const disabledSnap = await db.collection('autopilot_config').get();
    const disabled = new Set(
      disabledSnap.docs
        .filter(d => d.data().external_signals_enabled === false)
        .map(d => d.id),
    );

    let totalOk = 0;
    let totalErr = 0;
    let totalSkipped = 0;

    for (const fincaId of fincas) {
      if (disabled.has(fincaId)) { totalSkipped += 1; continue; }
      const sources = await listEnabledSourcesForFinca(fincaId);
      for (const source of sources) {
        if (!isSourceDue(source, now)) { totalSkipped += 1; continue; }
        try {
          const res = await ingestSource({
            sourceDoc: source,
            apiKeyResolver: resolveApiKey,
            now,
            executor: {
              writeFeedEvent,
              sendPush: sendPushToFincaRoles,
            },
          });
          if (res.ok) totalOk += 1; else totalErr += 1;
        } catch (err) {
          console.error(`[signals-cron] ingest failed for source ${source.id}:`, err.message);
          totalErr += 1;
        }
      }
    }

    console.log(`[signals-cron] cycle done · ok=${totalOk} · err=${totalErr} · skipped=${totalSkipped}`);
    return null;
  },
);
