import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiPlusCircle, FiSearch, FiX, FiClipboard, FiCheck } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useToast } from '../../../contexts/ToastContext';
import { translateApiError } from '../../../lib/errorMessages';
import CedulaNuevaModal from '../components/CedulaNuevaModal';
import MezclaListaModal from '../components/MezclaListaModal';
import AplicadaModal from '../components/AplicadaModal';
import CedulaDocumento from '../components/CedulaDocumento';
import CedulaPreviewModal from '../components/CedulaPreviewModal';
import CedulaCard from '../components/CedulaCard';
import CedulaSplitCard from '../components/CedulaSplitCard';
import FiltroPeriodoModal from '../components/FiltroPeriodoModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import FilterButton from '../../../components/ui/FilterButton';
import HistorialButton from '../../../components/ui/HistorialButton';
import {
  formatShortDate,
  isOverdue,
  isManualTask,
  filterTasksByDateRange,
  computeTaskStatusFromCedulas,
} from '../lib/cedulas-helpers';
import { generateAndShareCedulaPdf } from '../lib/cedula-pdf';
import '../styles/cedulas.css';

// ─────────────────────────────────────────────────────────────────────────────
function CedulasAplicacion() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const toast = useToast();
  const [tasks,     setTasks]     = useState([]);
  const [lotes,     setLotes]     = useState([]);
  const [grupos,    setGrupos]    = useState([]);
  const [siembras,  setSiembras]  = useState([]);
  const [packages,  setPackages]  = useState([]);
  const [productos, setProductos] = useState([]);
  const [cedulas,   setCedulas]   = useState([]);
  const [config,        setConfig]        = useState({});
  const [calibraciones, setCalibraciones] = useState([]);
  const [maquinaria,    setMaquinaria]    = useState([]);
  // Directorio de usuarios para los pickers de operario/encargados/regente en
  // AplicadaModal. Usamos /api/users/lite (id+nombre+flags, sin PII) en vez
  // de /api/users porque trabajadores autenticados sin rol admin tampoco
  // deberían ver email/teléfono/rol del resto del staff solo para resolver
  // un autocomplete.
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [previewTask, setPreviewTask] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  // Búsqueda libre sobre el listing. Filtra por activityName, loteName,
  // responsableName y consecutivo de cualquier cédula activa de la task.
  // No se persiste — cada visita arranca limpio.
  const [searchQuery, setSearchQuery] = useState('');
  // Set de IDs de acciones en vuelo. Cada elemento es un cedulaId, o
  // `new-${taskId}` (generar cédula), o `skip-${taskId}` (omitir tarea).
  // Set en vez de string para no bloquear B mientras A está en proceso —
  // antes el botón de B seguía verde y los clicks eran no-op silenciosos
  // (punto #10 audit).
  const [actionLoading, setActionLoading] = useState(() => new Set());
  const addLoading = (id) => setActionLoading(prev => {
    const next = new Set(prev);
    next.add(id);
    return next;
  });
  const removeLoading = (id) => setActionLoading(prev => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
  const [showNuevaModal, setShowNuevaModal] = useState(false);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [aplicadaModal, setAplicadaModal] = useState(null); // cedulaId
  const [mezclaModal,   setMezclaModal]   = useState(null); // cedulaId
  // Banner persistente post-aplicada. Reemplaza un toast efímero: el usuario
  // recién marcó la cédula como aplicada en campo (gesto regulatorio, no
  // trivial) y la confirmación tiene que sobrevivir hasta que él la
  // descarte o navegue al historial. Pattern: GrupoManagement.lastSavedGrupo.
  // No se persiste — un reload limpia, igual que en siembra.
  const [lastAppliedCedula, setLastAppliedCedula] = useState(null);
  const [editModal,     setEditModal]     = useState(null); // { cedulaId }
  const [previewCedulaId, setPreviewCedulaId] = useState(null); // ID of cedula shown in preview modal
  const docRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const savedScrollRef   = useRef(0);
  const openedViaUrlRef  = useRef(false);

  // Highlight + scroll a la card recién creada: reemplaza el feedback "vuelve
  // la lista, ¿se creó o no?". El Set captura task IDs (no cedula IDs) porque
  // los split multi-lote comparten task. CSS animation de 3s + timeout de
  // cleanup en 3.5s para sacar el className del DOM tras la animación.
  const [highlightedTaskIds, setHighlightedTaskIds] = useState(() => new Set());
  const highlightTimerRef = useRef(null);
  const highlightAndScrollTo = (taskIds) => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setHighlightedTaskIds(new Set(taskIds));
    // rAF asegura que el DOM ya tiene el `data-task-id` actualizado cuando
    // buscamos el elemento — necesario tras un setCedulas/setTasks reciente.
    requestAnimationFrame(() => {
      const el = taskIds[0] && document.querySelector(`[data-task-id="${taskIds[0]}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedTaskIds(new Set());
      highlightTimerRef.current = null;
    }, 3500);
  };
  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  useEffect(() => {
    // Carga inicial separada en críticos (tasks + cédulas → manejan la lista)
    // y secundarios (catálogos que solo alimentan el preview y los modales).
    //
    // 1. fetchSafe normaliza el rechazo con {body, label} para que
    //    translateApiError dé el mensaje específico cuando hay UNA sola falla
    //    (UNAUTHORIZED, INSUFFICIENT_ROLE, etc.).
    // 2. El spinner se suelta apenas resuelvan tasks + cédulas. Los catálogos
    //    siguen cargando en background — el preview y los modales degradan
    //    a "—" hasta que cada respectivo catálogo llegue; mejor que un spinner
    //    indefinido si /api/maquinaria está lento.
    // 3. Promise.allSettled coalesce las fallas en un único toast — el stack
    //    de toasts es MAX_VISIBLE=4 y apilar 10 mensajes perdería contexto.
    const fetchSafe = (url, label) =>
      apiFetch(url).then(async r => {
        if (!r.ok) throw { body: await r.json().catch(() => ({})), label };
        return r.json();
      });

    const tasksP = fetchSafe('/api/tasks',         'las tareas');
    const cedsP  = fetchSafe('/api/cedulas',       'las cédulas');
    const lotesP = fetchSafe('/api/lotes',         'los lotes');
    const grpsP  = fetchSafe('/api/grupos',        'los grupos');
    const siemP  = fetchSafe('/api/siembras',      'las siembras');
    const pkgsP  = fetchSafe('/api/packages',      'los paquetes');
    const prodsP = fetchSafe('/api/productos',     'los productos');
    const cfgP   = fetchSafe('/api/config',        'la configuración');
    const calsP  = fetchSafe('/api/calibraciones', 'las calibraciones');
    const maqP   = fetchSafe('/api/maquinaria',    'la maquinaria');
    const usrsP  = fetchSafe('/api/users/lite',    'el directorio de usuarios');

    // Aplicar resultados a medida que llegan. .catch(() => {}) en cada
    // side-chain evita unhandled rejection; el reporte sale del allSettled.
    tasksP.then(d => setTasks(Array.isArray(d) ? d : [])).catch(() => {});
    cedsP .then(d => setCedulas(Array.isArray(d) ? d : [])).catch(() => {});
    lotesP.then(d => setLotes(Array.isArray(d) ? d : [])).catch(() => {});
    grpsP .then(d => setGrupos(Array.isArray(d) ? d : [])).catch(() => {});
    siemP .then(d => setSiembras(Array.isArray(d) ? d : [])).catch(() => {});
    pkgsP .then(d => setPackages(Array.isArray(d) ? d : [])).catch(() => {});
    prodsP.then(d => setProductos(Array.isArray(d) ? d : [])).catch(() => {});
    cfgP  .then(d => setConfig(d || {})).catch(() => {});
    calsP .then(d => setCalibraciones(Array.isArray(d) ? d : [])).catch(() => {});
    maqP  .then(d => setMaquinaria(Array.isArray(d) ? d : [])).catch(() => {});
    usrsP .then(d => setUsers(Array.isArray(d) ? d : [])).catch(() => {});

    // allSettled, no Promise.all: si tasks o cédulas fallan, la página igual
    // debe renderizarse (mostrando el toast + EmptyState) en vez de quedar
    // colgada en el spinner indefinidamente.
    Promise.allSettled([tasksP, cedsP]).then(() => setLoading(false));

    Promise.allSettled([tasksP, cedsP, lotesP, grpsP, siemP, pkgsP, prodsP, cfgP, calsP, maqP, usrsP])
      .then(results => {
        const failed = results.filter(r => r.status === 'rejected').map(r => r.reason);
        if (failed.length === 0) return;
        if (failed.length === 1) {
          const { body, label } = failed[0] || {};
          toast.error(translateApiError(body, `No se pudieron cargar ${label}.`));
          return;
        }
        const labels = failed.map(f => f?.label).filter(Boolean).join(', ');
        toast.error(`No se pudieron cargar: ${labels}. Revisa tu conexión y recarga.`);
      });
  }, []);

  // ── Índices id → entidad para reemplazar .find() O(N) por .get() O(1) ─────
  // El listing + el preview ejecutan muchos lookups por render (≈ 50 cédulas
  // × 5 productos = 250 .find() solo para periodoReingreso/ACosecha). En
  // mobile con CPU lenta cada keystroke en un modal hijo dispara re-render
  // del orquestador y se siente. Patrón: mismo Map<id, entity> que
  // packagesById en PackageManagement (punto 18 de su audit).
  //
  // Declarados ANTES de los useEffects que los consumen (auto-open lee
  // tasksById en su body y deps array). El deps array se evalúa durante
  // render, y un tasksById declarado más abajo dispara ReferenceError
  // por TDZ. Ordering matters.
  const productosById     = useMemo(() => new Map((productos     || []).map(p => [p.id, p])), [productos]);
  const lotesById         = useMemo(() => new Map((lotes         || []).map(l => [l.id, l])), [lotes]);
  const gruposById        = useMemo(() => new Map((grupos        || []).map(g => [g.id, g])), [grupos]);
  const packagesById      = useMemo(() => new Map((packages      || []).map(p => [p.id, p])), [packages]);
  const siembrasById      = useMemo(() => new Map((siembras      || []).map(s => [s.id, s])), [siembras]);
  const calibracionesById = useMemo(() => new Map((calibraciones || []).map(c => [c.id, c])), [calibraciones]);
  const maquinariaById    = useMemo(() => new Map((maquinaria    || []).map(m => [m.id, m])), [maquinaria]);
  const tasksById         = useMemo(() => new Map((tasks         || []).map(t => [t.id, t])), [tasks]);
  const cedulasById       = useMemo(() => new Map((cedulas       || []).map(c => [c.id, c])), [cedulas]);

  // Open CedulaNuevaModal if navigated from HistorialAplicaciones empty state
  useEffect(() => {
    if (location.state?.openModal) setShowNuevaModal(true);
  }, []);

  // Auto-open cedula from query param ?open=taskId
  useEffect(() => {
    if (!tasks.length) return;
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (openId) {
      const task = tasksById.get(openId);
      if (task) { openedViaUrlRef.current = true; setPreviewTask(task); }
    }
  }, [tasks, tasksById, location.search]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const aplicacionTasks = useMemo(() =>
    tasks
      .filter(t =>
        (t.activity?.type === 'aplicacion' || (t.activity?.productos?.length > 0 && t.type !== 'SOLICITUD_COMPRA')) &&
        t.status !== 'completed_by_user' &&
        t.status !== 'skipped' &&
        t.type !== 'REMINDER_3_DAY'
      )
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    [tasks]
  );

  // taskId → cedula[] (array, since a task can have multiple split cedulas)
  // Exclude voided cedulas so they don't block regeneration or appear as active
  const cedulasByTaskId = useMemo(() => {
    const map = {};
    for (const c of cedulas) {
      if (c.status === 'anulada') continue;
      if (!map[c.taskId]) map[c.taskId] = [];
      map[c.taskId].push(c);
    }
    return map;
  }, [cedulas]);

  // Tasks que matchean SOLO el filtro de fecha (sin search). Lo consume:
  // (1) visibleTasks como input para aplicar después search + sort;
  // (2) FiltroPeriodoModal como contador live "X cédulas en el periodo".
  // Separar el step de fecha lo hace reutilizable y mantiene una sola
  // fuente de verdad del cálculo (antes inline en visibleTasks). Punto
  // #17 audit.
  const tasksByDateRange = useMemo(
    () => filterTasksByDateRange(aplicacionTasks, dateFrom, dateTo),
    [aplicacionTasks, dateFrom, dateTo]
  );

  const visibleTasks = useMemo(() => {
    // Filtrado por texto sobre actividad/lote/responsable/consecutivo. Case
    // insensitive con .includes — sin normalización de acentos para no romper
    // matches exactos en español (si llega a ser un problema real, usar
    // normalize('NFD').replace(/\p{Diacritic}/gu, '') en ambos lados).
    let filtered = tasksByDateRange;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(t => {
        if ((t.activityName    || '').toLowerCase().includes(q)) return true;
        if ((t.loteName        || '').toLowerCase().includes(q)) return true;
        if ((t.responsableName || '').toLowerCase().includes(q)) return true;
        const taskCedulas = cedulasByTaskId[t.id] || [];
        return taskCedulas.some(c => (c.consecutivo || '').toLowerCase().includes(q));
      });
    }
    // Sort: manual cedulas ("additional") first, then system ones.
    // Dentro de cada grupo se preserva el orden por dueDate ascendente heredado de aplicacionTasks.
    return [...filtered].sort((a, b) => {
      const am = isManualTask(a) ? 0 : 1;
      const bm = isManualTask(b) ? 0 : 1;
      if (am !== bm) return am - bm;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }, [tasksByDateRange, searchQuery, cedulasByTaskId]);

  const getSource = (task) => {
    if (task.loteId)  return lotesById.get(task.loteId)   || null;
    if (task.grupoId) return gruposById.get(task.grupoId) || null;
    return null;
  };

  const getPackageName = (paqueteId) =>
    packagesById.get(paqueteId)?.nombrePaquete || null;

  // useCallback estabiliza la referencia para que <CedulaDocumento> pueda
  // memoizar sus reducciones sobre previewProductos (punto #23 audit) sin
  // que el callback recreado a cada render le invalide el memo.
  const getProductoCatalog = useCallback(
    (productoId) => productosById.get(productoId) || null,
    [productosById]
  );

  // ── Computed preview data ─────────────────────────────────────────────────
  // The specific cedula shown in the preview (set on "Ver Cédula" click)
  const previewCedula = previewCedulaId ? (cedulasById.get(previewCedulaId) || null) : null;
  const activeCedula = previewCedula || (previewTask ? (cedulasByTaskId[previewTask.id]?.[0] || null) : null);

  // previewSource memoizado: el cálculo inline previo era "estable por
  // accidente" — lotesById/gruposById están memoizados y .get() devuelve
  // siempre el mismo object reference. Pero la útilidad real del memo es
  // documental: que un futuro refactor no rompa la estabilidad referencial
  // sin aviso (p.ej. si alguien cambia `lotesById` a un object literal
  // recreado cada render). previewBloques abajo depende de previewSource,
  // así que cualquier inestabilidad upstream invalida ese memo también.
  // Punto #20 audit.
  const previewSource = useMemo(
    () => (previewTask ? getSource(previewTask) : null),
    [previewTask, lotesById, gruposById]
  );
  const previewPkg = useMemo(
    () => (previewSource?.paqueteId ? (packagesById.get(previewSource.paqueteId) || null) : null),
    [previewSource, packagesById]
  );
  const previewPackageName = previewPkg?.nombrePaquete || null;
  const previewTecnicoResponsable = previewTask?.isDraft
    ? (previewTask.tecnicoResponsable || previewPkg?.tecnicoResponsable || null)
    : (previewPkg?.tecnicoResponsable || null);
  // Product source for the print preview: if the cedula already recorded
  // applied products (with possible substitutions/adjustments in mezcla-lista),
  // those are the ones that should be printed. Otherwise, fall back to the task plan
  // (old cedulas or still in "pending" status).
  const previewProductos = (
    (Array.isArray(activeCedula?.productosAplicados) && activeCedula.productosAplicados.length > 0)
      ? activeCedula.productosAplicados
      : (Array.isArray(activeCedula?.snap_productos) && activeCedula.snap_productos.length > 0)
        ? activeCedula.snap_productos
        : (previewTask?.activity?.productos || [])
  );

  const previewBloques = useMemo(() => {
    // For split cedulas: use only this lote's blocks
    if (previewCedula?.splitBloqueIds?.length > 0) {
      return previewCedula.splitBloqueIds
        .map(id => siembrasById.get(id))
        .filter(Boolean);
    }
    // For manual cedulas, use task-level bloques (subset); otherwise use source bloques
    const bloqueIds = previewTask?.bloques || previewSource?.bloques;
    if (!bloqueIds) return [];
    return bloqueIds
      .map(id => siembrasById.get(id))
      .filter(Boolean);
  }, [previewSource, siembrasById, previewCedula, previewTask]);

  const pvTotalHa = previewBloques.reduce(
    (s, b) => s + (parseFloat(b.areaCalculada) || 0), 0
  );

  // Calibration: from the task's activity, with fallback to the current package activity
  const previewCal = (() => {
    // 1. calibracionId guardado directamente en la actividad de la tarea
    const calId = previewTask?.activity?.calibracionId
      // 2. fallback: buscar la actividad equivalente en el paquete actual
      || (() => {
        if (!previewSource?.paqueteId || !previewTask) return null;
        const pkg = packagesById.get(previewSource.paqueteId);
        if (!pkg) return null;
        const actName = previewTask.activityName || previewTask.activity?.name;
        const actDay  = previewTask.activity?.day;
        const pkgAct  = pkg.activities?.find(a =>
          (actName && a.name === actName) || (actDay != null && String(a.day) === String(actDay))
        );
        return pkgAct?.calibracionId || null;
      })();
    return calId ? (calibracionesById.get(calId) || null) : null;
  })();
  const previewCalAplicador = previewCal?.aplicadorId
    ? (maquinariaById.get(previewCal.aplicadorId) || null)
    : null;
  const previewCalTractor = previewCal?.tractorId
    ? (maquinariaById.get(previewCal.tractorId) || null)
    : null;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleGenerarCedula = async (taskId) => {
    const loadingId = `new-${taskId}`;
    addLoading(loadingId);
    try {
      const res = await apiFetch('/api/cedulas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.cedulas) {
          // Cédulas ya existen en DB pero el cliente las desconocía (caché
          // stale). Las inyectamos en estado y avisamos al usuario que el
          // botón "produjo" algo aunque técnicamente fue una sync, no una
          // creación — sin esto la fila "magicamente" cambia y vuelve la
          // duda "¿qué hizo el botón?".
          setCedulas(prev => {
            const existingIds = new Set(prev.map(c => c.id));
            const newOnes = data.cedulas.filter(c => !existingIds.has(c.id));
            return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
          });
          if (data.cedulas.length > 0) {
            toast.info('La cédula ya existía. Sincronizada con tu vista.');
            highlightAndScrollTo([taskId]);
          }
        } else {
          // translateApiError mapea el `code` del body al string en español del
          // diccionario; si el body no trae code (errores legacy), cae al fallback.
          // Antes mostrábamos `data.message` en crudo (inglés + a veces detalles internos).
          toast.error(translateApiError(data, 'Error al generar la cédula.'));
        }
        return;
      }
      // Response is either a single cedula object or an array (multi-lote split)
      const newCedulas = Array.isArray(data) ? data : [data];
      setCedulas(prev => [...prev, ...newCedulas]);
      // Acuse explícito: si fue split multi-lote, listamos cuántas se
      // crearon para que el usuario sepa que es 1 task → N cédulas.
      const consecutivos = newCedulas.map(c => c.consecutivo).filter(Boolean);
      toast.success(
        newCedulas.length === 1
          ? `Cédula ${consecutivos[0] || 'creada'}.`
          : `${newCedulas.length} cédulas creadas (${consecutivos.join(', ')}).`
      );
      highlightAndScrollTo([taskId]);
    } finally {
      removeLoading(loadingId);
    }
  };

  const showError = (msg) => setConfirmModal({
    title: 'Error',
    body: msg,
    confirmLabel: 'Entendido',
    showCancel: false,
    onConfirm: () => setConfirmModal(null),
  });

  const handleMezclaLista = (cedulaId) => {
    setMezclaModal({ cedulaId });
  };

  const submitMezclaLista = async (cedulaId, payload) => {
    addLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/mezcla-lista`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // translateApiError sobre el body permite que el modal muestre el
        // mensaje localizado inline en vez del data.message en inglés crudo.
        throw new Error(translateApiError(data, 'Error al actualizar la cédula.'));
      }
      setCedulas(prev => prev.map(c =>
        c.id === cedulaId
          ? {
              ...c,
              status: 'en_transito',
              // Prefer server timestamp (data.mezclaListaAt) for consistency
              // with what was actually written to Firestore; fall back to local.
              mezclaListaAt: data.mezclaListaAt || new Date().toISOString(),
              mezclaListaNombre: data.mezclaListaNombre ?? payload.nombre ?? c.mezclaListaNombre ?? null,
              ...(data.productosAplicados ? { productosAplicados: data.productosAplicados } : {}),
              ...(data.huboCambios !== undefined ? { huboCambios: data.huboCambios } : {}),
              ...(data.observacionesMezcla !== undefined ? { observacionesMezcla: data.observacionesMezcla } : {}),
              ...(data.modificadaEnMezclaAt ? { modificadaEnMezclaAt: data.modificadaEnMezclaAt } : {}),
              ...(data.modificadaEnMezclaPor ? { modificadaEnMezclaPor: data.modificadaEnMezclaPor } : {}),
            }
          : c
      ));
      setMezclaModal(null);
    } catch (e) {
      // Re-throw para que el modal muestre el error inline en vez de cerrarse
      throw e;
    } finally {
      removeLoading(cedulaId);
    }
  };

  const handleEditarProductos = (cedulaId) => {
    setEditModal({ cedulaId });
  };

  const submitEdicionProductos = async (cedulaId, payload) => {
    addLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/editar-productos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(translateApiError(data, 'Error al editar la cédula.'));
      }
      setCedulas(prev => prev.map(c =>
        c.id === cedulaId
          ? {
              ...c,
              ...(data.productosAplicados ? { productosAplicados: data.productosAplicados } : {}),
              ...(data.huboCambios !== undefined ? { huboCambios: data.huboCambios } : {}),
              ...(data.editadaAt        ? { editadaAt:        data.editadaAt }        : {}),
              ...(data.editadaPor       ? { editadaPor:       data.editadaPor }       : {}),
              ...(data.editadaPorNombre !== undefined ? { editadaPorNombre: data.editadaPorNombre } : {}),
              ...(data.observacionesMezcla !== undefined ? { observacionesMezcla: data.observacionesMezcla } : {}),
            }
          : c
      ));
      setEditModal(null);
    } catch (e) {
      // Re-throw para que el modal muestre el error inline en vez de cerrarse
      throw e;
    } finally {
      removeLoading(cedulaId);
    }
  };

  const handleAplicada = (cedulaId) => {
    const cedula = cedulasById.get(cedulaId);
    const task   = tasksById.get(cedula?.taskId);
    const source = task ? getSource(task) : null;
    const pkg    = source?.paqueteId ? packagesById.get(source.paqueteId) : null;
    // Resolver calibracionId: desde la tarea o desde la actividad del paquete
    let calId = task?.activity?.calibracionId;
    if (!calId && pkg) {
      const actName = task?.activityName || task?.activity?.name;
      const actDay  = task?.activity?.day;
      const pkgAct  = pkg.activities?.find(a =>
        (actName && a.name === actName) || (actDay != null && String(a.day) === String(actDay))
      );
      calId = pkgAct?.calibracionId || null;
    }
    const cal = calId ? calibracionesById.get(calId) : null;
    setAplicadaModal({
      cedulaId,
      metodoAplicacion: cal?.metodo           || '',
      encargadoFinca:   config?.administrador  || '',
      encargadoBodega:  cedula?.mezclaListaNombre || '',
      supAplicaciones:  pkg?.tecnicoResponsable || cedula?.tecnicoResponsable || '',
    });
  };

  const submitAplicada = async (cedulaId, data) => {
    addLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/aplicada`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        // Re-throw para que el modal muestre el error inline en vez de
        // cerrarse perdiendo los 10+ campos que el operador llenó a mano
        // (operario, encargados, horas, condiciones). Antes el handler
        // cerraba el modal al inicio y usaba showError, así que un 409
        // por race o un 429 forzaba a re-tipear todo. Simétrico con
        // submitMezclaLista de esta misma página y con CedulaViewer. M4
        // audit (extendido al listing en tanda 4).
        const err = await res.json().catch(() => ({}));
        throw new Error(translateApiError(err, 'Error al registrar la aplicación.'));
      }
      const taskId = cedulasById.get(cedulaId)?.taskId;
      // Functional updater + selector puro: el siblings.every() del
      // antes leía `cedulas` por closure (stale antes del setCedulas),
      // y solo funcionaba "por casualidad" porque el filtro excluía a la
      // recién actualizada. Si en el futuro aparece un status no terminal
      // ('en_revision'), o si llegan dos updates en paralelo, el sync de
      // tasks rompía sin aviso. Punto #19 audit.
      setCedulas(prev => {
        const next = prev.map(c =>
          c.id === cedulaId
            ? { ...c, status: 'aplicada_en_campo', aplicadaAt: new Date().toISOString(), ...data }
            : c
        );
        if (taskId) {
          const newStatus = computeTaskStatusFromCedulas(next, taskId);
          if (newStatus !== 'pending') {
            setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
          }
        }
        return next;
      });
      const cedula = cedulasById.get(cedulaId);
      setLastAppliedCedula({
        id: cedulaId,
        consecutivo: cedula?.consecutivo || null,
      });
      setAplicadaModal(null);
    } finally { removeLoading(cedulaId); }
  };

  const handleAnular = (cedulaId) => {
    const cedula = cedulasById.get(cedulaId);
    const enTransito = cedula?.status === 'en_transito';

    // Para cédulas en_transito: listar productos y cantidad que se restaurará
    // al stock. Antes el body decía solo "el inventario será restaurado
    // automáticamente" sin detalle — el regente confirmaba a ciegas y a
    // veces prefería editar dosis a anular. Punto #24 audit.
    //
    // Hectáreas usadas para el cálculo: sum de splitBloqueIds si la cédula
    // es split; si no, sum de bloques de la task (o del source); fallback
    // al loteHectareas de enrichTask. Mismo orden que el `previewBloques`
    // del documento, así los números matchean lo que el usuario ve en el
    // preview.
    const sumBloques = (ids) => (ids || []).reduce(
      (s, id) => s + (parseFloat(siembrasById.get(id)?.areaCalculada) || 0),
      0
    );
    let hectareas = 0;
    if (enTransito) {
      if (Array.isArray(cedula?.splitBloqueIds) && cedula.splitBloqueIds.length > 0) {
        hectareas = sumBloques(cedula.splitBloqueIds);
      }
      if (hectareas === 0) {
        const task = tasksById.get(cedula?.taskId);
        const source = task?.loteId
          ? lotesById.get(task.loteId)
          : task?.grupoId
            ? gruposById.get(task.grupoId)
            : null;
        const bloqueIds = task?.bloques || source?.bloques;
        if (Array.isArray(bloqueIds) && bloqueIds.length > 0) {
          hectareas = sumBloques(bloqueIds);
        }
        if (hectareas === 0) {
          hectareas = parseFloat(task?.loteHectareas) || 0;
        }
      }
    }

    const aplicados = enTransito && Array.isArray(cedula?.productosAplicados)
      ? cedula.productosAplicados
      : [];

    const body = enTransito
      ? (aplicados.length > 0
          ? 'La mezcla ya fue preparada. Al anular se restaurarán al stock:'
          : '¿Anular esta cédula? La mezcla ya fue preparada — el inventario será restaurado automáticamente.')
      : '¿Anular esta cédula? La tarea asociada quedará como omitida.';

    const children = (enTransito && aplicados.length > 0) ? (
      <ul className="ca-anular-prod-list">
        {aplicados.map((p, i) => {
          const info       = productosById.get(p.productoId);
          const cantPorHa  = parseFloat(p.cantidadPorHa);
          const unidad     = info?.unidad || '';
          const nombre     = info?.nombreComercial || p.productoOriginalId || '—';
          const hasTotal   = Number.isFinite(cantPorHa) && cantPorHa > 0 && hectareas > 0;
          const total      = hasTotal ? (cantPorHa * hectareas) : null;
          return (
            <li key={p.productoId || i} className="ca-anular-prod-row">
              <span className="ca-anular-prod-name">{nombre}</span>
              <span className="ca-anular-prod-amount">
                {hasTotal
                  ? <><strong>+{total.toFixed(2)} {unidad}</strong> <span className="ca-anular-prod-rate">({cantPorHa} {unidad}/ha × {hectareas.toFixed(1)} ha)</span></>
                  : <em className="ca-anular-prod-rate">cantidad por confirmar</em>}
              </span>
            </li>
          );
        })}
      </ul>
    ) : null;

    setConfirmModal({
      title: 'Anular cédula',
      body,
      children,
      confirmLabel: 'Anular',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        addLoading(cedulaId);
        try {
          const res = await apiFetch(`/api/cedulas/${cedulaId}/anular`, { method: 'PUT' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showError(translateApiError(err, 'Error al anular la cédula.'));
            return;
          }
          const taskId = cedulasById.get(cedulaId)?.taskId;
          // Functional updater + selector puro: el cálculo de allInactive/
          // anyApplied antes leía `cedulas` por closure (stale). Idéntica
          // sintomatología que submitAplicada. Punto #19 audit.
          setCedulas(prev => {
            const next = prev.map(c => c.id === cedulaId ? { ...c, status: 'anulada' } : c);
            if (taskId) {
              const newStatus = computeTaskStatusFromCedulas(next, taskId);
              if (newStatus !== 'pending') {
                setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
              }
            }
            return next;
          });
          window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
        } finally { removeLoading(cedulaId); }
      },
    });
  };

  const handleOmitirTarea = (taskId) => {
    setConfirmModal({
      title: 'Omitir tarea',
      body: '¿Omitir esta tarea vencida? No se generará cédula de aplicación.',
      confirmLabel: 'Omitir',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        const loadingId = `skip-${taskId}`;
        addLoading(loadingId);
        try {
          const res = await apiFetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'skipped' }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showError(translateApiError(err, 'Error al omitir la tarea.'));
            return;
          }
          setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'skipped' } : t));
          window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
        } finally { removeLoading(loadingId); }
      },
    });
  };

  const handleNuevaCedulaSuccess = (cedula, task) => {
    setCedulas(prev => [...prev, cedula]);
    setTasks(prev => [...prev, task]);
    setShowNuevaModal(false);
    toast.success(`Cédula ${cedula.consecutivo || 'creada'}.`);
    if (task?.id) highlightAndScrollTo([task.id]);
  };

  const handlePreviewDraft = (formData) => {
    const lote = lotesById.get(formData.loteId) || null;
    const draftTask = {
      id: 'draft',
      isDraft: true,
      activityName: formData.activityName || 'Borrador',
      dueDate: formData.fecha,
      loteId: formData.loteId || null,
      loteHectareas: lote?.hectareas ?? null,
      loteName: lote?.nombreLote ?? null,
      tecnicoResponsable: formData.tecnicoResponsable || null,
      bloques: formData.selectedBloques || [],
      activity: {
        productos: formData.productos || [],
        calibracionId: formData.calibracionId || null,
      },
    };
    openedViaUrlRef.current = false;
    savedScrollRef.current = window.scrollY;
    setPreviewTask(draftTask);
    setPreviewCedulaId(null);
  };

  const handlePrint = () => {
    // body.ca-printing oculta #root via @media print, dejando solo el
    // portal del preview en el snapshot impreso. La limpieza va detrás de
    // `afterprint` porque `window.print()` no es síncrono en todos los
    // browsers (Firefox / Safari mobile pueden devolver antes de capturar
    // el DOM, y un `remove` inmediato re-mostraba la chrome en el output).
    document.body.classList.add('ca-printing');
    const cleanup = () => {
      document.body.classList.remove('ca-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  // ── Cerrar viewer (back-aware) ────────────────────────────────────────────
  const handleCloseViewer = () => {
    const viaUrl = openedViaUrlRef.current;
    const scroll = savedScrollRef.current;
    const taskId = previewTask?.id;
    setPreviewTask(null);
    setPreviewCedulaId(null);
    openedViaUrlRef.current = false;
    if (viaUrl) {
      // Vino por ?open=taskId (notificación push o link compartido). En vez
      // de navigate(-1) — que saca al usuario de la página entera, perdiendo
      // el contexto del listing al que llegó — limpiamos el query param y
      // dejamos al usuario en el listing con la card destacada por unos
      // segundos. Patrón típico de retorno desde detail-view. Punto #29 audit.
      const params = new URLSearchParams(location.search);
      params.delete('open');
      const newSearch = params.toString();
      navigate(
        { pathname: location.pathname, search: newSearch ? `?${newSearch}` : '' },
        { replace: true }
      );
      if (taskId) highlightAndScrollTo([taskId]);
    } else {
      requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: 'instant' }));
    }
  };

  // ── PDF share ─────────────────────────────────────────────────────────────
  // Lógica de render → PDF → share vive en lib/cedula-pdf.js (compartido con
  // CedulaViewer). El listing loggea en consola en falla porque el operador
  // suele estar en desktop con devtools — útil para soporte.
  const handleShare = async () => {
    if (!docRef.current || !previewTask) return;
    try {
      await generateAndShareCedulaPdf({
        node: docRef.current,
        filenameRaw: previewTask.activityName || previewTask.id,
      });
    } catch (err) {
      console.error('[handleShare] failed to generate/share PDF:', err);
      toast.error('No se pudo generar el PDF. Probá Imprimir desde el navegador.');
    }
  };

  // ── Row renderer (shared between overdue panel and main list) ────────────
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="ca-page">
      {/* ── Spinner de carga ── */}
      {loading && <div className="cedulas-page-loading" />}

      {/* ── Contenido principal ── */}
      {!loading && (
        <div className="aur-sheet">
          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h2 className="aur-sheet-title">Cédulas de aplicación</h2>
              <p className="aur-sheet-subtitle">Aquí están las cédulas (u órdenes) de aplicación pendientes para tus cultivos, según los Paquetes de aplicaciones definidos. También puedes crear nuevas cédulas o modificar las existentes.</p>
            </div>
            <div className="aur-sheet-header-actions">
              <FilterButton
                active={!!(dateFrom || dateTo)}
                onClick={() => setMostrarFiltros(true)}
              />
              <HistorialButton to="/aplicaciones/historial" />
              {hasMinRole(currentUser?.rol, 'encargado') && (
                <button
                  type="button"
                  className="aur-btn-pill"
                  onClick={() => setShowNuevaModal(true)}
                >
                  <FiPlusCircle size={14} /> Nueva cédula
                </button>
              )}
            </div>
          </header>

          {/* Banner persistente post-aplicada. Sobrevive hasta clic en
              "Ver en historial" (navega) o Cerrar (descarta). Replazo de
              un toast efímero — la confirmación de una aplicación en campo
              es información que el usuario suele querer verificar
              después de scrollear, no debe desaparecer sola. */}
          {lastAppliedCedula && (
            <div className="ca-applied-banner" role="status" aria-live="polite">
              <FiCheck size={14} aria-hidden="true" />
              <span className="ca-applied-banner-msg">
                Aplicación registrada
                {lastAppliedCedula.consecutivo && <> para la cédula <strong>{lastAppliedCedula.consecutivo}</strong></>}.
              </span>
              <button
                type="button"
                className="ca-applied-banner-action"
                onClick={() => navigate('/aplicaciones/historial')}
              >
                Ver en historial →
              </button>
              <button
                type="button"
                className="ca-applied-banner-close"
                onClick={() => setLastAppliedCedula(null)}
                aria-label="Cerrar"
              >
                <FiX size={14} />
              </button>
            </div>
          )}

          <section className="aur-section">
            {aplicacionTasks.length > 0 && (
              <div className="aur-list-search">
                <FiSearch size={13} aria-hidden="true" />
                <input
                  type="search"
                  className="aur-list-search-input"
                  placeholder="Buscar por actividad, lote, responsable o consecutivo…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  aria-label="Buscar cédula"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="aur-list-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Limpiar búsqueda"
                  >
                    <FiX size={12} />
                  </button>
                )}
              </div>
            )}
            {visibleTasks.length > 0 && (
              <div className="aur-section-header">
                <h3>Cédulas</h3>
                <span className="aur-section-count">{visibleTasks.length}</span>
              </div>
            )}
            {visibleTasks.length === 0 ? (
              aplicacionTasks.length === 0 ? (
                // Vacío real: el usuario ve la página por primera vez (o tras
                // limpiar todo). Variant default con ícono + subtitle que
                // explica el flujo automático paquete → lote → cédula, y CTA
                // directo para el rol que puede crear. Punto #13 audit.
                <EmptyState
                  variant="default"
                  icon={FiClipboard}
                  title="Aún no hay cédulas de aplicación"
                  subtitle={hasMinRole(currentUser?.rol, 'encargado')
                    ? 'Las cédulas se generan automáticamente desde los Paquetes de aplicaciones de tus lotes. También podés crear una manualmente.'
                    : 'Las cédulas se generan automáticamente desde los Paquetes de aplicaciones de los lotes de la finca.'}
                  action={hasMinRole(currentUser?.rol, 'encargado') && (
                    <button
                      type="button"
                      className="aur-btn-pill"
                      onClick={() => setShowNuevaModal(true)}
                    >
                      <FiPlusCircle size={14} /> Nueva cédula
                    </button>
                  )}
                />
              ) : (
                // Lista filtrada (search o fechas) sin matches: variant compact
                // sin ícono, mensaje contextual al filtro activo.
                <EmptyState
                  variant="compact"
                  icon={null}
                  title={searchQuery.trim()
                    ? `No hay resultados para «${searchQuery.trim()}».`
                    : 'No hay aplicaciones programadas para este período.'}
                />
              )
            ) : (
              <div className="ca-cedula-list">
                {visibleTasks.map(task => {
                  const allCedulas = cedulasByTaskId[task.id] || [];
                  const isHighlighted = highlightedTaskIds.has(task.id);
                  // Chips informativos del meta de la card (punto #15 audit):
                  // hectáreas / paquete / # productos. Se derivan acá para
                  // mantener las cards puramente presentacionales — la
                  // resolución de source → paquete usa los Maps memoizados
                  // y por eso no encaja como cálculo interno del card.
                  const source = getSource(task);
                  const packageName  = source?.paqueteId ? getPackageName(source.paqueteId) : null;
                  const productCount = task.activity?.productos?.length || 0;
                  const hectareas    = task.loteHectareas ?? source?.hectareas ?? null;
                  // Closure captura `task` para que el preview sepa cuál
                  // abrir; setear el scroll antes del cambio de state
                  // preserva la posición al cerrar.
                  const onPreview = (cedulaId) => {
                    openedViaUrlRef.current = false;
                    savedScrollRef.current = window.scrollY;
                    setPreviewTask(task);
                    setPreviewCedulaId(cedulaId);
                  };
                  return allCedulas.length > 1 ? (
                    <CedulaSplitCard
                      key={task.id}
                      task={task}
                      cedulas={allCedulas}
                      isHighlighted={isHighlighted}
                      actionLoading={actionLoading}
                      currentUser={currentUser}
                      packageName={packageName}
                      productCount={productCount}
                      hectareas={hectareas}
                      onPreview={onPreview}
                      onEditar={handleEditarProductos}
                      onMezclaLista={handleMezclaLista}
                      onAplicada={handleAplicada}
                      onAnular={handleAnular}
                    />
                  ) : (
                    <CedulaCard
                      key={task.id}
                      task={task}
                      cedula={allCedulas[0] || null}
                      isHighlighted={isHighlighted}
                      allowSkipTask={isOverdue(task)}
                      actionLoading={actionLoading}
                      currentUser={currentUser}
                      packageName={packageName}
                      productCount={productCount}
                      hectareas={hectareas}
                      onPreview={onPreview}
                      onGenerar={handleGenerarCedula}
                      onOmitir={handleOmitirTarea}
                      onEditar={handleEditarProductos}
                      onMezclaLista={handleMezclaLista}
                      onAplicada={handleAplicada}
                      onAnular={handleAnular}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      <CedulaPreviewModal
        previewTask={previewTask}
        activeCedula={activeCedula}
        actionLoading={actionLoading}
        currentUser={currentUser}
        onClose={handleCloseViewer}
        onShare={handleShare}
        onPrint={handlePrint}
        onMezclaLista={handleMezclaLista}
        onAplicada={handleAplicada}
      >
        <CedulaDocumento
          ref={docRef}
          config={config}
          previewTask={previewTask}
          activeCedula={activeCedula}
          previewSource={previewSource}
          previewPkg={previewPkg}
          previewPackageName={previewPackageName}
          previewTecnicoResponsable={previewTecnicoResponsable}
          previewProductos={previewProductos}
          previewBloques={previewBloques}
          pvTotalHa={pvTotalHa}
          previewCal={previewCal}
          previewCalAplicador={previewCalAplicador}
          previewCalTractor={previewCalTractor}
          getProductoCatalog={getProductoCatalog}
        />
      </CedulaPreviewModal>

      {/* ── Nueva Cédula Modal ── */}
      {showNuevaModal && (
        <CedulaNuevaModal
          lotes={lotes}
          grupos={grupos}
          siembras={siembras}
          productos={productos}
          calibraciones={calibraciones}
          apiFetch={apiFetch}
          currentUser={currentUser}
          onSuccess={handleNuevaCedulaSuccess}
          onClose={() => setShowNuevaModal(false)}
          onPreviewDraft={handlePreviewDraft}
        />
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal && (
        <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />
      )}
      {/* ── Aplicada Modal ── */}
      {aplicadaModal && (
        <AplicadaModal
          lotes={lotes}
          users={users}
          currentUser={currentUser}
          prefill={aplicadaModal}
          onClose={() => setAplicadaModal(null)}
          onConfirm={(data) => submitAplicada(aplicadaModal.cedulaId, data)}
        />
      )}
      {/* ── Mezcla Lista Modal ── */}
      {mezclaModal && (() => {
        const cedula = cedulasById.get(mezclaModal.cedulaId);
        const task   = cedula ? tasksById.get(cedula.taskId) : null;
        if (!cedula) return null;
        return (
          <MezclaListaModal
            mode="mezcla-lista"
            cedula={cedula}
            task={task}
            productos={productos}
            currentUser={currentUser}
            onClose={() => setMezclaModal(null)}
            onConfirm={(payload) => submitMezclaLista(mezclaModal.cedulaId, payload)}
          />
        );
      })()}

      {/* ── Filtro de Periodo Modal ── */}
      {mostrarFiltros && (
        <FiltroPeriodoModal
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          matchCount={tasksByDateRange.length}
          onClose={() => setMostrarFiltros(false)}
        />
      )}

      {/* ── Editar Productos Modal ── */}
      {editModal && (() => {
        const cedula = cedulasById.get(editModal.cedulaId);
        const task   = cedula ? tasksById.get(cedula.taskId) : null;
        if (!cedula) return null;
        return (
          <MezclaListaModal
            mode="edit"
            cedula={cedula}
            task={task}
            productos={productos}
            currentUser={currentUser}
            onClose={() => setEditModal(null)}
            onConfirm={(payload) => submitEdicionProductos(editModal.cedulaId, payload)}
          />
        );
      })()}
    </div>
  );
}

export default CedulasAplicacion;
