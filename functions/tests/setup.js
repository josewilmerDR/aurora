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

// (Los dummies TWILIO_* se eliminaron junto con el canal WhatsApp.)
