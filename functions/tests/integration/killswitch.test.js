/**
 * Integration: kill switch defense-in-depth inside executeAutopilotAction.
 *
 * Even if a caller bypasses the HTTP middleware (cron, internal code), no
 * Autopilot-driven side effect runs while the finca is paused.
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: jest.fn(),
  getAnthropicClient: jest.fn(),
}));

const { executeAutopilotAction, AutopilotPausedError } = require('../../lib/autopilotActions');
const { pause, resume, isPaused, getStatus } = require('../../lib/autopilotKillSwitch');
const { uniqueFincaId, newActionContext, readAction, cleanupFinca } = require('../helpers');

describe('Kill switch gate on executeAutopilotAction', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupFinca)));

  test('throws AutopilotPausedError when finca is paused', async () => {
    const fincaId = uniqueFincaId('ks_paused');
    fincas.push(fincaId);
    await pause(fincaId, { uid: 'admin', userEmail: 'a@x', reason: 'test' });

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    await expect(executeAutopilotAction('crear_tarea', {
      nombre: 'x', fecha: '2026-05-01', productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc })).rejects.toBeInstanceOf(AutopilotPausedError);

    // No action doc was created (throw happens before the case handler runs)
    expect(await readAction(actionDocRef)).toBeNull();
  });

  test('resuming re-allows executions', async () => {
    const fincaId = uniqueFincaId('ks_resume');
    fincas.push(fincaId);
    await pause(fincaId, { uid: 'admin', userEmail: 'a@x' });
    await resume(fincaId, { uid: 'admin', userEmail: 'a@x' });

    expect(await isPaused(fincaId)).toBe(false);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId);
    const r = await executeAutopilotAction('crear_tarea', {
      nombre: 'x', fecha: '2026-05-01', productos: [],
    }, fincaId, { actionDocRef, actionInitialDoc });
    expect(r.ok).toBe(true);
  });

  test('pause() is idempotent: second call returns alreadyPaused', async () => {
    const fincaId = uniqueFincaId('ks_idempotent');
    fincas.push(fincaId);
    const a = await pause(fincaId, { uid: 'admin', userEmail: 'a@x' });
    expect(a.ok).toBe(true);
    const b = await pause(fincaId, { uid: 'admin', userEmail: 'a@x' });
    expect(b.ok).toBe(false);
    expect(b.alreadyPaused).toBe(true);
  });

  test('getStatus reflects reason and metadata', async () => {
    const fincaId = uniqueFincaId('ks_status');
    fincas.push(fincaId);
    await pause(fincaId, { uid: 'u-42', userEmail: 'x@y', reason: 'emergency stop' });
    const s = await getStatus(fincaId);
    expect(s.paused).toBe(true);
    expect(s.pausedBy).toBe('u-42');
    expect(s.pausedByEmail).toBe('x@y');
    expect(s.pausedReason).toBe('emergency stop');
  });
});
