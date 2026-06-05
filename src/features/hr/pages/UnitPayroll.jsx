import { useState, useEffect, useCallback, useRef, useMemo, forwardRef } from 'react';
import { useLocation } from 'react-router-dom';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiCheck, FiX, FiShare2, FiDownload, FiPrinter, FiEye, FiEdit2, FiThumbsUp, FiCheckCircle, FiFileText } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useDraft, markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraModal from '../../../components/AuroraModal';
import EmptyState from '../../../components/ui/EmptyState';
import SegmentCombobox from '../components/SegmentCombobox';
import { translateApiError } from '../../../lib/errorMessages';
import { todayStr, fmtMoney, fmtDate, newSegId, newSegmento, isHoraUnit, safeImageUrl, ESTADO_LABEL, ESTADO_CLASS, parseLaborString, countTrabajadoresConCantidad } from '../lib/unit-payroll-shared';
import '../styles/hr.css';
import '../styles/unit-payroll.css';

const DRAFT_FORM_KEY = 'hr-planilla-unidad';

// Validation limits
const MAX_OBSERVACIONES_LEN = 1000;
const MAX_NOMBRE_PLANTILLA_LEN = 100;
const MAX_SEGMENTOS = 50;
const MAX_NUMERIC_INPUT = 999999;     // general cap for quantities / costs
const MAX_AVANCE_HA = 99999;
const FECHA_MIN = '2000-01-01';
const FECHA_MAX = '2100-12-31';

// nombre del grupo + números de bloque (derivados de las siembras vinculadas)
function grupoLabel(g, siembras) {
  const nums = [...new Set(
    (g.bloques || [])
      .map(id => (siembras || []).find(s => s.id === id)?.bloque)
      .filter(Boolean)
  )].sort((a, b) => parseInt(a) - parseInt(b));
  return nums.length ? `${g.nombreGrupo} (${nums.join(', ')})` : g.nombreGrupo;
}

// Los tres comboboxes son wrappers finos sobre SegmentCombobox (misma máquina de
// teclado/dropdown/ARIA). Conservan el contrato string de los segmentos.
const LaborCombobox = forwardRef(function LaborCombobox({ value, onChange, labores, onAfterSelect, onTabDown }, ref) {
  return (
    <SegmentCombobox
      ref={ref}
      value={value}
      onChange={onChange}
      items={labores}
      filter={(l, q) => { const s = (q || '').toLowerCase(); return !s || String(l.codigo).includes(s) || (l.descripcion || '').toLowerCase().includes(s); }}
      getKey={l => l.id}
      getSelectArgs={l => [`${l.codigo} - ${l.descripcion}`]}
      renderOption={l => (<><span className="labor-dropdown-code">{l.codigo}</span><span className="labor-dropdown-desc">{l.descripcion}</span></>)}
      placeholder="Ej: Deshierva"
      ariaLabel="Labor del segmento"
      onAfterSelect={onAfterSelect}
      onTabDown={onTabDown}
    />
  );
});

const GrupoCombobox = forwardRef(function GrupoCombobox({ value, onChange, grupos, siembras, onAfterSelect, onTabDown }, ref) {
  return (
    <SegmentCombobox
      ref={ref}
      value={value}
      onChange={onChange}
      items={grupos}
      filter={(g, q) => { const s = (q || '').toLowerCase(); return !s || (g.nombreGrupo || '').toLowerCase().includes(s); }}
      getKey={g => g.id}
      getSelectArgs={g => [g.nombreGrupo]}
      renderOption={g => <span className="labor-dropdown-desc">{grupoLabel(g, siembras)}</span>}
      placeholder="Buscar grupo…"
      ariaLabel="Grupo del segmento"
      onAfterSelect={onAfterSelect}
      onTabDown={onTabDown}
    />
  );
});

