// Lógica de cálculo de la planilla fija. Vive fuera del componente porque es
// la parte más sensible (plata + convención legal Art. 140 CT) y se comparte
// con el reporte/comprobante. Antes estaba inline en FixedPayroll.jsx.

import { CCSS_RATE, fmtShort, dateStr } from './payroll-format';

// Jornada diurna ordinaria por defecto si la ficha no tiene horario
// configurado (8h/día, Art. 136 CT).
export const JORNADA_HORAS_DIARIA_DEFAULT = 8;

const DIAS_HORARIO = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];

// Promedio de horas laborables por día sobre los días activos del horario.
// Para 40h/semana en 5 días → 8h/día. Para jornadas mixtas devuelve el
// promedio. Si no hay horario, devuelve 0 y el caller usa el default.
export function calcHorasDiarias(horario = {}) {
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

// Build per-day array for the period, marking absent days (approved sin-goce leave).
// Partial permisos (esParcial) accumulate horasParciales per day instead of marking ausente.
// efectivoDesde: the actual first day to include (max of period start and fechaIngreso).
// Each day also tracks permisoIdsAusente/permisoIdsParcial so the UI can revert
// a specific entry by deleting the underlying permiso(s).
export function generarDias(fechaInicio, fechaFin, permisos, trabajadorId, efectivoDesde) {
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
export function esMesCompleto(dias) {
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
export function esSegundaQuincena(dias) {
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
export function detectarSolapamientos(nuevasFilas, planillas, editingId, fechaInicio, fechaFin) {
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

// Resuelve las horas laborables/día de una fila, con compat para planillas
// legacy guardadas con horasSemanales (÷6 días = jornada CR de 48h/sem).
export function resolveHorasDiarias(fila) {
  return Number(fila.horasDiarias)
    || (Number(fila.horasSemanales) ? Number(fila.horasSemanales) / 6 : 0)
    || JORNADA_HORAS_DIARIA_DEFAULT;
}

export function recalcFila(fila) {
  const diario = fila.salarioDiario ?? (fila.salarioMensual / 30);
  const horasDiarias = resolveHorasDiarias(fila);
  // Valor-hora derivado del MISMO salario diario que paga el día. Si el usuario
  // sobreescribe el diario, la deducción por horas parciales se calcula sobre
  // ese valor (no sobre el mensual/30 original) → coherente con el cap diario.
  const valorHora = horasDiarias > 0 ? diario / horasDiarias : 0;

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
