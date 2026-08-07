/**
 * Integration: GET /api/_health.
 *
 * Contrato del probe: payload de EXACTAMENTE cuatro campos (status, db,
 * time, revision) — es público por definición, cualquier campo extra es
 * una filtración. `db` reporta el databaseId apuntado (verificación barata
 * de repunte post-restore, docs/firestore-backups.md). Sin auth, sin App
 * Check, sin rate limit.
 */

const express = require('express');
const { db } = require('../../lib/firebase');

const healthRouter = require('../../routes/health');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(healthRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

describe('GET /api/_health', () => {
  test('200 con exactamente {status, db, time, revision} y db = base nombrada', async () => {
    const res = await fetch(`${baseUrl}/api/_health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['db', 'revision', 'status', 'time']);
    expect(body.status).toBe('ok');
    expect(body.db).toBe(db.databaseId);
    expect(body.db).not.toBe('(default)');
    expect(new Date(body.time).getTime()).not.toBeNaN();
    expect(typeof body.revision).toBe('string');
  }, 30000);

  test('sin headers de auth ni App Check sigue respondiendo (probe público)', async () => {
    // El router se monta pelado (sin middleware) en este test, así que esto
    // documenta el contrato: el handler no debe exigir nada del request.
    const res = await fetch(`${baseUrl}/api/_health`, { headers: {} });
    expect(res.status).toBe(200);
  }, 30000);
});
