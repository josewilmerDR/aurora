/**
 * Integration: H7 — guard de integridad referencial al borrar/inactivar un
 * producto.
 *
 * Antes, DELETE/inactivar sólo exigían stockActual===0. Un producto con stock 0
 * referenciado por una tarea pendiente, una OC activa o una solicitud pendiente
 * podía borrarse, dejando IDs colgantes que los paths de recepción/egreso luego
 * actualizan a ciegas. Verifica el 409 por cada tipo de referencia y el camino
 * feliz (sin referencias → borra).
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
const { db, Timestamp } = require('../../lib/firebase');
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

function req(method, path, { fincaId, role = 'encargado', uid = 'mgr-1' }) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-finca-id': fincaId, 'x-role': role, 'x-uid': uid },
  });
}

async function seedProducto(fincaId) {
  const ref = db.collection('productos').doc();
  await ref.set({ idProducto: 'PD-1', nombreComercial: 'P', unidad: 'L', stockActual: 0, stockMinimo: 0, activo: true, fincaId });
  return ref;
}

async function cleanup(fincaId) {
  for (const col of ['productos', 'scheduled_tasks', 'ordenes_compra', 'solicitudes_compra']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H7 — producto delete/inactivar referential guard', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('409 si lo referencia una tarea pendiente', async () => {
    const finca = uniqueFincaId('ref_task');
    fincas.push(finca);
    const prod = await seedProducto(finca);
    await db.collection('scheduled_tasks').doc().set({
      fincaId: finca, status: 'pending', type: 'APLICACION', executeAt: Timestamp.now(),
      activity: { name: 'x', type: 'aplicacion', productos: [{ productoId: prod.id, cantidad: 1 }] },
    });

    const res = await req('DELETE', `/api/productos/${prod.id}`, { fincaId: finca });
    expect(res.status).toBe(409);
    expect((await prod.get()).exists).toBe(true);
  }, 30000);

  test('409 si lo referencia una OC activa', async () => {
    const finca = uniqueFincaId('ref_oc');
    fincas.push(finca);
    const prod = await seedProducto(finca);
    await db.collection('ordenes_compra').doc().set({
      fincaId: finca, estado: 'activa', poNumber: 'OC-1',
      items: [{ productoId: prod.id, nombreComercial: 'P', cantidad: 5 }], createdAt: Timestamp.now(),
    });

    const res = await req('DELETE', `/api/productos/${prod.id}`, { fincaId: finca });
    expect(res.status).toBe(409);
  }, 30000);

  test('409 al inactivar si lo referencia una solicitud pendiente', async () => {
    const finca = uniqueFincaId('ref_sol');
    fincas.push(finca);
    const prod = await seedProducto(finca);
    await db.collection('solicitudes_compra').doc().set({
      fincaId: finca, estado: 'pendiente', fechaCreacion: Timestamp.now(),
      items: [{ productoId: prod.id, nombreComercial: 'P', cantidadSolicitada: 3 }],
    });

    const res = await req('PUT', `/api/productos/${prod.id}/inactivar`, { fincaId: finca });
    expect(res.status).toBe(409);
    expect((await prod.get()).data().activo).toBe(true);
  }, 30000);

  test('borra cuando no hay referencias activas', async () => {
    const finca = uniqueFincaId('ref_none');
    fincas.push(finca);
    const prod = await seedProducto(finca);
    // OC ya cancelada → no debe bloquear.
    await db.collection('ordenes_compra').doc().set({
      fincaId: finca, estado: 'cancelada', poNumber: 'OC-9',
      items: [{ productoId: prod.id, nombreComercial: 'P', cantidad: 5 }], createdAt: Timestamp.now(),
    });

    const res = await req('DELETE', `/api/productos/${prod.id}`, { fincaId: finca });
    expect(res.status).toBe(200);
    expect((await prod.get()).exists).toBe(false);
  }, 30000);
});
