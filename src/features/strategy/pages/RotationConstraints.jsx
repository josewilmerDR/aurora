import { useState, useEffect, useCallback } from 'react';
import { FiShield, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import ConfirmModal from '../../../components/ConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

// Estado vacío del formulario.
function emptyForm() {
  return {
    id: null,
    cultivo: '',
    familiaBotanica: '',
    descansoMinCiclos: 0,
    descansoMinDias: 0,
    incompatibleCon: '',    // input como CSV; se parsea al enviar
    notas: '',
  };
}

function parseIncompatibleCon(s) {
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean);
}

function RotationConstraints() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/strategy/rotation-constraints')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las restricciones.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.cultivo?.trim() || !form.familiaBotanica?.trim()) {
      setToast({ type: 'error', message: 'Cultivo y familia botánica son requeridos.' });
      return;
    }
    setSaving(true);
    try {
      const url = form.id
        ? `/api/strategy/rotation-constraints/${form.id}`
        : '/api/strategy/rotation-constraints';
      const method = form.id ? 'PUT' : 'POST';
      const payload = {
        cultivo: form.cultivo.trim(),
        familiaBotanica: form.familiaBotanica.trim(),
        descansoMinCiclos: Number(form.descansoMinCiclos) || 0,
        descansoMinDias: Number(form.descansoMinDias) || 0,
        incompatibleCon: parseIncompatibleCon(form.incompatibleCon),
        notas: form.notas || null,
      };
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'save failed');
      setForm(null);
      load();
      setToast({ type: 'success', message: form.id ? 'Restricción actualizada.' : 'Restricción creada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo guardar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setConfirmDelete(null);
    try {
      const res = await apiFetch(`/api/strategy/rotation-constraints/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'delete failed');
      load();
      setToast({ type: 'success', message: 'Restricción eliminada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo eliminar.' });
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiShield /> Restricciones de Rotación</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Reglas agronómicas usadas por el recomendador de rotación: familia botánica, descanso mínimo entre ciclos
        del mismo cultivo y cultivos incompatibles. La carga inicial la hace un agrónomo; el agente las respeta al
        proponer rotaciones.
      </p>

      <div className="temporadas-header-actions">
        <button className="primary-button" onClick={() => setForm(emptyForm())}>
          <FiPlus /> Nueva restricción
        </button>
      </div>

      {form && (
        <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
          <div>
            <div className="strategy-filters">
              <div className="strategy-field">
                <label>Cultivo</label>
                <input
                  type="text"
                  value={form.cultivo}
                  onChange={e => setForm({ ...form, cultivo: e.target.value })}
                  placeholder="I Cosecha, Tomate, etc."
                />
              </div>
              <div className="strategy-field">
                <label>Familia botánica</label>
                <input
                  type="text"
                  value={form.familiaBotanica}
                  onChange={e => setForm({ ...form, familiaBotanica: e.target.value })}
                  placeholder="Solanaceae, Asteraceae…"
                />
              </div>
              <div className="strategy-field">
                <label>Descanso mín. ciclos</label>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={form.descansoMinCiclos}
                  onChange={e => setForm({ ...form, descansoMinCiclos: e.target.value })}
                />
              </div>
              <div className="strategy-field">
                <label>Descanso mín. días</label>
                <input
                  type="number"
                  min={0}
                  max={1095}
                  value={form.descansoMinDias}
                  onChange={e => setForm({ ...form, descansoMinDias: e.target.value })}
                />
              </div>
              <div className="strategy-field" style={{ flex: '1 1 260px' }}>
                <label>Incompatible con (coma separado)</label>
                <input
                  type="text"
                  value={form.incompatibleCon}
                  onChange={e => setForm({ ...form, incompatibleCon: e.target.value })}
                  placeholder="papa, berenjena"
                />
              </div>
              <div className="strategy-field" style={{ flex: '1 1 260px' }}>
                <label>Notas</label>
                <input
                  type="text"
                  maxLength={512}
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                />
              </div>
            </div>
            <div className="temporadas-header-actions" style={{ marginTop: 8, marginBottom: 0 }}>
              <button className="primary-button" onClick={handleSave} disabled={saving}>
                <FiCheck /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
              <button className="primary-button" onClick={() => setForm(null)}>
                <FiX /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="strategy-empty">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="strategy-empty">
          Todavía no hay restricciones cargadas. El recomendador usará criterio conservador hasta que registres al menos una.
        </div>
      ) : (
        <div className="temporadas-list">
          {items.map(c => (
            <div key={c.id} className="temporada-card">
              <div>
                <div className="temporada-card-header">
                  <span className="temporada-name">{c.cultivo}</span>
                  <span className="temporada-badge temporada-badge--manual">{c.familiaBotanica}</span>
                </div>
                <div className="temporada-range">
                  Descanso: {c.descansoMinCiclos || 0} ciclo(s) · {c.descansoMinDias || 0} día(s)
                </div>
                {Array.isArray(c.incompatibleCon) && c.incompatibleCon.length > 0 && (
                  <div className="temporada-meta">
                    Incompatible con: {c.incompatibleCon.join(', ')}
                  </div>
                )}
                {c.notas && <div className="temporada-meta">{c.notas}</div>}
              </div>
              <div className="temporada-actions">
                <button
                  className="primary-button"
                  onClick={() => setForm({
                    id: c.id,
                    cultivo: c.cultivo,
                    familiaBotanica: c.familiaBotanica,
                    descansoMinCiclos: c.descansoMinCiclos || 0,
                    descansoMinDias: c.descansoMinDias || 0,
                    incompatibleCon: (c.incompatibleCon || []).join(', '),
                    notas: c.notas || '',
                  })}
                >
                  <FiEdit2 />
                </button>
                <button
                  className="primary-button"
                  onClick={() => setConfirmDelete(c)}
                >
                  <FiTrash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmDelete && (
        <ConfirmModal
          title="Eliminar restricción"
          message={`Se eliminará la restricción para "${confirmDelete.cultivo}".`}
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default RotationConstraints;
