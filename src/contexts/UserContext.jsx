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
  // memberships: list of fincas the user belongs to
  const [memberships, setMemberships] = useState([]);
  // activeFincaId: currently selected finca
  const [activeFincaId, setActiveFincaId] = useState(() => localStorage.getItem(ACTIVE_FINCA_KEY));
  // currentUser: user profile in the active finca { nombre, rol, telefono, ... }
  const [currentUser, setCurrentUser] = useState(null);

  // Listen to Firebase Auth session changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setFirebaseUser(null);
        setMemberships([]);
        setCurrentUser(null);
        setActiveFincaId(null);
        localStorage.removeItem(ACTIVE_FINCA_KEY);
        return;
      }
      // Load memberships BEFORE setting firebaseUser to avoid an intermediate render
      // where memberships=[] and needsSetup=true would redirect to /register
      let membershipsData = [];
      try {
        const res = await apiFetch('/api/auth/memberships');
        if (res.ok) {
          const data = await res.json();
          membershipsData = data.memberships || [];
        }
      } catch { /* leave membershipsData empty */ }

      // Always claim email invitations — regardless of whether GET /memberships succeeded.
      // Covers first login (no memberships by UID) and users added to another org by an admin.
      try {
        const claimRes = await apiFetch('/api/auth/claim-invitations', { method: 'POST' });
        if (claimRes.ok) {
          const claimData = await claimRes.json();
          const claimed = claimData.memberships || [];
          // Append only memberships not already in the list (dedupe)
          const newOnes = claimed.filter(cm => !membershipsData.some(m => m.fincaId === cm.fincaId));
          if (newOnes.length > 0) membershipsData = [...membershipsData, ...newOnes];
        }
      } catch { /* silently fail */ }

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

      // Set firebaseUser last: isLoading stays true until this point,
      // preventing ProtectedRoute from deciding on incomplete state.
      setFirebaseUser(fbUser);
    });
    return unsubscribe;
  }, []);

  // When the user switches finca manually, reload their profile
  useEffect(() => {
    if (!firebaseUser || !activeFincaId) {
      setCurrentUser(null);
      return;
    }
    apiFetch('/api/auth/me', {}, activeFincaId)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCurrentUser(data))
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
  const isLoggedIn = !!firebaseUser && !!currentUser;
  const needsOrgSelection = !!firebaseUser && !activeFincaId && !isLoading;
  const needsSetup = !!firebaseUser && memberships.length === 0 && !isLoading;
  // kept for Register.jsx compatibility
  const needsFincaSelection = !!firebaseUser && memberships.length > 1 && !activeFincaId;

  return (
    <UserContext.Provider value={{
      currentUser,
      firebaseUser,
      memberships,
      activeFincaId,
      login,
      loginWithGoogle,
      logout,
      selectFinca,
      refreshMemberships,
      refreshCurrentUser,
      isLoggedIn,
      isLoading,
      needsOrgSelection,
      needsFincaSelection,
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
