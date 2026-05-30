import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo, resolveEventKey, avatarInitial } from '../feedFormat';

afterEach(() => vi.useRealTimers());

describe('timeAgo', () => {
  it('devuelve null para timestamps no numéricos (backend devuelve null)', () => {
    expect(timeAgo(null)).toBeNull();
    expect(timeAgo(undefined)).toBeNull();
    expect(timeAgo(NaN)).toBeNull();
  });

  it('formatea minutos/horas/días', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
    expect(timeAgo(Date.now() - 30_000)).toBe('ahora mismo');
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('hace 5 min');
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe('hace 3h');
    expect(timeAgo(Date.now() - 2 * 86_400_000)).toBe('hace 2d');
  });
});

describe('resolveEventKey', () => {
  it('prioriza autopilot, luego lote_created, luego activityType', () => {
    expect(resolveEventKey({ eventType: 'autopilot_analysis' })).toBe('autopilot_analysis');
    expect(resolveEventKey({ eventType: 'lote_created' })).toBe('lote_created');
    expect(resolveEventKey({ activityType: 'aplicacion' })).toBe('aplicacion');
    expect(resolveEventKey({})).toBe('notificacion');
  });
});

describe('avatarInitial', () => {
  it('usa engranaje para autopilot y la inicial del nombre en otro caso', () => {
    expect(avatarInitial({ eventType: 'autopilot_action_executed' })).toBe('⚙');
    expect(avatarInitial({ userName: 'maria' })).toBe('M');
    expect(avatarInitial({})).toBe('?');
  });
});
