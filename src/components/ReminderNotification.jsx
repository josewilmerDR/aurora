import { createPortal } from 'react-dom';
import { FiBell, FiX } from 'react-icons/fi';
import { formatReminderDate } from '../lib/reminderFormat';
import './ReminderNotification.css';

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
            <p className="reminder-time">{formatReminderDate(r.remindAt)}</p>
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
