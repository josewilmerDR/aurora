import { useState, useEffect, useCallback } from 'react';
import { FiShield, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX, FiList } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

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

  const isEditing = !!form?.id;

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiShield /> Restricciones de Rotación</h2>
          <p className="aur-sheet-subtitle">
            Reglas agronómicas usadas por el recomendador de rotación: familia botánica, descanso mínimo entre
            ciclos del mismo cultivo y cultivos incompatibles. La carga inicial la hace un agrónomo; el agente las
            respeta al proponer rotaciones.
          </p>
        </div>
        {!form && (
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setForm(emptyForm())}
            >
              <FiPlus size={14} /> Nueva restricción
            </button>
          </div>
        )}
      </header>

      {form && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiShield size={14} /></span>
            <h3 className="aur-section-title">{isEditing ? 'Editar restricción' : 'Nueva restricción'}</h3>
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={() => setForm(null)}
                title="Cancelar"
              >
                <FiX size={14} />
              </button>
            </div>
          </div>

          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-cultivo">Cultivo</label>
              <div className="aur-field">
                <input
                  id="rc-cultivo"
                  type="text"
                  className="aur-input"
                  value={form.cultivo}
                  onChange={e => setForm({ ...form, cultivo: e.target.value })}
                  placeholder="I Cosecha, Tomate, etc."
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-familia">Familia botánica</label>
              <div className="aur-field">
                <input
                  id="rc-familia"
                  type="text"
                  className="aur-input"
                  value={form.familiaBotanica}
                  onChange={e => setForm({ ...form, familiaBotanica: e.target.value })}
                  placeholder="Solanaceae, Asteraceae…"
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-ciclos">Descanso mín. ciclos</label>
              <div className="aur-field">
                <input
                  id="rc-ciclos"
                  type="number"
                  min={0}
                  max={6}
                  className="aur-input aur-input--num"
                  value={form.descansoMinCiclos}
                  onChange={e => setForm({ ...form, descansoMinCiclos: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-dias">Descanso mín. días</label>
              <div className="aur-field">
                <input
                  id="rc-dias"
                  type="number"
                  min={0}
                  max={1095}
                  className="aur-input aur-input--num"
                  value={form.descansoMinDias}
                  onChange={e => setForm({ ...form, descansoMinDias: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-incomp">Incompatible con</label>
              <div className="aur-field">
                <input
                  id="rc-incomp"
                  type="text"
                  className="aur-input"
                  value={form.incompatibleCon}
                  onChange={e => setForm({ ...form, incompatibleCon: e.target.value })}
                  placeholder="papa, berenjena"
                />
                <p className="aur-field-hint">Lista separada por comas.</p>
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="rc-notas">Notas</label>
              <div className="aur-field">
                <input
                  id="rc-notas"
                  type="text"
                  className="aur-input"
                  maxLength={512}
                  value={form.notas}
                  onChange={e => setForm({ ...form, notas: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="aur-form-actions">
            <button
              type="button"
              className="aur-btn-text"
              onClick={() => setForm(null)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={handleSave}
              disabled={saving}
            >
              <FiCheck size={14} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </section>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Restricciones registradas</h3>
          {items.length > 0 && <span className="aur-section-count">{items.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="strategy-empty">
            Todavía no hay restricciones cargadas. El recomendador usará criterio conservador hasta que registres
            al menos una.
          </p>
        ) : (
          <div className="aur-list">
            {items.map(c => (
              <div key={c.id} className="aur-row strategy-item-row">
                <div className="strategy-item-info">
                  <div className="strategy-item-head">
                    <span className="strategy-item-title">{c.cultivo}</span>
                    <span className="aur-badge aur-badge--blue">{c.familiaBotanica}</span>
                  </div>
                  <div className="strategy-item-sub">
                    Descanso: {c.descansoMinCiclos || 0} ciclo(s) · {c.descansoMinDias || 0} día(s)
                  </div>
                  {Array.isArray(c.incompatibleCon) && c.incompatibleCon.length > 0 && (
                    <div className="strategy-item-meta">
                      Incompatible con: {c.incompatibleCon.join(', ')}
                    </div>
                  )}
                  {c.notas && <div className="strategy-item-meta">{c.notas}</div>}
                </div>
                <div className="strategy-item-actions">
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm"
                    title="Editar"
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
                    <FiEdit2 size={14} />
                  </button>
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                    title="Eliminar"
                    onClick={() => setConfirmDelete(c)}
                  >
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar restricción"
          body={`Se eliminará la restricción para "${confirmDelete.cultivo}".`}
          confirmLabel="Eliminar"
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default RotationConstraints;
