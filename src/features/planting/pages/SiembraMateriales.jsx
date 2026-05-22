import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiEdit2, FiCheck, FiX, FiArrowLeft } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';
import '../styles/siembra-materiales.css';

const EMPTY = { nombre: '', rangoPesos: '', variedad: '', densidadDefault: '' };

// Mirrors functions/routes/planting/schemas.js → materialInputSchema.
const TEXT_MAX = 32;

function toDensidadNumber(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Reads the response body once and returns a discriminated result. On non-2xx
// the error string is already translated to Spanish via translateApiError, so
// the caller can drop it straight into a toast.
async function readJsonResult(res, fallback) {
  let body = null;
  try { body = await res.json(); } catch { /* empty body — fine for 204 */ }
  if (!res.ok) return { ok: false, error: translateApiError(body, fallback) };
  return { ok: true, data: body };
}

function SiembraMateriales() {
  const apiFetch = useApiFetch();
  const [materiales, setMateriales] = useState([]);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ ...EMPTY });
  const [editingId, setEditingId]   = useState(null);
  const [editData, setEditData]     = useState({ ...EMPTY });
  const [toast, setToast]           = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [busy, setBusy]             = useState(false);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    apiFetch('/api/materiales-siembra')
      .then(r => r.json())
      .then(data => setMateriales(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.nombre.trim()) { showToast('El nombre es obligatorio.', 'error'); return; }
    setBusy(true);
    try {
      const densidadDefault = toDensidadNumber(form.densidadDefault);
      const res = await apiFetch('/api/materiales-siembra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, densidadDefault }),
      });
      const result = await readJsonResult(res, 'Error al crear material.');
      if (!result.ok) { showToast(result.error, 'error'); return; }
      const { id } = result.data || {};
      setMateriales(prev => [...prev, { id, ...form, densidadDefault }].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setForm({ ...EMPTY });
      setShowForm(false);
      showToast('Material creado.');
    } catch {
      showToast('Error al crear material.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (m) => {
    setEditingId(m.id);
    setEditData({
      nombre: m.nombre,
      rangoPesos: m.rangoPesos || '',
      variedad: m.variedad || '',
      densidadDefault: m.densidadDefault ? String(m.densidadDefault) : '',
    });
  };

  const saveEdit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const densidadDefault = toDensidadNumber(editData.densidadDefault);
      const res = await apiFetch(`/api/materiales-siembra/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editData, densidadDefault }),
      });
      const result = await readJsonResult(res, 'Error al actualizar.');
      if (!result.ok) { showToast(result.error, 'error'); return; }
      setMateriales(prev => prev.map(m => m.id === editingId ? { ...m, ...editData, densidadDefault } : m));
      setEditingId(null);
      showToast('Material actualizado.');
    } catch {
      showToast('Error al actualizar.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const askDelete = (m) => {
    setConfirmModal({
      danger: true,
      title: '¿Eliminar este material?',
      body: `"${m.nombre}" se quitará del catálogo. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      onConfirm: () => doDelete(m.id),
    });
  };

  const doDelete = async (id) => {
    if (busy) return;
    setBusy(true);
    // Keep the modal mounted while in flight so AuroraConfirmModal can render
    // the "Procesando…" state via `loading` and block accidental backdrop close.
    setConfirmModal(prev => prev ? { ...prev, loading: true } : null);
    try {
      const res = await apiFetch(`/api/materiales-siembra/${id}`, { method: 'DELETE' });
      const result = await readJsonResult(res, 'Error al eliminar.');
      if (!result.ok) { showToast(result.error, 'error'); return; }
      setMateriales(prev => prev.filter(m => m.id !== id));
      showToast('Material eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setBusy(false);
      setConfirmModal(null);
    }
  };

  const cancelCreate = () => {
    if (busy) return;
    setShowForm(false);
    setForm({ ...EMPTY });
  };

  return (
    <div className="aur-sheet mat-sheet">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}

      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Materiales de siembra</h2>
          <p className="aur-sheet-subtitle">Catálogo de variedades y rangos de peso usados en los registros.</p>
        </div>
        <div className="aur-sheet-header-actions">
          <Link to="/siembra" className="aur-chip aur-chip--ghost">
            <FiArrowLeft size={12} /> Volver
          </Link>
          <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => setShowForm(true)} disabled={busy}>
            <FiPlus size={14} /> Nuevo material
          </button>
        </div>
      </header>

      {showForm && createPortal(
        <div className="aur-modal-backdrop" onPointerDown={cancelCreate}>
          <div className="aur-modal" onPointerDown={e => e.stopPropagation()}>
            <div className="aur-modal-header">
              <span className="aur-modal-icon"><FiPlus size={16} /></span>
              <span className="aur-modal-title">Nuevo material</span>
            </div>
            <form onSubmit={handleCreate}>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="mat-nombre">
                    Nombre <span className="mat-required">*</span>
                  </label>
                  <input
                    id="mat-nombre"
                    className="aur-input"
                    value={form.nombre}
                    onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                    placeholder="Ej. CM, MD2, Cayena Lisa"
                    maxLength={TEXT_MAX}
                    autoFocus
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="mat-rango">Rango de pesos</label>
                  <input
                    id="mat-rango"
                    className="aur-input"
                    value={form.rangoPesos}
                    onChange={e => setForm(p => ({ ...p, rangoPesos: e.target.value }))}
                    placeholder="Ej. 200g – 300g"
                    maxLength={TEXT_MAX}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="mat-variedad">Variedad</label>
                  <input
                    id="mat-variedad"
                    className="aur-input"
                    value={form.variedad}
                    onChange={e => setForm(p => ({ ...p, variedad: e.target.value }))}
                    placeholder="Ej. Amarilla, Roja"
                    maxLength={TEXT_MAX}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="mat-densidad">Densidad sugerida (pl/ha)</label>
                  <input
                    id="mat-densidad"
                    className="aur-input"
                    type="number"
                    min="0"
                    max="199999"
                    value={form.densidadDefault}
                    onChange={e => setForm(p => ({ ...p, densidadDefault: e.target.value }))}
                    placeholder="Ej. 55000"
                  />
                </div>
              </div>
              <div className="aur-modal-actions">
                <button type="button" className="aur-btn-text" onClick={cancelCreate} disabled={busy}>Cancelar</button>
                <button type="submit" className="aur-btn-pill" disabled={busy}>
                  {busy ? 'Creando…' : 'Crear material'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <section className="aur-section">
        {materiales.length === 0 ? (
          <div className="mat-empty">
            <p>No hay materiales registrados.</p>
            <p className="mat-empty-hint">Crea el primero con el botón "Nuevo material".</p>
          </div>
        ) : (
          <ul className="mat-list">
            {materiales.map(m => (
              <li key={m.id} className={`mat-card${editingId === m.id ? ' mat-card--editing' : ''}`}>
                {editingId === m.id ? (
                  <>
                    <div className="mat-edit">
                      <input
                        className="aur-input"
                        placeholder="Nombre"
                        value={editData.nombre}
                        onChange={e => setEditData(p => ({ ...p, nombre: e.target.value }))}
                        maxLength={TEXT_MAX}
                      />
                      <input
                        className="aur-input"
                        placeholder="Rango de pesos"
                        value={editData.rangoPesos}
                        onChange={e => setEditData(p => ({ ...p, rangoPesos: e.target.value }))}
                        maxLength={TEXT_MAX}
                      />
                      <input
                        className="aur-input"
                        placeholder="Variedad"
                        value={editData.variedad}
                        onChange={e => setEditData(p => ({ ...p, variedad: e.target.value }))}
                        maxLength={TEXT_MAX}
                      />
                      <input
                        className="aur-input"
                        type="number"
                        min="0"
                        max="199999"
                        placeholder="Densidad (pl/ha)"
                        value={editData.densidadDefault}
                        onChange={e => setEditData(p => ({ ...p, densidadDefault: e.target.value }))}
                      />
                    </div>
                    <div className="mat-actions">
                      <button type="button" className="aur-icon-btn aur-icon-btn--success" onClick={saveEdit} disabled={busy} title="Guardar">
                        <FiCheck size={14} />
                      </button>
                      <button type="button" className="aur-icon-btn" onClick={() => setEditingId(null)} disabled={busy} title="Cancelar">
                        <FiX size={14} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mat-info">
                      <span className="mat-name">{m.nombre}</span>
                      {(m.rangoPesos || m.variedad || Number(m.densidadDefault) > 0) && (
                        <div className="mat-chips">
                          {m.rangoPesos && <span className="aur-chip">{m.rangoPesos}</span>}
                          {m.variedad && <span className="aur-chip aur-chip--ghost">{m.variedad}</span>}
                          {Number(m.densidadDefault) > 0 && (
                            <span className="aur-chip aur-chip--ghost">{m.densidadDefault} pl/ha</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mat-actions">
                      <button type="button" className="aur-icon-btn" onClick={() => startEdit(m)} disabled={busy} title="Editar">
                        <FiEdit2 size={14} />
                      </button>
                      <button type="button" className="aur-icon-btn aur-icon-btn--danger" onClick={() => askDelete(m)} disabled={busy} title="Eliminar">
                        <FiTrash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default SiembraMateriales;
