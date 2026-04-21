import { useState } from 'react';

// Input numérico acotado para el horizonte de proyección.
// Encapsula la lógica de estado dual (string en edición + number confirmado)
// para que el usuario pueda borrar completamente e ingresar un nuevo valor
// sin que el input "rebote" al default.
function HorizonSelector({ value, onChange, min = 1, max = 104, fallback = 26 }) {
  const [input, setInput] = useState(String(value));

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

  return (
    <div className="finance-field">
      <label>Horizonte (semanas)</label>
      <input
        type="number"
        min={min}
        max={max}
        value={input}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  );
}

export default HorizonSelector;
