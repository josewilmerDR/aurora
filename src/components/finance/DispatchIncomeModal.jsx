import { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import IncomeForm from './IncomeForm';
import { useApiFetch } from '../../hooks/useApiFetch';
import './DispatchIncomeModal.css';

// Modal que convierte un despacho en un income record pre-rellenado.
// Flujo: mount → GET draft → render IncomeForm → POST /api/income.
function DispatchIncomeModal({ dispatchId, onClose, onCreated, onError }) {
  const apiFetch = useApiFetch();
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!dispatchId) return;
    setLoading(true);
    setLoadError(null);
    apiFetch(`/api/income/draft-from-dispatch/${dispatchId}`)
      .then(async r => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.message || 'No se pudo generar el borrador.');
        }
        return r.json();
      })
      .then(data => setDraft(data.draft))
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [dispatchId, apiFetch]);

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al guardar el ingreso.');
      }
      const created = await res.json();
      onCreated?.(created);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card dispatch-income-modal-card" onClick={e => e.stopPropagation()}>
        <div className="dispatch-income-modal-header">
          <h3 className="modal-title">Registrar ingreso desde despacho</h3>
          <button className="dispatch-income-modal-close" onClick={onClose} title="Cerrar">
            <FiX size={18} />
          </button>
        </div>

        {loading && <p className="finance-empty">Cargando borrador…</p>}
        {loadError && <p className="finance-empty" style={{ color: '#ff8080' }}>{loadError}</p>}
        {!loading && !loadError && draft && (
          <IncomeForm
            initial={draft}
            onSubmit={handleSubmit}
            onCancel={onClose}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}

export default DispatchIncomeModal;
