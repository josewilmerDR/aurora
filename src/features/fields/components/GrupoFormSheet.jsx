import { useState, useMemo, useRef, useEffect } from 'react';
import { FiPlus, FiChevronRight } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import NuevoCatalogModal from './NuevoCatalogModal';
import { formatDateForInput, formatHa } from '../lib/lotes-helpers';
import { consolidateBloquesDisponibles } from '../lib/grupo-bloques-helpers';

const EMPTY_FORM = {
  id: null,
  nombreGrupo: '',
  cosecha: '',
  etapa: '',
  fechaCreacion: '',
  bloques: [],
  paqueteId: '',
  paqueteMuestreoId: '',
};

// Formatea una fecha ISO a "12 mar" para el listado de aplicaciones
// pendientes en el moveModal. Si el ISO viene null, devuelve "—".
const formatPendienteDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
};

// Sub-componente del moveModal. Renderea el detalle de aplicaciones
// pendientes del grupo origen — el usuario ve qué exactamente quedará
// sin ejecutar antes de confirmar el move. Maneja tres estados:
//   - loading       → "Cargando…" mientras llega el fetch.
//   - pendientes=[] → mensaje neutro (no debería pasar para estado
//                     en_aplicacion, pero blindamos por si la lista
//                     llegó vacía por race condition).
//   - pendientes>0  → lista ordenada por executeAt asc, "Día N — Nombre
//                     (fecha)".
function PendingAplicacionesList({ loading, pendientes }) {
  if (loading) {
    return (
      <p className="grupo-move-pending-hint" role="status" aria-live="polite">
        Cargando aplicaciones pendientes…
      </p>
    );
  }
  if (!pendientes) {
    // Fetch falló — degradado silencioso: el usuario igual ve el texto
    // del body con el conteo total, solo pierde el detalle.
    return null;
  }
  if (pendientes.length === 0) {
    return (
      <p className="grupo-move-pending-hint">
        No hay aplicaciones pendientes registradas para este grupo.
      </p>
    );
  }
  return (
    <div className="grupo-move-pending">
      <p className="grupo-move-pending-title">
        Quedarán sin ejecutar ({pendientes.length}):
      </p>
      <ul className="grupo-move-pending-list">
        {pendientes.map(p => (
          <li key={p.id}>
            {p.day != null && <span className="grupo-move-pending-day">Día {p.day}</span>}
            <span className="grupo-move-pending-name">{p.activityName}</span>
            <span className="grupo-move-pending-date">{formatPendienteDate(p.executeAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const grupoToForm = (grupo) => ({
  id:                grupo.id,
  nombreGrupo:       grupo.nombreGrupo  || '',
  cosecha:           grupo.cosecha      || '',
  etapa:             grupo.etapa        || '',
  fechaCreacion:     grupo.fechaCreacion ? formatDateForInput(grupo.fechaCreacion) : '',
  bloques:           Array.isArray(grupo.bloques) ? grupo.bloques : [],
  paqueteId:         grupo.paqueteId         || '',
  paqueteMuestreoId: grupo.paqueteMuestreoId || '',
});

/**
 * GrupoFormSheet — sheet de crear/editar grupo.
 *
 * Extraído de GrupoManagement.jsx como parte del refactor del #12 (12d, el
 * cierre del split). Encapsula:
 *   - state local: formData, saving, touched/submitAttempted (validación
 *     inline del #7), showLibres/showEnAplicacion del picker, moveModal
 *     y catalogModal anidados, localCosechas/localEtapas.
 *   - derivados: consolidatedBloques + las 4 agrupaciones por lote
 *     (seleccionados, libres, fuera de aplicación, en aplicación);
 *     cosechas y etapas catalog, filteredPackages, archivedCurrentPackage,
 *     fieldErrors.
 *   - handlers: form change/blur, add/remove/toggle bloques con guardia
 *     de move modal, catalog confirm, submit con scroll-to-error.
 *
 * El padre solo conoce:
 *   - cuándo montar/desmontar el form (vía estado de form mode).
 *   - cómo refrescar y seleccionar el grupo guardado (vía onSuccess).
 *
 * Props:
 *   - mode             string · 'create' | 'edit'
 *   - grupoToEdit      object · grupo para popular el form si mode='edit'
 *   - preloadIds       array  · siembraIds a marcar al abrir en create
 *                                (deep-link desde otra página)
 *   - preloadLoteCode  string · código del lote origen del deep-link
 *                                (para mostrar el toast informativo)
 *   - apiFetch         fn     · POST /api/grupos / PUT /api/grupos/:id
 *   - siembras         array
 *   - bloquesDisponibles array
 *   - bloquesDisponiblesById Map · índice id → bloque disponible
 *   - grupos           array · catálogo de cosechas/etapas previas
 *   - packages         array
 *   - monitoreoPackages array
 *   - showToast        fn(msg, type) · errores de red + toast informativo
 *   - onSuccess        fn({ savedId, action, tasksGenerated, payload }) · padre
 *                       hace refresh + selection + banner persistente
 *   - onCancel         fn · cerrar el form sin guardar
 */
export default function GrupoFormSheet({
  mode,
  grupoToEdit,
  preloadIds,
  preloadLoteCode,
  apiFetch,
  siembras,
  bloquesDisponibles,
  bloquesDisponiblesById,
  grupos,
  packages,
  monitoreoPackages,
  showToast,
  onSuccess,
  onCancel,
}) {
  const isEditing = mode === 'edit';

  // Form inicial: edit → grupoToForm(grupoToEdit); create con preload →
  // EMPTY_FORM con bloques = preloadIds; create normal → EMPTY_FORM.
  const [formData, setFormData] = useState(() => {
    if (isEditing && grupoToEdit) return grupoToForm(grupoToEdit);
    if (Array.isArray(preloadIds) && preloadIds.length > 0) {
      return { ...EMPTY_FORM, bloques: preloadIds };
    }
    return EMPTY_FORM;
  });

  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showLibres, setShowLibres] = useState(false);
  const [showEnAplicacion, setShowEnAplicacion] = useState(false);
  const [moveModal, setMoveModal] = useState(null);
  const [catalogModal, setCatalogModal] = useState(null);
  const [localCosechas, setLocalCosechas] = useState([]);
  const [localEtapas, setLocalEtapas] = useState([]);

  // Toast informativo del deep-link: una sola vez al montar si arranca con
  // preloadIds. Esto vivía en el useEffect de deep-link del padre.
  useEffect(() => {
    if (!isEditing && Array.isArray(preloadIds) && preloadIds.length > 0 && preloadLoteCode) {
      showToast(`Creá un grupo con los bloques sin agrupar de ${preloadLoteCode}.`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nombreGrupoRef    = useRef(null);
  const fechaCreacionRef  = useRef(null);
  const bloquesSectionRef = useRef(null);

  // ── Bloques eligibles ──────────────────────────────────────────────
  // Selection flows through bloquesDisponibles (enriched with grupo state)
  // instead of recomputing from raw siembras. cerradoSiembras se mantiene
  // solo para diferenciar el copy del empty-state cuando no hay nada cerrado.
  const cerradoSiembras = useMemo(() => siembras.filter(s => s.cerrado), [siembras]);

  const consolidatedBloques = useMemo(
    () => consolidateBloquesDisponibles(bloquesDisponibles),
    [bloquesDisponibles]
  );

  const editingGrupoId = isEditing ? formData.id : null;

  const byLoteSeleccionados = useMemo(() => {
    const sel = consolidatedBloques.filter(b => b.ids.some(id => formData.bloques.includes(id)));
    return sel.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [consolidatedBloques, formData.bloques]);

  // A bloque is "free for the picker" when it doesn't belong to any other
  // grupo. Bloques whose grupoActualId matches the grupo being edited are
  // also treated as free here.
  const unselectedBloques = useMemo(
    () => consolidatedBloques.filter(b => !b.ids.some(id => formData.bloques.includes(id))),
    [consolidatedBloques, formData.bloques]
  );

  const byLoteLibres = useMemo(() => {
    const list = unselectedBloques.filter(b =>
      !b.grupoActualId || b.grupoActualId === editingGrupoId
    );
    return list.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [unselectedBloques, editingGrupoId]);

  const byLoteFueraAplicacion = useMemo(() => {
    const list = unselectedBloques.filter(b =>
      b.grupoActualId && b.grupoActualId !== editingGrupoId && b.estado === 'fuera_aplicacion'
    );
    return list.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [unselectedBloques, editingGrupoId]);

  const byLoteEnAplicacion = useMemo(() => {
    const list = unselectedBloques.filter(b =>
      b.grupoActualId && b.grupoActualId !== editingGrupoId && b.estado === 'en_aplicacion'
    );
    return list.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [unselectedBloques, editingGrupoId]);

  const libresCount       = Object.values(byLoteLibres).reduce((sum, arr) => sum + arr.length, 0);
  const fueraCount        = Object.values(byLoteFueraAplicacion).reduce((sum, arr) => sum + arr.length, 0);
  const enAplicacionCount = Object.values(byLoteEnAplicacion).reduce((sum, arr) => sum + arr.length, 0);

  const selectedBlockCount = useMemo(() => {
    const keys = new Set();
    for (const id of formData.bloques) {
      const s = bloquesDisponiblesById.get(id) || siembras.find(x => x.id === id);
      if (s) keys.add(`${s.loteId}__${s.bloque}`);
    }
    return keys.size;
  }, [formData.bloques, bloquesDisponiblesById, siembras]);

  // ── Catalogos cosecha/etapa ───────────────────────────────────────────
  const cosechasCatalog = useMemo(() =>
    [...new Set([
      ...grupos.map(g => g.cosecha).filter(Boolean),
      ...packages.map(p => p.tipoCosecha).filter(Boolean),
      ...localCosechas,
    ])].sort(),
  [grupos, packages, localCosechas]);

  const etapasCatalog = useMemo(() =>
    [...new Set([
      ...grupos.map(g => g.etapa).filter(Boolean),
      ...packages.map(p => p.etapaCultivo).filter(Boolean),
      ...localEtapas,
    ])].sort(),
  [grupos, packages, localEtapas]);

  // Solo paquetes activos (no archivados) que matcheen cosecha/etapa.
  const filteredPackages = useMemo(() =>
    packages.filter(p =>
      !p.archivedAt &&
      (!formData.cosecha || p.tipoCosecha === formData.cosecha) &&
      (!formData.etapa   || p.etapaCultivo === formData.etapa)
    ),
  [packages, formData.cosecha, formData.etapa]);

  // Si el paquete asignado al grupo en edición está archivado o no matchea
  // los filtros, lo emitimos como fallback option para no perder la selección.
  const archivedCurrentPackage = useMemo(() => {
    if (!formData.paqueteId) return null;
    const cur = packages.find(p => p.id === formData.paqueteId);
    if (!cur) return null;
    return filteredPackages.find(p => p.id === cur.id) ? null : cur;
  }, [packages, formData.paqueteId, filteredPackages]);

  // ── Validación inline ─────────────────────────────────────────────────
  const fieldErrors = useMemo(() => {
    const errors = {};
    const nombre = (formData.nombreGrupo || '').trim();
    if (!nombre) errors.nombreGrupo = 'El nombre es requerido.';
    else if (nombre.length > 16) errors.nombreGrupo = 'Máximo 16 caracteres.';

    if (!formData.fechaCreacion) {
      errors.fechaCreacion = 'La fecha de creación es requerida.';
    } else {
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + 15);
      maxDate.setHours(23, 59, 59, 999);
      if (new Date(formData.fechaCreacion) > maxDate) {
        errors.fechaCreacion = 'No puede superar 15 días en el futuro.';
      }
    }
    if (!formData.bloques || formData.bloques.length === 0) {
      errors.bloques = 'Seleccioná al menos un bloque.';
    }
    return errors;
  }, [formData.nombreGrupo, formData.fechaCreacion, formData.bloques]);

  const shouldShowError = (field) =>
    (submitAttempted || touched.has(field)) && !!fieldErrors[field];

  // ── Handlers form ──────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'cosecha' || name === 'etapa') next.paqueteId = '';
      return next;
    });
  };

  const handleFieldBlur = (e) => {
    const { name } = e.target;
    setTouched(prev => prev.has(name) ? prev : new Set(prev).add(name));
  };

  const addBloque = (ids) =>
    setFormData(prev => {
      const newIds = ids.filter(id => !prev.bloques.includes(id));
      return { ...prev, bloques: [...prev.bloques, ...newIds] };
    });

  const toggleBloque = (ids) =>
    setFormData(prev => {
      const allSelected = ids.every(id => prev.bloques.includes(id));
      if (allSelected) {
        return { ...prev, bloques: prev.bloques.filter(id => !ids.includes(id)) };
      }
      const newIds = ids.filter(id => !prev.bloques.includes(id));
      return { ...prev, bloques: [...prev.bloques, ...newIds] };
    });

  // Si el bloque pertenece a otro grupo (y no es uno de los del grupo en
  // edición), abrimos modal de confirmación. Para bloques "en aplicación
  // activa" disparamos un fetch lazy con el detalle de aplicaciones
  // pendientes — el usuario ve qué exactamente quedará sin ejecutar antes
  // de confirmar el move.
  const handleAddBloque = (bloque) => {
    if (!bloque.grupoActualId || bloque.grupoActualId === editingGrupoId) {
      addBloque(bloque.ids);
      return;
    }
    if (bloque.estado === 'en_aplicacion') {
      // Mostramos el modal con loading inmediatamente para evitar el delay
      // visual entre click y aparición. Si el fetch falla, el modal queda
      // sin la lista pero el flujo no se rompe (degraded gracefully).
      setMoveModal({ ...bloque, loadingPendientes: true, pendientes: null });
      apiFetch(`/api/grupos/${bloque.grupoActualId}/aplicaciones-pendientes`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          // El usuario puede haber cerrado el modal mientras cargaba.
          // Verificamos contra el bloque del modal actual antes de pisar.
          setMoveModal(prev => prev && prev.grupoActualId === bloque.grupoActualId
            ? { ...prev, loadingPendientes: false, pendientes: data.pendientes || [] }
            : prev);
        })
        .catch(() => {
          setMoveModal(prev => prev && prev.grupoActualId === bloque.grupoActualId
            ? { ...prev, loadingPendientes: false, pendientes: null }
            : prev);
        });
      return;
    }
    setMoveModal(bloque);
  };

  const confirmMoveBloque = () => {
    if (!moveModal) return;
    addBloque(moveModal.ids);
    setMoveModal(null);
  };

  const handleCatalogConfirm = (nombre) => {
    const { field } = catalogModal;
    if (field === 'cosecha') {
      setLocalCosechas(prev => [...new Set([...prev, nombre])]);
      setFormData(prev => ({ ...prev, cosecha: nombre, paqueteId: '' }));
    } else {
      setLocalEtapas(prev => [...new Set([...prev, nombre])]);
      setFormData(prev => ({ ...prev, etapa: nombre, paqueteId: '' }));
    }
    setCatalogModal(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Guard re-entry: el botón ya queda disabled durante saving, pero Enter
    // en un input dispara onSubmit sin pasar por el botón — sin esto, dos
    // Enter rápidos antes del re-render se traducen en dos POST.
    if (saving) return;
    // Validación: si fieldErrors tiene cualquier mensaje, marcamos
    // submitAttempted y hacemos scroll + focus al primero. No usamos
    // toast — el mensaje vive debajo del campo, persistente y accionable.
    if (Object.keys(fieldErrors).length > 0) {
      setSubmitAttempted(true);
      const order = ['nombreGrupo', 'fechaCreacion', 'bloques'];
      const firstError = order.find(f => fieldErrors[f]);
      const refMap = {
        nombreGrupo:   nombreGrupoRef,
        fechaCreacion: fechaCreacionRef,
        bloques:       bloquesSectionRef,
      };
      const ref = refMap[firstError]?.current;
      if (ref) {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof ref.focus === 'function') {
          // setTimeout para que el focus no compita con el scroll smooth.
          setTimeout(() => ref.focus({ preventScroll: true }), 300);
        }
      }
      return;
    }
    const url    = isEditing ? `/api/grupos/${formData.id}` : '/api/grupos';
    const method = isEditing ? 'PUT' : 'POST';
    setSaving(true);
    try {
      const { id: _id, ...payload } = formData;
      payload.nombreGrupo = payload.nombreGrupo.trim();
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      const savedId = isEditing ? formData.id : saved.id;
      // El padre maneja: refreshAfterMutation, setSelectedGrupo, banner
      // persistente, setFormMode(null). El form no se preocupa por nada
      // de eso — solo emite el evento de éxito con la metadata necesaria.
      onSuccess({
        savedId,
        action: isEditing ? 'updated' : 'created',
        tasksGenerated: !isEditing && !!formData.paqueteId,
      });
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {catalogModal && (
        <NuevoCatalogModal
          field={catalogModal.field}
          onConfirm={handleCatalogConfirm}
          onCancel={() => setCatalogModal(null)}
        />
      )}
      {moveModal && (
        <AuroraConfirmModal
          danger={moveModal.estado === 'en_aplicacion'}
          title={`¿Mover este bloque desde "${moveModal.grupoActualNombre}"?`}
          body={(() => {
            const ubic = `Bloque ${moveModal.bloque || '—'} de ${moveModal.loteNombre || '—'}`;
            const apl  = (moveModal.aplicacionesTotales != null && moveModal.aplicacionesTotales > 0)
              ? ` Lleva ${moveModal.aplicacionesCompletadas}/${moveModal.aplicacionesTotales} aplicaciones del paquete.`
              : '';
            const aviso = moveModal.estado === 'en_aplicacion'
              ? ' El paquete del grupo origen sigue activo: al mover este bloque dejará de recibir las aplicaciones pendientes de ese grupo.'
              : ' El paquete del grupo origen ya completó sus aplicaciones, así que mover este bloque no interrumpe nada en curso.';
            return `${ubic} pertenece al grupo "${moveModal.grupoActualNombre}".${apl}${aviso} La transición quedará registrada en el historial.`;
          })()}
          confirmLabel={moveModal.estado === 'en_aplicacion' ? 'Mover de todas formas' : 'Mover bloque'}
          onConfirm={confirmMoveBloque}
          onCancel={() => setMoveModal(null)}
        >
          {moveModal.estado === 'en_aplicacion' && (
            <PendingAplicacionesList
              loading={moveModal.loadingPendientes}
              pendientes={moveModal.pendientes}
            />
          )}
        </AuroraConfirmModal>
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">{isEditing ? 'Editar Grupo' : 'Crear Nuevo Grupo'}</h1>
          </div>
        </header>
        <form onSubmit={handleSubmit} noValidate>
          <section className="aur-section">
            <div className="aur-section-header">
              <h3 className="aur-section-title">Identificación</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="nombreGrupo">Nombre de Grupo</label>
                <div>
                  <input
                    ref={nombreGrupoRef}
                    id="nombreGrupo"
                    name="nombreGrupo"
                    className={`aur-input${shouldShowError('nombreGrupo') ? ' aur-input--error' : ''}`}
                    value={formData.nombreGrupo}
                    onChange={handleInputChange}
                    onBlur={handleFieldBlur}
                    placeholder="Ej. G-04-26"
                    required
                    maxLength={16}
                    aria-invalid={shouldShowError('nombreGrupo')}
                    aria-describedby={shouldShowError('nombreGrupo') ? 'nombreGrupo-error' : undefined}
                  />
                  {shouldShowError('nombreGrupo') && (
                    <span id="nombreGrupo-error" className="aur-field-error" role="alert">
                      {fieldErrors.nombreGrupo}
                    </span>
                  )}
                </div>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="fechaCreacion">Fecha de Creación</label>
                <div>
                  <input
                    ref={fechaCreacionRef}
                    id="fechaCreacion"
                    name="fechaCreacion"
                    className={`aur-input${shouldShowError('fechaCreacion') ? ' aur-input--error' : ''}`}
                    type="date"
                    value={formData.fechaCreacion}
                    onChange={handleInputChange}
                    onBlur={handleFieldBlur}
                    required
                    max={(() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().split('T')[0]; })()}
                    aria-invalid={shouldShowError('fechaCreacion')}
                    aria-describedby={shouldShowError('fechaCreacion') ? 'fechaCreacion-error' : undefined}
                  />
                  {shouldShowError('fechaCreacion') && (
                    <span id="fechaCreacion-error" className="aur-field-error" role="alert">
                      {fieldErrors.fechaCreacion}
                    </span>
                  )}
                </div>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="cosecha">Cosecha</label>
                <select
                  id="cosecha"
                  name="cosecha"
                  className="aur-select"
                  value={formData.cosecha}
                  onChange={e => {
                    if (e.target.value === '__nueva__') {
                      setCatalogModal({ field: 'cosecha' });
                    } else {
                      handleInputChange(e);
                    }
                  }}
                >
                  <option value="">— Seleccionar —</option>
                  {cosechasCatalog.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__nueva__">＋ Nueva cosecha</option>
                </select>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="etapa">Etapa</label>
                <select
                  id="etapa"
                  name="etapa"
                  className="aur-select"
                  value={formData.etapa}
                  onChange={e => {
                    if (e.target.value === '__nueva__') {
                      setCatalogModal({ field: 'etapa' });
                    } else {
                      handleInputChange(e);
                    }
                  }}
                >
                  <option value="">— Seleccionar —</option>
                  {etapasCatalog.map(e => <option key={e} value={e}>{e}</option>)}
                  <option value="__nueva__">＋ Nueva etapa</option>
                </select>
              </div>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <h3 className="aur-section-title">Paquetes</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="paqueteId">Aplicaciones</label>
                <select
                  id="paqueteId"
                  name="paqueteId"
                  className="aur-select"
                  value={formData.paqueteId}
                  onChange={handleInputChange}
                  disabled={filteredPackages.length === 0 && !archivedCurrentPackage}
                >
                  <option value="">{filteredPackages.length === 0 && !archivedCurrentPackage ? '— Sin paquetes para esta cosecha/etapa —' : '— Seleccionar Paquete —'}</option>
                  {filteredPackages.map(p => <option key={p.id} value={p.id}>{p.nombrePaquete}</option>)}
                  {/* Fallback para preservar el valor cuando el paquete
                      asignado quedó archivado (o cambiaron los filtros).
                      Sin esto, el select pierde su selección al editar. */}
                  {archivedCurrentPackage && (
                    <option value={archivedCurrentPackage.id}>
                      {archivedCurrentPackage.nombrePaquete}
                      {archivedCurrentPackage.archivedAt ? ' (archivado)' : ' (no coincide con filtros)'}
                    </option>
                  )}
                </select>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="paqueteMuestreoId">Muestreos</label>
                <select
                  id="paqueteMuestreoId"
                  name="paqueteMuestreoId"
                  className="aur-select"
                  value={formData.paqueteMuestreoId}
                  onChange={handleInputChange}
                  disabled={monitoreoPackages.length === 0}
                >
                  <option value="">{monitoreoPackages.length === 0 ? '— Sin paquetes de muestreo —' : '— Seleccionar Paquete —'}</option>
                  {monitoreoPackages.map(p => <option key={p.id} value={p.id}>{p.nombrePaquete}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* ── Sección 3: Bloques del grupo ── */}
          <section className="aur-section" ref={bloquesSectionRef}>
            <div className="aur-section-header">
              <h3 className="aur-section-title">Bloques del grupo</h3>
              <span className="aur-section-count">{selectedBlockCount} asignado(s)</span>
            </div>
            {shouldShowError('bloques') && (
              <span className="aur-field-error" role="alert" style={{ display: 'block', padding: '4px 14px 0' }}>
                {fieldErrors.bloques}
              </span>
            )}

            {Object.entries(byLoteSeleccionados).map(([loteNombre, registros]) => (
              <div key={loteNombre} className="bloque-lote-group">
                <div className="bloque-lote-label">{loteNombre}</div>
                {registros.map(s => (
                  <div key={s.key} className="bloque-checkbox-row checked">
                    <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                    <span className="bloque-meta">
                      {s.plantas?.toLocaleString()} plantas
                      {s.areaCalculada ? ` · ${formatHa(s.areaCalculada)} ha` : ''}
                      {s.variedad ? ` · ${s.variedad}` : ''}
                    </span>
                    <button type="button" className="aur-btn-text" onClick={() => toggleBloque(s.ids)}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {selectedBlockCount === 0 && (
              <div className="bloques-empty-wrap">
                <p className="bloques-empty">
                  {cerradoSiembras.length === 0
                    ? 'No hay bloques cerrados. Ciérralos desde el Historial de Siembra.'
                    : (libresCount + fueraCount + enAplicacionCount === 0
                        ? 'No hay bloques disponibles para crear este grupo.'
                        : 'Sin bloques asignados aún.')}
                </p>
                {(libresCount + fueraCount + enAplicacionCount) > 0 && (
                  <button
                    type="button"
                    className="aur-chip"
                    onClick={() => setShowLibres(v => !v)}
                  >
                    <FiPlus size={13} /> {showLibres ? 'Cerrar' : 'Agregar bloques'}
                  </button>
                )}
              </div>
            )}

            {selectedBlockCount > 0 && (libresCount + fueraCount + enAplicacionCount) > 0 && (
              <div className="bloques-agregar-wrap">
                <button
                  type="button"
                  className="aur-chip"
                  onClick={() => setShowLibres(v => !v)}
                >
                  <FiPlus size={13} /> {showLibres ? 'Cerrar' : 'Agregar bloques'}
                </button>
              </div>
            )}
          </section>

          {/* ── Sección 4: Picker tabulado (libres → fuera → en aplicación) ── */}
          {showLibres && (libresCount + fueraCount + enAplicacionCount) > 0 && (
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Bloques disponibles</h3>
                <span className="aur-section-count">
                  {libresCount + fueraCount + enAplicacionCount} en total
                </span>
              </div>

              {/* 4a — Libres / sin grupo */}
              {libresCount > 0 && (
                <div className="bloque-tier">
                  <div className="bloque-tier-header">
                    <span className="bloque-tier-title">Sin grupo</span>
                    <span className="bloque-tier-count">{libresCount}</span>
                  </div>
                  {Object.entries(byLoteLibres).map(([loteNombre, registros]) => (
                    <div key={loteNombre} className="bloque-lote-group">
                      <div className="bloque-lote-label">{loteNombre}</div>
                      {registros.map(s => (
                        <div key={s.key} className="bloque-checkbox-row">
                          <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                          <span className="bloque-meta">
                            {s.plantas?.toLocaleString()} plantas
                            {s.areaCalculada ? ` · ${formatHa(s.areaCalculada)} ha` : ''}
                            {s.variedad ? ` · ${s.variedad}` : ''}
                          </span>
                          <button type="button" className="aur-btn-text" onClick={() => handleAddBloque(s)}>
                            Agregar
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* 4b — Fuera de aplicación */}
              {fueraCount > 0 && (
                <div className="bloque-tier bloque-tier--warn">
                  <div className="bloque-tier-header">
                    <span className="bloque-tier-title">Fuera de aplicación</span>
                    <span className="bloque-tier-count">{fueraCount}</span>
                  </div>
                  <p className="bloque-tier-hint">
                    Pertenecen a otros grupos cuyo paquete ya completó todas las aplicaciones. Pueden moverse aquí sin interrumpir aplicaciones pendientes.
                  </p>
                  {Object.entries(byLoteFueraAplicacion).map(([loteNombre, registros]) => (
                    <div key={loteNombre} className="bloque-lote-group">
                      <div className="bloque-lote-label">{loteNombre}</div>
                      {registros.map(s => (
                        <div key={s.key} className="bloque-checkbox-row">
                          <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                          <span className="bloque-meta">
                            {s.plantas?.toLocaleString()} plantas
                            {s.areaCalculada ? ` · ${formatHa(s.areaCalculada)} ha` : ''}
                            {s.variedad ? ` · ${s.variedad}` : ''}
                            {s.grupoActualNombre ? ` · Grupo ${s.grupoActualNombre}` : ''}
                            {s.aplicacionesTotales ? ` · ${s.aplicacionesCompletadas}/${s.aplicacionesTotales} aplicaciones` : ''}
                          </span>
                          <button type="button" className="aur-btn-text" onClick={() => handleAddBloque(s)}>
                            Agregar
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* 4c — En aplicación activa (colapsado por default) */}
              {enAplicacionCount > 0 && (
                <div className="bloque-tier bloque-tier--danger">
                  <button
                    type="button"
                    className="bloque-tier-toggle"
                    onClick={() => setShowEnAplicacion(v => !v)}
                    aria-expanded={showEnAplicacion}
                    aria-controls="bloque-tier-en-aplicacion-content"
                  >
                    <span className="bloque-tier-title">En aplicación activa</span>
                    <span className="bloque-tier-count">{enAplicacionCount}</span>
                    <FiChevronRight
                      size={14}
                      className={`bloque-tier-chevron${showEnAplicacion ? ' is-open' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                  {showEnAplicacion && (
                    <div id="bloque-tier-en-aplicacion-content">
                      <p className="bloque-tier-hint">
                        Pertenecen a otros grupos con paquete pendiente. Moverlos aquí interrumpe las aplicaciones programadas — usar con precaución.
                      </p>
                      {Object.entries(byLoteEnAplicacion).map(([loteNombre, registros]) => (
                        <div key={loteNombre} className="bloque-lote-group">
                          <div className="bloque-lote-label">{loteNombre}</div>
                          {registros.map(s => (
                            <div key={s.key} className="bloque-checkbox-row">
                              <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                              <span className="bloque-meta">
                                {s.plantas?.toLocaleString()} plantas
                                {s.areaCalculada ? ` · ${formatHa(s.areaCalculada)} ha` : ''}
                                {s.variedad ? ` · ${s.variedad}` : ''}
                                {s.grupoActualNombre ? ` · Grupo ${s.grupoActualNombre}` : ''}
                                {s.aplicacionesTotales ? ` · ${s.aplicacionesCompletadas}/${s.aplicacionesTotales} aplicaciones` : ''}
                              </span>
                              <button type="button" className="aur-btn-text" onClick={() => handleAddBloque(s)}>
                                Agregar
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          <div className="aur-form-actions">
            <button type="button" onClick={onCancel} className="aur-btn-text" disabled={saving}>Cancelar</button>
            <button type="submit" className="aur-btn-pill" disabled={saving}>
              <FiPlus size={14} /> {saving ? 'Guardando…' : (isEditing ? 'Actualizar Grupo' : 'Crear Grupo')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
