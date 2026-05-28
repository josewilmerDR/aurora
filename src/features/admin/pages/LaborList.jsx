import { useState, useEffect, useRef } from 'react';
import { FiList, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiSearch, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import '../styles/labor-list.css';

const EMPTY_FORM = {
  id: null,
  codigo: '',
  descripcion: '',
  observacion: '',
};

const MAX_CODIGO = 30;
const MAX_DESCRIPCION = 200;
const MAX_OBSERVACION = 1000;

// Borrador: sólo persiste mientras el alta está abierta. En edición no
// tocamos sessionStorage para no pisar un draft previo ni recordar valores
// que ya están en DB.
const DRAFT_KEY = 'aurora_draft_labor-form';
const DRAFT_FLAG = 'labor-form';

const isDirty = (form) =>
  !!(form.codigo.trim() || form.descripcion.trim() || form.observacion.trim());

const codigoMatches = (a, b) => (a || '').trim() === (b || '').trim();

// Mismo orden que el backend (labor-records.js:36): código natural-sort
// case-insensitive. Replicado client-side para poder hacer updates optimistas
// sin tener que re-fetchear toda la lista.
const sortByCodigo = (a, b) =>
  (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true, sensitivity: 'base' });

const upsertLocal = (list, doc) => {
  const idx = list.findIndex(x => x.id === doc.id);
  const next = idx === -1 ? [...list, doc] : list.map(x => x.id === doc.id ? { ...x, ...doc } : x);
  return next.slice().sort(sortByCodigo);
};

// Threshold del contador de caracteres: a partir del 85% del máximo el contador
// aparece y se vuelve "warn" para avisar al usuario que está cerca del corte.
const COUNTER_THRESHOLD = 0.85;

