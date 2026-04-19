// Carga el contexto del simulador desde Firestore. Cada fuente es
// best-effort: si falla, devolvemos 0 y anotamos un warning.
//
// El contexto producido es el input directo para `simulateScenarios`.
//
// Fuentes:
//   - baselineMonthlyRevenue ← Fase 4.1 (yieldAggregator) promedio de los
//     últimos 12 meses.
//   - baselineMonthlyCost   ← mismo agregador, lado de costo.
//   - initialCash           ← cash_balance_snapshots (más reciente) o fallback 0.
//   - commitmentsByMonth    ← OCs activas + planilla fija distribuidos por mes.
//   - priceVolatility/yieldVolatility ← heurística:
//       si Fase 4.3 reportó alertas recientes de precio, bumpeamos
//       priceVolatility; si no hay señales, usamos default.
//
// Cada warning se incluye en el resultado para trazabilidad (supuestos
// explícitos incluyen las fuentes ausentes/vacías).

const { db, Timestamp } = require('../firebase');
const { computeYieldAggregate } = require('./yieldAggregator');

const DEFAULT_PRICE_VOL = 0.15;
const DEFAULT_YIELD_VOL = 0.10;
const DEFAULT_COST_DRIFT = 0.005;

function todayIso(now = new Date()) { return new Date(now).toISOString().slice(0, 10); }
function oneYearAgoIso(now = new Date()) {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// Promedio mensual de ingreso y costo del último año (Fase 4.1 por lote).
async function loadYieldBaselines(fincaId, now = new Date()) {
  const desde = oneYearAgoIso(now);
  const hasta = todayIso(now);
  try {
    const out = await computeYieldAggregate(fincaId, { desde, hasta, groupBy: 'lote' });
    const resumen = out?.resumen || {};
    const months = 12;
    return {
      baselineMonthlyRevenue: (Number(resumen.ingreso) || 0) / months,
      baselineMonthlyCost: (Number(resumen.costo) || 0) / months,
      yieldRange: { desde, hasta },
      yieldResumen: resumen,
      warning: (Number(resumen.ingreso) || 0) === 0 ? 'yield_no_income' : null,
    };
  } catch (err) {
    return {
      baselineMonthlyRevenue: 0,
      baselineMonthlyCost: 0,
      yieldRange: { desde, hasta },
      yieldResumen: null,
      warning: `yield_failed:${err.message || 'unknown'}`,
    };
  }
}

// Último snapshot de caja. Si la colección no existe o está vacía, devolvemos 0.
async function loadInitialCash(fincaId) {
  try {
    const snap = await db.collection('cash_balance_snapshots')
      .where('fincaId', '==', fincaId)
      .get();
    if (snap.empty) return { initialCash: 0, warning: 'cash_no_snapshots' };
    const docs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return tb - ta;
      });
    const latest = docs[0];
    return {
      initialCash: Number(latest.balance) || Number(latest.saldo) || 0,
      warning: null,
    };
  } catch (err) {
    return { initialCash: 0, warning: `cash_failed:${err.message || 'unknown'}` };
  }
}

// Compromisos pendientes: OCs activas con fechaEntrega en el horizonte + planilla
// fija recurrente. Distribuimos a un array mensual [0..11] relativo a `now`.
async function loadCommitmentsByMonth(fincaId, horizonteMeses, now = new Date()) {
  const result = new Array(horizonteMeses).fill(0);
  try {
    const [ocSnap, planillaSnap] = await Promise.all([
      db.collection('ordenes_compra').where('fincaId', '==', fincaId).where('estado', '==', 'activa').get(),
      db.collection('hr_planilla_fijo').where('fincaId', '==', fincaId).get(),
    ]);

    // OCs: `fechaEntrega` → mes delta; total = sum(items * precio * (1+iva)).
    for (const doc of ocSnap.docs) {
      const data = doc.data();
      const fechaEntrega = data.fechaEntrega?.toDate?.();
      if (!fechaEntrega) continue;
      const deltaMonths = monthsBetween(now, fechaEntrega);
      if (deltaMonths < 0 || deltaMonths >= horizonteMeses) continue;
      const total = (data.items || []).reduce((s, it) => {
        const line = (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0);
        const withIva = line * (1 + (Number(it.iva) || 0) / 100);
        return s + withIva;
      }, 0);
      result[deltaMonths] += total;
    }

    // Planilla fija: asumimos recurrencia mensual. Tomamos el total más reciente.
    if (!planillaSnap.empty) {
      const totals = planillaSnap.docs
        .map(d => Number(d.data().totalGeneral) || 0)
        .filter(n => n > 0);
      if (totals.length > 0) {
        // Si hay al menos una entrada, asumimos que es la planilla mensual
        // recurrente. Tomamos la mediana para robustez.
        totals.sort((a, b) => a - b);
        const recurring = totals[Math.floor(totals.length / 2)];
        for (let m = 0; m < horizonteMeses; m++) result[m] += recurring;
      }
    }

    return { commitmentsByMonth: result, warning: null };
  } catch (err) {
    return { commitmentsByMonth: result, warning: `commitments_failed:${err.message || 'unknown'}` };
  }
}

