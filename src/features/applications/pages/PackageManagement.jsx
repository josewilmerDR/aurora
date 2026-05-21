import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import '../styles/packages.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiChevronRight, FiChevronDown, FiArrowLeft, FiInfo } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import PageHeader from '../../../components/PageHeader';
import AuroraField, { TextInput, Textarea } from '../../../components/AuroraField';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ── Avatar del paquete (bubble del carrusel) ─────────────────────────────────
// Reemplaza el viejo slice(0,4) que colisionaba en nombres similares
// ("Postforza Premium" y "Postforza Estándar" ambos mostraban "POST"). Ahora
// las iniciales se sacan de las primeras 3 palabras; si el nombre es de una
// sola palabra, se toman los 2 primeros caracteres. Además, el fondo del
// avatar se selecciona desde una paleta de 8 colores compatibles con Aurora
// mediante un hash determinista del nombre — el mismo paquete siempre tendrá
// el mismo color, y nombres distintos casi nunca se ven igual.
function getPkgInitials(name) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

const PKG_AVATAR_PALETTE = [
  { bg: 'rgba(51, 255, 153, 0.14)', fg: '#33ff99' },   // aurora green
  { bg: 'rgba(204, 51, 255, 0.16)', fg: '#cc99ff' },   // magenta/lavender
  { bg: 'rgba(102, 178, 255, 0.16)', fg: '#66b2ff' },  // blue
  { bg: 'rgba(255, 184, 77, 0.16)', fg: '#ffb84d' },   // amber
  { bg: 'rgba(255, 102, 153, 0.16)', fg: '#ff6699' },  // pink
  { bg: 'rgba(102, 255, 204, 0.14)', fg: '#66ffcc' },  // teal
  { bg: 'rgba(204, 153, 255, 0.16)', fg: '#cc99ff' },  // lavender
  { bg: 'rgba(255, 204, 102, 0.16)', fg: '#ffcc66' },  // gold
];

function pickPkgAvatarStyle(name) {
  const key = name || '';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PKG_AVATAR_PALETTE[Math.abs(hash) % PKG_AVATAR_PALETTE.length];
}

