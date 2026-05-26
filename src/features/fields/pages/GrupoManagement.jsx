import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import '../styles/grupo-management.css';
import { FiEdit, FiTrash2, FiPlus, FiEye, FiShare2, FiPrinter, FiX, FiArrowLeft, FiCalendar, FiLayers, FiPackage, FiChevronRight, FiSliders, FiAlertTriangle, FiRefreshCw, FiCheck } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import BloqueSortTh from '../components/BloqueSortTh';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatDateLong = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

const tsToDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000);
  return new Date(timestamp);
};

const calcFechaCosecha = (grupo, config) => {
  const etapa   = (grupo.etapa   || '').toLowerCase();
  const cosecha = (grupo.cosecha || '').toLowerCase();
  let dias;
  if (etapa.includes('postforza') || etapa.includes('post forza')) {
    dias = config.diasPostForza ?? 150;
  } else if (cosecha.includes('ii') || cosecha.includes('2')) {
    dias = config.diasIIDesarrollo ?? 215;
  } else {
    dias = config.diasIDesarrollo ?? 250;
  }
  const base = tsToDate(grupo.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + dias);
  return result;
};

// Consolida un arreglo de siembras (varios registros para el mismo lote+bloque)
// en una fila única por bloque físico. Las áreas y plantas se suman; los
// materiales/variedades distintos se concatenan con " · ".
function consolidateSiembrasByBloque(siembras) {
  const map = new Map();
  for (const s of siembras) {
    if (!s) continue;
    const key = `${s.loteId}__${s.bloque}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `${s.loteId}__${s.bloque}`,
        siembraIds: [],
        loteId: s.loteId,
        loteNombre: s.loteNombre || s.loteId,
        bloque: s.bloque,
        plantas: 0,
        areaCalculada: 0,
        _materiales: new Set(),
        _variedades: new Set(),
      });
    }
    const entry = map.get(key);
    entry.siembraIds.push(s.id);
    entry.plantas += (s.plantas || 0);
    entry.areaCalculada += (parseFloat(s.areaCalculada) || 0);
    if (s.materialNombre) entry._materiales.add(s.materialNombre);
    if (s.variedad) entry._variedades.add(s.variedad);
  }
  return [...map.values()].map(e => {
    const materialNombre = [...e._materiales].join(' · ');
    const variedad = [...e._variedades].join(' · ');
    delete e._materiales;
    delete e._variedades;
    return { ...e, materialNombre, variedad };
  });
}

// ── Tabla de bloques: helpers de ordenamiento / filtrado ─────────────────────
function compare(a, b, field) {
  const av = a[field] ?? '';
  const bv = b[field] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}
function multiSort(records, sorts) {
  const active = sorts.filter(s => s.field);
  if (!active.length) return [...records];
  return [...records].sort((a, b) => {
    for (const s of active) {
      const r = compare(a, b, s.field);
      if (r !== 0) return s.dir === 'desc' ? -r : r;
    }
    return 0;
  });
}
const BLOQUE_COLS = [
  { id: 'loteNombre', label: 'Lote'     },
  { id: 'bloque',     label: 'Bloque'   },
  { id: 'ha',         label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',    label: 'Plantas', filterType: 'number' },
  { id: 'material',   label: 'Material' },
  { id: 'kg',         label: 'Kg Est.', filterType: 'number' },
];

// ── New catalog value modal (cosecha / etapa) ───────────────────────────────
function NuevoCatalogModal({ field, onConfirm, onCancel }) {
  const [nombre, setNombre] = useState('');
  const label = field === 'cosecha' ? 'cosecha' : 'etapa';
  const placeholder = field === 'cosecha' ? 'Ej. Cosecha I 2024' : 'Ej. Desarrollo';
  return (
    <AuroraConfirmModal
      title={`Nueva ${label}`}
      icon={<FiPlus size={16} />}
      iconVariant="neutral"
      confirmLabel="Agregar"
      confirmDisabled={!nombre.trim()}
      onConfirm={() => onConfirm(nombre.trim())}
      onCancel={onCancel}
    >
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="catalog-nombre">
          Nombre
        </label>
        <input
          id="catalog-nombre"
          className="aur-input"
          placeholder={placeholder}
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          maxLength={32}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && nombre.trim()) onConfirm(nombre.trim()); }}
        />
      </div>
    </AuroraConfirmModal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function GrupoManagement() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [grupos,            setGrupos]            = useState([]);
  const [siembras,          setSiembras]          = useState([]);
  const [bloquesDisponibles, setBloquesDisponibles] = useState([]);
  const [packages,          setPackages]          = useState([]);
  const [monitoreoPackages, setMonitoreoPackages] = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [selectedGrupo, setSelectedGrupo] = useState(null);
  const [showForm,      setShowForm]      = useState(false);
  const [showLibres,    setShowLibres]    = useState(false);
  const [showEnAplicacion, setShowEnAplicacion] = useState(false);
  const [moveModal,     setMoveModal]     = useState(null);
  const [isEditing,     setIsEditing]     = useState(false);
  const [catalogModal,  setCatalogModal]  = useState(null);
  const [localCosechas, setLocalCosechas] = useState([]);
  const [localEtapas,   setLocalEtapas]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState(null);
  const [toast,         setToast]         = useState(null);
  // Banner persistente post-save. Reemplaza el toast efímero como evidencia
  // visual del guardado — vive hasta que el usuario lo cierre, clickee Abrir,
  // o arranque otro flujo de crear/editar. Shape:
  //   { id, label, action: 'created' | 'updated', tasksGenerated: boolean }
  // `tasksGenerated` distingue el caso "Grupo creado y tareas programadas"
  // que hoy aparecía en el toast cuando el grupo se creaba con paqueteId.
  const [lastSavedGrupo, setLastSavedGrupo] = useState(null);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [deleteModal,   setDeleteModal]   = useState(null);
  const [previewGrupo,     setPreviewGrupo]     = useState(null);
  const [bloqueSorts,      setBloqueSorts]      = useState([{ field: 'loteNombre', dir: 'asc' }]);
  const [bloqueColFilters, setBloqueColFilters] = useState({});
  const [bloqueFilterPop,  setBloqueFilterPop]  = useState(null);
  const [bloqueHiddenCols, setBloqueHiddenCols] = useState(new Set());
  const [bloqueColMenu,    setBloqueColMenu]     = useState(null);
  const docRef      = useRef(null);
  const carouselRef = useRef(null);
  // Refs para scroll-to-error en submit fallido. Para el campo de bloques
  // apuntamos al section header (no es un input enfocable), así que solo
  // hacemos scrollIntoView, no focus.
  const nombreGrupoRef    = useRef(null);
  const fechaCreacionRef  = useRef(null);
  const bloquesSectionRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [formData, setFormData] = useState({
    id: null, nombreGrupo: '', cosecha: '', etapa: '',
    fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '',
  });
  // Validación inline. `touched` se llena cuando el campo pierde foco;
  // `submitAttempted` cuando el usuario clickea Crear/Actualizar con
  // errores presentes. Un error solo se renderiza si el campo fue tocado
  // O hubo intento de submit — así no asustamos con errores en el render
  // inicial.
  const [touched, setTouched] = useState(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Carga inicial de los 6 recursos en paralelo. Promise.allSettled deja
  // que un fetch caído no bloquee al resto — el usuario ve lo que sí llegó
  // y un banner persistente con CTA Reintentar. Antes los errores se
  // tragaban en console.error y la página mostraba un falso "Sin grupos
  // creados" cuando en realidad la red estaba caída. Patrón portado de
  // LoteManagement.reloadAll.
  const reloadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      apiFetch('/api/grupos').then(r => r.json()).then(setGrupos),
      apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])),
      apiFetch('/api/siembras/disponibles').then(r => r.json()).then(d => setBloquesDisponibles(Array.isArray(d) ? d : [])),
      apiFetch('/api/packages').then(r => r.json()).then(setPackages),
      apiFetch('/api/muestreos/paquetes').then(r => r.json()).then(setMonitoreoPackages),
      apiFetch('/api/config').then(r => r.json()).then(setEmpresaConfig),
    ]);
    const failed = results.filter(r => r.status === 'rejected').length;
    setLoadError(failed > 0
      ? `No se pudieron cargar ${failed} de ${results.length} recursos. La información mostrada puede estar incompleta.`
      : null);
    setLoading(false);
  }, [apiFetch]);

  // Refresh post-save/post-delete: solo los recursos volátiles (grupos +
  // siembras + bloques disponibles). No toca loading porque la página ya
  // está montada y visible — sería un flash UI raro. Devuelve el array de
  // grupos para que los handlers puedan auto-seleccionar el doc guardado.
  const refreshAfterMutation = useCallback(async () => {
    const [gRes] = await Promise.allSettled([
      apiFetch('/api/grupos').then(r => r.json()).then(d => { setGrupos(d); return d; }),
      apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])),
      apiFetch('/api/siembras/disponibles').then(r => r.json()).then(d => setBloquesDisponibles(Array.isArray(d) ? d : [])),
    ]);
    return gRes.status === 'fulfilled' ? gRes.value : null;
  }, [apiFetch]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Deep-link entrante (e.g. desde el modal de dependencias en /packages,
  // o desde el panel de cobertura del hub de un lote en /lotes):
  //   - state.selectGrupoId      → auto-seleccionar ese grupo al cargar
  //   - state.preloadSiembraIds  → abrir el form de nuevo grupo con esos
  //                                 siembraIds ya marcados como bloques
  //                                 (flujo "Crear grupo con estos bloques")
  // La ref evita re-aplicar el deep-link si `grupos` se refetchea después.
  const location = useLocation();
  const incomingSelectGrupoId  = location.state?.selectGrupoId;
  const incomingPreloadIds     = location.state?.preloadSiembraIds;
  const incomingPreloadLote    = location.state?.preloadLoteCode;
  const deepLinkProcessedRef = useRef(false);
  useEffect(() => {
    if (deepLinkProcessedRef.current) return;
    if (incomingSelectGrupoId) {
      if (!Array.isArray(grupos) || grupos.length === 0) return;
      const found = grupos.find(g => g.id === incomingSelectGrupoId);
      if (!found) return;
      deepLinkProcessedRef.current = true;
      setSelectedGrupo(found);
      return;
    }
    if (Array.isArray(incomingPreloadIds) && incomingPreloadIds.length > 0) {
      // No esperamos a `bloquesDisponibles` — el form preselecciona por id y
      // tolera ids que el picker aún no listó (se renderean cuando llega la
      // data). Si algún id fue movido a otro grupo mientras tanto, el move
      // modal del propio form maneja el conflicto al guardar.
      deepLinkProcessedRef.current = true;
      setIsEditing(false);
      setSelectedGrupo(null);
      setFormData({
        id: null,
        nombreGrupo: '',
        cosecha: '',
        etapa: '',
        fechaCreacion: '',
        bloques: incomingPreloadIds,
        paqueteId: '',
        paqueteMuestreoId: '',
      });
      setShowForm(true);
      if (incomingPreloadLote) {
        showToast(`Creá un grupo con los bloques sin agrupar de ${incomingPreloadLote}.`, 'info');
      }
    }
  }, [grupos, incomingSelectGrupoId, incomingPreloadIds, incomingPreloadLote]);

  // Centra la burbuja activa en el carousel cuando cambia el grupo seleccionado
  useEffect(() => {
    if (!selectedGrupo || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedGrupo]);

  // ── Bloques eligibles ─────────────────────────────────────────────────────
  // Backward-compat: still expose cerradoSiembras for the empty-state copy
  // ("ciérralos desde el Historial de Siembra"). Selection now flows through
  // bloquesDisponibles (enriched with grupo state) instead of recomputing
  // from raw siembras.
  const cerradoSiembras = useMemo(() => siembras.filter(s => s.cerrado), [siembras]);

  const consolidatedBloques = useMemo(() => {
    const map = new Map();
    for (const s of bloquesDisponibles) {
      const key = `${s.loteId}__${s.bloque}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          ids: [],
          loteId: s.loteId,
          loteNombre: s.loteNombre || s.loteId,
          bloque: s.bloque,
          plantas: 0,
          areaCalculada: 0,
          variedad: s.variedad || '',
          materialNombre: s.materialNombre || '',
          estado: 'libre',
          grupoActualId: null,
          grupoActualNombre: null,
          grupoActualEtapa: null,
          grupoActualCosecha: null,
          aplicacionesCompletadas: null,
          aplicacionesTotales: null,
        });
      }
      const entry = map.get(key);
      entry.ids.push(s.id);
      entry.plantas += (s.plantas || 0);
      entry.areaCalculada += (parseFloat(s.areaCalculada) || 0);

      // Promote estado to the most "active" of the siembras in this physical
      // block: en_aplicacion > fuera_aplicacion > libre. In practice all
      // siembras of a (lote, bloque) share the same grupo so the merge is
      // a no-op, but guard for the edge case.
      if (s.estado === 'en_aplicacion') entry.estado = 'en_aplicacion';
      else if (s.estado === 'fuera_aplicacion' && entry.estado === 'libre') entry.estado = 'fuera_aplicacion';

      if (s.grupoActualId && !entry.grupoActualId) {
        entry.grupoActualId        = s.grupoActualId;
        entry.grupoActualNombre    = s.grupoActualNombre;
        entry.grupoActualEtapa     = s.grupoActualEtapa;
        entry.grupoActualCosecha   = s.grupoActualCosecha;
        entry.aplicacionesCompletadas = s.aplicacionesCompletadas;
        entry.aplicacionesTotales     = s.aplicacionesTotales;
      }
    }
    return [...map.values()];
  }, [bloquesDisponibles]);

  const editingGrupoId = isEditing ? formData.id : null;

  const byLoteSeleccionados = useMemo(() => {
    const sel = consolidatedBloques.filter(b => b.ids.some(id => formData.bloques.includes(id)));
    return sel.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [consolidatedBloques, formData.bloques]);

  // A bloque is "free for the picker" when it doesn't belong to any other
  // grupo. Bloques whose grupoActualId matches the grupo being edited are
  // also treated as free here — they live in form.bloques when selected,
  // and reappear in this list (rather than in "Otros grupos") if the user
  // unticks them, since their effective destination after save is "no group".
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

  const libresCount   = Object.values(byLoteLibres).reduce((sum, arr) => sum + arr.length, 0);
  const fueraCount    = Object.values(byLoteFueraAplicacion).reduce((sum, arr) => sum + arr.length, 0);
  const enAplicacionCount = Object.values(byLoteEnAplicacion).reduce((sum, arr) => sum + arr.length, 0);

  const selectedBlockCount = useMemo(() => {
    const keys = new Set();
    for (const id of formData.bloques) {
      const s = bloquesDisponibles.find(x => x.id === id) || siembras.find(x => x.id === id);
      if (s) keys.add(`${s.loteId}__${s.bloque}`);
    }
    return keys.size;
  }, [formData.bloques, bloquesDisponibles, siembras]);

  // ── Paquetes filtrados ────────────────────────────────────────────────────
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

  // Solo paquetes activos (no archivados) y que matcheen cosecha/etapa del
  // grupo. Si el grupo ya tenía un paquete archivado asignado previamente,
  // ese valor se conserva en el select vía un fallback option (ver más abajo)
  // para no perder la asociación al editar.
  const filteredPackages = useMemo(() =>
    packages.filter(p =>
      !p.archivedAt &&
      (!formData.cosecha || p.tipoCosecha === formData.cosecha) &&
      (!formData.etapa   || p.etapaCultivo === formData.etapa)
    ),
  [packages, formData.cosecha, formData.etapa]);

  // Paquete actualmente asignado al grupo en edición. Si está archivado o no
  // matchea los filtros activos, no aparecería en `filteredPackages`, dejando
  // el select sin opción visible. Lo emitimos como fallback option marcado.
  const archivedCurrentPackage = useMemo(() => {
    if (!formData.paqueteId) return null;
    const cur = packages.find(p => p.id === formData.paqueteId);
    if (!cur) return null;
    return filteredPackages.find(p => p.id === cur.id) ? null : cur;
  }, [packages, formData.paqueteId, filteredPackages]);

  // ── Datos del grupo seleccionado (hub) ────────────────────────────────────
  // Un mismo bloque físico (lote+bloque) puede tener varias siembras (registros
  // separados con materiales distintos o capturas parciales). El hub presenta
  // una fila por bloque físico con las plantas y el área sumadas, no una fila
  // por registro de siembra.
  const selectedBloques = useMemo(() => {
    if (!selectedGrupo) return [];
    const owned = (selectedGrupo.bloques || [])
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
    return consolidateSiembrasByBloque(owned);
  }, [selectedGrupo, siembras]);

  const selectedFechaCosecha = useMemo(
    () => selectedGrupo ? calcFechaCosecha(selectedGrupo, empresaConfig) : null,
    [selectedGrupo, empresaConfig]
  );

  const selectedTotalHa      = selectedBloques.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0);
  const selectedTotalPlantas = selectedBloques.reduce((s, b) => s + (b.plantas || 0), 0);
  const selectedTotalKg      = selectedTotalPlantas * 1.6;

  // ── Tabla de bloques: normalizar, filtrar, ordenar ────────────────────────
  const selectedBloquesNorm = useMemo(() =>
    selectedBloques.map(b => ({
      ...b,
      ha:       parseFloat(b.areaCalculada) || 0,
      material: b.materialNombre || b.variedad || '',
      kg:       (b.plantas || 0) * 1.6,
    })),
  [selectedBloques]);

  const bloqueFiltered = useMemo(() => {
    const active = Object.entries(bloqueColFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    if (!active.length) return selectedBloquesNorm;
    return selectedBloquesNorm.filter(r => {
      for (const [field, filter] of active) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          } else {
            const str = String(cell);
            if (filter.from && str < filter.from) return false;
            if (filter.to   && str > filter.to)   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [selectedBloquesNorm, bloqueColFilters]);

  const bloqueSorted = useMemo(() => multiSort(bloqueFiltered, bloqueSorts), [bloqueFiltered, bloqueSorts]);

  const filtTotalHa      = bloqueSorted.reduce((s, b) => s + (b.ha || 0), 0);
  const filtTotalPlantas = bloqueSorted.reduce((s, b) => s + (b.plantas || 0), 0);
  const filtTotalKg      = filtTotalPlantas * 1.6;

  const setBloqueColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setBloqueColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  const handleBloqueColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setBloqueColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  // ── Validación inline del form ────────────────────────────────────────────
  // Derivado puro: siempre refleja el estado actual de formData. Los errores
  // se muestran condicionalmente vía shouldShowError() — no en cada render,
  // solo cuando el usuario interactuó con el campo o intentó submit.
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

  // ── Handlers form ─────────────────────────────────────────────────────────
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

  const removeBloque = (ids) =>
    setFormData(prev => ({ ...prev, bloques: prev.bloques.filter(id => !ids.includes(id)) }));

  const toggleBloque = (ids) =>
    setFormData(prev => {
      const allSelected = ids.every(id => prev.bloques.includes(id));
      if (allSelected) {
        return { ...prev, bloques: prev.bloques.filter(id => !ids.includes(id)) };
      }
      const newIds = ids.filter(id => !prev.bloques.includes(id));
      return { ...prev, bloques: [...prev.bloques, ...newIds] };
    });

  // Handles "Agregar" clicks on the picker. If the bloque belongs to another
  // grupo (and the user is not just re-adding one of the editing grupo's
  // own bloques), open a confirmation modal so the move is explicit and
  // auditable. Otherwise, add directly.
  const handleAddBloque = (bloque) => {
    if (bloque.grupoActualId && bloque.grupoActualId !== editingGrupoId) {
      setMoveModal(bloque);
      return;
    }
    addBloque(bloque.ids);
  };

  const confirmMoveBloque = () => {
    if (!moveModal) return;
    addBloque(moveModal.ids);
    setMoveModal(null);
  };

  const resetForm = () => {
    setIsEditing(false);
    setShowForm(false);
    setShowLibres(false);
    setShowEnAplicacion(false);
    setMoveModal(null);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '' });
    setTouched(new Set());
    setSubmitAttempted(false);
  };

  const handleNewGrupo = () => {
    // Iniciar un flujo nuevo invalida el banner del save previo — es
    // intención nueva del usuario, no queremos mezclar evidencias.
    setLastSavedGrupo(null);
    setIsEditing(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '' });
    setTouched(new Set());
    setSubmitAttempted(false);
    setShowForm(true);
    setSelectedGrupo(null);
  };

  const handleSelectGrupo = (grupo) => {
    setSelectedGrupo(grupo);
    setShowForm(false);
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
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

  const formatDateForInput = (ts) => {
    const date = tsToDate(ts);
    if (!date) return '';
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const handleEdit = (grupo) => {
    setLastSavedGrupo(null);
    setIsEditing(true);
    setShowForm(true);
    setFormData({
      id:            grupo.id,
      nombreGrupo:   grupo.nombreGrupo  || '',
      cosecha:       grupo.cosecha      || '',
      etapa:         grupo.etapa        || '',
      fechaCreacion: grupo.fechaCreacion ? formatDateForInput(grupo.fechaCreacion) : '',
      bloques:       Array.isArray(grupo.bloques) ? grupo.bloques : [],
      paqueteId:         grupo.paqueteId         || '',
      paqueteMuestreoId: grupo.paqueteMuestreoId || '',
    });
    setTouched(new Set());
    setSubmitAttempted(false);
  };

  const handleDeleteClick = async (grupo) => {
    try {
      const res = await apiFetch(`/api/grupos/${grupo.id}/delete-check`);
      const data = await res.json();
      if (data.cedulasAplicadas.length > 0) {
        setDeleteModal({ type: 'aplicada', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: data.cedulasAplicadas, cedulasEnTransito: [] });
      } else if (data.cedulasEnTransito.length > 0) {
        setDeleteModal({ type: 'en_transito', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: [], cedulasEnTransito: data.cedulasEnTransito });
      } else {
        setConfirmModal({ grupoId: grupo.id, grupoName: grupo.nombreGrupo });
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/grupos/${confirmModal.grupoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (selectedGrupo?.id === confirmModal.grupoId) setSelectedGrupo(null);
      setConfirmModal(null);
      refreshAfterMutation();
      showToast('Grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  // Una sola request al endpoint server-side que anula las cédulas en
  // tránsito (con reversión de inventario) y elimina el grupo en batches
  // transaccionales. Reemplaza el flujo previo de N PUT /anular + 1 DELETE
  // que dejaba estado parcialmente mutado si fallaba a mitad.
  const handleAnularYEliminar = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/grupos/${deleteModal.grupoId}/anular-y-eliminar`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // CEDULA_APLICADA: race entre el delete-check del modal y este POST
        // (alguien aplicó una cédula entre medio). Invitar a recargar para
        // ver el modal correcto ("No es posible eliminar — hay aplicadas").
        const msg = body?.code === 'CEDULA_APLICADA'
          ? 'Alguna cédula fue aplicada en campo desde que abriste este modal. Recargá para ver el estado actualizado.'
          : 'Error al eliminar el grupo.';
        showToast(msg, 'error');
        return;
      }
      if (selectedGrupo?.id === deleteModal.grupoId) setSelectedGrupo(null);
      setDeleteModal(null);
      refreshAfterMutation();
      showToast('Cédulas anuladas y grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Guard re-entry: el botón ya queda disabled durante saving, pero Enter
    // en un input dispara onSubmit sin pasar por el botón — sin esto, dos
    // Enter rápidos antes del re-render se traducen en dos POST.
    if (saving) return;
    // Validación: si fieldErrors tiene cualquier mensaje, marcamos
    // submitAttempted (que destapa todos los errores inline) y hacemos
    // scroll + focus al primero. No usamos toast — el mensaje vive
    // debajo del campo, persistente y accionable.
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
          // setTimeout para que el focus no compita con el scroll smooth
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
      const saved     = await res.json();
      const newGrupos = await refreshAfterMutation();
      const savedId   = isEditing ? formData.id : saved.id;
      let foundGrupo = null;
      if (savedId && newGrupos) {
        foundGrupo = newGrupos.find(g => g.id === savedId) || null;
        if (foundGrupo) setSelectedGrupo(foundGrupo);
      }
      resetForm();
      // Banner persistente reemplaza el toast efímero. El toast de error
      // (catch) sigue vivo porque ahí queremos algo que llame la atención
      // y desaparezca solo cuando el usuario reintenta.
      if (foundGrupo) {
        setLastSavedGrupo({
          id: foundGrupo.id,
          label: foundGrupo.nombreGrupo || savedId,
          action: isEditing ? 'updated' : 'created',
          tasksGenerated: !isEditing && !!formData.paqueteId,
        });
      }
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Preview (PDF / print) ────────────────────────────────────────────────
  const handleCompartir = async () => {
    if (!docRef.current) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Grupo-${previewGrupo?.nombreGrupo || 'doc'}.pdf`;
      const blob     = pdf.output('blob');
      const file     = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast('PDF descargado');
      }
    } catch {
      showToast('No se pudo generar el PDF.', 'error');
    }
  };

  const previewBloques = useMemo(() => {
    if (!previewGrupo) return [];
    const owned = (previewGrupo.bloques || [])
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
    return consolidateSiembrasByBloque(owned);
  }, [previewGrupo, siembras]);

  const previewFechaCosecha  = previewGrupo ? calcFechaCosecha(previewGrupo, empresaConfig) : null;
  const previewFechaCreacion = previewGrupo ? tsToDate(previewGrupo.fechaCreacion) : null;

  const pvTotalHa      = previewBloques.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0);
  const pvTotalPlantas = previewBloques.reduce((s, b) => s + (b.plantas || 0), 0);
  const pvTotalKg      = pvTotalPlantas * 1.6;

  const getPackageName = (id) => packages.find(p => p.id === id)?.nombrePaquete || '—';
  const getMonitoreoPackageName = (id) => monitoreoPackages.find(p => p.id === id)?.nombrePaquete || '—';

  // ── Panel principal (hub o formulario) ───────────────────────────────────
  const renderPanel = () => {
    if (showForm) {
      return (
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
                        {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
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
                              {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
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
                              {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
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
                                  {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
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
              <button type="button" onClick={resetForm} className="aur-btn-text" disabled={saving}>Cancelar</button>
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiPlus size={14} /> {saving ? 'Guardando…' : (isEditing ? 'Actualizar Grupo' : 'Crear Grupo')}
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (!selectedGrupo) return null;

    const sortThProps = {
      sorts:        bloqueSorts,
      setSorts:     setBloqueSorts,
      colFilters:   bloqueColFilters,
      filterPop:    bloqueFilterPop,
      setFilterPop: setBloqueFilterPop,
    };

    return (
      <div className="grupo-hub">
        <button className="grupo-hub-back" onClick={() => setSelectedGrupo(null)}>
          <FiArrowLeft size={13} /> Todos los grupos
        </button>
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedGrupo.nombreGrupo}</h2>
          </div>
          <div className="hub-header-actions">
            <button onClick={() => setPreviewGrupo(selectedGrupo)} className="aur-icon-btn" title="Vista previa / PDF" aria-label="Vista previa / PDF del grupo">
              <FiEye size={16} aria-hidden="true" />
            </button>
            <button onClick={() => handleEdit(selectedGrupo)} className="aur-icon-btn" title="Editar" aria-label="Editar grupo">
              <FiEdit size={16} aria-hidden="true" />
            </button>
            <button onClick={() => handleDeleteClick(selectedGrupo)} className="aur-icon-btn aur-icon-btn--danger" title="Eliminar" aria-label="Eliminar grupo">
              <FiTrash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          <span className="aur-badge">
            <FiCalendar size={13} />
            {formatDateLong(tsToDate(selectedGrupo.fechaCreacion))}
          </span>
          {selectedGrupo.cosecha && <span className="aur-badge aur-badge--violet">{selectedGrupo.cosecha}</span>}
          {selectedGrupo.etapa   && <span className="aur-badge aur-badge--blue">{selectedGrupo.etapa}</span>}
          {selectedBloques.length > 0 && (
            <span className="aur-badge aur-badge--green">
              <FiLayers size={13} />
              {selectedBloques.length} bloque(s)
            </span>
          )}
          {selectedGrupo.paqueteId && (() => {
            const grupoPkg = packages.find(p => p.id === selectedGrupo.paqueteId);
            const isArchivedPkg = !!(grupoPkg && grupoPkg.archivedAt);
            return (
              <span
                className={`aur-badge${isArchivedPkg ? ' aur-badge--archived' : ''}`}
                title={isArchivedPkg ? 'El paquete técnico asignado a este grupo está archivado.' : undefined}
              >
                <FiPackage size={13} />
                {getPackageName(selectedGrupo.paqueteId)}
                {isArchivedPkg && <span className="aur-badge-archived-tag">archivado</span>}
              </span>
            );
          })()}
          {selectedGrupo.paqueteMuestreoId && (
            <span className="aur-badge">
              <FiPackage size={13} />
              {getMonitoreoPackageName(selectedGrupo.paqueteMuestreoId)}
            </span>
          )}
          {selectedFechaCosecha && (
            <span className="aur-badge aur-badge--yellow">
              Cosecha est.: {formatDateLong(selectedFechaCosecha)}
            </span>
          )}
        </div>

        <div className="grupo-hub-bloques-header">
          <p className="grupo-hub-bloques-title">Bloques</p>
          {Object.values(bloqueColFilters).some(f => f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())) && (
            <button className="aur-btn-text" onClick={() => setBloqueColFilters({})}>
              <FiX size={11} /> Limpiar filtros
            </button>
          )}
        </div>
        {selectedBloques.length === 0 ? (
          <p className="empty-state">Este grupo no tiene bloques asignados.</p>
        ) : (
          <div className="aur-table-wrap">
            <table className="aur-table grupo-hub-table">
              <thead>
                <tr>
                  {!bloqueHiddenCols.has('loteNombre') && <BloqueSortTh {...sortThProps} field="loteNombre">Lote</BloqueSortTh>}
                  {!bloqueHiddenCols.has('bloque')     && <BloqueSortTh {...sortThProps} field="bloque">Bloque</BloqueSortTh>}
                  {!bloqueHiddenCols.has('ha')         && <BloqueSortTh {...sortThProps} field="ha" filterType="number">Ha.</BloqueSortTh>}
                  {!bloqueHiddenCols.has('plantas')    && <BloqueSortTh {...sortThProps} field="plantas" filterType="number">Plantas</BloqueSortTh>}
                  {!bloqueHiddenCols.has('material')   && <BloqueSortTh {...sortThProps} field="material">Material</BloqueSortTh>}
                  {!bloqueHiddenCols.has('kg')         && <BloqueSortTh {...sortThProps} field="kg" filterType="number">Kg Est.</BloqueSortTh>}
                  <th className="aur-th-col-menu">
                    <button
                      className={`aur-col-menu-trigger${bloqueHiddenCols.size > 0 ? ' is-active' : ''}`}
                      onClick={handleBloqueColBtnClick}
                      title="Personalizar columnas visibles"
                      aria-label="Personalizar columnas visibles"
                      aria-haspopup="menu"
                      aria-expanded={!!bloqueColMenu}
                    >
                      <FiSliders size={12} aria-hidden="true" />
                      {bloqueHiddenCols.size > 0 && <span className="aur-col-hidden-badge">{bloqueHiddenCols.size}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bloqueSorted.map(b => (
                  <tr key={b.id}>
                    {!bloqueHiddenCols.has('loteNombre') && <td>{b.loteNombre || '—'}</td>}
                    {!bloqueHiddenCols.has('bloque')     && <td>{b.bloque || '—'}</td>}
                    {!bloqueHiddenCols.has('ha')         && <td className="aur-td-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>}
                    {!bloqueHiddenCols.has('plantas')    && <td className="aur-td-num">{b.plantas?.toLocaleString() ?? '—'}</td>}
                    {!bloqueHiddenCols.has('material')   && <td>{b.material || '—'}</td>}
                    {!bloqueHiddenCols.has('kg')         && <td className="aur-td-num">{b.kg ? b.kg.toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>}
                    <td />
                  </tr>
                ))}
              </tbody>
              {bloqueSorted.length > 0 && (
                <tfoot>
                  <tr>
                    {!bloqueHiddenCols.has('loteNombre') && <td><strong>Totales</strong></td>}
                    {!bloqueHiddenCols.has('bloque')     && <td />}
                    {!bloqueHiddenCols.has('ha')         && <td className="aur-td-num"><strong>{filtTotalHa.toFixed(4)}</strong></td>}
                    {!bloqueHiddenCols.has('plantas')    && <td className="aur-td-num"><strong>{filtTotalPlantas.toLocaleString()}</strong></td>}
                    {!bloqueHiddenCols.has('material')   && <td />}
                    {!bloqueHiddenCols.has('kg')         && <td className="aur-td-num"><strong>{filtTotalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`grupo-page${selectedGrupo && !showForm ? ' grupo-page--selected' : ''}${showForm ? ' grupo-page--form' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

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
        />
      )}
      {confirmModal && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar "${confirmModal.grupoName}"?`}
          body="Al eliminar este grupo, sus bloques quedarán libres y podrán asignarse a otros grupos. Ten en cuenta que los registros históricos (cédulas de aplicación y actividades completadas) que hacen referencia a este grupo seguirán mostrando su nombre. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {deleteModal && (
        <div className="aur-modal-backdrop" onPointerDown={() => !deleting && setDeleteModal(null)}>
          <div
            className="aur-modal aur-modal--wide"
            onPointerDown={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="grupo-delete-modal-title"
          >
            {deleteModal.type === 'aplicada' ? (
              <>
                <header className="aur-modal-header">
                  <span className="aur-modal-icon aur-modal-icon--danger" aria-hidden="true">
                    <FiX size={18} />
                  </span>
                  <h2 className="aur-modal-title" id="grupo-delete-modal-title">No es posible eliminar este grupo</h2>
                </header>
                <div className="aur-modal-body">
                  <p>
                    El grupo <strong>"{deleteModal.grupoName}"</strong> tiene cédulas ya <strong>aplicadas en campo</strong>.
                    Estas forman parte del registro fitosanitario y no pueden eliminarse.
                  </p>
                  <p className="grupo-delete-modal__section-label">Cédulas aplicadas</p>
                  <ul className="grupo-delete-modal__list">
                    {deleteModal.cedulasAplicadas.map(c => (
                      <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
                    ))}
                  </ul>
                </div>
                <div className="aur-modal-actions">
                  <button className="aur-btn-pill" onClick={() => setDeleteModal(null)}>Entendido</button>
                </div>
              </>
            ) : (
              <>
                <header className="aur-modal-header">
                  <span className="aur-modal-icon aur-modal-icon--warn" aria-hidden="true">!</span>
                  <h2 className="aur-modal-title" id="grupo-delete-modal-title">Hay cédulas pendientes de resolución</h2>
                </header>
                <div className="aur-modal-body">
                  <p>
                    Las siguientes cédulas del grupo <strong>"{deleteModal.grupoName}"</strong> están en estado <strong>Mezcla lista</strong>.
                    Debes resolverlas antes de poder eliminar el grupo.
                  </p>
                  <p className="grupo-delete-modal__section-label">Cédulas en Mezcla lista</p>
                  <ul className="grupo-delete-modal__list">
                    {deleteModal.cedulasEnTransito.map(c => (
                      <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
                    ))}
                  </ul>
                  <p className="grupo-delete-modal__hint">
                    Puedes anularlas ahora (se revertirá el inventario descontado) o ir a Cédulas de Aplicación para marcarlas como aplicadas en campo.
                  </p>
                </div>
                <div className="aur-modal-actions">
                  <button className="aur-btn-text" onClick={() => setDeleteModal(null)} disabled={deleting}>
                    Cancelar
                  </button>
                  <button className="aur-btn-text" onClick={() => { setDeleteModal(null); navigate('/aplicaciones/cedulas'); }} disabled={deleting}>
                    Ir a Cédulas
                  </button>
                  <button className="aur-btn-pill aur-btn-pill--danger" onClick={handleAnularYEliminar} disabled={deleting}>
                    {deleting ? 'Anulando…' : 'Anular y eliminar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="grupo-page-loading" />}

      {/* ── Mobile sticky carousel ── */}
      {selectedGrupo && !showForm && (
        <div className="lote-carousel" ref={carouselRef} aria-label="Grupos">
          {grupos.map(grupo => {
            const isActive = selectedGrupo?.id === grupo.id;
            // Fallback defensivo: el backend valida nombreGrupo 1-16 chars
            // con Zod, pero docs pre-migración o ediciones manuales en
            // Firestore pueden quedar con null/undefined. Sin esto,
            // `.slice()` crashea la página entera al renderizar el avatar.
            const nombre = grupo.nombreGrupo || '?';
            return (
              <button
                key={grupo.id}
                className={`lote-bubble${isActive ? ' lote-bubble--active' : ''}`}
                onClick={() => isActive ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
                aria-pressed={isActive}
                aria-label={`Grupo ${nombre}${isActive ? ' (seleccionado, clic para cerrar)' : ''}`}
              >
                <span className="lote-bubble-avatar" aria-hidden="true">{nombre.slice(0, 4)}</span>
                <span className="lote-bubble-label">{nombre}</span>
              </button>
            );
          })}
          <button className="lote-bubble lote-bubble--add" onClick={handleNewGrupo} aria-label="Crear nuevo grupo">
            <span className="lote-bubble-avatar lote-bubble-avatar--add" aria-hidden="true">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Banner de error de carga (algún fetch inicial falló) ── */}
      {loadError && (
        <div className="grupo-load-error" role="alert">
          <FiAlertTriangle size={14} aria-hidden="true" />
          <span className="grupo-load-error-msg">{loadError}</span>
          <button
            type="button"
            className="grupo-load-error-retry"
            onClick={reloadAll}
            disabled={loading}
          >
            <FiRefreshCw size={12} aria-hidden="true" />
            {loading ? 'Cargando…' : 'Reintentar'}
          </button>
        </div>
      )}

      {/* ── Banner persistente: confirmación de guardado ──
          Visible tras un save exitoso hasta que el usuario lo cierre, haga
          clic en Abrir, o arranque otro flujo. Reemplaza al toast efímero
          por una señal estable con acceso directo al grupo recién guardado.
          Portado de LoteManagement.lote-save-banner. */}
      {!loading && lastSavedGrupo && (
        <div className="grupo-save-banner" role="status" aria-live="polite">
          <FiCheck size={14} aria-hidden="true" />
          <span className="grupo-save-banner-msg">
            Grupo <strong>"{lastSavedGrupo.label}"</strong>{' '}
            {lastSavedGrupo.action === 'created'
              ? (lastSavedGrupo.tasksGenerated ? 'creado y tareas programadas.' : 'creado.')
              : 'actualizado.'}
          </span>
          <button
            type="button"
            className="grupo-save-banner-action"
            onClick={() => {
              const grupo = grupos.find(g => g.id === lastSavedGrupo.id);
              setLastSavedGrupo(null);
              if (grupo) handleSelectGrupo(grupo);
            }}
          >
            Abrir →
          </button>
          <button
            type="button"
            className="grupo-save-banner-close"
            onClick={() => setLastSavedGrupo(null)}
            aria-label="Cerrar"
          >
            <FiX size={14} />
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      {!loading && !showForm && (
        <div className="lote-page-header">
          <div className="lote-page-title-block">
            <h2 className="lote-page-title">Grupos</h2>
            <p className="lote-page-hint">
              Organiza los bloques de siembra cerrados en grupos de producción para gestionar aplicaciones, cosechas y costos de producción.
            </p>
          </div>
          <button className="aur-btn-pill" onClick={handleNewGrupo}>
            <FiPlus size={14} /> Nuevo Grupo
          </button>
        </div>
      )}

      {!loading && <div className="lote-management-layout">

        {/* Hub o formulario */}
        {renderPanel()}

        {/* Lista compacta */}
        {!showForm && <div className="lote-list-panel">
          {grupos.length === 0 ? (
            // Si hubo error de carga no mostramos el empty-state — sería
            // falso, no sabemos si la finca está vacía o si la red murió.
            // El banner de arriba ya explica qué pasó y tiene Reintentar.
            loadError ? null : (
              <div className="grupo-cta">
                <div className="grupo-cta-icon"><FiPlus size={24} /></div>
                <p className="grupo-cta-title">Sin grupos creados</p>
              </div>
            )
          ) : (
            <ul className="lote-list">
              {grupos.map(grupo => (
                <li
                  key={grupo.id}
                  className={`lote-list-item${selectedGrupo?.id === grupo.id && !showForm ? ' active' : ''}`}
                  onClick={() => selectedGrupo?.id === grupo.id && !showForm ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
                >
                  <div className="lote-list-info">
                    <span className="lote-list-code">{grupo.nombreGrupo}</span>
                    {(grupo.cosecha || grupo.etapa) && (
                      <span className="lote-list-name">{[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              ))}
            </ul>
          )}
        </div>}

      </div>}

      {/* ── Preview modal (PDF / impresión) ── */}
      {previewGrupo && createPortal(
        <div className="gp-preview-backdrop">

          <div className="gp-preview-toolbar">
            <button className="aur-chip gp-toolbar-icon-btn" onClick={() => setPreviewGrupo(null)}>
              <FiArrowLeft size={15} /> <span className="gp-toolbar-btn-text">Volver</span>
            </button>
            <span className="gp-preview-toolbar-title">Grupo — {previewGrupo.nombreGrupo}</span>
            <div className="gp-preview-toolbar-actions">
              <button className="aur-chip gp-toolbar-icon-btn" onClick={handleCompartir}>
                <FiShare2 size={15} /> <span className="gp-toolbar-btn-text">Compartir</span>
              </button>
              <button className="aur-chip gp-toolbar-icon-btn" onClick={() => window.print()}>
                <FiPrinter size={15} /> <span className="gp-toolbar-btn-text">Imprimir</span>
              </button>
            </div>
          </div>

          <div className="gp-doc-wrap">
            <div className="gp-document" ref={docRef}>

                <div className="gp-doc-header">
                  <div className="gp-doc-brand">
                    {empresaConfig.logoUrl
                      ? <img src={empresaConfig.logoUrl} alt="Logo" className="gp-doc-logo-img" />
                      : <div className="gp-doc-logo">AU</div>}
                    <div className="gp-doc-brand-info">
                      <div className="gp-doc-brand-name">{empresaConfig.nombreEmpresa || 'Finca Aurora'}</div>
                      {empresaConfig.identificacion && <div className="gp-doc-brand-sub">Cédula: {empresaConfig.identificacion}</div>}
                      {empresaConfig.whatsapp       && <div className="gp-doc-brand-sub">Tel: {empresaConfig.whatsapp}</div>}
                      {empresaConfig.correo         && <div className="gp-doc-brand-sub">{empresaConfig.correo}</div>}
                      {empresaConfig.direccion      && <div className="gp-doc-brand-sub">{empresaConfig.direccion}</div>}
                    </div>
                  </div>
                  <div className="gp-doc-date">
                    Fecha: <strong>{formatDateLong(new Date())}</strong>
                  </div>
                </div>

                <hr className="gp-doc-divider" />

                <div className="gp-doc-grupo-info">
                  <div className="gp-doc-grupo-title">GRUPO: {previewGrupo.nombreGrupo}</div>
                  <div className="gp-doc-grupo-meta">
                    <span><strong>Fecha de creación:</strong> {formatDateLong(previewFechaCreacion)}</span>
                    <span><strong>Fecha estimada de cosecha:</strong> {previewFechaCosecha ? formatDateLong(previewFechaCosecha) : '—'}</span>
                    {(previewGrupo.cosecha || previewGrupo.etapa) && (
                      <span><strong>Cosecha / Etapa:</strong> {[previewGrupo.cosecha, previewGrupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                </div>

                <table className="gp-doc-table">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Bloque</th>
                      <th className="gp-col-num">Ha.</th>
                      <th className="gp-col-num">Plantas</th>
                      <th>Material</th>
                      <th className="gp-col-num">Kg Estimados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewBloques.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '12px', color: '#999' }}>Sin bloques</td></tr>
                    )}
                    {previewBloques.map(b => (
                      <tr key={b.id}>
                        <td>{b.loteNombre || '—'}</td>
                        <td>{b.bloque || '—'}</td>
                        <td className="gp-col-num">{b.areaCalculada ?? '—'}</td>
                        <td className="gp-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                        <td>{b.materialNombre || b.variedad || '—'}</td>
                        <td className="gp-col-num">{b.plantas ? (b.plantas * 1.6).toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {previewBloques.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Totales</strong></td>
                        <td className="gp-col-num"><strong>{pvTotalHa.toFixed(4)}</strong></td>
                        <td className="gp-col-num"><strong>{pvTotalPlantas.toLocaleString()}</strong></td>
                        <td></td>
                        <td className="gp-col-num"><strong>{pvTotalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                <div className="gp-doc-footer">
                  Documento generado por Sistema Aurora
                </div>
              </div>
            </div>
          </div>,
          document.body
      )}

      {/* ── Filter popover (tabla de bloques) ── */}
      {bloqueFilterPop && (
        bloqueFilterPop.filterType !== 'text' ? (
          <AuroraFilterPopover
            x={bloqueFilterPop.x}
            y={bloqueFilterPop.y}
            filterType={bloqueFilterPop.filterType}
            fromValue={bloqueColFilters[bloqueFilterPop.field]?.from || ''}
            toValue={bloqueColFilters[bloqueFilterPop.field]?.to || ''}
            onFromChange={(from) => setBloqueColFilter(bloqueFilterPop.field, { type: 'range', from, to: bloqueColFilters[bloqueFilterPop.field]?.to || '' })}
            onToChange={(to) => setBloqueColFilter(bloqueFilterPop.field, { type: 'range', from: bloqueColFilters[bloqueFilterPop.field]?.from || '', to })}
            onClear={() => setBloqueColFilter(bloqueFilterPop.field, null)}
            onClose={() => setBloqueFilterPop(null)}
          />
        ) : (
          <AuroraFilterPopover
            x={bloqueFilterPop.x}
            y={bloqueFilterPop.y}
            filterType="text"
            textValue={bloqueColFilters[bloqueFilterPop.field]?.value || ''}
            onTextChange={(value) => setBloqueColFilter(bloqueFilterPop.field, { type: 'text', value })}
            onClear={() => setBloqueColFilter(bloqueFilterPop.field, null)}
            onClose={() => setBloqueFilterPop(null)}
          />
        )
      )}

      {/* ── Column menu (tabla de bloques) ── */}
      {bloqueColMenu && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={() => setBloqueColMenu(null)} />
          <div className="aur-col-menu" style={{ left: bloqueColMenu.x, top: bloqueColMenu.y }}>
            <div className="aur-col-menu-title">Columnas visibles</div>
            {BLOQUE_COLS.map(col => (
              <label key={col.id} className="aur-col-menu-item">
                <input
                  type="checkbox"
                  checked={!bloqueHiddenCols.has(col.id)}
                  onChange={() => setBloqueHiddenCols(prev => {
                    const next = new Set(prev);
                    next.has(col.id) ? next.delete(col.id) : next.add(col.id);
                    return next;
                  })}
                />
                <span>{col.label}</span>
              </label>
            ))}
            {bloqueHiddenCols.size > 0 && (
              <button className="aur-col-menu-reset" onClick={() => { setBloqueHiddenCols(new Set()); setBloqueColMenu(null); }}>
                Mostrar todas
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export default GrupoManagement;
