import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import '../styles/packages.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiChevronRight, FiChevronDown, FiChevronUp, FiArrowLeft, FiInfo, FiFilter, FiClock, FiArchive, FiRotateCcw, FiBookmark } from 'react-icons/fi';
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

// ── Reglas de validación reutilizables ───────────────────────────────────────
// Funciones puras compartidas entre el submit batch (`validateForm`) y los
// blur handlers (validación progresiva por campo). Centralizar acá previene
// drift entre ambos caminos — antes el submit definía las reglas inline y no
// había forma de validar por campo sin duplicar.
const NOMBRE_MAX = 32;
const DESCRIPCION_MAX = 1024;
const TECNICO_MAX = 48;
const ACT_NAME_MAX = 120;
const ACT_DAY_MAX = 1825;
const ACT_PRODUCTOS_MAX = 24;
const PRODUCT_CANT_MAX = 1024;

function getPackageFieldError(field, value) {
  switch (field) {
    case 'nombrePaquete': {
      const v = (value || '').trim();
      if (!v) return 'El nombre es requerido.';
      if ((value || '').length > NOMBRE_MAX) return `Máximo ${NOMBRE_MAX} caracteres.`;
      return null;
    }
    case 'descripcion':
      return ((value || '').length > DESCRIPCION_MAX) ? `Máximo ${DESCRIPCION_MAX} caracteres.` : null;
    case 'tecnicoResponsable':
      return ((value || '').length > TECNICO_MAX) ? `Máximo ${TECNICO_MAX} caracteres.` : null;
    case 'tipoCosecha':
      return !value ? 'Selecciona el tipo de cosecha.' : null;
    case 'etapaCultivo':
      return !value ? 'Selecciona la etapa.' : null;
    default:
      return null;
  }
}

function getActivityFieldError(field, value) {
  switch (field) {
    case 'name': {
      const v = (value || '').trim();
      if (!v) return 'Nombre requerido.';
      if ((value || '').length > ACT_NAME_MAX) return `Máximo ${ACT_NAME_MAX} caracteres.`;
      return null;
    }
    case 'day': {
      const n = Number(value);
      if (value === '' || value == null || !Number.isInteger(n) || n < 0 || n > ACT_DAY_MAX) {
        return `Día entre 0 y ${ACT_DAY_MAX}.`;
      }
      return null;
    }
    default:
      return null;
  }
}

function getProductCantidadError(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= PRODUCT_CANT_MAX) {
    return `Cantidad mayor a 0 y menor a ${PRODUCT_CANT_MAX}.`;
  }
  return null;
}

