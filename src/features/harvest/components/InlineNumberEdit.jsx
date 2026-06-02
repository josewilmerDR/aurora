import { useState, useEffect, useRef } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';
import { num } from '../lib/format';

// Editor inline de un valor numérico para celdas de tabla. Extraído de
// CosechaRegistro (antes vivía embebido en la página). Genérico y reutilizable.
// Resuelve, respecto del original:
//   · accesible por teclado: role=button + Enter/Space abren, Escape cancela (#5)
//   · validación client-side antes del PUT; si es inválido NO cierra (#22)
//   · guarda al perder foco (blur-to-commit), no quedan editores abiertos (#20/#21)
//   · merma/delta opcional contra un valor de referencia (#11)
// Puntos #5/#11/#16/#17/#20/#21/#22 audit.

const isEmpty = (v) => v == null || v === '';

export default function InlineNumberEdit({
  value,
  onSave,
  min = 0,
  max = Infinity,
  pendingLabel = 'Pendiente',
  ariaLabel,
  openHint = 'Clic para ingresar el valor',
  // Valor de referencia para mostrar la merma (ej. cantidad de campo). Si se
  // pasa, la celda muestra el % de diferencia bajo el número.
  compareTo = null,
  compareLabel = 'merma',
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [val, setVal]         = useState('');
  const [err, setErr]         = useState('');
  const inputRef     = useRef(null);
  const wrapRef      = useRef(null);
  const committedRef = useRef(false); // evita doble commit (blur + Enter/botón)

  const open  = () => { setVal(value ?? ''); setErr(''); committedRef.current = false; setEditing(true); };
  const close = () => { setEditing(false); setErr(''); };

  const validate = (raw) => {
    if (isEmpty(raw)) return null; // vacío = limpiar el valor (válido → null)
    const n = Number(raw);
    if (!Number.isFinite(n)) return 'Número inválido.';
    if (n < min) return `Debe ser ≥ ${min}.`;
    if (n >= max) return `Debe ser menor a ${max}.`;
    return null;
  };

  const commit = async () => {
    if (saving || committedRef.current) return;
    const msg = validate(val);
    if (msg) { setErr(msg); inputRef.current?.focus(); return; } // inválido → no cierra (#22)
    committedRef.current = true;
    setSaving(true);
    try {
      await onSave(val);
      close();
    } catch {
      committedRef.current = false; // permitir reintento si el guardado falló
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { committedRef.current = true; close(); };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <span className="harvest-inline-edit" ref={wrapRef}>
        <input
          ref={inputRef}
          type="number"
          min={min}
          step="0.01"
          value={val}
          onChange={(e) => { setVal(e.target.value); if (err) setErr(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={(e) => {
            // Guarda al perder foco salvo que el foco vaya a un botón del propio
            // widget (esos lo manejan en su onClick). #20.
            if (wrapRef.current && wrapRef.current.contains(e.relatedTarget)) return;
            commit();
          }}
          className={`harvest-inline-input${err ? ' harvest-inline-input--error' : ''}`}
          aria-invalid={err ? 'true' : undefined}
          aria-label={ariaLabel}
          title={err || undefined}
          disabled={saving}
        />
        {/* onMouseDown preventDefault: mantiene el foco en el input para que el
            onBlur no dispare un commit antes del onClick del botón. */}
        <button
          type="button"
          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success harvest-inline-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          title="Guardar"
          aria-label="Guardar"
          disabled={saving}
        >
          <FiCheck size={13} />
        </button>
        <button
          type="button"
          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger harvest-inline-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          title="Cancelar"
          aria-label="Cancelar"
          disabled={saving}
        >
          <FiX size={13} />
        </button>
      </span>
    );
  }

  const pending = isEmpty(value);

  // Merma vs valor de referencia (#11): cuánto se perdió de campo a planta.
  let merma = null;
  const ref = Number(compareTo);
  if (!pending && Number.isFinite(ref) && ref > 0) {
    const pct = ((ref - Number(value)) / ref) * 100;
    const neg = pct < 0; // recibido > campo: físicamente sospechoso
    merma = (
      <span className={`harvest-merma${neg ? ' harvest-merma--warn' : ''}`}>
        {compareLabel} {neg ? '+' : ''}{Math.abs(pct).toFixed(0)}%
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={`harvest-inline-cell${merma ? ' harvest-inline-cell--col' : ''}${pending ? ' harvest-inline-cell--pending' : ''}`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      aria-label={ariaLabel}
      title={pending ? openHint : (merma ? `Recibido en planta — ${compareLabel} sobre ${num(compareTo)}` : openHint)}
    >
      <span>{pending ? pendingLabel : num(value)}</span>
      {merma}
    </span>
  );
}
