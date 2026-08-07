/**
 * Unit: hardening alrededor del probe de salud y del logging de requests.
 *
 *   1. requestLog/formatRequestLine nunca emiten VALORES de query — el deep
 *      link /task/:id pasa su token HMAC como ?t=... y con originalUrl el
 *      token quedaba en Cloud Logging.
 *   2. /api/_health está en PUBLIC_PATHS de App Check (en enforce, sin
 *      token, el probe pasa y cualquier otro path se corta con 401).
 *   3. El handler degradado responde 503 con db:'error' — sin filtrar el
 *      mensaje interno del fallo.
 */

describe('formatRequestLine — sin valores de query', () => {
  const { formatRequestLine } = require('../../lib/requestLog');

  test('loguea claves del query, nunca valores', () => {
    const line = formatRequestLine({
      method: 'GET',
      path: '/api/tasks/abc123',
      query: { t: 'SECRET-HMAC-TOKEN', page: '2' },
    });
    expect(line).toBe('GET /api/tasks/abc123?t,page');
    expect(line).not.toContain('SECRET-HMAC-TOKEN');
  });

  test('sin query no agrega ?', () => {
    expect(formatRequestLine({ method: 'GET', path: '/api/_health', query: {} }))
      .toBe('GET /api/_health');
  });
});

describe('App Check — /api/_health es público', () => {
  const ORIGINAL_MODE = process.env.APP_CHECK_MODE;
  const ORIGINAL_EMU = process.env.FUNCTIONS_EMULATOR;

  afterEach(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.APP_CHECK_MODE;
    else process.env.APP_CHECK_MODE = ORIGINAL_MODE;
    if (ORIGINAL_EMU === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = ORIGINAL_EMU;
  });

  // El módulo congela MODE al cargarse: setear el env ANTES del require.
  function loadEnforced() {
    process.env.APP_CHECK_MODE = 'enforce';
    delete process.env.FUNCTIONS_EMULATOR;
    let mod;
    jest.isolateModules(() => { mod = require('../../lib/appcheck'); });
    return mod;
  }

  function fakeRes() {
    return {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };
  }

  test('en enforce sin token, el probe pasa y otro path se corta con 401', async () => {
    const { verifyAppCheck } = loadEnforced();

    const nextHealth = jest.fn();
    await verifyAppCheck(
      { path: '/api/_health', header: () => undefined, method: 'GET' },
      fakeRes(),
      nextHealth
    );
    expect(nextHealth).toHaveBeenCalled();

    const nextOther = jest.fn();
    const res = fakeRes();
    await verifyAppCheck(
      { path: '/api/tasks', header: () => undefined, method: 'GET' },
      res,
      nextOther
    );
    expect(nextOther).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('health degradado', () => {
  test('Firestore inaccesible → 503, db:error, mismos cuatro campos', async () => {
    jest.resetModules();
    jest.doMock('../../lib/firebase', () => ({
      db: {
        databaseId: 'auroradatabase',
        collection: () => ({ limit: () => ({ get: () => Promise.reject(new Error('UNAVAILABLE: internal detail')) }) }),
      },
    }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const express = require('express');
      const healthRouter = require('../../routes/health');
      const app = express();
      app.use(healthRouter);
      const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/_health`);
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(Object.keys(body).sort()).toEqual(['db', 'revision', 'status', 'time']);
        expect(body.status).toBe('degraded');
        expect(body.db).toBe('error');
        expect(JSON.stringify(body)).not.toContain('UNAVAILABLE');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      errSpy.mockRestore();
      jest.dontMock('../../lib/firebase');
      jest.resetModules();
    }
  }, 30000);
});
