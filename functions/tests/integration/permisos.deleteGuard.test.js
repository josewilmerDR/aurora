/**
 * Integration: gate de borrado de permisos (permisos.deletePermiso).
 *
 * Regresión H3 (auditoría dominio HR): el PUT exige supervisor+ para aprobar/
 * rechazar, pero el DELETE solo exigía encargado+ — un encargado podía borrar un
 * permiso YA decidido (aprobado/rechazado) deshaciendo la decisión del supervisor
 * que justifica/descuenta nómina. El fix exige supervisor+ para borrar permisos
 * en estado terminal; los 'pendiente' siguen borrables por encargado+.
 *
 * Requiere el emulador de Firestore. Invoca el handler exportado con req/res
 * sintético. Aislado por fincaId único.
 */

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { deletePermiso } = require('../../routes/hr/permisos');

async function seedPermiso(fincaId, estado) {
  const ref = await db.collection('hr_permisos').add({
    fincaId,
    trabajadorId: 't1',
    trabajadorNombre: 'Trabajador Uno',
    tipo: 'vacaciones',
    estado,
    dias: 3,
    fechaInicio: Timestamp.now(),
    fechaFin: Timestamp.now(),
    createdAt: Timestamp.now(),
  });
  return ref.id;
}

function makeReq(fincaId, id, userRole) {
  return { fincaId, params: { id }, userRole, userEmail: `${userRole}@finca.test`, uid: `${userRole}-uid` };
}
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function exists(id) {
  return (await db.collection('hr_permisos').doc(id).get()).exists;
}

async function cleanup(fincaId) {
  for (const col of ['hr_permisos', 'audit_events']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('deletePermiso — gate por estado (H3)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('encargado NO puede borrar un permiso aprobado (403, persiste)', async () => {
    const fincaId = uniqueFincaId('h3_aprobado'); fincas.push(fincaId);
    const id = await seedPermiso(fincaId, 'aprobado');

    const res = makeRes();
    await deletePermiso(makeReq(fincaId, id, 'encargado'), res);

    expect(res.statusCode).toBe(403);
    expect(await exists(id)).toBe(true);
  });

  test('encargado NO puede borrar un permiso rechazado (403, persiste)', async () => {
    const fincaId = uniqueFincaId('h3_rechazado'); fincas.push(fincaId);
    const id = await seedPermiso(fincaId, 'rechazado');

    const res = makeRes();
    await deletePermiso(makeReq(fincaId, id, 'encargado'), res);

    expect(res.statusCode).toBe(403);
    expect(await exists(id)).toBe(true);
  });

  test('encargado SÍ puede borrar un permiso pendiente (200)', async () => {
    const fincaId = uniqueFincaId('h3_pendiente'); fincas.push(fincaId);
    const id = await seedPermiso(fincaId, 'pendiente');

    const res = makeRes();
    await deletePermiso(makeReq(fincaId, id, 'encargado'), res);

    expect(res.statusCode).toBe(200);
    expect(await exists(id)).toBe(false);
  });

  test('supervisor SÍ puede borrar un permiso aprobado (200)', async () => {
    const fincaId = uniqueFincaId('h3_sup'); fincas.push(fincaId);
    const id = await seedPermiso(fincaId, 'aprobado');

    const res = makeRes();
    await deletePermiso(makeReq(fincaId, id, 'supervisor'), res);

    expect(res.statusCode).toBe(200);
    expect(await exists(id)).toBe(false);
  });

  test('trabajador no puede borrar nada (403)', async () => {
    const fincaId = uniqueFincaId('h3_trab'); fincas.push(fincaId);
    const id = await seedPermiso(fincaId, 'pendiente');

    const res = makeRes();
    await deletePermiso(makeReq(fincaId, id, 'trabajador'), res);

    expect(res.statusCode).toBe(403);
    expect(await exists(id)).toBe(true);
  });
});
