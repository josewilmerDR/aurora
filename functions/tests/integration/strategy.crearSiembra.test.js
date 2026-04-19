/**
 * Integration: crear_siembra happy path + compensation.
 *
 * Verifies:
 *   - executeAutopilotAction('crear_siembra', ...) creates a siembra doc
 *   - action doc ends as 'executed' with full outcome fields
 *   - compensation is 'available' with type 'marcar_siembra_cancelada'
 *   - rollback via applyRollback flags the siembra as cancelada + action as rolledBack
 */

// Mock Twilio/Anthropic — siembra ejecución no los invoca, pero el mock
// evita costes secundarios si se tocan durante el path común.
jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({
    messages: { create: jest.fn().mockResolvedValue({ sid: 'SM_test' }) },
  }),
  getAnthropicClient: jest.fn(),
}));

const { db } = require('../../lib/firebase');
const { executeAutopilotAction } = require('../../lib/autopilotActions');
const { applyRollback } = require('../../lib/autopilotCompensations');
const {
  uniqueFincaId,
  newActionContext,
  readAction,
  readCompensation,
} = require('../helpers');

// Seed mínimo: un lote y un paquete requeridos por crear_siembra.
async function seedLoteAndPaquete(fincaId) {
  const loteRef = db.collection('lotes').doc();
  await loteRef.set({
    fincaId,
    nombreLote: 'Lote de prueba 4.2',
    hectareas: 2,
    codigoLote: 'L42',
  });
  const paqueteRef = db.collection('packages').doc();
  await paqueteRef.set({
    fincaId,
    nombrePaquete: 'Paquete rotacion',
    tipoCosecha: 'I Cosecha',
    etapaCultivo: 'Desarrollo',
    activities: [],
  });
  return { loteId: loteRef.id, paqueteId: paqueteRef.id };
}

async function cleanupStrategyFixtures(fincaId) {
  const collections = [
    'siembras', 'lotes', 'packages',
    'autopilot_actions', 'autopilot_compensations',
  ];
  for (const name of collections) {
    const snap = await db.collection(name).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('executeAutopilotAction — crear_siembra', () => {
  const fincas = [];
  afterAll(async () => {
    await Promise.all(fincas.map(cleanupStrategyFixtures));
  });

  test('happy path creates siembra + action executed + compensation available', async () => {
    const fincaId = uniqueFincaId('crear_siembra');
    fincas.push(fincaId);

    const { loteId, paqueteId } = await seedLoteAndPaquete(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_siembra' });

    const result = await executeAutopilotAction('crear_siembra', {
      loteId,
      paqueteId,
      fecha: '2026-05-10',
      plantas: 1000,
      densidad: 500,
      razon: 'Prueba integración',
    }, fincaId, { actionDocRef, actionInitialDoc, level: 'nivel3' });

    expect(result.ok).toBe(true);
    expect(result.siembraId).toBeDefined();

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('executed');
    expect(action.executionResult.siembraId).toBe(result.siembraId);
    expect(typeof action.latencyMs).toBe('number');

    const siembraSnap = await db.collection('siembras').doc(result.siembraId).get();
    expect(siembraSnap.exists).toBe(true);
    const siembra = siembraSnap.data();
    expect(siembra.fincaId).toBe(fincaId);
    expect(siembra.loteId).toBe(loteId);
    expect(siembra.paqueteId).toBe(paqueteId);
    expect(siembra.createdByAutopilot).toBe(true);
    expect(siembra.cancelada).toBe(false);
    expect(siembra.cerrado).toBe(false);

    const comp = await readCompensation(actionDocRef.id, fincaId);
    expect(comp.compensationType).toBe('marcar_siembra_cancelada');
    expect(comp.params.siembraId).toBe(result.siembraId);
    expect(comp.status).toBe('available');
  });

  test('rollback marks siembra as cancelada and action as rolledBack', async () => {
    const fincaId = uniqueFincaId('siembra_rollback');
    fincas.push(fincaId);

    const { loteId, paqueteId } = await seedLoteAndPaquete(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_siembra' });

    const result = await executeAutopilotAction('crear_siembra', {
      loteId, paqueteId, fecha: '2026-06-15', plantas: 500, densidad: 250,
    }, fincaId, { actionDocRef, actionInitialDoc, level: 'nivel2' });

    const rollback = await applyRollback(
      actionDocRef.id, fincaId, { uid: 'admin-uid', email: 'admin@example.com' }
    );
    expect(rollback.ok).toBe(true);
    expect(rollback.result.ok).toBe(true);
    expect(rollback.result.siembraId).toBe(result.siembraId);

    const siembraAfter = (await db.collection('siembras').doc(result.siembraId).get()).data();
    expect(siembraAfter.cancelada).toBe(true);
    expect(siembraAfter.canceladaAt).toBeDefined();

    const actionAfter = await readAction(actionDocRef);
    expect(actionAfter.rolledBack).toBe(true);
    expect(actionAfter.rolledBackBy).toBe('admin-uid');

    // Segundo rollback debe bloquearse — la compensación quedó applied.
    const second = await applyRollback(
      actionDocRef.id, fincaId, { uid: 'admin-uid', email: 'admin@example.com' }
    );
    expect(second.ok).toBe(false);
    // La acción ya está rolledBack, por lo que el código es ACTION_ALREADY_ROLLED_BACK,
    // no COMPENSATION_ALREADY_APPLIED (la primera defensa gana).
    expect(second.code).toBe('ACTION_ALREADY_ROLLED_BACK');
  });

  test('rollback is blocked when siembra is already cerrada (cycle completed)', async () => {
    const fincaId = uniqueFincaId('siembra_blocked');
    fincas.push(fincaId);

    const { loteId, paqueteId } = await seedLoteAndPaquete(fincaId);
    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_siembra' });

    const result = await executeAutopilotAction('crear_siembra', {
      loteId, paqueteId, fecha: '2026-06-15', plantas: 500, densidad: 250,
    }, fincaId, { actionDocRef, actionInitialDoc, level: 'nivel3' });

    // Simulamos que la siembra ya fue cerrada por el equipo (p. ej., cosecha registrada).
    await db.collection('siembras').doc(result.siembraId).update({ cerrado: true });

    const rollback = await applyRollback(
      actionDocRef.id, fincaId, { uid: 'admin-uid', email: 'admin@example.com' }
    );
    expect(rollback.ok).toBe(false);
    expect(rollback.code).toBe('COMPENSATION_BLOCKED');
  });

  test('rejects missing required params', async () => {
    const fincaId = uniqueFincaId('siembra_missing');
    fincas.push(fincaId);

    const { actionDocRef, actionInitialDoc } = newActionContext(fincaId, { type: 'crear_siembra' });

    await expect(executeAutopilotAction('crear_siembra', {
      // loteId intencionalmente ausente
      paqueteId: 'any', fecha: '2026-06-15',
    }, fincaId, { actionDocRef, actionInitialDoc, level: 'nivel3' })).rejects.toThrow(/required/);

    const action = await readAction(actionDocRef);
    expect(action.status).toBe('failed');
  });
});
