import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from './UserContext';

const TICK_INTERVAL = 30 * 1000; // recompute overdue cutoff every 30s

const RemindersContext = createContext(null);

export function RemindersProvider({ children }) {
  const { isLoggedIn } = useUser();
  const apiFetch = useApiFetch();
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const [reminders, setReminders] = useState([]);
  const [doneReminders, setDoneReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    // Distinguir "sin recordatorios" de "no se pudo cargar": si el GET de
    // pendientes falla, marcamos error para que Profile no muestre un
    // empty-state falso (el usuario sí tiene recordatorios, no los pudimos leer).
    let ok = true;
    try {
      const [pendingRes, doneRes] = await Promise.all([
        apiFetchRef.current('/api/reminders'),
        apiFetchRef.current('/api/reminders/done'),
      ]);
      if (pendingRes.ok) setReminders(await pendingRes.json());
      else ok = false;
      if (doneRes.ok) setDoneReminders(await doneRes.json());
    } catch { ok = false; } finally {
      setError(!ok);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setReminders([]);
      setDoneReminders([]);
      setLoading(false);
      return;
    }
    load();
  }, [isLoggedIn, load]);

  // Tick to recompute overdue count without re-fetching — time marches on even
  // when the reminder list stays the same.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const overdueCount = useMemo(
    () => reminders.filter(r => new Date(r.remindAt).getTime() <= now).length,
    [reminders, now],
  );

  const value = useMemo(() => ({
    reminders, setReminders,
    doneReminders, setDoneReminders,
    loading,
    error,
    overdueCount,
    reload: load,
  }), [reminders, doneReminders, loading, error, overdueCount, load]);

  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}

export function useReminders() {
  const ctx = useContext(RemindersContext);
  if (!ctx) throw new Error('useReminders must be used within a RemindersProvider');
  return ctx;
}
