// Proyección de caja semanal — pura, sin Firestore.
// Dado un saldo inicial + una lista de eventos (inflow/outflow con fecha),
// produce una serie semanal con balance corriente + resumen.

const { buildWeekRanges, isInWeek } = require('./weekRanges');

// Estructura esperada de cada evento:
//   { date: 'YYYY-MM-DD', amount: number (> 0), type: 'inflow'|'outflow',
//     source: string (ej: 'ordenes_compra'), label: string (ej: 'OC-00042') }
//
// El signo lo determina `type`: inflow = +amount, outflow = -amount.

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function eventNet(ev) {
  const amt = Number(ev.amount) || 0;
  return ev.type === 'outflow' ? -amt : amt;
}

function buildWeeklyProjection({ startingBalance, startingDate, events, weeks }) {
  const ranges = buildWeekRanges(startingDate, weeks);
  if (ranges.length === 0) {
    return { startingBalance: round2(startingBalance || 0), startingDate, series: [], summary: emptySummary(startingBalance) };
  }

  const cleanEvents = Array.isArray(events) ? events : [];
  let running = Number(startingBalance) || 0;
  const series = [];
  let totalInflows = 0;
  let totalOutflows = 0;
  let minBalance = running;
  let minBalanceDate = startingDate;
  let negativeWeeks = 0;

  for (const range of ranges) {
    const weekEvents = cleanEvents.filter(ev => isInWeek(ev.date, range));
    // Orden determinista dentro de la semana para salida estable.
    weekEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const inflows = weekEvents
      .filter(ev => ev.type === 'inflow')
      .map(ev => ({ ...ev, amount: round2(ev.amount) }));
    const outflows = weekEvents
      .filter(ev => ev.type === 'outflow')
      .map(ev => ({ ...ev, amount: round2(ev.amount) }));

    const weekInflowSum = inflows.reduce((s, ev) => s + ev.amount, 0);
    const weekOutflowSum = outflows.reduce((s, ev) => s + ev.amount, 0);
    const netFlow = weekInflowSum - weekOutflowSum;

    const opening = running;
    running = running + netFlow;
    // `minBalance` lo evaluamos después de aplicar los flujos de la semana,
    // porque la proyección trabaja a granularidad semanal.
    if (running < minBalance) {
      minBalance = running;
      minBalanceDate = range.weekEnd;
    }
    if (running < 0) negativeWeeks += 1;

    totalInflows += weekInflowSum;
    totalOutflows += weekOutflowSum;

    series.push({
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      openingBalance: round2(opening),
      inflows,
      outflows,
      netFlow: round2(netFlow),
      closingBalance: round2(running),
    });
  }

  return {
    startingBalance: round2(startingBalance || 0),
    startingDate,
    series,
    summary: {
      totalInflows: round2(totalInflows),
      totalOutflows: round2(totalOutflows),
      endingBalance: round2(running),
      minBalance: round2(minBalance),
      minBalanceDate,
      negativeWeeks,
    },
  };
}

function emptySummary(startingBalance) {
  const s = round2(startingBalance || 0);
  return {
    totalInflows: 0,
    totalOutflows: 0,
    endingBalance: s,
    minBalance: s,
    minBalanceDate: null,
    negativeWeeks: 0,
  };
}

module.exports = {
  buildWeeklyProjection,
  eventNet, // exportado para tests
};
