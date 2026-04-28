import { useState, useEffect, useCallback } from 'react';
import { FiCalendar, FiCompass, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX, FiList, FiGitMerge } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const fmtRange = (inicio, fin) => `${inicio} → ${fin}`;
const fmtKg = (kg) => {
  const v = Number(kg);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} kg`;
};

// Mapeo de origen/estado a variantes del sistema. Manual=trabajo humano,
// Auto=detectado por el agente, Archivada=preservada por integridad.
const SOURCE_BADGE_VARIANT = {
  manual: 'aur-badge--green',
  auto: 'aur-badge--violet',
};
const STATUS_BADGE_VARIANT = {
  archived: 'aur-badge--gray',
};

function emptyForm() {
  return { id: null, nombre: '', fechaInicio: '', fechaFin: '', notas: '' };
}

function TemporadasManager() {
  const apiFetch = useApiFetch();
  const [temporadas, setTemporadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch('/api/analytics/temporadas')
      .then(r => r.json())
      .then(data => setTemporadas(Array.isArray(data) ? data : []))
      .catch(() => setToast({ type: 'error', message: 'No se pudieron cargar las temporadas.' }))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const runDetect = async () => {
    setDetecting(true);
    try {
      const res = await apiFetch('/api/analytics/temporadas/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'detect failed');
      setProposals(data);
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo detectar.' });
    } finally {
      setDetecting(false);
    }
  };

  const acceptProposal = async (p) => {
    if (p.existing) return;
    try {
      const res = await apiFetch('/api/analytics/temporadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: p.nombre,
          fechaInicio: p.fechaInicio,
          fechaFin: p.fechaFin,
          autoDetected: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'create failed');
      setProposals(prev => prev && {
        ...prev,
        proposals: prev.proposals.map(x =>
          x.fechaInicio === p.fechaInicio && x.fechaFin === p.fechaFin
            ? { ...x, existing: true, temporadaId: data.id }
            : x
        ),
      });
      load();
      setToast({ type: 'success', message: `Temporada "${p.nombre}" creada.` });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo crear.' });
    }
  };

  const handleSave = async () => {
    if (!form.nombre?.trim() || !form.fechaInicio || !form.fechaFin) {
      setToast({ type: 'error', message: 'Nombre, fecha inicio y fin son requeridos.' });
      return;
    }
    setSaving(true);
    try {
      const url = form.id ? `/api/analytics/temporadas/${form.id}` : '/api/analytics/temporadas';
      const method = form.id ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: form.nombre.trim(),
          fechaInicio: form.fechaInicio,
          fechaFin: form.fechaFin,
          notas: form.notas || null,
          autoDetected: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'save failed');
      setForm(null);
      load();
      setToast({ type: 'success', message: form.id ? 'Temporada actualizada.' : 'Temporada creada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo guardar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setConfirmDelete(null);
    try {
      const res = await apiFetch(`/api/analytics/temporadas/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'delete failed');
      load();
      setToast({
        type: 'success',
        message: data.deleted ? 'Temporada eliminada.' : 'Temporada archivada.',
      });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo eliminar.' });
    }
  };

  const isEditing = !!form?.id;

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiCalendar /> Temporadas</h2>
          <p className="aur-sheet-subtitle">
            Ciclos productivos usados por el análisis de rendimiento. Puedes detectarlas automáticamente a partir
            de los registros de cosecha o crearlas manualmente.
          </p>
        </div>
        <div className="aur-sheet-header-actions">
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={runDetect}
            disabled={detecting}
          >
            <FiCompass size={14} /> {detecting ? 'Detectando…' : 'Detectar temporadas'}
          </button>
          {!form && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setForm(emptyForm())}
            >
              <FiPlus size={14} /> Nueva temporada
            </button>
          )}
        </div>
      </header>

      {proposals && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiGitMerge size={14} /></span>
            <h3 className="aur-section-title">Propuestas detectadas</h3>
            {proposals.proposals.length > 0 && (
              <span className="aur-section-count">{proposals.proposals.length}</span>
            )}
            <div className="aur-section-actions">
              <span className="strategy-meta-text">
                {proposals.totalRegistros} registros analizados
              </span>
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={() => setProposals(null)}
                title="Cerrar propuestas"
              >
                <FiX size={14} />
              </button>
            </div>
          </div>

          {proposals.proposals.length === 0 ? (
            <p className="strategy-empty">
              No se detectaron temporadas con los registros actuales. Necesitas al menos 3 cosechas en ≥ 45 días sin
              huecos de 30+ días.
            </p>
          ) : (
            <div className="aur-list">
              {proposals.proposals.map(p => (
                <div
                  key={`${p.fechaInicio}_${p.fechaFin}`}
                  className={`aur-row strategy-item-row${p.existing ? ' is-archived' : ''}`}
                >
                  <div className="strategy-item-info">
                    <div className="strategy-item-head">
                      <span className="strategy-item-title">{p.nombre}</span>
                      {p.existing && <span className="aur-badge aur-badge--green">Ya registrada</span>}
                    </div>
                    <div className="strategy-item-sub">{fmtRange(p.fechaInicio, p.fechaFin)}</div>
                    <div className="strategy-item-meta">
                      {p.nRegistros} cosechas · {fmtKg(p.totalKg)}
                    </div>
                  </div>
                  <div className="strategy-item-actions">
                    {!p.existing && (
                      <button
                        type="button"
                        className="aur-btn-pill aur-btn-pill--sm"
                        onClick={() => acceptProposal(p)}
                      >
                        <FiCheck size={14} /> Aceptar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {form && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiCalendar size={14} /></span>
            <h3 className="aur-section-title">{isEditing ? 'Editar temporada' : 'Nueva temporada'}</h3>
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
              <label className="aur-row-label" htmlFor="tm-nombre">Nombre</label>
              <div className="aur-field">
                <input
                  id="tm-nombre"
                  type="text"
                  className="aur-input"
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="2024-A"
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="tm-desde">Desde</label>
              <div className="aur-field">
                <input
                  id="tm-desde"
                  type="date"
                  className="aur-input"
                  value={form.fechaInicio}
                  onChange={e => setForm({ ...form, fechaInicio: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="tm-hasta">Hasta</label>
              <div className="aur-field">
                <input
                  id="tm-hasta"
                  type="date"
                  className="aur-input"
                  value={form.fechaFin}
                  onChange={e => setForm({ ...form, fechaFin: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="tm-notas">Notas</label>
              <div className="aur-field">
                <input
                  id="tm-notas"
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
          <h3 className="aur-section-title">Temporadas registradas</h3>
          {temporadas.length > 0 && <span className="aur-section-count">{temporadas.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : temporadas.length === 0 ? (
          <p className="strategy-empty">Todavía no hay temporadas. Detecta o crea una para empezar.</p>
        ) : (
          <div className="aur-list">
            {temporadas.map(t => {
              const archived = t.status === 'archived';
              return (
                <div
                  key={t.id}
                  className={`aur-row strategy-item-row${archived ? ' is-archived' : ''}`}
                >
                  <div className="strategy-item-info">
                    <div className="strategy-item-head">
                      <span className="strategy-item-title">{t.nombre}</span>
                      <span className={`aur-badge ${SOURCE_BADGE_VARIANT[t.autoDetected ? 'auto' : 'manual']}`}>
                        {t.autoDetected ? 'Auto' : 'Manual'}
                      </span>
                      {archived && (
                        <span className={`aur-badge ${STATUS_BADGE_VARIANT.archived}`}>Archivada</span>
                      )}
                    </div>
                    <div className="strategy-item-sub">{fmtRange(t.fechaInicio, t.fechaFin)}</div>
                    {t.notas && <div className="strategy-item-meta">{t.notas}</div>}
                  </div>
                  <div className="strategy-item-actions">
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm"
                      title="Editar"
                      onClick={() => setForm({
                        id: t.id,
                        nombre: t.nombre,
                        fechaInicio: t.fechaInicio,
                        fechaFin: t.fechaFin,
                        notas: t.notas || '',
                      })}
                    >
                      <FiEdit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                      title={t.autoDetected ? 'Eliminar' : 'Archivar'}
                      onClick={() => setConfirmDelete(t)}
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title={confirmDelete.autoDetected ? 'Eliminar temporada' : 'Archivar temporada'}
          body={
            confirmDelete.autoDetected
              ? `Se eliminará "${confirmDelete.nombre}". Puedes volver a detectarla cuando quieras.`
              : `Se archivará "${confirmDelete.nombre}" (preserva el historial de decisiones que la referenciaron).`
          }
          confirmLabel={confirmDelete.autoDetected ? 'Eliminar' : 'Archivar'}
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default TemporadasManager;
