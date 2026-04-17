/**
 * Autopilot monitor — periodic alerting cron.
 *
 * Every 15 minutes:
 *   1. Lists fincas with any Autopilot action in the last hour.
 *   2. For each, counts failures and escalations in the last hour.
 *   3. If counts exceed configured thresholds AND the per-finca per-kind
 *      cooldown has elapsed, sends a push alert to admins+supervisors and
 *      records the alert timestamp.
 *
 * Thresholds live on `autopilot_config/{fincaId}.monitoring`. Defaults are
 * intentionally conservative; tighten as confidence grows.
 */

const { functions, db, vapidPublicKey, vapidPrivateKey } = require('../lib/firebase');
const {
  countByStatus,
  getAlertState,
  markAlerted,
  listActiveFincas,
} = require('../lib/autopilotMetrics');
const { sendPushToFincaRoles } = require('../lib/helpers');

const LOOKBACK_MS = 60 * 60 * 1000;
const DEFAULTS = {
  failuresPerHourThreshold: 5,
  escalationsPerHourThreshold: 10,
  alertCooldownMinutes: 60,
};

async function loadMonitoringConfig(fincaId) {
  const doc = await db.collection('autopilot_config').doc(fincaId).get();
  const monitoring = doc.exists ? (doc.data().monitoring || {}) : {};
  return {
    failuresPerHourThreshold:
      Number.isFinite(monitoring.failuresPerHourThreshold)
        ? monitoring.failuresPerHourThreshold
        : DEFAULTS.failuresPerHourThreshold,
    escalationsPerHourThreshold:
      Number.isFinite(monitoring.escalationsPerHourThreshold)
        ? monitoring.escalationsPerHourThreshold
        : DEFAULTS.escalationsPerHourThreshold,
    alertCooldownMinutes:
      Number.isFinite(monitoring.alertCooldownMinutes)
        ? monitoring.alertCooldownMinutes
        : DEFAULTS.alertCooldownMinutes,
  };
}

function cooldownElapsed(lastAlertAt, cooldownMinutes) {
  if (!lastAlertAt) return true;
  const lastMs = lastAlertAt._seconds
    ? lastAlertAt._seconds * 1000
    : lastAlertAt.toMillis?.() || 0;
  return Date.now() - lastMs >= cooldownMinutes * 60 * 1000;
}

async function checkFinca(fincaId, sinceMs) {
  const config = await loadMonitoringConfig(fincaId);
  const [failures, escalations, alertState] = await Promise.all([
    countByStatus(fincaId, 'failed', sinceMs),
    countByStatus(fincaId, 'escalated', sinceMs),
    getAlertState(fincaId),
  ]);

  const tasks = [];

  if (
    failures >= config.failuresPerHourThreshold &&
    cooldownElapsed(alertState.failuresLastAlertAt, config.alertCooldownMinutes)
  ) {
    tasks.push(
      sendPushToFincaRoles(fincaId, ['supervisor', 'administrador'], {
        title: '⚠️ Aurora — Fallas en Piloto Automático',
        body: `${failures} acción(es) fallidas en la última hora (umbral: ${config.failuresPerHourThreshold}). Revisa el panel de salud.`,
        url: '/autopilot',
      }).then(() => markAlerted(fincaId, 'failures'))
    );
  }

  if (
    escalations >= config.escalationsPerHourThreshold &&
    cooldownElapsed(alertState.escalationsLastAlertAt, config.alertCooldownMinutes)
  ) {
    tasks.push(
      sendPushToFincaRoles(fincaId, ['supervisor', 'administrador'], {
        title: '⚠️ Aurora — Escaladas en Piloto Automático',
        body: `${escalations} acción(es) escaladas en la última hora (umbral: ${config.escalationsPerHourThreshold}). Aurora está topando guardrails con frecuencia.`,
        url: '/autopilot',
      }).then(() => markAlerted(fincaId, 'escalations'))
    );
  }

  await Promise.all(tasks);
  return { fincaId, failures, escalations, alerts: tasks.length };
}

module.exports = functions.scheduler.onSchedule(
  { schedule: 'every 15 minutes', secrets: [vapidPublicKey, vapidPrivateKey] },
  async () => {
    const sinceMs = Date.now() - LOOKBACK_MS;
    const fincaIds = await listActiveFincas(sinceMs);
    if (!fincaIds.length) return null;

    const results = await Promise.allSettled(fincaIds.map(id => checkFinca(id, sinceMs)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[AUTOPILOT_MONITOR] finca=${fincaIds[i]} failed:`, r.reason);
      }
    });
    return null;
  }
);
