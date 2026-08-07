/**
 * Integration: upload del escaneo en PATCH /api/muestreos/ordenes/:id/complete.
 *
 * Cubre la regresión del PR fix/storage-rules-deny-all: el token de descarga
 * debe ir en `metadata.metadata.firebaseStorageDownloadTokens` (anidado, como
 * los demás uploads del repo). Con el token a un solo nivel el objeto queda sin
 * metadata y la URL `?token=` no resuelve — con storage.rules en deny-all eso
 * significa imagen rota. Verifica:
 *   - path finca-scoped, bucket, contentType y buffer del objeto subido
 *   - token anidado correctamente + URL del monitoreo consistente con él
 *   - upload es best-effort: si Storage falla, la orden igual se completa
 *   - sin imagen no se toca Storage y scanImageUrl queda null
 *   - validaciones: media type no soportado (400) y tamaño excedido (413)
 *
 * Storage mockeado (el suite solo levanta el emulador de Firestore); auth real
 * mockeada: el middleware stub deriva fincaId/uid de headers.
 */

const mockStorage = { calls: [], failNext: false };

jest.mock('../../lib/clients', () => ({
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

jest.mock('../../lib/firebase', () => {
  const actual = jest.requireActual('../../lib/firebase');
  return {
    ...actual,
    admin: {
      storage: () => ({
        bucket: (bucketName) => ({
          file: (path) => ({
            save: async (buffer, options) => {
              if (mockStorage.failNext) {
                mockStorage.failNext = false;
                throw new Error('storage down');
              }
              mockStorage.calls.push({ bucketName, path, buffer, options });
            },
          }),
        }),
      }),
    },
  };
});

const express = require('express');
const { db, Timestamp, STORAGE_BUCKET } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');

const samplingRouter = require('../../routes/monitoring/sampling');

const SCAN_BASE64 = Buffer.from('fake-image-bytes').toString('base64');

let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use(samplingRouter);
  server = app.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll(() => new Promise((resolve) => server.close(() => resolve())));

beforeEach(() => {
  mockStorage.calls.length = 0;
  mockStorage.failNext = false;
});

function complete(ordenId, body, { fincaId, uid = 'test-uid' }) {
  return fetch(`${baseUrl}/api/muestreos/ordenes/${ordenId}/complete`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-finca-id': fincaId,
      'x-uid': uid,
    },
    body: JSON.stringify(body),
  });
}

async function seedOrden(fincaId, overrides = {}) {
  const ref = db.collection('scheduled_tasks').doc();
  await ref.set({
    fincaId,
    type: 'MUESTREO',
    status: 'pending',
    executeAt: Timestamp.now(),
    activity: { name: 'Muestreo plagas', formularios: [] },
    paqueteMuestreoId: 'pm-test',
    nota: '',
    ...overrides,
  });
  return ref;
}

async function readMonitoreo(ordenId) {
  const snap = await db.collection('monitoreos').where('ordenId', '==', ordenId).get();
  return snap.empty ? null : snap.docs[0].data();
}

async function cleanup(fincaId) {
  for (const col of ['scheduled_tasks', 'monitoreos']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('PATCH /api/muestreos/ordenes/:id/complete — scan upload', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanup)));

  test('sube el escaneo con token en metadata ANIDADA y URL consistente', async () => {
    const finca = uniqueFincaId('scan_ok');
    fincas.push(finca);
    const orden = await seedOrden(finca);

    const res = await complete(orden.id, {
      scanImageBase64: SCAN_BASE64,
      scanImageMediaType: 'image/png',
    }, { fincaId: finca });

    expect(res.status).toBe(200);
    expect(mockStorage.calls).toHaveLength(1);

    const call = mockStorage.calls[0];
    expect(call.bucketName).toBe(STORAGE_BUCKET);
    expect(call.path).toMatch(new RegExp(`^muestreos/${finca}/${orden.id}/scan_\\d+\\.jpg$`));
    expect(call.buffer.equals(Buffer.from(SCAN_BASE64, 'base64'))).toBe(true);
    expect(call.options.contentType).toBe('image/png');

    // Regresión metadata: el token va en metadata.metadata.* (metadata custom
    // del objeto GCS), no en metadata.* a secas — ahí no queda registrado y la
    // URL por token no resuelve.
    const token = call.options.metadata?.metadata?.firebaseStorageDownloadTokens;
    expect(token).toBeTruthy();
    expect(call.options.metadata.firebaseStorageDownloadTokens).toBeUndefined();

    const monitoreo = await readMonitoreo(orden.id);
    expect(monitoreo).not.toBeNull();
    expect(monitoreo.scanImageUrl).toContain(encodeURIComponent(call.path));
    expect(monitoreo.scanImageUrl).toContain(`token=${token}`);

    const taskAfter = (await orden.get()).data();
    expect(taskAfter.status).toBe('completed_by_user');
  }, 30000);

  test('sin media type usa image/jpeg por defecto', async () => {
    const finca = uniqueFincaId('scan_mime');
    fincas.push(finca);
    const orden = await seedOrden(finca);

    const res = await complete(orden.id, { scanImageBase64: SCAN_BASE64 }, { fincaId: finca });

    expect(res.status).toBe(200);
    expect(mockStorage.calls).toHaveLength(1);
    expect(mockStorage.calls[0].options.contentType).toBe('image/jpeg');
  }, 30000);

  test('sin imagen no toca Storage y scanImageUrl queda null', async () => {
    const finca = uniqueFincaId('scan_none');
    fincas.push(finca);
    const orden = await seedOrden(finca);

    const res = await complete(orden.id, { observaciones: 'sin foto' }, { fincaId: finca });

    expect(res.status).toBe(200);
    expect(mockStorage.calls).toHaveLength(0);

    const monitoreo = await readMonitoreo(orden.id);
    expect(monitoreo.scanImageUrl).toBeNull();
    expect(monitoreo.observaciones).toBe('sin foto');
  }, 30000);

  test('fallo de Storage es best-effort: completa la orden con scanImageUrl null', async () => {
    const finca = uniqueFincaId('scan_fail');
    fincas.push(finca);
    const orden = await seedOrden(finca);
    mockStorage.failNext = true;

    const res = await complete(orden.id, { scanImageBase64: SCAN_BASE64 }, { fincaId: finca });

    expect(res.status).toBe(200);
    const taskAfter = (await orden.get()).data();
    expect(taskAfter.status).toBe('completed_by_user');
    const monitoreo = await readMonitoreo(orden.id);
    expect(monitoreo).not.toBeNull();
    expect(monitoreo.scanImageUrl).toBeNull();
  }, 30000);

  test('media type no soportado → 400 y no sube nada', async () => {
    const finca = uniqueFincaId('scan_badmime');
    fincas.push(finca);
    const orden = await seedOrden(finca);

    const res = await complete(orden.id, {
      scanImageBase64: SCAN_BASE64,
      scanImageMediaType: 'application/pdf',
    }, { fincaId: finca });

    expect(res.status).toBe(400);
    expect(mockStorage.calls).toHaveLength(0);
    expect((await orden.get()).data().status).toBe('pending');
    expect(await readMonitoreo(orden.id)).toBeNull();
  }, 30000);

  test('imagen sobre el máximo → 413 y no sube nada', async () => {
    const finca = uniqueFincaId('scan_big');
    fincas.push(finca);
    const orden = await seedOrden(finca);
    const { MAX_SCAN_IMAGE_BASE64 } = require('../../routes/monitoring/helpers');

    const res = await complete(orden.id, {
      scanImageBase64: 'a'.repeat(MAX_SCAN_IMAGE_BASE64 + 1),
    }, { fincaId: finca });

    expect(res.status).toBe(413);
    expect(mockStorage.calls).toHaveLength(0);
    expect((await orden.get()).data().status).toBe('pending');
  }, 30000);

  test('orden de otra finca → 404 y no sube nada', async () => {
    const fincaA = uniqueFincaId('scan_owner');
    const fincaB = uniqueFincaId('scan_intruder');
    fincas.push(fincaA, fincaB);
    const orden = await seedOrden(fincaA);

    const res = await complete(orden.id, { scanImageBase64: SCAN_BASE64 }, { fincaId: fincaB });

    expect(res.status).toBe(404);
    expect(mockStorage.calls).toHaveLength(0);
    expect((await orden.get()).data().status).toBe('pending');
  }, 30000);
});
