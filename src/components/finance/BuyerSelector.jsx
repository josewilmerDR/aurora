import { useEffect, useState } from 'react';
import { useApiFetch } from '../../hooks/useApiFetch';

// Select reusable — carga compradores activos y emite el id seleccionado.
function BuyerSelector({ value, onChange, required = false, disabled = false }) {
  const apiFetch = useApiFetch();
  const [buyers, setBuyers] = useState([]);

  useEffect(() => {
    apiFetch('/api/buyers')
      .then(r => r.json())
      .then(data => setBuyers(Array.isArray(data) ? data.filter(b => b.status !== 'inactivo') : []))
      .catch(() => setBuyers([]));
  }, [apiFetch]);

  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
    >
      <option value="">Seleccione un comprador…</option>
      {buyers.map(b => (
        <option key={b.id} value={b.id}>
          {b.name}
          {b.paymentType === 'credito' ? ` (${b.creditDays}d)` : ''}
        </option>
      ))}
    </select>
  );
}

export default BuyerSelector;
