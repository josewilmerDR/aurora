import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FiFileText, FiPrinter, FiShare2, FiX, FiCheckCircle, FiPlusCircle, FiEye, FiAlertTriangle, FiArrowLeft, FiClock, FiEdit2 } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import CedulaNuevaModal from '../components/CedulaNuevaModal';
import MezclaListaModal from '../components/MezclaListaModal';
import AuroraTimePicker from '../../../components/AuroraTimePicker';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import '../styles/cedulas.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return new Date(ts);
};

const formatDateLong = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

const PARAM_DEFAULTS = {
  diasSiembraICosecha: 400,
  diasForzaICosecha:   150,
  diasChapeaIICosecha: 215,
  diasForzaIICosecha:  150,
};

const calcFechaCosecha = (source, config) => {
  if (!source?.fechaCreacion) return null;
  const cosecha = source.cosecha || '';
  const etapa   = source.etapa   || '';
  const cfg = { ...PARAM_DEFAULTS, ...config };
  let dias = null;
  if (cosecha === 'I Cosecha') {
    if (etapa === 'Desarrollo')  dias = cfg.diasSiembraICosecha;
    else if (etapa === 'Postforza') dias = cfg.diasForzaICosecha;
  } else if (cosecha === 'II Cosecha') {
    if (etapa === 'Desarrollo')  dias = cfg.diasChapeaIICosecha;
    else if (etapa === 'Postforza') dias = cfg.diasForzaIICosecha;
  }
  if (dias == null) return null;
  const base = tsToDate(source.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + Number(dias));
  return result;
};

const formatShortDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

const isOverdue = (task) => {
  if (task.status === 'completed_by_user') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  return new Date(due.getFullYear(), due.getMonth(), due.getDate())
    < new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

// Tareas creadas manualmente por el usuario (fuera del paquete) — task.type === 'MANUAL'
const isManualTask = (task) => task?.type === 'MANUAL';

const CEDULA_STATUS_LABEL = {
  pendiente:          'Pendiente',
  en_transito:        'En Tránsito',
  aplicada_en_campo:  'Aplicada',
};


// ── Modal Aplicada en Campo ───────────────────────────────────────────────────
const CONDICIONES_TIEMPO = ['Soleado', 'Despejado', 'Parcialmente nublado', 'Nublado', 'Llovizna', 'Lluvia', 'Ventoso', 'Niebla', 'Tormenta'];

const nowTimeStr = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
};

