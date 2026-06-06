/**
 * Integration: validación de identidades al guardar plantillas (templates.createPlantilla).
 *
 * Regresión H6 (auditoría dominio HR): el sanitizer solo recortaba strings, así
 * que una plantilla podía persistir trabajadorId/encargadoId de OTRA finca. El
 * fix valida ambos contra `users` de la finca (mismo criterio que enrichPlanilla):
 * encargado inválido → 400; trabajadores ajenos se descartan; el nombre se canoniza.
 *
 * Requiere el emulador de Firestore. Aislado por fincaId único.
 */

const { db } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { createPlantilla } = require('../../routes/hr/payroll-unit/templates');

async function seedUser(fincaId, id, nombre) {
  await db.collection('users').doc(id).set({ fincaId, nombre, empleadoPlanilla: true });
}

function makeReq(fincaId, body, { userRole = 'encargado', authUserId } = {}) {
  return { fincaId, body, userRole, userEmail: `${authUserId}@finca.test`, uid: `${authUserId}-uid`, _authUserId: authUserId };
}
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
async function cleanup(fincaId) {
  for (const col of ['hr_plantillas_planilla', 'users']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('createPlantilla — scope de identidades (H6)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('descarta trabajadores ajenos y canoniza el nombre desde users', async () => {
    const fincaId = uniqueFincaId('h6_scope'); fincas.push(fincaId);
    const enc = `${fincaId}_enc`;
    const propio = `${fincaId}_w1`;
    await seedUser(fincaId, enc, 'Encargado');
    await seedUser(fincaId, propio, 'Nombre Canónico');

    const res = makeRes();
    await createPlantilla(makeReq(fincaId, {
      nombre: 'Plantilla A',
      encargadoId: enc,
      segmentos: [{ id: 's1', labor: 'corta', unidad: 'hora' }],
      trabajadores: [
        { trabajadorId: propio, trabajadorNombre: 'NOMBRE FALSO' },
        { trabajadorId: 'ajeno_de_otra_finca', trabajadorNombre: 'Intruso' },
      ],
    }, { authUserId: enc }), res);

    expect(res.statusCode).toBe(201);
    const doc = await db.collection('hr_plantillas_planilla').doc(res.body.id).get();
    const t = doc.data().trabajadores;
    expect(t).toHaveLength(1);                       // el ajeno se descarta
    expect(t[0].trabajadorId).toBe(propio);
    expect(t[0].trabajadorNombre).toBe('Nombre Canónico'); // no el del cliente
  });

  test('encargadoId inexistente en la finca → 400', async () => {
    const fincaId = uniqueFincaId('h6_enc'); fincas.push(fincaId);
    // supervisor puede actuar on-behalf, pero el encargadoId debe existir en finca.
    const res = makeRes();
    await createPlantilla(makeReq(fincaId, {
      nombre: 'X', encargadoId: 'enc_de_otra_finca', segmentos: [], trabajadores: [],
    }, { userRole: 'supervisor', authUserId: 'sup1' }), res);

    expect(res.statusCode).toBe(400);
  });
});
