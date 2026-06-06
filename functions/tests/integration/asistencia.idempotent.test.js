/**
 * Integration: idempotencia del POST single de asistencia (asistencia.registerAsistencia).
 *
 * Regresión H5 (auditoría dominio HR): el POST single usaba `.add()` (id
 * aleatorio), así que reenviar la asistencia del mismo trabajador/día creaba
 * registros DUPLICADOS que el aggregator de scoring sumaba (horasExtra inflado).
 * El fix usa doc id determinista `${trabajadorId}_${fecha}` + merge:true, igual
 * que el endpoint /batch — "una por trabajador por día".
 *
 * Requiere el emulador de Firestore. Invoca el handler exportado con req/res
 * sintético. Aislado por fincaId único.
 */

const { db } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { registerAsistencia } = require('../../routes/hr/asistencia');

async function seedWorker(fincaId, id, nombre = 'Trabajador Uno') {
  await db.collection('users').doc(id).set({ fincaId, nombre, empleadoPlanilla: true });
}

function makeReq(fincaId, body, userRole = 'encargado') {
  return { fincaId, body, userRole, userEmail: `${userRole}@finca.test`, uid: `${userRole}-uid` };
}
function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function countAsistencia(fincaId, trabajadorId) {
  const snap = await db.collection('hr_asistencia')
    .where('fincaId', '==', fincaId)
    .where('trabajadorId', '==', trabajadorId)
    .get();
  return snap.docs;
}

async function cleanup(fincaId) {
  const tasks = [];
  for (const col of ['hr_asistencia', 'users']) {
    tasks.push((async () => {
      const snap = col === 'users'
        ? await db.collection('users').where('fincaId', '==', fincaId).get()
        : await db.collection(col).where('fincaId', '==', fincaId).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    })());
  }
  await Promise.all(tasks);
}

describe('registerAsistencia — idempotencia (H5)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('reenviar el mismo trabajador/día no duplica: 1 doc, último valor gana', async () => {
    const fincaId = uniqueFincaId('h5_idem'); fincas.push(fincaId);
    const wid = `${fincaId}_w1`;
    await seedWorker(fincaId, wid);

    const res1 = makeRes();
    await registerAsistencia(makeReq(fincaId, { trabajadorId: wid, fecha: '2026-05-10', estado: 'presente', horasExtra: 2 }), res1);
    expect(res1.statusCode).toBe(201);

    const res2 = makeRes();
    await registerAsistencia(makeReq(fincaId, { trabajadorId: wid, fecha: '2026-05-10', estado: 'incapacidad', horasExtra: 0 }), res2);
    expect(res2.statusCode).toBe(201);

    // Mismo doc id determinista en ambas respuestas.
    expect(res1.body.id).toBe(`${wid}_2026-05-10`);
    expect(res2.body.id).toBe(res1.body.id);

    const docs = await countAsistencia(fincaId, wid);
    expect(docs).toHaveLength(1); // antes del fix: 2
    expect(docs[0].data().estado).toBe('incapacidad'); // el reenvío sobreescribe
    expect(docs[0].data().horasExtra).toBe(0);
  });

  test('días distintos del mismo trabajador → docs distintos', async () => {
    const fincaId = uniqueFincaId('h5_dias'); fincas.push(fincaId);
    const wid = `${fincaId}_w1`;
    await seedWorker(fincaId, wid);

    await registerAsistencia(makeReq(fincaId, { trabajadorId: wid, fecha: '2026-05-10', estado: 'presente' }), makeRes());
    await registerAsistencia(makeReq(fincaId, { trabajadorId: wid, fecha: '2026-05-11', estado: 'presente' }), makeRes());

    const docs = await countAsistencia(fincaId, wid);
    expect(docs).toHaveLength(2);
  });

  test('trabajador de otra finca → 400 (sin escritura)', async () => {
    const fincaId = uniqueFincaId('h5_finca'); fincas.push(fincaId);
    const res = makeRes();
    await registerAsistencia(makeReq(fincaId, { trabajadorId: 'inexistente', fecha: '2026-05-10', estado: 'presente' }), res);
    expect(res.statusCode).toBe(400);
  });

  test('trabajador no puede registrar (403)', async () => {
    const fincaId = uniqueFincaId('h5_trab'); fincas.push(fincaId);
    const res = makeRes();
    await registerAsistencia(makeReq(fincaId, { trabajadorId: 'x', fecha: '2026-05-10', estado: 'presente' }, 'trabajador'), res);
    expect(res.statusCode).toBe(403);
  });
});
