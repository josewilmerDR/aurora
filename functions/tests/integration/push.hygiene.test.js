/**
 * Integration: higiene de suscripciones push (PR 9/9 Fase 0).
 *
 *   1. LA trampa del filtro: fetchLiveSubs debe incluir los docs SIN campo
 *      status (todas las suscripciones existentes) y excluir solo
 *      status === 'gone'. El filtro positivo — o un where('!=') de
 *      Firestore — dejaría a todos los usuarios actuales sin
 *      notificaciones, en silencio.
 *   2. La poda MARCA, no borra: 410/404 → status 'gone' + goneAt +
 *      goneStatusCode, y el doc sigue existiendo (la evidencia es el punto).
 *   3. Errores no-410/404 se loguean y la suscripción se conserva (antes el
 *      else vacío se tragaba todo).
 *   4. POST /subscribe registra `origin` (irrecuperable tras el cutover) y
 *      revive una suscripción marcada gone (set sin merge).
 *   5. GET /api/push/subscriptions/stats: vivas/gone por origen, con
 *      'desconocido' para docs legacy sin origin; supervisor+ únicamente.
 */

const mockPush = { behavior: new Map() };

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async (subscription) => {
    const mode = mockPush.behavior.get(subscription.endpoint) || 'ok';
    if (mode === 'gone') {
      const err = new Error('subscription expired');
      err.statusCode = 410;
      throw err;
    }
    if (mode === 'boom') {
      const err = new Error('upstream exploded');
      err.statusCode = 500;
      throw err;
    }
    return {};
  }),
}));

jest.mock('../../lib/middleware', () => ({
  authenticate: (req, res, next) => {
    req.uid = req.headers['x-uid'] || 'test-uid';
    req.userEmail = `${req.uid}@example.com`;
    req.fincaId = req.headers['x-finca-id'];
    req.userRole = req.headers['x-role'] || 'supervisor';
    next();
  },
  authenticateOnly: (req, res, next) => next(),
}));

const express = require('express');
const { db } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { fetchLiveSubs, sendPushToSubs } = require('../../lib/pushDelivery');

const webpushRouter = require('../../routes/webpush');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use(webpushRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

beforeEach(() => { mockPush.behavior.clear(); });

async function seedSub(fincaId, uid, endpoint, extra = {}) {
  const ref = db.collection('push_subscriptions').doc();
  await ref.set({ uid, fincaId, subscription: { endpoint, keys: {} }, ...extra });
  return ref;
}

async function cleanup(fincaId) {
  const snap = await db.collection('push_subscriptions').where('fincaId', '==', fincaId).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  if (snap.docs.length > 0) await batch.commit();
}

describe('pushDelivery — fetchLiveSubs (la trampa del filtro)', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('incluye docs legacy sin campo status; excluye solo status gone', async () => {
    const finca = uniqueFincaId('subs_filter');
    fincas.push(finca);
    await seedSub(finca, 'u1', 'https://push.example/legacy');            // sin status
    await seedSub(finca, 'u1', 'https://push.example/dead', { status: 'gone' });
    await seedSub(finca, 'u2', 'https://push.example/otra');             // otro uid

    const deU1 = await fetchLiveSubs(finca, 'u1');
    expect(deU1.map(d => d.data().subscription.endpoint)).toEqual(['https://push.example/legacy']);

    const deFinca = await fetchLiveSubs(finca);
    expect(deFinca).toHaveLength(2);
  }, 30000);
});

