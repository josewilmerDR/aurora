/**
 * Integration: signalsIngestor end-to-end con provider mockeado.
 *
 * Verifica:
 *   - ingest exitoso → doc en external_signals + fields de health actualizados
 *   - dedup dentro del minuto no crea duplicados
 *   - detección de FLOOD_RISK emite feed_event y llama push
 *   - fetch fallido incrementa consecutiveFailures y guarda lastError
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({ messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_test' }) } }),
  getAnthropicClient: jest.fn(),
}));

// Sustituimos el registry por uno controlado para el test.
jest.mock('../../lib/external', () => {
  const fakeProvider = {
    id: 'fake-weather',
    signalTypes: ['weather'],
    validateConfig: () => null,
    fetchSignal: jest.fn(),
  };
  return {
    __fake: fakeProvider,
    getProvider: (id) => (id === 'fake-weather' ? fakeProvider : null),
    listProviders: () => [{ id: 'fake-weather', signalTypes: ['weather'], supportsFetch: true }],
  };
});

const { db, Timestamp } = require('../../lib/firebase');
const external = require('../../lib/external');
const { ingestSource } = require('../../lib/strategy/signalsIngestor');
const { uniqueFincaId } = require('../helpers');

const fakeProvider = external.__fake;

async function seedSource(fincaId, overrides = {}) {
  const ref = db.collection('signal_sources').doc();
  const doc = {
    fincaId,
    name: 'test src',
    signalType: 'weather',
    provider: 'fake-weather',
    enabled: true,
    ingestIntervalDays: 1,
    config: { lat: 10, lon: -84 },
    alertThresholds: { rainfallMm24h: 50 },
    createdAt: Timestamp.now(),
    lastFetchedAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

async function cleanup(fincaId) {
  for (const col of ['signal_sources', 'external_signals', 'feed']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('ingestSource — integration', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });
  beforeEach(() => { fakeProvider.fetchSignal.mockReset(); });

  test('success path → signal persisted + source health updated + no alerts below threshold', async () => {
    const fincaId = uniqueFincaId('signals_ok');
    fincas.push(fincaId);
    const source = await seedSource(fincaId);

    fakeProvider.fetchSignal.mockResolvedValue({
      value: 24, unit: '°C', confidence: 0.85, observedAt: '2024-06-15',
      raw: { fake: true }, metadata: { rainfallMm24h: 5, tempMinC: 18, tempMaxC: 29 },
    });

    const writeFeedEvent = jest.fn();
    const sendPush = jest.fn();
    const result = await ingestSource({
      sourceDoc: source,
      apiKeyResolver: () => null,
      executor: { writeFeedEvent, sendPush },
    });

    expect(result.ok).toBe(true);
    expect(result.signalId).toBeDefined();
    expect(result.alerts).toEqual([]);
    expect(writeFeedEvent).not.toHaveBeenCalled();

    const signalSnap = await db.collection('external_signals').doc(result.signalId).get();
    expect(signalSnap.exists).toBe(true);
    expect(signalSnap.data().sourceId).toBe(source.id);
    expect(signalSnap.data().value).toBe(24);

    const sourceAfter = (await db.collection('signal_sources').doc(source.id).get()).data();
    expect(sourceAfter.lastError).toBeNull();
    expect(sourceAfter.consecutiveFailures).toBe(0);
    expect(sourceAfter.lastSuccessfulFetchAt).toBeDefined();
  });

  test('flood threshold emits a feed event + push', async () => {
    const fincaId = uniqueFincaId('signals_flood');
    fincas.push(fincaId);
    const source = await seedSource(fincaId);

    fakeProvider.fetchSignal.mockResolvedValue({
      value: 26, unit: '°C', confidence: 0.85, observedAt: '2024-06-15',
      raw: {}, metadata: { rainfallMm24h: 80 },
    });

    const writeFeedEvent = jest.fn();
    const sendPush = jest.fn();
    const result = await ingestSource({
      sourceDoc: source,
      apiKeyResolver: () => null,
      executor: { writeFeedEvent, sendPush },
    });

    expect(result.ok).toBe(true);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].code).toBe('FLOOD_RISK');
    expect(writeFeedEvent).toHaveBeenCalledTimes(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(sendPush.mock.calls[0][0]).toBe(fincaId);
  });

  test('same-minute re-ingest dedupes and does NOT duplicate signals', async () => {
    const fincaId = uniqueFincaId('signals_dedup');
    fincas.push(fincaId);
    const source = await seedSource(fincaId);

    fakeProvider.fetchSignal.mockResolvedValue({
      value: 20, unit: '°C', confidence: 0.85, observedAt: '2024-06-15',
      raw: {}, metadata: {},
    });
    const now = new Date('2024-06-15T10:00:00Z');
    const first = await ingestSource({
      sourceDoc: source, apiKeyResolver: () => null, now,
      executor: { writeFeedEvent: jest.fn(), sendPush: jest.fn() },
    });
    expect(first.ok).toBe(true);
    expect(first.dedup).toBeFalsy();

    const second = await ingestSource({
      sourceDoc: source, apiKeyResolver: () => null, now: new Date(now.getTime() + 30_000),
      executor: { writeFeedEvent: jest.fn(), sendPush: jest.fn() },
    });
    expect(second.ok).toBe(true);
    expect(second.dedup).toBe(true);
    expect(second.signalId).toBe(first.signalId);

    const signals = await db.collection('external_signals')
      .where('fincaId', '==', fincaId)
      .where('sourceId', '==', source.id)
      .get();
    expect(signals.size).toBe(1);
  });

  test('provider failure records lastError + increments consecutiveFailures', async () => {
    const fincaId = uniqueFincaId('signals_fail');
    fincas.push(fincaId);
    const source = await seedSource(fincaId);

    fakeProvider.fetchSignal.mockRejectedValue(Object.assign(
      new Error('timeout'),
      { code: 'PROVIDER_ERROR' }
    ));

    const result = await ingestSource({
      sourceDoc: source,
      apiKeyResolver: () => null,
      executor: { writeFeedEvent: jest.fn(), sendPush: jest.fn() },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('PROVIDER_ERROR');

    const sourceAfter = (await db.collection('signal_sources').doc(source.id).get()).data();
    expect(sourceAfter.lastError).toMatch(/timeout/);
    expect(sourceAfter.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });
});
