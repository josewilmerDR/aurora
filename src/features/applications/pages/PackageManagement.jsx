import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import '../styles/packages.css';
import { FiPlus, FiX, FiSearch, FiChevronRight, FiChevronDown, FiArchive, FiCheck, FiFilter, FiInfo } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import PageHeader from '../../../components/PageHeader';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import FilterButton from '../../../components/ui/FilterButton';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';
import {
  calcularCosto,
  flattenActivityProducts,
  missingPriceTooltip,
  getPkgInitials,
  pickPkgAvatarStyle,
} from '../lib/packages-helpers';
import {
  loadPackageDraft,
  clearPackageDraft,
  isPackageDraftMeaningful,
} from '../lib/packages-draft';
import PackageHub from '../components/PackageHub';
import PackageForm from '../components/PackageForm';

// Helpers puros, draft persistence y diff viven en ../lib/packages-*.js
// (extracción Fases A+B del refactor para bajar el archivo bajo 600 LOC).

function PackageManagement() {
  const apiFetch = useApiFetch();
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [calibraciones, setCalibraciones] = useState([]);
  // Lotes/grupos completos: necesarios para el contador de uso del hub
  // ("aplicado en N lotes / M grupos"). Antes solo se consultaban on-demand
  // al archivar; ahora también se usan en el hub view, así que se cargan en
  // paralelo con el resto de catálogos.
  const [lotes, setLotes] = useState([]);
  const [grupos, setGrupos] = useState([]);
  // Estado del padre sobre el form: solo lo necesario para decidir qué mostrar
  // y cómo iniciarlo. El estado interno del form (formData, formErrors,
  // expandedActivities, etc.) vive en <PackageForm>.
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [formInitialData, setFormInitialData] = useState(null);
  // True cuando los datos iniciales vienen de un draft de localStorage —
  // habilita el banner "Borrador restaurado" dentro del form.
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // Espejo del isDirty del form: el padre lo usa para decidir si mostrar el
  // modal "¿Descartar cambios?" cuando se navega desde otros lugares (carrusel,
  // selección de paquete, etc.). Actualizado vía onDirtyChange del form.
  const [formIsDirty, setFormIsDirty] = useState(false);
  // Conteo de cambios del form (diff vs. snapshot original). Vive en el
  // padre porque el badge se renderiza en el header de la página, fuera del
  // <PackageForm>. El form lo notifica vía onChangesCountChange.
  const [formChangesCount, setFormChangesCount] = useState(0);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const carouselRef = useRef(null);

  const [hubExpandedActivities, setHubExpandedActivities] = useState(new Set());
  // Banner persistente de confirmación de guardado. Sustituye al toast
  // efímero para que el usuario tenga evidencia visual del save tras volver
  // a la lista. Se limpia al abrir cualquier form (Nuevo o Editar) y por
  // botón "Cerrar". Forma: { id, nombrePaquete, action: 'created'|'updated' } | null
  const [lastSavedPkg, setLastSavedPkg] = useState(null);
  const [pendingDeletePkg, setPendingDeletePkg] = useState(null);
  const [pkgDepsModal, setPkgDepsModal] = useState(null);
  const [pendingArchivePkg, setPendingArchivePkg] = useState(null); // { id, nombrePaquete, lotesCount, gruposCount }
  const [pendingNavAction, setPendingNavAction] = useState(null);

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

  // Catálogo de productos indexado por id — base para todos los cálculos de
  // costo. Sin este Map cada calcularCosto haría .find() O(n) por producto,
  // y la lista de paquetes corre N veces por render. Con 30+ paquetes y form
  // abierto eso era el cuello de botella del que habla el audit (punto 18).
  const productosById = useMemo(() => {
    const m = new Map();
    (productos || []).forEach(p => m.set(p.id, p));
    return m;
  }, [productos]);

  // Costo total por paquete, precomputado una sola vez. Lo consumen la lista
  // (call site 4) y el header del hub (call site 2) sin recalcular en cada
  // render del padre.
  const packageCostsById = useMemo(() => {
    const m = new Map();
    (packages || []).forEach(p => {
      m.set(p.id, calcularCosto(flattenActivityProducts(p.activities), productosById));
    });
    return m;
  }, [packages, productosById]);

  // Costos por actividad del paquete abierto en hub. El sort por día se hace
  // dentro del memo para que el índice coincida con el render.
  const selectedPkgActivityCosts = useMemo(() => {
    if (!selectedPkg?.activities) return [];
    return [...selectedPkg.activities]
      .sort((a, b) => Number(a.day) - Number(b.day))
      .map(act => calcularCosto(act.productos, productosById));
  }, [selectedPkg, productosById]);

  // Responsables elegibles para una ACTIVIDAD: empleados en planilla con
  // acceso al sistema. Cada actividad genera una tarea con notificación y
  // dueño asignado — debe ser alguien interno con cuenta activa, no un
  // asesor externo. El `tecnicoResponsable` del paquete (texto libre) es
  // independiente: ahí sí se permite cualquier nombre, ver sección Identidad.
  const eligibleResponsables = useMemo(
    () => users.filter(u => u.empleadoPlanilla === true && u.tieneAcceso === true),
    [users]
  );

  // Conteo de uso del paquete seleccionado para mostrar en hub-pills.
  // Solo cuenta lo que apunta directamente a `selectedPkg.id`; no expande
  // grupos→lotes (un lote heredando de un grupo no se duplica).
  const selectedPkgUsage = useMemo(() => {
    if (!selectedPkg?.id) return { lotes: 0, grupos: 0 };
    return {
      lotes: lotes.filter(l => l.paqueteId === selectedPkg.id).length,
      grupos: grupos.filter(g => g.paqueteId === selectedPkg.id).length,
    };
  }, [selectedPkg?.id, lotes, grupos]);

  const clearCategoryFilters = () => {
    setFilterTipoCosecha('');
    setFilterEtapaCultivo('');
  };
  const clearAllFilters = () => {
    setSearchQuery('');
    clearCategoryFilters();
  };

  const guardedNav = (action) => {
    if (formIsDirty) setPendingNavAction(() => action);
    else action();
  };

  // Centra la burbuja activa en el carousel cuando cambia el paquete seleccionado
  useEffect(() => {
    if (!isFormOpen || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.pkg-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedPkg?.id, formInitialData?.id, isFormOpen]);

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
    const lotesP = fetchSafe('/api/lotes',          'los lotes');
    const grpsP  = fetchSafe('/api/grupos',         'los grupos');

    // Aplicar resultados a medida que llegan. El .catch(() => {}) en cada
    // side-chain evita unhandled rejection — el reporte sale del allSettled.
    pkgsP.then(d => setPackages(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false));
    usrsP.then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});
    prodsP.then(d => setProductos(Array.isArray(d) ? d : [])).catch(() => {});
    tplsP.then(d => setPlantillas(Array.isArray(d) ? d : [])).catch(() => {});
    calsP.then(d => setCalibraciones(Array.isArray(d) ? d : [])).catch(() => {});
    lotesP.then(d => setLotes(Array.isArray(d) ? d : [])).catch(() => {});
    grpsP.then(d => setGrupos(Array.isArray(d) ? d : [])).catch(() => {});

    Promise.allSettled([pkgsP, usrsP, prodsP, tplsP, calsP, lotesP, grpsP]).then(results => {
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
  // El form gestiona su propio estado a partir de `formInitialData`.
  useEffect(() => {
    const draft = loadPackageDraft();
    if (!isPackageDraftMeaningful(draft)) {
      clearPackageDraft();
      return;
    }
    const activities = Array.isArray(draft.activities) ? draft.activities : [];
    setFormInitialData({
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
    setRestoredFromDraft(true);
  }, []);

  // Effects de autoguardado, atajo Ctrl+S, y handlers de edición/validación/
  // submit viven ahora en <PackageForm> (Fase F del refactor).

  // Abre el form en modo editar con los datos del paquete normalizados.
  // El form se encarga de su propio estado interno a partir de initialData.
  const handleEdit = (pkg) => {
    const normalizedActivities = (pkg.activities || [])
      .map(a => ({ type: 'notificacion', productos: [], ...a }))
      .sort((a, b) => Number(a.day) - Number(b.day));
    setFormInitialData({ ...pkg, activities: normalizedActivities });
    setRestoredFromDraft(false);
    setIsEditing(true);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setLastSavedPkg(null);
    window.scrollTo(0, 0);
  };

  // Cierra el form (unmount). Limpia draft porque salir del form es intención
  // de "no continuar este borrador". Para descartar tras un dirty-prompt,
  // mismo punto de entrada.
  const resetForm = () => {
    setIsFormOpen(false);
    setIsEditing(false);
    setSelectedPkg(null);
    setFormInitialData(null);
    setRestoredFromDraft(false);
    setFormIsDirty(false);
    clearPackageDraft();
  };

  // Abre el form en modo crear con una actividad vacía pre-cargada.
  const handleNew = () => {
    setFormInitialData({
      id: null,
      nombrePaquete: '',
      descripcion: '',
      tipoCosecha: '',
      etapaCultivo: '',
      tecnicoResponsable: '',
      activities: [{ day: '', name: '', responsableId: '', calibracionId: '', productos: [] }],
    });
    setRestoredFromDraft(false);
    setIsEditing(false);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setLastSavedPkg(null);
  };

  const handleSelectPkg = (pkg) => {
    setSelectedPkg(pkg);
    setIsEditing(false);
    setIsFormOpen(true);
    setFormInitialData(null);
    // Auto-expandir: si exactamente una actividad tiene detalles (productos o
    // calibración), abrimos su detalle al entrar al hub. Para múltiples
    // actividades con detalles dejamos todo colapsado y los chips inline
    // indican qué hay dentro de cada una. Si ninguna tiene detalles, no hay
    // nada que expandir.
    const sorted = [...(pkg.activities || [])].sort((a, b) => Number(a.day) - Number(b.day));
    const withDetailsIndices = [];
    sorted.forEach((a, i) => {
      const hasDetails = (a.productos?.length > 0) || !!calibraciones.find(c => c.id === a.calibracionId);
      if (hasDetails) withDetailsIndices.push(i);
    });
    setHubExpandedActivities(
      withDetailsIndices.length === 1 ? new Set(withDetailsIndices) : new Set()
    );
    setFormIsDirty(false);
    window.scrollTo(0, 0);
  };

  // Callback que el form invoca tras un POST/PUT exitoso. Refresca la lista
  // de paquetes, dispara el banner persistente y cierra el form (unmount).
  const handleSavePackage = async ({ savedId, savedName, savedAction }) => {
    const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
    setPackages(updatedPackages);
    resetForm();
    if (savedId) {
      setLastSavedPkg({ id: savedId, nombrePaquete: savedName, action: savedAction });
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
            setFormIsDirty(false);
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
                      {formChangesCount > 0 && (
                        <span
                          className="pkg-changes-badge"
                          title="Diferencias respecto a la versión guardada en el servidor"
                        >
                          {formChangesCount === 1 ? '1 cambio sin guardar' : `${formChangesCount} cambios sin guardar`}
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
                  className="pkg-header-filter-btn"
                  active={hasActiveCategoryFilter}
                  onClick={() => setMostrarFiltros(true)}
                />
              )}
              {(!isFormOpen || selectedPkg) && (
                <button
                  className="aur-btn-pill pkg-header-new-btn"
                  onClick={() => guardedNav(handleNew)}
                >
                  <FiPlus size={14} /> Nuevo Paquete
                </button>
              )}
            </>
          }
        />
      )}

      {/* ── Banner persistente: confirmación de guardado ──
          Visible tras un save exitoso hasta que el usuario lo cierre o
          inicie otro form. Reemplaza al toast efímero por una señal estable
          con acceso directo al paquete recién guardado. */}
      {!loading && lastSavedPkg && (
        <div className="pkg-save-banner" role="status" aria-live="polite">
          <FiCheck size={14} aria-hidden="true" />
          <span className="pkg-save-banner-msg">
            Paquete <strong>"{lastSavedPkg.nombrePaquete}"</strong>{' '}
            {lastSavedPkg.action === 'created' ? 'creado.' : 'actualizado.'}
          </span>
          <button
            type="button"
            className="pkg-save-banner-action"
            onClick={() => {
              const pkg = packages.find(p => p.id === lastSavedPkg.id);
              setLastSavedPkg(null);
              if (pkg) handleSelectPkg(pkg);
            }}
          >
            Abrir →
          </button>
          <button
            type="button"
            className="pkg-save-banner-close"
            onClick={() => setLastSavedPkg(null)}
            aria-label="Cerrar"
          >
            <FiX size={14} />
          </button>
        </div>
      )}

      {/* ── Mobile sticky carousel ── */}
      {!loading && packages.length > 0 && (
        <div className="pkg-carousel" ref={carouselRef}>
          {/* Carrusel mobile = solo activos. Archivados se acceden desde el
              panel de lista (visible en mobile cuando no hay paquete elegido). */}
          {filteredActivePackages.map(pkg => {
            const isActive = selectedPkg?.id === pkg.id || (isEditing && formInitialData?.id === pkg.id);
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
        <PackageForm
          mode={isEditing ? 'edit' : 'create'}
          initialData={formInitialData}
          restoredFromDraft={restoredFromDraft}
          users={users}
          productos={productos}
          productosById={productosById}
          calibraciones={calibraciones}
          plantillas={plantillas}
          eligibleResponsables={eligibleResponsables}
          apiFetch={apiFetch}
          onSave={handleSavePackage}
          onCancel={() => guardedNav(resetForm)}
          onDirtyChange={setFormIsDirty}
          onChangesCountChange={setFormChangesCount}
          onShowToast={showToast}
          onPlantillaCreated={(p) => setPlantillas(prev => [...prev, p])}
        />
      )}

      {isFormOpen && selectedPkg && (
        <PackageHub
          selectedPkg={selectedPkg}
          totalCost={packageCostsById.get(selectedPkg.id)}
          usage={selectedPkgUsage}
          users={users}
          calibraciones={calibraciones}
          productosById={productosById}
          expandedActivities={hubExpandedActivities}
          activityCosts={selectedPkgActivityCosts}
          onBack={resetForm}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onArchive={handleArchiveClick}
          onUnarchive={handleUnarchive}
          onDelete={handleDeleteClick}
          onToggleActivityExpand={(i) => setHubExpandedActivities(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
          })}
        />
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
              {/* Filtro inline solo en mobile — desktop conserva el del header.
                  Patrón search + filter contiguos resuelve la "isla" del header
                  cuando "+ Nuevo Paquete" se oculta en mobile (punto 21 audit). */}
              <FilterButton
                className="pkg-inline-filter-btn"
                active={hasActiveCategoryFilter}
                onClick={() => setMostrarFiltros(true)}
              />
            </div>
          )}
          {(() => {
            const renderItem = (pkg, isArchived) => {
              const itemActive = selectedPkg?.id === pkg.id || (isEditing && formInitialData?.id === pkg.id);
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
                      const costo = packageCostsById.get(pkg.id)
                        || { totals: [], hasMissingPrice: false, withoutPrice: 0 };
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
                            <span className="pkg-cost-warn" role="status">Costo incompleto</span>
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
