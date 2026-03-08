import { createContext, useContext, useState, useCallback } from 'react';
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

const STORAGE_KEY = 'aurora_current_user';

export function UserProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback(async (userId) => {
    const res = await fetch('/api/users');
    const users = await res.json();
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuario no encontrado');
    const userData = { ...user, rol: user.rol || 'trabajador' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(userData));
    setCurrentUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    clearAllDrafts();
    setCurrentUser(null);
  }, []);

  const isLoggedIn = currentUser !== null;

  return (
    <UserContext.Provider value={{ currentUser, login, logout, isLoggedIn }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
