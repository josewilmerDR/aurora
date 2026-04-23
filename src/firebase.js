import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

// --- App Check ---
// Only initialize in production builds where we have a reCAPTCHA Enterprise
// site key configured. The Firebase emulator path bypasses App Check on the
// backend, so enabling it in DEV would only add friction without value.
// For DEV testing of App Check itself, set VITE_APPCHECK_DEBUG=1 in your
// local env so the Firebase SDK prints a debug token you can register.
export let appCheck = null;
if (!import.meta.env.DEV && import.meta.env.VITE_APPCHECK_SITE_KEY) {
  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // A failed App Check init should not crash the app; the backend runs in
    // 'warn' mode during rollout, so callers will still succeed.
    console.warn('[AppCheck] init failed:', err?.message || err);
  }
} else if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === '1') {
  // Enables the debug-token flow so you can register a dev machine without a
  // real reCAPTCHA challenge. See docs/security-hardening.md.
  // eslint-disable-next-line no-undef
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  if (import.meta.env.VITE_APPCHECK_SITE_KEY) {
    try {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_APPCHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn('[AppCheck] debug init failed:', err?.message || err);
    }
  }
}

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app, 'auroradatabase');
export const storage = getStorage(app);

// En desarrollo local, usar los emuladores
if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
