import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { apiFetch } from '../lib/apiFetch';
import { clearAllDrafts } from '../hooks/useDraft';

export const ROLE_LEVELS = {
  trabajador: 1,
  encargado: 2,
  supervisor: 3,
  rrhh: 3,
  administrador: 4,
};

export const ROLE_LABELS = {
  ninguno: 'Sin acceso',
  trabajador: 'Trabajador',
  encargado: 'Encargado',
  supervisor: 'Supervisor',
  rrhh: 'RR.HH.',
  administrador: 'Administrador',
};

export function hasMinRole(userRole, minRole) {
  return (ROLE_LEVELS[userRole] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

const UserContext = createContext(null);

const ACTIVE_FINCA_KEY = 'aurora_active_finca';

export function UserProvider({ children }) {
  // firebaseUser: Firebase Auth user (or null)
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = loading
  // emailVerified: whether the Firebase Auth email is verified. The backend
  // rejects tokens with email_verified=false (functions/lib/middleware.js), so
  // an unverified session can never load memberships/profile — we model it as
  // an explicit state and route it to /verificar-correo instead of letting it
  // fall through to the (broken) OrganizationSelector path.
  const [emailVerified, setEmailVerified] = useState(true);
  // memberships: list of fincas the user belongs to
  const [memberships, setMemberships] = useState([]);
  // activeFincaId: currently selected finca
  const [activeFincaId, setActiveFincaId] = useState(() => localStorage.getItem(ACTIVE_FINCA_KEY));
  // currentUser: user profile in the active finca { nombre, rol, telefono, ... }
  const [currentUser, setCurrentUser] = useState(null);
  // membershipsLoadFailed: true when we could NOT get a definitive answer about
  // the user's memberships (both the GET and the claim failed — offline, backend
  // down). Distinguishes "confirmed 0 memberships" from "couldn't load", so a
  // transient error does not route a user who actually has orgs into the
  // create-organization flow. See needsSetup below.
  const [membershipsLoadFailed, setMembershipsLoadFailed] = useState(false);

  // Loads memberships + claims invitations + active-finca profile for an
  // authenticated, email-verified user. Extracted so onAuthStateChanged and
  // refreshAfterVerification share the exact same hydration path.
  const loadUserState = useCallback(async () => {
    // Load memberships BEFORE setting firebaseUser to avoid an intermediate render
    // where memberships=[] and needsSetup=true would redirect to /register
    let membershipsData = [];
    // Track whether at least one endpoint gave a definitive answer. If both
    // fail we must NOT conclude "0 memberships" (that would trigger needsSetup
    // and push a user with orgs into /register on a transient network blip).
    let loadOk = false;
    try {
      const res = await apiFetch('/api/auth/memberships');
      if (res.ok) {
        const data = await res.json();
        membershipsData = data.memberships || [];
        loadOk = true;
      }
    } catch { /* leave membershipsData empty, loadOk false */ }

    // Always claim email invitations — regardless of whether GET /memberships succeeded.
    // Covers first login (no memberships by UID) and users added to another org by an admin.
    try {
      const claimRes = await apiFetch('/api/auth/claim-invitations', { method: 'POST' });
      if (claimRes.ok) {
        loadOk = true;
        const claimData = await claimRes.json();
        const claimed = claimData.memberships || [];
        // Append only memberships not already in the list (dedupe)
        const newOnes = claimed.filter(cm => !membershipsData.some(m => m.fincaId === cm.fincaId));
        if (newOnes.length > 0) membershipsData = [...membershipsData, ...newOnes];
      }
    } catch { /* silently fail */ }

    setMembershipsLoadFailed(!loadOk);
    setMemberships(membershipsData);

    // If a stored active finca exists, load the profile BEFORE revealing the
    // authenticated user. This way, when isLoading flips to false, currentUser
    // is already ready and ProtectedRoute never redirects to /login unnecessarily.
    const storedFincaId = localStorage.getItem(ACTIVE_FINCA_KEY);
    if (storedFincaId) {
      try {
        const profileRes = await apiFetch('/api/auth/me', {}, storedFincaId);
        setCurrentUser(profileRes.ok ? await profileRes.json() : null);
      } catch {
        setCurrentUser(null);
      }
    }
  }, []);

  // Listen to Firebase Auth session changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setFirebaseUser(null);
        setEmailVerified(true);
        setMemberships([]);
        setMembershipsLoadFailed(false);
        setCurrentUser(null);
        setActiveFincaId(null);
        localStorage.removeItem(ACTIVE_FINCA_KEY);
        return;
      }

      // Email not verified: short-circuit. The backend would 401 every call
      // below (email_verified gate), leaving currentUser null and the user
      // stranded on a broken org selector. Surface the state explicitly so
      // ProtectedRoute can route to /verificar-correo. Google sign-in always
      // arrives verified, so this only gates the email/password path.
      if (!fbUser.emailVerified) {
        setMemberships([]);
        setMembershipsLoadFailed(false);
        setCurrentUser(null);
        setEmailVerified(false);
        setFirebaseUser(fbUser);
        return;
      }

      setEmailVerified(true);
      await loadUserState();

      // Set firebaseUser last: isLoading stays true until this point,
      // preventing ProtectedRoute from deciding on incomplete state.
      setFirebaseUser(fbUser);
    });
    return unsubscribe;
  }, [loadUserState]);

  // When the user switches finca manually, reload their profile
  useEffect(() => {
    if (!firebaseUser || !activeFincaId) {
      setCurrentUser(null);
      return;
    }
    apiFetch('/api/auth/me', {}, activeFincaId)
      .then(async (res) => {
        if (res.ok) {
          setCurrentUser(await res.json());
        } else {
          // Perfil inaccesible (membresía revocada o finca borrada entre que se
          // listó y se seleccionó): limpiar la selección para volver al selector
          // en vez de quedar colgados en el spinner de ProtectedRoute.
          setCurrentUser(null);
          setActiveFincaId(null);
          localStorage.removeItem(ACTIVE_FINCA_KEY);
        }
      })
      .catch(() => setCurrentUser(null));
  }, [firebaseUser, activeFincaId]);

  const login = useCallback(async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    clearAllDrafts();
    localStorage.removeItem(ACTIVE_FINCA_KEY);
  }, []);

  const selectFinca = useCallback((fincaId) => {
    setActiveFincaId(fincaId);
    localStorage.setItem(ACTIVE_FINCA_KEY, fincaId);
  }, []);

  // Reloads the user's profile on the active finca (useful after editing the user themselves)
  const refreshCurrentUser = useCallback(async () => {
    if (!firebaseUser || !activeFincaId) return;
    try {
      const res = await apiFetch('/api/auth/me', {}, activeFincaId);
      if (res.ok) setCurrentUser(await res.json());
    } catch { /* silently fail */ }
  }, [firebaseUser, activeFincaId]);

  // Called from /verificar-correo once the user has clicked the email link.
  // The email_verified claim is baked into the cached ID token, so we MUST
  // force a reload + token refresh before any backend call — otherwise
  // apiFetch keeps sending the stale token (email_verified=false) and the
  // backend keeps rejecting it. Returns true once verification is confirmed.
  const refreshAfterVerification = useCallback(async () => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    if (!auth.currentUser.emailVerified) return false;
    // Force-refresh so the next apiFetch carries email_verified=true.
    await auth.currentUser.getIdToken(true);
    setEmailVerified(true);
    await loadUserState();
    setFirebaseUser(auth.currentUser);
    return true;
  }, [loadUserState]);

  // Reloads memberships from the API (useful after creating a new finca)
  const refreshMemberships = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const res = await apiFetch('/api/auth/memberships');
      if (res.ok) {
        const data = await res.json();
        setMemberships(data.memberships || []);
        if ((data.memberships || []).length === 1) {
          const fincaId = data.memberships[0].fincaId;
          setActiveFincaId(fincaId);
          localStorage.setItem(ACTIVE_FINCA_KEY, fincaId);
        }
      }
    } catch { /* silently fail */ }
  }, []);

  const isLoading = firebaseUser === undefined;
  // An unverified session is authenticated at the Firebase layer but cannot
  // talk to the backend. It must be handled BEFORE needsOrgSelection/needsSetup
  // (which assume a usable token), so those derive false while unverified.
  const needsEmailVerification = !!firebaseUser && !emailVerified && !isLoading;
  const isLoggedIn = !!firebaseUser && emailVerified && !!currentUser;
  const needsOrgSelection = !!firebaseUser && emailVerified && !activeFincaId && !isLoading;
  // Gated on a successful load: if we couldn't determine memberships (offline /
  // backend down), we don't claim the user has none — that would misroute a
  // user with orgs into /register. They fall to needsOrgSelection instead,
  // where OrganizationSelector re-attempts the fetch/claim.
  const needsSetup = !!firebaseUser && emailVerified && memberships.length === 0 && !membershipsLoadFailed && !isLoading;

  return (
    <UserContext.Provider value={{
      currentUser,
      firebaseUser,
      emailVerified,
      memberships,
      activeFincaId,
      login,
      loginWithGoogle,
      logout,
      selectFinca,
      refreshMemberships,
      refreshCurrentUser,
      refreshAfterVerification,
      isLoggedIn,
      isLoading,
      needsEmailVerification,
      needsOrgSelection,
      needsSetup,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
