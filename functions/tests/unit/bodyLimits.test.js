/**
 * Unit: request body limits (lib/bodyLimits.js).
 *
 * Protected:
 *   1. Ordinary endpoints reject bodies over 1mb with 413 — parsed by the
 *      app-level parser, nothing reaches the route.
 *   2. Large-body endpoints are NOT parsed at app level: an unauthenticated
 *      request with a 5mb body is rejected by auth (401) without the body
 *      ever being parsed; an authenticated one gets the full body.
 *   3. ":param" routes match exactly one segment.
 *   4. Guard: every route that mounts `largeJsonBody` is listed in
 *      LARGE_BODY_ROUTES and vice versa, and always after `authenticate` —
 *      half a registration silently reintroduces either the pre-auth parse
 *      or a 413 on a legitimate upload.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { LARGE_BODY_ROUTES, isLargeBodyPath, jsonBody, largeJsonBody } = require('../../lib/bodyLimits');

const MB = 1024 * 1024;
const bigBody = (mb) => JSON.stringify({ image: 'x'.repeat(mb * MB) });

// Minimal stand-in for `authenticate`: header present → pass, else 401.
const fakeAuth = (req, res, next) => (req.headers['x-auth'] ? next() : res.status(401).json({ error: 'unauth' }));

let server;
let baseUrl;
let parsedAtRoute;

beforeAll((done) => {
  const app = express();
  app.use(jsonBody);
  app.post('/api/tasks', fakeAuth, (req, res) => res.json({ len: JSON.stringify(req.body).length }));
  app.post('/api/chat', fakeAuth, largeJsonBody, (req, res) => {
    parsedAtRoute = true;
    res.json({ len: JSON.stringify(req.body).length });
  });
  app.post('/api/bodegas/:id/movimientos', fakeAuth, largeJsonBody, (req, res) => res.json({ id: req.params.id, len: JSON.stringify(req.body).length }));
  // Express default error handler would print the 413 stack; keep it quiet.
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type || 'error' })); // eslint-disable-line no-unused-vars
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

const post = (p, body, headers = {}) =>
  fetch(`${baseUrl}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('app-level parser (1mb)', () => {
  test('small body on an ordinary endpoint is parsed', async () => {
    const res = await post('/api/tasks', JSON.stringify({ a: 1 }), { 'x-auth': '1' });
    expect(res.status).toBe(200);
    expect((await res.json()).len).toBe(7);
  });

  test('2mb body on an ordinary endpoint → 413 before the route runs', async () => {
    const res = await post('/api/tasks', bigBody(2), { 'x-auth': '1' });
    expect(res.status).toBe(413);
  });
});

describe('large-body endpoints', () => {
  beforeEach(() => { parsedAtRoute = false; });

  test('anonymous 5mb body is rejected by auth, never parsed', async () => {
    const res = await post('/api/chat', bigBody(5));
    expect(res.status).toBe(401);
    expect(parsedAtRoute).toBe(false);
  });

  test('authenticated 5mb body is parsed by the route-level parser', async () => {
    const res = await post('/api/chat', bigBody(5), { 'x-auth': '1' });
    expect(res.status).toBe(200);
    expect((await res.json()).len).toBeGreaterThan(5 * MB);
    expect(parsedAtRoute).toBe(true);
  });

  test('authenticated 20mb body still exceeds the large limit → 413', async () => {
    const res = await post('/api/chat', bigBody(20), { 'x-auth': '1' });
    expect(res.status).toBe(413);
  });

  test(':param route gets the large parser too', async () => {
    const res = await post('/api/bodegas/b-1/movimientos', bigBody(3), { 'x-auth': '1' });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('b-1');
  });
});

describe('isLargeBodyPath', () => {
  test('exact and :param matches, nothing broader', () => {
    expect(isLargeBodyPath('/api/chat')).toBe(true);
    expect(isLargeBodyPath('/api/chat/history')).toBe(false);
    expect(isLargeBodyPath('/api/bodegas/abc/movimientos')).toBe(true);
    expect(isLargeBodyPath('/api/bodegas/abc/items')).toBe(false);
    expect(isLargeBodyPath('/api/bodegas/a/b/movimientos')).toBe(false);
    expect(isLargeBodyPath('/api/muestreos/ordenes/o1/complete')).toBe(true);
    expect(isLargeBodyPath('/api/tasks')).toBe(false);
  });
});

describe('guard: LARGE_BODY_ROUTES ⇔ routes mounting largeJsonBody', () => {
  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full, out);
      } else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const routesDir = path.join(__dirname, '..', '..', 'routes');
  // One router.<verb>('<path>', ...middlewares...) head, up to the handler's
  // opening `async (req`. Non-greedy so it cannot span two route definitions.
  const ROUTE_RE = /router\.(?:post|put|patch)\(\s*'([^']+)'([^;]*?)async \(req/gs;

  test('every usage is registered and every registration is used', () => {
    const used = new Set();
    for (const file of walk(routesDir)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('largeJsonBody')) continue;
      for (const m of src.matchAll(ROUTE_RE)) {
        if (m[2].includes('largeJsonBody')) used.add(m[1]);
      }
    }
    expect([...used].sort()).toEqual([...LARGE_BODY_ROUTES].sort());
  });

  test('largeJsonBody is always mounted after authenticate', () => {
    for (const file of walk(routesDir)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(ROUTE_RE)) {
        const chain = m[2];
        if (!chain.includes('largeJsonBody')) continue;
        expect(chain.indexOf('authenticate')).toBeGreaterThanOrEqual(0);
        expect(chain.indexOf('authenticate')).toBeLessThan(chain.indexOf('largeJsonBody'));
      }
    }
  });
});
