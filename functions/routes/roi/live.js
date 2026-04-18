// Endpoint de ROI en vivo. Une costos + ingresos y emite filas con margen.

const { db } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { computeLoteCostTotals } = require('../../lib/finance/loteCostTotals');
const {
  attributeIncome,
  prorateByKg,
  mergeLoteAmounts,
  buildDespachoToLoteMap,
} = require('../../lib/finance/roiAttribution');
const { buildRoiReport } = require('../../lib/finance/roiRows');

// ─── Fetches ───────────────────────────────────────────────────────────────

// Income records en el rango. `collectionStatus='anulado'` se filtra luego
// en el atribuidor, pero aquí ya acotamos por fecha.
async function fetchIncomeInRange(fincaId, { desde, hasta }) {
  const snap = await db.collection('income_records')
    .where('fincaId', '==', fincaId)
    .where('date', '>=', desde)
    .where('date', '<=', hasta)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Todos los despachos de la finca — necesitamos lookup por id desde cualquier
// despacho referenciado por un income, incluso si su `fecha` está fuera del
// rango del query (el income puede ser del rango y apuntar a un despacho
// anterior). Un query acotado por fecha perdería esos casos.
async function fetchAllDispatches(fincaId) {
  const snap = await db.collection('cosecha_despachos')
    .where('fincaId', '==', fincaId)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Handler ───────────────────────────────────────────────────────────────

async function getLive(req, res) {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return sendApiError(
        res,
        ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Query params "desde" and "hasta" are required (YYYY-MM-DD).',
        400
      );
    }

    const fincaId = req.fincaId;

    // Corremos las tres fuentes en paralelo.
    const [costTotals, incomeRecords, despachoDocs] = await Promise.all([
      computeLoteCostTotals(fincaId, { desde, hasta }),
      fetchIncomeInRange(fincaId, { desde, hasta }),
      fetchAllDispatches(fincaId),
    ]);

    const despachoToLote = buildDespachoToLoteMap(despachoDocs);
    const { perLote: directPerLote, unattributedAmount } = attributeIncome(
      incomeRecords,
      despachoToLote
    );

    // Los kg por lote vienen del agregado de costos.
    const kgByLote = {};
    for (const l of costTotals.porLote) kgByLote[l.loteId] = l.kg;

    // Prorrateo del residual no atribuido entre lotes con cosecha del período.
    const proratedPerLote = prorateByKg(unattributedAmount, kgByLote);
    const incomePerLote = mergeLoteAmounts(directPerLote, proratedPerLote);

    const report = buildRoiReport(costTotals, incomePerLote);

    res.json({
      rangoFechas: { desde, hasta },
      ...report,
      meta: {
        unattributedAmount: parseFloat(unattributedAmount.toFixed(2)),
        unattributedProrated: unattributedAmount > 0 && Object.keys(proratedPerLote).length > 0,
        incomeRecordsCount: incomeRecords.length,
      },
    });
  } catch (error) {
    console.error('[ROI] live failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute live ROI.', 500);
  }
}

module.exports = { getLive };
