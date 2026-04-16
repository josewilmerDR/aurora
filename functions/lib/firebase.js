const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require('firebase-admin');
const { getFirestore, Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');

// --- SECRET DEFINITIONS (Firebase Functions "params" system) ---
const twilioAccountSid = defineSecret("TWILIO_ACCOUNT_SID");
const twilioAuthToken = defineSecret("TWILIO_AUTH_TOKEN");
const twilioWhatsappFrom = defineSecret("TWILIO_WHATSAPP_FROM");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
const vapidPublicKey = defineSecret("VAPID_PUBLIC_KEY");
const vapidPrivateKey = defineSecret("VAPID_PRIVATE_KEY");

// --- UNIVERSAL CLIENT INITIALIZATION ---
admin.initializeApp();
const db = getFirestore(admin.app(), 'auroradatabase');
const STORAGE_BUCKET = 'aurora-7dc9b.appspot.com';
const APP_URL = 'https://aurora-7dc9b.web.app';

module.exports = {
  functions,
  admin,
  db,
  Timestamp,
  FieldValue,
  FieldPath,
  STORAGE_BUCKET,
  APP_URL,
  // Secrets
  twilioAccountSid,
  twilioAuthToken,
  twilioWhatsappFrom,
  anthropicApiKey,
  vapidPublicKey,
  vapidPrivateKey,
  // All secrets array for Cloud Function config
  allSecrets: [twilioAccountSid, twilioAuthToken, twilioWhatsappFrom, anthropicApiKey, vapidPublicKey, vapidPrivateKey],
};