const UnidadCombobox = forwardRef(function UnidadCombobox({ value, onChange, unidades, onAfterSelect, onTabDown }, ref) {
  return (
    <SegmentCombobox
      ref={ref}
      value={value}
      onChange={onChange}
      items={unidades}
      filter={(u, q) => { const s = (q || '').toLowerCase(); return !s || (u.nombre || '').toLowerCase().includes(s); }}
      getKey={u => u.id || u.nombre}
      getSelectArgs={u => [u.nombre, u.precio ?? null, u.factorConversion ?? null, u.unidadBase || '']}
      renderOption={u => (<><span className="labor-dropdown-desc">{u.nombre}</span>{u.precio != null && (<span className="labor-dropdown-code">₡{Number(u.precio).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>)}</>)}
      placeholder="Buscar unidad…"
      ariaLabel="Unidad del segmento"
      displayValue={v => (v === '-' ? '' : v)}
      onAfterSelect={onAfterSelect}
      onTabDown={onTabDown}
    />
  );
});

function UnitPayroll() {
  const { currentUser } = useUser();
  const apiFetch = useApiFetch();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Traduce el código de error del backend (p.ej. INSUFFICIENT_ROLE → "No
  // tienes el rol necesario…") a un mensaje en español. Cae al `fallback`
  // genérico si el body no se puede leer. La Response sólo se lee una vez.
  const errMsgFromRes = async (res, fallback) => {
    try {
      const body = await res.json();
      return translateApiError(body, fallback);
    } catch {
      return fallback;
    }
  };

  const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(currentUser?.rol);
  const canPagar   = ['administrador', 'rrhh'].includes(currentUser?.rol);

  const [fecha, setFecha, clearFechaDraft] = useDraft('hr-planilla-fecha', todayStr);
  const [observaciones, setObservaciones, clearObsDraft] = useDraft('hr-planilla-observaciones', '');
  const [segmentos, setSegmentos, clearSegsDraft] = useDraft('hr-planilla-segmentos', () => [newSegmento()]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [cantidades, setCantidades, clearCantsDraft] = useDraft('hr-planilla-cantidades', {});
  const [fillAll, setFillAll] = useState({});
  const [lotes, setLotes] = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [gruposCat, setGruposCat] = useState([]);
  const [laboresCat, setLaboresCat] = useState([]);
  const [unidadesCat, setUnidadesCat] = useState([]);
  const loteRefs = useRef({});
  const grupoRefs = useRef({});
  const laborRefs = useRef({});
  const avanceRefs = useRef({});
  const unidadRefs = useRef({});
  const costoRefs = useRef({});
  const cantidadRefs = useRef({});
  const nuevoSegmentoRef = useRef(null);
  const pendingFocusSegId = useRef(null);
  const [companyConfig, setCompanyConfig] = useState({ nombreEmpresa: '', logoUrl: '', identificacion: '', whatsapp: '', direccion: '' });
  const [guardando, setGuardando] = useState(false);
  const [showAprobarConfirm, setShowAprobarConfirm] = useState(false);
  const [confirmDelPlanilla, setConfirmDelPlanilla] = useState(null);
  const [confirmDelPlantilla, setConfirmDelPlantilla] = useState(null);
  const [confirmDelSegmento, setConfirmDelSegmento] = useState(null); // { id, idx, count }
  const [confirmLoadPlanilla, setConfirmLoadPlanilla] = useState(null); // planilla pendiente de cargar (pisaría un borrador sin guardar)
  const [planillaId, setPlanillaId] = useDraft('hr-planilla-id', null);
  const [planillaEstado, setPlanillaEstado] = useDraft('hr-planilla-estado', null);
  const [consecutivo, setConsecutivo] = useDraft('hr-planilla-consecutivo', null);
  const [historial, setHistorial] = useState([]);
  const [historialLoading, setHistorialLoading] = useState(true);
  const [historialError, setHistorialError] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'
  // dirty = true only when the user modifies the form. Prevents async loads
  // (workers, drafts, reloads) from triggering an auto-save.
  const dirtyRef = useRef(false);
  // planillaIdRef reflects the last known planillaId. The setTimeout closure
  // does not re-fire when planillaId changes (it's not a dep), so we read from
  // the ref to avoid firing a second POST after the first one already returned
  // an id (a race that produced duplicate drafts).
  const planillaIdRef = useRef(null);
  // Prevents two POSTs from firing in parallel and creating duplicates.
  const saveInProgressRef = useRef(false);
  // Lets async callbacks know whether the component has been unmounted.
  // Resets to true on every mount (needed for React Strict Mode dev, which
  // runs cleanup→mount again on initial mount).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const originalPlanillaRef = useRef(null);
  const [previewPlanilla, setPreviewPlanilla] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const previewRef = useRef(null);
  const [removedWorkerIds, setRemovedWorkerIds] = useState([]);
  const [historialTab, setHistorialTab] = useState('pendientes');
  const [plantillas, setPlantillas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showSavePlantilla, setShowSavePlantilla] = useState(false);
  const [nombrePlantilla, setNombrePlantilla] = useState('');
  const [savingPlantilla, setSavingPlantilla] = useState(false);
  // id de la planilla cuya transición (aprobar/pagar) está en curso desde el
  // panel lateral → deshabilita sus botones y evita el doble PUT.
  const [actionLoadingId, setActionLoadingId] = useState(null);
  // id de la row recién mutada → highlight transitorio para no perderla tras el reload.
  const [recentlyTouchedId, setRecentlyTouchedId] = useState(null);

  // Mark / clear the draft badge whenever form content changes
  useEffect(() => {
    const hasContent =
      observaciones.trim() !== '' ||
      segmentos.some(s => s.loteId || s.labor || s.grupo || s.avanceHa !== '' || s.costoUnitario !== '') ||
      Object.values(cantidades).some(segMap => Object.values(segMap || {}).some(v => v !== ''));
    if (hasContent) markDraftActive(DRAFT_FORM_KEY);
    else clearDraftActive(DRAFT_FORM_KEY);
  }, [observaciones, segmentos, cantidades]);

  const fetchHistorial = useCallback(() => {
    setHistorialLoading(true);
    setHistorialError(false);
    apiFetch('/api/hr/planilla-unidad')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      // Se incluyen las aprobadas para que el botón "Pagar" tenga dónde vivir
      // (las pagadas/anuladas viven en el tab Historial). Sin aprobadas, la
      // transición a "pagada" quedaba inalcanzable desde este panel.
      .then(data => setHistorial(data.filter(p => ['borrador', 'pendiente', 'aprobada'].includes(p.estado))))
      .catch(() => setHistorialError(true))
      .finally(() => setHistorialLoading(false));
  }, []);

  // Keeps planillaIdRef in sync with state.
  useEffect(() => { planillaIdRef.current = planillaId; }, [planillaId]);

  // On landing on the page, open the form directly
  // (drafts/pendientes remain accessible from the side panel).
  useEffect(() => {
    if (!historialLoading && !showForm) {
      dirtyRef.current = false;
      setAutoSaveStatus(null);
      setShowForm(true);
    }
  }, [historialLoading, showForm]);

  // Auto-save on changes (2s debounce) — drafts only
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (!showForm) return;
    if (planillaEstado === 'pendiente') return; // pendiente is not auto-saved
    const encId = currentUser?.userId || currentUser?.uid;
    if (!encId) return;
    // Hay una edición nueva sin persistir: el "Borrador guardado" previo ya no
    // es cierto durante el debounce. Limpiarlo para no dar falsa seguridad.
    setAutoSaveStatus(prev => (prev === 'saved' ? null : prev));
    const estadoGuardado = planillaEstado || 'borrador';
    const timer = setTimeout(async () => {
      // If a POST/PUT is in flight, do not fire another: the in-flight POST
      // will create/update the draft, and the user's next edit will re-fire
      // this effect with planillaIdRef already in sync.
      if (saveInProgressRef.current) return;
      saveInProgressRef.current = true;
      setAutoSaveStatus('saving');
      const body = buildPlanillaBody(estadoGuardado, encId);
      try {
        let res;
        let created = false;
        const currentId = planillaIdRef.current;
        if (currentId) {
          res = await apiFetch(`/api/hr/planilla-unidad/${currentId}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
        } else {
          res = await apiFetch('/api/hr/planilla-unidad', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          if (res.ok) {
            const data = await res.json();
            created = true;
            // Sync the ref BEFORE setPlanillaId so any timer that fires
            // between this point and the next render reads the correct id.
            planillaIdRef.current = data.id;
            if (mountedRef.current) {
              setPlanillaId(data.id);
              setPlanillaEstado(estadoGuardado);
            }
          }
        }
        if (!mountedRef.current) return;
        if (res.ok) {
          dirtyRef.current = false;
          setAutoSaveStatus('saved');
          // Solo refrescar el panel cuando el autosave CREA un borrador nuevo
          // (debe aparecer en la lista). Un PUT de actualización no cambia la
          // card → evita el parpadeo del panel en cada pausa de tipeo.
          if (created) fetchHistorial();
        } else {
          setAutoSaveStatus('error');
        }
      } catch {
        if (mountedRef.current) setAutoSaveStatus('error');
      } finally {
        saveInProgressRef.current = false;
      }
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, observaciones, segmentos, cantidades, removedWorkerIds, showForm, planillaEstado, fetchHistorial]);

  const fetchPlantillas = useCallback(() => {
    const encId = currentUser?.userId || currentUser?.uid;
    if (!encId) return;
    apiFetch(`/api/hr/plantillas-planilla?encargadoId=${encId}`)
      .then(r => r.json())
      .then(setPlantillas)
      .catch(console.error);
  }, [currentUser?.userId, currentUser?.uid]);

  useEffect(() => {
    // Si un catálogo falla, además de loguear avisamos: un dropdown vacío sin
    // explicación deja al encargado trabado sin saber si es red o falta de datos.
    // Agregamos los fallos en un solo toast: con un Toast único, disparar varios
    // en el mismo tick deja ver sólo el último y oculta los otros catálogos rotos.
    const cargar = (url, nombre, apply) =>
      apiFetch(url).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(apply)
        .then(() => null).catch(() => nombre);
    Promise.all([
      cargar('/api/lotes', 'lotes', setLotes),
      cargar('/api/siembras', 'siembras', data => setSiembras(Array.isArray(data) ? data : [])),
      cargar('/api/grupos', 'grupos', setGruposCat),
      cargar('/api/labores', 'labores', setLaboresCat),
      cargar('/api/unidades-medida', 'unidades', data => setUnidadesCat(Array.isArray(data) ? data : [])),
    ]).then(results => {
      const fallidos = results.filter(Boolean);
      if (fallidos.length) showToast(`No se pudieron cargar algunos catálogos: ${fallidos.join(', ')}.`, 'error');
    });
    apiFetch('/api/config').then(r => r.json()).then(data => setCompanyConfig({ nombreEmpresa: data.nombreEmpresa || '', logoUrl: data.logoUrl || '', identificacion: data.identificacion || '', whatsapp: data.whatsapp || '', direccion: data.direccion || '' })).catch(console.error);
    fetchHistorial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchPlantillas(); }, [fetchPlantillas]);

  // Load planilla draft from Aurora chat navigation state
  useEffect(() => {
    const draft = location.state?.planillaDraft;
    if (!draft) return;
    setSegmentos(draft.segmentos?.length ? draft.segmentos : [newSegmento()]);
    setFecha(draft.fecha || todayStr());
    setObservaciones(draft.observaciones || '');
    planillaIdRef.current = null;
    setPlanillaId(null);
    setConsecutivo(null);
    setFillAll({});
    setRemovedWorkerIds([]);
    // Rebuild cantidades from draft data keyed by trabajadorId
    setCantidades(prev => {
      const next = { ...prev };
      (draft.trabajadores || []).forEach(t => {
        if (t.trabajadorId) next[t.trabajadorId] = t.cantidades || {};
      });
      return next;
    });
    markDraftActive(DRAFT_FORM_KEY);
    dirtyRef.current = true;
    setShowForm(true);
    showToast('Planilla cargada desde Aurora. Revisa y guarda cuando esté lista.');
    // Clear state so reload doesn't re-apply
    window.history.replaceState({}, '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const isAdmin = currentUser?.rol === 'administrador';
    if (!isAdmin && !currentUser?.userId) return;
    const url = isAdmin
      ? '/api/users/lite'
      : `/api/hr/subordinados?encargadoId=${currentUser.userId}`;
    apiFetch(url)
      .then(r => r.json())
      .then(data => {
        const empleados = isAdmin ? data.filter(u => u.empleadoPlanilla) : data;
        return apiFetch('/api/hr/fichas')
          .then(r => r.json())
          .then(fichas => {
            const fichaMap = {};
            fichas.forEach(f => { fichaMap[f.userId] = f; });
            const enriched = empleados.map(e => ({ ...e, precioHora: Number(fichaMap[e.id]?.precioHora) || 0 }));
            if (!isAdmin) {
              const selfId = currentUser.userId;
              const selfFicha = fichaMap[selfId];
              const tieneSalarioMensual = Number(selfFicha?.salarioBase) > 0;
              if (!tieneSalarioMensual && !enriched.some(e => e.id === selfId)) {
                enriched.unshift({ id: selfId, nombre: currentUser.nombre, precioHora: Number(selfFicha?.precioHora) || 0, esEncargadoActual: true });
              }
            }
            return enriched;
          })
          .catch(() => empleados);
      })
      .then(enriched => {
        setTrabajadores([...enriched].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')));
        setCantidades(prev => {
          const next = { ...prev };
          enriched.forEach(t => { if (!next[t.id]) next[t.id] = {}; });
          return next;
        });
      })
      .catch(console.error);
  }, [currentUser?.userId, currentUser?.rol]);

  // Moves focus vertically within the same segment column (Tab = down, Shift+Tab = up)
  const makeColTabHandler = (segId, prevRefsObj, nextRefsObj) => (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) prevRefsObj?.current[segId]?.focus();
    else nextRefsObj?.current[segId]?.focus();
  };

  const addSegmento = (focusNew = false) => {
    dirtyRef.current = true;
    const seg = newSegmento();
    if (focusNew) pendingFocusSegId.current = seg.id;
    setSegmentos(prev => [...prev, seg]);
    setCantidades(prev => {
      const next = { ...prev };
      // Pre-sembrar la clave para TODOS los trabajadores (no sólo los visibles):
      // así un trabajador oculto que luego se restaura ya tiene la celda del
      // segmento nuevo. getCant tolera claves faltantes, pero esto mantiene los
      // inputs controlados desde el inicio.
      trabajadores.forEach(t => { next[t.id] = { ...(next[t.id] || {}), [seg.id]: '' }; });
      return next;
    });
  };

  useEffect(() => {
    if (pendingFocusSegId.current && loteRefs.current[pendingFocusSegId.current]) {
      loteRefs.current[pendingFocusSegId.current].focus();
      pendingFocusSegId.current = null;
    }
  }, [segmentos]);

  // Pide confirmación solo si el segmento tiene cantidades cargadas (borrarlas es
  // irreversible). Si está vacío, lo quita directo sin fricción.
  const requestRemoveSegmento = (segId, idx) => {
    const count = visibleWorkers.filter(t => getCant(t.id, segId) > 0).length;
    if (count > 0) setConfirmDelSegmento({ id: segId, idx, count });
    else removeSegmento(segId);
  };

  const removeSegmento = (segId) => {
    dirtyRef.current = true;
    setSegmentos(prev => prev.filter(s => s.id !== segId));
    setCantidades(prev => {
      const next = {};
      Object.keys(prev).forEach(tId => {
        const { [segId]: _, ...rest } = prev[tId] || {};
        next[tId] = rest;
      });
      return next;
    });
  };

  const updSeg = (segId, field, value) => {
    dirtyRef.current = true;
    setSegmentos(prev => prev.map(s => {
      if (s.id !== segId) return s;
      const u = { ...s, [field]: value };
      if (field === 'loteId') { u.loteNombre = lotes.find(l => l.id === value)?.nombreLote || ''; u.grupo = ''; }
      return u;
    }));
  };

  const setCantidad = (tId, segId, raw) => {
    dirtyRef.current = true;
    setCantidades(prev => ({ ...prev, [tId]: { ...(prev[tId] || {}), [segId]: raw } }));
  };

  const visibleWorkers = useMemo(
    () => trabajadores.filter(t => !removedWorkerIds.includes(t.id)),
    [trabajadores, removedWorkerIds],
  );

  // id→trabajador para evitar el .find() O(N) por celda en cada render.
  const trabajadorMap = useMemo(() => {
    const m = new Map();
    trabajadores.forEach(t => m.set(t.id, t));
    return m;
  }, [trabajadores]);

  const applyFillAll = (segId) => {
    const val = fillAll[segId];
    if (val === '' || val == null) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return;
    // Clampa al mismo tope que las celdas individuales.
    const clamped = String(Math.min(n, MAX_NUMERIC_INPUT));
    dirtyRef.current = true;
    setCantidades(prev => {
      const next = { ...prev };
      visibleWorkers.forEach(t => {
        next[t.id] = { ...(next[t.id] || {}), [segId]: clamped };
      });
      return next;
    });
    // Limpia el input "= todos" para que no parezca pendiente de aplicar.
    setFillAll(prev => ({ ...prev, [segId]: '' }));
  };

  const getCant = (tId, segId) => {
    const v = cantidades[tId]?.[segId];
    if (v === '' || v == null) return 0;
    const n = Number(v);
    // Clamp a >= 0: un negativo tipeado descontaría del pago del trabajador.
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };

  const workerTotal = (tId) => {
    const t = trabajadorMap.get(tId);
    return segmentos.reduce((sum, seg) => {
      const horaDirecta = isHoraUnit(seg.unidad);
      const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
      const precio = (horaDirecta || horaConFactor)
        ? (Number(t?.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
        : (Number(seg.costoUnitario) || 0);
      return sum + getCant(tId, seg.id) * precio;
    }, 0);
  };

  const segCantTotal = (segId) =>
    visibleWorkers.reduce((sum, t) => sum + getCant(t.id, segId), 0);

  const totalGeneral = () => visibleWorkers.reduce((sum, t) => sum + workerTotal(t.id), 0);

  // Totales memoizados para el render: sin esto, cada tecla en una celda
  // recomputa O(trabajadores × segmentos) totales (y segCantTotal se llamaba dos
  // veces por columna). Se recalculan sólo cuando cambian las dependencias reales.
  const workerTotals = useMemo(() => {
    const m = new Map();
    visibleWorkers.forEach(t => m.set(t.id, workerTotal(t.id)));
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWorkers, segmentos, cantidades, trabajadorMap]);

  const segTotals = useMemo(() => {
    const m = new Map();
    segmentos.forEach(seg => m.set(seg.id, segCantTotal(seg.id)));
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentos, cantidades, visibleWorkers]);

  const grandTotalMemo = useMemo(
    () => visibleWorkers.reduce((sum, t) => sum + (workerTotals.get(t.id) || 0), 0),
    [workerTotals, visibleWorkers],
  );

  // Builds the common POST/PUT body — shared by auto-save, manual save and approval.
  const buildPlanillaBody = (estado, encId) => ({
    fecha,
    encargadoId: encId,
    encargadoNombre: currentUser?.nombre || '',
    segmentos,
    trabajadores: visibleWorkers.map(t => ({
      trabajadorId: t.id,
      trabajadorNombre: t.nombre,
      precioHora: Number(t.precioHora) || 0,
      cantidades: cantidades[t.id] || {},
      total: workerTotal(t.id),
    })),
    totalGeneral: totalGeneral(),
    estado,
    observaciones,
  });

  // Valida la planilla antes de enviarla a aprobación. Devuelve { msg, segId, refs }
  // (refs = el ref del campo a enfocar) o null si está OK. El segId/refs deja
  // llevar el foco al primer campo inválido en vez de obligar a contar columnas.
  const validarParaEnviar = () => {
    if (!fecha || fecha < FECHA_MIN || fecha > FECHA_MAX) return { msg: 'La fecha está fuera del rango permitido.' };
    if (!Array.isArray(segmentos) || segmentos.length === 0 || segmentos.length > MAX_SEGMENTOS) {
      return { msg: `La planilla debe tener entre 1 y ${MAX_SEGMENTOS} segmentos.` };
    }
    if ((observaciones || '').length > MAX_OBSERVACIONES_LEN) {
      return { msg: `Las observaciones no pueden exceder ${MAX_OBSERVACIONES_LEN} caracteres.` };
    }
    for (let i = 0; i < segmentos.length; i++) {
      const seg = segmentos[i];
      const n = i + 1;
      if (!seg.labor?.trim()) return { msg: `El segmento #${n} no tiene labor.`, segId: seg.id, refs: laborRefs };
      if (!seg.unidad || seg.unidad === '-') return { msg: `El segmento #${n} no tiene unidad.`, segId: seg.id, refs: unidadRefs };
      const usaHora = isHoraUnit(seg.unidad) || (isHoraUnit(seg.unidadBase) && seg.factorConversion != null);
      if (!usaHora && !(Number(seg.costoUnitario) > 0)) return { msg: `El segmento #${n} no tiene costo unitario.`, segId: seg.id, refs: costoRefs };
      const algunaCant = visibleWorkers.some(t => getCant(t.id, seg.id) > 0);
      if (!algunaCant) return { msg: `El segmento #${n} no tiene cantidades cargadas.`, segId: seg.id, refs: laborRefs };
    }
    return null;
  };

  const handleGuardar = async (estado) => {
    const encId = currentUser?.userId || currentUser?.uid;
    if (!encId) {
      showToast('Tu cuenta no está vinculada a un perfil de empleado en el sistema.', 'error');
      return;
    }
    const errorValidacion = validarParaEnviar();
    if (errorValidacion) {
      showToast(errorValidacion.msg, 'error');
      // Lleva el foco al primer campo inválido (scroll + focus) para no obligar
      // al usuario a buscar el segmento entre columnas con scroll horizontal.
      if (errorValidacion.segId && errorValidacion.refs) {
        const el = errorValidacion.refs.current[errorValidacion.segId];
        if (el) {
          if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'center' });
          el.focus?.();
        }
      }
      return;
    }
    // Espera a que termine un autosave en vuelo: si dispara un POST sin id en
    // paralelo con este, se crean dos borradores (ver comentario en planillaIdRef).
    while (saveInProgressRef.current) {
      await new Promise(r => setTimeout(r, 100));
    }
    saveInProgressRef.current = true;
    setGuardando(true);
    const body = buildPlanillaBody(estado, encId);
    let savedConsecutivo = consecutivo;
    try {
      let res;
      const currentId = planillaIdRef.current;
      if (currentId) {
        res = await apiFetch(`/api/hr/planilla-unidad/${currentId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.consecutivo) { setConsecutivo(data.consecutivo); savedConsecutivo = data.consecutivo; }
        }
      } else {
        res = await apiFetch('/api/hr/planilla-unidad', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          planillaIdRef.current = data.id;
          setPlanillaId(data.id);
          if (data.consecutivo) { setConsecutivo(data.consecutivo); savedConsecutivo = data.consecutivo; }
        }
      }
      if (!res.ok) throw new Error(await errMsgFromRes(res, 'Error al guardar la planilla.'));
      clearSegsDraft();
      clearCantsDraft();
      clearFechaDraft();
      clearObsDraft();
      clearDraftActive(DRAFT_FORM_KEY);
      setPlanillaEstado(estado);
      planillaIdRef.current = null;
      setPlanillaId(null);
      setConsecutivo(null);
      setFillAll({});
      setRemovedWorkerIds([]);
      dirtyRef.current = false;
      const consecLabel = savedConsecutivo ? ` ${savedConsecutivo}` : '';
      showToast(estado === 'borrador'
        ? `Borrador${consecLabel} guardado.`
        : `Planilla${consecLabel} guardada correctamente.`);
      setShowForm(false);
      fetchHistorial();
    } catch (err) {
      showToast(err?.message || 'Error al guardar la planilla.', 'error');
    } finally {
      saveInProgressRef.current = false;
      setGuardando(false);
    }
  };

  const generatePlanillaPdf = async (action) => {
    if (!previewRef.current || !previewPlanilla) return;
    // Para imprimir: abrir la ventana SINCRÓNICAMENTE con el gesto del usuario.
    // Si la abrimos después del `await import(...)`, iOS Safari ya perdió el
    // "user gesture" y la bloquea aunque los popups estén habilitados.
    let printWindow = null;
    if (action === 'print') {
      printWindow = window.open('', '_blank');
      if (!printWindow) {
        showToast('Habilitá las ventanas emergentes para imprimir.', 'error');
        return;
      }
    }
    setPdfLoading(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const docEl = previewRef.current;
      const headerEl = docEl.querySelector('.pu-pdoc-header');
      const [canvas, headerCanvas] = await Promise.all([
        html2canvas(docEl, {
          scale: 2, useCORS: true, backgroundColor: '#ffffff',
          width: docEl.scrollWidth, height: docEl.scrollHeight,
          windowWidth: docEl.scrollWidth, windowHeight: docEl.scrollHeight,
        }),
        headerEl ? html2canvas(headerEl, {
          scale: 2, useCORS: true, backgroundColor: '#ffffff',
          width: headerEl.scrollWidth, height: headerEl.scrollHeight,
        }) : Promise.resolve(null),
      ]);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      const headerH = headerCanvas ? (headerCanvas.height * pageW) / headerCanvas.width : 0;
      const headerImgData = headerCanvas ? headerCanvas.toDataURL('image/png') : null;

      // Page 1 fits pageH of content; subsequent pages fit (pageH - headerH) each
      const totalPages = imgH <= pageH ? 1 : 1 + Math.ceil((imgH - pageH) / (pageH - headerH));

      // Page 1 — full width, content from top
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
      pdf.setFontSize(8); pdf.setTextColor(150);
      pdf.text(`1 / ${totalPages} páginas`, pageW - 4, pageH - 3, { align: 'right' });

      // Pages 2+
      let contentY = pageH;
      let pageNum = 2;
      while (contentY < imgH) {
        pdf.addPage();
        // Content first (shifted so contentY appears just below the header)
        pdf.addImage(imgData, 'PNG', 0, headerH - contentY, pageW, imgH);
        // Header drawn on top to cover any overlap
        if (headerImgData) pdf.addImage(headerImgData, 'PNG', 0, 0, pageW, headerH);
        pdf.setFontSize(8); pdf.setTextColor(150);
        pdf.text(`${pageNum} / ${totalPages} páginas`, pageW - 4, pageH - 3, { align: 'right' });
        contentY += pageH - headerH;
        pageNum++;
      }
      const filename = `Planilla-${previewPlanilla.consecutivo || 'sin-numero'}.pdf`;
      if (action === 'print') {
        // Abre el diálogo de impresión del navegador sobre el PDF generado,
        // reusando la ventana ya abierta con el gesto del usuario.
        pdf.autoPrint();
        const url = pdf.output('bloburl');
        printWindow.location = url;
        // Revoca el bloburl tras dar tiempo a que la ventana lo cargue.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else if (action === 'save') {
        pdf.save(filename);
      } else {
        const blob = pdf.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
          } catch (err) {
            // Cancelar el diálogo de compartir es silencioso; un fallo real sí se avisa.
            if (err?.name !== 'AbortError') showToast('No se pudo compartir el PDF.', 'error');
          }
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; a.click();
          URL.revokeObjectURL(url);
          showToast('PDF descargado');
        }
      }
    } catch {
      // Si falló la generación, cerramos la ventana de impresión en blanco.
      if (printWindow) printWindow.close();
      showToast('No se pudo generar el PDF.', 'error');
    } finally {
      setPdfLoading(false);
    }
  };

  const EDITABLE_STATES = ['borrador', 'pendiente'];

  // Transición de estado desde el panel lateral (aprobar/pagar). Bloquea la row
  // mientras corre (evita doble PUT) y la deja resaltada tras el reload.
  const cambiarEstadoDesdeHistorial = async (p, e, nuevoEstado, okMsg, errMsg) => {
    e.stopPropagation();
    if (actionLoadingId) return;
    setActionLoadingId(p.id);
    try {
      const res = await apiFetch(`/api/hr/planilla-unidad/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: nuevoEstado }),
      });
      if (!res.ok) throw new Error(await errMsgFromRes(res, errMsg));
      showToast(okMsg);
      setRecentlyTouchedId(p.id);
      fetchHistorial();
    } catch (err) {
      showToast(err?.message || errMsg, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAprobar = (p, e) =>
    cambiarEstadoDesdeHistorial(p, e, 'aprobada', 'Planilla aprobada.', 'Error al aprobar la planilla.');

  const handlePagar = (p, e) =>
    cambiarEstadoDesdeHistorial(p, e, 'pagada', 'Planilla marcada como pagada.', 'Error al pagar la planilla.');

  // Limpia el highlight transitorio de la row recién mutada.
  useEffect(() => {
    if (!recentlyTouchedId) return;
    const t = setTimeout(() => setRecentlyTouchedId(null), 2500);
    return () => clearTimeout(t);
  }, [recentlyTouchedId]);

  const handleEliminar = async (p) => {
    try {
      const res = await apiFetch(`/api/hr/planilla-unidad/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await errMsgFromRes(res, 'Error al eliminar la planilla.'));
      // Si la planilla eliminada estaba cargada en el formulario, limpiar
      if (planillaId === p.id) {
        clearSegsDraft(); clearCantsDraft(); clearFechaDraft(); clearObsDraft();
        clearDraftActive(DRAFT_FORM_KEY);
        planillaIdRef.current = null;
        setPlanillaId(null); setConsecutivo(null); setFillAll({}); setRemovedWorkerIds([]);
        dirtyRef.current = false;
      }
      showToast('Planilla eliminada.');
      fetchHistorial();
    } catch (err) {
      showToast(err?.message || 'Error al eliminar la planilla.', 'error');
    }
  };

  const handleAprobarDesdeFormulario = async () => {
    if (!planillaId) return;
    const encId = currentUser?.userId || currentUser?.uid;
    // Espera a que termine un autosave en vuelo: si dispara un POST/PUT en
    // paralelo con esta aprobación, puede crear un borrador duplicado o pisar
    // el PUT de aprobación (mismo guard que handleGuardar).
    while (saveInProgressRef.current) {
      await new Promise(r => setTimeout(r, 100));
    }
    saveInProgressRef.current = true;
    setGuardando(true);
    try {
      const body = buildPlanillaBody('aprobada', encId);
      const res = await apiFetch(`/api/hr/planilla-unidad/${planillaId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errMsgFromRes(res, 'Error al aprobar la planilla.'));
      clearSegsDraft(); clearCantsDraft(); clearFechaDraft(); clearObsDraft();
      clearDraftActive(DRAFT_FORM_KEY);
      planillaIdRef.current = null;
      setPlanillaId(null); setConsecutivo(null); setPlanillaEstado(null);
      setFillAll({}); setRemovedWorkerIds([]);
      dirtyRef.current = false;
      showToast('Planilla aprobada correctamente.');
      setShowAprobarConfirm(false);
      setShowForm(false);
      fetchHistorial();
    } catch (err) {
      showToast(err?.message || 'Error al aprobar la planilla.', 'error');
      setShowAprobarConfirm(false);
    } finally {
      saveInProgressRef.current = false;
      setGuardando(false);
    }
  };

  const handleGuardarPlantilla = async () => {
    const nombre = nombrePlantilla.trim();
    const encId = currentUser?.userId || currentUser?.uid;
    if (!nombre || !encId) return;
    if (nombre.length > MAX_NOMBRE_PLANTILLA_LEN) {
      showToast(`El nombre no puede exceder ${MAX_NOMBRE_PLANTILLA_LEN} caracteres.`, 'error');
      return;
    }
    setSavingPlantilla(true);
    try {
      const res = await apiFetch('/api/hr/plantillas-planilla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        nombre,
        segmentos,
        trabajadores: visibleWorkers.map(t => ({ trabajadorId: t.id, cantidades: cantidades[t.id] || {} })),
        encargadoId: encId,
      }),
      });
      if (!res.ok) throw new Error();
      setNombrePlantilla('');
      setShowSavePlantilla(false);
      showToast('Plantilla guardada.');
      fetchPlantillas();
    } catch {
      showToast('Error al guardar plantilla.', 'error');
    } finally {
      setSavingPlantilla(false);
    }
  };

  const handleEliminarPlantilla = async (p) => {
    try {
      const res = await apiFetch(`/api/hr/plantillas-planilla/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Plantilla eliminada.');
      fetchPlantillas();
    } catch {
      showToast('Error al eliminar plantilla.', 'error');
    }
  };

  const applyPlantilla = (p) => {
    // Reassign new IDs and build a map old→new for remapping cantidades
    const idMap = {};
    const newSegs = (p.segmentos || []).map(s => {
      const newId = newSegId();
      idMap[s.id] = newId;
      return { ...s, id: newId };
    });
    setSegmentos(newSegs);
    const newCantidades = {};
    trabajadores.forEach(t => {
      const saved = (p.trabajadores || []).find(pt => pt.trabajadorId === t.id);
      newCantidades[t.id] = {};
      newSegs.forEach(s => {
        // Find which old segment ID maps to this new one
        const oldId = Object.keys(idMap).find(k => idMap[k] === s.id);
        newCantidades[t.id][s.id] = saved?.cantidades?.[oldId] ?? '';
      });
    });
    setCantidades(newCantidades);
    setFillAll({});
    setRemovedWorkerIds([]);
    // Plantilla siempre crea planilla NUEVA — limpiar refs/ids anteriores.
    planillaIdRef.current = null;
    setPlanillaId(null);
    setPlanillaEstado(null);
    setConsecutivo(null);
    markDraftActive(DRAFT_FORM_KEY);
    dirtyRef.current = true;
    setShowForm(true);
    // Reanclar el panel a Pendientes: acabás de armar una planilla nueva, el
    // contexto de "Plantillas" ya no es el relevante.
    setHistorialTab('pendientes');
    showToast(`Plantilla "${p.nombre}" cargada.`);
  };

  const loadPlanilla = (p) => {
    originalPlanillaRef.current = p;
    setSegmentos(p.segmentos || [newSegmento()]);
    // Rebuild cantidades keyed by current worker ids; fall back to saved data
    const newCantidades = {};
    trabajadores.forEach(t => {
      const saved = (p.trabajadores || []).find(pt => pt.trabajadorId === t.id);
      newCantidades[t.id] = saved?.cantidades || {};
    });
    setCantidades(newCantidades);
    setFecha(p.fecha ? p.fecha.split('T')[0] : todayStr());
    setObservaciones(p.observaciones || '');
    planillaIdRef.current = p.id;
    setPlanillaId(p.id);
    setPlanillaEstado(p.estado || 'borrador');
    setConsecutivo(p.consecutivo);
    setFillAll({});
    setRemovedWorkerIds([]);
    markDraftActive(DRAFT_FORM_KEY);
    dirtyRef.current = false;
    setAutoSaveStatus(null);
    setShowForm(true);
  };

  // ¿El formulario actual es un borrador NUEVO con cambios sin persistir? (sin id
  // todavía y con contenido). Cargar otra planilla encima lo perdería.
  const isUnsavedNewDraft = () =>
    dirtyRef.current && !planillaIdRef.current && (
      observaciones.trim() !== '' ||
      segmentos.some(s => s.loteId || s.labor || s.grupo || s.avanceHa !== '' || s.costoUnitario !== '') ||
      Object.values(cantidades).some(segMap => Object.values(segMap || {}).some(v => v !== ''))
    );

  // Carga con guard: si pisaría un borrador nuevo sin guardar, pide confirmación.
  const requestLoadPlanilla = (p) => {
    if (p.id === planillaId) { loadPlanilla(p); return; }
    if (isUnsavedNewDraft()) setConfirmLoadPlanilla(p);
    else loadPlanilla(p);
  };

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {showAprobarConfirm && (
        <AuroraConfirmModal
          title="Aprobar planilla"
          body="Esta planilla será aprobada para pago. ¿Desea continuar?"
          confirmLabel="Aprobar"
          icon={<FiThumbsUp size={16} />}
          loadingLabel="Aprobando…"
          loading={guardando}
          onConfirm={handleAprobarDesdeFormulario}
          onCancel={() => setShowAprobarConfirm(false)}
        />
      )}

      {confirmDelPlanilla && (
        <AuroraConfirmModal
          danger
          title="Eliminar planilla"
          body={`¿Eliminar la planilla ${confirmDelPlanilla.consecutivo || ''}? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleEliminar(confirmDelPlanilla); setConfirmDelPlanilla(null); }}
          onCancel={() => setConfirmDelPlanilla(null)}
        >
          <ul className="pu-confirm-impact">
            <li><strong>Total:</strong> {fmtMoney(confirmDelPlanilla.totalGeneral)}</li>
            <li><strong>Trabajadores:</strong> {confirmDelPlanilla.trabajadores?.length || 0}</li>
            <li><strong>Segmentos:</strong> {confirmDelPlanilla.segmentos?.length || 0}</li>
            <li><strong>Fecha:</strong> {fmtDate(confirmDelPlanilla.fecha)}</li>
          </ul>
        </AuroraConfirmModal>
      )}

      {confirmDelPlantilla && (
        <AuroraConfirmModal
          danger
          title="Eliminar plantilla"
          body={`¿Eliminar la plantilla "${confirmDelPlantilla.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleEliminarPlantilla(confirmDelPlantilla); setConfirmDelPlantilla(null); }}
          onCancel={() => setConfirmDelPlantilla(null)}
        >
          <ul className="pu-confirm-impact">
            <li><strong>Segmentos:</strong> {confirmDelPlantilla.segmentos?.length || 0}</li>
          </ul>
        </AuroraConfirmModal>
      )}

      {confirmDelSegmento && (
        <AuroraConfirmModal
          danger
          title={`Eliminar segmento #${confirmDelSegmento.idx + 1}`}
          body={`Este segmento tiene cantidades cargadas para ${confirmDelSegmento.count} trabajador${confirmDelSegmento.count !== 1 ? 'es' : ''}. Al eliminarlo se pierden todas. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { removeSegmento(confirmDelSegmento.id); setConfirmDelSegmento(null); }}
          onCancel={() => setConfirmDelSegmento(null)}
        />
      )}

      {confirmLoadPlanilla && (
        <AuroraConfirmModal
          title="Cargar otra planilla"
          body="El borrador actual tiene cambios sin guardar que se perderán al cargar esta planilla. ¿Continuar?"
          confirmLabel="Cargar y descartar"
          iconVariant="warn"
          onConfirm={() => { loadPlanilla(confirmLoadPlanilla); setConfirmLoadPlanilla(null); }}
          onCancel={() => setConfirmLoadPlanilla(null)}
        />
      )}

      {/* ── Vista previa de planilla ── */}
      {previewPlanilla && (
        <AuroraModal
          size="xl"
          scrollable
          contentClassName="pu-preview-scroll"
          className="pu-preview-modal"
          preventClose={pdfLoading}
          onClose={() => setPreviewPlanilla(null)}
          title={
            <span className="pu-preview-modal-title">
              Vista previa
              {previewPlanilla.consecutivo && (
                <span className="pu-preview-consec">{previewPlanilla.consecutivo}</span>
              )}
            </span>
          }
          footer={
            <div className="pu-preview-modal-actions">
              <button className="aur-btn-text" onClick={() => generatePlanillaPdf('share')} disabled={pdfLoading}>
                <FiShare2 size={14} /> Compartir
              </button>
              <button className="aur-btn-text" onClick={() => generatePlanillaPdf('print')} disabled={pdfLoading}>
                <FiPrinter size={14} /> Imprimir
              </button>
              <button className="aur-btn-pill" onClick={() => generatePlanillaPdf('save')} disabled={pdfLoading}>
                <FiDownload size={14} /> {pdfLoading ? 'Generando…' : 'Descargar PDF'}
              </button>
            </div>
          }
        >
          <div className="pu-preview-wrap">
              {pdfLoading && (
                <div className="pu-preview-overlay" role="status" aria-live="polite">
                  <div className="pu-spinner" />
                  <p>Generando PDF…</p>
                </div>
              )}
              <div className="pu-preview-document" ref={previewRef}>
                {/* Encabezado */}
                <div className="pu-pdoc-header">
                  <div className="pu-pdoc-brand">
                    <div className="pu-pdoc-logo">
                      {(() => {
                        const logo = safeImageUrl(companyConfig.logoUrl);
                        if (logo) return <img src={logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4 }} />;
                        return companyConfig.nombreEmpresa
                          ? companyConfig.nombreEmpresa.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                          : 'AU';
                      })()}
                    </div>
                    <div className="pu-pdoc-brand-info">
                      <div className="pu-pdoc-brand-name">{companyConfig.nombreEmpresa || 'Finca Aurora'}</div>
                      {companyConfig.identificacion && <div className="pu-pdoc-brand-detail">Identificación: {companyConfig.identificacion}</div>}
                      {companyConfig.whatsapp && <div className="pu-pdoc-brand-detail">Teléfono: {companyConfig.whatsapp}</div>}
                      {companyConfig.direccion && <div className="pu-pdoc-brand-detail">Dirección: {companyConfig.direccion}</div>}
                    </div>
                  </div>
                  <div className="pu-pdoc-title-block">
                    <div className="pu-pdoc-title">Planilla por Unidad / Hora</div>
                    <table className="pu-pdoc-meta-table">
                      <tbody>
                        <tr><td>N°:</td><td><strong>{previewPlanilla.consecutivo || '—'}</strong></td></tr>
                        <tr>
                          <td>Fecha:</td>
                          <td><strong>{fmtDate(previewPlanilla.fecha)}</strong></td>
                        </tr>
                        <tr>
                          <td>Encargado:</td>
                          <td><strong>{previewPlanilla.encargadoNombre || '—'}</strong></td>
                        </tr>
                        <tr>
                          <td>Estado:</td>
                          <td>
                            <span className={`pu-pdoc-estado pu-pdoc-estado--${previewPlanilla.estado}`}>
                              {ESTADO_LABEL[previewPlanilla.estado] || previewPlanilla.estado}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Tabla unificada — misma disposición que el formulario */}
                {(() => {
                  const segs = previewPlanilla.segmentos || [];
                  const workers = (previewPlanilla.trabajadores || [])
                    .filter(t => Object.values(t.cantidades || {}).some(v => v && Number(v) !== 0));
                  const compactLabor = segs.length > 4;
                  const parsedLabores = segs.map(seg => parseLaborString(seg.labor));
                  // Unique labores for the legend (deduplicated by codigo)
                  const laborLegend = compactLabor
                    ? [...new Map(parsedLabores.filter(l => l.codigo).map(l => [l.codigo, l])).values()]
                    : [];
                  return (
                    <>
                    <table className="pu-pdoc-table pu-pdoc-unified">
                      <colgroup>
                        <col className="pu-pdoc-col-label" />
                        {segs.map((_, i) => <col key={i} />)}
                        <col className="pu-pdoc-col-total" />
                      </colgroup>
                      <tbody>
                        {/* LOTE */}
                        <tr>
                          <td className="pu-pdoc-label-cell">LOTE</td>
                          {segs.map((seg, i) => <td key={i}>{seg.loteNombre || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* GRUPO */}
                        <tr>
                          <td className="pu-pdoc-label-cell">GRUPO</td>
                          {segs.map((seg, i) => <td key={i}>{seg.grupo || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* LABOR */}
                        <tr>
                          <td className="pu-pdoc-label-cell">LABOR</td>
                          {parsedLabores.map((l, i) => (
                            <td key={i}>
                              {l.codigo
                                ? compactLabor ? l.codigo : `${l.codigo} - ${l.descripcion}`
                                : '—'}
                            </td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* AVANCE */}
                        <tr>
                          <td className="pu-pdoc-label-cell">AVANCE (Ha)</td>
                          {segs.map((seg, i) => (
                            <td key={i}>{seg.avanceHa !== '' && seg.avanceHa != null ? seg.avanceHa : '—'}</td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* UNIDAD */}
                        <tr>
                          <td className="pu-pdoc-label-cell">UNIDAD</td>
                          {segs.map((seg, i) => <td key={i}>{seg.unidad || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* COSTO UNITARIO */}
                        <tr className="pu-pdoc-row-config-last">
                          <td className="pu-pdoc-label-cell">COSTO UNITARIO</td>
                          {segs.map((seg, i) => (
                            <td key={i}>
                              {isHoraUnit(seg.unidad)
                                ? 'por trabajador'
                                : (isHoraUnit(seg.unidadBase) && seg.factorConversion != null)
                                  ? `×${seg.factorConversion} por trabajador`
                                  : (seg.costoUnitario ? fmtMoney(seg.costoUnitario) : '—')}
                            </td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* Encabezado de trabajadores */}
                        <tr className="pu-pdoc-row-workers-hdr">
                          <td className="pu-pdoc-label-cell pu-pdoc-workers-label">NOMBRE</td>
                          {segs.map((_, i) => (
                            <td key={i} className="pu-pdoc-workers-qty-hdr">CANTIDAD</td>
                          ))}
                          <td className="pu-pdoc-workers-total-hdr">TOTAL GENERAL</td>
                        </tr>

                        {/* Trabajadores */}
                        {workers.map(t => (
                          <tr key={t.trabajadorId} className="pu-pdoc-row-worker">
                            <td className="pu-pdoc-worker-name">{t.trabajadorId === currentUser?.userId ? <em><strong>{t.trabajadorNombre}</strong></em> : t.trabajadorNombre}</td>
                            {segs.map((seg, i) => (
                              <td key={i} className="pu-pdoc-td-center">
                                {t.cantidades?.[seg.id] || '—'}
                              </td>
                            ))}
                            <td className="pu-pdoc-td-right pu-pdoc-td-bold">{fmtMoney(t.total)}</td>
                          </tr>
                        ))}

                        {/* Totales */}
                        <tr className="pu-pdoc-row-totals">
                          <td className="pu-pdoc-label-cell">TOTALES</td>
                          {segs.map((seg, i) => {
                            const sum = workers.reduce((acc, t) => {
                              const v = t.cantidades?.[seg.id];
                              return acc + (v && Number(v) !== 0 ? Number(v) : 0);
                            }, 0);
                            return (
                              <td key={i} className="pu-pdoc-td-center">
                                {sum > 0 ? sum.toLocaleString('es-CR', { maximumFractionDigits: 2 }) : '—'}
                              </td>
                            );
                          })}
                          <td className="pu-pdoc-td-right pu-pdoc-td-bold pu-pdoc-grand-total-cell">
                            {fmtMoney(previewPlanilla.totalGeneral)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {compactLabor && laborLegend.length > 0 && (
                      <div className="pu-pdoc-labor-legend">
                        <span className="pu-pdoc-labor-legend-title">Labores: </span>
                        {laborLegend.map((l, i) => (
                          <span key={l.codigo} className="pu-pdoc-labor-legend-item">
                            <strong>{l.codigo}</strong>{l.descripcion ? `: ${l.descripcion}` : ''}
                            {i < laborLegend.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    </>
                  );
                })()}

                {/* Observaciones */}
                {previewPlanilla.observaciones && (
                  <div style={{ marginTop: 14 }}>
                    <div className="pu-pdoc-section-label">Observaciones</div>
                    <p className="pu-pdoc-obs-text">{previewPlanilla.observaciones}</p>
                  </div>
                )}

                <div className="pu-pdoc-footer">
                  Generado por Aurora · {new Date().toLocaleDateString('es-CR')}
                </div>
              </div>
          </div>
        </AuroraModal>
      )}

      {/* ── Estado de carga / vacío / lista ── */}
      {!showForm && historialLoading && (
        <div className="pu-full-empty-state">
          <div className="pu-spinner" />
          <p>Cargando planillas…</p>
        </div>
      )}

      {/* ── Formulario ── */}
      {showForm && (
      <div className="pu-page-layout">
      <div className="pu-main-col">

      {/* ── Sección 1: Encabezado (Fecha + Encargado) ── */}
      <div className="form-card pu-section-card pu-section-header-card">
        <div className="pu-section-title-row">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            Planilla por Unidad / Hora
            {consecutivo && <span className="status-badge status-badge--pendiente" style={{ marginLeft: 10 }}>{consecutivo}</span>}
          </h2>
          <span className="pu-autosave-status" role="status" aria-live="polite">
            {autoSaveStatus === 'saving' && 'Guardando…'}
            {autoSaveStatus === 'saved'  && 'Borrador guardado'}
            {autoSaveStatus === 'error'  && 'Error al guardar'}
          </span>
        </div>
        {currentUser && !currentUser.userId && currentUser.rol !== 'administrador' && (
          <div className="pu-warning">
            Tu cuenta no está vinculada a un perfil de empleado. Pide a un administrador que registre tu usuario con el mismo correo.
          </div>
        )}
        <div className="pu-header-fields">
          <div className="pu-hf-row">
            <span className="pu-hf-label">FECHA</span>
            <input
              className="ut-ctrl ut-ctrl--date"
              type="date"
              min={FECHA_MIN}
              max={FECHA_MAX}
              value={fecha}
              onChange={e => { dirtyRef.current = true; setFecha(e.target.value); }}
            />
          </div>
          <div className="pu-hf-row">
            <span className="pu-hf-label">ENCARGADO</span>
            <input className="ut-ctrl input-readonly" value={currentUser?.nombre || '—'} readOnly />
          </div>
        </div>
      </div>

      {/* ── Sección 2: Cuerpo de segmentos ── */}
      <div className="form-card pu-table-card pu-section-card pu-section-body-card">
        <div className="pu-table-toolbar">
          <button ref={nuevoSegmentoRef} className="aur-btn-text" onClick={() => addSegmento(true)}>
            <FiPlus size={14} /> Agregar segmento
          </button>
        </div>

        <div className="unidad-table-wrap">
          <table className="unidad-table">
            <colgroup>
              <col style={{ width: 170 }} />
              {segmentos.map(s => <col key={s.id} style={{ minWidth: 150 }} />)}
              <col style={{ width: 130 }} />
            </colgroup>
            <tbody>

              {/* ── Encabezados de segmentos ── */}
              <tr className="ut-row-seg-title">
                <td className="ut-label-cell" />
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className="ut-seg-title-cell">
                    <span className="ut-seg-num">#{idx + 1}</span>
                    {segmentos.length > 1 && (
                      <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger ut-del-btn" onClick={() => requestRemoveSegmento(seg.id, idx)} title={`Eliminar segmento #${idx + 1}`} aria-label={`Eliminar segmento #${idx + 1}`}>
                        <FiTrash2 size={13} />
                      </button>
                    )}
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LOTE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LOTE</td>
                {segmentos.map((seg) => (
                  <td key={seg.id} className="ut-config-cell">
                    <select
                      ref={el => { loteRefs.current[seg.id] = el; }}
                      className="ut-ctrl" value={seg.loteId}
                      onKeyDown={makeColTabHandler(seg.id, null, grupoRefs)}
                      onChange={e => {
                        updSeg(seg.id, 'loteId', e.target.value);
                        grupoRefs.current[seg.id]?.focus();
                      }}>
                      <option value="">— Seleccionar —</option>
                      {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                    </select>
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── GRUPO ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">GRUPO</td>
                {segmentos.map((seg) => {
                  const gruposFiltrados = seg.loteId
                    ? (() => {
                        const ids = new Set(siembras.filter(s => s.loteId === seg.loteId).map(s => s.id));
                        return gruposCat.filter(g => Array.isArray(g.bloques) && g.bloques.some(b => ids.has(b)));
                      })()
                    : [];
                  return (
                    <td key={seg.id} className="ut-config-cell">
                      <GrupoCombobox
                        ref={el => { grupoRefs.current[seg.id] = el; }}
                        value={seg.grupo}
                        grupos={gruposFiltrados}
                        siembras={siembras}
                        onChange={v => updSeg(seg.id, 'grupo', v)}
                        onAfterSelect={() => laborRefs.current[seg.id]?.focus()}
                        onTabDown={makeColTabHandler(seg.id, loteRefs, laborRefs)}
                      />
                    </td>
                  );
                })}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LABOR ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LABOR</td>
                {segmentos.map((seg) => (
                  <td key={seg.id} className="ut-config-cell">
                    <LaborCombobox
                      ref={el => { laborRefs.current[seg.id] = el; }}
                      value={seg.labor}
                      labores={laboresCat}
                      onChange={v => updSeg(seg.id, 'labor', v)}
                      onAfterSelect={() => avanceRefs.current[seg.id]?.focus()}
                      onTabDown={makeColTabHandler(seg.id, grupoRefs, avanceRefs)}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── AVANCE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">AVANCE (Ha)</td>
                {segmentos.map((seg) => (
                  <td key={seg.id} className="ut-config-cell">
                    <input
                      ref={el => { avanceRefs.current[seg.id] = el; }}
                      className="ut-ctrl" type="number" min="0" max={MAX_AVANCE_HA} step="0.01"
                      value={seg.avanceHa} onChange={e => updSeg(seg.id, 'avanceHa', e.target.value)}
                      placeholder="0.00"
                      onKeyDown={e => {
                        if (e.key === 'Tab') { makeColTabHandler(seg.id, laborRefs, unidadRefs)(e); return; }
                        if (e.key === 'Enter') { e.preventDefault(); unidadRefs.current[seg.id]?.focus(); }
                      }}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── UNIDAD ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">UNIDAD</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <UnidadCombobox
                      ref={el => { unidadRefs.current[seg.id] = el; }}
                      value={seg.unidad}
                      unidades={unidadesCat}
                      onChange={(nombre, precio, factorConversion, unidadBase) => {
                        setSegmentos(prev => prev.map(s => {
                          if (s.id !== seg.id) return s;
                          const usaHora = isHoraUnit(nombre) || (isHoraUnit(unidadBase) && factorConversion != null);
                          return {
                            ...s,
                            unidad: nombre,
                            costoUnitario: (!usaHora && precio != null && precio !== '') ? precio : s.costoUnitario,
                            factorConversion: factorConversion ?? null,
                            unidadBase: unidadBase || '',
                          };
                        }));
                      }}
                      onAfterSelect={() => costoRefs.current[seg.id]?.focus()}
                      onTabDown={makeColTabHandler(seg.id, avanceRefs, costoRefs)}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── COSTO UNITARIO ── */}
              <tr className="ut-row-config ut-row-config--last">
                <td className="ut-label-cell">COSTO UNITARIO</td>
                {segmentos.map((seg) => (
                  <td key={seg.id} className="ut-config-cell">
                    {isHoraUnit(seg.unidad) ? (
                      <span className="ut-por-trabajador-label">por trabajador</span>
                    ) : isHoraUnit(seg.unidadBase) && seg.factorConversion != null ? (
                      <span className="ut-por-trabajador-label">×{seg.factorConversion} por trabajador</span>
                    ) : (
                      <input
                        ref={el => { costoRefs.current[seg.id] = el; }}
                        className="ut-ctrl" type="number" min="0" max={MAX_NUMERIC_INPUT} step="any"
                        value={seg.costoUnitario} onChange={e => updSeg(seg.id, 'costoUnitario', e.target.value)}
                        placeholder="0"
                        onKeyDown={e => {
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            if (e.shiftKey) { unidadRefs.current[seg.id]?.focus(); return; }
                            const firstT = visibleWorkers[0];
                            if (firstT) cantidadRefs.current[seg.id]?.[firstT.id]?.focus();
                            return;
                          }
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const firstT = visibleWorkers[0];
                            if (firstT) cantidadRefs.current[seg.id]?.[firstT.id]?.focus();
                          }
                        }}
                      />
                    )}
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── Encabezado de sección trabajadores ── */}
              <tr className="ut-row-workers-header">
                <td className="ut-label-cell">NOMBRE</td>
                {segmentos.map((seg) => (
                  <td key={seg.id} className="ut-workers-col-header">
                    <div className="ut-col-header-label">Cantidad</div>
                    <div className="ut-fill-all">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={MAX_NUMERIC_INPUT}
                        placeholder="= todos"
                        className="ut-fill-input"
                        value={fillAll[seg.id] ?? ''}
                        onChange={e => setFillAll(prev => ({ ...prev, [seg.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            applyFillAll(seg.id);
                            cantidadRefs.current[seg.id]?.[visibleWorkers[0]?.id]?.focus();
                          }
                        }}
                      />
                      <button
                        className="ut-fill-btn"
                        title="Aplicar a todos"
                        aria-label="Aplicar esta cantidad a todos los trabajadores"
                        onClick={() => applyFillAll(seg.id)}
                      >
                        <FiCheck size={11} />
                      </button>
                    </div>
                  </td>
                ))}
                <td className="ut-workers-col-header ut-total-col-header">TOTAL GENERAL</td>
              </tr>

              {/* ── Trabajadores ── */}
              {trabajadores.length === 0 ? (
                <tr>
                  <td colSpan={segmentos.length + 2} className="ut-empty-row">
                    No hay trabajadores asignados. Ve a <strong>Gestión de Usuarios</strong> y selecciona este encargado en la ficha de cada trabajador.
                  </td>
                </tr>
              ) : visibleWorkers.length === 0 ? (
                <tr>
                  <td colSpan={segmentos.length + 2} className="ut-empty-row">
                    Todos los trabajadores están ocultos.
                  </td>
                </tr>
              ) : (
                visibleWorkers.map(t => (
                  <tr key={t.id} className="ut-row-worker">
                    <td className="ut-worker-name">
                      <div className="ut-worker-name-inner">
                        <button
                          className="ut-remove-worker-btn"
                          title={`Quitar a ${t.nombre} de esta planilla`}
                          aria-label={`Quitar a ${t.nombre} de esta planilla`}
                          onClick={() => { dirtyRef.current = true; setRemovedWorkerIds(prev => [...prev, t.id]); }}
                        >
                          <FiX size={10} />
                        </button>
                        {t.esEncargadoActual ? <><em><strong>{t.nombre}</strong></em><span className="sr-only"> (vos, encargado)</span></> : t.nombre}
                      </div>
                    </td>
                    {segmentos.map((seg) => (
                      <td key={seg.id} className="ut-cant-cell">
                        <input
                          ref={el => {
                            if (!cantidadRefs.current[seg.id]) cantidadRefs.current[seg.id] = {};
                            cantidadRefs.current[seg.id][t.id] = el;
                          }}
                          type="number" min="0" max={MAX_NUMERIC_INPUT} step="0.01"
                          value={cantidades[t.id]?.[seg.id] ?? ''}
                          onChange={e => setCantidad(t.id, seg.id, e.target.value)}
                          onKeyDown={e => {
                            const idx = visibleWorkers.findIndex(w => w.id === t.id);
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              if (!e.shiftKey) {
                                // TAB → siguiente trabajador (misma columna)
                                const next = visibleWorkers[idx + 1];
                                if (next) cantidadRefs.current[seg.id]?.[next.id]?.focus();
                              } else {
                                // Shift+TAB → trabajador anterior (misma columna)
                                const prev = visibleWorkers[idx - 1];
                                if (prev) cantidadRefs.current[seg.id]?.[prev.id]?.focus();
                              }
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              const nextWorker = visibleWorkers[idx + 1];
                              if (nextWorker) {
                                cantidadRefs.current[seg.id]?.[nextWorker.id]?.focus();
                              } else {
                                const segIdx = segmentos.findIndex(s => s.id === seg.id);
                                const nextSeg = segmentos[segIdx + 1];
                                if (nextSeg) {
                                  loteRefs.current[nextSeg.id]?.focus();
                                } else {
                                  nuevoSegmentoRef.current?.focus();
                                }
                              }
                            }
                          }}
                          className="ut-cant-input"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="ut-worker-total">{fmtMoney(workerTotals.get(t.id))}</td>
                  </tr>
                ))
              )}

              {/* ── Fila de totales ── */}
              {visibleWorkers.length > 0 && (
                <tr className="ut-row-totals">
                  <td className="ut-label-cell">TOTALES</td>
                  {segmentos.map((seg) => {
                    const total = segTotals.get(seg.id) || 0;
                    return (
                      <td key={seg.id} className="ut-cant-cell ut-total-cant">
                        {total > 0
                          ? total.toLocaleString('es-CR', { maximumFractionDigits: 2 })
                          : '—'}
                      </td>
                    );
                  })}
                  <td className="ut-worker-total ut-grand-total">{fmtMoney(grandTotalMemo)}</td>
                </tr>
              )}

            </tbody>
          </table>
        </div>

        {removedWorkerIds.length > 0 && (
          <div className="ut-hidden-workers-bar">
            <span>
              {removedWorkerIds.length} trabajador{removedWorkerIds.length !== 1 ? 'es' : ''} oculto{removedWorkerIds.length !== 1 ? 's' : ''} · sus cantidades se conservan
            </span>
            <button className="ut-restore-btn" title="Vuelve a mostrar los trabajadores con sus cantidades intactas" onClick={() => { dirtyRef.current = true; setRemovedWorkerIds([]); }}>
              Restaurar todos
            </button>
          </div>
        )}

      </div>{/* /pu-section-body-card */}

      {/* ── Sección 3: Observaciones + acciones ── */}
      <div className="form-card pu-section-card pu-section-footer-card">
        <div className="form-control">
          <label>Observaciones</label>
          <textarea
            value={observaciones}
            onChange={e => { dirtyRef.current = true; setObservaciones(e.target.value); }}
            placeholder="Notas adicionales..."
            rows={3}
            maxLength={MAX_OBSERVACIONES_LEN}
          />
        </div>
        <div className="form-actions" style={{ marginTop: 14 }}>
          {planillaEstado === 'pendiente' ? (
            // El botón de aprobar sólo se muestra a quien puede aprobar en el
            // backend (supervisor/admin/rrhh). Defensa secundaria: el PUT igual
            // rechaza con 403, pero así el encargado dueño no ve una acción que
            // fallaría. Si no puede aprobar, la planilla queda en espera.
            canAprobar ? (
              <button className="aur-btn-pill" onClick={() => setShowAprobarConfirm(true)} disabled={guardando}>
                <FiThumbsUp size={15} />
                Aprobar
              </button>
            ) : (
              <span className="pu-await-approval">Planilla en espera de aprobación.</span>
            )
          ) : (
            <button className="aur-btn-pill" onClick={() => handleGuardar('pendiente')} disabled={guardando || trabajadores.length === 0 || (!currentUser?.userId && currentUser?.rol !== 'administrador')}>
              <FiSave size={15} />
              {guardando ? 'Guardando…' : 'Guardar planilla'}
            </button>
          )}
          <button
            className="aur-btn-text"
            onClick={() => {
              if (planillaEstado === 'pendiente' && originalPlanillaRef.current) {
                loadPlanilla(originalPlanillaRef.current);
              } else {
                clearSegsDraft();
                clearCantsDraft();
                clearFechaDraft();
                clearObsDraft();
                clearDraftActive(DRAFT_FORM_KEY);
                planillaIdRef.current = null;
                setPlanillaId(null);
                setConsecutivo(null);
                setPlanillaEstado(null);
                setAutoSaveStatus(null);
                setFillAll({});
                setRemovedWorkerIds([]);
                dirtyRef.current = false;
                setShowForm(false);
              }
            }}
            disabled={guardando}
          >
            Cancelar
          </button>
        </div>
      </div>
      </div>{/* /pu-main-col */}

      {/* ── Panel lateral: Historial / Plantillas ── */}
      <div className="pu-history-col">
        <div className="form-card pu-history-card">

          {/* Tabs */}
          <div className="pu-panel-tabs" role="tablist" aria-label="Vista del panel lateral">
            {[{ key: 'pendientes', label: 'Pendientes' }, { key: 'plantillas', label: 'Plantillas' }].map((t, idx, arr) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={historialTab === t.key}
                tabIndex={historialTab === t.key ? 0 : -1}
                className={`pu-panel-tab${historialTab === t.key ? ' pu-panel-tab--active' : ''}`}
                onClick={() => setHistorialTab(t.key)}
                onKeyDown={e => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = arr[(idx + (e.key === 'ArrowRight' ? 1 : arr.length - 1)) % arr.length];
                    setHistorialTab(next.key);
                  }
                }}
              >
                {t.label}
              </button>
            ))}
            {historialTab === 'pendientes' && (
              <button className="aur-icon-btn aur-icon-btn--sm" onClick={fetchHistorial} title="Actualizar" aria-label="Actualizar lista de planillas" style={{ marginLeft: 'auto' }}>
                <FiRefreshCw size={14} />
              </button>
            )}
          </div>

          {/* ── Tab Planillas ── */}
          {historialTab === 'pendientes' && (
            historialError ? (
              <EmptyState
                variant="compact"
                icon={FiFileText}
                title="No se pudieron cargar las planillas"
                subtitle="Revisá tu conexión e intentá de nuevo."
                action={<button className="aur-btn-text" onClick={fetchHistorial}>Reintentar</button>}
              />
            ) : historial.length === 0 ? (
              <EmptyState
                variant="compact"
                icon={FiFileText}
                title="No hay planillas pendientes"
                subtitle="Completá el formulario de la izquierda y guardá para crear la primera."
              />
            ) : (
              <ul className="pu-history-list">
                {historial.map(p => {
                  const editable = EDITABLE_STATES.includes(p.estado);
                  const handleRowClick = () => {
                    if (editable) requestLoadPlanilla(p);
                    else setPreviewPlanilla(p);
                  };
                  return (
                  <li
                    key={p.id}
                    className={`pu-history-item pu-history-item--editable${planillaId === p.id ? ' pu-history-item--active' : ''}${recentlyTouchedId === p.id ? ' pu-history-item--touched' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${editable ? 'Cargar y editar' : 'Ver'} planilla ${p.consecutivo || ''} · ${ESTADO_LABEL[p.estado] || p.estado}`}
                    onClick={handleRowClick}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                        e.preventDefault();
                        handleRowClick();
                      }
                    }}
                    title={editable ? 'Clic para cargar y editar' : 'Clic para ver'}
                  >
                    <div className="pu-history-top">
                      <span className="pu-history-consec">{p.consecutivo || '—'}</span>
                      <span className={`status-badge status-badge--${ESTADO_CLASS[p.estado] || 'pendiente'}`}>
                        {ESTADO_LABEL[p.estado] || p.estado}
                      </span>
                      {editable ? <FiEdit2 size={11} className="pu-history-edit-icon" /> : <FiEye size={11} className="pu-history-edit-icon" />}
                    </div>
                    <div className="pu-history-encargado">{p.encargadoNombre || '—'}</div>
                    <div className="pu-history-meta">
                      {fmtDate(p.fecha)}
                      {' · '}
                      {p.segmentos?.length || 0} segmento{p.segmentos?.length !== 1 ? 's' : ''}
                      {' · '}
                      {countTrabajadoresConCantidad(p.trabajadores)} trab.
                    </div>
                    <div className="pu-history-bottom">
                      <span className="pu-history-total">
                        {fmtMoney(p.totalGeneral)}
                      </span>
                      <div className="pu-history-actions">
                        {editable && (
                          <button
                            className="pu-history-delete-btn"
                            onClick={e => { e.stopPropagation(); setConfirmDelPlanilla(p); }}
                            title="Eliminar planilla"
                            aria-label={`Eliminar planilla ${p.consecutivo || ''}`}
                            disabled={actionLoadingId != null}
                          >
                            <FiTrash2 size={13} />
                          </button>
                        )}
                        {p.estado === 'pendiente' && canAprobar && (
                          <button
                            className="pu-history-preview-btn pu-history-preview-btn--approve"
                            onClick={e => handleAprobar(p, e)}
                            title="Aprobar planilla"
                            disabled={actionLoadingId != null}
                          >
                            <FiThumbsUp size={13} /> {actionLoadingId === p.id ? 'Aprobando…' : 'Aprobar'}
                          </button>
                        )}
                        {p.estado === 'aprobada' && canPagar && (
                          <button
                            className="pu-history-preview-btn pu-history-preview-btn--pay"
                            onClick={e => handlePagar(p, e)}
                            title="Pagar planilla"
                            disabled={actionLoadingId != null}
                          >
                            <FiCheckCircle size={13} /> {actionLoadingId === p.id ? 'Pagando…' : 'Pagar'}
                          </button>
                        )}
                        <button
                          className="pu-history-preview-btn"
                          onClick={e => { e.stopPropagation(); setPreviewPlanilla(p); }}
                          title="Ver vista previa"
                          aria-label="Ver vista previa"
                        >
                          <FiEye size={13} /> Ver
                        </button>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )
          )}

          {/* ── Tab Plantillas ── */}
          {historialTab === 'plantillas' && (
            <div className="pu-plantillas-tab">
              {!showSavePlantilla ? (
                <button
                  className="pu-save-plantilla-btn"
                  onClick={() => setShowSavePlantilla(true)}
                >
                  <FiPlus size={13} /> Guardar segmentos actuales como plantilla
                </button>
              ) : (
                <div className="pu-plantilla-name-form">
                  <input
                    className="pu-plantilla-name-input"
                    placeholder="Nombre de la plantilla…"
                    value={nombrePlantilla}
                    onChange={e => setNombrePlantilla(e.target.value)}
                    maxLength={MAX_NOMBRE_PLANTILLA_LEN}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleGuardarPlantilla();
                      if (e.key === 'Escape') { setShowSavePlantilla(false); setNombrePlantilla(''); }
                    }}
                    autoFocus
                  />
                  <div className="pu-plantilla-name-actions">
                    <button
                      className="aur-btn-pill"
                      onClick={handleGuardarPlantilla}
                      disabled={!nombrePlantilla.trim() || savingPlantilla}
                    >
                      {savingPlantilla ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      className="aur-btn-text"
                      onClick={() => { setShowSavePlantilla(false); setNombrePlantilla(''); }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {plantillas.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={FiSave}
                  title="No hay plantillas guardadas"
                  subtitle="Guarda la configuración de una planilla para reutilizarla luego."
                />
              ) : (
                <ul className="pu-plantilla-list">
                  {plantillas.map(p => (
                    <li key={p.id} className="pu-plantilla-item">
                      <div className="pu-plantilla-nombre">{p.nombre}</div>
                      <div className="pu-plantilla-meta">
                        {p.segmentos?.length || 0} segmento{p.segmentos?.length !== 1 ? 's' : ''}
                      </div>
                      <div className="pu-plantilla-actions">
                        <button
                          className="aur-btn-text"
                          onClick={() => applyPlantilla(p)}
                        >
                          Usar plantilla
                        </button>
                        <button
                          className="pu-history-delete-btn"
                          onClick={() => setConfirmDelPlantilla(p)}
                          title="Eliminar plantilla"
                          aria-label={`Eliminar plantilla ${p.nombre}`}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        </div>
      </div>

      </div>
      )}
    </div>
  );
}

export default UnitPayroll;
