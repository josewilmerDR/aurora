import { useState, useEffect, useCallback } from 'react';
import { FiCalendar, FiCompass, FiEdit2, FiTrash2, FiPlus, FiCheck, FiX } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import { useApiFetch } from '../../hooks/useApiFetch';
import './strategy.css';

// Formateos compartidos.
const fmtRange = (inicio, fin) => `${inicio} → ${fin}`;
const fmtKg = (kg) => {
  const v = Number(kg);
  if (!Number.isFinite(v)) return '—';
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} kg`;
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

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiCalendar /> Temporadas</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Ciclos productivos usados por el análisis de rendimiento. Puedes detectarlas automáticamente a partir de
        los registros de cosecha o crearlas manualmente.
      </p>

      <div className="temporadas-header-actions">
        <button
          className="primary-button"
          onClick={runDetect}
          disabled={detecting}
        >
          <FiCompass /> {detecting ? 'Detectando…' : 'Detectar temporadas'}
        </button>
        <button
          className="primary-button"
          onClick={() => setForm(emptyForm())}
        >
          <FiPlus /> Nueva temporada
        </button>
      </div>

      {proposals && (
        <div style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '10px 0', fontSize: 14, opacity: 0.75 }}>
            Propuestas ({proposals.proposals.length}) — {proposals.totalRegistros} registros analizados
          </h3>
          {proposals.proposals.length === 0 ? (
            <div className="strategy-empty">
              No se detectaron temporadas con los registros actuales. Necesitas al menos 3 cosechas en ≥ 45 días sin huecos de 30+ días.
            </div>
          ) : (
            <div className="temporada-proposal-list">
              {proposals.proposals.map(p => (
                <div
                  key={`${p.fechaInicio}_${p.fechaFin}`}
                  className={`temporada-proposal ${p.existing ? 'temporada-proposal--existing' : ''}`}
                >
                  <div>
                    <div className="temporada-card-header">
                      <span className="temporada-name">{p.nombre}</span>
                      {p.existing && <span className="temporada-badge temporada-badge--manual">Ya registrada</span>}
                    </div>
                    <div className="temporada-range">{fmtRange(p.fechaInicio, p.fechaFin)}</div>
                    <div className="temporada-meta">
                      {p.nRegistros} cosechas · {fmtKg(p.totalKg)}
                    </div>
                  </div>
                  <div className="temporada-actions">
                    {!p.existing && (
                      <button className="primary-button" onClick={() => acceptProposal(p)}>
                        <FiCheck /> Aceptar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            className="primary-button"
            style={{ marginTop: 12 }}
            onClick={() => setProposals(null)}
          >
            <FiX /> Cerrar propuestas
          </button>
        </div>
      )}

      {form && (
        <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
          <div>
            <div className="strategy-filters">
              <div className="strategy-field">
                <label>Nombre</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="2024-A"
                />
              </div>
              <div className="strategy-field">
                <label>Desde</label>
                <input
                  type="date"
                  value={form.fechaInicio}
                  onChange={e => setForm({ ...form, fechaInicio: e.target.value })}
                />
              </div>
              <div className="strategy-field">
                <label>Hasta</label>
                <input
                  type="date"
                  value={form.fechaFin}
                  onChange={e => setForm({ ...form, fechaFin: e.target.value })}
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
      ) : temporadas.length === 0 ? (
        <div className="strategy-empty">Todavía no hay temporadas. Detecta o crea una para empezar.</div>
      ) : (
        <div className="temporadas-list">
          {temporadas.map(t => (
            <div
              key={t.id}
              className={`temporada-card ${t.status === 'archived' ? 'temporada-card--archived' : ''}`}
            >
              <div>
                <div className="temporada-card-header">
                  <span className="temporada-name">{t.nombre}</span>
                  <span className={`temporada-badge temporada-badge--${t.autoDetected ? 'auto' : 'manual'}`}>
                    {t.autoDetected ? 'Auto' : 'Manual'}
                  </span>
                  {t.status === 'archived' && (
                    <span className="temporada-badge temporada-badge--archived">Archivada</span>
                  )}
                </div>
                <div className="temporada-range">{fmtRange(t.fechaInicio, t.fechaFin)}</div>
                {t.notas && <div className="temporada-meta">{t.notas}</div>}
              </div>
              <div className="temporada-actions">
                <button
                  className="primary-button"
                  onClick={() => setForm({
                    id: t.id,
                    nombre: t.nombre,
                    fechaInicio: t.fechaInicio,
                    fechaFin: t.fechaFin,
                    notas: t.notas || '',
                  })}
                >
                  <FiEdit2 />
                </button>
                <button
                  className="primary-button"
                  onClick={() => setConfirmDelete(t)}
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
          title={confirmDelete.autoDetected ? 'Eliminar temporada' : 'Archivar temporada'}
          message={
            confirmDelete.autoDetected
              ? `Se eliminará "${confirmDelete.nombre}". Puedes volver a detectarla cuando quieras.`
              : `Se archivará "${confirmDelete.nombre}" (preserva el historial de decisiones que la referenciaron).`
          }
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default TemporadasManager;