// Diferencia en meses (aproximada, mes calendario) entre dos fechas.
function monthsBetween(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + (to.getUTCMonth() - from.getUTCMonth());
}

// Heurística de volatilidad a partir de alertas de señales externas recientes.
// Si hubo alertas de PRICE_DROP/PRICE_RISE en los últimos 30 días, subimos
// priceVolatility de 0.15 a 0.25. No tocamos yieldVolatility (la cosecha
// histórica ya la refleja implícitamente).
async function deriveVolatilitiesFromSignals(fincaId) {
  const out = {
    priceVolatility: DEFAULT_PRICE_VOL,
    yieldVolatility: DEFAULT_YIELD_VOL,
    costDriftMonthly: DEFAULT_COST_DRIFT,
    warnings: [],
  };
  try {
    const since = Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const snap = await db.collection('feed')
      .where('fincaId', '==', fincaId)
      .where('timestamp', '>=', since)
      .get();
    const alerts = snap.docs
      .map(d => d.data().eventType || '')
      .filter(e => e.startsWith('signal_alert_'));
    const priceAlerts = alerts.filter(e => e === 'signal_alert_PRICE_DROP' || e === 'signal_alert_PRICE_RISE');
    if (priceAlerts.length > 0) {
      out.priceVolatility = 0.25;
      out.warnings.push(`priceVolatility bumped to 0.25 due to ${priceAlerts.length} price alert(s) in last 30 days.`);
    }
    const weatherAlerts = alerts.filter(e => e.startsWith('signal_alert_') && !priceAlerts.includes(e));
    if (weatherAlerts.length > 0) {
      out.yieldVolatility = Math.min(0.2, out.yieldVolatility * 1.5);
      out.warnings.push(`yieldVolatility bumped due to ${weatherAlerts.length} weather alert(s).`);
    }
  } catch (err) {
    out.warnings.push(`signals_failed:${err.message || 'unknown'}`);
  }
  return out;
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function loadScenarioContext(fincaId, { horizonteMeses = 12, restrictions = {}, now = new Date() } = {}) {
  const warnings = [];

  const yieldBase = await loadYieldBaselines(fincaId, now);
  if (yieldBase.warning) warnings.push(yieldBase.warning);

  const cash = await loadInitialCash(fincaId);
  if (cash.warning) warnings.push(cash.warning);

  const commitments = await loadCommitmentsByMonth(fincaId, horizonteMeses, now);
  if (commitments.warning) warnings.push(commitments.warning);

  const vols = await deriveVolatilitiesFromSignals(fincaId);
  warnings.push(...vols.warnings);

  return {
    horizonteMeses,
    restrictions,
    baselineMonthlyRevenue: yieldBase.baselineMonthlyRevenue,
    baselineMonthlyCost: yieldBase.baselineMonthlyCost,
    initialCash: cash.initialCash,
    commitmentsByMonth: commitments.commitmentsByMonth,
    priceVolatility: vols.priceVolatility,
    yieldVolatility: vols.yieldVolatility,
    costDriftMonthly: vols.costDriftMonthly,
    inputsSnapshot: {
      yieldRange: yieldBase.yieldRange,
      yieldResumen: yieldBase.yieldResumen,
    },
    warnings,
  };
}

module.exports = {
  loadScenarioContext,
  // Helpers puros para tests.
  _monthsBetween: monthsBetween,
};
