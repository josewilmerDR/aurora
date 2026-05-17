import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/hr.css';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiEdit2, FiArrowLeft, FiFileText, FiEye, FiCheckCircle, FiXCircle, FiThumbsUp, FiAlertTriangle, FiCalendar } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import PayrollStepIndicator from '../components/PayrollStepIndicator';
import RegisterPermisoModal from '../components/RegisterPermisoModal';

const CCSS_RATE = 0.1083;
// Default daily hours if the ficha has no schedule configured (jornada
// diurna ordinaria: 8h/día, Art. 136 CT).
const JORNADA_HORAS_DIARIA_DEFAULT = 8;
const ESTADO_LABELS = { pendiente: 'Pendiente', aprobada: 'Aprobada', pagada: 'Pagada' };

// Defensive limits (input validation):
//   SALARIO_MAX amply covers the max expected monthly salary in CRC.
//   PERIODO_MAX_DIAS caps the loadable range (annual + margin).
const SALARIO_MAX     = 10_000_000;
const CONCEPTO_MAX    = 100;
const PERIODO_MAX_DIAS = 366;
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clampNonNeg = (v, max = SALARIO_MAX) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > max ? max : n;
};

const DIAS_HORARIO = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];

// Promedio de horas laborables por día sobre los días activos del horario.
// Para 40h/semana en 5 días → 8h/día. Para jornadas mixtas (ej: 4 días de 8h
// + 2 días de 4h) devuelve el promedio. Si no hay horario, devuelve 0 y el
// caller debe usar JORNADA_HORAS_DIARIA_DEFAULT.
function calcHorasDiarias(horario = {}) {
  let totalHoras = 0;
  let diasActivos = 0;
  for (const key of DIAS_HORARIO) {
    const dia = horario[key];
    if (!dia?.activo || !dia.inicio || !dia.fin) continue;
    const [h1, m1] = dia.inicio.split(':').map(Number);
    const [h2, m2] = dia.fin.split(':').map(Number);
    totalHoras += Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
    diasActivos++;
  }
  return diasActivos > 0 ? totalHoras / diasActivos : 0;
}

const fmt      = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;
const fmtDate  = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtShort = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateStr  = (s) => s.substring(0, 10); // normalize to YYYY-MM-DD

