import { describe, it, expect } from 'vitest';
import { getTaskStatus, isCountableTask } from '../taskStatus';

describe('getTaskStatus', () => {
  const now = new Date('2026-05-30T12:00:00');

  it('marca completed cuando status es completed_by_user', () => {
    expect(getTaskStatus({ status: 'completed_by_user', dueDate: '2020-01-01' }, now)).toBe('completed');
  });

  it('marca overdue cuando la fecha es anterior a hoy', () => {
    expect(getTaskStatus({ dueDate: '2026-05-29' }, now)).toBe('overdue');
  });

  it('marca pending cuando vence hoy (mismo día, no vencida)', () => {
    expect(getTaskStatus({ dueDate: '2026-05-30T23:00:00' }, now)).toBe('pending');
  });

  it('marca pending cuando vence en el futuro', () => {
    expect(getTaskStatus({ dueDate: '2026-06-15' }, now)).toBe('pending');
  });

  it('no cuenta como overdue una dueDate inválida', () => {
    expect(getTaskStatus({ dueDate: undefined }, now)).toBe('pending');
    expect(getTaskStatus({ dueDate: 'no-es-fecha' }, now)).toBe('pending');
  });
});

describe('isCountableTask', () => {
  it('excluye recordatorios de 3 días y tareas saltadas', () => {
    expect(isCountableTask({ type: 'REMINDER_3_DAY' })).toBe(false);
    expect(isCountableTask({ status: 'skipped' })).toBe(false);
    expect(isCountableTask({ type: 'NORMAL', status: 'pending' })).toBe(true);
  });
});
