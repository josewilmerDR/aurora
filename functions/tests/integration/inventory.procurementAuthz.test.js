/**
 * Integration: H3 — piso de rol en compras/* y ordenes-compra/*; H4 — audit +
 * autoría en compras/confirmar.
 *
 * Antes, todo el sub-dominio procurement-invoices (compras, ordenes-compra)
 * sólo exigía `authenticate`, mientras el resto del dominio gateaba encargado+.
 * Y `compras/confirmar` mutaba stock + creaba productos sin dejar rastro en
 * audit_events ni autoría en el doc.
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

function req(method, path, body, { fincaId, role, uid = 'test-uid' }) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-finca-id': fincaId, 'x-role': role, 'x-uid': uid },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function seedProducto(fincaId, stock = 100) {
  const ref = db.collection('productos').doc();
  await ref.set({ idProducto: 'PD-1', nombreComercial: 'P', unidad: 'L', stockActual: stock, stockMinimo: 0, fincaId });
  return ref;
}

async function cleanup(fincaId) {
  for (const col of ['productos', 'movimientos', 'compras', 'ordenes_compra', 'audit_events']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H3/H4 — procurement authz + audit', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('H3 — trabajador no puede crear OC (403)', async () => {
    const finca = uniqueFincaId('oc_worker');
    fincas.push(finca);
    const res = await req('POST', '/api/ordenes-compra', {
      proveedor: 'X',
      items: [{ nombreComercial: 'p', cantidad: 1, precioUnitario: 10, unidad: 'kg' }],
    }, { fincaId: finca, role: 'trabajador', uid: 'w1' });
    expect(res.status).toBe(403);
    const ocs = await db.collection('ordenes_compra').where('fincaId', '==', finca).get();
    expect(ocs.empty).toBe(true);
  }, 30000);

  test('H3 — trabajador no puede confirmar compra (403) y no toca stock', async () => {
    const finca = uniqueFincaId('compra_worker');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);
    const res = await req('POST', '/api/compras/confirmar', {
      proveedor: 'X',
      lineas: [{ productoId: ref.id, nombreComercial: 'p', cantidadIngresada: 50, unidad: 'L' }],
    }, { fincaId: finca, role: 'trabajador', uid: 'w1' });
    expect(res.status).toBe(403);
    expect((await ref.get()).data().stockActual).toBe(100);
    const compras = await db.collection('compras').where('fincaId', '==', finca).get();
    expect(compras.empty).toBe(true);
  }, 30000);

  test('H4 — encargado confirma: stock sube, doc lleva autoría y se audita', async () => {
    const finca = uniqueFincaId('compra_ok');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);
    const res = await req('POST', '/api/compras/confirmar', {
      proveedor: 'Proveedor Z',
      lineas: [{ productoId: ref.id, nombreComercial: 'p', cantidadIngresada: 50, unidad: 'L' }],
    }, { fincaId: finca, role: 'encargado', uid: 'mgr-1' });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect((await ref.get()).data().stockActual).toBe(150);

    // Autoría en el doc compra.
    const compraSnap = await db.collection('compras').doc(body.id).get();
    expect(compraSnap.data().createdBy).toBe('mgr-1');
    expect(compraSnap.data().createdByEmail).toBe('mgr-1@example.com');

    // Audit event purchase.receipt apuntando a la compra.
    const audits = await db.collection('audit_events')
      .where('fincaId', '==', finca)
      .where('action', '==', 'purchase.receipt')
      .get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0].data().target).toEqual({ type: 'compra', id: body.id });
  }, 30000);
});
