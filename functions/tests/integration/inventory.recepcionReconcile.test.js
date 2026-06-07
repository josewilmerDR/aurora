/**
 * Integration: H8/H9 — conciliación de OC en recepción y tope de cantidad.
 *
 * H8: una recepción parcial debe acumular cantidadRecibida en las líneas de la
 *     OC y derivar el estado de la propia OC (no del cantidadOC del cliente).
 * H9: compras/confirmar rechaza cantidades por encima del tope compartido.
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

const procurementRouter = require('../../routes/procurement-invoices');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(procurementRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

function post(path, body, { fincaId, role = 'encargado', uid = 'mgr-1' }) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-finca-id': fincaId, 'x-role': role, 'x-uid': uid },
    body: JSON.stringify(body),
  });
}

async function seedProducto(fincaId, stock = 0) {
  const ref = db.collection('productos').doc();
  await ref.set({ idProducto: 'PD-1', nombreComercial: 'P1', unidad: 'kg', stockActual: stock, stockMinimo: 0, fincaId });
  return ref;
}

async function seedOc(fincaId, productoId) {
  const ref = db.collection('ordenes_compra').doc();
  await ref.set({
    fincaId, poNumber: 'OC-000001', estado: 'activa',
    items: [{ productoId, nombreComercial: 'P1', cantidad: 10, cantidadRecibida: 0, unidad: 'kg', precioUnitario: 100 }],
    createdAt: Timestamp.now(),
  });
  return ref;
}

async function cleanup(fincaId) {
  for (const col of ['productos', 'movimientos', 'recepciones', 'ordenes_compra', 'audit_events']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H8 — recepción parcial concilia la OC server-side', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('recepción parcial acumula cantidadRecibida y deja estado recibida_parcialmente', async () => {
    const finca = uniqueFincaId('rec_partial');
    fincas.push(finca);
    const prod = await seedProducto(finca, 0);
    const oc = await seedOc(finca, prod.id);

    // El cliente miente con cantidadOC=4 (parcial), pero el estado debe salir de
    // la cantidad real de la OC (10), no de ese valor.
    const res = await post('/api/recepciones', {
      ordenCompraId: oc.id,
      items: [{ productoId: prod.id, nombreComercial: 'P1', cantidadRecibida: 4, cantidadOC: 4, unidad: 'kg' }],
    }, { fincaId: finca });

    expect(res.status).toBe(201);
    const ocData = (await oc.get()).data();
    expect(ocData.items[0].cantidadRecibida).toBe(4);
    expect(ocData.estado).toBe('recibida_parcialmente');
    expect((await prod.get()).data().stockActual).toBe(4);
  }, 30000);

  test('segunda recepción completa la OC → recibida', async () => {
    const finca = uniqueFincaId('rec_full');
    fincas.push(finca);
    const prod = await seedProducto(finca, 0);
    const oc = await seedOc(finca, prod.id);

    await post('/api/recepciones', {
      ordenCompraId: oc.id,
      items: [{ productoId: prod.id, nombreComercial: 'P1', cantidadRecibida: 6, cantidadOC: 10, unidad: 'kg' }],
    }, { fincaId: finca });
    // Tras la primera, la OC está en recibida_parcialmente; la segunda debe poder recibir.
    const res2 = await post('/api/recepciones', {
      ordenCompraId: oc.id,
      items: [{ productoId: prod.id, nombreComercial: 'P1', cantidadRecibida: 4, cantidadOC: 10, unidad: 'kg' }],
    }, { fincaId: finca });

    expect(res2.status).toBe(201);
    const ocData = (await oc.get()).data();
    expect(ocData.items[0].cantidadRecibida).toBe(10);
    expect(ocData.estado).toBe('recibida');
  }, 30000);

  test('H9 — compras/confirmar rechaza cantidad sobre el tope', async () => {
    const finca = uniqueFincaId('cap');
    fincas.push(finca);
    const prod = await seedProducto(finca, 0);
    const res = await post('/api/compras/confirmar', {
      proveedor: 'X',
      lineas: [{ productoId: prod.id, nombreComercial: 'P1', cantidadIngresada: 1000000, unidad: 'kg' }],
    }, { fincaId: finca });
    expect(res.status).toBe(400);
    expect((await prod.get()).data().stockActual).toBe(0);
  }, 30000);
});
