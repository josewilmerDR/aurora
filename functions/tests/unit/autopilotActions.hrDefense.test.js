// Unit test for the HR-action defense layer in executeAutopilotAction.
//
// Verifies the 4th-layer cap (phase 3.0 plan): any call to the
// dispatcher with an HR action type must throw HrActionNotExecutableError
// with a useful message, NEVER fall through to the switch default
// ("Unknown action type"), and NEVER reach a side-effect handler.

jest.mock('../../lib/firebase', () => ({
  db: { collection: jest.fn() },
  Timestamp: { now: () => ({}) },
  twilioWhatsappFrom: '',
}));

jest.mock('../../lib/autopilotKillSwitch', () => ({
  isPaused: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../lib/clients', () => ({ getTwilioClient: jest.fn() }));

const {
  executeAutopilotAction,
  HrActionNotExecutableError,
} = require('../../lib/autopilotActions');
const { HR_ACTION_TYPES } = require('../../lib/hr/hrActionCaps');

describe('executeAutopilotAction — HR defense (phase 3.0 4th layer)', () => {
  test.each(HR_ACTION_TYPES)('rejects %s with HrActionNotExecutableError', async (actionType) => {
    await expect(
      executeAutopilotAction(actionType, {}, 'finca-test')
    ).rejects.toBeInstanceOf(HrActionNotExecutableError);
  });

  test('error carries the action type in .actionType', async () => {
    try {
      await executeAutopilotAction('sugerir_contratacion', {}, 'finca-test');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HrActionNotExecutableError);
      expect(err.actionType).toBe('sugerir_contratacion');
    }
  });

  test('error message is explicit, not the generic "Unknown action type"', async () => {
    try {
      await executeAutopilotAction('sugerir_despido', {}, 'finca-test');
      fail('should have thrown');
    } catch (err) {
      expect(err.message).not.toMatch(/Unknown action type/);
      expect(err.message).toMatch(/cannot be executed autonomously/);
    }
  });

  test('non-HR types still hit the switch (unknown type gets generic error)', async () => {
    await expect(
      executeAutopilotAction('tipo_que_no_existe', {}, 'finca-test')
    ).rejects.toThrow(/Unknown action type/);
  });
});
