/**
 * Integration: captura de consentimiento legal en `POST /api/auth/register-finca`.
 *
 * Crear una organización es el momento en que nace la relación finca
 * (responsable) ↔ Aurora (encargado). El backend exige aceptación explícita
 * (aceptaTerminos === true + versión legal) y la persiste en el doc de la
 * finca, para poder demostrar después QUÉ versión aceptó cada cliente.
 *
 * Auth real mockeada: authenticateOnly deriva uid/email de headers.
 */

jest.mock('../../lib/clients', () => ({
  getAnthropicClient: jest.fn(),
}));

jest.mock('../../lib/middleware', () => ({
  authenticate: (req, res, next) => next(),
  authenticateOnly: (req, res, next) => {
    req.uid = req.headers['x-uid'] || 'test-uid';
    req.userEmail = `${req.uid}@example.com`;
    next();
  },
}));

const express = require('express');
const { db } = require('../../lib/firebase');

const authRouter = require('../../routes/auth');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

// uid único por test: el endpoint dedupea por (adminUid, nombre) y tiene cap
// por dueño, así que reutilizar uid entre corridas contaminaría los casos.
let seq = 0;
const freshUid = () => `legal-${Date.now()}-${seq++}`;

function post(body, uid) {
  return fetch(`${baseUrl}/api/auth/register-finca`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uid': uid },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register-finca — consentimiento legal', () => {
  test('sin aceptaTerminos → 400 TERMS_NOT_ACCEPTED y no crea la finca', async () => {
    const uid = freshUid();
    const res = await post({ fincaNombre: 'Finca Sin Consentimiento', nombreAdmin: 'Ana' }, uid);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');

    const owned = await db.collection('fincas').where('adminUid', '==', uid).get();
    expect(owned.empty).toBe(true);
  });

  test('aceptaTerminos=false también se rechaza', async () => {
    const res = await post(
      { fincaNombre: 'Finca False', nombreAdmin: 'Ana', aceptaTerminos: false, legalVersion: '2026-08-21' },
      freshUid(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');
  });

  test('versión legal malformada se rechaza', async () => {
    const res = await post(
      { fincaNombre: 'Finca Version', nombreAdmin: 'Ana', aceptaTerminos: true, legalVersion: 'v1' },
      freshUid(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');
  });

  test('con consentimiento → 201 y la finca guarda aceptacionLegal', async () => {
    const uid = freshUid();
    const res = await post(
      { fincaNombre: 'Finca Consentida', nombreAdmin: 'Ana', aceptaTerminos: true, legalVersion: '2026-08-21' },
      uid,
    );
    expect(res.status).toBe(201);
    const { fincaId } = await res.json();

    const finca = (await db.collection('fincas').doc(fincaId).get()).data();
    expect(finca.aceptacionLegal).toMatchObject({
      version: '2026-08-21',
      aceptadoPorUid: uid,
      email: `${uid}@example.com`,
    });
    expect(finca.aceptacionLegal.fecha).toBeTruthy();
  });
});
