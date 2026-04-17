/**
 * Global Jest setup — runs before any test file is loaded.
 *
 * Configures the admin SDK to talk to the Firestore emulator. The admin SDK
 * auto-targets the emulator when FIRESTORE_EMULATOR_HOST is set, so we just
 * make sure it is. Pure-function tests don't touch the DB, so they pass
 * regardless of whether the emulator is actually running.
 *
 * Integration tests will fail fast with a helpful message if the emulator
 * isn't reachable.
 */

// Point the admin SDK at the local Firestore emulator.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

// Silence Firebase's noisy "detected emulator" warning (optional quality-of-life).
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: 'aurora-7dc9b',
});
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'aurora-7dc9b';

// Secrets are `.value()`-accessed lazily. Supply dummy values so test output
// isn't littered with "No value found for secret parameter" warnings when a
// case reads a secret before the mocked client intercepts the call (e.g. the
// two-phase Twilio path). The mock prevents any actual network use.
process.env.TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '+0000000000';
process.env.TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || 'AC_test';
process.env.TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || 'test';