function AplicadaModal({ lotes, currentUser, prefill, onClose, onConfirm }) {
  const [sobrante,          setSobrante]          = useState(false);
  const [sobranteLoteId,    setSobranteLoteId]    = useState('');
  const [condicionesTiempo, setCondicionesTiempo] = useState('');
  const [temperatura,       setTemperatura]       = useState('');
  const [humedadRelativa,   setHumedadRelativa]   = useState('');
  const [horaInicio,        setHoraInicio]        = useState('');
  const [horaFinal,         setHoraFinal]         = useState(() => nowTimeStr());
  const [operario,          setOperario]          = useState(() => currentUser?.nombre || '');
  const [metodoAplicacion,  setMetodoAplicacion]  = useState(() => prefill?.metodoAplicacion || '');
  const [encargadoFinca,    setEncargadoFinca]    = useState(() => prefill?.encargadoFinca || '');
  const [encargadoBodega,   setEncargadoBodega]   = useState(() => prefill?.encargadoBodega || '');
  const [supAplicaciones,   setSupAplicaciones]   = useState(() => prefill?.supAplicaciones || '');
  const [observacionesAplicacion, setObservacionesAplicacion] = useState('');
  const [fetchingWeather,   setFetchingWeather]   = useState(false);

  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    setFetchingWeather(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`
          );
          const d = await r.json();
          if (cancelled) return;
          if (d.current?.temperature_2m    != null) setTemperatura(String(d.current.temperature_2m));
          if (d.current?.relative_humidity_2m != null) setHumedadRelativa(String(d.current.relative_humidity_2m));
        } catch { /* sin internet o API no disponible — el usuario llena manualmente */ }
        if (!cancelled) setFetchingWeather(false);
      },
      () => { if (!cancelled) setFetchingWeather(false); },
      { timeout: 8000 }
    );
    return () => { cancelled = true; };
  }, []);

  const handleConfirm = () => {
    setFormError('');
    if (sobrante && !sobranteLoteId) {
      setFormError('Seleccione el lote donde fue depositado el sobrante.');
      return;
    }
    if (horaInicio && horaFinal && horaInicio >= horaFinal) {
      setFormError('La hora de inicio debe ser menor que la hora final.');
      return;
    }
    let tempNum = null;
    if (temperatura !== '' && temperatura != null) {
      tempNum = Number(temperatura);
      if (!Number.isFinite(tempNum) || tempNum < -60 || tempNum > 70) {
        setFormError('Temperatura fuera de rango (-60 a 70 °C).');
        return;
      }
    }
    let humNum = null;
    if (humedadRelativa !== '' && humedadRelativa != null) {
      humNum = Number(humedadRelativa);
      if (!Number.isFinite(humNum) || humNum < 0 || humNum > 100) {
        setFormError('Humedad relativa fuera de rango (0 a 100 %).');
        return;
      }
    }
    if (observacionesAplicacion.length > 500) {
      setFormError('Las observaciones no pueden exceder 500 caracteres.');
      return;
    }
    onConfirm({
      sobrante,
      sobranteLoteId:     sobrante ? sobranteLoteId   : null,
      sobranteLoteNombre: sobrante ? (lotes.find(l => l.id === sobranteLoteId)?.nombreLote || null) : null,
      condicionesTiempo:  condicionesTiempo || null,
      temperatura:        tempNum,
      humedadRelativa:    humNum,
      horaInicio:         horaInicio  || null,
      horaFinal:          horaFinal   || null,
      operario:           (operario   || '').trim().slice(0, 200) || null,
      metodoAplicacion:   (metodoAplicacion || '').trim().slice(0, 200) || null,
      encargadoFinca:     (encargadoFinca   || '').trim().slice(0, 200) || null,
      encargadoBodega:    (encargadoBodega  || '').trim().slice(0, 200) || null,
      supAplicaciones:    (supAplicaciones  || '').trim().slice(0, 200) || null,
      observacionesAplicacion: (observacionesAplicacion || '').trim().slice(0, 500) || null,
    });
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={onClose}>
      <div className="aur-modal aur-modal--lg" onPointerDown={e => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FaTractor size={14} />
          </span>
          <span className="aur-modal-title">Confirmar aplicación en campo</span>
        </div>

        <div className="aur-modal-content">
          {formError && (
            <div className="aur-banner aur-banner--danger">
              <FiAlertTriangle size={14} />
              <span>{formError}</span>
            </div>
          )}

          <div className="aur-list">
            <div className="aur-row">
              <span className="aur-row-label">¿Hubo sobrante de mezcla?</span>
              <label className="aur-toggle">
                <input
                  type="checkbox"
                  checked={sobrante}
                  onChange={e => setSobrante(e.target.checked)}
                />
                <span className="aur-toggle-track">
                  <span className="aur-toggle-thumb" />
                </span>
                <span className="aur-toggle-label">{sobrante ? 'Sí' : 'No'}</span>
              </label>
            </div>

            {sobrante && (
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="apl-sobrante-lote">Lote del sobrante</label>
                <select
                  id="apl-sobrante-lote"
                  className="aur-select"
                  value={sobranteLoteId}
                  onChange={e => setSobranteLoteId(e.target.value)}
                >
                  <option value="">— Seleccionar lote —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>
            )}

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-tiempo">Condiciones del tiempo</label>
              <select
                id="apl-tiempo"
                className="aur-select"
                value={condicionesTiempo}
                onChange={e => setCondicionesTiempo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {CONDICIONES_TIEMPO.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-temp">
                Temperatura (°C){fetchingWeather ? ' · obteniendo…' : ''}
              </label>
              <input
                id="apl-temp"
                type="number"
                step="0.1"
                min="-60"
                max="70"
                className="aur-input aur-input--num"
                value={temperatura}
                onChange={e => setTemperatura(e.target.value)}
                placeholder="—"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-hum">
                Humedad relativa (%){fetchingWeather ? ' · obteniendo…' : ''}
              </label>
              <input
                id="apl-hum"
                type="number"
                step="1"
                min="0"
                max="100"
                className="aur-input aur-input--num"
                value={humedadRelativa}
                onChange={e => setHumedadRelativa(e.target.value)}
                placeholder="—"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-h-inicio">Hora inicio</label>
              <AuroraTimePicker
                id="apl-h-inicio"
                value={horaInicio}
                onChange={setHoraInicio}
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-h-fin">Hora final</label>
              <div>
                <AuroraTimePicker
                  id="apl-h-fin"
                  value={horaFinal}
                  onChange={setHoraFinal}
                  min={horaInicio || undefined}
                  hasError={!!horaInicio && !!horaFinal && horaFinal <= horaInicio}
                />
                {!!horaInicio && !!horaFinal && horaFinal <= horaInicio && (
                  <span className="aur-field-error">La hora final debe ser mayor que la inicial</span>
                )}
              </div>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-operario">Operario</label>
              <input
                id="apl-operario"
                type="text"
                maxLength={200}
                className="aur-input"
                value={operario}
                onChange={e => setOperario(e.target.value)}
                placeholder="Nombre del operario"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-metodo">Método de aplicación</label>
              <input
                id="apl-metodo"
                type="text"
                maxLength={200}
                className="aur-input"
                value={metodoAplicacion}
                onChange={e => setMetodoAplicacion(e.target.value)}
                placeholder="Ej. Spray Boom, Drench…"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-finca">Encargado de finca</label>
              <input
                id="apl-finca"
                type="text"
                maxLength={200}
                className="aur-input"
                value={encargadoFinca}
                onChange={e => setEncargadoFinca(e.target.value)}
                placeholder="Nombre del encargado de finca"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-bodega">Encargado de bodega</label>
              <input
                id="apl-bodega"
                type="text"
                maxLength={200}
                className="aur-input"
                value={encargadoBodega}
                onChange={e => setEncargadoBodega(e.target.value)}
                placeholder="Nombre del encargado de bodega"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-sup">Sup. aplicaciones / Regente</label>
              <input
                id="apl-sup"
                type="text"
                maxLength={200}
                className="aur-input"
                value={supAplicaciones}
                onChange={e => setSupAplicaciones(e.target.value)}
                placeholder="Nombre del supervisor o regente"
              />
            </div>

            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="apl-obs">
                Observaciones (opcional)
                <span className="aur-field-hint"> · {observacionesAplicacion.length}/500</span>
              </label>
              <textarea
                id="apl-obs"
                className="aur-textarea"
                value={observacionesAplicacion}
                onChange={e => setObservacionesAplicacion(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Ej. viento inesperado en el último bloque, se pausó 15 min. Novedades, incidentes, o cualquier detalle relevante para el auditor."
              />
            </div>
          </div>
        </div>

        <div className="aur-modal-actions">
          <button type="button" className="aur-btn-text" onClick={onClose}>Cancelar</button>
          <button type="button" className="aur-btn-pill" onClick={handleConfirm}>
            <FiCheckCircle size={14} /> Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function CedulasAplicacion() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
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
  const [loading,   setLoading]   = useState(true);
  const [previewTask, setPreviewTask] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
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

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tasks').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/packages').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/cedulas').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
      apiFetch('/api/calibraciones').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ]).then(([t, l, g, s, p, pr, c, cfg, cal, maq]) => {
      setTasks(Array.isArray(t) ? t : []);
      setLotes(Array.isArray(l) ? l : []);
      setGrupos(Array.isArray(g) ? g : []);
      setSiembras(Array.isArray(s) ? s : []);
      setPackages(Array.isArray(p) ? p : []);
      setProductos(Array.isArray(pr) ? pr : []);
      setCedulas(Array.isArray(c) ? c : []);
      setConfig(cfg || {});
      setCalibraciones(Array.isArray(cal) ? cal : []);
      setMaquinaria(Array.isArray(maq) ? maq : []);
    }).catch(console.error).finally(() => setLoading(false));
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
        if (isOverdue(t)) return true;
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
          // Cedulas already exist in DB but weren't in local state (stale cache) — recover silently
          setCedulas(prev => {
            const existingIds = new Set(prev.map(c => c.id));
            const newOnes = data.cedulas.filter(c => !existingIds.has(c.id));
            return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
          });
        } else {
          alert(data.message || 'Error al generar la cédula.');
        }
        return;
      }
      // Response is either a single cedula object or an array (multi-lote split)
      const newCedulas = Array.isArray(data) ? data : [data];
      setCedulas(prev => [...prev, ...newCedulas]);
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
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // silently fail
    }
  };

  // ── Row renderer (shared between overdue panel and main list) ────────────
  const renderCedulaRow = (task, { allowSkipTask = false } = {}) => {
    const allCedulas = cedulasByTaskId[task.id] || [];
    const isSplit    = allCedulas.length > 1;
    const overdue    = isOverdue(task);

    // Status → badge variant del sistema Aurora
    const statusBadge = (cedulaStatus) => {
      if (cedulaStatus === 'aplicada_en_campo') return { cls: 'aur-badge--green',   label: 'Aplicada' };
      if (cedulaStatus === 'en_transito')        return { cls: 'aur-badge--blue',    label: 'En Tránsito' };
      return { cls: 'aur-badge--yellow', label: 'Pendiente' };
    };

    const openPreview = (cedulaId) => {
      openedViaUrlRef.current = false;
      savedScrollRef.current = window.scrollY;
      setPreviewTask(task);
      setPreviewCedulaId(cedulaId);
    };

    // ── Multi-lote split: una sub-fila por cédula ──────────────────────────
    if (isSplit) {
      return (
        <article key={task.id} className={`ca-cedula-card ca-cedula-card--split${overdue ? ' is-overdue' : ''}${isManualTask(task) ? ' is-manual' : ''}`}>
          <div className="ca-cedula-head">
            <div className="ca-cedula-info">
              <h4 className="ca-cedula-name" title={task.activityName}>
                {task.activityName}
                {isManualTask(task) && <span className="aur-badge aur-badge--magenta">Adicional</span>}
              </h4>
              <p className="ca-cedula-meta">
                {task.loteName}
                {task.responsableName ? ` · ${task.responsableName}` : ''}
              </p>
            </div>
            <div className="ca-cedula-status">
              <span className={`aur-badge ${overdue ? 'aur-badge--magenta' : 'aur-badge--yellow'}`}>
                {overdue ? 'Vencida' : 'Pendiente'}
              </span>
              <span className="ca-cedula-due">{formatShortDate(task.dueDate)}</span>
            </div>
          </div>

          <ul className="ca-split-list">
            {allCedulas.map(c => {
              const isLdg = actionLoading === c.id;
              const canAnular = c.status !== 'aplicada_en_campo' && hasMinRole(currentUser?.rol, 'encargado');
              const sb = statusBadge(c.status);
              return (
                <li key={c.id} className="ca-split-row">
                  <div className="ca-split-info">
                    <span className="ca-split-lote">{c.splitLoteNombre || '—'}</span>
                    <span className="ca-cedula-consecutivo">{c.consecutivo}</span>
                    <span className={`aur-badge ${sb.cls}`}>{sb.label}</span>
                  </div>
                  <div className="ca-split-actions">
                    {c.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
                      <button
                        type="button"
                        className="aur-chip"
                        onClick={() => handleEditarProductos(c.id)}
                        disabled={isLdg}
                        title="Editar productos y dosis"
                      >
                        <FiEdit2 size={12} /> Editar
                      </button>
                    )}
                    {c.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
                      <button
                        type="button"
                        className="aur-btn-pill aur-btn-pill--sm"
                        onClick={() => handleMezclaLista(c.id)}
                        disabled={isLdg}
                      >
                        <FiCheckCircle size={12} />
                        {isLdg ? 'Procesando…' : 'Mezcla lista'}
                      </button>
                    )}
                    {c.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
                      <button
                        type="button"
                        className="aur-btn-pill aur-btn-pill--sm"
                        onClick={() => handleAplicada(c.id)}
                        disabled={isLdg}
                      >
                        <FaTractor size={12} />
                        {isLdg ? 'Registrando…' : 'Aplicada en campo'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="aur-chip aur-chip--ghost"
                      onClick={() => openPreview(c.id)}
                      title="Ver cédula de aplicación"
                    >
                      <FiEye size={12} /> Ver
                    </button>
                    {canAnular && (
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
                        onClick={() => handleAnular(c.id)}
                        disabled={isLdg}
                        title="Anular cédula"
                      >
                        <FiX size={13} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
      );
    }

    // ── Cédula única ───────────────────────────────────────────────────────
    const cedula   = allCedulas[0] || null;
    const isLdg    = actionLoading === (cedula ? cedula.id : `new-${task.id}`)
                  || actionLoading === `skip-${task.id}`;
    const canAnular = cedula && cedula.status !== 'aplicada_en_campo' && hasMinRole(currentUser?.rol, 'encargado');

    return (
      <article key={task.id} className={`ca-cedula-card${overdue ? ' is-overdue' : ''}${isManualTask(task) ? ' is-manual' : ''}`}>
        <div className="ca-cedula-head">
          <div className="ca-cedula-info">
            <h4 className="ca-cedula-name" title={task.activityName}>
              {task.activityName}
              {isManualTask(task) && <span className="aur-badge aur-badge--magenta">Adicional</span>}
            </h4>
            <p className="ca-cedula-meta">
              {task.loteName}
              {task.responsableName ? ` · ${task.responsableName}` : ''}
              {cedula && <span className="ca-cedula-consecutivo">{cedula.consecutivo}</span>}
            </p>
          </div>
          <div className="ca-cedula-status">
            <span className={`aur-badge ${overdue ? 'aur-badge--magenta' : 'aur-badge--yellow'}`}>
              {overdue ? 'Vencida' : 'Pendiente'}
            </span>
            <span className="ca-cedula-due">{formatShortDate(task.dueDate)}</span>
            {cedula?.status === 'pendiente' && <span className="aur-badge aur-badge--yellow">Pendiente</span>}
            {cedula?.status === 'en_transito' && <span className="aur-badge aur-badge--blue">En Tránsito</span>}
          </div>
        </div>

        <div className="ca-cedula-actions">
          {!cedula && hasMinRole(currentUser?.rol, 'encargado') && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => handleGenerarCedula(task.id)}
              disabled={isLdg}
              title="Generar cédula de aplicación"
            >
              <FiPlusCircle size={12} />
              {isLdg ? 'Generando…' : 'Generar cédula'}
            </button>
          )}

          {!cedula && allowSkipTask && hasMinRole(currentUser?.rol, 'encargado') && (
            <button
              type="button"
              className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
              onClick={() => handleOmitirTarea(task.id)}
              disabled={isLdg}
              title="Omitir esta tarea sin generar cédula"
            >
              <FiX size={13} />
            </button>
          )}

          {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
            <button
              type="button"
              className="aur-chip"
              onClick={() => handleEditarProductos(cedula.id)}
              disabled={isLdg}
              title="Editar productos y dosis"
            >
              <FiEdit2 size={12} /> Editar
            </button>
          )}

          {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => handleMezclaLista(cedula.id)}
              disabled={isLdg}
              title="Confirmar que la mezcla está lista"
            >
              <FiCheckCircle size={12} />
              {isLdg ? 'Procesando…' : 'Mezcla lista'}
            </button>
          )}

          {cedula?.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => handleAplicada(cedula.id)}
              disabled={isLdg}
              title="Confirmar aplicación en campo"
            >
              <FaTractor size={12} />
              {isLdg ? 'Registrando…' : 'Aplicada en campo'}
            </button>
          )}

          {cedula && (
            <button
              type="button"
              className="aur-chip aur-chip--ghost"
              onClick={() => openPreview(cedula.id)}
              title="Ver cédula de aplicación"
            >
              <FiEye size={12} /> Ver cédula
            </button>
          )}

          {canAnular && (
            <button
              type="button"
              className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
              onClick={() => handleAnular(cedula.id)}
              disabled={isLdg}
              title="Anular cédula"
            >
              <FiX size={13} />
            </button>
          )}
        </div>
      </article>
    );
  };

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
              <Link to="/aplicaciones/historial" className="aur-chip aur-chip--ghost">
                <FiClock size={12} /> Historial
              </Link>
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
            <div className="aur-section-header">
              <h3>Periodo</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="ca-from">Desde</label>
                <input
                  id="ca-from"
                  type="date"
                  className="aur-input"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                />
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="ca-to">Hasta</label>
                <input
                  id="ca-to"
                  type="date"
                  className="aur-input"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <h3>Cédulas</h3>
              <span className="aur-section-count">{visibleTasks.length}</span>
            </div>
            {visibleTasks.length === 0 ? (
              <div className="aur-banner">
                <FiFileText size={14} />
                <span>
                  {aplicacionTasks.length === 0
                    ? (hasMinRole(currentUser?.rol, 'encargado')
                        ? 'Aún no hay cédulas de aplicación para tus cultivos. Crea la primera con el botón "Nueva cédula" de arriba.'
                        : 'Aún no hay cédulas de aplicación para tus cultivos.')
                    : 'No hay aplicaciones programadas para este período.'}
                </span>
              </div>
            ) : (
              <div className="ca-cedula-list">
                {visibleTasks.map(task => renderCedulaRow(task, { allowSkipTask: isOverdue(task) }))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      {previewTask && createPortal(
        <div className="ca-preview-backdrop" onClick={handleCloseViewer}>
          <div className="ca-preview-container" onClick={e => e.stopPropagation()}>

            {/* Toolbar */}
            <div className="ca-preview-toolbar">
              <button className="ca-preview-back-btn" onClick={handleCloseViewer} title="Volver">
                <FiArrowLeft size={16} />
                <span>Volver</span>
              </button>
              <span className="ca-preview-toolbar-title">
                Cédula de Aplicación — {previewTask.activityName}
                {previewTask.isDraft
                  ? <span className="ca-toolbar-draft-badge">BORRADOR</span>
                  : activeCedula && (
                    <span className="ca-toolbar-consecutivo">
                      {activeCedula.consecutivo}
                    </span>
                  )
                }
              </span>
              <div className="ca-preview-toolbar-actions">
                {/* ── Acciones de flujo inline (ocultas en borrador) ── */}
                {!previewTask.isDraft && (() => {
                  const cedula = activeCedula;
                  const isLdg  = actionLoading === cedula?.id;
                  if (!cedula) return null;
                  if (cedula.status === 'aplicada_en_campo') {
                    return (
                      <span className="ca-toolbar-applied-badge">
                        <FiCheckCircle size={14} /> Aplicada
                      </span>
                    );
                  }
                  if (cedula.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado')) {
                    return (
                      <button
                        className="aur-btn-pill"
                        onClick={() => handleMezclaLista(cedula.id)}
                        disabled={isLdg}
                      >
                        <FiCheckCircle size={14} />
                        {isLdg ? 'Procesando…' : 'Mezcla Lista'}
                      </button>
                    );
                  }
                  if (cedula.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador')) {
                    return (
                      <button
                        className="aur-btn-pill"
                        onClick={() => handleAplicada(cedula.id)}
                        disabled={isLdg}
                      >
                        <FaTractor size={14} />
                        {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
                      </button>
                    );
                  }
                  return null;
                })()}

                <button className="aur-chip ca-toolbar-icon-btn" onClick={handleShare}>
                  <FiShare2 size={15} /> <span className="ca-toolbar-btn-text">Compartir</span>
                </button>
                <button className="aur-chip ca-toolbar-icon-btn" onClick={handlePrint}>
                  <FiPrinter size={15} /> <span className="ca-toolbar-btn-text">Imprimir</span>
                </button>
              </div>
            </div>

            {/* Documento */}
            <div className="ca-doc-wrap">
              <div className="ca-document" ref={docRef}>

                {/* ── Encabezado ── */}
                <div className="ca-doc-header">
                  <div className="ca-doc-brand">
                    {config.logoUrl
                      ? <img src={config.logoUrl} alt="Logo" className="ca-doc-logo-img" />
                      : <div className="ca-doc-logo">AU</div>
                    }
                    <div className="ca-doc-brand-info">
                      <div className="ca-doc-brand-name">{config.nombreEmpresa || 'Finca Aurora'}</div>
                      {config.identificacion && <div className="ca-doc-brand-sub">Cédula: {config.identificacion}</div>}
                      {config.whatsapp      && <div className="ca-doc-brand-sub">Tel: {config.whatsapp}</div>}
                      {config.correo        && <div className="ca-doc-brand-sub">{config.correo}</div>}
                      {config.direccion     && <div className="ca-doc-brand-sub">{config.direccion}</div>}
                    </div>
                  </div>
                  <div className="ca-doc-title-block">
                    <div className="ca-doc-title">CÉDULA DE APLICACIÓN DE AGROQUÍMICOS</div>
                    <div className="ca-doc-subtitle">Aplicación: {previewTask.activityName}</div>
                    {previewTask.isDraft
                      ? <div className="ca-doc-consecutivo ca-doc-consecutivo--draft">BORRADOR</div>
                      : activeCedula && (
                        <div className="ca-doc-consecutivo">{activeCedula.consecutivo}</div>
                      )
                    }
                  </div>
                </div>

                <hr className="ca-doc-divider" />

                {/* ── Datos generales ── */}
                <div className="ca-section-title ca-section-title--split">
                  <span>Datos Generales</span>
                  {previewCal && (
                    <span className="ca-section-cal-name">Calibración: {previewCal.nombre}</span>
                  )}
                </div>
                <div className="ca-datos-grid">
                  <div className="ca-dato ca-dato-col">
                    <div className="ca-dato">
                      <span className="ca-dato-label">F. Prog. Aplicación:</span>
                      <span className="ca-dato-value">{formatDateLong(previewTask.dueDate)}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">F. Prog. Cosecha:</span>
                      <span className="ca-dato-value">{formatDateLong(calcFechaCosecha(previewSource, config))}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">F. Creación de Grupo:</span>
                      <span className="ca-dato-value">{formatDateLong(tsToDate(previewSource?.fechaCreacion))}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Periodo de Carencia:</span>
                      <span className="ca-dato-value">
                        {(() => {
                          const max = previewProductos.reduce((m, p) => {
                            const dias = Number(getProductoCatalog(p.productoId)?.periodoACosecha) || 0;
                            return Math.max(m, dias);
                          }, 0);
                          return max > 0 ? `${max} días` : '—';
                        })()}
                      </span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Periodo de Reingreso:</span>
                      <span className="ca-dato-value">
                        {(() => {
                          const max = previewProductos.reduce((m, p) => {
                            const horas = Number(getProductoCatalog(p.productoId)?.periodoReingreso) || 0;
                            return Math.max(m, horas);
                          }, 0);
                          return max > 0 ? `${max} h` : '—';
                        })()}
                      </span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Método de Apl.:</span>
                      <span className="ca-dato-value">
                        {activeCedula?.metodoAplicacion || previewCal?.metodo || '—'}
                      </span>
                    </div>
                    {previewPackageName && (
                      <div className="ca-dato">
                        <span className="ca-dato-label">Paq. Téc.:</span>
                        <span className="ca-dato-value">{previewPackageName}</span>
                      </div>
                    )}
                  </div>
                  <div className="ca-dato ca-dato-col">
                    <div className="ca-dato">
                      <span className="ca-dato-label">Grupo:</span>
                      <span className="ca-dato-value">{activeCedula?.snap_sourceName || previewTask.loteName || '—'}</span>
                    </div>
                    {(previewSource?.cosecha || previewSource?.etapa) && (
                      <div className="ca-dato">
                        <span className="ca-dato-label">Etapa:</span>
                        <span className="ca-dato-value">
                          {[previewSource.cosecha, previewSource.etapa].filter(Boolean).join(' / ')}
                        </span>
                      </div>
                    )}
                    <div className="ca-dato">
                      <span className="ca-dato-label">Área (ha):</span>
                      <span className="ca-dato-value">{pvTotalHa > 0 ? pvTotalHa.toFixed(2) : (previewTask.loteHectareas ?? '—')}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Total Plantas:</span>
                      <span className="ca-dato-value">
                        {(() => {
                          const total = previewBloques.reduce((s, b) => s + (Number(b.plantas) || 0), 0);
                          return total > 0 ? total.toLocaleString('es-ES') : '—';
                        })()}
                      </span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Volumen (Lt/Ha):</span>
                      <span className="ca-dato-value">{previewCal?.volumen ?? '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Litros aplicador:</span>
                      <span className="ca-dato-value">
                        {previewCalAplicador?.capacidad ?? '—'}
                      </span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Total boones requeridos:</span>
                      <span className="ca-dato-value">
                        {(() => {
                          const volumen = parseFloat(previewCal?.volumen);
                          const litros  = parseFloat(previewCalAplicador?.capacidad);
                          const area    = pvTotalHa > 0 ? pvTotalHa : parseFloat(previewTask.loteHectareas ?? 0);
                          if (!volumen || !litros || !area) return '—';
                          return ((volumen * area) / litros).toFixed(2);
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* ── Columna 3: Calibración ── */}
                  <div className="ca-dato ca-dato-col">
                    <div className="ca-dato">
                      <span className="ca-dato-label">Tractor:</span>
                      <span className="ca-dato-value">{previewCalTractor?.codigo || previewCal?.tractorNombre || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Aplicador:</span>
                      <span className="ca-dato-value">{previewCalAplicador?.codigo || previewCal?.aplicadorNombre || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">RPM Recomendada:</span>
                      <span className="ca-dato-value">{previewCal?.rpmRecomendado || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Marcha Rec.:</span>
                      <span className="ca-dato-value">{previewCal?.marchaRecomendada || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Tipo Boq.:</span>
                      <span className="ca-dato-value">{previewCal?.tipoBoquilla || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Presión Recomendada:</span>
                      <span className="ca-dato-value">{previewCal?.presionRecomendada || '—'}</span>
                    </div>
                    <div className="ca-dato">
                      <span className="ca-dato-label">Km/H Recomendados:</span>
                      <span className="ca-dato-value">{previewCal?.velocidadKmH || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* ── Tabla de bloques (sólo para grupos) ── */}
                {previewBloques.length > 0 && (
                  <>
                    <div className="ca-bloques-summary">
                      {Object.entries(
                        previewBloques.reduce((acc, b) => {
                          const lote = b.loteNombre || '—';
                          if (!acc[lote]) acc[lote] = [];
                          acc[lote].push(b.bloque || '—');
                          return acc;
                        }, {})
                      ).map(([lote, bloques]) => (
                        <div key={lote} className="ca-bloques-summary-row">
                          <span className="ca-bloques-label">Lote:</span>
                          <span className="ca-bloques-value">{lote}</span>
                          <span className="ca-bloques-label">Bloques:</span>
                          <span className="ca-bloques-value">{[...bloques].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* ── Tabla de productos ── */}
                {previewProductos.length === 0 ? (
                  <p className="ca-empty-products">Sin productos registrados.</p>
                ) : (
                  <table className="ca-doc-table">
                    <thead>
                      <tr>
                        <th>Id</th>
                        <th>Nombre Comercial — Ing. Activo</th>
                        <th className="ca-col-num">Per. Carencia</th>
                        <th className="ca-col-num">Per. Reing.</th>
                        <th className="ca-col-num">Cant./Ha</th>
                        <th className="ca-col-num">Boom</th>
                        <th className="ca-col-num">Fracción</th>
                        <th>Unidad</th>
                        <th className="ca-col-num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewProductos.map((prod, i) => {
                        const info        = getProductoCatalog(prod.productoId);
                        const cantPorHa   = prod.cantidadPorHa ?? prod.cantidad;
                        const hectareas   = pvTotalHa > 0 ? pvTotalHa : parseFloat(previewTask.loteHectareas || 1);
                        const total       = cantPorHa != null
                          ? (parseFloat(cantPorHa) * hectareas).toFixed(3)
                          : '—';
                        const nombreFull  = info
                          ? `${info.nombreComercial}${info.ingredienteActivo ? ' — ' + info.ingredienteActivo : ''}`
                          : (prod.nombreComercial || '—');
                        const volumen     = parseFloat(previewCal?.volumen);
                        const litros      = parseFloat(previewCalAplicador?.capacidad);
                        const totalBoones = (volumen && litros && hectareas)
                          ? (volumen * hectareas) / litros
                          : null;
                        const fracDecimal = totalBoones != null ? totalBoones % 1 : null;
                        const cantBoom    = (cantPorHa != null && volumen && litros && totalBoones > 1)
                          ? ((parseFloat(cantPorHa) * litros) / volumen).toFixed(3)
                          : '—';
                        const cantFraccion = (cantPorHa != null && volumen && litros && fracDecimal != null && fracDecimal > 0)
                          ? ((parseFloat(cantPorHa) * litros / volumen) * fracDecimal).toFixed(3)
                          : '—';
                        return (
                          <tr key={prod.productoId || i}>
                            <td>{info?.idProducto || '—'}</td>
                            <td>{nombreFull}</td>
                            <td className="ca-col-num">{info?.periodoACosecha ?? '—'}</td>
                            <td className="ca-col-num">{info?.periodoReingreso ?? '—'}</td>
                            <td className="ca-col-num">{cantPorHa ?? '—'}</td>
                            <td className="ca-col-num">{cantBoom}</td>
                            <td className="ca-col-num">{cantFraccion}</td>
                            <td>{info?.unidad || prod.unidad || '—'}</td>
                            <td className="ca-col-num"><strong>{total}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* ── Bloque de observaciones / ajustes (solo si hay datos) ── */}
                {(() => {
                  const ced = activeCedula;
                  if (!ced) return null;
                  const originales = Array.isArray(ced.productosOriginales) ? ced.productosOriginales : [];
                  const aplicados  = Array.isArray(ced.productosAplicados)  ? ced.productosAplicados  : [];
                  const hay = ced.huboCambios || ced.observacionesMezcla || ced.observacionesAplicacion;
                  if (!hay) return null;
                  // Derive change lines: substitutions, dose adjustments, added and removed products
                  const cambiosLineas = [];
                  if (ced.huboCambios && originales.length > 0) {
                    const origById = {};
                    originales.forEach(o => { if (o?.productoId) origById[o.productoId] = o; });
                    const aplicadosByOrig = {};
                    aplicados.forEach(a => {
                      if (a?.productoOriginalId) aplicadosByOrig[a.productoOriginalId] = a;
                    });
                    const touchedOriginalIds = new Set();
                    aplicados.forEach(a => {
                      if (!a) return;
                      const origRef = a.productoOriginalId
                        ? origById[a.productoOriginalId]
                        : origById[a.productoId];
                      if (origRef) touchedOriginalIds.add(origRef.productoId);
                      if (a.productoOriginalId && a.productoOriginalId !== a.productoId) {
                        const orig = origById[a.productoOriginalId];
                        const motivo = a.motivoCambio === 'ajuste_dosis' ? 'Ajuste de dosis'
                                     : a.motivoCambio === 'otro'        ? 'Otro'
                                     : 'Sustitución';
                        cambiosLineas.push(
                          `${orig?.nombreComercial || orig?.productoId || '—'} (${orig?.cantidadPorHa ?? '—'} ${orig?.unidad || ''}/Ha) sustituido por ${a.nombreComercial || a.productoId} (${a.cantidadPorHa ?? '—'} ${a.unidad || ''}/Ha) — ${motivo}`
                        );
                      } else if (origRef && parseFloat(origRef.cantidadPorHa) !== parseFloat(a.cantidadPorHa)) {
                        cambiosLineas.push(
                          `${a.nombreComercial || a.productoId}: dosis ajustada de ${origRef.cantidadPorHa ?? '—'} a ${a.cantidadPorHa ?? '—'} ${a.unidad || origRef.unidad || ''}/Ha — Ajuste de dosis`
                        );
                      } else if (!origRef) {
                        cambiosLineas.push(
                          `${a.nombreComercial || a.productoId} (${a.cantidadPorHa ?? '—'} ${a.unidad || ''}/Ha) añadido respecto al programa original`
                        );
                      }
                    });
                    originales.forEach(o => {
                      if (!touchedOriginalIds.has(o.productoId) && !aplicadosByOrig[o.productoId]) {
                        cambiosLineas.push(
                          `${o.nombreComercial || o.productoId} (${o.cantidadPorHa ?? '—'} ${o.unidad || ''}/Ha) retirado respecto al programa original`
                        );
                      }
                    });
                  }
                  return (
                    <div className="ca-doc-observaciones">
                      {ced.huboCambios && cambiosLineas.length > 0 && (
                        <div>
                          <strong>Ajustes respecto al programa original:</strong>
                          <ul>
                            {cambiosLineas.map((ln, i) => <li key={i}>{ln}</li>)}
                          </ul>
                        </div>
                      )}
                      {ced.observacionesMezcla && (
                        <p><strong>Observaciones de mezcla:</strong> {ced.observacionesMezcla}</p>
                      )}
                      {ced.observacionesAplicacion && (
                        <p><strong>Observaciones de aplicación:</strong> {ced.observacionesAplicacion}</p>
                      )}
                    </div>
                  );
                })()}

                {/* ── Nota de seguridad ── */}
                <div className="ca-doc-safety-note">
                  No olvide usar el Equipo de Protección Personal durante la aplicación y de asegurarse del buen estado del mismo. No fume ni ingiera alimentos durante la aplicación. Recuerde no contaminar fuentes de agua con productos o envases vacíos.
                </div>

                {/* ── Sobrante + Condiciones del tiempo ── */}
                {(() => {
                  const cedula = activeCedula;
                  return (
                    <>
                      <div className="ca-campo-data-row">
                        <div className="ca-campo-item">
                          <span className="ca-campo-label">Sobrante:</span>
                          <span className="ca-campo-value">
                            {cedula?.sobrante === true ? 'Sí' : cedula?.sobrante === false ? 'No' : '___'}
                          </span>
                        </div>
                        {cedula?.sobrante && (
                          <div className="ca-campo-item">
                            <span className="ca-campo-label">Depositado en:</span>
                            <span className="ca-campo-value">{cedula?.sobranteLoteNombre || '___________'}</span>
                          </div>
                        )}
                      </div>
                      <div className="ca-campo-data-row">
                        <div className="ca-campo-item">
                          <span className="ca-campo-label">Condiciones del tiempo:</span>
                          <span className="ca-campo-value">{cedula?.condicionesTiempo || '___________'}</span>
                        </div>
                        <div className="ca-campo-item">
                          <span className="ca-campo-label">Temperatura:</span>
                          <span className="ca-campo-value">
                            {cedula?.temperatura != null ? `${cedula.temperatura}°C` : '___'}
                          </span>
                        </div>
                        <div className="ca-campo-item">
                          <span className="ca-campo-label">% Humedad Relativa:</span>
                          <span className="ca-campo-value">
                            {cedula?.humedadRelativa != null ? `${cedula.humedadRelativa}%` : '___'}
                          </span>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* ── Firma operarios ── */}
                <div className="ca-doc-sig-row">
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {(() => {
                        const cedula = activeCedula;
                        if (!cedula?.aplicadaAt) return null;
                        const d = cedula.aplicadaAt?.seconds
                          ? new Date(cedula.aplicadaAt.seconds * 1000)
                          : new Date(cedula.aplicadaAt);
                        return d.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC' });
                      })()}
                    </div>
                    <div className="ca-sig-label">Fecha de Aplicación</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {(() => {
                        const cedula = activeCedula;
                        if (!cedula?.horaInicio && !cedula?.horaFinal) return null;
                        return [cedula.horaInicio || '___', cedula.horaFinal || '___'].join(' / ');
                      })()}
                    </div>
                    <div className="ca-sig-label">Hora Inicial / Hora Final</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {activeCedula?.operario || null}
                    </div>
                    <div className="ca-sig-label">Operario</div>
                  </div>
                </div>

                {/* ── Firmas finales ── */}
                <div className="ca-doc-sig-row ca-doc-sig-final">
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {config.administrador || null}
                    </div>
                    <div className="ca-sig-label">Encargado de Finca</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {activeCedula?.mezclaListaNombre || null}
                    </div>
                    <div className="ca-sig-label">Encargado de Bodega</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line ca-sig-line--prefilled">
                      {activeCedula?.supAplicaciones || previewTecnicoResponsable}
                    </div>
                    <div className="ca-sig-label">Sup. Aplicaciones / Regente</div>
                  </div>
                </div>

                <div className="ca-doc-footer">
                  Documento generado por Sistema Aurora · {new Date().toLocaleDateString('es-ES')}
                </div>
              </div>
            </div>

          </div>
        </div>,
        document.body
      )}

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
