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
  administrador: 4,
};

export const ROLE_LABELS = {
  trabajador: 'Trabajador',
  encargado: 'Encargado',
  supervisor: 'Supervisor',
  administrador: 'Administrador',
};

export function hasMinRole(userRole, minRole) {
  return (ROLE_LEVELS[userRole] || 0) >= (ROLE_LEVELS[minRole] || 0);
}

const UserContext = createContext(null);

const ACTIVE_FINCA_KEY = 'aurora_active_finca';

export function UserProvider({ children }) {
  // firebaseUser: usuario de Firebase Auth (o null)
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = cargando
  // memberships: lista de fincas a las que pertenece el usuario
  const [memberships, setMemberships] = useState([]);
  // activeFincaId: finca seleccionada actualmente
  const [activeFincaId, setActiveFincaId] = useState(() => localStorage.getItem(ACTIVE_FINCA_KEY));
  // currentUser: perfil del usuario en la finca activa { nombre, rol, telefono, ... }
  const [currentUser, setCurrentUser] = useState(null);

  // Escucha cambios de sesión de Firebase Auth
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
      // Cargar membresías ANTES de setear firebaseUser para evitar un render
      // intermedio donde memberships=[] y needsSetup=true causa redirect a /register
      try {
        const res = await apiFetch('/api/auth/memberships');
        if (res.ok) {
          const data = await res.json();
          setMemberships(data.memberships || []);
          // Si solo tiene una finca, activarla automáticamente
          if ((data.memberships || []).length === 1) {
            const fincaId = data.memberships[0].fincaId;
            setActiveFincaId(fincaId);
            localStorage.setItem(ACTIVE_FINCA_KEY, fincaId);
          }
        }
      } catch {
        // Si falla, dejar sin membresías (el usuario verá la pantalla de setup)
      }
      // Setear firebaseUser al final: isLoading queda true hasta aquí,
      // evitando que ProtectedRoute tome decisiones con estado incompleto
      setFirebaseUser(fbUser);
    });
    return unsubscribe;
  }, []);

  // Cuando cambia la finca activa, cargar el perfil del usuario en esa finca
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

  // Recarga las membresías desde la API (útil después de crear una nueva finca)
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
  const needsFincaSelection = !!firebaseUser && memberships.length > 1 && !activeFincaId;
  const needsSetup = !!firebaseUser && memberships.length === 0 && !isLoading;

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
      isLoggedIn,
      isLoading,
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
