import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiClock, FiPlus, FiChevronUp, FiChevronDown, FiBookmark, FiX, FiInfo } from 'react-icons/fi';
import AuroraField, { TextInput, Textarea } from '../../../components/AuroraField';
import { translateApiError } from '../../../lib/errorMessages';
import ActivityCard from './ActivityCard';
import {
  NOMBRE_MAX,
  DESCRIPCION_MAX,
  TECNICO_MAX,
  ACT_NAME_MAX,
  ACT_PRODUCTOS_MAX,
  getPackageFieldError,
  getActivityFieldError,
  getProductCantidadError,
  buildValidationToast,
  calcularCosto,
} from '../lib/packages-helpers';
import {
  PKG_DRAFT_SS_KEY,
  loadPackageDraft,
  savePackageDraft,
  clearPackageDraft,
  isPackageDraftMeaningful,
} from '../lib/packages-draft';
import { computePackageChanges } from '../lib/packages-diff';

const EMPTY_FORM_DATA = {
  id: null,
  nombrePaquete: '',
  descripcion: '',
  tipoCosecha: '',
  etapaCultivo: '',
  tecnicoResponsable: '',
  activities: [],
};

/**
 * PackageForm — form de crear/editar un paquete de aplicaciones.
 *
 * Extraído de PackageManagement.jsx (Fase F del refactor). Es el componente
 * más grande de la página y dueño de TODO el estado del form, los handlers
 * de validación/edición/submit, los efectos de persistencia del borrador y
 * el modal compacto de creación de plantilla.
 *
 * Props (data):
 *   - mode                 'create' | 'edit'
 *   - initialData          object (paquete o defaults) · datos iniciales
 *   - restoredFromDraft    bool · true si initialData viene de localStorage
 *   - users, productos, productosById, calibraciones, plantillas,
 *     eligibleResponsables · catálogos compartidos.
 *
 * Props (callbacks):
 *   - apiFetch       fn   · wrapper de fetch autenticado del padre
 *   - onSave({savedId, savedName, savedAction})  · post-success
 *   - onCancel       fn   · click en "Cancelar" (padre decide guardar/descartar)
 *   - onDirtyChange  fn   · notifica isDirty al padre para guardedNav externos
 *   - onShowToast(msg, type) · feedback efímero
 *   - onPlantillaCreated(plantilla) · cuando se crea desde el modal inline
 */
