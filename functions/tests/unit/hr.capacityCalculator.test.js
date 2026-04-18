// Unit tests for capacityCalculator. Pure.

const {
  currentCapacity,
  weeklyHoursFromHorario,
  DEFAULT_FALLBACK_WEEKLY_HOURS,
  MAX_WEEKLY_HOURS,
} = require('../../lib/hr/capacityCalculator');

const FULL_WEEK_HORARIO = {
  lunes:    { activo: true, inicio: '07:00', fin: '15:00' },
  martes:   { activo: true, inicio: '07:00', fin: '15:00' },
  miercoles:{ activo: true, inicio: '07:00', fin: '15:00' },
  jueves:   { activo: true, inicio: '07:00', fin: '15:00' },
  viernes:  { activo: true, inicio: '07:00', fin: '15:00' },
  sabado:   { activo: false },
  domingo:  { activo: false },
};

describe('weeklyHoursFromHorario', () => {
  test('sums active weekdays correctly (5 × 8h = 40h)', () => {
    expect(weeklyHoursFromHorario(FULL_WEEK_HORARIO)).toBe(40);
  });

  test('falls back when horario is absent or non-object', () => {
    expect(weeklyHoursFromHorario(null)).toBe(DEFAULT_FALLBACK_WEEKLY_HOURS);
    expect(weeklyHoursFromHorario(undefined)).toBe(DEFAULT_FALLBACK_WEEKLY_HOURS);
    expect(weeklyHoursFromHorario('not-an-object')).toBe(DEFAULT_FALLBACK_WEEKLY_HOURS);
  });

  test('falls back when no days are active', () => {
    const horario = { lunes: { activo: false } };
    expect(weeklyHoursFromHorario(horario)).toBe(DEFAULT_FALLBACK_WEEKLY_HOURS);
  });

  test('ignores malformed time strings', () => {
    const horario = {
      lunes:  { activo: true, inicio: '07:00', fin: '15:00' },
      martes: { activo: true, inicio: 'bad',  fin: '15:00' },
    };
    expect(weeklyHoursFromHorario(horario)).toBe(8); // only lunes counts
  });

  test('clamps absurd schedules to MAX_WEEKLY_HOURS', () => {
    const allDay = {
      lunes:    { activo: true, inicio: '00:00', fin: '23:59' },
      martes:   { activo: true, inicio: '00:00', fin: '23:59' },
      miercoles:{ activo: true, inicio: '00:00', fin: '23:59' },
      jueves:   { activo: true, inicio: '00:00', fin: '23:59' },
      viernes:  { activo: true, inicio: '00:00', fin: '23:59' },
      sabado:   { activo: true, inicio: '00:00', fin: '23:59' },
      domingo:  { activo: true, inicio: '00:00', fin: '23:59' },
    };
    expect(weeklyHoursFromHorario(allDay)).toBeLessThanOrEqual(MAX_WEEKLY_HOURS);
  });

  test('treats negative duration as 0 for that day', () => {
    const horario = {
      lunes: { activo: true, inicio: '15:00', fin: '07:00' }, // inverted
      martes:{ activo: true, inicio: '07:00', fin: '15:00' },
    };
    expect(weeklyHoursFromHorario(horario)).toBe(8);
  });
});

describe('currentCapacity', () => {
  test('empty input returns zeros and fallback avg', () => {
    const out = currentCapacity([]);
    expect(out.baselineWeeklyHours).toBe(0);
    expect(out.permanentCount).toBe(0);
    expect(out.avgWeeklyHoursPermanent).toBe(DEFAULT_FALLBACK_WEEKLY_HOURS);
  });

  test('only permanent contracts count toward baseline', () => {
    const fichas = [
      { userId: 'u1', tipoContrato: 'permanente', horarioSemanal: FULL_WEEK_HORARIO },
      { userId: 'u2', tipoContrato: 'temporal', horarioSemanal: FULL_WEEK_HORARIO },
      { userId: 'u3', tipoContrato: 'por_obra', horarioSemanal: FULL_WEEK_HORARIO },
    ];
    const out = currentCapacity(fichas);
    expect(out.permanentCount).toBe(1);
    expect(out.temporalCount).toBe(2);
    expect(out.baselineWeeklyHours).toBe(40);
    expect(out.surplusWeeklyHours).toBe(80);
  });

  test('ignores fichas without a recognized contract type', () => {
    const fichas = [
      { userId: 'u1', tipoContrato: 'unknown-type', horarioSemanal: FULL_WEEK_HORARIO },
    ];
    const out = currentCapacity(fichas);
    expect(out.permanentCount).toBe(0);
    expect(out.temporalCount).toBe(0);
    expect(out.baselineWeeklyHours).toBe(0);
  });

  test('computes average weekly hours across permanents', () => {
    const half = { ...FULL_WEEK_HORARIO, viernes: { activo: false } }; // 32h
    const fichas = [
      { userId: 'u1', tipoContrato: 'permanente', horarioSemanal: FULL_WEEK_HORARIO }, // 40
      { userId: 'u2', tipoContrato: 'permanente', horarioSemanal: half },                // 32
    ];
    const out = currentCapacity(fichas);
    expect(out.baselineWeeklyHours).toBe(72);
    expect(out.avgWeeklyHoursPermanent).toBe(36);
  });

  test('non-array input returns empty capacity', () => {
    const out = currentCapacity(null);
    expect(out.permanentCount).toBe(0);
  });
});
