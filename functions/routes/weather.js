const { Router } = require('express');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// Proxy a Open-Meteo para seed de temperatura/humedad en el modal de aplicación.
// El browser no puede llamar directo: Open-Meteo intermitentemente responde sin
// headers CORS (rate-limit / política regional) y la fetch se cae con 409+CORS,
// dejando el modal en "obteniendo…". Server-to-server elimina la barrera.
router.get('/api/weather/current', authenticate, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'lat/lon out of range or missing.', 400);
  }

  // NOTE: do not append &timezone=auto — combinado con current=temperature_2m,
  // relative_humidity_2m, el backend de Open-Meteo responde 502 desde algunas
  // regiones (visto en Costa Rica, 2026-05). Solo usamos los valores numéricos,
  // el timestamp con TZ local no nos hace falta.
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const upstream = await fetch(url, { signal: ctrl.signal });
    if (!upstream.ok) {
      return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR,
        `Open-Meteo responded ${upstream.status}.`, 502);
    }
    const data = await upstream.json();
    const t = data?.current?.temperature_2m;
    const h = data?.current?.relative_humidity_2m;
    return res.status(200).json({
      temperature: Number.isFinite(t) ? t : null,
      humidity:    Number.isFinite(h) ? h : null,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Open-Meteo timeout.', 504);
    }
    console.error('[weather] proxy error:', err);
    return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Failed to reach Open-Meteo.', 502);
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
