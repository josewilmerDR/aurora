// Unit tests for external providers. No network calls (fetch is not invoked).

const openWeatherMap = require('../../lib/external/openWeatherMap');
const manualSignal = require('../../lib/external/manualSignal');
const { getProvider, listProviders } = require('../../lib/external');

describe('openWeatherMap.validateConfig', () => {
  test('accepts valid coords', () => {
    expect(openWeatherMap.validateConfig({ lat: 10.5, lon: -84.1 })).toBeNull();
  });
  test('rejects missing lat/lon', () => {
    expect(openWeatherMap.validateConfig({ lat: 10.5 })).toMatch(/lon/);
    expect(openWeatherMap.validateConfig({ lon: -84 })).toMatch(/lat/);
  });
  test('rejects out-of-range', () => {
    expect(openWeatherMap.validateConfig({ lat: 91, lon: 0 })).toMatch(/lat/);
    expect(openWeatherMap.validateConfig({ lat: 0, lon: 200 })).toMatch(/lon/);
  });
  test('rejects non-object', () => {
    expect(openWeatherMap.validateConfig(null)).toMatch(/config/);
  });
});

describe('openWeatherMap.normalizeOwmResponse', () => {
  test('maps temp, temp_min/max, and rain.1h', () => {
    const now = new Date('2024-07-15T10:00:00Z');
    const raw = {
      main: { temp: 25.3, temp_min: 19.1, temp_max: 31.7, humidity: 65 },
      rain: { '1h': 12.4 },
      name: 'Santa Cruz',
    };
    const out = openWeatherMap.normalizeOwmResponse(raw, { lat: 10, lon: -84 }, now);
    expect(out.value).toBe(25.3);
    expect(out.unit).toBe('°C');
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.observedAt).toBe('2024-07-15');
    expect(out.metadata.rainfallMm24h).toBe(12.4);
    expect(out.metadata.tempMinC).toBe(19.1);
    expect(out.metadata.tempMaxC).toBe(31.7);
    expect(out.metadata.humidity).toBe(65);
    expect(out.metadata.lat).toBe(10);
  });

  test('falls back to rain.3h when 1h is missing', () => {
    const out = openWeatherMap.normalizeOwmResponse(
      { main: { temp: 20 }, rain: { '3h': 9 } },
      { lat: 10, lon: 10 }, new Date('2024-01-01'),
    );
    expect(out.metadata.rainfallMm24h).toBe(9);
  });

  test('zero rainfall when no rain field', () => {
    const out = openWeatherMap.normalizeOwmResponse(
      { main: { temp: 20 } },
      { lat: 10, lon: 10 }, new Date('2024-01-01'),
    );
    expect(out.metadata.rainfallMm24h).toBe(0);
  });
});

describe('manualSignal.validateConfig', () => {
  test('accepts null/undefined/object', () => {
    expect(manualSignal.validateConfig(null)).toBeNull();
    expect(manualSignal.validateConfig(undefined)).toBeNull();
    expect(manualSignal.validateConfig({})).toBeNull();
  });
  test('rejects non-object', () => {
    expect(manualSignal.validateConfig('str')).toMatch(/object/);
    expect(manualSignal.validateConfig(42)).toMatch(/object/);
  });
});

describe('manualSignal.normalizeManualObservation', () => {
  test('normalizes a valid weather payload', () => {
    const out = manualSignal.normalizeManualObservation({
      signalType: 'weather',
      value: 22.5,
      unit: '°C',
      confidence: 0.9,
      observedAt: '2024-05-10',
      metadata: { source: 'field notes' },
      note: 'Día soleado',
    });
    expect(out.signalType).toBe('weather');
    expect(out.value).toBe(22.5);
    expect(out.confidence).toBe(0.9);
    expect(out.metadata.source).toBe('field notes');
    expect(out.metadata.note).toBe('Día soleado');
  });

  test('default confidence is 0.7 when missing', () => {
    const out = manualSignal.normalizeManualObservation({
      signalType: 'commodity_price', value: 100, unit: 'USD/kg', observedAt: '2024-01-01',
    });
    expect(out.confidence).toBe(0.7);
  });

  test('rejects invalid signalType', () => {
    expect(() => manualSignal.normalizeManualObservation({
      signalType: 'rumor', value: 1, unit: 'x', observedAt: '2024-01-01',
    })).toThrow(/signalType/);
  });

  test('rejects invalid observedAt', () => {
    expect(() => manualSignal.normalizeManualObservation({
      signalType: 'weather', value: 1, unit: 'x', observedAt: '15-01-2024',
    })).toThrow(/observedAt/);
  });

  test('rejects confidence out of range', () => {
    expect(() => manualSignal.normalizeManualObservation({
      signalType: 'weather', value: 1, unit: 'x', observedAt: '2024-01-01', confidence: 1.5,
    })).toThrow(/confidence/);
  });

  test('rejects oversized metadata', () => {
    expect(() => manualSignal.normalizeManualObservation({
      signalType: 'weather', value: 1, unit: 'x', observedAt: '2024-01-01',
      metadata: { big: 'x'.repeat(5000) },
    })).toThrow(/metadata/);
  });

  test('rejects non-finite value', () => {
    expect(() => manualSignal.normalizeManualObservation({
      signalType: 'weather', value: 'NaN', unit: 'x', observedAt: '2024-01-01',
    })).toThrow(/value/);
  });
});

describe('provider registry', () => {
  test('getProvider returns known providers', () => {
    expect(getProvider('openweathermap')).toBeTruthy();
    expect(getProvider('manual')).toBeTruthy();
  });
  test('getProvider returns null for unknown', () => {
    expect(getProvider('bogus')).toBeNull();
  });
  test('listProviders returns shape with supportsFetch flag', () => {
    const list = listProviders();
    const owm = list.find(p => p.id === 'openweathermap');
    const man = list.find(p => p.id === 'manual');
    expect(owm.supportsFetch).toBe(true);
    expect(man.supportsFetch).toBe(false);
  });
});
