/**
 * Integration: concurrency race for the OC counter.
 *
 * Regression test for the pre-0.1 bug where the counter increment and the OC
 * insert were two separate operations — opening a window where two parallel
 * requests could consume the same poNumber or lose an increment. Now both
 * happen inside the same transaction, so 10 parallel calls must produce 10
 * distinct sequential poNumbers.
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: jest.fn(),
  getAnthropicClient: jest.fn(),
}));

const { db } = require('../../lib/firebase');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { uniqueFincaId, newActionContext, cleanupFinca } = require('../helpers');

const PARALLEL = 10;

describe('crear_orden_compra — counter concurrency', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupFinca)));

  test(`${PARALLEL} parallel OCs yield ${PARALLEL} unique sequential poNumbers`, async () => {
    const fincaId = uniqueFincaId('oc_race');
    fincas.push(fincaId);

    const promises = Array.from({ length: PARALLEL }, () => {
      const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_orden_compra' });
      return executeAutopilotAction('crear_orden_compra', {
        proveedor: 'Parallel Co',
        fecha: '2026-04-17',
        items: [{ productoId: 'p', nombreComercial: 'x', cantidad: 1, precioUnitario: 10, unidad: 'kg' }],
      }, fincaId, { actionDocRef, actionInitialDoc });
    });

    const results = await Promise.all(promises);
    const poNumbers = results.map(r => r.poNumber);

    // All unique
    expect(new Set(poNumbers).size).toBe(PARALLEL);

    // All match OC-NNNNNN shape
    poNumbers.forEach(n => expect(n).toMatch(/^OC-\d{6}$/));

    // Counter reflects the final value
    const counterSnap = await db.collection('counters').doc(`oc_${fincaId}`).get();
    expect(counterSnap.data().value).toBe(PARALLEL);

    // Every OC exists in Firestore
    const ocSnap = await db.collection('ordenes_compra').where('fincaId', '==', fincaId).get();
    expect(ocSnap.size).toBe(PARALLEL);
  }, 30000);
});
