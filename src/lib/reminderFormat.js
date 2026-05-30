// Formato compartido de fecha/hora de recordatorios. Centraliza el helper que
// vivía duplicado en Profile.jsx y ReminderNotification.jsx — mismo locale
// es-CR, la convención del resto del codebase (formatMoney, parameters, etc.).
export function formatReminderDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('es-CR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
