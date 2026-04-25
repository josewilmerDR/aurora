import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { FiClock } from 'react-icons/fi';

/**
 * AuroraTimePicker — input de hora con dropdown de atajos.
 *
 * Recreates the time-picker UX from RegistroHorimetro as a reusable primitive:
 * native `<input type="time">` + a clock-icon trigger that opens a floating
 * panel with shortcuts (Hora actual + offsets ±1m/±5m/±15m/±30m/±1h).
 *
 * Stateless except for dropdown open/position. Time value is fully controlled
 * by the parent via `value` + `onChange`.
 *
 * Props:
 *   - value         string · 'HH:MM' o '' (controlled)
 *   - onChange      fn(string) · llamado con el nuevo valor
 *   - name          string · atributo name del input (opcional, para forms nativos)
 *   - id            string · si se omite, se genera uno con useId
 *   - min           string · tope inferior 'HH:MM' (browser-level + visual hint)
 *   - max           string · tope superior 'HH:MM'
 *   - hasError      bool · marca el input con borde magenta
 *   - disabled      bool
 *   - placeholder   string · placeholder del input nativo
 *
 * Uso típico:
 *   <AuroraTimePicker value={horaInicio} onChange={setHoraInicio} />
 *   <AuroraTimePicker
 *     value={horaFinal}
 *     onChange={setHoraFinal}
 *     min={horaInicio}
 *     hasError={horaInicio && horaFinal && horaFinal <= horaInicio}
 *   />
 */
const POS_OFFSETS = [
  { h: 1 / 60, label: '+1m'  },
  { h: 1 / 12, label: '+5m'  },
  { h: 0.25,   label: '+15m' },
  { h: 0.5,    label: '+30m' },
  { h: 1,      label: '+1h'  },
];

const NEG_OFFSETS = POS_OFFSETS.map(o => ({ h: -o.h, label: o.label.replace('+', '−') }));

export default function AuroraTimePicker({
  value = '',
  onChange,
  name,
  id,
  min,
  max,
  hasError = false,
  disabled = false,
  placeholder,
}) {
  const generatedId = useId();
  const inputId     = id || generatedId;
  const triggerRef  = useRef(null);
  const dropdownRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top: 0, bottom: 0, right: 0, openUp: false });

  // Cierra al hacer click fuera (input, trigger y dropdown excluidos)
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const togglePicker = () => {
    if (disabled) return;
    if (open) { setOpen(false); return; }
    const btn = triggerRef.current;
    if (btn) {
      const rect       = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownH  = 340; // approximate
      const openUp     = spaceBelow < dropdownH && spaceAbove > spaceBelow;
      setPos({
        top:    openUp ? 0                                  : rect.bottom + 4,
        bottom: openUp ? (window.innerHeight - rect.top + 4) : 0,
        right:  window.innerWidth - rect.right,
        openUp,
      });
    }
    setOpen(true);
  };

  const nowStr = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const setNow = () => {
    onChange?.(nowStr());
    setOpen(false);
  };

  const applyOffset = (hours) => {
    const base = value || nowStr();
    const [hB, mB]  = base.split(':').map(Number);
    const baseMin   = hB * 60 + mB;
    const totalMin  = baseMin + Math.round(hours * 60);
    // Wrap módulo 24h (negativo o positivo). 1440 = 24*60.
    const finMin    = ((totalMin % 1440) + 1440) % 1440;
    const result    = `${String(Math.floor(finMin / 60)).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}`;
    onChange?.(result);
  };

  return (
    <div className="aur-tp">
      <input
        type="time"
        id={inputId}
        name={name}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        placeholder={placeholder}
        className={`aur-input aur-tp-input${hasError ? ' aur-input--error' : ''}`}
      />
      <button
        type="button"
        ref={triggerRef}
        className={`aur-tp-trigger${open ? ' is-open' : ''}`}
        onClick={togglePicker}
        disabled={disabled}
        title="Opciones de hora"
        aria-label="Abrir atajos de hora"
      >
        <FiClock size={13} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="aur-tp-dropdown"
          style={{
            position: 'fixed',
            top:    pos.openUp ? 'auto' : pos.top,
            bottom: pos.openUp ? pos.bottom : 'auto',
            right:  pos.right,
            left:   'auto',
            zIndex: 9999,
          }}
        >
          <button type="button" className="aur-tp-item aur-tp-item--accent"
            onClick={setNow}>
            Hora actual
          </button>
          <div className="aur-tp-divider" />
          {POS_OFFSETS.map(({ h, label }) => (
            <button key={label} type="button" className="aur-tp-item aur-tp-item--pos"
              onClick={() => applyOffset(h)}>
              {label}
            </button>
          ))}
          <div className="aur-tp-divider" />
          {NEG_OFFSETS.map(({ h, label }) => (
            <button key={label} type="button" className="aur-tp-item aur-tp-item--neg"
              onClick={() => applyOffset(h)}>
              {label}
            </button>
          ))}
          <div className="aur-tp-divider" />
          <button type="button" className="aur-tp-item"
            onClick={() => setOpen(false)}>
            Cerrar
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
