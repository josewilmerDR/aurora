// Simulador Monte Carlo de escenarios anuales. Puro — sin Firestore ni red.
//
// Entrada (shape):
//   context = {
//     baselineMonthlyRevenue: number,   // ingreso medio mensual (Fase 4.1)
//     baselineMonthlyCost: number,      // costo medio mensual (Fase 1)
//     initialCash: number,              // saldo inicial (tesorería)
//     commitmentsByMonth: number[],     // compromisos (OCs + planilla) por mes [0..11]
//     priceVolatility: number,          // σ del multiplicador de precio
//     yieldVolatility: number,          // σ del multiplicador de rendimiento
//     costDriftMonthly: number,         // drift mensual de costo (0.005 = 0.5%)
//     horizonteMeses: number,           // típicamente 12
//     restrictions?: object,            // persistido, no influye el simulador
//   }
//   options = { nTrials: 500, seed: 1, quantiles: [0.25, 0.75] }
//
// Salida:
//   {
//     nTrials,
//     seed,
//     scenarios: [
//       { name: 'Pesimista'|'Base'|'Optimista', probabilidad,
//         ingresoProyectado, costoProyectado, margenProyectado,
//         proyeccionCaja: number[12],
//         percentiles: { ingreso: {p10,p50,p90}, margen: {p10,p50,p90}, cajaFinal: {p10,p50,p90} },
//         riesgos: [string], supuestos: [string],
//       }
//     ],
//     resumen: { ingresoMedio, costoMedio, margenMedio, cajaFinalMedia },
//     trialsAggregate: { cashByMonthMedian: number[] },  // para UI
//   }
//
// Límites duros:
//   nTrials ∈ [10, 5000]; semillas fuera de rango se normalizan; volatilidades
//   se clampean a [0, 1].

const { createPrng } = require('./prng');

const DEFAULTS = Object.freeze({
  nTrials: 500,
  seed: 1,
  priceVolatility: 0.15,
  yieldVolatility: 0.10,
  costDriftMonthly: 0.005,
  horizonteMeses: 12,
});

const SCENARIO_NAMES = ['Pesimista', 'Base', 'Optimista'];

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(2));
}

