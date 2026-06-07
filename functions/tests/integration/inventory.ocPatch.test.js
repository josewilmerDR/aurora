/**
 * Integration: H5 — hardening de PATCH /api/ordenes-compra/:id.
 *
 * Antes, el handler escribía `items` verbatim del cliente: sin acotar, sin
 * whitelist de campos, y permitía resetear `cantidadRecibida` (campo de
 * conciliación server-maintained) → re-recibir la OC y duplicar stock.
 *
 * Verifica que el PATCH:
 *   - preserva `cantidadRecibida` del doc (ignora el valor del cliente),
 *   - acota números fuera de rango y descarta campos arbitrarios,
 *   - deja audit purchase_order.update.
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

function req(method, path, body, { fincaId, role = 'encargado', uid = 'mgr-1' }) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-finca-id': fincaId, 'x-role': role, 'x-uid': uid },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seedOc(fincaId) {
  const ref = db.collection('ordenes_compra').doc();
  await ref.set({
    fincaId,
    poNumber: 'OC-000001',
    estado: 'recibida_parcial',
    proveedor: 'Z',
    items: [{ productoId: 'p1', nombreComercial: 'P1', cantidad: 10, cantidadRecibida: 5, unidad: 'kg', precioUnitario: 100 }],
    createdAt: Timestamp.now(),
  });
  return ref;
}

async function cleanup(fincaId) {
  for (const col of ['ordenes_compra', 'audit_events']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H5 — OC PATCH sanitizes items + preserves cantidadRecibida', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('cliente no puede resetear cantidadRecibida ni inyectar campos / números sin rango', async () => {
    const finca = uniqueFincaId('oc_patch');
    fincas.push(finca);
    const ref = await seedOc(finca);

    const res = await req('PATCH', `/api/ordenes-compra/${ref.id}`, {
      estado: 'activa',
      items: [{
        productoId: 'p1',
        nombreComercial: 'P1',
        cantidad: 999999999999,   // fuera de rango → clamp a 1e9
        cantidadRecibida: 0,      // intento de reset → debe ignorarse
        unidad: 'kg',
        precioUnitario: -50,      // negativo → clamp a 0
        evil: 'mass-assign',      // campo arbitrario → descartado
      }],
    }, { fincaId: finca });

    expect(res.status).toBe(200);
    const item = (await ref.get()).data().items[0];
    expect(item.cantidadRecibida).toBe(5);       // preservado, no 0
    expect(item.cantidad).toBe(1e9);             // clamped
    expect(item.precioUnitario).toBe(0);         // clamped
    expect(item.evil).toBeUndefined();           // stripped
  }, 30000);

  test('PATCH deja audit purchase_order.update', async () => {
    const finca = uniqueFincaId('oc_patch_audit');
    fincas.push(finca);
    const ref = await seedOc(finca);

    const res = await req('PATCH', `/api/ordenes-compra/${ref.id}`, { estado: 'cancelada' }, { fincaId: finca });
    expect(res.status).toBe(200);

    const audits = await db.collection('audit_events')
      .where('fincaId', '==', finca)
      .where('action', '==', 'purchase_order.update')
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().metadata.estadoNuevo).toBe('cancelada');
  }, 30000);

  test('trabajador no puede PATCH (403)', async () => {
    const finca = uniqueFincaId('oc_patch_worker');
    fincas.push(finca);
    const ref = await seedOc(finca);
    const res = await req('PATCH', `/api/ordenes-compra/${ref.id}`, { estado: 'cancelada' }, { fincaId: finca, role: 'trabajador', uid: 'w1' });
    expect(res.status).toBe(403);
    expect((await ref.get()).data().estado).toBe('recibida_parcial');
  }, 30000);
});
