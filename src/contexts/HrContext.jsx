import { createContext, useContext, useState, useCallback, useMemo } from 'react';

// Contexto de dominio HR: mantiene el "empleado activo" entre las páginas de
// Recursos Humanos (Ficha, Asistencia, Permisos, Planilla). Sin esto cada
// página arrancaba de cero y el usuario re-buscaba a la misma persona en cada
// pantalla. El provider se monta una vez (envolviendo MainLayout) y vive a lo
// largo de toda la navegación; el respaldo en sessionStorage sólo sirve para
// sobrevivir un refresh dentro de la misma sesión (no se filtra entre sesiones).
const STORAGE_KEY = 'aurora_hr_active_employee';

const HrContext = createContext(null);

// Fallback estable para uso fuera del provider (tests / render aislado): las
// páginas degradan a "sin empleado activo" sin romperse. Es una constante para
// no generar un objeto nuevo en cada render (evita loops en deps de efectos).
const NOOP_CTX = Object.freeze({
  activeEmployeeId: null,
  setActiveEmployee: () => {},
  clearActiveEmployee: () => {},
});

export function HrProvider({ children }) {
  const [activeEmployeeId, setActiveEmployeeIdState] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
  });

  const setActiveEmployee = useCallback((id) => {
    const next = id || null;
    setActiveEmployeeIdState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, next);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* sessionStorage no disponible: el estado en memoria igual sirve */ }
  }, []);

  const clearActiveEmployee = useCallback(() => setActiveEmployee(null), [setActiveEmployee]);

  const value = useMemo(
    () => ({ activeEmployeeId, setActiveEmployee, clearActiveEmployee }),
    [activeEmployeeId, setActiveEmployee, clearActiveEmployee]
  );

  return <HrContext.Provider value={value}>{children}</HrContext.Provider>;
}

export function useHrActiveEmployee() {
  return useContext(HrContext) || NOOP_CTX;
}