export default function PackageForm({
  mode,
  initialData,
  restoredFromDraft = false,
  users,
  productos,
  productosById,
  calibraciones,
  plantillas,
  eligibleResponsables,
  apiFetch,
  onSave,
  onCancel,
  onDirtyChange,
  onShowToast,
  onPlantillaCreated,
}) {
  const isEditing = mode === 'edit';

  const [formData, setFormData] = useState(() => initialData || EMPTY_FORM_DATA);
  const [formErrors, setFormErrors] = useState({});
  const [expandedActivities, setExpandedActivities] = useState(() => {
    const n = (initialData?.activities || []).length;
    // Por defecto: abrir todas en edit (para mostrar lo guardado), solo la
    // primera al crear nuevo, ninguna si llegamos sin actividades.
    if (n === 0) return new Set();
    if (mode === 'edit') return new Set([...Array(n).keys()]);
    return new Set([0]);
  });
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [templateModal, setTemplateModal] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [draftRestored, setDraftRestored] = useState(restoredFromDraft);

  // Snapshot original para diff (solo aplica en edit). Se congela al montar:
  // si el server actualiza el paquete en background no queremos que el badge
  // de "cambios" salte solo.
  const [originalSnapshot] = useState(() => isEditing ? initialData : null);

  const changes = useMemo(
    () => computePackageChanges(formData, originalSnapshot),
    [formData, originalSnapshot]
  );

  // Costos por actividad. Recalcula cuando cambian las actividades o el
  // catálogo. Si se tipea en campos no-producto, el memo evita el trabajo.
  const formActivityCosts = useMemo(() => {
    return (formData.activities || []).map(act => calcularCosto(act.productos, productosById));
  }, [formData.activities, productosById]);

  const allActivitiesExpanded = formData.activities.length > 0
    && formData.activities.every((_, i) => expandedActivities.has(i));

  // ── Notificación al padre cuando cambia isDirty ─────────────────────────────
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // ── Autoguardado del borrador en cada cambio del form ───────────────────────
  // Persiste `id` para que la restauración pueda reabrir en el mismo modo.
  useEffect(() => {
    const snapshot = {
      id: formData.id || null,
      nombrePaquete: formData.nombrePaquete,
      descripcion: formData.descripcion,
      tipoCosecha: formData.tipoCosecha,
      etapaCultivo: formData.etapaCultivo,
      tecnicoResponsable: formData.tecnicoResponsable,
      activities: formData.activities,
    };
    if (isPackageDraftMeaningful(snapshot)) savePackageDraft(snapshot);
    else clearPackageDraft();
  }, [formData]);

  // ── Atajo Ctrl/Cmd + S → enviar el form ────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        document.querySelector('.pkg-form')?.requestSubmit?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Marca el sessionStorage de borrador activo al montar (para el badge del
  // sidebar). El padre lo limpia con clearPackageDraft tras guardar/descartar.
  useEffect(() => {
    try {
      sessionStorage.setItem(PKG_DRAFT_SS_KEY, '1');
      window.dispatchEvent(new CustomEvent('aurora-draft-change'));
    } catch {}
  }, []);

  const markDirty = () => setIsDirty(true);

  const clearError = (key) => {
    setFormErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleAllActivities = () => {
    if (allActivitiesExpanded) {
      setExpandedActivities(new Set());
    } else {
      setExpandedActivities(new Set(formData.activities.map((_, i) => i)));
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'tipoCosecha' && value === 'Semillero' ? { etapaCultivo: 'N/A' } : {}),
    }));
    markDirty();
    clearError(name);
    if (name === 'tipoCosecha' && value === 'Semillero') clearError('etapaCultivo');
  };

  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index] = { ...updatedActivities[index], [field]: value };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    markDirty();
    if (field === 'day' || field === 'name') clearError(`act-${index}-${field}`);
  };

  const addActivity = () => {
    setFormData(prev => {
      const newIndex = prev.activities.length;
      setExpandedActivities(exp => {
        const next = new Set(exp);
        next.add(newIndex);
        return next;
      });
      return {
        ...prev,
        activities: [...prev.activities, { day: '', name: '', responsableId: '', calibracionId: '', productos: [] }]
      };
    });
    markDirty();
  };

  // Shift error keys when activities are inserted/removed at `index`.
  // delta = +1 cuando se inserta en index+1; delta = -1 cuando se quita en index.
  const shiftActivityErrors = (index, delta) => {
    setFormErrors(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const m = k.match(/^act-(\d+)-(.+)$/);
        if (!m) { next[k] = v; return; }
        const i = Number(m[1]);
        if (delta < 0 && i === index) return; // drop errors of removed activity
        if (delta > 0 && i > index) next[`act-${i + 1}-${m[2]}`] = v;
        else if (delta < 0 && i > index) next[`act-${i - 1}-${m[2]}`] = v;
        else next[k] = v;
      });
      return next;
    });
  };

  const duplicateActivity = (index) => {
    setFormData(prev => {
      const copy = JSON.parse(JSON.stringify(prev.activities[index]));
      if (copy.name) copy.name = `Copia de ${copy.name}`;
      return {
        ...prev,
        activities: [
          ...prev.activities.slice(0, index + 1),
          copy,
          ...prev.activities.slice(index + 1),
        ],
      };
    });
    setExpandedActivities(prev => {
      const next = new Set();
      prev.forEach(i => { if (i <= index) next.add(i); else next.add(i + 1); });
      return next;
    });
    shiftActivityErrors(index, +1);
    setPendingDeleteIdx(null);
    markDirty();
  };

  const removeActivity = (index) => {
    setFormData(prev => ({ ...prev, activities: prev.activities.filter((_, i) => i !== index) }));
    setPendingDeleteIdx(null);
    setExpandedActivities(prev => {
      const next = new Set();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
    shiftActivityErrors(index, -1);
    markDirty();
  };

  const toggleActivityExpand = (index) => {
    setExpandedActivities(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addProductToActivity = (activityIndex, productoId) => {
    if (!productoId) return;
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;
    const updatedActivities = [...formData.activities];
    const existing = updatedActivities[activityIndex].productos || [];
    if (existing.find(p => p.productoId === productoId)) return;
    if (existing.length >= ACT_PRODUCTOS_MAX) {
      onShowToast?.(`Máximo ${ACT_PRODUCTOS_MAX} productos por aplicación.`, 'error');
      return;
    }
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: [
        ...existing,
        {
          productoId: producto.id,
          nombreComercial: producto.nombreComercial,
          cantidadPorHa: '',
          unidad: producto.unidad,
          periodoReingreso: producto.periodoReingreso,
          periodoACosecha: producto.periodoACosecha,
        },
      ],
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    clearError(`act-${activityIndex}-prods`);
    markDirty();
  };

  const removeProductFromActivity = (activityIndex, productoId) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.filter(p => p.productoId !== productoId),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    clearError(`act-${activityIndex}-prod-${productoId}-cant`);
    clearError(`act-${activityIndex}-prods`);
    markDirty();
  };

  const updateProductCantidad = (activityIndex, productoId, newCantidad) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.map(p =>
        p.productoId === productoId ? { ...p, cantidadPorHa: newCantidad } : p
      ),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    clearError(`act-${activityIndex}-prod-${productoId}-cant`);
    markDirty();
  };

  const aplicarPlantillaAActividad = (activityIndex, plantillaId) => {
    const plantilla = plantillas.find(p => p.id === plantillaId);
    if (!plantilla) return;
    const productosDeActividad = plantilla.productos
      .map(tp => {
        const cat = productos.find(p => p.id === tp.productoId);
        if (!cat) return null;
        return {
          productoId: cat.id,
          nombreComercial: cat.nombreComercial,
          cantidadPorHa: tp.cantidad || 0,
          unidad: cat.unidad,
          periodoReingreso: cat.periodoReingreso,
          periodoACosecha: cat.periodoACosecha,
        };
      })
      .filter(Boolean);
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      name: plantilla.nombre || updatedActivities[activityIndex].name,
      responsableId: plantilla.responsableId || updatedActivities[activityIndex].responsableId,
      productos: productosDeActividad,
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    setExpandedActivities(prev => new Set(prev).add(activityIndex));
    setFormErrors(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        if (!k.startsWith(`act-${activityIndex}-`)) next[k] = v;
      });
      return next;
    });
    markDirty();
  };

  // ── Crear plantilla inline desde el form del paquete ──────────────────────
  // El flujo de /tasks para crear plantillas tiene muchos campos extra
  // (fecha, lote, bloque, etc.) que no aplican acá. Este modal compacto usa
  // la misma ruta `POST /api/task-templates` pero solo pide lo esencial.
  const openTemplateModal = (activityIndex) => {
    const act = formData.activities[activityIndex] || {};
    const hasProductos = (act.productos || []).length > 0;
    setTemplateModal({
      activityIndex,
      nombre: (act.name || '').trim(),
      responsableId: act.responsableId || '',
      includeProductos: hasProductos,
    });
  };

  const handleSaveTemplate = async () => {
    if (!templateModal) return;
    const nombre = templateModal.nombre.trim();
    if (!nombre) return;
    setSavingTemplate(true);
    try {
      const act = formData.activities[templateModal.activityIndex] || {};
      const productosPayload = templateModal.includeProductos
        ? (act.productos || []).map(p => ({
            productoId: p.productoId,
            cantidad: Number(p.cantidadPorHa) || 0,
          }))
        : [];
      const res = await apiFetch('/api/task-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          responsableId: templateModal.responsableId || '',
          productos: productosPayload,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw body;
      }
      const created = await res.json();
      onPlantillaCreated?.(created);
      onShowToast?.(`Plantilla "${nombre}" creada.`);
      setTemplateModal(null);
    } catch (body) {
      onShowToast?.(translateApiError(body, 'No se pudo crear la plantilla.'), 'error');
    } finally {
      setSavingTemplate(false);
    }
  };

  const validateForm = () => {
    const errors = {};
    const expandIndices = new Set();

    for (const f of ['nombrePaquete', 'descripcion', 'tecnicoResponsable', 'tipoCosecha', 'etapaCultivo']) {
      const e = getPackageFieldError(f, formData[f]);
      if (e) errors[f] = e;
    }

    formData.activities.forEach((a, i) => {
      const nameErr = getActivityFieldError('name', a.name);
      if (nameErr) { errors[`act-${i}-name`] = nameErr; expandIndices.add(i); }

      const dayErr = getActivityFieldError('day', a.day);
      if (dayErr) { errors[`act-${i}-day`] = dayErr; expandIndices.add(i); }

      const prods = a.productos || [];
      if (prods.length > ACT_PRODUCTOS_MAX) {
        errors[`act-${i}-prods`] = `Máximo ${ACT_PRODUCTOS_MAX} productos por aplicación.`;
        expandIndices.add(i);
      }
      prods.forEach(p => {
        const cantErr = getProductCantidadError(p.cantidadPorHa);
        if (cantErr) {
          errors[`act-${i}-prod-${p.productoId}-cant`] = cantErr;
          expandIndices.add(i);
        }
      });
    });

    return { errors, expandIndices };
  };

  const handleFieldBlur = (field) => {
    const err = getPackageFieldError(field, formData[field]);
    if (err) setFormErrors(prev => ({ ...prev, [field]: err }));
    else clearError(field);
  };

  const handleActivityBlur = (index, field) => {
    const err = getActivityFieldError(field, formData.activities[index]?.[field]);
    const key = `act-${index}-${field}`;
    if (err) setFormErrors(prev => ({ ...prev, [key]: err }));
    else clearError(key);
  };

  const handleProductCantidadBlur = (activityIndex, productoId, value) => {
    const err = getProductCantidadError(value);
    const key = `act-${activityIndex}-prod-${productoId}-cant`;
    if (err) setFormErrors(prev => ({ ...prev, [key]: err }));
    else clearError(key);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const { errors, expandIndices } = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setExpandedActivities(prev => {
        const next = new Set(prev);
        expandIndices.forEach(i => next.add(i));
        return next;
      });
      onShowToast?.(buildValidationToast(errors), 'error');
      // Scroll al primer error tras el siguiente repaint.
      requestAnimationFrame(() => {
        const first = document.querySelector('.pkg-form .fld-error-input');
        if (first) {
          first.scrollIntoView({ block: 'center', behavior: 'smooth' });
          try { first.focus({ preventScroll: true }); } catch { /* noop */ }
        }
      });
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    const url = isEditing ? `/api/packages/${formData.id}` : '/api/packages';
    const method = isEditing ? 'PUT' : 'POST';
    const sortedActivities = [...formData.activities].sort((a, b) => Number(a.day) - Number(b.day));
    const body = {
      ...formData,
      activities: sortedActivities.map(a => ({
        ...a,
        type: (a.productos && a.productos.length > 0) ? 'aplicacion' : 'notificacion',
        productos: (a.productos || []).map(p => ({ ...p, cantidadPorHa: Number(p.cantidadPorHa) })),
      })),
    };
    try {
      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      // POST devuelve `{ id, ...pkg }`; PUT no devuelve id porque ya lo tenemos.
      const savedId = isEditing
        ? formData.id
        : await response.clone().json().then(d => d?.id).catch(() => null);
      const savedName = formData.nombrePaquete;
      const savedAction = isEditing ? 'updated' : 'created';
      // Notify parent. Parent refetches packages, shows the persistent banner,
      // and closes the form (which unmounts this component).
      await onSave?.({ savedId, savedName, savedAction });
    } catch (error) {
      onShowToast?.('Ocurrió un error al guardar.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="aur-sheet pkg-form" noValidate>
      {draftRestored && (
        <div className="pkg-draft-banner" role="status" aria-live="polite">
          <FiClock size={12} aria-hidden="true" />
          <span>Borrador restaurado · tienes cambios sin guardar.</span>
          <button
            type="button"
            className="pkg-draft-discard"
            onClick={() => setDraftRestored(false)}
          >
            Cerrar
          </button>
        </div>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Identidad</h3>
        </div>
        <div className="aur-list">
          <AuroraField
            label="Nombre"
            htmlFor="nombrePaquete"
            layout="row"
            required
            error={formErrors.nombrePaquete}
            counter={{ value: (formData.nombrePaquete || '').length, max: NOMBRE_MAX }}
            className={changes.fields.has('nombrePaquete') ? 'pkg-field--modified' : ''}
          >
            <TextInput
              name="nombrePaquete"
              value={formData.nombrePaquete}
              onChange={handleInputChange}
              onBlur={() => handleFieldBlur('nombrePaquete')}
              maxLength={NOMBRE_MAX}
              placeholder="Ej. Postforza Premium"
              required
            />
          </AuroraField>
          <AuroraField
            label="Descripción"
            htmlFor="descripcion"
            layout="row"
            error={formErrors.descripcion}
            className={changes.fields.has('descripcion') ? 'pkg-field--modified' : ''}
          >
            <Textarea
              name="descripcion"
              value={formData.descripcion}
              onChange={handleInputChange}
              onBlur={() => handleFieldBlur('descripcion')}
              placeholder="Resumen breve del propósito del paquete..."
              rows={3}
              maxLength={DESCRIPCION_MAX}
            />
          </AuroraField>
          {/* Técnico responsable: texto libre — puede ser ingeniero interno,
              dueño, o asesor externo. No FK a `users` porque no siempre tiene
              cuenta del sistema. El responsable de cada actividad sí es id. */}
          <AuroraField
            label="Técnico responsable"
            htmlFor="tecnicoResponsable"
            layout="row"
            error={formErrors.tecnicoResponsable}
            counter={{ value: (formData.tecnicoResponsable || '').length, max: TECNICO_MAX }}
            className={changes.fields.has('tecnicoResponsable') ? 'pkg-field--modified' : ''}
          >
            <TextInput
              name="tecnicoResponsable"
              value={formData.tecnicoResponsable || ''}
              onChange={handleInputChange}
              onBlur={() => handleFieldBlur('tecnicoResponsable')}
              maxLength={TECNICO_MAX}
              placeholder="Ej. Ing. Pérez (asesor agronómico)"
            />
          </AuroraField>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Clasificación</h3>
        </div>
        <div className="aur-list">
          <div className={`aur-row${changes.fields.has('tipoCosecha') ? ' pkg-field--modified' : ''}`}>
            <label className="aur-row-label" htmlFor="tipoCosecha">Tipo de cosecha</label>
            <select
              id="tipoCosecha"
              name="tipoCosecha"
              className={`aur-select${formErrors.tipoCosecha ? ' fld-error-input' : ''}`}
              value={formData.tipoCosecha}
              onChange={handleInputChange}
              onBlur={() => handleFieldBlur('tipoCosecha')}
              title={formErrors.tipoCosecha || undefined}
              required
            >
              <option value="">Seleccionar...</option>
              <option value="I Cosecha">I Cosecha</option>
              <option value="II Cosecha">II Cosecha</option>
              <option value="III Cosecha">III Cosecha</option>
              <option value="Semillero">Semillero</option>
            </select>
          </div>
          <div className={`aur-row${changes.fields.has('etapaCultivo') ? ' pkg-field--modified' : ''}`}>
            <label className="aur-row-label" htmlFor="etapaCultivo">Etapa del cultivo</label>
            <select
              id="etapaCultivo"
              name="etapaCultivo"
              className={`aur-select${formErrors.etapaCultivo ? ' fld-error-input' : ''}`}
              value={formData.etapaCultivo}
              onChange={handleInputChange}
              onBlur={() => handleFieldBlur('etapaCultivo')}
              title={formErrors.etapaCultivo || undefined}
              required
            >
              <option value="">Seleccionar...</option>
              <option value="Desarrollo">Desarrollo</option>
              <option value="Postforza">Postforza</option>
              <option value="N/A">N/A</option>
            </select>
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Programa de actividades</h3>
          <span className="aur-section-count">{formData.activities.length}</span>
          <span
            className="pkg-day-hint"
            title={'El "Día" se cuenta desde la fecha de creación del grupo o lote al que se aplique este paquete (Día 0). Ejemplo: si el grupo se crea el 5 de mayo y la actividad es "Día 15", se ejecutará el 20 de mayo.'}
            aria-label="Información sobre el campo Día"
          >
            <FiInfo size={13} />
          </span>
          {formData.activities.length > 1 && (
            <button
              type="button"
              className="pkg-toggle-all-btn"
              onClick={toggleAllActivities}
              title={allActivitiesExpanded ? 'Colapsar todas las actividades' : 'Expandir todas las actividades'}
            >
              {allActivitiesExpanded ? <FiChevronUp size={12} /> : <FiChevronDown size={12} />}
              <span>{allActivitiesExpanded ? 'Colapsar todas' : 'Expandir todas'}</span>
            </button>
          )}
        </div>
        <ul className="pkg-act-list">
          {formData.activities.map((activity, index) => (
            <ActivityCard
              key={`act-${index}`}
              activity={activity}
              index={index}
              expanded={expandedActivities.has(index)}
              modified={changes.activities.has(index)}
              pendingDelete={pendingDeleteIdx === index}
              costo={formActivityCosts[index] || { totals: [], hasMissingPrice: false, withoutPrice: 0 }}
              formErrors={formErrors}
              users={users}
              productos={productos}
              productosById={productosById}
              calibraciones={calibraciones}
              plantillas={plantillas}
              eligibleResponsables={eligibleResponsables}
              onActivityChange={(field, value) => handleActivityChange(index, field, value)}
              onActivityBlur={(field) => handleActivityBlur(index, field)}
              onRequestDelete={() => setPendingDeleteIdx(index)}
              onCancelDelete={() => setPendingDeleteIdx(null)}
              onConfirmDelete={() => removeActivity(index)}
              onDuplicate={() => duplicateActivity(index)}
              onToggleExpand={() => toggleActivityExpand(index)}
              onOpenTemplateModal={() => openTemplateModal(index)}
              onApplyPlantilla={(plantillaId) => aplicarPlantillaAActividad(index, plantillaId)}
              onAddProduct={(productoId) => {
                addProductToActivity(index, productoId);
                setTimeout(() => {
                  const el = document.querySelector(`[data-prod-qty="${index}-${productoId}"]`);
                  if (el) { el.focus(); el.select(); }
                }, 0);
              }}
              onRemoveProduct={(productoId) => removeProductFromActivity(index, productoId)}
              onProductCantidadChange={(productoId, value) => updateProductCantidad(index, productoId, value)}
              onProductCantidadBlur={(productoId, value) => handleProductCantidadBlur(index, productoId, value)}
            />
          ))}
        </ul>
        <button type="button" onClick={addActivity} className="pkg-add-activity">
          <FiPlus size={14} />
          Añadir actividad
        </button>
      </section>

      <footer className="pkg-form-actions">
        <button
          type="button"
          onClick={onCancel}
          className="aur-btn-text"
          disabled={isSubmitting}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="aur-btn-pill"
          disabled={isSubmitting}
          title="Guardar (Ctrl+S)"
        >
          {isSubmitting
            ? 'Guardando…'
            : isEditing ? 'Actualizar paquete' : 'Guardar paquete'}
        </button>
      </footer>

      {/* ── Modal compacto para crear plantilla desde una actividad ──────── */}
      {templateModal && createPortal(
        <div className="aur-modal-backdrop" onClick={() => !savingTemplate && setTemplateModal(null)}>
          <div
            className="aur-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pkg-template-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="aur-modal-header">
              <span className="aur-modal-icon"><FiBookmark size={16} /></span>
              <h3 className="aur-modal-title" id="pkg-template-modal-title">Nueva plantilla</h3>
              <button
                type="button"
                className="aur-icon-btn aur-modal-close"
                onClick={() => setTemplateModal(null)}
                aria-label="Cerrar"
                disabled={savingTemplate}
              >
                <FiX size={16} />
              </button>
            </div>
            <div className="aur-modal-content">
              <div className="pkg-template-fields">
                <label className="pkg-template-field">
                  <span>Nombre <span aria-hidden="true">*</span></span>
                  <input
                    className="aur-input"
                    value={templateModal.nombre}
                    placeholder="Ej. Aplicación inicial postforza"
                    maxLength={ACT_NAME_MAX}
                    onChange={e => setTemplateModal(prev => ({ ...prev, nombre: e.target.value }))}
                    autoFocus
                    disabled={savingTemplate}
                  />
                </label>
                <label className="pkg-template-field">
                  <span>Responsable</span>
                  {(() => {
                    const current = templateModal.responsableId;
                    const orphan = current
                      && !eligibleResponsables.some(u => u.id === current)
                      && users.find(u => u.id === current);
                    return (
                      <select
                        className="aur-select"
                        value={current || ''}
                        onChange={e => setTemplateModal(prev => ({ ...prev, responsableId: e.target.value }))}
                        disabled={savingTemplate}
                      >
                        <option value="">Sin asignar</option>
                        {eligibleResponsables.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        {orphan && (
                          <option value={orphan.id}>{orphan.nombre} (no disponible)</option>
                        )}
                        {eligibleResponsables.length === 0 && !orphan && (
                          <option value="" disabled>No hay empleados con acceso</option>
                        )}
                      </select>
                    );
                  })()}
                </label>
                {(() => {
                  const act = formData.activities[templateModal.activityIndex] || {};
                  const prods = act.productos || [];
                  if (prods.length === 0) {
                    return (
                      <p className="pkg-template-hint">
                        Para incluir productos en la plantilla, agrégalos primero a la actividad.
                      </p>
                    );
                  }
                  return (
                    <label className="pkg-template-checkbox">
                      <input
                        type="checkbox"
                        checked={templateModal.includeProductos}
                        onChange={e => setTemplateModal(prev => ({ ...prev, includeProductos: e.target.checked }))}
                        disabled={savingTemplate}
                      />
                      <span>
                        Incluir los {prods.length === 1 ? 'productos' : `${prods.length} productos`} de esta actividad
                      </span>
                    </label>
                  );
                })()}
              </div>
            </div>
            <div className="aur-modal-actions">
              <button
                type="button"
                className="aur-btn-text"
                onClick={() => setTemplateModal(null)}
                disabled={savingTemplate}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleSaveTemplate}
                disabled={!templateModal.nombre.trim() || savingTemplate}
              >
                {savingTemplate ? 'Creando…' : 'Crear plantilla'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </form>
  );
}
