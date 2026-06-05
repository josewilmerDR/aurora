// HR — Planilla salario fijo: sanitización y validación de payloads.
//
// Funciones puras extraídas de payroll-fixed.js (split §1: mantener el router
// bajo presupuesto de LOC y aislar la lógica de saneo testeable sin Express).
// No tocan db ni req — reciben mapas ya cargados (users/fichas) y devuelven
// estructuras limpias o { ok:false, msg }.

const {
  FECHA_RE,
  PLANILLA_LIMITS,
  trimStr,
  clampNumber,
} = require('./helpers');

const FIJO_CCSS_RATE = 0.1083;
const FIJO_JORNADA_HORAS_DEFAULT = 48;

// Sanitiza un día de la fila fija: acepta ISO completo o YYYY-MM-DD.
function sanitizeFijoDia(d) {
  const fechaRaw = typeof d?.fecha === 'string' ? d.fecha : '';
  const fechaStr = fechaRaw.slice(0, 10);
  if (!FECHA_RE.test(fechaStr)) return null;
  return {
    fecha: fechaRaw.length >= 10 ? fechaRaw.slice(0, 30) : fechaStr,
    ausente: d?.ausente === true,
    horasParciales: clampNumber(d?.horasParciales, 24),
    salarioExtra: clampNumber(d?.salarioExtra, PLANILLA_LIMITS.numeric),
  };
}

function sanitizeFijoDeduccion(d) {
  return {
    concepto: trimStr(d?.concepto, PLANILLA_LIMITS.conceptoDeduccion).trim(),
    monto: clampNumber(d?.monto, PLANILLA_LIMITS.numeric),
  };
}

