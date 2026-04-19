// Detector puro de alertas sobre señales externas.
//
// Dado una señal recién ingresada + las señales previas de la misma fuente
// + los umbrales configurados, devuelve la lista de alertas disparadas.
// No toca Firestore; la persistencia (feed_event, push) la hace el ingestor.
//
// Alertas por tipo:
//   - weather:
//       FLOOD_RISK:       rainfallMm24h  >= umbralRainfall
//       COLD_RISK:        tempMinC       <= umbralTempMin
//       HEAT_RISK:        tempMaxC       >= umbralTempMax
//   - commodity_price / fertilizer_price:
//       PRICE_DROP:       (previo - actual) / previo >= dropPct/100
//       PRICE_RISE:       (actual - previo) / previo >= risePct/100
//
// Cada alerta:
//   { code, severity: 'info'|'warn'|'critical',
//     signalType, sourceId, observedAt,
//     value, threshold, deltaPct?, message }

const ALERT_CODES = Object.freeze({
  FLOOD_RISK: 'FLOOD_RISK',
  COLD_RISK: 'COLD_RISK',
  HEAT_RISK: 'HEAT_RISK',
  PRICE_DROP: 'PRICE_DROP',
  PRICE_RISE: 'PRICE_RISE',
});

function round2(n) {
  if (!Number.isFinite(n)) return n;
  return parseFloat(n.toFixed(2));
}

// Weather: la señal ya viene con `metadata.rainfallMm24h`, `metadata.tempMinC`,
// `metadata.tempMaxC`. Este detector no conoce ningún provider específico —
// sólo lee los campos que ya haya poblado el provider.
function detectWeatherAlerts(signal, thresholds = {}) {
  const out = [];
  const md = signal.metadata || {};

  const rainfall = Number(md.rainfallMm24h);
  if (Number.isFinite(rainfall) && Number.isFinite(thresholds.rainfallMm24h)) {
    if (rainfall >= thresholds.rainfallMm24h) {
      out.push({
        code: ALERT_CODES.FLOOD_RISK,
        severity: rainfall >= thresholds.rainfallMm24h * 1.5 ? 'critical' : 'warn',
        signalType: 'weather',
        sourceId: signal.sourceId,
        observedAt: signal.observedAt,
        value: round2(rainfall),
        threshold: thresholds.rainfallMm24h,
        message: `Lluvia ${round2(rainfall)} mm/24h supera el umbral de ${thresholds.rainfallMm24h} mm.`,
      });
    }
  }

  const tempMin = Number(md.tempMinC);
  if (Number.isFinite(tempMin) && Number.isFinite(thresholds.tempMinC)) {
    if (tempMin <= thresholds.tempMinC) {
      out.push({
        code: ALERT_CODES.COLD_RISK,
        severity: 'warn',
        signalType: 'weather',
        sourceId: signal.sourceId,
        observedAt: signal.observedAt,
        value: round2(tempMin),
        threshold: thresholds.tempMinC,
        message: `Temperatura mínima ${round2(tempMin)}°C por debajo del umbral ${thresholds.tempMinC}°C.`,
      });
    }
  }

  const tempMax = Number(md.tempMaxC);
  if (Number.isFinite(tempMax) && Number.isFinite(thresholds.tempMaxC)) {
    if (tempMax >= thresholds.tempMaxC) {
      out.push({
        code: ALERT_CODES.HEAT_RISK,
        severity: 'warn',
        signalType: 'weather',
        sourceId: signal.sourceId,
        observedAt: signal.observedAt,
        value: round2(tempMax),
        threshold: thresholds.tempMaxC,
        message: `Temperatura máxima ${round2(tempMax)}°C por encima del umbral ${thresholds.tempMaxC}°C.`,
      });
    }
  }

  return out;
}

function detectPriceAlerts(signal, previousSignals, thresholds = {}) {
  const out = [];
  if (!Array.isArray(previousSignals) || previousSignals.length === 0) return out;

  // Comparamos contra la observación inmediatamente previa del mismo sourceId.
  const ordered = previousSignals
    .filter(p => p.sourceId === signal.sourceId)
    .sort((a, b) => (b.observedAt || '').localeCompare(a.observedAt || ''));
  const prev = ordered.find(p => p.observedAt < signal.observedAt);
  if (!prev) return out;
  const prevValue = Number(prev.value);
  const currValue = Number(signal.value);
  if (!Number.isFinite(prevValue) || prevValue <= 0 || !Number.isFinite(currValue)) return out;

  const deltaPct = round2(((currValue - prevValue) / prevValue) * 100);

  if (Number.isFinite(thresholds.dropPct) && deltaPct <= -Math.abs(thresholds.dropPct)) {
    out.push({
      code: ALERT_CODES.PRICE_DROP,
      severity: deltaPct <= -Math.abs(thresholds.dropPct) * 2 ? 'critical' : 'warn',
      signalType: signal.signalType,
      sourceId: signal.sourceId,
      observedAt: signal.observedAt,
      value: currValue,
      threshold: thresholds.dropPct,
      deltaPct,
      message: `Precio bajó ${Math.abs(deltaPct)}% (umbral ${thresholds.dropPct}%).`,
    });
  }

  if (Number.isFinite(thresholds.risePct) && deltaPct >= Math.abs(thresholds.risePct)) {
    out.push({
      code: ALERT_CODES.PRICE_RISE,
      severity: deltaPct >= Math.abs(thresholds.risePct) * 2 ? 'critical' : 'warn',
      signalType: signal.signalType,
      sourceId: signal.sourceId,
      observedAt: signal.observedAt,
      value: currValue,
      threshold: thresholds.risePct,
      deltaPct,
      message: `Precio subió ${deltaPct}% (umbral ${thresholds.risePct}%).`,
    });
  }

  return out;
}

// Punto de entrada: decide qué detector aplicar según signal.signalType.
function detectAlerts({ signal, previousSignals = [], thresholds = {} }) {
  if (!signal || !signal.signalType) return [];
  if (signal.signalType === 'weather') {
    return detectWeatherAlerts(signal, thresholds);
  }
  if (signal.signalType === 'commodity_price' || signal.signalType === 'fertilizer_price') {
    return detectPriceAlerts(signal, previousSignals, thresholds);
  }
  return [];
}

module.exports = {
  detectAlerts,
  detectWeatherAlerts,
  detectPriceAlerts,
  ALERT_CODES,
};
