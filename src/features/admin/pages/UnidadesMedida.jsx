import { useState, useEffect, useRef, useMemo } from 'react';
import { FiPlus, FiEdit, FiTrash2, FiX, FiCheck, FiPackage, FiSearch, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import LaborCombobox from '../../../components/ui/LaborCombobox';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import { translateApiError } from '../../../lib/errorMessages';
import { formatPrecio, normalizeText, isDirtyForm, upsertUnit, conversionIncomplete } from '../lib/units';
import '../styles/unidades-medida.css';

// Borrador del alta: sólo persiste mientras el form de "Nueva unidad" está
// abierto. En edición no tocamos sessionStorage para no pisar un draft previo
// ni recordar valores que ya están en DB. Clave alineada con useDraft.
const DRAFT_KEY = 'aurora_draft_unidad-form';
const DRAFT_FLAG = 'unidad-form';

const EMPTY_FORM = {
  id: null,
  nombre: '',
  descripcion: '',
  precio: '',
  labor: '',
  factorConversion: '',
  unidadBase: '',
};

function UnidadesMedida() {
  const apiFetch = useApiFetch();
  const [items,     setItems]     = useState([]);
  const [labores,   setLabores]   = useState([]);
  const [productos, setProductos] = useState([]); // sólo para contar impacto al borrar/renombrar
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);
  const [filter,    setFilter]    = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, nombre }
  const [deleting, setDeleting] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Colisión de nombre en alta: el backend hace upsert por nombre, así que sin
  // este chequeo "crear" pisaría en silencio la unidad existente. { existing, payload }
  const [mergeTarget, setMergeTarget] = useState(null);
  // Aviso al renombrar una unidad referenciada por nombre (productos / base de
  // otras unidades). { oldNombre, newNombre, baseCount, productCount, payload }
  const [renameWarn, setRenameWarn] = useState(null);
  // id de la fila recién creada/editada para resaltarla unos segundos.
  const [recentId, setRecentId] = useState(null);
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const recentTimerRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Lookup O(1) de labor por id (evita un .find() por fila en cada render).
  const labMap = useMemo(() => new Map(labores.map(l => [l.id, l])), [labores]);
  // Nombre legible de la labor. Si el id no resuelve (labores no cargaron, o la
  // labor fue borrada) mostramos un placeholder honesto en vez del id crudo.
  const getLaborNombre = (laborId) =>
    laborId ? (labMap.get(laborId)?.descripcion || 'Labor no disponible') : '';

  const fetchItems = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch('/api/unidades-medida');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // Productos: sólo para contar impacto. Si falla, el conteo queda sin número
  // pero el modal sigue siendo honesto ("no encontramos referencias").
  const fetchProductos = () =>
    apiFetch('/api/productos')
      .then(r => r.json())
      .then(d => setProductos(Array.isArray(d) ? d : []))
      .catch(() => {});

  // Restauración de borrador: sólo al montar.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && isDirtyForm({ ...EMPTY_FORM, ...draft })) {
        setForm({ ...EMPTY_FORM, ...draft, id: null });
        setIsEditing(false);
        setShowForm(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchProductos();
    apiFetch('/api/labores').then(r => r.json()).then(d => setLabores(Array.isArray(d) ? d : [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showForm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showForm]);

  // Limpiar el timer del highlight si el componente se desmonta antes del fade.
  useEffect(() => () => {
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
  }, []);

  // Persistir borrador SÓLO mientras el alta está abierta (no en edición).
  useEffect(() => {
    if (!showForm || isEditing) return;
    if (isDirtyForm(form)) {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          nombre: form.nombre,
          descripcion: form.descripcion,
          precio: form.precio,
          labor: form.labor,
          factorConversion: form.factorConversion,
          unidadBase: form.unidadBase,
        }));
      } catch { /* ignore */ }
      markDraftActive(DRAFT_FLAG);
    } else {
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      clearDraftActive(DRAFT_FLAG);
    }
  }, [form, isEditing, showForm]);

  const flashRecent = (id) => {
    setRecentId(id);
    if (recentTimerRef.current) clearTimeout(recentTimerRef.current);
    recentTimerRef.current = setTimeout(() => setRecentId(null), 2500);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  // closeForm = sólo cierra y preserva cualquier borrador previo.
  const closeForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
    setMergeTarget(null);
    setRenameWarn(null);
  };

  // resetForm = "todo limpio": tras guardar o descartar borramos también el draft.
  const resetForm = () => {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    clearDraftActive(DRAFT_FLAG);
    closeForm();
  };

  // Cancelar: en alta con datos pide confirmación; en edición o alta vacía
  // cierra directo (y preserva cualquier draft previo).
  const requestReset = () => {
    if (!isEditing && isDirtyForm(form)) {
      setConfirmDiscard(true);
      return;
    }
    closeForm();
  };

  // "Nueva unidad": si quedó un borrador, lo restaura para no abrir en blanco.
  const handleNew = () => {
    let restored = null;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && isDirtyForm({ ...EMPTY_FORM, ...draft })) restored = draft;
      }
    } catch { /* ignore */ }
    setForm(restored ? { ...EMPTY_FORM, ...restored, id: null } : EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setForm({
      id:               item.id,
      nombre:           item.nombre           || '',
      descripcion:      item.descripcion      || '',
      precio:           item.precio != null ? String(item.precio) : '',
      labor:            item.labor            || '',
      factorConversion: item.factorConversion != null ? String(item.factorConversion) : '',
      unidadBase:       item.unidadBase        || '',
    });
    setIsEditing(true);
    setShowForm(true);
    // scrollIntoView sobre el form respeta el contenedor real con overflow:auto,
    // a diferencia de window.scrollTo (que asume que window es el scroll root y
    // queda no-op dentro del wrapper del admin). Defer hasta que monte el form.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/unidades-medida/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(translateApiError(errBody, 'Error al eliminar.'));
      }
      // Optimistic local: sacamos la fila sin esperar refetch.
      setItems(prev => prev.filter(it => it.id !== id));
      showToast('Unidad eliminada.');
      setConfirmDelete(null);
    } catch (err) {
      showToast(err?.message || 'Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const buildPayload = () => ({
    nombre:           form.nombre.trim(),
    descripcion:      form.descripcion.trim(),
    precio:           form.precio !== '' ? parseFloat(form.precio) : null,
    labor:            form.labor,
    factorConversion: form.factorConversion !== '' ? parseFloat(form.factorConversion) : null,
    unidadBase:       form.unidadBase.trim(),
  });

  // Save real, separado para reutilizarlo tras confirmar un merge o un rename.
  // Sin refetch: con el id (devuelto o conocido) + el payload reconstruimos el
  // doc localmente y lo merge-amos en la lista ya ordenada (update optimista).
  const doPersist = async ({ url, method, payload, successMsg, targetId }) => {
    setSaving(true);
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(translateApiError(errBody, 'Error al guardar.'));
      }
      const body = await res.json().catch(() => ({}));
      const id = targetId ?? body.id ?? null;
      if (id) {
        setItems(prev => upsertUnit(prev, { id, ...payload }));
        flashRecent(id);
      }
      // Si el POST terminó en upsert por una carrera (otro creó el mismo nombre
      // entre el chequeo y el submit), avisamos honestamente en vez de "creada".
      if (method === 'POST' && body?.merged) {
        showToast('Ya existía una unidad con ese nombre; se actualizó.', 'info');
      } else {
        showToast(successMsg);
      }
      resetForm();
    } catch (err) {
      showToast(err?.message || 'Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = buildPayload();
    if (!payload.nombre) {
      showToast('El nombre es requerido.', 'error');
      return;
    }
    // Una conversión necesita factor Y unidad base juntos. Uno solo no se
    // muestra en la lista ni se aplica en planillas → dato fantasma.
    if (conversionIncomplete(form.factorConversion, form.unidadBase)) {
      showToast('Completá el factor y la unidad base juntos, o dejá ambos vacíos.', 'error');
      return;
    }

    if (isEditing) {
      // Renombrar rompe referencias por nombre (no hay cascada): productos con
      // esta unidad asignada y otras unidades que la usan como base. Avisamos
      // con números concretos antes de aplicar.
      const original = items.find(u => u.id === form.id);
      if (original && original.nombre !== payload.nombre) {
        const baseCount    = items.filter(u => u.id !== form.id && u.unidadBase === original.nombre).length;
        const productCount = productos.filter(p => p.unidad === original.nombre).length;
        if (baseCount + productCount > 0) {
          setRenameWarn({ oldNombre: original.nombre, newNombre: payload.nombre, baseCount, productCount, payload });
          return;
        }
      }
      doPersist({ url: `/api/unidades-medida/${form.id}`, method: 'PUT', payload, successMsg: 'Unidad actualizada.', targetId: form.id });
      return;
    }

    // Alta: el backend hace upsert por nombre. Detectamos la colisión acá y
    // pedimos confirmación con diff antes de sobrescribir la unidad existente.
    const collision = items.find(u => u.nombre === payload.nombre);
    if (collision) {
      setMergeTarget({ existing: collision, payload });
      return;
    }
    doPersist({ url: '/api/unidades-medida', method: 'POST', payload, successMsg: 'Unidad creada.' });
  };

  const handleMergeConfirm = () => {
    if (!mergeTarget) return;
    doPersist({
      url: `/api/unidades-medida/${mergeTarget.existing.id}`,
      method: 'PUT',
      payload: mergeTarget.payload,
      successMsg: 'Unidad existente actualizada.',
      targetId: mergeTarget.existing.id,
    });
  };

  const handleRenameConfirm = () => {
    if (!renameWarn) return;
    doPersist({
      url: `/api/unidades-medida/${form.id}`,
      method: 'PUT',
      payload: renameWarn.payload,
      successMsg: 'Unidad actualizada.',
      targetId: form.id,
    });
  };

  // Filas de comparación para el modal de merge (qué se sobrescribe).
  const summaryRows = (u, nombre) => {
    const conv = (u.factorConversion != null && u.factorConversion !== '' && u.unidadBase)
      ? `1 ${nombre} = ${u.factorConversion} ${u.unidadBase}`
      : '—';
    return [
      ['Descripción', u.descripcion || '—'],
      ['Precio', formatPrecio(u.precio) || '—'],
      ['Conversión', conv],
      ['Labor', getLaborNombre(u.labor) || '—'],
    ];
  };

  const matchesFilter = (item) => {
    if (!filter.trim()) return true;
    const q = normalizeText(filter);
    return (
      normalizeText(item.nombre).includes(q) ||
      normalizeText(item.descripcion).includes(q) ||
      normalizeText(item.unidadBase).includes(q) ||
      normalizeText(getLaborNombre(item.labor)).includes(q)
    );
  };
  const filtered = items.filter(matchesFilter);

  // Conversión a medias mientras se tipea: avisamos inline para que el usuario
  // no descubra recién al guardar que falta un campo.
  const convIncomplete = conversionIncomplete(form.factorConversion, form.unidadBase);

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (() => {
        const baseCount    = items.filter(u => u.id !== confirmDelete.id && u.unidadBase === confirmDelete.nombre).length;
        const productCount = productos.filter(p => p.unidad === confirmDelete.nombre).length;
        const hasRefs = baseCount + productCount > 0;
        return (
          <AuroraConfirmModal
            danger
            title={`¿Eliminar la unidad "${confirmDelete.nombre}"?`}
            body={(
              <>
                Esta acción no se puede deshacer.
                {hasRefs ? (
                  <>
                    {productCount > 0 && (
                      <>
                        {' '}
                        <strong>{productCount} {productCount === 1 ? 'producto la tiene' : 'productos la tienen'}</strong>
                        {' '}asignada como unidad y la referencia quedará en un nombre que ya no existe.
                      </>
                    )}
                    {baseCount > 0 && (
                      <>
                        {' '}
                        <strong>{baseCount} {baseCount === 1 ? 'unidad la usa' : 'unidades la usan'}</strong>
                        {' '}como unidad base y dejará{baseCount === 1 ? '' : 'n'} de convertir.
                      </>
                    )}
                  </>
                ) : (
                  ' No encontramos productos ni unidades que la referencien.'
                )}
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
          title={`Ya existe una unidad llamada "${mergeTarget.payload.nombre}"`}
          body="Si confirmás, se sobrescriben los datos de la unidad existente con los nuevos. Si no querés perderlos, cancelá y cambiá el nombre."
          confirmLabel="Actualizar existente"
          cancelLabel="Volver y cambiar nombre"
          loading={saving}
          loadingLabel="Guardando…"
          onConfirm={handleMergeConfirm}
          onCancel={() => setMergeTarget(null)}
        >
          <div className="um-merge-diff">
            <div className="um-merge-col">
              <div className="um-merge-col-title">Actual</div>
              {summaryRows(mergeTarget.existing, mergeTarget.payload.nombre).map(([label, val]) => (
                <div key={label} className="um-merge-row"><span className="um-merge-label">{label}</span><span>{val}</span></div>
              ))}
            </div>
            <div className="um-merge-col um-merge-col--new">
              <div className="um-merge-col-title">Nuevo</div>
              {summaryRows(mergeTarget.payload, mergeTarget.payload.nombre).map(([label, val]) => (
                <div key={label} className="um-merge-row"><span className="um-merge-label">{label}</span><span>{val}</span></div>
              ))}
            </div>
          </div>
        </AuroraConfirmModal>
      )}

      {renameWarn && (
        <AuroraConfirmModal
          icon={<FiAlertTriangle size={16} />}
          iconVariant="warn"
          title={`¿Renombrar "${renameWarn.oldNombre}" a "${renameWarn.newNombre}"?`}
          body={(
            <>
              Las referencias se guardan por nombre y no se actualizan solas.
              {renameWarn.productCount > 0 && (
                <>
                  {' '}
                  <strong>{renameWarn.productCount} {renameWarn.productCount === 1 ? 'producto' : 'productos'}</strong>
                  {' '}quedará{renameWarn.productCount === 1 ? '' : 'n'} apuntando a un nombre inexistente.
                </>
              )}
              {renameWarn.baseCount > 0 && (
                <>
                  {' '}
                  <strong>{renameWarn.baseCount} {renameWarn.baseCount === 1 ? 'unidad' : 'unidades'}</strong>
                  {' '}que la usa{renameWarn.baseCount === 1 ? '' : 'n'} como base dejará{renameWarn.baseCount === 1 ? '' : 'n'} de convertir.
                </>
              )}
              {' '}Tendrás que reasignarlas a mano.
            </>
          )}
          confirmLabel="Renombrar igual"
          cancelLabel="Cancelar"
          loading={saving}
          loadingLabel="Guardando…"
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameWarn(null)}
        />
      )}

      {confirmDiscard && (
        <AuroraConfirmModal
          danger
          title="¿Descartar la unidad a medio escribir?"
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
            <h2 className="aur-sheet-title">Unidades de medida</h2>
            <p className="aur-sheet-subtitle">
              Unidades utilizadas en actividades de campo, dosis de productos y conversiones.
            </p>
          </div>
          {!showForm && !loadError && (
            <div className="aur-sheet-header-actions">
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                <FiPlus size={14} /> Nueva unidad
              </button>
            </div>
          )}
        </header>

        {showForm && (
          <form onSubmit={handleSubmit} ref={formRef} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3>{isEditing ? 'Editar unidad' : 'Nueva unidad'}</h3>
                <div className="aur-section-actions">
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm"
                    onClick={requestReset}
                    title="Cancelar"
                    aria-label="Cerrar formulario"
                    disabled={saving}
                  >
                    <FiX size={14} />
                  </button>
                </div>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-nombre">
                    Nombre <span className="um-required">*</span>
                  </label>
                  <input
                    id="um-nombre"
                    ref={inputRef}
                    className="aur-input"
                    name="nombre"
                    value={form.nombre}
                    onChange={handleChange}
                    placeholder="Ej: Kg, Ha, Jornal…"
                    maxLength={40}
                    required
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-descripcion">Descripción</label>
                  <input
                    id="um-descripcion"
                    className="aur-input"
                    name="descripcion"
                    value={form.descripcion}
                    onChange={handleChange}
                    placeholder="Ej: Kilogramo, Hectárea…"
                    maxLength={80}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3>Conversión</h3>
              </div>
              <p className="um-section-hint">
                Equivalencia de 1 de esta unidad respecto de otra (ej: 1 Saco = 45 Kg). Completá ambos campos o ninguno.
              </p>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-factor">Factor de conversión</label>
                  <input
                    id="um-factor"
                    className="aur-input aur-input--num"
                    name="factorConversion"
                    type="number"
                    min="0"
                    step="any"
                    value={form.factorConversion}
                    onChange={handleChange}
                    placeholder="Ej: 45, 1000…"
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-base">Unidad base</label>
                  <select
                    id="um-base"
                    className="aur-select"
                    name="unidadBase"
                    value={form.unidadBase}
                    onChange={handleChange}
                  >
                    <option value="">— Sin conversión —</option>
                    {items
                      .filter(u => u.id !== form.id)
                      .map(u => (
                        <option key={u.id} value={u.nombre}>
                          {u.nombre}{u.descripcion ? ` — ${u.descripcion}` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {convIncomplete && (
                <p className="um-field-warn">
                  <FiAlertTriangle size={11} /> Completá el factor y la unidad base juntos, o dejá ambos vacíos.
                </p>
              )}
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3>Precio y labor</h3>
              </div>
              <p className="um-section-hint">
                Datos opcionales que se sugieren al usar esta unidad en planillas por unidad.
              </p>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-precio">Precio por unidad</label>
                  <input
                    id="um-precio"
                    className="aur-input aur-input--num"
                    name="precio"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.precio}
                    onChange={handleChange}
                    placeholder="0.00"
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-labor">Labor</label>
                  <LaborCombobox
                    inputId="um-labor"
                    value={form.labor}
                    onChange={id => setForm(prev => ({ ...prev, labor: id }))}
                    labores={labores}
                  />
                </div>
              </div>
            </section>

            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={requestReset} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={saving}>
                <FiCheck size={14} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        )}

        <section className="aur-section">
          {loading ? (
            <div className="aur-page-loading" />
          ) : loadError ? (
            <EmptyState
              icon={FiAlertTriangle}
              title="No se pudieron cargar las unidades."
              subtitle="Probablemente hay un problema de conexión. Probá reintentar."
              action={(
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={fetchItems}>
                  Reintentar
                </button>
              )}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FiPackage}
              title="No hay unidades de medida registradas."
              subtitle="Las unidades se usan en dosis de productos, conversiones y planillas por unidad."
              action={!showForm ? (
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                  <FiPlus size={14} /> Crear primera unidad
                </button>
              ) : null}
            />
          ) : (
            <>
              <div className="aur-table-toolbar um-toolbar">
                <div className="um-search-wrap">
                  <FiSearch size={13} className="um-search-icon" />
                  <input
                    type="search"
                    className="aur-input um-search"
                    placeholder="Buscar…"
                    aria-label="Buscar unidades de medida"
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
                  icon={FiPackage}
                  title="Sin resultados para la búsqueda."
                />
              ) : (
                <ul className="um-list">
                  {filtered.map(item => (
                    <li key={item.id} className={`um-item${item.id === recentId ? ' um-item--just-saved' : ''}`}>
                      <div className="um-item-main">
                        <span className="um-item-title">{item.nombre}</span>
                        <div className="um-item-meta">
                          {item.descripcion && <span>{item.descripcion}</span>}
                          {item.factorConversion != null && item.unidadBase && (
                            <>
                              <span className="um-meta-sep">·</span>
                              <span className="um-meta-conversion">
                                1 {item.nombre} = {item.factorConversion} {item.unidadBase}
                              </span>
                            </>
                          )}
                          {item.precio != null && item.precio !== '' && (
                            <>
                              <span className="um-meta-sep">·</span>
                              <span className="um-meta-precio">{formatPrecio(item.precio)}</span>
                            </>
                          )}
                          {item.labor && (
                            <>
                              <span className="um-meta-sep">·</span>
                              <span className="um-meta-labor">{getLaborNombre(item.labor)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="um-item-actions">
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm"
                          onClick={() => handleEdit(item)}
                          title="Editar"
                          aria-label={`Editar unidad ${item.nombre}`}
                        >
                          <FiEdit size={13} />
                        </button>
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => setConfirmDelete({ id: item.id, nombre: item.nombre })}
                          title="Eliminar"
                          aria-label={`Eliminar unidad ${item.nombre}`}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

export default UnidadesMedida;