// Build per-day array for the period, marking absent days (approved sin-goce leave).
// Partial permisos (esParcial) accumulate horasParciales per day instead of marking ausente.
// efectivoDesde: the actual first day to include (max of period start and fechaIngreso).
// Each day also tracks permisoIdsAusente/permisoIdsParcial so the UI can revert
// a specific entry by deleting the underlying permiso(s).
function generarDias(fechaInicio, fechaFin, permisos, trabajadorId, efectivoDesde) {
  const dias  = [];
  const fin   = new Date(fechaFin      + 'T12:00:00');
  const desde = new Date((efectivoDesde || fechaInicio) + 'T12:00:00');
  const cur   = new Date(desde);
  while (cur <= fin) {
    const curStr = cur.toISOString().substring(0, 10);

    // Full-day sin-goce: mark the entire day as ausente
    const ausenteList = permisos.filter(p =>
      p.trabajadorId === trabajadorId &&
      p.estado === 'aprobado' &&
      p.conGoce === false &&
      !p.esParcial &&
      curStr >= dateStr(p.fechaInicio) &&
      curStr <= dateStr(p.fechaFin));
    const ausente = ausenteList.length > 0;
    const permisoIdsAusente = ausenteList.map(p => p.id).filter(Boolean);

    // Partial sin-goce: accumulate hours absent on this specific day
    const parcialList = ausente ? [] : permisos.filter(p =>
      p.trabajadorId === trabajadorId &&
      p.estado === 'aprobado' &&
      p.conGoce === false &&
      p.esParcial &&
      dateStr(p.fechaInicio) === curStr);
    const horasParciales    = parcialList.reduce((sum, p) => sum + (Number(p.horas) || 0), 0);
    const permisoIdsParcial = parcialList.map(p => p.id).filter(Boolean);

    dias.push({
      fecha: new Date(cur),
      ausente,
      horasParciales,
      salarioExtra: 0,
      permisoIdsAusente,
      permisoIdsParcial,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return dias;
}

// Art. 140 CR Labor Code: the month is computed as 30 days.
// Detects whether the periodo covers a full calendar month (1st to last day).
function esMesCompleto(dias) {
  if (!dias || dias.length === 0) return false;
  const toD = (f) => f instanceof Date ? f : new Date(f);
  const d1 = toD(dias[0].fecha);
  const d2 = toD(dias[dias.length - 1].fecha);
  const ultimoDelMes = new Date(d1.getFullYear(), d1.getMonth() + 1, 0).getDate();
  return (
    d1.getDate() === 1 &&
    d2.getMonth() === d1.getMonth() &&
    d2.getFullYear() === d1.getFullYear() &&
    d2.getDate() === ultimoDelMes
  );
}

// Detects whether the periodo is a second fortnight (16th to last day of month).
// The 2nd fortnight is always 15 days (= 30 − 15) under Art. 140 of the Labor Code.
function esSegundaQuincena(dias) {
  if (!dias || dias.length === 0) return false;
  const toD = (f) => f instanceof Date ? f : new Date(f);
  const d1 = toD(dias[0].fecha);
  const d2 = toD(dias[dias.length - 1].fecha);
  const ultimoDelMes = new Date(d1.getFullYear(), d1.getMonth() + 1, 0).getDate();
  return (
    d1.getDate() === 16 &&
    d2.getDate() === ultimoDelMes &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
}

// Detects employees in nuevasFilas who already appear in other planillas (pendiente/aprobada/pagada)
// with days overlapping the current periodo. Returns a list of conflicts to show to the user.
function detectarSolapamientos(nuevasFilas, planillas, editingId, fechaInicio, fechaFin) {
  const ESTADOS = new Set(['pendiente', 'aprobada', 'pagada']);
  const conflicts = [];
  for (const planilla of planillas) {
    if (planilla.id === editingId) continue;
    if (!ESTADOS.has(planilla.estado)) continue;
    const pI = planilla.periodoInicio?.substring(0, 10);
    const pF = planilla.periodoFin?.substring(0, 10);
    if (!pI || !pF || pI > fechaFin || pF < fechaInicio) continue;

    for (const filaExistente of (planilla.filas || [])) {
      if (!nuevasFilas.find(f => f.trabajadorId === filaExistente.trabajadorId)) continue;
      const diasSolapados = (filaExistente.dias || []).filter(d => {
        const s = typeof d.fecha === 'string' ? d.fecha.substring(0, 10) : null;
        return s && s >= fechaInicio && s <= fechaFin;
      }).map(d => d.fecha.substring(0, 10)).sort();
      if (!diasSolapados.length) continue;

      const d0 = new Date(diasSolapados[0] + 'T12:00:00');
      const dN = new Date(diasSolapados[diasSolapados.length - 1] + 'T12:00:00');
      const diasLabel = diasSolapados.length === 1
        ? fmtShort(d0)
        : `${fmtShort(d0)} – ${fmtShort(dN)}`;

      const existing = conflicts.find(c => c.trabajadorId === filaExistente.trabajadorId);
      const entry = { estado: planilla.estado, consecutivo: planilla.numeroConsecutivo || null, diasLabel };
      if (existing) {
        existing.detalle.push(entry);
      } else {
        conflicts.push({ trabajadorId: filaExistente.trabajadorId, trabajadorNombre: filaExistente.trabajadorNombre, detalle: [entry] });
      }
    }
  }
  return conflicts;
}

function recalcFila(fila) {
  const diario = fila.salarioDiario ?? (fila.salarioMensual / 30);
  // Valor-hora = (salario mensual / 30) / horas laborables por día.
  // Para 500 000 con jornada de 8h/día → 16 666.66 / 8 = 2 083.33 por hora.
  // Compat con planillas legacy guardadas con horasSemanales (÷ 6 días).
  const horasDiarias = Number(fila.horasDiarias)
    || (Number(fila.horasSemanales) ? Number(fila.horasSemanales) / 6 : 0)
    || JORNADA_HORAS_DIARIA_DEFAULT;
  const valorHora = (fila.salarioMensual / 30) / horasDiarias;

  // Apply 30-day convention (Art. 140 of the CR Labor Code):
  // - Full month (1→last): target = 30 days (31st ignored, February is topped up)
  // - 2nd fortnight (16→last): target = 15 days (16th in 31-day months ignored, February topped up)
  const mesCompleto       = esMesCompleto(fila.dias);
  const segQuincena       = !mesCompleto && esSegundaQuincena(fila.dias);
  const aplicarConvencion = mesCompleto || segQuincena;
  const diasObjetivo      = mesCompleto ? 30 : 15;
  const calDias           = fila.dias.length;

  // Pre-compute per-day partial deduction with daily cap: horas × valorHora
  // never exceeds the day's salary (avoids negative day pay or overcharging
  // when hours are accidentally entered > workday).
  const diasCalc = fila.dias.map(d => {
    if (d.ausente) {
      return { ...d, deduccionParcialBruta: 0, deduccionParcialEfectiva: 0, topeAplicado: false };
    }
    const horas = Number(d.horasParciales) || 0;
    const bruta = horas * valorHora;
    const efectiva = Math.min(bruta, diario);
    return {
      ...d,
      deduccionParcialBruta:    bruta,
      deduccionParcialEfectiva: efectiva,
      topeAplicado:             bruta > diario && horas > 0,
    };
  });

  const salarioDiasReales = diasCalc.reduce((s, d, idx) => {
    if (d.ausente) return s;
    if (aplicarConvencion && calDias > diasObjetivo && idx >= diasObjetivo) return s;
    return s + diario - (d.deduccionParcialEfectiva || 0);
  }, 0);
  const diasVirtuales = aplicarConvencion && calDias < diasObjetivo ? diasObjetivo - calDias : 0;
  const salarioOrdinario = salarioDiasReales + diasVirtuales * diario;
  const salarioExtraordinario = diasCalc.reduce((s, d) => s + (Number(d.salarioExtra) || 0), 0);
  const salarioBruto        = salarioOrdinario + salarioExtraordinario;
  const deduccionCCSS       = salarioBruto * CCSS_RATE;
  const otrasDeduccionesTotal = fila.deduccionesExtra.reduce((s, d) => s + (Number(d.monto) || 0), 0);
  const totalDeducciones    = deduccionCCSS + otrasDeduccionesTotal;
  return {
    ...fila,
    dias:                   diasCalc,
    salarioOrdinario:       Math.round(salarioOrdinario),
    salarioExtraordinario:  Math.round(salarioExtraordinario),
    salarioBruto:           Math.round(salarioBruto),
    deduccionCCSS:          Math.round(deduccionCCSS),
    otrasDeduccionesTotal:  Math.round(otrasDeduccionesTotal),
    totalDeducciones:       Math.round(totalDeducciones),
    totalNeto:              Math.round(salarioBruto - totalDeducciones),
  };
}

function FixedPayroll() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const [users, setUsers]           = useState([]);
  const [allPermisos, setAllPermisos] = useState([]);
  const [toast, setToast]           = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(currentUser?.rol);
  const canPagar   = ['administrador', 'rrhh'].includes(currentUser?.rol);

  const today = new Date();
  const _y = today.getFullYear();
  const _m = String(today.getMonth() + 1).padStart(2, '0');
  const [fechaInicio, setFechaInicio] = useState(`${_y}-${_m}-01`);
  const [fechaFin, setFechaFin]       = useState(`${_y}-${_m}-15`);
  const [loaded, setLoaded]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [filas, setFilas]           = useState([]);
  const [detalleId, setDetalleId]   = useState(null);
  const [editingId, setEditingId]   = useState(null); // ID of saved planilla being edited
  const [planillas, setPlanillas]   = useState([]);
  const [confirmModal, setConfirmModal]             = useState(false);
  const [saveConfirmModal, setSaveConfirmModal]     = useState(false);
  const [deleteConfirmId, setDeleteConfirmId]       = useState(null);
  const [aprobarConfirmId, setAprobarConfirmId]     = useState(null);
  const [pagarConfirmId, setPagarConfirmId]         = useState(null);
  const [solapamientos, setSolapamientos]           = useState(null); // null=ok, array=show warning modal
  const [pendingFilas, setPendingFilas]             = useState(null);
  const [confirmEmailSolap, setConfirmEmailSolap]   = useState('');
  const [editarFechas, setEditarFechas]             = useState(false);
  const [planillasLoaded, setPlanillasLoaded]       = useState(false);
  const [permisoModalFor, setPermisoModalFor]       = useState(null); // {id, nombre} | null
  const [revertConfirm, setRevertConfirm]           = useState(null); // {trabajadorId, ids, day, multiDayRanges} | null
  const [reverting, setReverting]                   = useState(false);
  const autoDateDone = useRef(false);

  const fetchPlanillas = () =>
    apiFetch('/api/hr/planilla-fijo').then(r => r.json()).then(data => {
      setPlanillas(data);
      setPlanillasLoaded(true);
    }).catch(console.error);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/hr/permisos').then(r => r.json()),
    ]).then(([u, p]) => { setUsers(u); setAllPermisos(p); }).catch(console.error);
    fetchPlanillas();
  }, []);

  // Restore state after returning from the report preview
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('aurora_planilla_fijo_state');
      if (!saved) return;
      const { fechaInicio: fi, fechaFin: ff, filas: savedFilas } = JSON.parse(saved);
      const restored = savedFilas.map(f => ({
        ...f,
        dias: (f.dias || []).map(d => ({ ...d, fecha: new Date(d.fecha) })),
      }));
      setFechaInicio(fi);
      setFechaFin(ff);
      setFilas(restored);
      setLoaded(true);
      autoDateDone.current = true; // don't overwrite restored dates
    } catch { /* ignore */ }
  }, []);

  // Auto-adjust default dates once planillas load:
  // If today is day 16+ AND a planilla for the 1–15 of this month already exists → switch to 16–last day.
  useEffect(() => {
    if (!planillasLoaded || autoDateDone.current || loaded) return;
    autoDateDone.current = true;
    const t = new Date();
    if (t.getDate() < 16) return; // keep 1–15 default
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const existe1a15 = planillas.some(p => {
      const pI = p.periodoInicio?.substring(0, 10);
      const pF = p.periodoFin?.substring(0, 10);
      return pI === `${y}-${m}-01` && pF === `${y}-${m}-15`;
    });
    if (existe1a15) {
      const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
      setFechaInicio(`${y}-${m}-16`);
      setFechaFin(`${y}-${m}-${String(lastDay).padStart(2, '0')}`);
    }
  }, [planillasLoaded, loaded]);

  const getPeriodo = () => {
    const inicio = new Date(fechaInicio + 'T12:00:00');
    const fin    = new Date(fechaFin    + 'T12:00:00');
    const dias   = Math.max(1, Math.round((fin - inicio) / 86400000) + 1);
    return { inicio, fin, dias, label: `${fmtDate(inicio)} – ${fmtDate(fin)}` };
  };

  const fechasValidas = fechaInicio && fechaFin && fechaFin >= fechaInicio;

  const handleCargar = async () => {
    if (!fechasValidas) { showToast('La fecha final debe ser igual o posterior a la inicial.', 'error'); return; }
    const { dias: periodDaysCount } = getPeriodo();
    if (periodDaysCount > PERIODO_MAX_DIAS) {
      showToast(`El período no puede exceder ${PERIODO_MAX_DIAS} días.`, 'error'); return;
    }
    sessionStorage.removeItem('aurora_planilla_fijo_state');
    setLoading(true);
    try {
      const fichasArr = await Promise.all(
        users.map(u =>
          apiFetch(`/api/hr/fichas/${u.id}`)
            .then(r => r.json()).then(d => ({ userId: u.id, ...d }))
            .catch(() => ({ userId: u.id }))
        )
      );
      const fichasMap = {};
      fichasArr.forEach(f => { fichasMap[f.userId] = f; });

      const nuevasFilas = users
        .filter(u => {
          if (!u.empleadoPlanilla || !(Number(fichasMap[u.id]?.salarioBase) > 0)) return false;
          const fi = fichasMap[u.id]?.fechaIngreso;
          if (fi && fi > fechaFin) return false;
          return true;
        })
        .map(u => {
          const ficha          = fichasMap[u.id] || {};
          const fi             = ficha.fechaIngreso || '';
          const efectivoDesde  = fi && fi > fechaInicio ? fi : fechaInicio;
          const parcial        = efectivoDesde > fechaInicio;
          const horasDiarias   = calcHorasDiarias(ficha.horarioSemanal);
          return recalcFila({
            trabajadorId:      u.id,
            trabajadorNombre:  u.nombre,
            cedula:            ficha.cedula  || '',
            puesto:            ficha.puesto  || '',
            salarioMensual:    Number(ficha.salarioBase) || 0,
            salarioDiario:     Number(ficha.salarioBase) / 30 || 0,
            horasDiarias:      horasDiarias || JORNADA_HORAS_DIARIA_DEFAULT,
            fechaIngreso:      fi,
            periodoParcial:    parcial,
            efectivoDesde:     efectivoDesde,
            dias:              generarDias(fechaInicio, fechaFin, allPermisos, u.id, efectivoDesde),
            deduccionesExtra:  [],
          });
        });

      // Detect overlap with existing planillas (pendiente / aprobada / pagada)
      const conflictos = detectarSolapamientos(nuevasFilas, planillas, editingId, fechaInicio, fechaFin);
      if (conflictos.length > 0) {
        setPendingFilas(nuevasFilas);
        setSolapamientos(conflictos);
        setConfirmEmailSolap('');
      } else {
        setFilas(nuevasFilas);
        setLoaded(true);
        setDetalleId(null);
      }
    } catch {
      showToast('Error al cargar datos de empleados.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Recalculate dias in-place when dates change while editing a saved planilla
  const handleFechaChange = (field, value) => {
    const newInicio = field === 'inicio' ? value : fechaInicio;
    const newFin    = field === 'fin'    ? value : fechaFin;
    if (field === 'inicio') setFechaInicio(value);
    else setFechaFin(value);

    if (!editingId) {
      setLoaded(false);
      setDetalleId(null);
    } else if (newInicio && newFin && newFin >= newInicio) {
      setFilas(prev => prev.map(f => {
        const efectivoDesde = f.fechaIngreso && f.fechaIngreso > newInicio ? f.fechaIngreso : newInicio;
        return recalcFila({ ...f, dias: generarDias(newInicio, newFin, allPermisos, f.trabajadorId, efectivoDesde) });
      }));
      setDetalleId(null);
    }
  };

  const handleSalarioDiarioChange = (id, value) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, salarioDiario: clampNonNeg(value) })));

  const handleEliminar = (id) => {
    setFilas(prev => prev.filter(f => f.trabajadorId !== id));
    if (detalleId === id) setDetalleId(null);
  };

  const handleExtraChange = (id, dayIdx, value) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      const dias = f.dias.map((d, i) => i === dayIdx ? { ...d, salarioExtra: clampNonNeg(value) } : d);
      return recalcFila({ ...f, dias });
    }));

  const addDeduccion = (id) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, deduccionesExtra: [...f.deduccionesExtra, { concepto: '', monto: 0 }] })));

  const updateDeduccion = (id, idx, field, value) =>
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== id) return f;
      const deduccionesExtra = f.deduccionesExtra.map((d, i) => {
        if (i !== idx) return d;
        if (field === 'monto')    return { ...d, monto: clampNonNeg(value) };
        if (field === 'concepto') return { ...d, concepto: String(value).slice(0, CONCEPTO_MAX) };
        return d;
      });
      return recalcFila({ ...f, deduccionesExtra });
    }));

  const removeDeduccion = (id, idx) =>
    setFilas(prev => prev.map(f => f.trabajadorId !== id ? f :
      recalcFila({ ...f, deduccionesExtra: f.deduccionesExtra.filter((_, i) => i !== idx) })));

  // Abre el modal de confirmación para revertir los permisos de un día puntual.
  // Para permisos ausente que abarcan varios días, muestra el rango completo
  // que se eliminará (la eliminación es por permiso, no por día — el endpoint
  // no soporta "quitar solo este día" de un permiso multi-día).
  const askRevertirDia = (trabajadorId, dayIdx) => {
    const fila = filas.find(f => f.trabajadorId === trabajadorId);
    if (!fila) return;
    const day = fila.dias[dayIdx];
    if (!day) return;
    const ids = [...(day.permisoIdsAusente || []), ...(day.permisoIdsParcial || [])];
    if (!ids.length) return;
    const tipo = day.ausente ? 'ausente' : 'parcial';
    // Para multi-day: calcula el rango de cada permiso afectado
    const multiDayRanges = day.ausente
      ? ids.map(id => {
          const p = allPermisos.find(x => x.id === id);
          if (!p) return null;
          const pI = dateStr(p.fechaInicio);
          const pF = dateStr(p.fechaFin);
          return pI !== pF ? { id, pI, pF } : null;
        }).filter(Boolean)
      : [];
    setRevertConfirm({ trabajadorId, ids, dayFecha: day.fecha, tipo, horasParciales: day.horasParciales, multiDayRanges });
  };

  const doRevertir = async () => {
    if (!revertConfirm || reverting) return;
    const { trabajadorId, ids } = revertConfirm;
    setReverting(true);
    try {
      const results = await Promise.all(ids.map(id =>
        apiFetch(`/api/hr/permisos/${id}`, { method: 'DELETE' })
      ));
      if (!results.every(r => r.ok)) {
        showToast('No se pudo eliminar uno o más permisos. Verifique sus permisos de rol.', 'error');
        return;
      }
      const fresh = await apiFetch('/api/hr/permisos').then(r => r.json()).catch(() => null);
      if (!fresh) { showToast('Eliminados, pero falló el refresco.', 'error'); return; }
      setAllPermisos(fresh);
      setFilas(prev => prev.map(f => {
        if (f.trabajadorId !== trabajadorId) return f;
        const efectivoDesde = f.fechaIngreso && f.fechaIngreso > fechaInicio ? f.fechaIngreso : fechaInicio;
        return recalcFila({ ...f, dias: generarDias(fechaInicio, fechaFin, fresh, f.trabajadorId, efectivoDesde) });
      }));
      showToast('Movimiento revertido.');
      setRevertConfirm(null);
    } catch {
      showToast('Error al revertir el permiso.', 'error');
    } finally {
      setReverting(false);
    }
  };

  // Tras registrar (y posiblemente aprobar) un permiso desde el modal, refresca
  // allPermisos y regenera los dias de la fila afectada usando la lista nueva.
  // Solo se regenera si autoApproved (los permisos pendientes no impactan).
  const handlePermisoSuccess = async (trabajadorId, { autoApproved }) => {
    setPermisoModalFor(null);
    const fresh = await apiFetch('/api/hr/permisos').then(r => r.json()).catch(() => null);
    if (!fresh) { showToast('Permiso registrado, pero falló el refresco.', 'error'); return; }
    setAllPermisos(fresh);
    if (!autoApproved) {
      showToast('Permiso registrado en estado pendiente.');
      return;
    }
    setFilas(prev => prev.map(f => {
      if (f.trabajadorId !== trabajadorId) return f;
      const efectivoDesde = f.fechaIngreso && f.fechaIngreso > fechaInicio ? f.fechaIngreso : fechaInicio;
      return recalcFila({ ...f, dias: generarDias(fechaInicio, fechaFin, fresh, f.trabajadorId, efectivoDesde) });
    }));
    showToast('Permiso aprobado y aplicado a la planilla.');
  };

  const { label: periodoLabel, inicio: periodoInicio, fin: periodoFin, dias: periodoDias } = getPeriodo();
  // Art. 140 Labor Code: reuses esMesCompleto / esSegundaQuincena by building a
  // synthetic {fecha} array for the periodo's boundaries.
  const periodoDiasArr = fechasValidas
    ? [{ fecha: new Date(fechaInicio + 'T12:00:00') }, { fecha: new Date(fechaFin + 'T12:00:00') }]
    : [];
  const esPeriodoMesCompleto     = esMesCompleto(periodoDiasArr);
  const esPeriodoSegundaQuincena = !esPeriodoMesCompleto && esSegundaQuincena(periodoDiasArr);
  const diasEfectivos = esPeriodoMesCompleto ? 30 : esPeriodoSegundaQuincena ? 15 : periodoDias;
  const totalGeneral = filas.reduce((s, f) => s + Math.max(0, f.totalNeto), 0);

  const handleConfirmarSolapamiento = () => {
    const entered = confirmEmailSolap.trim().toLowerCase();
    if (!EMAIL_RE.test(entered)) {
      showToast('Ingrese un correo con formato válido.', 'error'); return;
    }
    if (entered !== (currentUser?.email || '').toLowerCase()) {
      showToast('El correo ingresado no coincide con el usuario actual.', 'error'); return;
    }
    setFilas(pendingFilas);
    setLoaded(true);
    setDetalleId(null);
    setSolapamientos(null);
    setPendingFilas(null);
    setConfirmEmailSolap('');
  };

  const handleGuardar = async () => {
    if (!filas.length) { showToast('No hay empleados en la planilla.', 'error'); return; }
    if (!fechasValidas) { showToast('Fechas del período inválidas.', 'error'); return; }
    if (periodoDias > PERIODO_MAX_DIAS) {
      showToast(`El período no puede exceder ${PERIODO_MAX_DIAS} días.`, 'error'); return;
    }
    setSaving(true);
    try {
      const filasPayload = filas.map(({ dias, ...rest }) => ({
        ...rest,
        dias: (dias || []).map(d => ({ ...d, fecha: d.fecha instanceof Date ? d.fecha.toISOString() : d.fecha })),
      }));
      if (editingId) {
        // Update existing pendiente planilla
        const res = await apiFetch(`/api/hr/planilla-fijo/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            filas: filasPayload,
            totalGeneral,
            periodoInicio: periodoInicio.toISOString(),
            periodoFin:    periodoFin.toISOString(),
            periodoLabel,
          }),
        });
        if (!res.ok) throw new Error();
        setLoaded(false);
        setFilas([]);
        setDetalleId(null);
        showToast('Planilla actualizada correctamente.');
      } else {
        // Create new planilla → pendiente + notify
        const res = await apiFetch('/api/hr/planilla-fijo', {
          method: 'POST',
          body: JSON.stringify({
            periodoInicio: periodoInicio.toISOString(),
            periodoFin:    periodoFin.toISOString(),
            periodoLabel,
            filas: filasPayload,
            totalGeneral,
          }),
        });
        if (!res.ok) throw new Error();
        // Clear the preview area and show success modal
        setLoaded(false);
        setFilas([]);
        setDetalleId(null);
        setConfirmModal(true);
      }
      fetchPlanillas();
      setEditingId(null);
    } catch {
      showToast('Error al guardar la planilla.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminarPlanilla = async () => {
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Planilla eliminada.');
      fetchPlanillas();
    } catch {
      showToast('Error al eliminar la planilla.', 'error');
    }
  };

  const handleAprobarPlanilla = async () => {
    const id = aprobarConfirmId;
    setAprobarConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado: 'aprobada' }),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla aprobada.');
      fetchPlanillas();
    } catch {
      showToast('Error al aprobar la planilla.', 'error');
    }
  };

  const handleMarcarPagado = async () => {
    const id = pagarConfirmId;
    setPagarConfirmId(null);
    try {
      const res = await apiFetch(`/api/hr/planilla-fijo/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado: 'pagada' }),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla marcada como pagada.');
      fetchPlanillas();
    } catch {
      showToast('Error al actualizar el estado.', 'error');
    }
  };

  const handleEditarPlanilla = (p) => {
    const inicio = p.periodoInicio.split('T')[0];
    const fin    = p.periodoFin.split('T')[0];
    // Regenerate dias so recalcFila can recompute correctly on any user change.
    // salarioDiario and deduccionesExtra from the saved planilla are preserved.
    const restoredFilas = p.filas.map(f => {
      const efectivoDesde = f.fechaIngreso && f.fechaIngreso > inicio ? f.fechaIngreso : inicio;
      // Compat: planillas guardadas antes del cambio sólo tienen horasSemanales
      // (jornada legal CR: 48h/sem en 6 días → 8h/día). Las nuevas almacenan
      // horasDiarias directamente.
      const horasDiarias = f.horasDiarias
        || (f.horasSemanales ? f.horasSemanales / 6 : 0)
        || JORNADA_HORAS_DIARIA_DEFAULT;
      return recalcFila({
        ...f,
        horasDiarias,
        deduccionesExtra: f.deduccionesExtra || [],
        dias: generarDias(inicio, fin, allPermisos, f.trabajadorId, efectivoDesde),
      });
    });
    setFechaInicio(inicio);
    setFechaFin(fin);
    setFilas(restoredFilas);
    setLoaded(true);
    setDetalleId(null);
    setEditingId(p.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleVerPlanilla = (p) => {
    const data = {
      periodoInicio:     p.periodoInicio,
      periodoFin:        p.periodoFin,
      periodoLabel:      p.periodoLabel,
      totalGeneral:      p.totalGeneral,
      filas:             p.filas,
      numeroConsecutivo: p.numeroConsecutivo || null,
    };
    sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
    sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/planilla/fijo');
    sessionStorage.removeItem('aurora_planilla_fijo_state'); // Don't restore draft on return
    navigate('/hr/planilla/fijo/reporte');
  };

  const handleGenerarReporte = () => {
    const data = {
      periodoInicio:     periodoInicio.toISOString(),
      periodoFin:        periodoFin.toISOString(),
      periodoLabel,
      totalGeneral,
      filas:             filas.map(({ dias, ...rest }) => ({
        ...rest,
        dias: (dias || []).map(d => ({ ...d, fecha: d.fecha instanceof Date ? d.fecha.toISOString() : d.fecha })),
      })),
      numeroConsecutivo: null, // Not yet saved — shown as BORRADOR in report
    };
    sessionStorage.setItem('aurora_planilla_reporte', JSON.stringify(data));
    sessionStorage.setItem('aurora_planilla_reporte_origin', '/hr/planilla/fijo');
    sessionStorage.setItem('aurora_planilla_fijo_state', JSON.stringify({ fechaInicio, fechaFin, filas }));
    navigate('/hr/planilla/fijo/reporte');
  };

  const filaDetalle = filas.find(f => f.trabajadorId === detalleId);

  // Paso visual del flujo. Se calcula desde el estado existente — no
  // controla navegación, sólo orienta al usuario.
  //   1 = configurando período (no hay empleados cargados aún)
  //   2 = revisando empleados (la planilla está cargada)
  //   3 = guardando (modal de save abierto, save in flight, o success)
  const currentStep = (saving || saveConfirmModal || confirmModal)
    ? 3
    : (loaded ? 2 : 1);

  return (
    <div className="planilla-page-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <PayrollStepIndicator currentStep={currentStep} />

      {/* ── Configurar período + tabla de resultados ── */}
      <div className="form-card">
        <h2>Configurar Período</h2>
        <div className="planilla-config-bar">
          <div className="form-control">
            <label>Fecha inicio</label>
            <input type="date" value={fechaInicio} disabled={!editarFechas}
              onChange={e => handleFechaChange('inicio', e.target.value)} />
          </div>
          <div className="form-control">
            <label>Fecha fin</label>
            <input type="date" value={fechaFin} disabled={!editarFechas}
              onChange={e => handleFechaChange('fin', e.target.value)} />
          </div>
          <label className="planilla-config-check">
            <input type="checkbox" checked={editarFechas}
              onChange={e => setEditarFechas(e.target.checked)} />
            Editar fechas
          </label>
          <button className="aur-btn-pill planilla-config-btn" onClick={handleCargar}
            disabled={loading || !users.length || !fechasValidas}>
            <FiRefreshCw /> {loading ? 'Cargando...' : 'Previsualizar'}
          </button>
        </div>
        {fechasValidas && (
          <div className="hr-periodo-preview">
            Período: <strong>{periodoLabel}</strong>
            {' · '}Factor: <strong>{diasEfectivos}/30 días</strong>
            {(esPeriodoMesCompleto || esPeriodoSegundaQuincena) && periodoDias !== diasEfectivos && (
              <span style={{ opacity: 0.55, fontSize: '0.8rem', marginLeft: 6 }}>
                (mes calendario = 30 días · Art. 140 CT)
              </span>
            )}
          </div>
        )}

        {/* ── Grid de resumen (dentro de la misma card) ── */}
        {loaded && !detalleId && (
          <>
            <div className="planilla-sum-section-divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
              <span className="form-section-title" style={{ margin: 0 }}>Planilla — {periodoLabel}</span>
              <div className="planilla-header-actions-bar" style={{ display: 'flex', gap: 10 }}>
                <button className="aur-btn-text" title="Descartar y cerrar" onClick={() => {
                  setLoaded(false); setFilas([]); setDetalleId(null); setEditingId(null);
                  sessionStorage.removeItem('aurora_planilla_fijo_state');
                }}>
                  <FiXCircle size={15} /> Cancelar
                </button>
                <button className="aur-btn-text" onClick={handleGenerarReporte}>
                  <FiFileText /> Previsualizar Planilla
                </button>
                <button className="aur-btn-pill" onClick={() => setSaveConfirmModal(true)} disabled={saving}>
                  <FiSave /> {saving ? 'Guardando...' : editingId ? 'Actualizar planilla' : 'Guardar planilla'}
                </button>
              </div>
            </div>

            {filas.length === 0 ? (
              <EmptyState
                icon={FiFileText}
                title="No hay empleados con salario base configurado"
                subtitle="Completa la Ficha del Trabajador primero para que aparezcan en la planilla fija."
              />
            ) : (
              <>
                <div className="planilla-sum-wrap">
                  <div className="planilla-sum-header">
                    <div>Nombre</div>
                    <div>Ordinario</div>
                    <div>Extraordinario</div>
                    <div>Salario Bruto</div>
                    <div>Deducciones</div>
                    <div>Total Neto</div>
                    <div></div>
                  </div>
                  {filas.map(f => (
                    <div key={f.trabajadorId} className="planilla-sum-row">
                      <div className="planilla-sum-nombre">
                        {f.trabajadorNombre}
                        {f.periodoParcial && (
                          <span className="planilla-parcial-badge"
                            title={`Ingresó el ${fmtShort(new Date(f.fechaIngreso + 'T12:00:00'))} — período parcial`}>
                            ⚠ Ingreso {fmtShort(new Date(f.fechaIngreso + 'T12:00:00'))}
                          </span>
                        )}
                      </div>
                      <div>{fmt(f.salarioOrdinario)}</div>
                      <div>{f.salarioExtraordinario > 0
                        ? fmt(f.salarioExtraordinario)
                        : <span className="planilla-sum-dash">—</span>}
                      </div>
                      <div>{fmt(f.salarioBruto)}</div>
                      <div className="planilla-sum-ded">({fmt(f.totalDeducciones)})</div>
                      <div className="planilla-sum-neto">{fmt(f.totalNeto)}</div>
                      <div className="planilla-sum-actions">
                        <button className="aur-icon-btn" title="Modificar" onClick={() => setDetalleId(f.trabajadorId)}>
                          <FiEdit2 size={16} />
                        </button>
                        <button className="aur-icon-btn aur-icon-btn--danger" title="Eliminar de planilla" onClick={() => handleEliminar(f.trabajadorId)}>
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="planilla-grand-total">
                  <span>Total general a pagar</span>
                  <span>{fmt(totalGeneral)}</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ── Vista detalle de un empleado ── */}
      {loaded && detalleId && filaDetalle && (
        <div className="form-card">
          <button className="aur-btn-text planilla-detalle-back" onClick={() => setDetalleId(null)}>
            <FiArrowLeft /> Volver a la planilla
          </button>

          {/* Header del empleado */}
          <div className="planilla-det-emp-header">
            <div className="planilla-det-emp-avatar">
              {(filaDetalle.trabajadorNombre || '?').charAt(0).toUpperCase() || '?'}
            </div>
            <div>
              <div className="planilla-det-emp-name">{filaDetalle.trabajadorNombre}</div>
              <div className="planilla-det-emp-sub">
                {filaDetalle.cedula && <span>{filaDetalle.cedula}</span>}
                {filaDetalle.puesto && <span>{filaDetalle.puesto}</span>}
              </div>
            </div>
            <div className="planilla-det-emp-actions">
              <button
                className="aur-btn-text"
                title="Registrar un permiso o ausencia para este empleado dentro del período"
                onClick={() => setPermisoModalFor({ id: filaDetalle.trabajadorId, nombre: filaDetalle.trabajadorNombre })}
              >
                <FiCalendar size={14} /> Registrar ausencia / permiso
              </button>
            </div>
          </div>

          {/* Salario diario editable */}
          <div className="planilla-det-diario-row">
            <span className="planilla-det-diario-label">Salario diario</span>
            <input
              type="number" min="0" step="100" max={SALARIO_MAX}
              className="planilla-det-diario-input"
              value={filaDetalle.salarioDiario ?? Math.round(filaDetalle.salarioMensual / 30)}
              onChange={e => handleSalarioDiarioChange(detalleId, e.target.value)}
            />
            <span className="planilla-det-diario-hint">
              Base mensual: {fmt(filaDetalle.salarioMensual)} ÷ 30 = {fmt(filaDetalle.salarioMensual / 30)}
              {filaDetalle.horasDiarias
                ? ` · Valor/hora: ${fmt((filaDetalle.salarioMensual / 30) / filaDetalle.horasDiarias)} (${filaDetalle.horasDiarias}h/día)`
                : ` · Valor/hora calculado con ${JORNADA_HORAS_DIARIA_DEFAULT}h/día (horario no configurado)`}
            </span>
          </div>

          {/* Desglose diario */}
          <div className="planilla-det-table-wrap">
            <table className="planilla-det-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Fecha</th>
                  <th>Salario Ordinario</th>
                  <th>Salario Extraordinario</th>
                </tr>
              </thead>
              <tbody>
                {filaDetalle.dias.map((d, idx) => {
                  const diario = filaDetalle.salarioDiario ?? (filaDetalle.salarioMensual / 30);
                  // Usa los valores ya capados que calculó recalcFila (incluye
                  // el tope diario). Fallback al cálculo si por alguna razón
                  // no están seteados (e.g. fila recién cargada antes del recalc).
                  const deduccionParcial = d.deduccionParcialEfectiva ?? 0;
                  const deduccionParcialBruta = d.deduccionParcialBruta ?? 0;
                  const topeAplicado = !!d.topeAplicado;
                  return (
                    <tr key={idx} className={d.ausente ? 'planilla-det-row--ausente' : d.horasParciales > 0 ? 'planilla-det-row--parcial' : ''}>
                      <td style={{ textAlign: 'left' }}>{fmtShort(d.fecha)}</td>
                      <td>
                        {d.ausente ? (
                          <span className="planilla-det-cell-with-action">
                            <span className="planilla-det-ausente">Ausente (sin goce)</span>
                            <button
                              type="button"
                              className="planilla-det-revert-btn"
                              title="Revertir esta ausencia"
                              onClick={() => askRevertirDia(detalleId, idx)}
                            >
                              <FiXCircle size={14} />
                            </button>
                          </span>
                        ) : d.horasParciales > 0 ? (
                          <span className="planilla-det-parcial-cell">
                            {fmt(diario - deduccionParcial)}
                            <span className="planilla-det-parcial-tag">
                              −{d.horasParciales}h sin goce ({fmt(deduccionParcial)})
                              {topeAplicado && (
                                <span className="planilla-det-tope-tag"
                                  title={`Las ${d.horasParciales}h equivalen a ${fmt(deduccionParcialBruta)}, pero la deducción se topó al salario diario (${fmt(diario)}).`}>
                                  tope diario
                                </span>
                              )}
                              <button
                                type="button"
                                className="planilla-det-revert-btn"
                                title="Revertir las horas registradas para este día"
                                onClick={() => askRevertirDia(detalleId, idx)}
                              >
                                <FiXCircle size={14} />
                              </button>
                            </span>
                          </span>
                        ) : (
                          fmt(diario)
                        )}
                      </td>
                      <td>
                        <input
                          type="number" min="0" max={SALARIO_MAX}
                          value={d.salarioExtra || ''}
                          placeholder="—"
                          className="planilla-det-extra-input"
                          onChange={e => handleExtraChange(detalleId, idx, e.target.value)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ textAlign: 'left' }}>Total Salario</td>
                  <td>{fmt(filaDetalle.salarioOrdinario)}</td>
                  <td>{filaDetalle.salarioExtraordinario > 0 ? fmt(filaDetalle.salarioExtraordinario) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Resumen final */}
          <div className="planilla-det-summary">
            <div className="planilla-det-sum-row">
              <span>Total Salario Bruto</span>
              <span>{fmt(filaDetalle.salarioBruto)}</span>
            </div>
            <div className="planilla-det-sum-row planilla-det-sum-row--ded">
              <span>Seguridad Social ({(CCSS_RATE * 100).toFixed(2)}%)</span>
              <span>({fmt(filaDetalle.deduccionCCSS)})</span>
            </div>

            {filaDetalle.deduccionesExtra.map((d, idx) => (
              <div key={idx} className="planilla-det-sum-row planilla-det-sum-row--ded planilla-det-sum-row--editable">
                <input
                  type="text" placeholder="Concepto de deducción"
                  maxLength={CONCEPTO_MAX}
                  value={d.concepto}
                  onChange={e => updateDeduccion(detalleId, idx, 'concepto', e.target.value)}
                  className="planilla-ded-concepto"
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ opacity: 0.5 }}>(</span>
                  <input
                    type="number" placeholder="0" min="0" max={SALARIO_MAX}
                    value={d.monto || ''}
                    onChange={e => updateDeduccion(detalleId, idx, 'monto', e.target.value)}
                    className="planilla-ded-monto"
                  />
                  <span style={{ opacity: 0.5 }}>)</span>
                  <button onClick={() => removeDeduccion(detalleId, idx)}
                    className="aur-icon-btn aur-icon-btn--danger" title="Quitar">
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            <div className="planilla-det-sum-row planilla-det-sum-row--add">
              <button className="planilla-add-ded" onClick={() => addDeduccion(detalleId)}>
                <FiPlus size={13} /> Agregar deducción
              </button>
            </div>

            <div className="planilla-det-sum-row">
              <span>Otras deducciones</span>
              <span>({fmt(filaDetalle.otrasDeduccionesTotal)})</span>
            </div>

            <div className="planilla-det-sum-row planilla-det-sum-row--neto">
              <span>Total Salario Neto</span>
              <span>{fmt(filaDetalle.totalNeto)}</span>
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: 24 }}>
            <button className="aur-btn-text" onClick={() => setDetalleId(null)}>
              <FiArrowLeft /> Volver
            </button>
          </div>
        </div>
      )}

      {/* ── Aprobar confirmation modal ── */}
      {aprobarConfirmId && (
        <AuroraConfirmModal
          title="Aprobar planilla"
          body="¿Confirma que desea aprobar esta planilla? Una vez aprobada, quedará lista para que se procese el pago."
          confirmLabel="Aprobar"
          icon={<FiThumbsUp size={16} />}
          onConfirm={handleAprobarPlanilla}
          onCancel={() => setAprobarConfirmId(null)}
        />
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteConfirmId && (
        <AuroraConfirmModal
          danger
          title="Eliminar planilla"
          body="¿Está seguro de que desea eliminar esta planilla? Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={handleEliminarPlanilla}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}

      {/* ── Pagar confirmation modal ── */}
      {pagarConfirmId && (
        <AuroraConfirmModal
          title="Confirmar pago de planilla"
          body={<>Al confirmar, esta planilla pasará a estado <strong>Pagada</strong>. Se registrará la fecha de pago y se marcará la tarea de aprobación como completada.</>}
          confirmLabel="Confirmar pago"
          icon={<FiCheckCircle size={16} />}
          onConfirm={handleMarcarPagado}
          onCancel={() => setPagarConfirmId(null)}
        />
      )}

      {/* ── Save confirmation modal ── */}
      {saveConfirmModal && (
        <AuroraConfirmModal
          title={editingId ? 'Actualizar planilla' : 'Guardar planilla'}
          body={editingId
            ? 'Se actualizarán los datos de esta planilla pendiente de pago. Esta acción sobrescribirá los montos actuales.'
            : `¿Confirma que desea guardar la planilla del período ${periodoLabel}? La planilla pasará a estado Pendiente y se notificará a los supervisores.`}
          confirmLabel={editingId ? 'Actualizar' : 'Confirmar y guardar'}
          icon={<FiSave size={16} />}
          loading={saving}
          onConfirm={() => { setSaveConfirmModal(false); handleGuardar(); }}
          onCancel={() => setSaveConfirmModal(false)}
        />
      )}

      {/* ── Success confirmation modal ── */}
      {confirmModal && (
        <AuroraConfirmModal
          showCancel={false}
          title="Planilla guardada"
          body={<>La planilla ha quedado en estado <strong>Pendiente</strong>. Se ha enviado una notificación a los supervisores para su aprobación.</>}
          confirmLabel="Entendido"
          icon={<FiCheckCircle size={16} />}
          onConfirm={() => setConfirmModal(false)}
          onCancel={() => setConfirmModal(false)}
        />
      )}

      {/* ── Registrar permiso desde la planilla ── */}
      {permisoModalFor && (
        <RegisterPermisoModal
          trabajador={permisoModalFor}
          defaultFecha={fechaInicio}
          periodoInicio={fechaInicio}
          periodoFin={fechaFin}
          autoApprove={canAprobar}
          showToast={showToast}
          onCancel={() => setPermisoModalFor(null)}
          onSuccess={(result) => handlePermisoSuccess(permisoModalFor.id, result)}
        />
      )}

      {/* ── Revertir permiso de un día ── */}
      {revertConfirm && (
        <AuroraConfirmModal
          danger
          size="wide"
          title="Revertir movimiento"
          body={revertConfirm.tipo === 'ausente'
            ? <>Se eliminará la ausencia registrada para el <strong>{fmtShort(revertConfirm.dayFecha)}</strong>. El empleado volverá a recibir el pago de este día.</>
            : <>Se eliminarán las <strong>{revertConfirm.horasParciales}h</strong> registradas como sin goce para el <strong>{fmtShort(revertConfirm.dayFecha)}</strong>. Podrá volver a registrar la cantidad correcta.</>}
          confirmLabel="Revertir"
          loading={reverting}
          loadingLabel="Revirtiendo…"
          icon={<FiXCircle size={16} />}
          onConfirm={doRevertir}
          onCancel={() => setRevertConfirm(null)}
        >
          {revertConfirm.multiDayRanges.length > 0 && (
            <div className="planilla-revert-warning">
              <FiAlertTriangle size={14} /> Atención: el permiso original abarca varios días. Al revertir se eliminará el permiso completo, afectando:
              <ul>
                {revertConfirm.multiDayRanges.map(r => (
                  <li key={r.id}>{fmtShort(new Date(r.pI + 'T12:00:00'))} – {fmtShort(new Date(r.pF + 'T12:00:00'))}</li>
                ))}
              </ul>
            </div>
          )}
        </AuroraConfirmModal>
      )}

      {/* ── Solapamiento warning modal ── */}
      {solapamientos && (
        <AuroraConfirmModal
          size="wide"
          title="Empleados ya incluidos en planilla activa"
          body={<>Los siguientes empleados ya han sido incluidos en una planilla para este período o días del período. Su inclusión implicará un pago adicional por los mismos días. Si está seguro de continuar, escriba su correo de usuario y haga clic en <strong>Aceptar</strong>.</>}
          confirmLabel="Aceptar de todas formas"
          confirmDisabled={!confirmEmailSolap.trim()}
          onConfirm={handleConfirmarSolapamiento}
          onCancel={() => { setSolapamientos(null); setPendingFilas(null); setConfirmEmailSolap(''); }}
        >
          <div className="planilla-solap-detail">
            <ul className="planilla-solap-list">
              {solapamientos.map(c => (
                <li key={c.trabajadorId}>
                  <strong>{c.trabajadorNombre}</strong>:{' '}
                  {c.detalle.map((d, i) => (
                    <span key={i}>
                      {i > 0 && '; '}
                      planilla en estado <em>{ESTADO_LABELS[d.estado] || d.estado}</em>
                      {d.consecutivo ? ` (${d.consecutivo})` : ''}, días: {d.diasLabel}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <input
              type="email"
              className="aur-input planilla-solap-input"
              placeholder="Su correo de usuario"
              maxLength={120}
              autoComplete="off"
              value={confirmEmailSolap}
              onChange={e => setConfirmEmailSolap(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirmarSolapamiento()}
            />
          </div>
        </AuroraConfirmModal>
      )}

      {/* ── Historial de planillas ── */}
      {planillas.length > 0 && (
        <div className="form-card">
          <h2>Historial de Planillas</h2>
          <div className="planilla-hist-list">
            <div className="planilla-hist-header">
              <div>Período</div>
              <div>Empleados</div>
              <div>Total</div>
              <div>Estado</div>
              <div></div>
            </div>
            {planillas.map(p => {
              const isPendiente = p.estado === 'pendiente';
              const isAprobada  = p.estado === 'aprobada';
              const isPagada    = p.estado === 'pagada';
              return (
                <div key={p.id} className="planilla-hist-row">
                  <div className="planilla-hist-periodo">{p.periodoLabel}</div>
                  <div>{p.filas?.length ?? '—'}</div>
                  <div className="planilla-hist-total">{fmt(p.totalGeneral)}</div>
                  <div>
                    {isPendiente && <span className="planilla-badge planilla-badge--pendiente">Pendiente</span>}
                    {isAprobada  && <span className="planilla-badge planilla-badge--aprobada">Aprobada</span>}
                    {isPagada    && <span className="planilla-badge planilla-badge--pagada">Pagada</span>}
                    {!isPendiente && !isAprobada && !isPagada && <span className="planilla-badge planilla-badge--otro">{p.estado}</span>}
                  </div>
                  <div className="planilla-hist-actions">
                    <button className="aur-icon-btn" title="Ver planilla" onClick={() => handleVerPlanilla(p)}>
                      <FiEye size={16} />
                    </button>
                    {isPendiente && (
                      <>
                        <button className="aur-icon-btn" title="Editar planilla" onClick={() => handleEditarPlanilla(p)}>
                          <FiEdit2 size={16} />
                        </button>
                        {canAprobar && (
                          <button className="planilla-hist-pay-btn" title="Aprobar planilla"
                            style={{ background: 'rgba(51,153,255,0.15)', color: '#5599ff', border: '1px solid rgba(51,153,255,0.35)' }}
                            onClick={() => setAprobarConfirmId(p.id)}>
                            <FiThumbsUp size={14} /> Aprobar
                          </button>
                        )}
                        <button className="aur-icon-btn aur-icon-btn--danger" title="Eliminar planilla"
                          onClick={() => setDeleteConfirmId(p.id)}>
                          <FiXCircle size={16} />
                        </button>
                      </>
                    )}
                    {isAprobada && canPagar && (
                      <button className="planilla-hist-pay-btn" title="Pagar planilla"
                        onClick={() => setPagarConfirmId(p.id)}>
                        <FiCheckCircle size={14} /> Pagar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default FixedPayroll;
