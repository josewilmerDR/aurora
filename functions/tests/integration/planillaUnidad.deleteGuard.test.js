/**
 * Integration: gate de borrado de planilla por unidad (mutations.deletePlanillaUnidad).
 *
 * Regresión H4 (auditoría dominio HR): borrar una planilla con snapshot ya
 * materializado (snapshotCreado=true) dejaba el costo colgando en finance — las
 * filas inmutables de hr_planilla_unidad_historial siguen contabilizándose, pero
 * la planilla desaparecía de la UI. El fix bloquea el hard-delete cuando existe
 * snapshot (409), incluso para admin/rrhh; borrador/pendiente (sin snapshot)
 * siguen borrables por el dueño / canActOnBehalf.
 *
 * Requiere el emulador de Firestore. Invoca el handler exportado con req/res
 * sintético. Aislado por fincaId único.
 */

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { deletePlanillaUnidad } = require('../../routes/hr/payroll-unit/mutations');

async function seedPlanilla(fincaId, encargadoId, { estado = 'borrador', snapshotCreado = false } = {}) {
  const doc = {
    fincaId,
    encargadoId,
    encargadoNombre: `Enc ${encargadoId}`,
    estado,
    segmentos: [{ id: 's1', labor: 'corta' }],
    trabajadores: [{ trabajadorId: 't1', precioHora: 1500, total: 3000 }],
    totalGeneral: 3000,
    fecha: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
    createdAt: Timestamp.now(),
  };
  if (snapshotCreado) doc.snapshotCreado = true;
  const ref = await db.collection('hr_planilla_unidad').add(doc);
  return ref.id;
}

// `_authUserId` precargado evita el lookup de users (resolveAuthUserId cachea).
function makeReq(fincaId, id, { userRole, authUserId }) {
  return { fincaId, params: { id }, userRole, userEmail: `${authUserId}@finca.test`, uid: `${authUserId}-uid`, _authUserId: authUserId };
}
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
async function exists(id) {
  return (await db.collection('hr_planilla_unidad').doc(id).get()).exists;
}
async function cleanup(fincaId) {
  for (const col of ['hr_planilla_unidad', 'audit_events']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('deletePlanillaUnidad — snapshot inmutable (H4)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('admin NO puede borrar una planilla con snapshot (409, persiste)', async () => {
    const fincaId = uniqueFincaId('h4_snapshot'); fincas.push(fincaId);
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'aprobada', snapshotCreado: true });

    const res = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'administrador', authUserId: 'admin1' }), res);

    expect(res.statusCode).toBe(409);
    expect(await exists(id)).toBe(true);
  });

  test('snapshot persiste incluso si la planilla volvió a borrador', async () => {
    const fincaId = uniqueFincaId('h4_rollback'); fincas.push(fincaId);
    // Aprobada → revertida a borrador: conserva snapshotCreado y su costo booked.
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'borrador', snapshotCreado: true });

    const res = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'administrador', authUserId: 'admin1' }), res);

    expect(res.statusCode).toBe(409);
    expect(await exists(id)).toBe(true);
  });

  test('el dueño SÍ puede borrar un borrador sin snapshot (200)', async () => {
    const fincaId = uniqueFincaId('h4_borrador'); fincas.push(fincaId);
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'borrador' });

    const res = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'encargado', authUserId: 'encA' }), res);

    expect(res.statusCode).toBe(200);
    expect(await exists(id)).toBe(false);
  });

  test('pendiente sin snapshot: borrable por el dueño (200)', async () => {
    const fincaId = uniqueFincaId('h4_pendiente'); fincas.push(fincaId);
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'pendiente' });

    const res = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'encargado', authUserId: 'encA' }), res);

    expect(res.statusCode).toBe(200);
    expect(await exists(id)).toBe(false);
  });

  test('caso borde: nacida pagada SIN snapshot → solo admin/rrhh (encargado 403)', async () => {
    const fincaId = uniqueFincaId('h4_bornpaid'); fincas.push(fincaId);
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'pagada' }); // sin snapshotCreado

    const resEnc = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'encargado', authUserId: 'encA' }), resEnc);
    expect(resEnc.statusCode).toBe(403);
    expect(await exists(id)).toBe(true);

    const resAdmin = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'administrador', authUserId: 'admin1' }), resAdmin);
    expect(resAdmin.statusCode).toBe(200);
    expect(await exists(id)).toBe(false);
  });

  test('no se puede borrar la planilla de otro encargado (403)', async () => {
    const fincaId = uniqueFincaId('h4_otro'); fincas.push(fincaId);
    const id = await seedPlanilla(fincaId, 'encA', { estado: 'borrador' });

    const res = makeRes();
    await deletePlanillaUnidad(makeReq(fincaId, id, { userRole: 'encargado', authUserId: 'encB' }), res);

    expect(res.statusCode).toBe(403);
    expect(await exists(id)).toBe(true);
  });
});