function LaborList() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [unidades, setUnidades] = useState([]); // sólo para contar impacto al borrar
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, descripcion }
  const [deleting, setDeleting] = useState(false);
  // Cuando el código tipeado choca con otra labor: { existing, payload }
  const [mergeTarget, setMergeTarget] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // id de la fila recién creada/editada para resaltarla unos segundos.
  const [recentId, setRecentId] = useState(null);
  const descripcionRef = useRef(null);
  const recentTimerRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/labores')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar la lista de labores.', 'error'))
      .finally(() => setLoading(false));

  const fetchUnidades = () =>
    apiFetch('/api/unidades-medida')
      .then(r => r.json())
      .then(data => setUnidades(Array.isArray(data) ? data : []))
      .catch(() => {}); // count opcional — si falla, el modal queda sin número pero igual honesto

  useEffect(() => {
    fetchItems();
    fetchUnidades();
    // Restaurar borrador si quedó un alta a medio escribir.
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && isDirty(draft)) {
        setForm({ ...EMPTY_FORM, ...draft, id: null });
        setIsEditing(false);
        setShowForm(true);
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco al primer input requerido cuando se abre el form.
  useEffect(() => {
    if (showForm) setTimeout(() => descripcionRef.current?.focus(), 50);
  }, [showForm]);

  // Limpiar el timer del highlight si el componente se desmonta antes del fade.
  useEffect(() => () => {
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
  }, []);

  const flashRecent = (id) => {
    setRecentId(id);
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    recentTimerRef.current = setTimeout(() => setRecentId(null), 2500);
  };

  // Persistir borrador SÓLO mientras el form de alta está abierto. Si el
  // usuario lo cierra sin descartar (showForm=false), el draft queda intacto
  // hasta que vuelva a abrirlo.
  useEffect(() => {
    if (!showForm || isEditing) return;
    if (isDirty(form)) {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          codigo: form.codigo,
          descripcion: form.descripcion,
          observacion: form.observacion,
        }));
      } catch { /* ignore */ }
      markDraftActive(DRAFT_FLAG);
    } else {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      clearDraftActive(DRAFT_FLAG);
    }
  }, [form, isEditing, showForm]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  // resetForm = "todo limpio": tras un save o un descarte explícito borramos
  // también el borrador. Si sólo cerrás el form (sin descartar), usar closeForm
  // y el draft queda preservado.
  const resetForm = () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    clearDraftActive(DRAFT_FLAG);
    closeForm();
  };

  // Cancelar: en alta dirty pide confirmación; en edición o alta vacía cierra
  // directo y preserva cualquier draft previo.
  const requestReset = () => {
    if (!isEditing && isDirty(form)) {
      setConfirmDiscard(true);
      return;
    }
    closeForm();
  };

  const handleEdit = (item) => {
    setForm({
      id: item.id ?? null,
      codigo: item.codigo ?? '',
      descripcion: item.descripcion ?? '',
      observacion: item.observacion ?? '',
    });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    // Si quedó un borrador, lo restauramos para que "Nueva labor" no abra el
    // form en blanco pisando lo que el usuario había tipeado antes.
    let restored = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && isDirty(draft)) restored = draft;
      }
    } catch { /* ignore */ }
    setForm(restored ? { ...EMPTY_FORM, ...restored, id: null } : EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/labores/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Optimistic local: sacamos la fila sin esperar refetch. unidades se
      // re-fetcha por si el conteo del próximo modal de borrado cambió.
      setItems(prev => prev.filter(it => it.id !== id));
      fetchUnidades();
      showToast('Labor eliminada.');
      setConfirmDelete(null);
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Save real, separado para reutilizar después de confirmar un merge. Sin
  // refetch: con el id devuelto + el payload reconstruimos el doc localmente
  // y lo merge-amos en la lista ya ordenada.
  const persist = async ({ url, method, payload, successMsg, targetId }) => {
    setSaving(true);
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const body = await res.json().catch(() => ({}));
      const id = targetId ?? body.id ?? null;
      if (id) {
        setItems(prev => upsertLocal(prev, { id, ...payload }));
        flashRecent(id);
      }
      showToast(successMsg);
      resetForm();
      setMergeTarget(null);
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      codigo: form.codigo.trim().slice(0, MAX_CODIGO),
      descripcion: form.descripcion.trim().slice(0, MAX_DESCRIPCION),
      observacion: form.observacion.trim().slice(0, MAX_OBSERVACION),
    };
    if (!payload.descripcion) {
      showToast('La descripción es obligatoria.', 'error');
      return;
    }
    // Detectar colisión de código antes de pegarle al backend. Sin código no
    // hay riesgo de upsert silencioso porque el backend sólo deduplica con
    // código presente.
    if (payload.codigo) {
      const collision = items.find(it =>
        it.id !== form.id && codigoMatches(it.codigo, payload.codigo)
      );
      if (collision) {
        if (isEditing) {
          // En edición un PUT con código duplicado deja dos docs con mismo
          // código, no es "merge" — paramos y forzamos elegir otro.
          showToast(`El código "${payload.codigo}" ya lo usa "${collision.descripcion}".`, 'error');
          return;
        }
        // En alta el POST haría upsert silencioso: mostramos diff y pedimos
        // confirmación explícita.
        setMergeTarget({ existing: collision, payload });
        return;
      }
    }
    persist({
      url: isEditing ? `/api/labores/${form.id}` : '/api/labores',
      method: isEditing ? 'PUT' : 'POST',
      payload,
      successMsg: isEditing ? 'Labor actualizada.' : 'Labor registrada.',
      targetId: isEditing ? form.id : null, // POST devuelve id en body
    });
  };

  const handleMergeConfirm = () => {
    if (!mergeTarget) return;
    persist({
      url: `/api/labores/${mergeTarget.existing.id}`,
      method: 'PUT',
      payload: mergeTarget.payload,
      successMsg: 'Labor existente actualizada.',
      targetId: mergeTarget.existing.id,
    });
  };

  const q = filter.toLowerCase();
  const filtered = items.filter(item =>
    !q ||
    item.descripcion?.toLowerCase().includes(q) ||
    item.codigo?.toLowerCase().includes(q) ||
    item.observacion?.toLowerCase().includes(q)
  );

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (() => {
        const refCount = unidades.filter(u => u.labor === confirmDelete.id).length;
        // Trunca el nombre del title para no romper el modal en mobile (420px).
        const shortDesc = confirmDelete.descripcion.length > 60
          ? confirmDelete.descripcion.slice(0, 57) + '…'
          : confirmDelete.descripcion;
        return (
          <AuroraConfirmModal
            danger
            title={`¿Eliminar "${shortDesc}"?`}
            body={(
              <>
                Esta acción no se puede deshacer.
                {refCount > 0 && (
                  <>
                    {' '}
                    <strong>{refCount} {refCount === 1 ? 'unidad de medida queda' : 'unidades de medida quedan'}</strong>
                    {' '}sin labor asociada y la referencia mostrará el id crudo hasta reasignarla.
                  </>
                )}
                {' '}Los registros de horímetro existentes conservan el nombre como texto, así que no se borran — pero ya no aparecerán bajo esta labor en filtros futuros.
              </>
            )}
            confirmLabel="Eliminar"
            loading={deleting}
            loadingLabel="Eliminando…"
            onConfirm={handleDeleteConfirm}
            onCancel={() => setConfirmDelete(null)}
          />
        );
      })()}

      {mergeTarget && (
        <AuroraConfirmModal
          icon={<FiAlertTriangle size={16} />}
          iconVariant="warn"
          size="wide"
          title={`Ya existe una labor con código "${mergeTarget.payload.codigo}"`}
          body="Si confirmás, se sobrescriben los datos de la labor existente con los nuevos. Si no querés perderlos, cancelá y cambiá el código."
          confirmLabel="Actualizar existente"
          cancelLabel="Volver y cambiar código"
          loading={saving}
          loadingLabel="Guardando…"
          onConfirm={handleMergeConfirm}
          onCancel={() => setMergeTarget(null)}
        >
          <div className="lab-merge-diff">
            <div className="lab-merge-col">
              <div className="lab-merge-col-title">Actual</div>
              <div className="lab-merge-row"><span className="lab-merge-label">Descripción</span><span>{mergeTarget.existing.descripcion || '—'}</span></div>
              <div className="lab-merge-row"><span className="lab-merge-label">Observación</span><span>{mergeTarget.existing.observacion || '—'}</span></div>
            </div>
            <div className="lab-merge-col lab-merge-col--new">
              <div className="lab-merge-col-title">Nuevo</div>
              <div className="lab-merge-row"><span className="lab-merge-label">Descripción</span><span>{mergeTarget.payload.descripcion || '—'}</span></div>
              <div className="lab-merge-row"><span className="lab-merge-label">Observación</span><span>{mergeTarget.payload.observacion || '—'}</span></div>
            </div>
          </div>
        </AuroraConfirmModal>
      )}

      {confirmDiscard && (
        <AuroraConfirmModal
          danger
          title="¿Descartar la labor a medio escribir?"
          body="Vas a perder lo que ya tipeaste en este formulario."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          onConfirm={() => { setConfirmDiscard(false); resetForm(); }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Labores</h2>
            <p className="aur-sheet-subtitle">
              Tipos de trabajo registrables en horímetro y actividades de campo.
            </p>
          </div>
          {!showForm && (
            <div className="aur-sheet-header-actions">
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                <FiPlus size={14} /> Nueva labor
              </button>
            </div>
          )}
        </header>

        {showForm && (
          <section className="aur-section">
            <div className="aur-section-header">
              <h3>{isEditing ? 'Editar labor' : 'Nueva labor'}</h3>
              <div className="aur-section-actions">
                <button
                  type="button"
                  className="aur-icon-btn aur-icon-btn--sm"
                  onClick={requestReset}
                  title="Cancelar"
                  aria-label="Cerrar formulario"
                >
                  <FiX size={14} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-codigo">Código</label>
                  <div className="aur-field">
                    <input
                      id="lab-codigo"
                      className="aur-input"
                      name="codigo"
                      value={form.codigo}
                      onChange={handleChange}
                      placeholder="Ej. CHAP-01"
                      maxLength={MAX_CODIGO}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-descripcion">
                    Descripción <span className="lab-required">*</span>
                  </label>
                  <div className="aur-field">
                    <input
                      id="lab-descripcion"
                      ref={descripcionRef}
                      className="aur-input"
                      name="descripcion"
                      value={form.descripcion}
                      onChange={handleChange}
                      placeholder="Nombre de la labor"
                      maxLength={MAX_DESCRIPCION}
                      required
                    />
                    {form.descripcion.length > MAX_DESCRIPCION * COUNTER_THRESHOLD && (
                      <span
                        className={`lab-char-counter${form.descripcion.length >= MAX_DESCRIPCION ? ' lab-char-counter--max' : ''}`}
                        aria-live="polite"
                      >
                        {form.descripcion.length} / {MAX_DESCRIPCION}
                      </span>
                    )}
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="lab-observacion">Observación</label>
                  <div className="aur-field">
                    <textarea
                      id="lab-observacion"
                      className="aur-textarea"
                      name="observacion"
                      value={form.observacion}
                      onChange={handleChange}
                      placeholder="Notas adicionales sobre esta labor…"
                      rows={4}
                      maxLength={MAX_OBSERVACION}
                    />
                    {form.observacion.length > MAX_OBSERVACION * COUNTER_THRESHOLD && (
                      <span
                        className={`lab-char-counter${form.observacion.length >= MAX_OBSERVACION ? ' lab-char-counter--max' : ''}`}
                        aria-live="polite"
                      >
                        {form.observacion.length} / {MAX_OBSERVACION}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="aur-form-actions">
                <button type="button" className="aur-btn-text" onClick={requestReset} disabled={saving}>
                  Cancelar
                </button>
                <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={saving}>
                  <FiCheck size={14} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="aur-section">
          {loading ? (
            <div className="aur-page-loading" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FiList}
              title="No hay labores registradas."
              subtitle="Las labores son tipos de trabajo que después se asocian a lotes y maquinaria desde Horímetro o Unidades de medida."
              action={(
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                  <FiPlus size={14} /> Crear primera labor
                </button>
              )}
            />
          ) : (
            <>
              <div className="aur-table-toolbar lab-toolbar">
                <div className="lab-search-wrap">
                  <FiSearch size={13} className="lab-search-icon" />
                  <input
                    type="search"
                    className="aur-input lab-search"
                    placeholder="Buscar…"
                    aria-label="Buscar labores"
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                  />
                </div>
                <span className="aur-table-result-count">
                  {filtered.length} de {items.length}
                </span>
              </div>
              {filtered.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={FiList}
                  title="Sin resultados para la búsqueda."
                />
              ) : (
                <div className="aur-table-wrap">
                  <table className="aur-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th>Observación</th>
                        <th className="lab-th-actions" aria-label="Acciones"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(item => (
                        <tr
                          key={item.id}
                          className={item.id === recentId ? 'lab-row--just-saved' : undefined}
                        >
                          <td className="lab-td-code">{item.codigo || <span className="lab-td-empty">—</span>}</td>
                          <td className="lab-td-desc">{item.descripcion}</td>
                          <td className="lab-td-obs">{item.observacion || <span className="lab-td-empty">—</span>}</td>
                          <td className="lab-td-actions">
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--sm"
                              onClick={() => handleEdit(item)}
                              title="Editar"
                              aria-label={`Editar labor ${item.descripcion}`}
                            >
                              <FiEdit size={13} />
                            </button>
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                              onClick={() => setConfirmDelete({ id: item.id, descripcion: item.descripcion })}
                              title="Eliminar"
                              aria-label={`Eliminar labor ${item.descripcion}`}
                            >
                              <FiTrash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

export default LaborList;