function percentile(sortedArr, q) {
  if (!Array.isArray(sortedArr) || sortedArr.length === 0) return 0;
  if (q <= 0) return sortedArr[0];
  if (q >= 1) return sortedArr[sortedArr.length - 1];
  const idx = (sortedArr.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  const frac = idx - lo;
  return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

function median(arr) { return percentile([...arr].sort((a, b) => a - b), 0.5); }

// Ejecuta un solo trial determinista dado el PRNG ya inicializado.
function runTrial(ctx, prng) {
  const {
    baselineMonthlyRevenue, baselineMonthlyCost, initialCash,
    commitmentsByMonth, priceVolatility, yieldVolatility,
    costDriftMonthly, horizonteMeses,
  } = ctx;

  const cashByMonth = new Array(horizonteMeses).fill(0);
  let cash = initialCash;
  let cumRevenue = 0;
  let cumCost = 0;

  for (let m = 0; m < horizonteMeses; m++) {
    // Precio y rendimiento: multiplicadores independientes por mes.
    const priceMult = 1 + prng.nextNormalScaled(0, priceVolatility);
    const yieldMult = 1 + prng.nextNormalScaled(0, yieldVolatility);
    // Truncamos a cero mínimo para evitar ingresos negativos absurdos.
    const safePrice = Math.max(0, priceMult);
    const safeYield = Math.max(0, yieldMult);

    const monthlyRevenue = baselineMonthlyRevenue * safePrice * safeYield;
    // Drift compuesto: cost_m = base * (1 + drift)^m.
    const monthlyCost = baselineMonthlyCost * Math.pow(1 + costDriftMonthly, m);
    const commitment = commitmentsByMonth[m] || 0;

    const net = monthlyRevenue - monthlyCost - commitment;
    cash += net;
    cashByMonth[m] = cash;
    cumRevenue += monthlyRevenue;
    cumCost += monthlyCost + commitment;
  }

  return {
    cumRevenue,
    cumCost,
    margen: cumRevenue - cumCost,
    finalCash: cash,
    cashByMonth,
  };
}

// Bucket trials by final margen into 3 escenarios (Pesimista / Base / Optimista).
// Por default: quartiles 0.25 y 0.75.
function bucketTrials(trials, quantiles = [0.25, 0.75]) {
  const sorted = [...trials].sort((a, b) => a.margen - b.margen);
  const nLow = Math.round(trials.length * quantiles[0]);
  const nMid = Math.round(trials.length * quantiles[1]) - nLow;
  const nHigh = trials.length - nLow - nMid;

  const pesimista = sorted.slice(0, nLow);
  const base = sorted.slice(nLow, nLow + nMid);
  const optimista = sorted.slice(nLow + nMid);
  return { pesimista, base, optimista };
}

// Dado un bucket de trials, produce el resumen del escenario.
function summarizeBucket(name, bucket, nTotal, ctx) {
  if (bucket.length === 0) {
    return {
      name,
      probabilidad: 0,
      ingresoProyectado: 0,
      costoProyectado: 0,
      margenProyectado: 0,
      proyeccionCaja: new Array(ctx.horizonteMeses).fill(0),
      percentiles: {
        ingreso: { p10: 0, p50: 0, p90: 0 },
        margen: { p10: 0, p50: 0, p90: 0 },
        cajaFinal: { p10: 0, p50: 0, p90: 0 },
      },
      riesgos: [],
      supuestos: [],
    };
  }

  const ingresos = bucket.map(t => t.cumRevenue).sort((a, b) => a - b);
  const margenes = bucket.map(t => t.margen).sort((a, b) => a - b);
  const cajasFinales = bucket.map(t => t.finalCash).sort((a, b) => a - b);

  // Proyección mensual: mediana del cash en cada mes.
  const proyeccionCaja = new Array(ctx.horizonteMeses).fill(0).map((_, m) => {
    const cashAtMonth = bucket.map(t => t.cashByMonth[m]).sort((a, b) => a - b);
    return round2(percentile(cashAtMonth, 0.5));
  });

  const pct = (sorted) => ({
    p10: round2(percentile(sorted, 0.1)),
    p50: round2(percentile(sorted, 0.5)),
    p90: round2(percentile(sorted, 0.9)),
  });

  // Riesgos/supuestos explícitos, descriptivos.
  const riesgos = buildRiesgos(name, bucket, ctx);
  const supuestos = buildSupuestos(ctx);

  return {
    name,
    probabilidad: round2(bucket.length / nTotal),
    ingresoProyectado: round2(percentile(ingresos, 0.5)),
    costoProyectado: round2(percentile(bucket.map(t => t.cumCost).sort((a, b) => a - b), 0.5)),
    margenProyectado: round2(percentile(margenes, 0.5)),
    proyeccionCaja,
    percentiles: {
      ingreso: pct(ingresos),
      margen: pct(margenes),
      cajaFinal: pct(cajasFinales),
    },
    riesgos,
    supuestos,
  };
}

function buildRiesgos(name, bucket, ctx) {
  const out = [];
  // Si el escenario acaba con caja negativa en la mediana, es un riesgo mayor.
  const finalCajas = bucket.map(t => t.finalCash).sort((a, b) => a - b);
  const medianFinal = percentile(finalCajas, 0.5);
  if (medianFinal < 0) {
    out.push(`Caja final mediana negativa: ${round2(medianFinal)}.`);
  }
  const minFinal = finalCajas[0];
  if (minFinal < 0) {
    out.push(`Peor caso de caja final: ${round2(minFinal)}.`);
  }
  // Riesgos contextuales según escenario.
  if (name === 'Pesimista') {
    out.push(`Combinación adversa de precio (σ=${ctx.priceVolatility}) y rendimiento (σ=${ctx.yieldVolatility}).`);
  }
  if (name === 'Optimista') {
    out.push('Depende de que precio y rendimiento se mantengan por encima de la media; poco margen para shocks.');
  }
  return out;
}

function buildSupuestos(ctx) {
  return [
    `Ingreso base mensual: ${round2(ctx.baselineMonthlyRevenue)}.`,
    `Costo base mensual: ${round2(ctx.baselineMonthlyCost)}.`,
    `Volatilidad de precio σ=${ctx.priceVolatility}, rendimiento σ=${ctx.yieldVolatility}.`,
    `Drift mensual de costo: ${(ctx.costDriftMonthly * 100).toFixed(2)}%.`,
    `Saldo inicial de caja: ${round2(ctx.initialCash)}.`,
  ];
}

// ─── Entry point ────────────────────────────────────────────────────────────

function simulateScenarios(context, options = {}) {
  const ctx = {
    baselineMonthlyRevenue: Number(context.baselineMonthlyRevenue) || 0,
    baselineMonthlyCost: Number(context.baselineMonthlyCost) || 0,
    initialCash: Number(context.initialCash) || 0,
    commitmentsByMonth: Array.isArray(context.commitmentsByMonth)
      ? context.commitmentsByMonth.map(v => Number(v) || 0)
      : [],
    priceVolatility: clamp(Number(context.priceVolatility ?? DEFAULTS.priceVolatility), 0, 1),
    yieldVolatility: clamp(Number(context.yieldVolatility ?? DEFAULTS.yieldVolatility), 0, 1),
    costDriftMonthly: clamp(Number(context.costDriftMonthly ?? DEFAULTS.costDriftMonthly), -0.1, 0.1),
    horizonteMeses: clamp(Math.round(Number(context.horizonteMeses ?? DEFAULTS.horizonteMeses)), 1, 24),
  };
  // Normalizamos commitmentsByMonth al horizonte.
  while (ctx.commitmentsByMonth.length < ctx.horizonteMeses) ctx.commitmentsByMonth.push(0);
  ctx.commitmentsByMonth.length = ctx.horizonteMeses;

  const nTrials = clamp(Math.round(Number(options.nTrials ?? DEFAULTS.nTrials)), 10, 5000);
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) : DEFAULTS.seed;

  const prng = createPrng(seed);
  const trials = [];
  for (let i = 0; i < nTrials; i++) trials.push(runTrial(ctx, prng));

  const { pesimista, base, optimista } = bucketTrials(trials);
  const scenarios = [
    summarizeBucket(SCENARIO_NAMES[0], pesimista, nTrials, ctx),
    summarizeBucket(SCENARIO_NAMES[1], base, nTrials, ctx),
    summarizeBucket(SCENARIO_NAMES[2], optimista, nTrials, ctx),
  ];

  // Resumen global + serie mediana agregada (para gráfico comparativo).
  const cashByMonthMedian = new Array(ctx.horizonteMeses).fill(0).map((_, m) => {
    const arr = trials.map(t => t.cashByMonth[m]).sort((a, b) => a - b);
    return round2(percentile(arr, 0.5));
  });
  const resumen = {
    ingresoMedio: round2(median(trials.map(t => t.cumRevenue))),
    costoMedio: round2(median(trials.map(t => t.cumCost))),
    margenMedio: round2(median(trials.map(t => t.margen))),
    cajaFinalMedia: round2(median(trials.map(t => t.finalCash))),
  };

  return {
    nTrials, seed,
    context: ctx,
    scenarios,
    resumen,
    trialsAggregate: { cashByMonthMedian },
  };
}

module.exports = {
  simulateScenarios,
  // Exports puros para tests.
  _runTrial: runTrial,
  _bucketTrials: bucketTrials,
  _summarizeBucket: summarizeBucket,
  _percentile: percentile,
  SCENARIO_NAMES,
  DEFAULTS,
};
