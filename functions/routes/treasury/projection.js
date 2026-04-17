// Endpoint de proyección de caja. Junta saldo inicial + eventos de fuentes
// Firestore y delega a `lib/finance/projection.js` la construcción de la serie.

const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { addDays, toISO, parseISO } = require('../../lib/finance/weekRanges');
const { buildWeeklyProjection } = require('../../lib/finance/projection');
const {
  fetchLatestCashBalance,
  collectProjectionEvents,
} = require('../../lib/finance/treasurySources');

async function getProjection(req, res) {
  try {
    const weeksParam = Number(req.query.weeks);
    const weeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 104
      ? Math.floor(weeksParam)
      : 26; // default: 6 meses

    const latest = await fetchLatestCashBalance(req.fincaId);

    // Fecha de arranque: hoy (UTC) si no hay saldo previo, o la fecha del
    // saldo más reciente (no se proyecta "hacia atrás" si el saldo es viejo;
    // usamos el mayor entre dateAsOf y hoy).
    const todayISO = new Date().toISOString().slice(0, 10);
    const startingDate = latest && latest.dateAsOf > todayISO
      ? latest.dateAsOf
      : (latest ? latest.dateAsOf : todayISO);

    const startDt = parseISO(startingDate);
    const endDt = startDt ? addDays(startDt, weeks * 7) : null;
    const toStr = endDt ? toISO(endDt) : todayISO;

    const events = startDt
      ? await collectProjectionEvents(req.fincaId, { fromISO: startingDate, toISO: toStr })
      : [];

    const projection = buildWeeklyProjection({
      startingBalance: latest ? latest.amount : 0,
      startingDate,
      events,
      weeks,
    });

    res.json({
      startingBalanceSource: latest
        ? { id: latest.id, dateAsOf: latest.dateAsOf, amount: latest.amount, currency: latest.currency, source: latest.source }
        : null,
      weeks,
      horizonEnd: toStr,
      ...projection,
    });
  } catch (error) {
    console.error('[TREASURY] projection failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute treasury projection.', 500);
  }
}

module.exports = { getProjection };
