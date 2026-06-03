/**
 * Integration: guards de integridad del dominio Cosecha (harvest/guards.js).
 *
 * Estos guards SON el enforcement de los invariantes de seguridad del dominio,
 * así que ejercerlos contra el emulador cubre el núcleo de:
 *   - H2 (doble-conteo) / H3 (edición de registro referenciado):
 *       findActiveDispatchUsingBoletas — "una boleta pertenece a lo sumo a un
 *       despacho ACTIVO".
 *   - H4 (trazabilidad inversa ingreso↔despacho):
 *       findIncomeReferencingDispatch — "no se anula un despacho que un ingreso
 *       activo aún referencia".
 *
 * Requiere el emulador de Firestore (127.0.0.1:8080). Cada caso se aísla por
 * fincaId único y limpia sus colecciones al final.
 */

const { db } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const {
  findActiveDispatchUsingBoletas,
  findIncomeReferencingDispatch,
} = require('../../routes/harvest/guards');

async function addDespacho(fincaId, { estado = 'activo', boletas = [], consecutivo = 'DC-1' } = {}) {
  const ref = await db.collection('cosecha_despachos').add({ fincaId, estado, boletas, consecutivo });
  return ref.id;
}

async function addIncome(fincaId, fields = {}) {
  const ref = await db.collection('income_records').add({ fincaId, ...fields });
  return ref.id;
}

async function cleanup(fincaId) {
  for (const col of ['cosecha_despachos', 'income_records']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('findActiveDispatchUsingBoletas (H2 / H3)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('returns null for empty / non-array ids without touching state', async () => {
    const fincaId = uniqueFincaId('guard_empty'); fincas.push(fincaId);
    expect(await findActiveDispatchUsingBoletas(fincaId, [])).toBeNull();
    expect(await findActiveDispatchUsingBoletas(fincaId, null)).toBeNull();
    expect(await findActiveDispatchUsingBoletas(fincaId, [null, undefined])).toBeNull();
  });

  test('finds an active dispatch that already uses the boleta', async () => {
    const fincaId = uniqueFincaId('guard_hit'); fincas.push(fincaId);
    const despId = await addDespacho(fincaId, { boletas: [{ id: 'reg-1' }, { id: 'reg-2' }], consecutivo: 'DC-7' });
    const match = await findActiveDispatchUsingBoletas(fincaId, ['reg-2']);
    expect(match).not.toBeNull();
    expect(match.id).toBe(despId);
    expect(match.data().consecutivo).toBe('DC-7');
  });

  test('ignores anulado dispatches (their boletas are freed)', async () => {
    const fincaId = uniqueFincaId('guard_anulado'); fincas.push(fincaId);
    await addDespacho(fincaId, { estado: 'anulado', boletas: [{ id: 'reg-1' }] });
    expect(await findActiveDispatchUsingBoletas(fincaId, ['reg-1'])).toBeNull();
  });

  test('excludeDispatchId omits the dispatch itself (reactivation case)', async () => {
    const fincaId = uniqueFincaId('guard_self'); fincas.push(fincaId);
    const selfId = await addDespacho(fincaId, { boletas: [{ id: 'reg-1' }] });
    // Only this dispatch holds reg-1 → excluding it yields no clash.
    expect(await findActiveDispatchUsingBoletas(fincaId, ['reg-1'], { excludeDispatchId: selfId })).toBeNull();
    // A second active dispatch on the same boleta IS a clash even when self-excluded.
    const otherId = await addDespacho(fincaId, { boletas: [{ id: 'reg-1' }], consecutivo: 'DC-9' });
    const match = await findActiveDispatchUsingBoletas(fincaId, ['reg-1'], { excludeDispatchId: selfId });
    expect(match.id).toBe(otherId);
  });

  test('is finca-scoped: another finca\'s dispatch never matches', async () => {
    const fincaA = uniqueFincaId('guard_fincaA'); fincas.push(fincaA);
    const fincaB = uniqueFincaId('guard_fincaB'); fincas.push(fincaB);
    await addDespacho(fincaB, { boletas: [{ id: 'reg-shared' }] });
    expect(await findActiveDispatchUsingBoletas(fincaA, ['reg-shared'])).toBeNull();
  });

  test('returns null when no active dispatch uses the id', async () => {
    const fincaId = uniqueFincaId('guard_miss'); fincas.push(fincaId);
    await addDespacho(fincaId, { boletas: [{ id: 'reg-1' }] });
    expect(await findActiveDispatchUsingBoletas(fincaId, ['reg-999'])).toBeNull();
  });
});

describe('findIncomeReferencingDispatch (H4)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('returns null for a falsy despachoId', async () => {
    const fincaId = uniqueFincaId('inc_falsy'); fincas.push(fincaId);
    expect(await findIncomeReferencingDispatch(fincaId, '')).toBeNull();
    expect(await findIncomeReferencingDispatch(fincaId, null)).toBeNull();
  });

  test('finds an active income referencing via despachoIds[].id', async () => {
    const fincaId = uniqueFincaId('inc_array'); fincas.push(fincaId);
    const incId = await addIncome(fincaId, {
      collectionStatus: 'pendiente',
      despachoIds: [{ id: 'desp-1', cantidad: 10 }, { id: 'desp-2' }],
    });
    const match = await findIncomeReferencingDispatch(fincaId, 'desp-2');
    expect(match?.id).toBe(incId);
  });

  test('finds an active income referencing via legacy despachoId (string)', async () => {
    const fincaId = uniqueFincaId('inc_legacy'); fincas.push(fincaId);
    const incId = await addIncome(fincaId, { collectionStatus: 'cobrado', despachoId: 'desp-legacy' });
    const match = await findIncomeReferencingDispatch(fincaId, 'desp-legacy');
    expect(match?.id).toBe(incId);
  });

  test('ignores income whose collectionStatus is anulado', async () => {
    const fincaId = uniqueFincaId('inc_anulado'); fincas.push(fincaId);
    await addIncome(fincaId, { collectionStatus: 'anulado', despachoIds: [{ id: 'desp-1' }] });
    await addIncome(fincaId, { collectionStatus: 'anulado', despachoId: 'desp-1' });
    expect(await findIncomeReferencingDispatch(fincaId, 'desp-1')).toBeNull();
  });

  test('is finca-scoped: another finca\'s income never matches', async () => {
    const fincaA = uniqueFincaId('inc_fincaA'); fincas.push(fincaA);
    const fincaB = uniqueFincaId('inc_fincaB'); fincas.push(fincaB);
    await addIncome(fincaB, { collectionStatus: 'pendiente', despachoId: 'desp-x' });
    expect(await findIncomeReferencingDispatch(fincaA, 'desp-x')).toBeNull();
  });

  test('returns null when no income references the dispatch', async () => {
    const fincaId = uniqueFincaId('inc_miss'); fincas.push(fincaId);
    await addIncome(fincaId, { collectionStatus: 'pendiente', despachoIds: [{ id: 'desp-1' }] });
    expect(await findIncomeReferencingDispatch(fincaId, 'desp-other')).toBeNull();
  });
});
