/**
 * Guardia del feature gate de Autopilot (FEATURES_ADVANCED).
 *
 * Hasta este test, nada en CI comprobaba que el flag gateara algo: los cinco
 * routers de autopilot estuvieron montados fuera del bloque isAdvanced() con
 * /api/autopilot/directives y /api/autopilot/feedback escribibles por
 * cualquier trabajador autenticado. Cuatro bloques:
 *
 *   1. Flag apagado → TODA ruta autopilot* da 404.
 *   2. Flag encendido → las mismas rutas NO dan 404 (si no, el bloque 1
 *      pasaría por vacuidad — p.ej. por un typo en el path del test).
 *   3. Inventario por recorrido del árbol de rutas: se descubren los paths
 *      leyendo los routers autopilot* de functions/routes — un router nuevo
 *      montado fuera del gate aparece acá y falla el bloque 1 sin que nadie
 *      tenga que acordarse de actualizar una lista.
 *   4. Exports de crons: autopilotMonitor y los avanzados no se exportan con
 *      el flag apagado; los de v1 (reminders, hrMonthlyScoring) siempre.
 *
 * IMPORTANTE: APP_CHECK_MODE='off' se setea ANTES del require — el módulo
 * congela el modo al cargarse. Sin eso todo devuelve 401 en vez de 404 y el
 * test miente.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');

// ── Inventario de rutas autopilot* por introspección de los routers ────────
function collectRoutes(router, out) {
  for (const layer of router.stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods).filter((m) => m !== '_all');
      for (const p of paths) for (const m of methods) out.push({ path: p, method: m.toUpperCase() });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collectRoutes(layer.handle, out);
    }
  }
  return out;
}

function autopilotRouteInventory() {
  const entries = fs.readdirSync(ROUTES_DIR).filter((n) => n.startsWith('autopilot'));
  const routes = [];
  for (const entry of entries) {
    collectRoutes(require(path.join(ROUTES_DIR, entry)), routes);
  }
  const seen = new Set();
  return routes
    .map((r) => ({ ...r, url: r.path.replace(/:[A-Za-z0-9_]+\??/g, 'test-id') }))
    .filter((r) => {
      const k = `${r.method} ${r.url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// ── Carga de la app con el flag controlado ─────────────────────────────────
const ORIGINAL_ADV = process.env.FEATURES_ADVANCED;
const ORIGINAL_ACM = process.env.APP_CHECK_MODE;

function loadApi(advanced) {
  process.env.APP_CHECK_MODE = 'off'; // ANTES del require: el modo se congela al cargar
  process.env.FEATURES_ADVANCED = advanced ? 'true' : 'false';
  let mod;
  jest.isolateModules(() => { mod = require('../../index.js'); });
  return mod;
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve(server));
  });
}

async function probe(baseUrl, { method, url }) {
  const res = await fetch(`${baseUrl}${url}`, { method });
  await res.arrayBuffer(); // drenar el body
  return res.status;
}

describe('feature gate de autopilot', () => {
  let logSpy;
  beforeAll(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterAll(() => {
    logSpy.mockRestore();
    if (ORIGINAL_ADV === undefined) delete process.env.FEATURES_ADVANCED;
    else process.env.FEATURES_ADVANCED = ORIGINAL_ADV;
    if (ORIGINAL_ACM === undefined) delete process.env.APP_CHECK_MODE;
    else process.env.APP_CHECK_MODE = ORIGINAL_ACM;
  });

  const inventory = autopilotRouteInventory();

  test('el inventario de rutas no está vacío (sanidad del recorrido)', () => {
    expect(inventory.length).toBeGreaterThanOrEqual(20);
    expect(inventory.some((r) => r.url === '/api/autopilot/directives')).toBe(true);
    expect(inventory.some((r) => r.url === '/api/autopilot/feedback')).toBe(true);
    expect(inventory.some((r) => r.url === '/api/autopilot/command')).toBe(true);
  });

  test('flag APAGADO: toda ruta autopilot* responde 404', async () => {
    const { api } = loadApi(false);
    const server = await startServer(api);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const route of inventory) {
        const status = await probe(baseUrl, route);
        if (status !== 404) {
          throw new Error(
            `${route.method} ${route.url} respondió ${status} con FEATURES_ADVANCED=false — ` +
            'hay un router autopilot montado fuera del bloque isAdvanced() en functions/index.js.'
          );
        }
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  }, 60000);

  test('flag ENCENDIDO: las mismas rutas existen (no-vacuidad: nada da 404)', async () => {
    const { api } = loadApi(true);
    const server = await startServer(api);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const route of inventory) {
        const status = await probe(baseUrl, route);
        if (status === 404) {
          throw new Error(
            `${route.method} ${route.url} dio 404 con FEATURES_ADVANCED=true — ` +
            'el bloque del flag apagado estaría pasando por vacuidad.'
          );
        }
      }
      // Sin token de auth (y App Check off), el primer middleware real es
      // authenticate: el gate encendido debe dejar pasar hasta el 401.
      expect(await probe(baseUrl, { method: 'GET', url: '/api/autopilot/directives' })).toBe(401);
    } finally {
      await new Promise((r) => server.close(r));
    }
  }, 60000);

  test('crons: los avanzados (incluido autopilotMonitor) solo con el flag encendido', () => {
    const off = loadApi(false);
    expect(off.autopilotMonitor).toBeUndefined();
    expect(off.signalsIngestCron).toBeUndefined();
    expect(off.annualPlanActivator).toBeUndefined();
    expect(off.metaKpiSweep).toBeUndefined();
    expect(off.metaTrustRecompute).toBeUndefined();
    expect(off.metaOrchestratorTick).toBeUndefined();
    // v1 siempre
    expect(off.sendDuePushReminders).toBeDefined();
    expect(off.hrMonthlyScoring).toBeDefined();
    expect(off.api).toBeDefined();

    const on = loadApi(true);
    expect(on.autopilotMonitor).toBeDefined();
    expect(on.signalsIngestCron).toBeDefined();
    expect(on.annualPlanActivator).toBeDefined();
    expect(on.metaKpiSweep).toBeDefined();
    expect(on.metaTrustRecompute).toBeDefined();
    expect(on.metaOrchestratorTick).toBeDefined();
  }, 60000);
});
