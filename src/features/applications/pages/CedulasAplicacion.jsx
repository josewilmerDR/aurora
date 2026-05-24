import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { FiX, FiPlusCircle, FiFilter } from 'react-icons/fi';
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
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import FilterButton from '../../../components/ui/FilterButton';
import HistorialButton from '../../../components/ui/HistorialButton';
import {
  formatShortDate,
  isOverdue,
  isManualTask,
} from '../lib/cedulas-helpers';
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
  const [actionLoading, setActionLoading] = useState(null); // cedulaId | 'new-{taskId}'
  const [showNuevaModal, setShowNuevaModal] = useState(false);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [aplicadaModal, setAplicadaModal] = useState(null); // cedulaId
  const [mezclaModal,   setMezclaModal]   = useState(null); // cedulaId
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
      const task = tasks.find(t => t.id === openId);
      if (task) { openedViaUrlRef.current = true; setPreviewTask(task); }
    }
  }, [tasks, location.search]);

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

  const visibleTasks = useMemo(() => {
    // Filtrado por rango de fechas (opcional)
    let filtered;
    if (!dateFrom && !dateTo) {
      filtered = aplicacionTasks;
    } else {
      const start = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
      const end   = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;
      filtered = aplicacionTasks.filter(t => {
        const due = new Date(t.dueDate);
        if (start && due < start) return false;
        if (end   && due > end)   return false;
        return true;
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
  }, [aplicacionTasks, dateFrom, dateTo]);

  const getSource = (task) => {
    if (task.loteId)  return lotes.find(l => l.id === task.loteId)   || null;
    if (task.grupoId) return grupos.find(g => g.id === task.grupoId) || null;
    return null;
  };

  const getPackageName = (paqueteId) =>
    packages.find(p => p.id === paqueteId)?.nombrePaquete || null;

  const getProductoCatalog = (productoId) =>
    productos.find(p => p.id === productoId) || null;

  // ── Computed preview data ─────────────────────────────────────────────────
  // The specific cedula shown in the preview (set on "Ver Cédula" click)
  const previewCedula = previewCedulaId ? (cedulas.find(c => c.id === previewCedulaId) || null) : null;
  const activeCedula = previewCedula || (previewTask ? (cedulasByTaskId[previewTask.id]?.[0] || null) : null);

  const previewSource = previewTask ? getSource(previewTask) : null;
  const previewPkg = previewSource?.paqueteId
    ? (packages.find(p => p.id === previewSource.paqueteId) || null)
    : null;
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
        .map(id => siembras.find(s => s.id === id))
        .filter(Boolean);
    }
    // For manual cedulas, use task-level bloques (subset); otherwise use source bloques
    const bloqueIds = previewTask?.bloques || previewSource?.bloques;
    if (!bloqueIds) return [];
    return bloqueIds
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [previewSource, siembras, previewCedula, previewTask, cedulas]);

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
        const pkg = packages.find(p => p.id === previewSource.paqueteId);
        if (!pkg) return null;
        const actName = previewTask.activityName || previewTask.activity?.name;
        const actDay  = previewTask.activity?.day;
        const pkgAct  = pkg.activities?.find(a =>
          (actName && a.name === actName) || (actDay != null && String(a.day) === String(actDay))
        );
        return pkgAct?.calibracionId || null;
      })();
    return calId ? (calibraciones.find(c => c.id === calId) || null) : null;
  })();
  const previewCalAplicador = previewCal?.aplicadorId
    ? (maquinaria.find(m => m.id === previewCal.aplicadorId) || null)
    : null;
  const previewCalTractor = previewCal?.tractorId
    ? (maquinaria.find(m => m.id === previewCal.tractorId) || null)
    : null;

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleGenerarCedula = async (taskId) => {
    setActionLoading(`new-${taskId}`);
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
          toast.error(data.message || 'Error al generar la cédula.');
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
      setActionLoading(null);
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
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/mezcla-lista`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Error al actualizar la cédula.');
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
      setActionLoading(null);
    }
  };

  const handleEditarProductos = (cedulaId) => {
    setEditModal({ cedulaId });
  };

  const submitEdicionProductos = async (cedulaId, payload) => {
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/editar-productos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || 'Error al editar la cédula.');
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
      setActionLoading(null);
    }
  };

  const handleAplicada = (cedulaId) => {
    const cedula = cedulas.find(c => c.id === cedulaId);
    const task   = tasks.find(t => t.id === cedula?.taskId);
    const source = task ? getSource(task) : null;
    const pkg    = source?.paqueteId ? packages.find(p => p.id === source.paqueteId) : null;
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
    const cal = calId ? calibraciones.find(c => c.id === calId) : null;
    setAplicadaModal({
      cedulaId,
      metodoAplicacion: cal?.metodo           || '',
      encargadoFinca:   config?.administrador  || '',
      encargadoBodega:  cedula?.mezclaListaNombre || '',
      supAplicaciones:  pkg?.tecnicoResponsable || cedula?.tecnicoResponsable || '',
    });
  };

  const submitAplicada = async (cedulaId, data) => {
    setAplicadaModal(null);
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/aplicada`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const err = await res.json(); showError(err.message || 'Error al registrar la aplicación.'); return; }
      const taskId = cedulas.find(c => c.id === cedulaId)?.taskId;
      setCedulas(prev => prev.map(c =>
        c.id === cedulaId ? { ...c, status: 'aplicada_en_campo', aplicadaAt: new Date().toISOString(), ...data } : c
      ));
      // Only mark task completed if all sibling cedulas are now applied/annulled
      if (taskId) {
        const siblings = cedulas.filter(c => c.taskId === taskId && c.id !== cedulaId);
        const allDone = siblings.every(c => c.status === 'aplicada_en_campo' || c.status === 'anulada');
        if (allDone) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed_by_user' } : t));
      }
    } finally { setActionLoading(null); }
  };

  const handleAnular = (cedulaId) => {
    const cedula = cedulas.find(c => c.id === cedulaId);
    const body = cedula?.status === 'en_transito'
      ? '¿Anular esta cédula? La mezcla ya fue preparada — el inventario será restaurado automáticamente.'
      : '¿Anular esta cédula? La tarea asociada quedará como omitida.';
    setConfirmModal({
      title: 'Anular cédula',
      body,
      confirmLabel: 'Anular',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(cedulaId);
        try {
          const res = await apiFetch(`/api/cedulas/${cedulaId}/anular`, { method: 'PUT' });
          if (!res.ok) { const err = await res.json(); showError(err.message || 'Error al anular la cédula.'); return; }
          const taskId = cedulas.find(c => c.id === cedulaId)?.taskId;
          // Marcar como anulada en lugar de eliminar para mantener consistencia con el backend
          setCedulas(prev => prev.map(c => c.id === cedulaId ? { ...c, status: 'anulada' } : c));
          if (taskId) {
            const remaining = cedulas.filter(c => c.id !== cedulaId && c.taskId === taskId);
            const allInactive = remaining.every(c => c.status === 'anulada' || c.status === 'aplicada_en_campo');
            if (allInactive) {
              const anyApplied = remaining.some(c => c.status === 'aplicada_en_campo');
              setTasks(prev => prev.map(t => t.id === taskId
                ? { ...t, status: anyApplied ? 'completed_by_user' : 'skipped' }
                : t));
            }
          }
          window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
        } finally { setActionLoading(null); }
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
        setActionLoading(`skip-${taskId}`);
        try {
          const res = await apiFetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'skipped' }),
          });
          if (!res.ok) { const err = await res.json(); showError(err.message || 'Error al omitir la tarea.'); return; }
          setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'skipped' } : t));
          window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
        } finally { setActionLoading(null); }
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
    const lote = lotes.find(l => l.id === formData.loteId) || null;
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
    document.body.classList.add('ca-printing');
    window.print();
    document.body.classList.remove('ca-printing');
  };

  // ── Cerrar viewer (back-aware) ────────────────────────────────────────────
  const handleCloseViewer = () => {
    const viaUrl = openedViaUrlRef.current;
    const scroll = savedScrollRef.current;
    setPreviewTask(null);
    setPreviewCedulaId(null);
    openedViaUrlRef.current = false;
    if (viaUrl) {
      navigate(-1);
    } else {
      requestAnimationFrame(() => window.scrollTo({ top: scroll, behavior: 'instant' }));
    }
  };

  // ── PDF share ─────────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (!docRef.current || !previewTask) return;
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
      const filename = `Cedula-${previewTask.activityName || previewTask.id}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        // navigator.share rechaza con AbortError cuando el usuario cancela la
        // hoja de compartir nativa — esa rama no es un error.
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      // Causas frecuentes: html2canvas falla con imágenes CORS (logoUrl
      // externo), jsPDF revienta en navegadores móviles antiguos, dynamic
      // import bloqueado offline. Antes era `// silently fail` — el botón
      // se veía muerto y el usuario reintentaba. Toast accionable + log
      // del error real para soporte.
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

          <section className="aur-section">
            {visibleTasks.length > 0 && (
              <div className="aur-section-header">
                <h3>Cédulas</h3>
                <span className="aur-section-count">{visibleTasks.length}</span>
              </div>
            )}
            {visibleTasks.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={null}
                title={
                  aplicacionTasks.length === 0
                    ? (hasMinRole(currentUser?.rol, 'encargado')
                        ? 'Aún no hay registros que mostrar. Crea el primero en "Nueva cédula"'
                        : 'Aún no hay cédulas de aplicación para tus cultivos.')
                    : 'No hay aplicaciones programadas para este período.'
                }
              />
            ) : (
              <div className="ca-cedula-list">
                {visibleTasks.map(task => {
                  const allCedulas = cedulasByTaskId[task.id] || [];
                  const isHighlighted = highlightedTaskIds.has(task.id);
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
        const cedula = cedulas.find(c => c.id === mezclaModal.cedulaId);
        const task   = cedula ? tasks.find(t => t.id === cedula.taskId) : null;
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
      {mostrarFiltros && createPortal(
        <div
          className="aur-modal-backdrop"
          onClick={() => setMostrarFiltros(false)}
        >
          <div
            className="aur-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ca-filtro-modal-title"
            onClick={e => e.stopPropagation()}
          >
            <div className="aur-modal-header">
              <span className="aur-modal-icon">
                <FiFilter size={16} />
              </span>
              <h3 className="aur-modal-title" id="ca-filtro-modal-title">
                Filtrar por periodo
              </h3>
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
              <div className="ca-periodo-grid">
                <div className="ca-periodo-field">
                  <label htmlFor="ca-from">Desde</label>
                  <input
                    id="ca-from"
                    type="date"
                    className="aur-input"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                  />
                </div>
                <div className="ca-periodo-field">
                  <label htmlFor="ca-to">Hasta</label>
                  <input
                    id="ca-to"
                    type="date"
                    className="aur-input"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="aur-modal-actions">
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  className="aur-chip aur-chip--ghost"
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
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

      {/* ── Editar Productos Modal ── */}
      {editModal && (() => {
        const cedula = cedulas.find(c => c.id === editModal.cedulaId);
        const task   = cedula ? tasks.find(t => t.id === cedula.taskId) : null;
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
