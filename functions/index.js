// --- AURORA BACKEND — ENTRY POINT ---
const { functions, allSecrets } = require('./lib/firebase');
const { verifyAppCheck } = require('./lib/appcheck');
const express = require('express');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '15mb' }));

// --- LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// --- APP CHECK (bot / unauthorized-client gate, runs before auth) ---
// Controlled by APP_CHECK_MODE env var: 'enforce' | 'warn' | 'off'.
// Always bypassed in the Functions emulator.
app.use(verifyAppCheck);

// --- MOUNT ROUTERS ---
app.use(require('./routes/auth'));
app.use(require('./routes/feed'));
app.use(require('./routes/tasks'));
app.use(require('./routes/field-records'));
app.use(require('./routes/templates'));
app.use(require('./routes/users'));
app.use(require('./routes/warehouses'));
app.use(require('./routes/products'));
app.use(require('./routes/packages'));
app.use(require('./routes/plots'));
app.use(require('./routes/groups'));
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
app.use(require('./routes/autopilot-control'));
app.use(require('./routes/autopilot'));
app.use(require('./routes/harvest'));
app.use(require('./routes/costs'));
app.use(require('./routes/budgets'));
app.use(require('./routes/roi'));
app.use(require('./routes/autopilot-finance'));
app.use(require('./routes/buyers'));
app.use(require('./routes/income'));
app.use(require('./routes/treasury'));
app.use(require('./routes/suppliers'));
app.use(require('./routes/procurement'));
app.use(require('./routes/autopilot-procurement'));
app.use(require('./routes/autopilot-hr'));
app.use(require('./routes/rfqs'));
app.use(require('./routes/analytics'));
app.use(require('./routes/strategy'));
app.use(require('./routes/signals'));
app.use(require('./routes/scenarios'));
app.use(require('./routes/annualPlans'));
app.use(require('./routes/financing'));
app.use(require('./routes/meta'));
app.use(require('./routes/autopilot-orchestrator'));
app.use(require('./routes/audit'));

// --- EXPORT CLOUD FUNCTIONS ---
exports.api = functions.https.onRequest(
  { secrets: allSecrets },
  app
);

exports.sendDuePushReminders = require('./scheduled/reminders-cron');
exports.autopilotMonitor = require('./scheduled/autopilot-monitor');
exports.hrMonthlyScoring = require('./scheduled/hrMonthlyScoring');
exports.signalsIngestCron = require('./scheduled/signals-cron');
exports.annualPlanActivator = require('./scheduled/annualPlanActivator');
exports.metaKpiSweep = require('./scheduled/metaKpiSweep');
exports.metaTrustRecompute = require('./scheduled/metaTrustRecompute');
exports.metaOrchestratorTick = require('./scheduled/metaOrchestratorTick');