// Sanitiza filas de planilla fija. Verifica trabajadorId contra users/fichas
// de la finca y canoniza nombre / cédula / puesto / salarioBase / fechaIngreso
// desde fuentes autoritativas. Descarta filas con trabajadorId inválido.
function sanitizeFijoFilas(filas, usersMap, fichasMap) {
  if (!Array.isArray(filas))
    return { ok: false, msg: 'filas must be an array.' };
  if (filas.length > PLANILLA_LIMITS.filasPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.filasPorPlanilla} employees per planilla.` };

  const cleaned = [];
  for (const f of filas) {
    const trabajadorId = trimStr(f?.trabajadorId, 64);
    if (!trabajadorId || !usersMap.has(trabajadorId)) continue; // descarta silenciosamente

    const userDoc  = usersMap.get(trabajadorId) || {};
    const ficha    = fichasMap.get(trabajadorId) || {};
    const nombre   = trimStr(userDoc.nombre, PLANILLA_LIMITS.string);
    const cedula   = trimStr(ficha.cedula || f?.cedula, 30);
    const puesto   = trimStr(ficha.puesto || f?.puesto, PLANILLA_LIMITS.string);
    const fechaIng = (typeof ficha.fechaIngreso === 'string' && FECHA_RE.test(ficha.fechaIngreso))
      ? ficha.fechaIngreso
      : ((typeof f?.fechaIngreso === 'string' && FECHA_RE.test(f.fechaIngreso)) ? f.fechaIngreso : '');

    // salarioMensual: autoritativo desde ficha si existe; fallback al valor recibido (clamp).
    const salarioMensual = ficha.salarioBase != null
      ? clampNumber(ficha.salarioBase, PLANILLA_LIMITS.numeric)
      : clampNumber(f?.salarioMensual, PLANILLA_LIMITS.numeric);

    // salarioDiario: editable por el usuario (override de salarioMensual/30). Clamp.
    const salarioDiario = clampNumber(f?.salarioDiario, PLANILLA_LIMITS.numeric);

    // horasSemanales: derivar desde ficha.horarioSemanal si existe, si no fallback.
    let horasSemanales = 0;
    const horario = ficha.horarioSemanal;
    if (horario && typeof horario === 'object') {
      const dias = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
      for (const k of dias) {
        const d = horario[k];
        if (!d?.activo || typeof d.inicio !== 'string' || typeof d.fin !== 'string') continue;
        const [h1, m1] = d.inicio.split(':').map(Number);
        const [h2, m2] = d.fin.split(':').map(Number);
        if ([h1, m1, h2, m2].some(n => !Number.isFinite(n))) continue;
        horasSemanales += Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
      }
    }
    if (!(horasSemanales > 0)) horasSemanales = FIJO_JORNADA_HORAS_DEFAULT;
    horasSemanales = clampNumber(horasSemanales, 168); // máx 7*24

    const dias = Array.isArray(f?.dias)
      ? f.dias.slice(0, PLANILLA_LIMITS.diasPorFila).map(sanitizeFijoDia).filter(Boolean)
      : [];
    const deduccionesExtra = Array.isArray(f?.deduccionesExtra)
      ? f.deduccionesExtra.slice(0, PLANILLA_LIMITS.deduccionesPorFila).map(sanitizeFijoDeduccion)
      : [];

    const efectivoDesdeRaw = typeof f?.efectivoDesde === 'string' ? f.efectivoDesde.slice(0, 10) : '';
    const efectivoDesde = FECHA_RE.test(efectivoDesdeRaw) ? efectivoDesdeRaw : '';

    // Totales: confiar en los componentes del cliente (clampeados) pero NO en
    // el bruto. salarioBruto se DERIVA server-side de ordinario+extraordinario
    // (paridad con la tabla de resumen del comprobante), no se acepta como
    // valor independiente: si no, un rol de escritura podía emitir un bruto que
    // no cuadra con su propio desglose y, como CCSS/neto cuelgan del bruto,
    // desincronizar toda la obligación de pago. Cualquier `f.salarioBruto`
    // entrante se ignora.
    const salarioOrdinario      = clampNumber(f?.salarioOrdinario, PLANILLA_LIMITS.numeric);
    const salarioExtraordinario = clampNumber(f?.salarioExtraordinario, PLANILLA_LIMITS.numeric);
    const salarioBruto          = clampNumber(salarioOrdinario + salarioExtraordinario, PLANILLA_LIMITS.numeric);
    // CCSS debe ser consistente con salarioBruto; recalcular server-side.
    const deduccionCCSS         = Math.round(salarioBruto * FIJO_CCSS_RATE);
    const otrasDeduccionesTotal = deduccionesExtra.reduce((s, d) => s + d.monto, 0);
    const totalDeducciones      = deduccionCCSS + otrasDeduccionesTotal;
    const totalNeto             = Math.max(0, salarioBruto - totalDeducciones);

    cleaned.push({
      trabajadorId,
      trabajadorNombre: nombre,
      cedula, puesto,
      fechaIngreso: fechaIng,
      periodoParcial: f?.periodoParcial === true,
      efectivoDesde,
      salarioMensual, salarioDiario,
      horasSemanales,
      dias, deduccionesExtra,
      salarioOrdinario, salarioExtraordinario, salarioBruto,
      deduccionCCSS,
      otrasDeduccionesTotal: Math.round(otrasDeduccionesTotal),
      totalDeducciones: Math.round(totalDeducciones),
      totalNeto: Math.round(totalNeto),
    });
  }
  return { ok: true, value: cleaned };
}

function sumTotalGeneral(filas) {
  const total = (filas || []).reduce((s, f) => s + (Number(f.totalNeto) || 0), 0);
  return clampNumber(total, PLANILLA_LIMITS.numeric);
}

// Valida rango de período (string ISO). Acepta YYYY-MM-DD o ISO datetime
// completo. Devuelve Date objects o ok:false con msg.
function parsePeriodoISO(periodoInicio, periodoFin) {
  if (typeof periodoInicio !== 'string' || typeof periodoFin !== 'string')
    return { ok: false, msg: 'Invalid periodo.' };
  const ini = new Date(periodoInicio);
  const fin = new Date(periodoFin);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime()))
    return { ok: false, msg: 'Invalid dates.' };
  if (fin < ini)
    return { ok: false, msg: 'End date must be equal or later than start date.' };
  const diffDays = Math.floor((fin - ini) / 86400000) + 1;
  if (diffDays > PLANILLA_LIMITS.periodoDiasMax)
    return { ok: false, msg: `periodo cannot exceed ${PLANILLA_LIMITS.periodoDiasMax} days.` };
  return { ok: true, ini, fin };
}

// Detección de solapamiento server-side. Dos planillas fijas activas no deberían
// cubrir períodos traslapados para el mismo trabajador (doble pago de los mismos
// días). El cliente ya avisa al previsualizar, pero esa guarda es solo UX: por
// API directa se podía crear una planilla duplicada. Esta función es pura (no
// toca db); el route le pasa las planillas existentes ya mapeadas y decide si
// bloquea (409) o permite con override explícito (confirmarSolapamiento).
//
//   trabajadorIds — ids de la planilla nueva/editada
//   ini, fin      — Date del período nuevo
//   existing      — [{ id, estado, periodoInicio:Date, periodoFin:Date, trabajadorIds[] }]
//   excludeId     — id de la planilla que se está editando (no choca consigo misma)
// Devuelve el array de trabajadorIds en conflicto (vacío si no hay).
function detectOverlaps({ trabajadorIds, ini, fin, existing, excludeId = null }) {
  const ACTIVE = new Set(['pendiente', 'aprobada', 'pagada']);
  const nuevos = new Set(trabajadorIds);
  const conflict = new Set();
  for (const p of (existing || [])) {
    if (p.id === excludeId) continue;
    if (!ACTIVE.has(p.estado)) continue;
    if (!(p.periodoInicio instanceof Date) || !(p.periodoFin instanceof Date)) continue;
    if (p.periodoInicio > fin || p.periodoFin < ini) continue; // sin traslape de período
    for (const tid of (p.trabajadorIds || [])) {
      if (nuevos.has(tid)) conflict.add(tid);
    }
  }
  return [...conflict];
}

module.exports = {
  FIJO_CCSS_RATE,
  FIJO_JORNADA_HORAS_DEFAULT,
  sanitizeFijoDia,
  sanitizeFijoDeduccion,
  sanitizeFijoFilas,
  sumTotalGeneral,
  parsePeriodoISO,
  detectOverlaps,
};
