/**
 * Integration: scope de lectura de planilla por unidad (reads.listPlanillasUnidad).
 *
 * Regresión H2 (auditoría dominio HR):
 *   - Un encargado solo debe ver SUS propias planillas (encargadoId), espejando
 *     el gate de escritura. Antes veía las de toda la finca con precioHora ajeno.
 *   - supervisor/admin/rrhh (canActOnBehalf) ven toda la finca.
 *   - La respuesta nunca incluye history/createdBy/updatedBy (emails de auditoría).
 *
 * Requiere el emulador de Firestore. Se invoca el handler exportado con un req/res
 * sintético (el repo no usa supertest). Aislado por fincaId único.
 */

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { listPlanillasUnidad } = require('../../routes/hr/payroll-unit/reads');

async function seedPlanilla(fincaId, encargadoId, { estado = 'pendiente', extra = {} } = {}) {
  const ref = await db.collection('hr_planilla_unidad').add({
    fincaId,
    encargadoId,
    encargadoNombre: `Enc ${encargadoId}`,
    estado,
    segmentos: [{ id: 's1', labor: 'corta' }],
    trabajadores: [{ trabajadorId: 't1', precioHora: 1500, total: 3000 }],
    totalGeneral: 3000,
    observaciones: '',
    fecha: Timestamp.fromDate(new Date('2026-05-10T12:00:00Z')),
    createdAt: Timestamp.now(),
    history: [{ at: new Date(), byEmail: 'auditor@secret.com', action: 'created' }],
    createdBy: { userId: encargadoId, email: 'creador@secret.com' },
    updatedBy: { userId: encargadoId, email: 'editor@secret.com' },
    ...extra,
  });
  return ref.id;
}

// req/res sintéticos. `_authUserId` precargado evita el lookup de users
// (resolveAuthUserId devuelve el cache si está definido).
function makeReq(fincaId, { userRole, authUserId }) {
  return { fincaId, userRole, userEmail: `${authUserId}@finca.test`, _authUserId: authUserId };
}
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function cleanup(fincaId) {
  const snap = await db.collection('hr_planilla_unidad').where('fincaId', '==', fincaId).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

describe('listPlanillasUnidad — scope por dueño (H2)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('encargado solo ve sus propias planillas', async () => {
    const fincaId = uniqueFincaId('h2_scope'); fincas.push(fincaId);
    await seedPlanilla(fincaId, 'encA');
    await seedPlanilla(fincaId, 'encA');
    await seedPlanilla(fincaId, 'encB'); // de otro encargado

    const res = makeRes();
    await listPlanillasUnidad(makeReq(fincaId, { userRole: 'encargado', authUserId: 'encA' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every(p => p.encargadoId === 'encA')).toBe(true);
  });

  test('supervisor ve todas las planillas de la finca', async () => {
    const fincaId = uniqueFincaId('h2_scope_sup'); fincas.push(fincaId);
    await seedPlanilla(fincaId, 'encA');
    await seedPlanilla(fincaId, 'encB');

    const res = makeRes();
    await listPlanillasUnidad(makeReq(fincaId, { userRole: 'supervisor', authUserId: 'sup1' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('la respuesta nunca incluye emails de auditoría', async () => {
    const fincaId = uniqueFincaId('h2_pii'); fincas.push(fincaId);
    await seedPlanilla(fincaId, 'encA');

    const res = makeRes();
    await listPlanillasUnidad(makeReq(fincaId, { userRole: 'supervisor', authUserId: 'sup1' }), res);

    expect(res.body).toHaveLength(1);
    const p = res.body[0];
    expect(p.history).toBeUndefined();
    expect(p.createdBy).toBeUndefined();
    expect(p.updatedBy).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('@secret.com');
    // El dueño/supervisor sí conserva el dato operativo que la UI necesita.
    expect(p.trabajadores[0].precioHora).toBe(1500);
  });

  test('encargado sin identidad resoluble → lista vacía (fail-closed)', async () => {
    const fincaId = uniqueFincaId('h2_failclosed'); fincas.push(fincaId);
    await seedPlanilla(fincaId, 'encA');

    const res = makeRes();
    await listPlanillasUnidad(makeReq(fincaId, { userRole: 'encargado', authUserId: null }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('trabajador no puede leer (403)', async () => {
    const fincaId = uniqueFincaId('h2_trab'); fincas.push(fincaId);
    const res = makeRes();
    await listPlanillasUnidad(makeReq(fincaId, { userRole: 'trabajador', authUserId: 'trab1' }), res);
    expect(res.statusCode).toBe(403);
  });
});
