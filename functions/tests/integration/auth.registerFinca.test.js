/**
 * Integration: legal consent capture in `POST /api/auth/register-finca`.
 *
 * Creating an organization is the moment the finca (controller) ↔ Aurora
 * (processor) relationship is born. The backend requires explicit acceptance
 * (acceptsTerms === true + legal version) and persists it on the finca doc,
 * so we can later prove WHICH version each customer accepted.
 *
 * Real auth mocked: authenticateOnly derives uid/email from headers.
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

// Unique uid per test: the endpoint dedupes by (adminUid, name) and caps
// orgs per owner, so reusing a uid across runs would contaminate the cases.
let seq = 0;
const freshUid = () => `legal-${Date.now()}-${seq++}`;

function post(body, uid) {
  return fetch(`${baseUrl}/api/auth/register-finca`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uid': uid },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register-finca — legal consent', () => {
  test('without acceptsTerms → 400 TERMS_NOT_ACCEPTED and no finca created', async () => {
    const uid = freshUid();
    const res = await post({ fincaNombre: 'Finca Sin Consentimiento', nombreAdmin: 'Ana' }, uid);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');

    const owned = await db.collection('fincas').where('adminUid', '==', uid).get();
    expect(owned.empty).toBe(true);
  });

  test('acceptsTerms=false is rejected too', async () => {
    const res = await post(
      { fincaNombre: 'Finca False', nombreAdmin: 'Ana', acceptsTerms: false, legalVersion: '2026-08-21' },
      freshUid(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');
  });

  test('malformed legal version is rejected', async () => {
    const res = await post(
      { fincaNombre: 'Finca Version', nombreAdmin: 'Ana', acceptsTerms: true, legalVersion: 'v1' },
      freshUid(),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('TERMS_NOT_ACCEPTED');
  });

  test('with consent → 201 and the finca stores legalAcceptance', async () => {
    const uid = freshUid();
    const res = await post(
      { fincaNombre: 'Finca Consentida', nombreAdmin: 'Ana', acceptsTerms: true, legalVersion: '2026-08-21' },
      uid,
    );
    expect(res.status).toBe(201);
    const { fincaId } = await res.json();

    const finca = (await db.collection('fincas').doc(fincaId).get()).data();
    expect(finca.legalAcceptance).toMatchObject({
      version: '2026-08-21',
      acceptedByUid: uid,
      email: `${uid}@example.com`,
    });
    expect(finca.legalAcceptance.acceptedAt).toBeTruthy();
  });
});
