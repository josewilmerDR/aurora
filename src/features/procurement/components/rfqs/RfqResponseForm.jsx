import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

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
      <ul className="aur-list">
        <li className="aur-row">
          <span className="aur-row-label">Proveedor</span>
          <select
            className="aur-select"
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            required
          >
            {contacted.map(c => (
              <option key={c.supplierId} value={c.supplierId}>{c.supplierName}</option>
            ))}
          </select>
        </li>
        <li className="aur-row">
          <span className="aur-row-label">Disponible</span>
          <label className="aur-toggle">
            <input
              type="checkbox"
              checked={disponible}
              onChange={e => setDisponible(e.target.checked)}
            />
            <span className="aur-toggle-track" aria-hidden="true">
              <span className="aur-toggle-thumb" />
            </span>
            <span className="aur-toggle-label">{disponible ? 'Sí' : 'No'}</span>
          </label>
        </li>
        {disponible && (
          <>
            <li className="aur-row">
              <span className="aur-row-label">Precio unitario ({rfq.currency || 'USD'})</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="aur-input aur-input--num"
                value={precio}
                onChange={e => setPrecio(e.target.value)}
                required
              />
            </li>
            <li className="aur-row">
              <span className="aur-row-label">Lead time (días)</span>
              <input
                type="number"
                min="0"
                step="1"
                className="aur-input aur-input--num"
                value={leadTime}
                onChange={e => setLeadTime(e.target.value)}
              />
            </li>
          </>
        )}
        <li className="aur-row">
          <span className="aur-row-label">Notas</span>
          <input
            type="text"
            className="aur-input"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            maxLength={500}
            placeholder="opcional"
          />
        </li>
      </ul>

      {error && <div className="aur-banner aur-banner--danger">{error}</div>}

      <div className="aur-form-actions">
        <button type="submit" disabled={busy || !supplierId} className="aur-btn-pill">
          <FiPlus size={14} /> {busy ? 'Guardando…' : 'Registrar respuesta'}
        </button>
      </div>
    </form>
  );
}

export default RfqResponseForm;
