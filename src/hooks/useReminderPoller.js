import { useState, useEffect, useRef, useCallback } from 'react';
import { useApiFetch } from './useApiFetch';
import { useUser } from '../contexts/UserContext';

const POLL_INTERVAL = 60 * 1000; // 60 seconds

export function useReminderPoller() {
  const apiFetch = useApiFetch();
  const { isLoggedIn } = useUser();
  const [pendingReminders, setPendingReminders] = useState([]);
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;

  const checkDue = useCallback(async () => {
    try {
      const res = await apiFetchRef.current('/api/reminders/due');
      if (!res.ok) return;
      const due = await res.json();
      if (!Array.isArray(due) || due.length === 0) return;
      setPendingReminders(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newOnes = due.filter(r => !existingIds.has(r.id));
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
      });
    } catch {
      // Fail silently — must not interrupt the user
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    checkDue();
    const id = setInterval(checkDue, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [isLoggedIn, checkDue]);

  const dismissReminder = useCallback((id) => {
    setPendingReminders(prev => prev.filter(r => r.id !== id));
  }, []);

  return { pendingReminders, dismissReminder };
}
