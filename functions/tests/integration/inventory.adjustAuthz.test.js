/**
 * Integration: H2 — gate de rol en `POST /api/inventario/ajuste`.
 *
 * El ajuste físico reescribe stockActual a un valor arbitrario y es la
 * operación más fraud-prone del dominio. El gate (encargado+) vivía solo en la
 * UI, por lo que un trabajador autenticado podía ajustar stock vía API. Este
 * test muestra que un trabajador recibe 403 y no toca el stock, mientras que un
 * encargado sí puede ajustar.
 *
 * Auth real mockeada: el middleware stub deriva fincaId/rol de headers.
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: jest.fn(),
  getAnthropicClient: jest.fn(),
}));

jest.mock('../../lib/middleware', () => ({
  authenticate: (req, res, next) => {
    req.uid = req.headers['x-uid'] || 'test-uid';
    req.userEmail = `${req.uid}@example.com`;
    req.fincaId = req.headers['x-finca-id'];
    req.userRole = req.headers['x-role'] || 'encargado';
    next();
  },
  authenticateOnly: (req, res, next) => next(),
}));

const express = require('express');
const { db } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');

const productsRouter = require('../../routes/products');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(productsRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

function post(path, body, { fincaId, role, uid = 'test-uid' }) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-finca-id': fincaId,
      'x-role': role,
      'x-uid': uid,
    },
    body: JSON.stringify(body),
  });
}

async function seedProducto(fincaId, stock = 100) {
  const ref = db.collection('productos').doc();
  await ref.set({ idProducto: 'PD-1', nombreComercial: 'P', unidad: 'L', stockActual: stock, stockMinimo: 0, fincaId });
  return ref;
}

async function getStock(ref) {
  return (await ref.get()).data().stockActual;
}

async function cleanup(fincaId) {
  for (const col of ['productos', 'movimientos']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H2 — /api/inventario/ajuste requires encargado+', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('trabajador es rechazado (403) y el stock no cambia', async () => {
    const finca = uniqueFincaId('adj_worker');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);

    const res = await post('/api/inventario/ajuste', {
      nota: 'conteo fisico',
      ajustes: [{ productoId: ref.id, stockAnterior: 100, stockNuevo: 0 }],
    }, { fincaId: finca, role: 'trabajador', uid: 'worker-1' });

    expect(res.status).toBe(403);
    expect(await getStock(ref)).toBe(100);
    const movs = await db.collection('movimientos').where('fincaId', '==', finca).get();
    expect(movs.empty).toBe(true);
  }, 30000);

  test('encargado puede ajustar e impacta stock + ledger', async () => {
    const finca = uniqueFincaId('adj_mgr');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);

    const res = await post('/api/inventario/ajuste', {
      nota: 'conteo fisico',
      ajustes: [{ productoId: ref.id, stockAnterior: 100, stockNuevo: 80 }],
    }, { fincaId: finca, role: 'encargado', uid: 'mgr-1' });

    expect(res.status).toBe(200);
    expect(await getStock(ref)).toBe(80);
    const movs = await db.collection('movimientos').where('fincaId', '==', finca).get();
    expect(movs.size).toBe(1);
    expect(movs.docs[0].data().tipo).toBe('ajuste');
  }, 30000);
});