describe('pushDelivery — sendPushToSubs marca, no borra', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('410 → status gone + goneAt + goneStatusCode, el doc SIGUE existiendo', async () => {
    const finca = uniqueFincaId('subs_gone');
    fincas.push(finca);
    const okRef = await seedSub(finca, 'u1', 'https://push.example/ok');
    const deadRef = await seedSub(finca, 'u1', 'https://push.example/dead410');
    mockPush.behavior.set('https://push.example/dead410', 'gone');

    const subs = await fetchLiveSubs(finca, 'u1');
    const delivered = await sendPushToSubs(subs, { title: 'T', body: 'B' });

    expect(delivered).toBe(1);
    const deadAfter = await deadRef.get();
    expect(deadAfter.exists).toBe(true); // evidencia, no borrado
    expect(deadAfter.data().status).toBe('gone');
    expect(deadAfter.data().goneStatusCode).toBe(410);
    expect(deadAfter.data().goneAt).toBeDefined();
    expect((await okRef.get()).data().status).toBeUndefined();

    // La siguiente pasada ya no reintenta el endpoint muerto (sin este
    // filtro, el cron lo reintentaría cada cinco minutos para siempre).
    const subsAfter = await fetchLiveSubs(finca, 'u1');
    expect(subsAfter.map(d => d.data().subscription.endpoint)).toEqual(['https://push.example/ok']);
  }, 30000);

  test('error no-410/404 se loguea y la suscripción se conserva viva', async () => {
    const finca = uniqueFincaId('subs_err');
    fincas.push(finca);
    const ref = await seedSub(finca, 'u1', 'https://push.example/err500');
    mockPush.behavior.set('https://push.example/err500', 'boom');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const delivered = await sendPushToSubs(await fetchLiveSubs(finca, 'u1'), { title: 'T' });
      expect(delivered).toBe(0);
      expect(errSpy).toHaveBeenCalled();
      expect(String(errSpy.mock.calls[0][0])).toContain('500');
    } finally {
      errSpy.mockRestore();
    }
    expect((await ref.get()).data().status).toBeUndefined(); // sigue viva
  }, 30000);
});

describe('POST /api/push/subscribe — origin + revivir', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('registra origin del request y revive una suscripción gone', async () => {
    const finca = uniqueFincaId('subs_origin');
    fincas.push(finca);
    const endpoint = 'https://push.example/revive-me';
    const docId = Buffer.from(endpoint).toString('base64').slice(0, 500);
    // Pre-marcada como gone (endpoint podado en el pasado)
    await db.collection('push_subscriptions').doc(docId).set({
      uid: 'u1', fincaId: finca, subscription: { endpoint }, status: 'gone',
    });

    const res = await fetch(`${baseUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-finca-id': finca,
        'x-uid': 'u1',
        'origin': 'https://aurora.comunplace.com',
      },
      body: JSON.stringify({ subscription: { endpoint, keys: {} } }),
    });
    expect(res.status).toBe(200);

    const doc = (await db.collection('push_subscriptions').doc(docId).get()).data();
    expect(doc.origin).toBe('https://aurora.comunplace.com');
    expect(doc.status).toBeUndefined(); // set sin merge limpió la marca
  }, 30000);
});

describe('GET /api/push/subscriptions/stats', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('vivas/gone por origen con desconocido para legacy; encargado recibe 403', async () => {
    const finca = uniqueFincaId('subs_stats');
    fincas.push(finca);
    await seedSub(finca, 'u1', 'https://push.example/a', { origin: 'https://aurora-7dc9b.web.app' });
    await seedSub(finca, 'u1', 'https://push.example/b', { origin: 'https://aurora-7dc9b.web.app', status: 'gone' });
    await seedSub(finca, 'u2', 'https://push.example/c', { origin: 'https://aurora.comunplace.com' });
    await seedSub(finca, 'u3', 'https://push.example/d'); // legacy sin origin

    const forbidden = await fetch(`${baseUrl}/api/push/subscriptions/stats`, {
      headers: { 'x-finca-id': finca, 'x-role': 'encargado' },
    });
    expect(forbidden.status).toBe(403);

    const res = await fetch(`${baseUrl}/api/push/subscriptions/stats`, {
      headers: { 'x-finca-id': finca, 'x-role': 'supervisor' },
    });
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.total).toBe(4);
    expect(stats.vivas).toBe(3);
    expect(stats.gone).toBe(1);
    expect(stats.porOrigen['https://aurora-7dc9b.web.app']).toEqual({ vivas: 1, gone: 1 });
    expect(stats.porOrigen['https://aurora.comunplace.com']).toEqual({ vivas: 1, gone: 0 });
    expect(stats.porOrigen['desconocido']).toEqual({ vivas: 1, gone: 0 });
  }, 30000);
});
