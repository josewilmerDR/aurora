/**
 * Integration: H1 — aislamiento multi-tenant en los writers de stock por
 * recepción/compra.
 *
 * `POST /api/recepciones` y `POST /api/compras/confirmar` reciben `productoId`
 * desde el cliente y lo usan para `increment(stockActual)`. Sin verificar la
 * finca del producto, un encargado de la finca A podía inflar/corromper el
 * stock de un producto de la finca B (y el movimiento se escribía con la finca
 * del atacante, invisible para la víctima).
 *
 * Estos tests muestran que un productoId foráneo es rechazado (400) y NO toca
 * el stock de la víctima, mientras que un productoId propio sí se procesa.
 *
 * El auth real (token Firebase + membership) se mockea: el middleware stub
 * deriva fincaId/rol de headers, para poder ejercer los handlers Express
 * directamente contra el emulador de Firestore.
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
const productsRouter = require('../../routes/products');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(procurementRouter);
  app.use(productsRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

function post(path, body, { fincaId, role = 'encargado' }) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-finca-id': fincaId,
      'x-role': role,
    },
    body: JSON.stringify(body),
  });
}

async function seedProducto(fincaId, stock = 100) {
  const ref = db.collection('productos').doc();
  await ref.set({
    idProducto: 'PD-1',
    nombreComercial: 'Victima',
    unidad: 'L',
    stockActual: stock,
    stockMinimo: 0,
    fincaId,
  });
  return ref;
}

async function getStock(ref) {
  return (await ref.get()).data().stockActual;
}

async function cleanup(fincaId) {
  for (const col of ['productos', 'movimientos', 'recepciones', 'compras']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('H1 — stock writers reject cross-finca productoId', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('POST /api/recepciones rechaza productoId de otra finca y no toca su stock', async () => {
    const fincaVictima = uniqueFincaId('victima');
    const fincaAtacante = uniqueFincaId('atacante');
    fincas.push(fincaVictima, fincaAtacante);
    const victimaRef = await seedProducto(fincaVictima, 100);

    const res = await post('/api/recepciones', {
      items: [{ productoId: victimaRef.id, nombreComercial: 'Victima', cantidadRecibida: 50, cantidadOC: 50, unidad: 'L' }],
    }, { fincaId: fincaAtacante });

    expect(res.status).toBe(400);
    expect(await getStock(victimaRef)).toBe(100); // intacto
    // No se creó recepción en la finca atacante.
    const recs = await db.collection('recepciones').where('fincaId', '==', fincaAtacante).get();
    expect(recs.empty).toBe(true);
  }, 30000);

  test('POST /api/recepciones acepta productoId propio e incrementa stock', async () => {
    const finca = uniqueFincaId('propia');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);

    const res = await post('/api/recepciones', {
      items: [{ productoId: ref.id, nombreComercial: 'Mio', cantidadRecibida: 50, cantidadOC: 50, unidad: 'L' }],
    }, { fincaId: finca });

    expect(res.status).toBe(201);
    expect(await getStock(ref)).toBe(150);
  }, 30000);

  test('POST /api/compras/confirmar rechaza productoId de otra finca y no toca su stock', async () => {
    const fincaVictima = uniqueFincaId('victima2');
    const fincaAtacante = uniqueFincaId('atacante2');
    fincas.push(fincaVictima, fincaAtacante);
    const victimaRef = await seedProducto(fincaVictima, 100);

    const res = await post('/api/compras/confirmar', {
      proveedor: 'X',
      lineas: [{ productoId: victimaRef.id, nombreComercial: 'Victima', cantidadIngresada: 50, unidad: 'L' }],
    }, { fincaId: fincaAtacante });

    expect(res.status).toBe(400);
    expect(await getStock(victimaRef)).toBe(100); // intacto
    const compras = await db.collection('compras').where('fincaId', '==', fincaAtacante).get();
    expect(compras.empty).toBe(true);
  }, 30000);

  test('POST /api/compras/confirmar acepta productoId propio e incrementa stock', async () => {
    const finca = uniqueFincaId('propia2');
    fincas.push(finca);
    const ref = await seedProducto(finca, 100);

    const res = await post('/api/compras/confirmar', {
      proveedor: 'X',
      lineas: [{ productoId: ref.id, nombreComercial: 'Mio', cantidadIngresada: 50, unidad: 'L' }],
    }, { fincaId: finca });

    expect(res.status).toBe(201);
    expect(await getStock(ref)).toBe(150);
  }, 30000);
});
