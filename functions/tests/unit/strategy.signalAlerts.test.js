// Unit tests for signalAlerts. Pure.

const {
  detectAlerts,
  detectWeatherAlerts,
  detectPriceAlerts,
  ALERT_CODES,
} = require('../../lib/strategy/signalAlerts');

describe('detectWeatherAlerts', () => {
  test('flood warning when rainfall >= threshold', () => {
    const out = detectWeatherAlerts({
      sourceId: 's1', observedAt: '2024-05-01',
      metadata: { rainfallMm24h: 60 },
    }, { rainfallMm24h: 50 });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe(ALERT_CODES.FLOOD_RISK);
    expect(out[0].severity).toBe('warn');
  });

  test('flood critical when rainfall >= 1.5x threshold', () => {
    const out = detectWeatherAlerts({
      sourceId: 's1', observedAt: '2024-05-01',
      metadata: { rainfallMm24h: 100 },
    }, { rainfallMm24h: 50 });
    expect(out[0].severity).toBe('critical');
  });

  test('cold alert when tempMin <= threshold', () => {
    const out = detectWeatherAlerts({
      sourceId: 's1', observedAt: '2024-12-01',
      metadata: { tempMinC: -2 },
    }, { tempMinC: -1 });
    expect(out[0].code).toBe(ALERT_CODES.COLD_RISK);
  });

  test('heat alert when tempMax >= threshold', () => {
    const out = detectWeatherAlerts({
      sourceId: 's1', observedAt: '2024-07-15',
      metadata: { tempMaxC: 42 },
    }, { tempMaxC: 40 });
    expect(out[0].code).toBe(ALERT_CODES.HEAT_RISK);
  });

  test('no alerts when below all thresholds', () => {
    const out = detectWeatherAlerts({
      sourceId: 's1', observedAt: '2024-05-01',
      metadata: { rainfallMm24h: 10, tempMinC: 5, tempMaxC: 25 },
    }, { rainfallMm24h: 50, tempMinC: -1, tempMaxC: 40 });
    expect(out).toHaveLength(0);
  });

  test('missing metadata produces no alerts', () => {
    const out = detectWeatherAlerts(
      { sourceId: 's1', observedAt: '2024-05-01' },
      { rainfallMm24h: 50 },
    );
    expect(out).toHaveLength(0);
  });

  test('missing thresholds disables the rule', () => {
    const out = detectWeatherAlerts(
      { sourceId: 's1', observedAt: '2024-05-01', metadata: { rainfallMm24h: 999 } },
      {},
    );
    expect(out).toHaveLength(0);
  });
});

describe('detectPriceAlerts', () => {
  const base = {
    sourceId: 's1',
    signalType: 'commodity_price',
    observedAt: '2024-06-01',
    value: 90,
  };
  const prev = {
    sourceId: 's1',
    signalType: 'commodity_price',
    observedAt: '2024-05-25',
    value: 100,
  };

  test('drop alert when price falls >= dropPct', () => {
    const out = detectPriceAlerts(base, [prev], { dropPct: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe(ALERT_CODES.PRICE_DROP);
    expect(out[0].deltaPct).toBe(-10);
  });

  test('critical drop when fall >= 2x threshold', () => {
    const out = detectPriceAlerts({ ...base, value: 70 }, [prev], { dropPct: 10 });
    expect(out[0].severity).toBe('critical');
    expect(out[0].deltaPct).toBe(-30);
  });

  test('rise alert when price climbs >= risePct', () => {
    const out = detectPriceAlerts({ ...base, value: 120 }, [prev], { risePct: 15 });
    expect(out[0].code).toBe(ALERT_CODES.PRICE_RISE);
    expect(out[0].deltaPct).toBe(20);
  });

  test('no alert within band', () => {
    const out = detectPriceAlerts({ ...base, value: 95 }, [prev], { dropPct: 10, risePct: 15 });
    expect(out).toHaveLength(0);
  });

  test('no alert when no previous signal', () => {
    expect(detectPriceAlerts(base, [], { dropPct: 10 })).toEqual([]);
  });

  test('ignores previous signals from other sources', () => {
    const otherPrev = { ...prev, sourceId: 'OTHER' };
    expect(detectPriceAlerts(base, [otherPrev], { dropPct: 5 })).toEqual([]);
  });

  test('uses most recent previous observation', () => {
    const older = { ...prev, observedAt: '2024-05-01', value: 200 };
    const newer = { ...prev, observedAt: '2024-05-28', value: 100 };
    const out = detectPriceAlerts({ ...base, value: 90 }, [older, newer], { dropPct: 5 });
    expect(out[0].deltaPct).toBe(-10); // vs 100, not 200
  });
});

describe('detectAlerts dispatch', () => {
  test('routes weather signal to weather detector', () => {
    const out = detectAlerts({
      signal: {
        signalType: 'weather', sourceId: 's1', observedAt: '2024-05-01',
        metadata: { rainfallMm24h: 70 },
      },
      previousSignals: [],
      thresholds: { rainfallMm24h: 50 },
    });
    expect(out[0].code).toBe(ALERT_CODES.FLOOD_RISK);
  });

  test('routes price signal to price detector', () => {
    const out = detectAlerts({
      signal: { signalType: 'commodity_price', sourceId: 's1', observedAt: '2024-06-01', value: 80 },
      previousSignals: [
        { signalType: 'commodity_price', sourceId: 's1', observedAt: '2024-05-01', value: 100 },
      ],
      thresholds: { dropPct: 10 },
    });
    expect(out[0].code).toBe(ALERT_CODES.PRICE_DROP);
  });

  test('unknown signal type returns []', () => {
    const out = detectAlerts({ signal: { signalType: 'rumor', sourceId: 's1' } });
    expect(out).toEqual([]);
  });
});
