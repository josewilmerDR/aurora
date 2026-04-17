// Chequeo puro de "piso de caja". Dada una proyección semanal ya construida
// y un monto propuesto (salida adicional), determina si el saldo proyectado
// caería por debajo del piso configurado dentro del horizonte evaluado.

const { buildWeeklyProjection } = require('./projection');

// Evalúa si agregar una salida extra mantiene la proyección por encima del
// piso. No muta la proyección original — reconstruye una nueva simulando el
// evento adicional.
//
// Params:
//   startingBalance: saldo inicial del período
//   startingDate: fecha ISO del saldo inicial
//   baseEvents: eventos ya conocidos (income + OCs + planilla)
//   proposedOutflow: { date, amount, label? } — egreso a simular
//   floor: saldo mínimo aceptable en cualquier semana (puede ser negativo)
//   horizonWeeks: semanas a proyectar (ej: 4 para 30 días adelante)
function checkCashFloor({
  startingBalance,
  startingDate,
  baseEvents = [],
  proposedOutflow,
  floor,
  horizonWeeks = 4,
  currency = 'USD',
}) {
  if (!Number.isFinite(Number(floor))) {
    // Piso no configurado → permisivo.
    return { ok: true };
  }
  if (!proposedOutflow || !Number.isFinite(Number(proposedOutflow.amount)) || Number(proposedOutflow.amount) <= 0) {
    // Acción sin salida monetaria → nada que evaluar.
    return { ok: true };
  }

  // Construimos una proyección que incluye la salida propuesta.
  const simulated = buildWeeklyProjection({
    startingBalance,
    startingDate,
    events: [
      ...baseEvents,
      {
        date: proposedOutflow.date,
        amount: Number(proposedOutflow.amount),
        type: 'outflow',
        source: 'proposed',
        label: proposedOutflow.label || 'Acción propuesta',
      },
    ],
    weeks: horizonWeeks,
  });

  const floorNum = Number(floor);
  if (simulated.summary.minBalance < floorNum) {
    const fmt = (n) => `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return {
      ok: false,
      reason: `La acción llevaría la caja proyectada a ${fmt(simulated.summary.minBalance)} hacia ${simulated.summary.minBalanceDate || 'el horizonte'}, por debajo del piso de ${fmt(floorNum)}.`,
      minBalance: simulated.summary.minBalance,
      minBalanceDate: simulated.summary.minBalanceDate,
    };
  }

  return { ok: true, minBalance: simulated.summary.minBalance };
}

module.exports = { checkCashFloor };