// ── Diff entre formData actual y el paquete guardado (modo edición) ──────────
// Identifica qué campos/actividades fueron modificados respecto al snapshot
// del servidor para que la UI pueda marcar dot indicators y mostrar el badge
// "N cambios sin guardar". Comparación por posición en activities: añadidas
// y modificadas se marcan en card; eliminadas se cuentan en el header pero
// no tienen card a marcar.
const PKG_DIFF_FIELDS = ['nombrePaquete', 'descripcion', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable'];

function activitiesEqual(a, b) {
  if (!a || !b) return false;
  if ((a.name || '') !== (b.name || '')) return false;
  if (String(a.day ?? '') !== String(b.day ?? '')) return false;
  if ((a.responsableId || '') !== (b.responsableId || '')) return false;
  if ((a.calibracionId || '') !== (b.calibracionId || '')) return false;
  const aprods = a.productos || [];
  const bprods = b.productos || [];
  if (aprods.length !== bprods.length) return false;
  // Productos no tienen orden estable; sort por productoId antes de comparar.
  const sortByPid = (arr) => [...arr].sort((x, y) => (x.productoId || '').localeCompare(y.productoId || ''));
  const sA = sortByPid(aprods);
  const sB = sortByPid(bprods);
  for (let i = 0; i < sA.length; i++) {
    if (sA[i].productoId !== sB[i].productoId) return false;
    if (Number(sA[i].cantidadPorHa) !== Number(sB[i].cantidadPorHa)) return false;
  }
  return true;
}

function computePackageChanges(current, original) {
  const empty = { count: 0, fields: new Set(), activities: new Set() };
  if (!original) return empty;
  const fields = new Set();
  for (const f of PKG_DIFF_FIELDS) {
    if ((current[f] || '') !== (original[f] || '')) fields.add(f);
  }
  const activities = new Set();
  const curActs = current.activities || [];
  const origActs = original.activities || [];
  let removed = 0;
  const maxLen = Math.max(curActs.length, origActs.length);
  for (let i = 0; i < maxLen; i++) {
    const cur = curActs[i];
    const orig = origActs[i];
    if (cur && !orig) activities.add(i);                 // añadida
    else if (!cur && orig) removed += 1;                  // eliminada (no card a marcar)
    else if (cur && orig && !activitiesEqual(cur, orig)) activities.add(i); // modificada
  }
  return {
    count: fields.size + activities.size + removed,
    fields,
    activities,
  };
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

// ── Timeline horizontal de actividades (vista hub, read-only) ────────────────
// Renderiza cada actividad como un punto en una línea proporcional al día en
// que se ejecuta. Permite ver de un vistazo:
//   - distribución temporal del programa (gaps, aglomeraciones)
//   - cuáles son aplicaciones (verde) vs notificaciones (gris)
//   - el día exacto on hover (tooltip)
//
// Decisiones:
//   - Eventos puntuales, no rangos → puntos en eje, no barras Gantt.
//   - Eje se auto-escala al maxDay del paquete (con piso de 30d para que
//     paquetes muy cortos no se vean colapsados).
//   - Actividades en el mismo día se agrupan en un solo marker con badge
//     contador (caso real: dos aplicaciones distintas el día 0).
//   - Tooltip listo del navegador (atributo title) — sin lib de tooltips
//     para mantener el archivo manejable.
function PackageTimeline({ activities }) {
  if (!activities || activities.length === 0) return null;

  const items = activities.map(a => ({
    day: Number.isFinite(Number(a.day)) ? Number(a.day) : 0,
    name: (a.name || '').trim() || '(sin nombre)',
    type: a.type || 'notificacion',
  }));
  const maxDay = Math.max(...items.map(it => it.day), 30);

  // Agrupar por día para mostrar marker único con badge contador.
  const byDay = new Map();
  items.forEach(it => {
    if (!byDay.has(it.day)) byDay.set(it.day, []);
    byDay.get(it.day).push(it);
  });
  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="pkg-timeline" role="img" aria-label="Timeline de actividades del paquete">
      <div className="pkg-timeline-track">
        <div className="pkg-timeline-line" />
        {sortedDays.map(day => {
          const acts = byDay.get(day);
          const pct = maxDay > 0 ? (day / maxDay) * 100 : 0;
          const hasAplicacion = acts.some(a => a.type === 'aplicacion');
          const cls = hasAplicacion ? 'pkg-timeline-marker--apl' : 'pkg-timeline-marker--notif';
          const labels = acts.map(a => a.name).join(' · ');
          const title = acts.length === 1
            ? `Día ${day} · ${labels}`
            : `Día ${day} · ${acts.length} actividades: ${labels}`;
          return (
            <div
              key={day}
              className={`pkg-timeline-marker ${cls}`}
              style={{ left: `${pct}%` }}
              title={title}
            >
              <span className="pkg-timeline-marker-dot">
                {acts.length > 1 && (
                  <span className="pkg-timeline-marker-count">{acts.length}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pkg-timeline-axis">
        <span>Día 0</span>
        <span>Día {maxDay}</span>
      </div>
      <div className="pkg-timeline-legend" aria-hidden="true">
        <span className="pkg-timeline-legend-item">
          <span className="pkg-timeline-legend-dot pkg-timeline-legend-dot--apl" /> Aplicación
        </span>
        <span className="pkg-timeline-legend-item">
          <span className="pkg-timeline-legend-dot pkg-timeline-legend-dot--notif" /> Notificación
        </span>
      </div>
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
  const [pendingArchivePkg, setPendingArchivePkg] = useState(null); // { id, nombrePaquete, lotesCount, gruposCount }
  // Modal compacto para crear plantilla desde una actividad sin salir del
  // form del paquete. Pre-llena desde la actividad si tiene datos válidos.
  // Forma: { activityIndex, nombre, responsableId, includeProductos } | null
  const [templateModal, setTemplateModal] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState(null);

  // Banner "Borrador restaurado". Se inicializa al montar mirando localStorage
  // para que aparezca incluso antes del primer render del form. Cualquier
  // transición explícita (Cancelar, Nuevo, abrir otro paquete, descartar) lo
  // pone en false — el draft sigue intacto en disco, solo escondemos el aviso.
  const [draftRestored, setDraftRestored] = useState(() => isPackageDraftMeaningful(loadPackageDraft()));

  // Búsqueda y filtros sobre la lista/carrusel de paquetes. No se persisten
  // entre sesiones — cada visita arranca con todos los paquetes visibles.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTipoCosecha, setFilterTipoCosecha] = useState('');
  const [filterEtapaCultivo, setFilterEtapaCultivo] = useState('');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  // Sección de archivados colapsada por defecto. Cuando se expande, la lista
  // muestra los paquetes con `archivedAt` debajo de los activos.
  const [showArchived, setShowArchived] = useState(false);

  const hasActiveCategoryFilter = !!(filterTipoCosecha || filterEtapaCultivo);
  const hasAnyFilter = hasActiveCategoryFilter || !!searchQuery.trim();

  // applyFilters reutilizable para activos y archivados — antes era una sola
  // lista, ahora se split en dos para que carousel/list panel los manejen
  // separados sin duplicar la lógica de filtro.
  const applyFilters = useCallback((list) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q && !filterTipoCosecha && !filterEtapaCultivo) return list;
    return list.filter(pkg => {
      if (q && !(pkg.nombrePaquete || '').toLowerCase().includes(q)) return false;
      if (filterTipoCosecha && pkg.tipoCosecha !== filterTipoCosecha) return false;
      if (filterEtapaCultivo && pkg.etapaCultivo !== filterEtapaCultivo) return false;
      return true;
    });
  }, [searchQuery, filterTipoCosecha, filterEtapaCultivo]);

  const activePackages = useMemo(() => packages.filter(p => !p.archivedAt), [packages]);
  const archivedPackages = useMemo(() => packages.filter(p => p.archivedAt), [packages]);
  const filteredActivePackages = useMemo(() => applyFilters(activePackages), [activePackages, applyFilters]);
  const filteredArchivedPackages = useMemo(() => applyFilters(archivedPackages), [archivedPackages, applyFilters]);

  // Snapshot del paquete tal como vive en el server. Derivado de `packages`
  // (no almacenado aparte) para que se mantenga sincronizado con cambios
  // remotos sin gestión manual. Solo aplica en modo editar — `null` en
  // creación porque ahí no hay "original" contra el cual comparar.
  const originalSnapshot = useMemo(() => {
    if (!isEditing || !formData.id) return null;
    return packages.find(p => p.id === formData.id) || null;
  }, [packages, isEditing, formData.id]);
  const changes = useMemo(
    () => computePackageChanges(formData, originalSnapshot),
    [formData, originalSnapshot]
  );

  const clearCategoryFilters = () => {
    setFilterTipoCosecha('');
    setFilterEtapaCultivo('');
  };
  const clearAllFilters = () => {
    setSearchQuery('');
    clearCategoryFilters();
  };

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
    if (existing.length >= ACT_PRODUCTOS_MAX) {
      showToast(`Máximo ${ACT_PRODUCTOS_MAX} productos por aplicación.`, 'error');
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

  // ── Crear plantilla inline desde el form del paquete ────────────────────────
  // El flujo de /tasks para crear plantillas tiene muchos campos extra
  // (fecha, lote, bloque, etc.) que no aplican acá. Este modal compacto usa
  // la misma ruta `POST /api/task-templates` pero solo pide lo esencial:
  // nombre + responsable + (opcional) productos copiados de la actividad
  // actual. Si la actividad ya está rellena, crear plantilla es un click más.
  const openTemplateModal = (activityIndex) => {
    const act = formData.activities[activityIndex] || {};
    const hasProductos = (act.productos || []).length > 0;
    setTemplateModal({
      activityIndex,
      nombre: (act.name || '').trim(),
      responsableId: act.responsableId || '',
      includeProductos: hasProductos, // si la actividad tiene productos, default a incluirlos
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
      setPlantillas(prev => [...prev, created]);
      showToast(`Plantilla "${nombre}" creada.`);
      setTemplateModal(null);
    } catch (body) {
      showToast(translateApiError(body, 'No se pudo crear la plantilla.'), 'error');
    } finally {
      setSavingTemplate(false);
    }
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
    setDraftRestored(false);
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
    setDraftRestored(false);
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
    setDraftRestored(false);
  };

  const handleSelectPkg = (pkg) => {
    setSelectedPkg(pkg);
    setIsEditing(false);
    setIsFormOpen(true);
    setExpandedActivities(new Set());
    setHubExpandedActivities(new Set());
    setFormErrors({});
    setIsDirty(false);
    setDraftRestored(false);
    window.scrollTo(0, 0);
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

  // ── Blur handlers para validación progresiva ───────────────────────────────
  // Cada uno calcula el error con la misma función pura que usa validateForm
  // y lo monta/quita en formErrors. Disparados en onBlur — el usuario recibe
  // feedback apenas sale del campo, sin esperar al submit. Los on-change
  // existentes ya limpian el error mientras se escribe (clearError en
  // handleInputChange/handleActivityChange/updateProductCantidad), así que
  // este flujo "set on blur, clear on change" funciona simétrico.
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

  // Archivar = setear archivedAt sin tocar referencias existentes. El paquete
  // sigue resolviendo desde lotes/grupos que lo referencian — solo desaparece
  // de la lista activa. Desarchivar revierte. Distinto de DELETE, que rompe
  // las referencias.
  //
  // Flujo: handleArchiveClick consulta dependencias y abre el modal de
  // confirmación con la info; performArchive es la mutación cuando el usuario
  // confirma. Desarchivar es benigno (restaura algo que el usuario archivó
  // adrede), no requiere confirmación.
  const handleArchiveClick = async (pkg) => {
    try {
      const [lotesData, gruposData] = await Promise.all([
        apiFetch('/api/lotes').then(r => r.json()),
        apiFetch('/api/grupos').then(r => r.json()),
      ]);
      const lotesCount = (lotesData || []).filter(l => l.paqueteId === pkg.id).length;
      const gruposCount = (gruposData || []).filter(g => g.paqueteId === pkg.id).length;
      setPendingArchivePkg({
        id: pkg.id,
        nombrePaquete: pkg.nombrePaquete,
        lotesCount,
        gruposCount,
      });
    } catch {
      showToast('Error al verificar el paquete.', 'error');
    }
  };

  const performArchive = async (pkg) => {
    try {
      const res = await apiFetch(`/api/packages/${pkg.id}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error();
      // Optimistic update local: marca el paquete como archivado en memoria.
      // Hay que actualizar BOTH `packages` (para la lista/carrusel) y
      // `selectedPkg` (para el hub abierto) porque selectedPkg fue
      // snapshoteado al click — si no, el ícono del header sigue mostrando
      // "archivar" cuando ya está archivado.
      const optimisticAt = new Date().toISOString();
      setPackages(prev => prev.map(p => p.id === pkg.id ? { ...p, archivedAt: optimisticAt } : p));
      setSelectedPkg(prev => (prev && prev.id === pkg.id) ? { ...prev, archivedAt: optimisticAt } : prev);
      showToast(`Paquete "${pkg.nombrePaquete}" archivado.`);
    } catch {
      showToast('Error al archivar el paquete.', 'error');
    }
  };

  const handleUnarchive = async (pkg) => {
    try {
      const res = await apiFetch(`/api/packages/${pkg.id}/unarchive`, { method: 'POST' });
      if (!res.ok) throw new Error();
      // Mismo motivo que en performArchive: hay que sincronizar selectedPkg
      // además de packages para que el ícono del header se actualice al
      // instante.
      setPackages(prev => prev.map(p => {
        if (p.id !== pkg.id) return p;
        const { archivedAt, ...rest } = p;
        return rest;
      }));
      setSelectedPkg(prev => {
        if (!prev || prev.id !== pkg.id) return prev;
        const { archivedAt, ...rest } = prev;
        return rest;
      });
      showToast(`Paquete "${pkg.nombrePaquete}" reactivado.`);
    } catch {
      showToast('Error al desarchivar el paquete.', 'error');
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

      {pendingArchivePkg && (
        <AuroraConfirmModal
          title="¿Archivar paquete?"
          body={
            <>
              Vas a archivar <strong>"{pendingArchivePkg.nombrePaquete}"</strong>.
              {' '}Dejará de aparecer al elegir paquete para nuevos lotes o grupos.
              {(pendingArchivePkg.lotesCount > 0 || pendingArchivePkg.gruposCount > 0) && (
                <>
                  {' '}Hay{' '}
                  {pendingArchivePkg.lotesCount > 0 && (
                    <strong>
                      {pendingArchivePkg.lotesCount === 1
                        ? '1 lote'
                        : `${pendingArchivePkg.lotesCount} lotes`}
                    </strong>
                  )}
                  {pendingArchivePkg.lotesCount > 0 && pendingArchivePkg.gruposCount > 0 && ' y '}
                  {pendingArchivePkg.gruposCount > 0 && (
                    <strong>
                      {pendingArchivePkg.gruposCount === 1
                        ? '1 grupo'
                        : `${pendingArchivePkg.gruposCount} grupos`}
                    </strong>
                  )}
                  {' '}usando este paquete — sus actividades programadas seguirán ejecutándose normalmente.
                </>
              )}
              {' '}Puedes desarchivarlo cuando quieras.
            </>
          }
          confirmLabel="Archivar"
          onConfirm={() => {
            const pkg = pendingArchivePkg;
            setPendingArchivePkg(null);
            performArchive({ id: pkg.id, nombrePaquete: pkg.nombrePaquete });
          }}
          onCancel={() => setPendingArchivePkg(null)}
        />
      )}

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
                  <select
                    className="aur-select"
                    value={templateModal.responsableId}
                    onChange={e => setTemplateModal(prev => ({ ...prev, responsableId: e.target.value }))}
                    disabled={savingTemplate}
                  >
                    <option value="">Sin asignar</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
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
                  {pkgDepsModal.lotes.map(l => (
                    <li key={l.id}>
                      {/* Link con `state` para que LoteManagement auto-seleccione
                          el lote al montar — el usuario aterriza directamente
                          en el hub del lote, listo para reasignarle otro
                          paquete o detacharlo. Mismo patrón con grupos. */}
                      <Link
                        to="/lotes"
                        state={{ selectLoteId: l.id }}
                        className="pkg-deps-link"
                        onClick={() => setPkgDepsModal(null)}
                      >
                        {l.nombreLote || l.codigoLote || l.id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {pkgDepsModal.grupos.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Grupos</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.grupos.map(g => (
                    <li key={g.id}>
                      <Link
                        to="/grupos"
                        state={{ selectGrupoId: g.id }}
                        className="pkg-deps-link"
                        onClick={() => setPkgDepsModal(null)}
                      >
                        {g.nombreGrupo}
                      </Link>
                    </li>
                  ))}
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
              ? (isEditing
                  ? (
                    <>
                      Editar paquete
                      {changes.count > 0 && (
                        <span
                          className="pkg-changes-badge"
                          title="Diferencias respecto a la versión guardada en el servidor"
                        >
                          {changes.count === 1 ? '1 cambio sin guardar' : `${changes.count} cambios sin guardar`}
                        </span>
                      )}
                    </>
                  )
                  : 'Nuevo paquete')
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
          {/* Carrusel mobile = solo activos. Archivados se acceden desde el
              panel de lista (visible en mobile cuando no hay paquete elegido). */}
          {filteredActivePackages.map(pkg => {
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
              <div className={`aur-row${changes.fields.has('tecnicoResponsable') ? ' pkg-field--modified' : ''}`}>
                <label className="aur-row-label" htmlFor="tecnicoResponsable">Técnico responsable</label>
                <select
                  id="tecnicoResponsable"
                  name="tecnicoResponsable"
                  className={`aur-select${formErrors.tecnicoResponsable ? ' fld-error-input' : ''}`}
                  value={formData.tecnicoResponsable || ''}
                  onChange={handleInputChange}
                  onBlur={() => handleFieldBlur('tecnicoResponsable')}
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
                  <li
                    key={`act-${index}`}
                    className={`pkg-act-card${changes.activities.has(index) ? ' pkg-act-card--modified' : ''}`}
                  >
                    <div className="pkg-act-row">
                      <div className="pkg-act-day">
                        <input
                          type="number"
                          min={0}
                          max={1825}
                          step={1}
                          value={activity.day}
                          onChange={(e) => handleActivityChange(index, 'day', e.target.value)}
                          onBlur={() => handleActivityBlur(index, 'day')}
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
                          onBlur={() => handleActivityBlur(index, 'name')}
                          placeholder="Nombre de la actividad"
                          required
                          maxLength={ACT_NAME_MAX}
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
                          <select
                            className="aur-chip aur-chip--ghost"
                            value=""
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '__create__') openTemplateModal(index);
                              else if (v) aplicarPlantillaAActividad(index, v);
                            }}
                            aria-label="Plantillas de aplicaciones"
                          >
                            <option value="">+ Plantilla</option>
                            {plantillas.length === 0 && (
                              <option value="" disabled>No hay plantillas de aplicaciones</option>
                            )}
                            {plantillas.map(p => (
                              <option key={p.id} value={p.id}>{p.nombre}</option>
                            ))}
                            <option value="__create__">+ Crear plantilla a partir de esta actividad…</option>
                          </select>
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
                                    onBlur={(e) => handleProductCantidadBlur(index, p.productoId, e.target.value)}
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
          {selectedPkg.archivedAt && (
            <div className="pkg-archived-banner" role="status">
              <FiArchive size={13} aria-hidden="true" />
              <span>Este paquete está archivado. Los lotes y grupos que ya lo referencian siguen funcionando, pero no aparece al elegir paquete para uno nuevo.</span>
              <button
                type="button"
                className="pkg-archived-banner-action"
                onClick={() => handleUnarchive(selectedPkg)}
              >
                Desarchivar
              </button>
            </div>
          )}
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
              {selectedPkg.archivedAt ? (
                <button onClick={() => handleUnarchive(selectedPkg)} className="icon-btn pkg-icon-btn--archived" title="Desarchivar paquete">
                  <FiRotateCcw size={16} />
                </button>
              ) : (
                <button onClick={() => handleArchiveClick(selectedPkg)} className="icon-btn" title="Archivar paquete">
                  <FiArchive size={16} />
                </button>
              )}
              <button onClick={() => handleDeleteClick(selectedPkg)} className="icon-btn delete" title="Eliminar permanentemente">
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
            <>
            <PackageTimeline activities={selectedPkg.activities} />
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
            </>
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
          {(() => {
            const renderItem = (pkg, isArchived) => {
              const itemActive = selectedPkg?.id === pkg.id || (isEditing && formData.id === pkg.id);
              // Avatar con el mismo hash determinista que el carrusel mobile
              // para que un paquete se vea con el mismo color en ambos sitios.
              // Cuando el item está activo, CSS pinta el avatar verde Aurora
              // (igual que .pkg-bubble--active en el carrusel) y descartamos
              // el style inline.
              const avatarStyle = itemActive ? undefined : pickPkgAvatarStyle(pkg.nombrePaquete);
              return (
                <li
                  key={pkg.id}
                  className={`lote-list-item${itemActive ? ' active' : ''}${isArchived ? ' pkg-list-item--archived' : ''}`}
                  onClick={() => guardedNav(() => {
                    if (selectedPkg?.id === pkg.id && !isEditing) { resetForm(); return; }
                    handleSelectPkg(pkg);
                  })}
                >
                  <span
                    className="pkg-list-avatar"
                    style={avatarStyle ? { background: avatarStyle.bg, color: avatarStyle.fg } : undefined}
                    aria-hidden="true"
                  >
                    {getPkgInitials(pkg.nombrePaquete)}
                  </span>
                  <div className="lote-list-info">
                    <span className="lote-list-code" title={pkg.nombrePaquete}>
                      {pkg.nombrePaquete}
                      {isArchived && <span className="pkg-list-archived-badge" title="Paquete archivado">Archivado</span>}
                    </span>
                    <span className="lote-list-name">
                      {[
                        pkg.tipoCosecha,
                        pkg.etapaCultivo && pkg.etapaCultivo !== 'N/A' ? pkg.etapaCultivo : null,
                        `${pkg.activities.length} act.`,
                      ].filter(Boolean).join(' · ')}
                    </span>
                    {(() => {
                      // Costo como tercera línea dentro de info. Antes vivía
                      // en una columna a la derecha pero, en paneles angostos,
                      // esa columna se llevaba ~90px y empujaba el nombre a
                      // partirse en pedazos. Ahora el nombre tiene todo el
                      // ancho de la columna (truncado con … si es muy largo)
                      // y el costo queda debajo del meta con tipografía
                      // diferenciada — sigue prominent pero ya no compite por
                      // espacio horizontal con el nombre.
                      const costo = calcularCosto(flattenActivityProducts(pkg.activities), productos);
                      if (costo.totals.length === 0) return null;
                      return (
                        <div
                          className="pkg-list-cost-row"
                          title={
                            costo.hasMissingPrice
                              ? `Costo total del paquete por hectárea. ${missingPriceTooltip(costo.withoutPrice)}`
                              : 'Costo total del paquete por hectárea'
                          }
                        >
                          {costo.totals.map(([mon, total]) => (
                            <span key={mon} className="pkg-list-cost-amount">
                              {total.toFixed(2)}
                              <span className="pkg-list-cost-unit">{mon}/Ha</span>
                            </span>
                          ))}
                          {costo.hasMissingPrice && (
                            <span className="pkg-cost-warn" aria-label="Algunos productos sin precio">*</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              );
            };

            if (packages.length === 0) {
              return (
                <p className="empty-state">
                  Aún no hay registros que mostrar. Crea el primero en "Nuevo Paquete".
                </p>
              );
            }

            const totalFiltered = filteredActivePackages.length + filteredArchivedPackages.length;
            if (totalFiltered === 0) {
              return (
                <p className="empty-state">
                  Sin resultados para los filtros aplicados.{' '}
                  <button type="button" className="aur-btn-text pkg-list-clear-link" onClick={clearAllFilters}>
                    Limpiar filtros
                  </button>
                </p>
              );
            }

            return (
              <>
                {filteredActivePackages.length > 0 && (
                  <ul className="lote-list">
                    {filteredActivePackages.map(pkg => renderItem(pkg, false))}
                  </ul>
                )}
                {filteredArchivedPackages.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="pkg-list-archived-toggle"
                      onClick={() => setShowArchived(prev => !prev)}
                      aria-expanded={showArchived}
                    >
                      <FiArchive size={12} />
                      <span>
                        {showArchived ? 'Ocultar' : 'Ver'} {filteredArchivedPackages.length === 1
                          ? '1 archivado'
                          : `${filteredArchivedPackages.length} archivados`}
                      </span>
                      <FiChevronDown
                        size={12}
                        className={`pkg-list-archived-chevron${showArchived ? ' is-open' : ''}`}
                      />
                    </button>
                    {showArchived && (
                      <ul className="lote-list pkg-list--archived-section">
                        {filteredArchivedPackages.map(pkg => renderItem(pkg, true))}
                      </ul>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
      </div>}
    </div>
  );
}

export default PackageManagement;