// ── Product search combobox (sobre .aur-combo-*) ─────────────────────────────
function ProdCombobox({ productos, excludeIds, onSelect }) {
  const [text, setText]       = useState('');
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef               = useRef(null);
  const listRef               = useRef(null);

  const filtered = productos
    .filter(p => !excludeIds.includes(p.id))
    .filter(p => !text ||
      p.nombreComercial?.toLowerCase().includes(text.toLowerCase()) ||
      p.ingredienteActivo?.toLowerCase().includes(text.toLowerCase())
    );

  const openDropdown = useCallback(() => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  }, []);

  const selectOption = (producto) => {
    setText('');
    setOpen(false);
    setHi(0);
    onSelect(producto.id);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText('');
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="aur-combo pkg-prod-combo" ref={wrapRef}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          type="text"
          className="aur-combo-input"
          placeholder="+ Agregar producto..."
          value={text}
          autoComplete="off"
          onChange={e => { setText(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => {
            if (!listRef.current?.contains(document.activeElement)) setOpen(false);
          }, 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="aur-combo-name">{p.nombreComercial}</span>
              {p.ingredienteActivo && <span className="aur-combo-meta">{p.ingredienteActivo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function PackageManagement() {
  const apiFetch = useApiFetch();
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [calibraciones, setCalibraciones] = useState([]);
  const [formData, setFormData] = useState({
    id: null,
    nombrePaquete: '',
    descripcion: '',
    tipoCosecha: '',
    etapaCultivo: '',
    tecnicoResponsable: '',
    activities: []
  });
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const carouselRef = useRef(null);

  const [hubExpandedActivities, setHubExpandedActivities] = useState(new Set());
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [pendingDeletePkgId, setPendingDeletePkgId] = useState(null);
  const [pkgDepsModal, setPkgDepsModal] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState(null);

  const NOMBRE_MAX = 32;

  const clearError = (key) => {
    setFormErrors(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const markDirty = () => setIsDirty(true);

  const guardedNav = (action) => {
    if (isDirty) setPendingNavAction(() => action);
    else action();
  };

  // Centra la burbuja activa en el carousel cuando cambia el paquete seleccionado
  useEffect(() => {
    if (!isFormOpen || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.pkg-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedPkg?.id, formData.id, isFormOpen]);

  useEffect(() => {
    apiFetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error).finally(() => setLoading(false));
    apiFetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
    apiFetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
    apiFetch('/api/task-templates').then(res => res.json()).then(setPlantillas).catch(console.error);
    apiFetch('/api/calibraciones').then(res => res.json()).then(setCalibraciones).catch(console.error);
  }, []);

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
  // delta = +1 when inserting at index+1; delta = -1 when removing at index.
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
    // Shift expanded indices > index up by 1 so the expansion state
    // keeps pointing to the same activities after the splice.
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
    if (existing.length >= 24) {
      showToast('Máximo 24 productos por aplicación.', 'error');
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

  const handleEdit = (pkg) => {
    const normalizedActivities = (pkg.activities || [])
      .map(a => ({ type: 'notificacion', productos: [], ...a }))
      .sort((a, b) => Number(a.day) - Number(b.day));
    setFormData({ ...pkg, activities: normalizedActivities });
    setIsEditing(true);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setExpandedActivities(new Set(normalizedActivities.map((_, i) => i)));
    setFormErrors({});
    setIsDirty(false);
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', descripcion: '', tipoCosecha: '', etapaCultivo: '', tecnicoResponsable: '', activities: [] });
    setIsEditing(false);
    setIsFormOpen(false);
    setSelectedPkg(null);
    setExpandedActivities(new Set());
    setFormErrors({});
    setIsDirty(false);
    setIsSubmitting(false);
  };

  const handleNew = () => {
    setFormData({
      id: null,
      nombrePaquete: '',
      descripcion: '',
      tipoCosecha: '',
      etapaCultivo: '',
      tecnicoResponsable: '',
      activities: [{ day: '', name: '', responsableId: '', calibracionId: '', productos: [] }],
    });
    setIsEditing(false);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setExpandedActivities(new Set([0]));
    setFormErrors({});
    setIsDirty(false);
  };

  const handleSelectPkg = (pkg) => {
    setSelectedPkg(pkg);
    setIsEditing(false);
    setIsFormOpen(true);
    setExpandedActivities(new Set());
    setHubExpandedActivities(new Set());
    setFormErrors({});
    setIsDirty(false);
    window.scrollTo(0, 0);
  };

  const validateForm = () => {
    const errors = {};
    const expandIndices = new Set();

    const nombre = (formData.nombrePaquete || '').trim();
    if (!nombre) errors.nombrePaquete = 'El nombre es requerido.';
    else if (formData.nombrePaquete.length > NOMBRE_MAX) errors.nombrePaquete = `Máximo ${NOMBRE_MAX} caracteres.`;

    if ((formData.descripcion || '').length > 1024) errors.descripcion = 'Máximo 1024 caracteres.';
    if ((formData.tecnicoResponsable || '').length > 48) errors.tecnicoResponsable = 'Máximo 48 caracteres.';

    if (!formData.tipoCosecha) errors.tipoCosecha = 'Selecciona el tipo de cosecha.';
    if (!formData.etapaCultivo) errors.etapaCultivo = 'Selecciona la etapa.';

    formData.activities.forEach((a, i) => {
      const aName = (a.name || '').trim();
      if (!aName) {
        errors[`act-${i}-name`] = 'Nombre requerido.';
        expandIndices.add(i);
      } else if (a.name.length > 120) {
        errors[`act-${i}-name`] = 'Máximo 120 caracteres.';
        expandIndices.add(i);
      }

      const day = Number(a.day);
      if (a.day === '' || a.day === null || a.day === undefined || !Number.isInteger(day) || day < 0 || day > 1825) {
        errors[`act-${i}-day`] = 'Día entre 0 y 1825.';
        expandIndices.add(i);
      }

      const prods = a.productos || [];
      if (prods.length > 24) {
        errors[`act-${i}-prods`] = 'Máximo 24 productos por aplicación.';
        expandIndices.add(i);
      }
      prods.forEach(p => {
        const cant = Number(p.cantidadPorHa);
        if (!Number.isFinite(cant) || cant <= 0 || cant >= 1024) {
          errors[`act-${i}-prod-${p.productoId}-cant`] = 'Cantidad mayor a 0 y menor a 1024.';
          expandIndices.add(i);
        }
      });
    });

    return { errors, expandIndices };
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
      const count = Object.keys(errors).length;
      showToast(`Revisa ${count} ${count === 1 ? 'campo marcado' : 'campos marcados'} en rojo.`, 'error');
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
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();
      showToast(isEditing ? 'Paquete actualizado correctamente' : 'Paquete guardado correctamente');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDuplicate = async (pkg) => {
    const body = {
      nombrePaquete: `Copia de ${pkg.nombrePaquete}`,
      tipoCosecha: pkg.tipoCosecha,
      etapaCultivo: pkg.etapaCultivo,
      tecnicoResponsable: pkg.tecnicoResponsable || '',
      activities: pkg.activities || [],
    };
    try {
      const response = await apiFetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      showToast(`Paquete duplicado: "${body.nombrePaquete}"`);
    } catch {
      showToast('Error al duplicar el paquete.', 'error');
    }
  };

  const handleDeleteClick = async (pkg) => {
    try {
      const [lotesData, gruposData] = await Promise.all([
        apiFetch('/api/lotes').then(r => r.json()),
        apiFetch('/api/grupos').then(r => r.json()),
      ]);
      const depLotes = lotesData.filter(l => l.paqueteId === pkg.id);
      const depGrupos = gruposData.filter(g => g.paqueteId === pkg.id);
      if (depLotes.length > 0 || depGrupos.length > 0) {
        setPkgDepsModal({ name: pkg.nombrePaquete, lotes: depLotes, grupos: depGrupos });
      } else {
        setPendingDeletePkgId(pkg.id);
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await apiFetch(`/api/packages/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar el paquete');
      setPackages(packages.filter(p => p.id !== id));
      setPendingDeletePkgId(null);
      if (selectedPkg?.id === id) resetForm();
      showToast('Paquete eliminado correctamente');
    } catch (error) {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  return (
    <div className={`pkg-page-wrapper${isFormOpen ? ' pkg-page--selected' : ''}${packages.length > 0 ? ' pkg-page--has-packages' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {pendingDeletePkgId && (
        <AuroraConfirmModal
          danger
          title="¿Eliminar paquete?"
          body="Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => handleDelete(pendingDeletePkgId)}
          onCancel={() => setPendingDeletePkgId(null)}
        />
      )}

      {pendingNavAction && (
        <AuroraConfirmModal
          danger
          title="¿Descartar cambios?"
          body="Tienes cambios sin guardar. Si continúas, se perderán."
          confirmLabel="Descartar"
          cancelLabel="Seguir editando"
          onConfirm={() => {
            const action = pendingNavAction;
            setPendingNavAction(null);
            setIsDirty(false);
            action();
          }}
          onCancel={() => setPendingNavAction(null)}
        />
      )}

      {pkgDepsModal && (
        <AuroraConfirmModal
          size="wide"
          title="No es posible eliminar este paquete"
          body={
            <>
              El paquete <strong>"{pkgDepsModal.name}"</strong> está siendo usado por los siguientes registros.
              Por favor, resuelve estas dependencias antes de eliminarlo.
            </>
          }
          showCancel={false}
          confirmLabel="Entendido"
          onConfirm={() => setPkgDepsModal(null)}
          onCancel={() => setPkgDepsModal(null)}
        >
          <div className="pkg-deps-body">
            {pkgDepsModal.lotes.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Lotes</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.lotes.map(l => <li key={l.id}>{l.nombreLote}</li>)}
                </ul>
              </>
            )}
            {pkgDepsModal.grupos.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Grupos</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.grupos.map(g => <li key={g.id}>{g.nombreGrupo}</li>)}
                </ul>
              </>
            )}
          </div>
        </AuroraConfirmModal>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="pkg-page-loading" />}

      {!loading && !(isFormOpen && !selectedPkg) && (
        <PageHeader
          title="Paquetes de Aplicaciones"
          subtitle="Define aquí los conjuntos de aplicaciones que sueles realizar en tus cultivos por etapa. Una vez creado, puedes aplicar el mismo paquete a muchos grupos o lotes con un solo click."
          actions={
            <button className="aur-btn-pill" onClick={() => guardedNav(handleNew)}>
              <FiPlus size={14} /> Nuevo Paquete
            </button>
          }
        />
      )}
      {/* ── Mobile sticky carousel ── */}
      {!loading && isFormOpen && packages.length > 0 && (
        <div className="pkg-carousel" ref={carouselRef}>
          {packages.map(pkg => {
            const isActive = selectedPkg?.id === pkg.id || (isEditing && formData.id === pkg.id);
            // Cuando la burbuja está activa, dejamos que la regla CSS
            // .pkg-bubble--active .pkg-bubble-avatar pinte el verde Aurora.
            // Solo pintamos el color del hash cuando la burbuja NO está activa.
            const avatarStyle = isActive ? undefined : pickPkgAvatarStyle(pkg.nombrePaquete);
            return (
              <button
                key={pkg.id}
                className={`pkg-bubble${isActive ? ' pkg-bubble--active' : ''}`}
                onClick={() => guardedNav(() => {
                  if (selectedPkg?.id === pkg.id && !isEditing) resetForm();
                  else handleSelectPkg(pkg);
                })}
              >
                <span
                  className="pkg-bubble-avatar"
                  style={avatarStyle ? { background: avatarStyle.bg, color: avatarStyle.fg } : undefined}
                >
                  {getPkgInitials(pkg.nombrePaquete)}
                </span>
                <span className="pkg-bubble-label">{pkg.nombrePaquete}</span>
              </button>
            );
          })}
          <button
            className={`pkg-bubble pkg-bubble--add${isFormOpen && !selectedPkg && !isEditing ? ' pkg-bubble--active' : ''}`}
            onClick={() => guardedNav(handleNew)}
          >
            <span className="pkg-bubble-avatar pkg-bubble-avatar--add">+</span>
            <span className="pkg-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {!loading && <div className="lote-management-layout">
      {isFormOpen && !selectedPkg && (
        <form onSubmit={handleSubmit} className="aur-sheet pkg-form" noValidate>
          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h2 className="aur-sheet-title">{isEditing ? 'Editar paquete' : 'Nuevo paquete'}</h2>
              <p className="aur-sheet-subtitle">
                {isEditing
                  ? 'Modifica la información del paquete y su programa de actividades.'
                  : 'Define un conjunto de aplicaciones reutilizables para cada etapa de tus cultivos.'}
              </p>
            </div>
          </header>

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
              >
                <TextInput
                  name="nombrePaquete"
                  value={formData.nombrePaquete}
                  onChange={handleInputChange}
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
              >
                <Textarea
                  name="descripcion"
                  value={formData.descripcion}
                  onChange={handleInputChange}
                  placeholder="Resumen breve del propósito del paquete..."
                  rows={3}
                  maxLength={1024}
                />
              </AuroraField>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <h3>Clasificación</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="tipoCosecha">Tipo de cosecha</label>
                <select
                  id="tipoCosecha"
                  name="tipoCosecha"
                  className={`aur-select${formErrors.tipoCosecha ? ' fld-error-input' : ''}`}
                  value={formData.tipoCosecha}
                  onChange={handleInputChange}
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
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="etapaCultivo">Etapa del cultivo</label>
                <select
                  id="etapaCultivo"
                  name="etapaCultivo"
                  className={`aur-select${formErrors.etapaCultivo ? ' fld-error-input' : ''}`}
                  value={formData.etapaCultivo}
                  onChange={handleInputChange}
                  title={formErrors.etapaCultivo || undefined}
                  required
                >
                  <option value="">Seleccionar...</option>
                  <option value="Desarrollo">Desarrollo</option>
                  <option value="Postforza">Postforza</option>
                  <option value="N/A">N/A</option>
                </select>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="tecnicoResponsable">Técnico responsable</label>
                <select
                  id="tecnicoResponsable"
                  name="tecnicoResponsable"
                  className={`aur-select${formErrors.tecnicoResponsable ? ' fld-error-input' : ''}`}
                  value={formData.tecnicoResponsable || ''}
                  onChange={handleInputChange}
                  title={formErrors.tecnicoResponsable || undefined}
                >
                  <option value="">Sin asignar</option>
                  {users.map(u => (
                    <option key={u.id} value={u.nombre}>{u.nombre}</option>
                  ))}
                  {formData.tecnicoResponsable && !users.find(u => u.nombre === formData.tecnicoResponsable) && (
                    <option value={formData.tecnicoResponsable}>{formData.tecnicoResponsable}</option>
                  )}
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
            </div>
            <ul className="pkg-act-list">
              {formData.activities.map((activity, index) => {
                const expanded = expandedActivities.has(index);
                const totals = {};
                (activity.productos || []).forEach(p => {
                  const cat = productos.find(cp => cp.id === p.productoId);
                  const precio = parseFloat(cat?.precioUnitario) || 0;
                  if (precio <= 0) return;
                  const mon = cat?.moneda || 'USD';
                  const qty = parseFloat(p.cantidadPorHa) || 0;
                  totals[mon] = (totals[mon] || 0) + qty * precio;
                });
                const costEntries = Object.entries(totals);
                return (
                  <li key={`act-${index}`} className="pkg-act-card">
                    <div className="pkg-act-row">
                      <div className="pkg-act-day">
                        <input
                          type="number"
                          min={0}
                          max={1825}
                          step={1}
                          value={activity.day}
                          onChange={(e) => handleActivityChange(index, 'day', e.target.value)}
                          aria-label="Día"
                          placeholder="0"
                          className={formErrors[`act-${index}-day`] ? 'fld-error-input' : ''}
                          title={formErrors[`act-${index}-day`] || undefined}
                          required
                        />
                        <span className="pkg-act-day-suffix">día</span>
                      </div>

                      <div className="pkg-act-body">
                        <input
                          type="text"
                          className={`pkg-act-name${formErrors[`act-${index}-name`] ? ' fld-error-input' : ''}`}
                          value={activity.name}
                          onChange={(e) => handleActivityChange(index, 'name', e.target.value)}
                          placeholder="Nombre de la actividad"
                          required
                          maxLength={120}
                          aria-label="Nombre de la actividad"
                          title={formErrors[`act-${index}-name`] || undefined}
                        />
                        <div className="pkg-act-meta">
                          <select
                            className="aur-chip"
                            value={activity.responsableId}
                            onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}
                            aria-label="Responsable"
                          >
                            <option value="">Responsable</option>
                            {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                          </select>
                          <select
                            className="aur-chip"
                            value={activity.calibracionId || ''}
                            onChange={(e) => handleActivityChange(index, 'calibracionId', e.target.value)}
                            aria-label="Calibración"
                          >
                            <option value="">Calibración</option>
                            {calibraciones.map(cal => <option key={cal.id} value={cal.id}>{cal.nombre}</option>)}
                          </select>
                          {plantillas.length > 0 && (
                            <select
                              className="aur-chip aur-chip--ghost"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) aplicarPlantillaAActividad(index, e.target.value);
                              }}
                              aria-label="Cargar desde plantilla"
                            >
                              <option value="">+ Plantilla</option>
                              {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                            </select>
                          )}
                        </div>
                      </div>

                      <div
                        className={`pkg-act-cost${costEntries.length === 0 ? ' pkg-act-cost--empty' : ''}`}
                        title={costEntries.length === 0 ? undefined : 'Costo de la mezcla por hectárea'}
                      >
                        {costEntries.length === 0 ? '—' : costEntries.map(([mon, total]) => (
                          <div key={mon}>
                            {total.toFixed(2)}
                            <span className="pkg-act-cost-mon">{mon}/Ha</span>
                          </div>
                        ))}
                      </div>

                      <div className="pkg-act-actions">
                        {pendingDeleteIdx === index ? (
                          <div className="aur-inline-confirm">
                            <span className="aur-inline-confirm-text">¿Eliminar?</span>
                            <button type="button" className="aur-inline-confirm-yes" onClick={() => removeActivity(index)}>Sí</button>
                            <button type="button" className="aur-inline-confirm-no" onClick={() => setPendingDeleteIdx(null)}>No</button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="aur-icon-btn"
                              onClick={() => duplicateActivity(index)}
                              title="Duplicar actividad"
                            >
                              <FiCopy size={14} />
                            </button>
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--danger"
                              onClick={() => setPendingDeleteIdx(index)}
                              title="Eliminar actividad"
                            >
                              <FiX size={15} />
                            </button>
                            <button
                              type="button"
                              className={`aur-icon-btn pkg-act-expand${expanded ? ' is-open' : ''}`}
                              onClick={() => toggleActivityExpand(index)}
                              title={expanded ? 'Ocultar productos' : 'Productos de mezcla'}
                            >
                              <FiChevronDown size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="pkg-act-products">
                        <span className="pkg-act-products-label">Productos de mezcla</span>
                        <div className="pkg-act-products-list">
                          {(activity.productos || []).map(p => {
                            const catProd = productos.find(cp => cp.id === p.productoId);
                            const precioUnitario = parseFloat(catProd?.precioUnitario) || 0;
                            const moneda = catProd?.moneda || '';
                            const qty = parseFloat(p.cantidadPorHa) || 0;
                            const precioTotal = qty * precioUnitario;
                            return (
                              <div key={p.productoId} className="pkg-prod-row">
                                <span className="pkg-prod-row-name">{p.nombreComercial}</span>
                                <div className="pkg-prod-row-qty">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max="1023.99"
                                    value={p.cantidadPorHa}
                                    onChange={(e) => updateProductCantidad(index, p.productoId, e.target.value)}
                                    data-prod-qty={`${index}-${p.productoId}`}
                                    className={formErrors[`act-${index}-prod-${p.productoId}-cant`] ? 'fld-error-input' : ''}
                                    title={formErrors[`act-${index}-prod-${p.productoId}-cant`] || 'Cantidad por Ha'}
                                  />
                                  <span className="pkg-prod-row-unit">{p.unidad}/Ha</span>
                                </div>
                                {precioUnitario > 0 ? (
                                  <span className="pkg-prod-row-cost" title="Costo por hectárea">
                                    {precioTotal.toFixed(2)}
                                    <span className="pkg-prod-row-mon">{moneda}/Ha</span>
                                  </span>
                                ) : <span />}
                                <button
                                  type="button"
                                  className="pkg-prod-row-remove"
                                  onClick={() => removeProductFromActivity(index, p.productoId)}
                                  title="Quitar producto"
                                >
                                  <FiX size={12} />
                                </button>
                              </div>
                            );
                          })}
                          <ProdCombobox
                            productos={productos}
                            excludeIds={(activity.productos || []).map(p => p.productoId)}
                            onSelect={(productoId) => {
                              addProductToActivity(index, productoId);
                              setTimeout(() => {
                                const el = document.querySelector(`[data-prod-qty="${index}-${productoId}"]`);
                                if (el) { el.focus(); el.select(); }
                              }, 0);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={addActivity} className="pkg-add-activity">
              <FiPlus size={14} />
              Añadir actividad
            </button>
          </section>

          <footer className="pkg-form-actions">
            <button
              type="button"
              onClick={() => guardedNav(resetForm)}
              className="aur-btn-text"
              disabled={isSubmitting}
            >
              Cancelar
            </button>
            <button type="submit" className="aur-btn-pill" disabled={isSubmitting}>
              {isSubmitting
                ? 'Guardando…'
                : isEditing ? 'Actualizar paquete' : 'Guardar paquete'}
            </button>
          </footer>
        </form>
      )}

      {isFormOpen && selectedPkg && (
        <div className="lote-hub">
          <button className="lote-hub-back" onClick={resetForm}>
            <FiArrowLeft size={13} /> Todos los paquetes
          </button>
          <div className="hub-header">
            <div className="hub-title-block">
              <h2 className="hub-lote-code">{selectedPkg.nombrePaquete}</h2>
              {(() => {
                const totals = {};
                (selectedPkg.activities || []).forEach(act => {
                  (act.productos || []).forEach(p => {
                    const cat = productos.find(cp => cp.id === p.productoId);
                    const precio = parseFloat(cat?.precioUnitario) || 0;
                    if (precio <= 0) return;
                    const mon = cat?.moneda || 'USD';
                    totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                  });
                });
                const entries = Object.entries(totals);
                if (entries.length === 0) return null;
                return (
                  <span className="pkg-hub-total-cost" title="Costo total del paquete por hectárea">
                    {entries.map(([mon, total]) => (
                      <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-total-cost-mon">{mon}/Ha</span></span>
                    ))}
                  </span>
                );
              })()}
            </div>
            <div className="hub-header-actions">
              <button onClick={() => handleEdit(selectedPkg)} className="icon-btn" title="Editar paquete">
                <FiEdit size={16} />
              </button>
              <button onClick={() => handleDuplicate(selectedPkg)} className="icon-btn" title="Duplicar paquete">
                <FiCopy size={16} />
              </button>
              <button onClick={() => handleDeleteClick(selectedPkg)} className="icon-btn delete" title="Eliminar paquete">
                <FiTrash2 size={16} />
              </button>
            </div>
          </div>

          <div className="hub-info-pills">
            {selectedPkg.tipoCosecha && <span className="hub-pill">{selectedPkg.tipoCosecha}</span>}
            {selectedPkg.etapaCultivo && selectedPkg.etapaCultivo !== 'N/A' && (
              <span className="hub-pill">{selectedPkg.etapaCultivo}</span>
            )}
            {selectedPkg.tecnicoResponsable && (
              <span className="hub-pill">{selectedPkg.tecnicoResponsable}</span>
            )}
          </div>

          {selectedPkg.descripcion && (
            <p className="pkg-hub-desc">{selectedPkg.descripcion}</p>
          )}

          <div className="pkg-hub-section-label">
            Actividades <span className="pkg-hub-count">{selectedPkg.activities?.length || 0}</span>
          </div>
          {(!selectedPkg.activities || selectedPkg.activities.length === 0) ? (
            <p className="empty-state">Sin actividades programadas.</p>
          ) : (
            <ul className="pkg-hub-activities">
              {[...selectedPkg.activities]
                .sort((a, b) => Number(a.day) - Number(b.day))
                .map((act, i) => {
                  const resp = users.find(u => u.id === act.responsableId);
                  const cal = calibraciones.find(c => c.id === act.calibracionId);
                  const hasDetails = (act.productos?.length > 0) || !!cal;
                  const expanded = hubExpandedActivities.has(i);
                  const actCostos = (() => {
                    const totals = {};
                    (act.productos || []).forEach(p => {
                      const cat = productos.find(cp => cp.id === p.productoId);
                      const precio = parseFloat(cat?.precioUnitario) || 0;
                      if (precio <= 0) return;
                      const mon = cat?.moneda || 'USD';
                      totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                    });
                    return Object.entries(totals);
                  })();
                  return (
                    <li key={i} className="pkg-hub-activity-item">
                      <span className="pkg-hub-activity-day">Día {act.day}</span>
                      <div className="pkg-hub-activity-info">
                        <span className="pkg-hub-activity-name">{act.name}</span>
                        {resp && <span className="pkg-hub-activity-resp">{resp.nombre}</span>}
                        {actCostos.length > 0 && (
                          <span className="pkg-hub-activity-cost" title="Costo de la mezcla por hectárea">
                            {actCostos.map(([mon, total]) => (
                              <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-activity-cost-mon">{mon}/Ha</span></span>
                            ))}
                          </span>
                        )}
                        {expanded && (
                          <div className="pkg-hub-activity-detail">
                            {cal && (
                              <span className="pkg-hub-detail-cal">Cal: {cal.nombre}</span>
                            )}
                            {act.productos?.map(p => {
                              const cat = productos.find(cp => cp.id === p.productoId);
                              const precioUnitario = parseFloat(cat?.precioUnitario) || 0;
                              const moneda = cat?.moneda || '';
                              const precioTotal = (p.cantidadPorHa || 0) * precioUnitario;
                              return (
                                <span key={p.productoId} className="pkg-hub-detail-prod">
                                  <span className="pkg-hub-detail-prod-name">{p.nombreComercial}</span>
                                  <span className="pkg-hub-detail-prod-dose">{p.cantidadPorHa} {p.unidad}/Ha</span>
                                  {precioUnitario > 0 && (
                                    <>
                                      <span className="pkg-hub-detail-prod-price">P.U.: {precioUnitario.toFixed(2)} {moneda}</span>
                                      <span className="pkg-hub-detail-prod-total">Total/Ha: {precioTotal.toFixed(2)} {moneda}</span>
                                    </>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {hasDetails && (
                        <button
                          className={`icon-btn pkg-action-btn${expanded ? ' expanded' : ''}`}
                          title={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                          onClick={() => setHubExpandedActivities(prev => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })}
                        >
                          <FiEye size={14} />
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}

      {(packages.length > 0 || !isFormOpen) && (
        <div className="lote-list-panel">
          {packages.length === 0 ? (
            <p className="empty-state">
              No hay paquetes de aplicaciones creados. Crea el primero dando click en "Nuevo Paquete".
            </p>
          ) : (
          <ul className="lote-list">
            {packages.map(pkg => (
              <li
                key={pkg.id}
                className={`lote-list-item${(selectedPkg?.id === pkg.id || (isEditing && formData.id === pkg.id)) ? ' active' : ''}`}
                onClick={() => guardedNav(() => {
                  if (selectedPkg?.id === pkg.id && !isEditing) { resetForm(); return; }
                  handleSelectPkg(pkg);
                })}
              >
                <div className="lote-list-info">
                  <span className="lote-list-code">{pkg.nombrePaquete}</span>
                  <span className="lote-list-name">
                    {[
                      pkg.tipoCosecha,
                      pkg.etapaCultivo && pkg.etapaCultivo !== 'N/A' ? pkg.etapaCultivo : null,
                      `${pkg.activities.length} act.`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  {(() => {
                    const totals = {};
                    (pkg.activities || []).forEach(act => {
                      (act.productos || []).forEach(p => {
                        const cat = productos.find(cp => cp.id === p.productoId);
                        const precio = parseFloat(cat?.precioUnitario) || 0;
                        if (precio <= 0) return;
                        const mon = cat?.moneda || 'USD';
                        totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                      });
                    });
                    const entries = Object.entries(totals);
                    if (entries.length === 0) return null;
                    return (
                      <span className="pkg-list-total-cost" title="Costo total del paquete por hectárea">
                        {entries.map(([mon, total]) => `${total.toFixed(2)} ${mon}/Ha`).join(' + ')}
                      </span>
                    );
                  })()}
                </div>
                <FiChevronRight size={14} className="lote-list-arrow" />
              </li>
            ))}
          </ul>
          )}
        </div>
      )}
      </div>}
    </div>
  );
}

export default PackageManagement;
