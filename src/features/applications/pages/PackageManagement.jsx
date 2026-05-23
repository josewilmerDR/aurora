import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '../styles/packages.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiChevronRight, FiChevronDown, FiChevronUp, FiArrowLeft, FiInfo, FiFilter } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import PageHeader from '../../../components/PageHeader';
import AuroraField, { TextInput, Textarea } from '../../../components/AuroraField';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import FilterButton from '../../../components/ui/FilterButton';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';

// ── Draft persistence ────────────────────────────────────────────────────────
// Un solo slot global que captura el form completo (incluye `id`) sirve tanto
// para crear como para editar: como solo hay un form abierto a la vez, no se
// pueden editar dos paquetes en paralelo. En la restauración usamos `id` para
// recuperar el modo (con id → editar; sin id → crear). Mismo patrón que
// MaquinariaList y Calibraciones.
const PKG_DRAFT_LS_KEY = 'aurora_draft_paquete';
const PKG_DRAFT_SS_KEY = 'aurora_draftActive_paquete';

function loadPackageDraft() {
  try { return JSON.parse(localStorage.getItem(PKG_DRAFT_LS_KEY)); } catch { return null; }
}
function savePackageDraft(data) {
  try {
    localStorage.setItem(PKG_DRAFT_LS_KEY, JSON.stringify(data));
    sessionStorage.setItem(PKG_DRAFT_SS_KEY, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function clearPackageDraft() {
  try {
    localStorage.removeItem(PKG_DRAFT_LS_KEY);
    sessionStorage.removeItem(PKG_DRAFT_SS_KEY);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function isPackageDraftMeaningful(d) {
  if (!d) return false;
  if ((d.nombrePaquete || '').trim()) return true;
  if ((d.descripcion || '').trim()) return true;
  if (d.tipoCosecha) return true;
  if (d.etapaCultivo) return true;
  if (d.tecnicoResponsable) return true;
  return (d.activities || []).some(a =>
    (a?.name || '').trim() ||
    (a?.day !== '' && a?.day != null) ||
    a?.responsableId ||
    a?.calibracionId ||
    (a?.productos || []).length > 0
  );
}

// ── Mensaje específico de validación del form ────────────────────────────────
// Convierte el objeto `formErrors` en un toast accionable: si hay un solo
// error, lo nombra; si hay varios, separa cuántos son de campos top-level
// vs cuántas actividades quedaron incompletas.
const PKG_FIELD_LABELS = {
  nombrePaquete: 'el nombre del paquete',
  descripcion: 'la descripción',
  tipoCosecha: 'el tipo de cosecha',
  etapaCultivo: 'la etapa del cultivo',
  tecnicoResponsable: 'el técnico responsable',
};

function buildValidationToast(errors) {
  const keys = Object.keys(errors);
  if (keys.length === 0) return '';

  if (keys.length === 1) {
    const key = keys[0];
    if (PKG_FIELD_LABELS[key]) return `Revisa ${PKG_FIELD_LABELS[key]}.`;
    const m = key.match(/^act-(\d+)-(.+)$/);
    if (m) {
      const idx = Number(m[1]) + 1;
      const sub = m[2];
      if (sub === 'name') return `Falta el nombre de la actividad ${idx}.`;
      if (sub === 'day') return `Revisa el día de la actividad ${idx}.`;
      if (sub === 'prods') return `Demasiados productos en la actividad ${idx}.`;
      if (sub.startsWith('prod-')) return `Revisa la cantidad de un producto en la actividad ${idx}.`;
    }
    return 'Hay un campo con error.';
  }

  const topLevel = keys.filter(k => k in PKG_FIELD_LABELS).length;
  const actIndices = new Set();
  keys.forEach(k => {
    const m = k.match(/^act-(\d+)-/);
    if (m) actIndices.add(m[1]);
  });
  const acts = actIndices.size;

  if (topLevel > 0 && acts > 0) {
    const a = topLevel === 1 ? '1 campo del paquete' : `${topLevel} campos del paquete`;
    const b = acts === 1 ? '1 actividad incompleta' : `${acts} actividades incompletas`;
    return `Revisa ${a} y ${b}.`;
  }
  if (topLevel > 0) {
    return topLevel === 1
      ? 'Revisa 1 campo del paquete marcado en rojo.'
      : `Revisa ${topLevel} campos del paquete marcados en rojo.`;
  }
  return acts === 1
    ? '1 actividad está incompleta.'
    : `${acts} actividades están incompletas.`;
}

// ── Cálculo de costo de mezcla por hectárea ──────────────────────────────────
// Acepta una lista plana de productos usados ({productoId, cantidadPorHa}) y el
// catálogo. Retorna totales por moneda + flags para alertar al usuario cuando
// hay productos sin precio (que quedarían fuera del costo). Esto evita que el
// usuario crea que un paquete cuesta menos de lo real solo porque su catálogo
// está incompleto.
function calcularCosto(productosUsados, productosCatalogo) {
  const totals = {};
  let withoutPrice = 0;
  const total = (productosUsados || []).length;
  (productosUsados || []).forEach(p => {
    const cat = productosCatalogo.find(cp => cp.id === p.productoId);
    const precio = parseFloat(cat?.precioUnitario) || 0;
    if (precio <= 0) {
      withoutPrice += 1;
      return;
    }
    const mon = cat?.moneda || 'USD';
    const qty = parseFloat(p.cantidadPorHa) || 0;
    totals[mon] = (totals[mon] || 0) + qty * precio;
  });
  return {
    totals: Object.entries(totals),
    total,
    withoutPrice,
    hasMissingPrice: withoutPrice > 0,
    allMissingPrice: total > 0 && withoutPrice === total,
  };
}

function flattenActivityProducts(activities) {
  return (activities || []).flatMap(a => a.productos || []);
}

// Texto del tooltip de advertencia cuando hay productos sin precio en catálogo.
function missingPriceTooltip(n) {
  return n === 1
    ? '1 producto sin precio en el catálogo no está incluido en este total.'
    : `${n} productos sin precio en el catálogo no están incluidos en este total.`;
}

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
  const [pendingDeletePkg, setPendingDeletePkg] = useState(null);
  const [pkgDepsModal, setPkgDepsModal] = useState(null);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState(null);

  // Búsqueda y filtros sobre la lista/carrusel de paquetes. No se persisten
  // entre sesiones — cada visita arranca con todos los paquetes visibles.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipoCosecha, setFilterTipoCosecha] = useState('');
  const [filterEtapaCultivo, setFilterEtapaCultivo] = useState('');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const hasActiveCategoryFilter = !!(filterTipoCosecha || filterEtapaCultivo);
  const hasAnyFilter = hasActiveCategoryFilter || !!searchQuery.trim();

  const filteredPackages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !filterTipoCosecha && !filterEtapaCultivo) return packages;
    return packages.filter(pkg => {
      if (q && !(pkg.nombrePaquete || '').toLowerCase().includes(q)) return false;
      if (filterTipoCosecha && pkg.tipoCosecha !== filterTipoCosecha) return false;
      if (filterEtapaCultivo && pkg.etapaCultivo !== filterEtapaCultivo) return false;
      return true;
    });
  }, [packages, searchQuery, filterTipoCosecha, filterEtapaCultivo]);

  const clearCategoryFilters = () => {
    setFilterTipoCosecha('');
    setFilterEtapaCultivo('');
  };
  const clearAllFilters = () => {
    setSearchQuery('');
    clearCategoryFilters();
  };

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
    // Carga inicial de catálogos. Antes era `.catch(console.error)` silencioso
    // — si /api/productos fallaba, el combobox de productos quedaba vacío sin
    // explicación y el usuario asumía "no hay productos en catálogo". Ahora:
    //
    // 1. Cada fetch fallido se reporta con su body+label para que
    //    translateApiError pueda dar el mensaje específico (UNAUTHORIZED,
    //    INSUFFICIENT_ROLE, etc.) cuando hay solo una falla.
    // 2. Promise.allSettled coalesce todas las fallas en UN solo toast —
    //    con 5 endpoints, replicar Siembra verbatim daría hasta 5 toasts
    //    apilados, pero como el componente Toast solo muestra el último, el
    //    usuario perdería contexto sobre qué exactamente falló.
    // 3. El spinner se cierra apenas resuelven los paquetes (recurso
    //    crítico), aunque los catálogos secundarios sigan cargando en
    //    background — no bloqueamos el render por plantillas o calibraciones.
    const fetchSafe = (url, label) =>
      apiFetch(url).then(async r => {
        if (!r.ok) throw { body: await r.json().catch(() => ({})), label };
        return r.json();
      });

    const pkgsP  = fetchSafe('/api/packages',       'los paquetes');
    const usrsP  = fetchSafe('/api/users',          'los usuarios');
    const prodsP = fetchSafe('/api/productos',      'los productos');
    const tplsP  = fetchSafe('/api/task-templates', 'las plantillas');
    const calsP  = fetchSafe('/api/calibraciones',  'las calibraciones');

    // Aplicar resultados a medida que llegan. El .catch(() => {}) en cada
    // side-chain evita unhandled rejection — el reporte sale del allSettled.
    pkgsP.then(d => setPackages(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
    usrsP.then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});
    prodsP.then(d => setProductos(Array.isArray(d) ? d : [])).catch(() => {});
    tplsP.then(d => setPlantillas(Array.isArray(d) ? d : [])).catch(() => {});
    calsP.then(d => setCalibraciones(Array.isArray(d) ? d : [])).catch(() => {});

    Promise.allSettled([pkgsP, usrsP, prodsP, tplsP, calsP]).then(results => {
      const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
      if (failed.length === 0) return;
      if (failed.length === 1) {
        const { body, label } = failed[0] || {};
        showToast(translateApiError(body, `No se pudieron cargar ${label}.`), 'error');
        return;
      }
      const labels = failed.map(f => f?.label).filter(Boolean).join(', ');
      showToast(`No se pudieron cargar: ${labels}. Revisa tu conexión y recarga.`, 'error');
    });
  }, []);

  // Restaurar borrador al montar: si hay datos persistidos de una sesión
  // anterior, abrir el form con esos datos. El draft.id distingue el modo —
  // con id se reabre como edición del paquete; sin id, como nuevo paquete.
  useEffect(() => {
    const draft = loadPackageDraft();
    if (!isPackageDraftMeaningful(draft)) {
      clearPackageDraft();
      return;
    }
    const activities = Array.isArray(draft.activities) ? draft.activities : [];
    setFormData({
      id: draft.id || null,
      nombrePaquete: draft.nombrePaquete || '',
      descripcion: draft.descripcion || '',
      tipoCosecha: draft.tipoCosecha || '',
      etapaCultivo: draft.etapaCultivo || '',
      tecnicoResponsable: draft.tecnicoResponsable || '',
      activities,
    });
    setIsEditing(!!draft.id);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setExpandedActivities(new Set(activities.map((_, i) => i)));
    setIsDirty(false);
    try {
      sessionStorage.setItem(PKG_DRAFT_SS_KEY, '1');
      window.dispatchEvent(new CustomEvent('aurora-draft-change'));
    } catch {}
  }, []);

  // Autoguardado del borrador en cada cambio del form (crear o editar).
  // Se omite solo la vista hub (selectedPkg !== null), que no tiene form, y
  // cuando el form está cerrado. Persiste `id` para que la restauración pueda
  // reabrir en el mismo modo en el que estaba el usuario.
  useEffect(() => {
    if (!isFormOpen || selectedPkg) return;
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
  }, [formData, isFormOpen, selectedPkg]);

  // Atajo Ctrl/Cmd + S → enviar el form mientras se edita/crea un paquete.
  // Solo se activa cuando el form está abierto en modo crear/editar
  // (no en la vista de hub, donde no hay form).
  useEffect(() => {
    if (!isFormOpen || selectedPkg) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        document.querySelector('.pkg-form')?.requestSubmit?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isFormOpen, selectedPkg]);

  // Estado derivado: ¿todas las actividades están expandidas?
  const allActivitiesExpanded = formData.activities.length > 0
    && formData.activities.every((_, i) => expandedActivities.has(i));

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
    clearPackageDraft();
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
      showToast(buildValidationToast(errors), 'error');
      // Scroll al primer error tras el siguiente repaint (espera a que las
      // actividades en error se expandan y reciban el className de error).
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
      const created = await response.json();
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      // Abrir el form sobre la copia con el nombre seleccionado para renombrar
      // inmediatamente — evita acumular "Copia de Copia de X" sin notar.
      const newPkg = updatedPackages.find(p => p.id === created?.id);
      if (newPkg) {
        handleEdit(newPkg);
        requestAnimationFrame(() => {
          const input = document.querySelector('.pkg-form input[name="nombrePaquete"]');
          if (input) {
            input.focus();
            input.select();
          }
        });
      } else {
        showToast(`Paquete duplicado: "${body.nombrePaquete}"`);
      }
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
        setPendingDeletePkg({
          id: pkg.id,
          nombrePaquete: pkg.nombrePaquete,
          actCount: (pkg.activities || []).length,
        });
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
      setPendingDeletePkg(null);
      if (selectedPkg?.id === id) resetForm();
      showToast('Paquete eliminado correctamente');
    } catch (error) {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  return (
    <div className={`pkg-page-wrapper${isFormOpen ? ' pkg-page--selected' : ''}${packages.length > 0 ? ' pkg-page--has-packages' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {pendingDeletePkg && (
        <AuroraConfirmModal
          danger
          title="¿Eliminar paquete?"
          body={
            <>
              Vas a eliminar <strong>"{pendingDeletePkg.nombrePaquete}"</strong>
              {pendingDeletePkg.actCount > 0 && (
                <> y sus {pendingDeletePkg.actCount === 1
                  ? '1 actividad'
                  : `${pendingDeletePkg.actCount} actividades`}</>
              )}
              . Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar"
          onConfirm={() => handleDelete(pendingDeletePkg.id)}
          onCancel={() => setPendingDeletePkg(null)}
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
            // Descartar es intención explícita: tirar el borrador. Necesario
            // sobre todo cuando `action` es handleSelectPkg → cierra el form
            // hacia la vista hub, donde el effect de autoguardado no corre.
            clearPackageDraft();
            action();
          }}
          onCancel={() => setPendingNavAction(null)}
        />
      )}

      {mostrarFiltros && createPortal(
        <div className="aur-modal-backdrop" onClick={() => setMostrarFiltros(false)}>
          <div
            className="aur-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pkg-filtro-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="aur-modal-header">
              <span className="aur-modal-icon"><FiFilter size={16} /></span>
              <h3 className="aur-modal-title" id="pkg-filtro-modal-title">Filtrar paquetes</h3>
              <button
                type="button"
                className="aur-icon-btn aur-modal-close"
                onClick={() => setMostrarFiltros(false)}
                aria-label="Cerrar"
              >
                <FiX size={16} />
              </button>
            </div>
            <div className="aur-modal-content">
              <div className="pkg-filtro-grid">
                <div className="pkg-filtro-field">
                  <label htmlFor="pkg-filtro-tipo">Tipo de cosecha</label>
                  <select
                    id="pkg-filtro-tipo"
                    className="aur-select"
                    value={filterTipoCosecha}
                    onChange={e => setFilterTipoCosecha(e.target.value)}
                  >
                    <option value="">Todas</option>
                    <option value="I Cosecha">I Cosecha</option>
                    <option value="II Cosecha">II Cosecha</option>
                    <option value="III Cosecha">III Cosecha</option>
                    <option value="Semillero">Semillero</option>
                  </select>
                </div>
                <div className="pkg-filtro-field">
                  <label htmlFor="pkg-filtro-etapa">Etapa del cultivo</label>
                  <select
                    id="pkg-filtro-etapa"
                    className="aur-select"
                    value={filterEtapaCultivo}
                    onChange={e => setFilterEtapaCultivo(e.target.value)}
                  >
                    <option value="">Todas</option>
                    <option value="Desarrollo">Desarrollo</option>
                    <option value="Postforza">Postforza</option>
                    <option value="N/A">N/A</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="aur-modal-actions">
              {hasActiveCategoryFilter && (
                <button
                  type="button"
                  className="aur-chip aur-chip--ghost"
                  onClick={clearCategoryFilters}
                >
                  <FiX size={12} /> Limpiar
                </button>
              )}
              <button
                type="button"
                className="aur-btn-pill"
                onClick={() => setMostrarFiltros(false)}
              >
                Listo
              </button>
            </div>
          </div>
        </div>,
        document.body
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

      {!loading && (
        <PageHeader
          title={
            isFormOpen && !selectedPkg
              ? (isEditing ? 'Editar paquete' : 'Nuevo paquete')
              : 'Paquetes de aplicaciones'
          }
          subtitle={
            isFormOpen && !selectedPkg
              ? (isEditing
                  ? 'Modifica la información del paquete y su programa de actividades.'
                  : 'Define un conjunto de aplicaciones reutilizables para cada etapa de tus cultivos.')
              : (packages.length === 0
                  ? 'Define aquí los conjuntos de aplicaciones que sueles realizar en tus cultivos por etapa. Una vez creado, puedes aplicar el mismo paquete a muchos grupos o lotes con un solo click.'
                  : (
                      <>
                        Conjuntos de aplicaciones reutilizables por etapa.{' '}
                        <span
                          className="pkg-subtitle-tip"
                          title="Una vez creado, puedes aplicar el mismo paquete a muchos grupos o lotes con un solo click."
                          aria-label="Más información sobre paquetes"
                        >
                          <FiInfo size={12} />
                        </span>
                      </>
                    ))
          }
          actions={
            // - FilterButton: visible siempre que haya paquetes (la lista del
            //   panel es visible en casi todos los estados; en form/hub también
            //   ayuda a navegar paquetes hermanos).
            // - "Nuevo Paquete": visible en estado inicial y en hub view; lo
            //   ocultamos cuando el form de crear/editar está abierto — ahí
            //   sería confuso ofrecer "crear otro" mientras hay uno a medias.
            <>
              {packages.length > 0 && (
                <FilterButton
                  active={hasActiveCategoryFilter}
                  onClick={() => setMostrarFiltros(true)}
                />
              )}
              {(!isFormOpen || selectedPkg) && (
                <button className="aur-btn-pill" onClick={() => guardedNav(handleNew)}>
                  <FiPlus size={14} /> Nuevo Paquete
                </button>
              )}
            </>
          }
        />
      )}
      {/* ── Mobile sticky carousel ── */}
      {!loading && packages.length > 0 && (
        <div className="pkg-carousel" ref={carouselRef}>
          {filteredPackages.map(pkg => {
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
              {formData.activities.map((activity, index) => {
                const expanded = expandedActivities.has(index);
                const costo = calcularCosto(activity.productos, productos);
                const costEntries = costo.totals;
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
                        title={
                          costo.total === 0
                            ? 'Sin productos asignados'
                            : costo.allMissingPrice
                              ? 'Todos los productos están sin precio en el catálogo'
                              : costo.hasMissingPrice
                                ? `Costo de la mezcla por hectárea. ${missingPriceTooltip(costo.withoutPrice)}`
                                : 'Costo de la mezcla por hectárea'
                        }
                      >
                        {costEntries.length === 0 ? (
                          <span aria-label={costo.allMissingPrice ? 'Sin precio' : 'Sin productos'}>
                            {costo.allMissingPrice ? 'Sin precio' : '—'}
                          </span>
                        ) : (
                          <>
                            {costEntries.map(([mon, total]) => (
                              <div key={mon}>
                                {total.toFixed(2)}
                                <span className="pkg-act-cost-mon">{mon}/Ha</span>
                              </div>
                            ))}
                            {costo.hasMissingPrice && (
                              <span className="pkg-cost-warn" aria-label="Algunos productos sin precio">*</span>
                            )}
                          </>
                        )}
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
                const costo = calcularCosto(flattenActivityProducts(selectedPkg.activities), productos);
                if (costo.totals.length === 0) return null;
                return (
                  <span
                    className="pkg-hub-total-cost"
                    title={
                      costo.hasMissingPrice
                        ? `Costo total del paquete por hectárea. ${missingPriceTooltip(costo.withoutPrice)}`
                        : 'Costo total del paquete por hectárea'
                    }
                  >
                    {costo.totals.map(([mon, total]) => (
                      <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-total-cost-mon">{mon}/Ha</span></span>
                    ))}
                    {costo.hasMissingPrice && (
                      <span className="pkg-cost-warn" aria-label="Algunos productos sin precio">*</span>
                    )}
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
                  const actCostoInfo = calcularCosto(act.productos, productos);
                  return (
                    <li key={i} className="pkg-hub-activity-item">
                      <span className="pkg-hub-activity-day">Día {act.day}</span>
                      <div className="pkg-hub-activity-info">
                        <span className="pkg-hub-activity-name">{act.name}</span>
                        {resp && <span className="pkg-hub-activity-resp">{resp.nombre}</span>}
                        {actCostoInfo.totals.length > 0 && (
                          <span
                            className="pkg-hub-activity-cost"
                            title={
                              actCostoInfo.hasMissingPrice
                                ? `Costo de la mezcla por hectárea. ${missingPriceTooltip(actCostoInfo.withoutPrice)}`
                                : 'Costo de la mezcla por hectárea'
                            }
                          >
                            {actCostoInfo.totals.map(([mon, total]) => (
                              <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-activity-cost-mon">{mon}/Ha</span></span>
                            ))}
                            {actCostoInfo.hasMissingPrice && (
                              <span className="pkg-cost-warn" aria-label="Algunos productos sin precio">*</span>
                            )}
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
          {packages.length > 0 && (
            <div className="pkg-list-search">
              <FiSearch size={13} aria-hidden="true" />
              <input
                type="search"
                className="pkg-list-search-input"
                placeholder="Buscar paquete por nombre…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Buscar paquete por nombre"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pkg-list-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpiar búsqueda"
                >
                  <FiX size={12} />
                </button>
              )}
            </div>
          )}
          {packages.length === 0 ? (
            <p className="empty-state">
              Aún no hay registros que mostrar. Crea el primero en "Nuevo Paquete".
            </p>
          ) : filteredPackages.length === 0 ? (
            <p className="empty-state">
              Sin resultados para los filtros aplicados.{' '}
              <button type="button" className="aur-btn-text pkg-list-clear-link" onClick={clearAllFilters}>
                Limpiar filtros
              </button>
            </p>
          ) : (
          <ul className="lote-list">
            {filteredPackages.map(pkg => (
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
                  <div className="pkg-list-meta-line">
                    <span className="lote-list-name">
                      {[
                        pkg.tipoCosecha,
                        pkg.etapaCultivo && pkg.etapaCultivo !== 'N/A' ? pkg.etapaCultivo : null,
                        `${pkg.activities.length} act.`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                    {(() => {
                      const costo = calcularCosto(flattenActivityProducts(pkg.activities), productos);
                      if (costo.totals.length === 0) return null;
                      const label = costo.totals.map(([mon, total]) => `${total.toFixed(2)} ${mon}/Ha`).join(' + ');
                      return (
                        <span
                          className="pkg-list-total-cost"
                          title={
                            costo.hasMissingPrice
                              ? `Costo total del paquete por hectárea. ${missingPriceTooltip(costo.withoutPrice)}`
                              : 'Costo total del paquete por hectárea'
                          }
                        >
                          {label}
                          {costo.hasMissingPrice && (
                            <span className="pkg-cost-warn" aria-label="Algunos productos sin precio">{' *'}</span>
                          )}
                        </span>
                      );
                    })()}
                  </div>
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
