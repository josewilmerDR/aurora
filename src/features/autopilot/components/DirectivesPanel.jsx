import { useState, useEffect } from 'react';
import { FiSliders, FiPlus, FiTrash2 } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

/**
 * Self-contained "Mis preferencias" card. Loads the current user's directives
 * from /api/autopilot/directives on mount and handles add/delete internally.
 * Renders as an aur-section so it integrates with the Apple-inspired Config
 * page layout (aur-section + aur-list).
 */
export default function DirectivesPanel() {
  const apiFetch = useApiFetch();
  const [directives, setDirectives] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/autopilot/directives');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setDirectives(Array.isArray(data) ? data : []);
        }
      } catch (_) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [apiFetch]);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/autopilot/directives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'No se pudo guardar la preferencia.');
      setDirectives(prev => [data, ...prev]);
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/autopilot/directives/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar la preferencia.');
      setDirectives(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num"><FiSliders size={14} /></span>
        <h3>Mis preferencias</h3>
        <span className="aur-section-count">{directives.length}</span>
      </div>
      <p className="ap-section-intro">
        Reglas firmes que Aurora Copilot respetará siempre. Úsalas para indicar preferencias o restricciones fuertes: qué priorizar, qué evitar o qué tono usar en las recomendaciones.
      </p>

      <div className="ap-directives-add">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder='Ej: "Prioriza compras locales sobre importadas"'
          maxLength={300}
          className="aur-input ap-directives-input"
        />
        <button
          type="button"
          className="aur-btn-pill"
          onClick={handleAdd}
          disabled={saving || !draft.trim()}
        >
          <FiPlus size={14} /> Añadir
        </button>
      </div>

      {error && (
        <p className="ap-directives-error">{error}</p>
      )}

      {directives.length === 0 ? (
        <p className="ap-directives-empty">
          Aún no tienes preferencias guardadas.
        </p>
      ) : (
        <ul className="ap-directives-list">
          {directives.map(d => (
            <li key={d.id} className="ap-directives-item">
              <span className="ap-directives-text">{d.text}</span>
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                onClick={() => handleDelete(d.id)}
                title="Eliminar preferencia"
                disabled={saving}
              >
                <FiTrash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
