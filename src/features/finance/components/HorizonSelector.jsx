import { useEffect, useRef, useState } from 'react';

const PRESETS = [
  { label: '4 sem',  value: 4  },
  { label: '13 sem', value: 13 },
  { label: '26 sem', value: 26 },
  { label: '52 sem', value: 52 },
];

// Debounce del input numérico: tipear "104" no debe disparar fetch para
// 1 → 10 → 104. Esperamos a que el usuario deje de teclear antes de commitear.
const TYPING_DEBOUNCE_MS = 400;

function HorizonSelector({ value, onChange, min = 1, max = 104, fallback = 26 }) {
  const [input, setInput] = useState(String(value));
  const debounceRef = useRef(null);

  // Sincroniza el input de texto cuando el valor cambia desde fuera (ej: preset).
  useEffect(() => { setInput(String(value)); }, [value]);

  // Limpia el timer pendiente al desmontar.
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleChange = (e) => {
    const raw = e.target.value;
    setInput(raw);
    clearTimeout(debounceRef.current);
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n) && n >= min && n <= max) {
      debounceRef.current = setTimeout(() => onChange(n), TYPING_DEBOUNCE_MS);
    }
  };

  const handleBlur = () => {
    clearTimeout(debounceRef.current);
    const n = Number(input);
    if (input === '' || !Number.isFinite(n) || n < min || n > max) {
      onChange(fallback);
      setInput(String(fallback));
    } else {
      onChange(n);
      setInput(String(n));
    }
  };

  const applyPreset = (n) => {
    clearTimeout(debounceRef.current);
    onChange(n);
  };

  return (
    <div className="horizon-selector">
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="horizon-weeks">Horizonte (semanas)</label>
        <input
          id="horizon-weeks"
          type="number"
          className="aur-input aur-input--num"
          min={min}
          max={max}
          value={input}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-describedby="horizon-weeks-hint"
        />
        <span id="horizon-weeks-hint" className="aur-field-hint">
          Entre {min} y {max} semanas.
        </span>
      </div>
      <div className="horizon-preset-row">
        {PRESETS.map(p => (
          <button
            key={p.value}
            className={`horizon-preset-btn${value === p.value ? ' horizon-preset-btn--active' : ''}`}
            onClick={() => applyPreset(p.value)}
            aria-pressed={value === p.value}
            type="button"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default HorizonSelector;
