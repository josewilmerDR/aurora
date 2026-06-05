import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBox, FiEdit2, FiTrash2, FiPlus, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import AuroraModal from '../../../components/AuroraModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { translateApiError } from '../../../lib/errorMessages';
import { ICON_MAP, ICON_OPTIONS } from '../lib/bodega';
import '../styles/bodegas-admin.css';

// Evento que el Sidebar escucha para recargar las bodegas tras un CRUD.
const BODEGAS_CHANGED_EVENT = 'aurora-bodegas-changed';

const EMPTY_FORM = { nombre: '', icono: 'FiBox' };

const BodegaIcon = ({ iconKey, size = 20 }) => {
  const Icon = ICON_MAP[iconKey] || FiBox;
  return <Icon size={size} />;
};

function BodegasAdmin() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const navigate = useNavigate();

  const [bodegas, setBodegas] = useState([]);
  const [loading, setLoading] = useState(true);   // solo el primer mount
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_FORM); // baseline para dirty-guard
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formErr, setFormErr] = useState(false);   // nombre vacío al guardar
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const flashTimer = useRef(null);
  // Clave de idempotencia por sesión-de-creación: se genera al abrir el modal
  // de creación y se reenvía en cada reintento del mismo guardado, de modo que
  // un reintento de red no cree una bodega duplicada. Solo IDs URL-safe (la
  // valida el backend con regex).
  const clientBodegaId = useRef(null);

  // Refetch silencioso: NO reactiva el spinner de página tras un CRUD. El
  // feedback ya lo dan el toast + el flash de la card; un overlay full-screen
  // en cada guardado sería más disruptivo que informativo. `initial` activa el
  // spinner solo en el primer mount (o al reintentar tras un error de carga).
  const fetchBodegas = useCallback((initial = false) => {
    if (initial) setLoading(true);
    setLoadError(false);
    return apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        // Esta vista administra SOLO bodegas genéricas (las de sistema
        // —agroquímicos/combustibles— tienen su propia pantalla y no se editan
        // ni borran acá). Tras este filtro ninguna bodega de sistema llega a la
        // grilla, por eso no hay lógica de "Sistema" más abajo.
        setBodegas(list.filter(b => b.tipo === 'generica'));
      })
      .catch(() => { setLoadError(true); toast.error('Error al cargar bodegas.'); })
      .finally(() => { if (initial) setLoading(false); });
  }, [apiFetch, toast]);

  useEffect(() => { fetchBodegas(true); }, [fetchBodegas]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const flashRow = useCallback((id) => {
    if (!id) return;
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1700);
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setFormErr(false);
    // Nueva clave de idempotencia para esta creación (estable entre reintentos).
    clientBodegaId.current =
      (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .replace(/[^A-Za-z0-9_-]/g, '');
    setShowForm(true);
  };

  const openEdit = (b) => {
    const next = { nombre: b.nombre, icono: b.icono || 'FiBox' };
    setEditingId(b.id);
    setForm(next);
    setInitialForm(next);
    setFormErr(false);
    setShowForm(true);
  };

  const doClose = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErr(false);
  }, []);

  const formDirty = form.nombre !== initialForm.nombre || form.icono !== initialForm.icono;

  // Cierre con guardia de descarte: si hay cambios sin guardar, pedir confirmación
  // (cubre también el click en backdrop / Escape, que AuroraModal enruta a onClose).
  const requestClose = useCallback(() => {
    if (saving) return;
    if (formDirty) { setDiscardAsk(true); return; }
    doClose();
  }, [saving, formDirty, doClose]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!form.nombre.trim()) { setFormErr(true); toast.error('El nombre es requerido.'); return; }
    setSaving(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = editingId ? `/api/bodegas/${editingId}` : '/api/bodegas';
      const payload = { nombre: form.nombre.trim(), icono: form.icono };
      if (!editingId && clientBodegaId.current) payload.clientBodegaId = clientBodegaId.current;
      const res = await apiFetch(url, { method, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(translateApiError(err, 'Error al guardar.'));
        return;
      }
      const saved = await res.json().catch(() => null);
      toast.success(editingId ? 'Bodega actualizada.' : 'Bodega creada.');
      doClose();
      await fetchBodegas();
      flashRow(saved?.id || editingId);
      // Notificar al sidebar para que recargue
      window.dispatchEvent(new CustomEvent(BODEGAS_CHANGED_EVENT));
    } catch {
      toast.error('Error de conexión.');
    } finally {
      setSaving(false);
    }
  };

  // Devuelve true si el borrado fue exitoso (para que el confirm sepa si cerrar).
  const handleDelete = async (b) => {
    try {
      const res = await apiFetch(`/api/bodegas/${b.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(translateApiError(err, 'No se pudo eliminar la bodega.'));
        return false;
      }
      toast.success('Bodega eliminada.');
      await fetchBodegas();
      window.dispatchEvent(new CustomEvent(BODEGAS_CHANGED_EVENT));
      return true;
    } catch {
      toast.error('Error de conexión.');
      return false;
    }
  };

  if (loading) return <div className="aur-page-loading" />;

  if (loadError) {
    return (
      <div className="lm-container">
        <EmptyState
          icon={FiAlertTriangle}
          title="No se pudieron cargar las bodegas."
          subtitle="Revisá tu conexión e intentá de nuevo."
          action={<button className="aur-btn-pill" onClick={() => fetchBodegas(true)}>Reintentar</button>}
        />
      </div>
    );
  }

  const nombreInvalid = formErr && !form.nombre.trim();

  return (
    <div className="lm-container">
      {bodegas.length === 0 ? (
        <EmptyState
          icon={FiBox}
          title="No hay bodegas adicionales configuradas."
          subtitle="Creá bodegas secundarias de la finca u organización."
          action={
            <button className="aur-btn-pill" onClick={openCreate}>
              <FiPlus size={14} /> Crear bodega adicional
            </button>
          }
        />
      ) : (
        <>
          <div className="lm-header">
            <div className="lm-header-left">
              <h2 className="lm-title">Bodegas Adicionales</h2>
              <p className="lm-subtitle">
                Crea y gestiona bodegas secundarias de la finca u organización
              </p>
            </div>
            <button className="aur-btn-pill" onClick={openCreate}>
              <FiPlus size={16} /> Nueva Bodega
            </button>
          </div>
          <div className="ba-grid">
            {bodegas.map(b => (
              <div
                key={b.id}
                className={`ba-card${flashId === b.id ? ' ba-card--flash' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/bodega/${b.id}`)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/bodega/${b.id}`); } }}
                title={`Abrir ${b.nombre}`}
              >
                <div className="ba-card-icon">
                  <BodegaIcon iconKey={b.icono} size={28} />
                </div>
                <div className="ba-card-body">
                  <span className="ba-card-name">{b.nombre}</span>
                </div>
                <div className="ba-card-actions">
                  <button
                    className="ba-btn-icon"
                    aria-label={`Editar ${b.nombre}`}
                    onClick={e => { e.stopPropagation(); openEdit(b); }}
                    title="Editar"
                  >
                    <FiEdit2 size={15} />
                  </button>
                  <button
                    className="ba-btn-icon ba-btn-danger"
                    aria-label={`Eliminar bodega ${b.nombre}`}
                    onClick={e => { e.stopPropagation(); setConfirmDelete(b); }}
                    title="Eliminar"
                  >
                    <FiTrash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal crear/editar */}
      {showForm && (
        <AuroraModal
          size="wide"
          title={editingId ? 'Editar Bodega' : 'Nueva Bodega'}
          onClose={requestClose}
          footer={
            <>
              <button type="button" className="aur-btn-text" onClick={requestClose} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" form="bodega-form" className="aur-btn-pill" disabled={saving || !form.nombre.trim()}>
                {saving ? 'Guardando…' : (editingId ? 'Guardar cambios' : 'Crear bodega')}
              </button>
            </>
          }
        >
          <form id="bodega-form" onSubmit={handleSave}>
            <div className="aur-field">
              <label className="aur-field-label" htmlFor="bodega-nombre">Nombre</label>
              <input
                id="bodega-nombre"
                className={`aur-input${nombreInvalid ? ' aur-input--error' : ''}`}
                value={form.nombre}
                onChange={e => { setForm(f => ({ ...f, nombre: e.target.value })); if (formErr) setFormErr(false); }}
                placeholder="Ej: Bodega de Herramientas"
                maxLength={80}
                aria-invalid={nombreInvalid ? true : undefined}
                autoFocus
              />
              {nombreInvalid && <span className="ba-field-error">El nombre es requerido.</span>}
            </div>

            <div className="aur-field">
              <label className="aur-field-label" id="bodega-icono-label">Ícono</label>
              <div className="ba-icon-picker" role="radiogroup" aria-labelledby="bodega-icono-label">
                {ICON_OPTIONS.map(({ key, Icon, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={form.icono === key}
                    className={`ba-icon-option${form.icono === key ? ' selected' : ''}`}
                    onClick={() => setForm(f => ({ ...f, icono: key }))}
                    title={label}
                  >
                    <Icon size={22} />
                    <span>{label}</span>
                    {form.icono === key && <FiCheck size={12} className="ba-icon-check" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </AuroraModal>
      )}

      {/* Confirmar descarte de cambios sin guardar */}
      {discardAsk && (
        <AuroraConfirmModal
          title="¿Descartar cambios?"
          body="Hay datos sin guardar en el formulario. Si cerrás, se perderán."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          danger
          onConfirm={() => { setDiscardAsk(false); doClose(); }}
          onCancel={() => setDiscardAsk(false)}
        />
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar bodega"
          body={`¿Eliminar la bodega "${confirmDelete.nombre}"? Solo es posible si no tiene productos registrados.`}
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={async () => {
            setDeleting(true);
            const ok = await handleDelete(confirmDelete);
            setDeleting(false);
            if (ok) setConfirmDelete(null);
          }}
          onCancel={() => { if (!deleting) setConfirmDelete(null); }}
        />
      )}
    </div>
  );
}

export default BodegasAdmin;
