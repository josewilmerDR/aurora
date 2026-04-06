import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { FiFileText, FiPrinter, FiShare2, FiX, FiCheckCircle, FiPlusCircle, FiEye, FiMoreVertical, FiAlertTriangle, FiArrowLeft, FiClock } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser, hasMinRole } from '../contexts/UserContext';
import NuevaCedulaModal from './NuevaCedulaModal';
import './CedulasAplicacion.css';

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

const toInputDate = d => d.toISOString().slice(0, 10);

// Semana: domingo → sábado. offsetWeeks=0 → esta semana, 1 → próxima semana
const getWeekBounds = (offsetWeeks = 0) => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + offsetWeeks * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfWeek };
};

const CEDULA_STATUS_LABEL = {
  pendiente:          'Pendiente',
  en_transito:        'En Tránsito',
  aplicada_en_campo:  'Aplicada',
};

// ── Modal de confirmación ─────────────────────────────────────────────────────
function ConfirmModal({ config, onClose }) {
  return createPortal(
    <div className="param-modal-backdrop" onClick={onClose}>
      <div className="param-modal" onClick={e => e.stopPropagation()}>
        <div className="param-modal-header">
          <FiAlertTriangle size={18} className="param-modal-icon-warn" />
          <span>{config.title}</span>
        </div>
        <p className="param-modal-body">{config.body}</p>
        <div className="param-modal-actions">
          {config.showCancel !== false && (
            <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          )}
          <button
            className={`btn ${config.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { onClose(); config.onConfirm?.(); }}
          >
            {config.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

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
  const [fetchingWeather,   setFetchingWeather]   = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    setFetchingWeather(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`
          );
          const d = await r.json();
          if (d.current?.temperature_2m    != null) setTemperatura(d.current.temperature_2m);
          if (d.current?.relative_humidity_2m != null) setHumedadRelativa(d.current.relative_humidity_2m);
        } catch { /* sin internet o API no disponible — el usuario llena manualmente */ }
        setFetchingWeather(false);
      },
      () => setFetchingWeather(false),
      { timeout: 8000 }
    );
  }, []);

  const handleConfirm = () => {
    if (sobrante && !sobranteLoteId) {
      alert('Seleccione el lote donde fue depositado el sobrante.');
      return;
    }
    if (horaInicio && horaFinal && horaInicio >= horaFinal) {
      alert('La hora de inicio debe ser menor que la hora final.');
      return;
    }
    onConfirm({
      sobrante,
      sobranteLoteId:     sobrante ? sobranteLoteId   : null,
      sobranteLoteNombre: sobrante ? (lotes.find(l => l.id === sobranteLoteId)?.nombreLote || null) : null,
      condicionesTiempo:  condicionesTiempo || null,
      temperatura:        temperatura !== '' ? Number(temperatura)     : null,
      humedadRelativa:    humedadRelativa !== '' ? Number(humedadRelativa) : null,
      horaInicio:         horaInicio  || null,
      horaFinal:          horaFinal   || null,
      operario:           operario    || null,
      metodoAplicacion:   metodoAplicacion  || null,
      encargadoFinca:     encargadoFinca    || null,
      encargadoBodega:    encargadoBodega   || null,
      supAplicaciones:    supAplicaciones   || null,
    });
  };

  return createPortal(
    <div className="param-modal-backdrop" onClick={onClose}>
      <div className="param-modal aplicada-modal" onClick={e => e.stopPropagation()}>
        <div className="param-modal-header">
          <FaTractor size={16} />
          <span>Confirmar Aplicación en Campo</span>
        </div>

        <div className="aplicada-field">
          <label>¿Hubo sobrante de mezcla?</label>
          <div className="aplicada-toggle">
            <button className={`btn ${!sobrante ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSobrante(false)}>No</button>
            <button className={`btn ${sobrante  ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSobrante(true)}>Sí</button>
          </div>
        </div>
        {sobrante && (
          <div className="aplicada-field">
            <label>Lote donde fue depositado el sobrante</label>
            <select value={sobranteLoteId} onChange={e => setSobranteLoteId(e.target.value)}>
              <option value="">— Seleccionar lote —</option>
              {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
            </select>
          </div>
        )}

        <div className="aplicada-field">
          <label>Condiciones del tiempo</label>
          <select value={condicionesTiempo} onChange={e => setCondicionesTiempo(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {CONDICIONES_TIEMPO.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="aplicada-field-row">
          <div className="aplicada-field">
            <label>Temperatura (°C){fetchingWeather ? ' ⏳' : ''}</label>
            <input type="number" step="0.1" value={temperatura} onChange={e => setTemperatura(e.target.value)} placeholder="—" />
          </div>
          <div className="aplicada-field">
            <label>% Humedad Relativa{fetchingWeather ? ' ⏳' : ''}</label>
            <input type="number" step="1" min="0" max="100" value={humedadRelativa} onChange={e => setHumedadRelativa(e.target.value)} placeholder="—" />
          </div>
        </div>

        <div className="aplicada-field-row">
          <div className="aplicada-field">
            <label>Hora inicio</label>
            <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} />
          </div>
          <div className="aplicada-field">
            <label>Hora final</label>
            <input type="time" value={horaFinal} onChange={e => setHoraFinal(e.target.value)} />
          </div>
        </div>

        <div className="aplicada-field">
          <label>Operario</label>
          <input type="text" value={operario} onChange={e => setOperario(e.target.value)} placeholder="Nombre del operario" />
        </div>

        <div className="aplicada-field">
          <label>Método de Aplicación</label>
          <input type="text" value={metodoAplicacion} onChange={e => setMetodoAplicacion(e.target.value)} placeholder="Ej: Spray Boom, Drench…" />
        </div>

        <div className="aplicada-field">
          <label>Encargado de Finca</label>
          <input type="text" value={encargadoFinca} onChange={e => setEncargadoFinca(e.target.value)} placeholder="Nombre del encargado de finca" />
        </div>

        <div className="aplicada-field">
          <label>Encargado de Bodega</label>
          <input type="text" value={encargadoBodega} onChange={e => setEncargadoBodega(e.target.value)} placeholder="Nombre del encargado de bodega" />
        </div>

        <div className="aplicada-field">
          <label>Sup. Aplicaciones / Regente</label>
          <input type="text" value={supAplicaciones} onChange={e => setSupAplicaciones(e.target.value)} placeholder="Nombre del supervisor o regente" />
        </div>

        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleConfirm}>Confirmar</button>
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
  const [dateFrom, setDateFrom] = useState(() => toInputDate(getWeekBounds(0).start));
  const [dateTo,   setDateTo]   = useState(() => toInputDate(getWeekBounds(1).end));
  const [actionLoading, setActionLoading] = useState(null); // cedulaId | 'new-{taskId}'
  const [showNuevaModal, setShowNuevaModal] = useState(false);
  const [openMenuId,    setOpenMenuId]    = useState(null);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [aplicadaModal, setAplicadaModal] = useState(null); // cedulaId
  const [previewCedulaId, setPreviewCedulaId] = useState(null); // ID of cedula shown in preview modal
  const docRef = useRef(null);
  const dateFromAdjusted = useRef(false);

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  const location = useLocation();
  const navigate = useNavigate();
  const savedScrollRef   = useRef(0);
  const openedViaUrlRef  = useRef(false);

  const loadCedulas = useCallback(() =>
    apiFetch('/api/cedulas').then(r => r.json()).then(d => {
      setCedulas(Array.isArray(d) ? d : []);
    }).catch(console.error),
    [apiFetch]
  );

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

  // ── Ajuste inicial de dateFrom según tarea vencida más antigua ───────────
  useEffect(() => {
    if (dateFromAdjusted.current || aplicacionTasks.length === 0) return;
    dateFromAdjusted.current = true;
    const overdue = aplicacionTasks.filter(isOverdue);
    if (overdue.length === 0) return;
    const oldest = overdue.reduce((a, b) => new Date(a.dueDate) < new Date(b.dueDate) ? a : b);
    setDateFrom(toInputDate(new Date(oldest.dueDate)));
  }, [aplicacionTasks]);

  // taskId → cedula[] (array, since a task can have multiple split cedulas)
  const cedulasByTaskId = useMemo(() => {
    const map = {};
    for (const c of cedulas) {
      if (!map[c.taskId]) map[c.taskId] = [];
      map[c.taskId].push(c);
    }
    return map;
  }, [cedulas]);

  const visibleTasks = useMemo(() => {
    const start = new Date(dateFrom + 'T00:00:00');
    const end   = new Date(dateTo   + 'T23:59:59');
    return aplicacionTasks.filter(t => {
      const due = new Date(t.dueDate);
      return isOverdue(t) || (due >= start && due <= end);
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
  const previewTecnicoResponsable = previewPkg?.tecnicoResponsable || null;
  const previewProductos = previewTask?.activity?.productos || [];

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

  // Calibración: desde la actividad de la tarea, con fallback en la actividad actual del paquete
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
    title: 'Error', body: msg, confirmLabel: 'Entendido', showCancel: false,
  });

  const handleMezclaLista = (cedulaId) => {
    setConfirmModal({
      title: 'Confirmar mezcla lista',
      body: '¿Confirmar que la mezcla está lista? Esto debitará el inventario.',
      confirmLabel: 'Confirmar',
      onConfirm: async () => {
        setActionLoading(cedulaId);
        try {
          const res = await apiFetch(`/api/cedulas/${cedulaId}/mezcla-lista`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: currentUser?.nombre || null }),
          });
          if (!res.ok) { const err = await res.json(); showError(err.message || 'Error al actualizar la cédula.'); return; }
          setCedulas(prev => prev.map(c =>
            c.id === cedulaId ? { ...c, status: 'en_transito', mezclaListaAt: new Date().toISOString(), mezclaListaNombre: currentUser?.nombre || null } : c
          ));
        } finally { setActionLoading(null); }
      },
    });
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
        setActionLoading(cedulaId);
        try {
          const res = await apiFetch(`/api/cedulas/${cedulaId}/anular`, { method: 'PUT' });
          if (!res.ok) { const err = await res.json(); showError(err.message || 'Error al anular la cédula.'); return; }
          const taskId = cedulas.find(c => c.id === cedulaId)?.taskId;
          setCedulas(prev => prev.filter(c => c.id !== cedulaId));
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

    // ── Multi-lote split: one sub-row per cedula ───────────────────────────
    if (isSplit) {
      return (
        <div key={task.id} className={`cedula-row cedula-row--split${isOverdue(task) ? ' overdue' : ''}`}>
          <div className="cedula-row-info">
            <span className="cedula-row-name" title={task.activityName}>{task.activityName}</span>
            <span className="cedula-row-meta">
              {task.loteName}
              {task.responsableName ? ` · ${task.responsableName}` : ''}
            </span>
          </div>
          <div className="cedula-row-badges">
            <span className={`cedula-status-badge${isOverdue(task) ? ' overdue' : ''}`}>
              {isOverdue(task) ? 'Vencida' : 'Pendiente'}
            </span>
            <span className="cedula-due-date">{formatShortDate(task.dueDate)}</span>
          </div>
          <div className="cedula-split-rows">
            {allCedulas.map(c => {
              const isLdg = actionLoading === c.id;
              const canAnular = c.status !== 'aplicada_en_campo' && hasMinRole(currentUser?.rol, 'encargado');
              return (
                <div key={c.id} className="cedula-split-sub-row">
                  <div className="cedula-split-sub-info">
                    <span className="cedula-split-lote">{c.splitLoteNombre || '—'}</span>
                    <span className="cedula-consecutivo">{c.consecutivo}</span>
                    {c.status === 'pendiente'          && <span className="cedula-flow-badge pendiente">Pendiente</span>}
                    {c.status === 'en_transito'        && <span className="cedula-flow-badge en-transito">En Tránsito</span>}
                    {c.status === 'aplicada_en_campo'  && <span className="cedula-flow-badge aplicada">Aplicada</span>}
                  </div>
                  <div className="cedula-split-sub-actions">
                    {c.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
                      <button className="btn btn-secondary cedula-btn-action"
                        onClick={() => handleMezclaLista(c.id)} disabled={isLdg}>
                        <FiCheckCircle size={14} />
                        {isLdg ? 'Procesando…' : 'Mezcla Lista'}
                      </button>
                    )}
                    {c.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
                      <button className="btn btn-primary cedula-btn-action"
                        onClick={() => handleAplicada(c.id)} disabled={isLdg}>
                        <FaTractor size={14} />
                        {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
                      </button>
                    )}
                    <button className="btn btn-secondary cedula-btn-preview"
                      onClick={() => { openedViaUrlRef.current = false; savedScrollRef.current = window.scrollY; setPreviewTask(task); setPreviewCedulaId(c.id); }}
                      title="Ver Cédula de Aplicación">
                      <FiEye size={15} /> <span className="cedula-btn-preview-text">Ver Cédula</span>
                    </button>
                    {canAnular && (
                      <button className="btn btn-danger cedula-btn-action cedula-btn-anular"
                        onClick={() => handleAnular(c.id)} disabled={isLdg}>
                        <FiX size={13} /> Anular
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Single cedula ──────────────────────────────────────────────────────
    const cedula   = allCedulas[0] || null;
    const isLdg    = actionLoading === (cedula ? cedula.id : `new-${task.id}`)
                  || actionLoading === `skip-${task.id}`;
    const showKebab = cedula && cedula.status !== 'aplicada_en_campo'
                   && hasMinRole(currentUser?.rol, 'encargado');
    return (
      <div key={task.id} className={`cedula-row${isOverdue(task) ? ' overdue' : ''}${showKebab ? ' cedula-row--has-menu' : ''}`}>
        <div className="cedula-row-info">
          <span className="cedula-row-name" title={task.activityName}>{task.activityName}</span>
          <span className="cedula-row-meta">
            {task.loteName}
            {task.responsableName ? ` · ${task.responsableName}` : ''}
          </span>
          {cedula && (
            <span className="cedula-consecutivo">{cedula.consecutivo}</span>
          )}
        </div>
        {showKebab && (
          <div className="cedula-kebab-wrap">
            <button
              className="cedula-kebab-btn"
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(id => id === task.id ? null : task.id); }}
              title="Más acciones"
            >
              <FiMoreVertical size={16} />
            </button>
            {openMenuId === task.id && (
              <div className="cedula-kebab-menu" onClick={e => e.stopPropagation()}>
                <button
                  className="cedula-kebab-item cedula-kebab-item--danger"
                  onClick={() => { handleAnular(cedula.id); setOpenMenuId(null); }}
                  disabled={isLdg}
                >
                  <FiX size={13} /> Anular cédula
                </button>
              </div>
            )}
          </div>
        )}

        <div className="cedula-row-badges">
          <span className={`cedula-status-badge${isOverdue(task) ? ' overdue' : ''}`}>
            {isOverdue(task) ? 'Vencida' : 'Pendiente'}
          </span>
          <span className="cedula-due-date">{formatShortDate(task.dueDate)}</span>
          {cedula?.status === 'pendiente' && (
            <span className="cedula-flow-badge pendiente">Pendiente</span>
          )}
          {cedula?.status === 'en_transito' && (
            <span className="cedula-flow-badge en-transito">En Tránsito</span>
          )}
        </div>

        <div className="cedula-row-actions">
            {!cedula && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-secondary cedula-btn-action"
                onClick={() => handleGenerarCedula(task.id)}
                disabled={isLdg}
                title="Generar Cédula de Aplicación"
              >
                <FiPlusCircle size={14} />
                {isLdg ? 'Generando…' : 'Generar Cédula'}
              </button>
            )}

            {!cedula && allowSkipTask && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-danger cedula-btn-action cedula-btn-anular"
                onClick={() => handleOmitirTarea(task.id)}
                disabled={isLdg}
                title="Omitir esta tarea sin generar cédula"
              >
                <FiX size={14} />
                {isLdg ? 'Omitiendo…' : 'Omitir Tarea'}
              </button>
            )}

            {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-secondary cedula-btn-action"
                onClick={() => handleMezclaLista(cedula.id)}
                disabled={isLdg}
                title="Confirmar que la mezcla está lista"
              >
                <FiCheckCircle size={14} />
                {isLdg ? 'Procesando…' : 'Mezcla Lista'}
              </button>
            )}

            {cedula?.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
              <button
                className="btn btn-primary cedula-btn-action"
                onClick={() => handleAplicada(cedula.id)}
                disabled={isLdg}
                title="Confirmar aplicación en campo"
              >
                <FaTractor size={14} />
                {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
              </button>
            )}

            {cedula && (
              <button
                className="btn btn-secondary cedula-btn-preview"
                onClick={() => { openedViaUrlRef.current = false; savedScrollRef.current = window.scrollY; setPreviewTask(task); setPreviewCedulaId(cedula.id); }}
                title="Ver Cédula de Aplicación"
              >
                <FiEye size={15} /> <span className="cedula-btn-preview-text">Ver Cédula</span>
              </button>
            )}
          </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Cargando cédulas...</div>;

  return (
    <div>
      {/* ── Acciones principales ── */}
      <div className="cedulas-top-actions">
        <Link to="/aplicaciones/historial" className="btn btn-secondary">
          <FiClock size={14} /> Historial
        </Link>
        {hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            className="btn btn-primary cedulas-nueva-btn"
            onClick={() => setShowNuevaModal(true)}
          >
            <FiPlusCircle size={14} /> Nueva Cédula
          </button>
        )}
      </div>

      {/* ── Barra de filtro ── */}
      <div className="cedulas-filter-bar">
        <div className="cedulas-date-range">
          <label className="cedulas-date-label">
            Fecha inicial
            <input
              type="date"
              className="cedulas-date-input"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </label>
          <label className="cedulas-date-label">
            Fecha final
            <input
              type="date"
              className="cedulas-date-input"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </label>
        </div>
        <span className="cedulas-filter-count">{visibleTasks.length} tarea(s)</span>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="empty-state">
          {aplicacionTasks.length === 0
            ? 'No hay tareas de aplicación pendientes.'
            : 'No hay aplicaciones programadas para este período.'}
        </div>
      ) : (
        <div className="cedulas-list">
          {visibleTasks.map(task => renderCedulaRow(task, { allowSkipTask: isOverdue(task) }))}
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
                {activeCedula && (
                  <span className="ca-toolbar-consecutivo">
                    {activeCedula.consecutivo}
                  </span>
                )}
              </span>
              <div className="ca-preview-toolbar-actions">
                {/* ── Acciones de flujo inline ── */}
                {(() => {
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
                        className="btn btn-secondary"
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
                        className="btn btn-primary"
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

                <button className="btn btn-secondary ca-toolbar-icon-btn" onClick={handleShare}>
                  <FiShare2 size={15} /> <span className="ca-toolbar-btn-text">Compartir</span>
                </button>
                <button className="btn btn-secondary ca-toolbar-icon-btn" onClick={handlePrint}>
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
                    {activeCedula && (
                      <div className="ca-doc-consecutivo">{activeCedula.consecutivo}</div>
                    )}
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
        <NuevaCedulaModal
          lotes={lotes}
          grupos={grupos}
          siembras={siembras}
          productos={productos}
          calibraciones={calibraciones}
          apiFetch={apiFetch}
          onSuccess={handleNuevaCedulaSuccess}
          onClose={() => setShowNuevaModal(false)}
        />
      )}

      {/* ── Confirm Modal ── */}
      {confirmModal && (
        <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
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
    </div>
  );
}

export default CedulasAplicacion;
