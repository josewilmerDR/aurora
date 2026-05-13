import { useState, useEffect } from 'react';

const PRESETS = [
  { label: '4 sem',  value: 4  },
  { label: '13 sem', value: 13 },
  { label: '26 sem', value: 26 },
  { label: '52 sem', value: 52 },
];

function HorizonSelector({ value, onChange, min = 1, max = 104, fallback = 26 }) {
  const [input, setInput] = useState(String(value));

  // Sincroniza el input de texto cuando el valor cambia desde fuera (ej: preset).
  useEffect(() => { setInput(String(value)); }, [value]);

  const handleChange = (e) => {
    const raw = e.target.value;
    setInput(raw);
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n) && n >= min && n <= max) {
      onChange(n);
    }
  };

  const handleBlur = () => {
    const n = Number(input);
    if (input === '' || !Number.isFinite(n) || n < min || n > max) {
      onChange(fallback);
      setInput(String(fallback));
    } else {
      setInput(String(n));
    }
  };

  const applyPreset = (n) => {
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
        />
      </div>
      <div className="horizon-preset-row">
        {PRESETS.map(p => (
          <button
            key={p.value}
            className={`horizon-preset-btn${value === p.value ? ' horizon-preset-btn--active' : ''}`}
            onClick={() => applyPreset(p.value)}
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
