import { createPortal } from 'react-dom';
import { FiBell, FiX } from 'react-icons/fi';
import './ReminderNotification.css';

function formatRemindAt(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-CR', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function ReminderNotification({ reminders, onDismiss }) {
  if (reminders.length === 0) return null;

  return createPortal(
    <div className="reminder-stack" role="region" aria-label="Recordatorios">
      {reminders.map(r => (
        <div key={r.id} className="reminder-card">
          <div className="reminder-icon">
            <FiBell size={16} />
          </div>
          <div className="reminder-body">
            <p className="reminder-label">Recordatorio</p>
            <p className="reminder-message">{r.message}</p>
            <p className="reminder-time">{formatRemindAt(r.remindAt)}</p>
          </div>
          <button
            className="reminder-close"
            onClick={() => onDismiss(r.id)}
            aria-label="Cerrar recordatorio"
          >
            <FiX size={15} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export default ReminderNotification;
