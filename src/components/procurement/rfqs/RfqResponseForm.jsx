import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Inline form to log a supplier response to an RFQ. Dedupes on supplierId
// server-side so re-submitting replaces the prior entry.

function RfqResponseForm({ rfq, onSaved }) {
  const apiFetch = useApiFetch();
  const contacted = Array.isArray(rfq.suppliersContacted) ? rfq.suppliersContacted : [];
  const [supplierId, setSupplierId] = useState(contacted[0]?.supplierId || '');
  const [precio, setPrecio] = useState('');
  const [leadTime, setLeadTime] = useState('');
  const [disponible, setDisponible] = useState(true);
  const [notas, setNotas] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!supplierId) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        supplierId,
        disponible,
        precioUnitario: disponible ? Number(precio) : 0,
        leadTimeDays: leadTime === '' ? null : Number(leadTime),
        notas,
      };
      const r = await apiFetch(`/api/rfqs/${rfq.id}/respuesta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg);
      }
      setPrecio('');
      setLeadTime('');
      setNotas('');
      onSaved?.();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la respuesta.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rfq-response-form">
      <div className="rfq-response-row">
        <label>
          Proveedor
          <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
            {contacted.map(c => (
              <option key={c.supplierId} value={c.supplierId}>{c.supplierName}</option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={disponible}
            onChange={e => setDisponible(e.target.checked)}
          />
          {' '}Disponible
        </label>
      </div>

      {disponible && (
        <div className="rfq-response-row">
          <label>
            Precio unitario ({rfq.currency || 'USD'})
            <input
              type="number"
              step="0.01"
              min="0"
              value={precio}
              onChange={e => setPrecio(e.target.value)}
              required
            />
          </label>
          <label>
            Lead time (días)
            <input
              type="number"
              min="0"
              step="1"
              value={leadTime}
              onChange={e => setLeadTime(e.target.value)}
            />
          </label>
        </div>
      )}

      <label>
        Notas
        <input
          type="text"
          value={notas}
          onChange={e => setNotas(e.target.value)}
          maxLength={500}
          placeholder="opcional"
        />
      </label>

      {error && <div className="fin-widget-error">{error}</div>}
      <button type="submit" disabled={busy || !supplierId} className="rfq-primary-btn">
        <FiPlus size={12} /> {busy ? 'Guardando…' : 'Registrar respuesta'}
      </button>
    </form>
  );
}

export default RfqResponseForm;
