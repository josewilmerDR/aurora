const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require('firebase-admin');
const { getFirestore, Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');

// --- SECRET DEFINITIONS (Firebase Functions "params" system) ---
// Los secrets TWILIO_* se eliminaron junto con el canal WhatsApp: push es
// el único canal de notificación saliente. Si se reintegra WhatsApp será
// por otro medio (decisión 2026-08-07).
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const vapidPublicKey = defineSecret("VAPID_PUBLIC_KEY");
const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");
// External signals — Fase 4.3. Opcionales: si el secreto está vacío, el
// proveedor correspondiente queda deshabilitado hasta que se cargue.
const openWeatherApiKey = defineSecret("OPENWEATHER_API_KEY");
const alphaVantageApiKey = defineSecret("ALPHAVANTAGE_API_KEY");
// HMAC signing key for /task/:id deep-links sent via WhatsApp. When
// unset, task link tokens fall back to warn mode (see taskLinkToken.js).
const taskLinkSecret = defineSecret("TASK_LINK_SECRET");

// --- UNIVERSAL CLIENT INITIALIZATION ---
admin.initializeApp();
// FIRESTORE_DATABASE_ID permite repuntar el backend a otra base (la que crea
// un restore de respaldo — Firestore nunca restaura encima de una existente)
// sin tocar código. El literal queda SIEMPRE como respaldo del ||:
// getFirestore(app, undefined) no lanza — devuelve un handle a '(default)',
// que existe y está vacía, y el backend arrancaría "sano" respondiendo 200
// con listas vacías y escribiendo ahí. Indistinguible de datos borrados.
// Runbook de respaldos/restore: docs/firestore-backups.md
const db = getFirestore(admin.app(), process.env.FIRESTORE_DATABASE_ID || 'auroradatabase');
const STORAGE_BUCKET = 'aurora-7dc9b.appspot.com';

// APP_URL: base de los deep-links en mensajes salientes (WhatsApp, push).
// Se interpola cruda en cuerpos de mensaje, así que NUNCA es un passthrough
// del env: se exige https, sin credenciales, sin query ni fragmento, y se
// normaliza el slash final. Un valor inválido cae al default con warning en
// vez de contaminar cada mensaje enviado. Origen del valor: functions/.env
// (versionado). Mudanza de dominio = editar esa variable.
const DEFAULT_APP_URL = 'https://aurora-7dc9b.web.app';
const resolveAppUrl = (raw) => {
  if (raw == null || String(raw).trim() === '') return DEFAULT_APP_URL;
  let url = null;
  try { url = new URL(String(raw).trim()); } catch { /* inválida → default */ }
  const ok = url
    && url.protocol === 'https:'
    && !url.username && !url.password
    && !url.search && !url.hash;
  if (!ok) {
    console.warn(`[config] APP_URL inválida ("${raw}"); usando ${DEFAULT_APP_URL}`);
    return DEFAULT_APP_URL;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};
const APP_URL = resolveAppUrl(process.env.APP_URL);

module.exports = {
  functions,
  admin,
  db,
  Timestamp,
  FieldValue,
  FieldPath,
  STORAGE_BUCKET,
  APP_URL,
  resolveAppUrl, // exportada para tests

  // Secrets
  anthropicApiKey,
  vapidPublicKey,
  vapidPrivateKey,
  openWeatherApiKey,
  alphaVantageApiKey,
  taskLinkSecret,
  // All secrets array for Cloud Function config
  allSecrets: [
    anthropicApiKey, vapidPublicKey, vapidPrivateKey,
    openWeatherApiKey, alphaVantageApiKey,
    taskLinkSecret,
  ],
};
