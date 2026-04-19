// OpenWeatherMap provider — weather signals.
//
// Free tier: 1,000 calls/day, sin costo. Acceso vía API key HTTP.
//
// Endpoint: GET https://api.openweathermap.org/data/2.5/weather?lat={}&lon={}&units=metric&appid={}
//
// Devuelve temperatura actual + volumen de lluvia. El provider normaliza a:
//   { value, unit, confidence, observedAt, raw, metadata: {
//       rainfallMm24h, tempMinC, tempMaxC, humidity, city, country
//   }}
//
// `value` representa la temperatura promedio del día (°C) por ser la métrica
// más general; las demás quedan en metadata para que el detector de alertas
// las use. `confidence` es 0.85 (free tier, actualizado cada ~10 min).

const ID = 'openweathermap';
const BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
const HTTP_TIMEOUT_MS = 10_000;

function validateConfig(config) {
  if (!config || typeof config !== 'object') return 'config is required';
  const lat = Number(config.lat);
  const lon = Number(config.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'lat must be a number in [-90, 90]';
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'lon must be a number in [-180, 180]';
  if (config.city !== undefined && (typeof config.city !== 'string' || config.city.length > 128)) {
    return 'city must be a string up to 128 chars';
  }
  return null;
}

// Abortable fetch con timeout. Usa el `fetch` global (Node 18+).
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSignal({ config, apiKey, now = new Date() } = {}) {
  if (!apiKey) {
    const err = new Error('OpenWeatherMap API key is not configured.');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  const configError = validateConfig(config);
  if (configError) {
    const err = new Error(configError);
    err.code = 'INVALID_CONFIG';
    throw err;
  }
  const url = `${BASE_URL}?lat=${encodeURIComponent(config.lat)}&lon=${encodeURIComponent(config.lon)}&units=metric&appid=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(url, HTTP_TIMEOUT_MS);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenWeatherMap returned ${res.status}: ${body.slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    err.status = res.status;
    throw err;
  }
  const raw = await res.json();
  return normalizeOwmResponse(raw, config, now);
}

// Pure — extraído para test aislado.
function normalizeOwmResponse(raw, config, now) {
  const main = raw?.main || {};
  const rain = raw?.rain || {};
  const tempAvg = Number(main.temp);
  const tempMinC = Number(main.temp_min);
  const tempMaxC = Number(main.temp_max);
  const humidity = Number(main.humidity);
  // OWM devuelve lluvia acumulada de 1h o 3h; preferimos 1h si existe.
  const rainfallMm = Number(rain['1h'] ?? rain['3h'] ?? 0);

  const observedAt = toIsoDate(now);
  return {
    value: Number.isFinite(tempAvg) ? parseFloat(tempAvg.toFixed(2)) : null,
    unit: '°C',
    confidence: 0.85,
    observedAt,
    raw,
    metadata: {
      rainfallMm24h: Number.isFinite(rainfallMm) ? parseFloat(rainfallMm.toFixed(2)) : 0,
      tempMinC: Number.isFinite(tempMinC) ? parseFloat(tempMinC.toFixed(2)) : null,
      tempMaxC: Number.isFinite(tempMaxC) ? parseFloat(tempMaxC.toFixed(2)) : null,
      humidity: Number.isFinite(humidity) ? humidity : null,
      city: typeof config.city === 'string' ? config.city : (raw.name || null),
      lat: config.lat,
      lon: config.lon,
    },
  };
}

function toIsoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

module.exports = {
  id: ID,
  signalTypes: ['weather'],
  validateConfig,
  fetchSignal,
  // Puro, para tests.
  normalizeOwmResponse,
};
