// --- AURORA BACKEND — ENTRY POINT ---
const { functions, allSecrets } = require('./lib/firebase');
const express = require('express');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '15mb' }));

// --- LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// --- MOUNT ROUTERS ---
app.use(require('./routes/auth'));
app.use(require('./routes/feed'));
app.use(require('./routes/tasks'));
app.use(require('./routes/cedulas'));
app.use(require('./routes/templates'));
app.use(require('./routes/users'));
app.use(require('./routes/bodegas'));
app.use(require('./routes/productos'));
app.use(require('./routes/packages'));
app.use(require('./routes/lotes'));
app.use(require('./routes/grupos'));
app.use(require('./routes/compras'));
app.use(require('./routes/hr'));
app.use(require('./routes/config'));
app.use(require('./routes/monitoreo'));
app.use(require('./routes/siembra'));
app.use(require('./routes/proveedores'));
app.use(require('./routes/maquinaria'));
app.use(require('./routes/chat'));
app.use(require('./routes/reminders'));
app.use(require('./routes/horimetro'));
app.use(require('./routes/combustible'));
app.use(require('./routes/unidades'));
app.use(require('./routes/labores'));
app.use(require('./routes/webpush'));
app.use(require('./routes/calibraciones'));
app.use(require('./routes/autopilot'));
app.use(require('./routes/cosecha'));
app.use(require('./routes/costos'));

// --- EXPORT CLOUD FUNCTIONS ---
exports.api = functions.https.onRequest(
  { secrets: allSecrets },
  app
);

exports.sendDuePushReminders = require('./scheduled/reminders-cron');
