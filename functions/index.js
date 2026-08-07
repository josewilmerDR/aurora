// --- AURORA BACKEND — ENTRY POINT ---
const { functions, allSecrets } = require('./lib/firebase');
const { verifyAppCheck } = require('./lib/appcheck');
const { requestLog } = require('./lib/requestLog');
const { isAdvanced } = require('./lib/features');
const express = require('express');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '15mb' }));

// --- LOGGING MIDDLEWARE ---
// Path + claves del query, nunca valores: el deep link /task pasa su token
// HMAC como ?t=... y con originalUrl quedaba en Cloud Logging.
app.use(requestLog);

// --- APP CHECK (bot / unauthorized-client gate, runs before auth) ---
// Controlled by APP_CHECK_MODE env var: 'enforce' | 'warn' | 'off'.
// Always bypassed in the Functions emulator.
app.use(verifyAppCheck);

// --- MOUNT ROUTERS ---
// health primero: probe de uptime, que no pague el costo de recorrer los
// matchers de los ~45 routers de abajo.
app.use(require('./routes/health'));
app.use(require('./routes/auth'));
app.use(require('./routes/feed'));
app.use(require('./routes/tasks'));
app.use(require('./routes/field-records'));
app.use(require('./routes/templates'));
app.use(require('./routes/users'));
app.use(require('./routes/users-facets'));
app.use(require('./routes/warehouses-bodegas'));
app.use(require('./routes/warehouses'));
app.use(require('./routes/products'));
app.use(require('./routes/packages'));
app.use(require('./routes/plots'));
app.use(require('./routes/groups'));
app.use(require('./routes/block-transitions'));
app.use(require('./routes/procurement-invoices'));
app.use(require('./routes/hr'));
app.use(require('./routes/config'));
app.use(require('./routes/monitoring'));
app.use(require('./routes/planting'));
app.use(require('./routes/suppliers-legacy'));
app.use(require('./routes/machinery'));
app.use(require('./routes/chat'));
app.use(require('./routes/reminders'));
app.use(require('./routes/equipment-hours'));
app.use(require('./routes/fuel'));
app.use(require('./routes/units'));
app.use(require('./routes/labor-records'));
app.use(require('./routes/webpush'));
app.use(require('./routes/calibrations'));
app.use(require('./routes/harvest'));
app.use(require('./routes/costs'));
app.use(require('./routes/budgets'));
app.use(require('./routes/roi'));
app.use(require('./routes/buyers'));
app.use(require('./routes/income'));
app.use(require('./routes/treasury'));
app.use(require('./routes/suppliers'));
app.use(require('./routes/procurement'));
app.use(require('./routes/rfqs'));
app.use(require('./routes/analytics'));
app.use(require('./routes/audit'));
app.use(require('./routes/weather'));

// Advanced surface (Fases 2–6): mounted only when FEATURES_ADVANCED=true.
// Mirrors the UX gate in src/App.jsx so deep-link calls 404 in v1 builds.
// Autopilot va acá TAMBIÉN: sin este gate, /api/autopilot/directives y
// /api/autopilot/feedback eran los únicos endpoints de autopilot sin gate
// de rol — cualquier trabajador escribía en copilot_directives. El test
// tests/unit/autopilot.featureGate.test.js recorre los routers autopilot*
// y falla si uno nuevo queda montado fuera de este bloque.
if (isAdvanced()) {
  app.use(require('./routes/autopilot-control'));
  app.use(require('./routes/autopilot'));
  app.use(require('./routes/autopilot-finance'));
  app.use(require('./routes/autopilot-procurement'));
  app.use(require('./routes/autopilot-hr'));
  app.use(require('./routes/strategy'));
  app.use(require('./routes/signals'));
  app.use(require('./routes/scenarios'));
  app.use(require('./routes/annualPlans'));
  app.use(require('./routes/financing'));
  app.use(require('./routes/meta'));
  app.use(require('./routes/autopilot-orchestrator'));
}

// --- EXPORT CLOUD FUNCTIONS ---
// Recursos explícitos (antes: defaults de Gen 2 — 256MiB / 60s / sin techo).
// - NO fijar `region`: es un no-op (us-central1 ya es el default) pero
//   cambiarla borra y recrea la función, cambia la URL y rompe el rewrite
//   de firebase.json.
// - `secrets: allSecrets` NUNCA puede perderse al tocar estas opciones: el
//   deploy pasa, la función arranca, y en runtime Claude y push fallan
//   por credenciales vacías. tests/unit/functionsRuntime.manifest.test.js
//   lo guarda.
// - timeoutSeconds 120 NO hace esperar al usuario: Hosting corta los
//   rewrites a los 60s pase lo que pase (504 del proxy). Lo que logra es
//   que la función termine su trabajo en vez de morir a mitad de una
//   escritura (deducción de stock, sesión de autopilot).
// - memory 512MiB: express.json admite payloads de 15mb (escaneos base64)
//   y los endpoints de IA arman prompts grandes; 256MiB quedaba justo.
// - maxInstances 10 es techo de gasto Y de disponibilidad: al saturar,
//   Cloud Run responde 429. Revisarlo ANTES de abrir registro self-serve.
exports.api = functions.https.onRequest(
  {
    secrets: allSecrets,
    memory: '512MiB',
    timeoutSeconds: 120,
    maxInstances: 10,
  },
  app
);

exports.sendDuePushReminders = require('./scheduled/reminders-cron');
exports.hrMonthlyScoring = require('./scheduled/hrMonthlyScoring');

// Advanced crons (Fases 2–6): exported only when FEATURES_ADVANCED=true so a
// v1 deploy does not provision schedulers for features hidden in the UI.
// OJO: quitar un export NO borra la Cloud Function ni el job de Cloud
// Scheduler ya desplegados — verificar en GCP tras el deploy (ver PR).
if (isAdvanced()) {
  exports.autopilotMonitor = require('./scheduled/autopilot-monitor');
  exports.signalsIngestCron = require('./scheduled/signals-cron');
  exports.annualPlanActivator = require('./scheduled/annualPlanActivator');
  exports.metaKpiSweep = require('./scheduled/metaKpiSweep');
  exports.metaTrustRecompute = require('./scheduled/metaTrustRecompute');
  exports.metaOrchestratorTick = require('./scheduled/metaOrchestratorTick');
}
