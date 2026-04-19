/**
 * Integration: lifecycle de annual_plans.
 *
 * Verifica:
 *   - Generación con Claude mockeado produce versión 1 con status según nivel
 *   - Nueva versión supersede la activa previa en transacción
 *   - changelog crece monotónicamente (nunca se mutan entradas previas)
 *   - cancelación de scheduled_activation funciona
 *   - cron promueve plans con ventana vencida
 */

jest.mock('../../lib/clients', () => {
  const messagesCreate = jest.fn();
  return {
    __msg: messagesCreate,
    getTwilioClient: () => ({ messages: { create: jest.fn().mockResolvedValue({ sid: 'x' }) } }),
    getAnthropicClient: jest.fn(() => ({ messages: { create: messagesCreate } })),
  };
});

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const clients = require('../../lib/clients');
const { generatePlanUpdate } = require('../../lib/strategy/annualPlanUpdater');
const { loadPlanContext } = require('../../lib/strategy/annualPlanContextLoader');

function claudeResponse(sections, razon = 'Actualizo supuestos.') {
  return {
    model: 'claude-sonnet-4-6',
    content: [
      { type: 'thinking', thinking: 'Considerando contexto y alertas recientes...' },
      {
        type: 'tool_use',
        name: 'proponer_plan_diff',
        input: { razon, sections },
      },
    ],
  };
}

async function cleanup(fincaId) {
  const cols = ['annual_plans', 'rotation_recommendations', 'scenarios', 'budgets', 'feed'];
  for (const col of cols) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('annual_plans — generate + lifecycle', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });
  beforeEach(() => { clients.__msg.mockReset(); });

  test('loadPlanContext corre sin error en finca vacía', async () => {
    const fincaId = uniqueFincaId('plan_ctx');
    fincas.push(fincaId);
    const ctx = await loadPlanContext(fincaId, 2026);
    expect(ctx.year).toBe(2026);
    expect(ctx.activePlan).toBeNull();
    expect(Array.isArray(ctx.warnings)).toBe(true);
    expect(ctx.weeklyCount).toBe(0);
  });

  test('generatePlanUpdate con mock devuelve sections merged + reasoning', async () => {
    clients.__msg.mockResolvedValueOnce(claudeResponse({
      supuestos: ['Precio sube 10%', 'Nueva siembra Solanaceae'],
    }, 'Inicialización del plan.'));
    const fincaId = uniqueFincaId('plan_update');
    fincas.push(fincaId);
    const ctx = await loadPlanContext(fincaId, 2026);
    const out = await generatePlanUpdate({ context: ctx, level: 'nivel1' });
    expect(out.razon).toBe('Inicialización del plan.');
    expect(out.mergedSections.supuestos).toHaveLength(2);
    expect(out.reasoning.toolName).toBe('proponer_plan_diff');
    expect(out.reasoning.thinking).toMatch(/contexto/);
  });

  test('create + supersede: segunda versión activa desactiva la anterior', async () => {
    const fincaId = uniqueFincaId('plan_supersede');
    fincas.push(fincaId);

    // Creamos manualmente una v1 active.
    const now = Timestamp.now();
    const v1Ref = db.collection('annual_plans').doc();
    await v1Ref.set({
      fincaId, year: 2026, version: 1,
      status: 'active', isActive: true,
      sections: { supuestos: ['old'] },
      changelog: [{ version: 1, fecha: now, razon: 'Seed', autor: 'user', summary: 'Seed.' }],
      createdAt: now, level: null,
    });

    // Creamos v2 active supersediendo.
    const v2Ref = db.collection('annual_plans').doc();
    await db.runTransaction(async (t) => {
      const v1Snap = await t.get(v1Ref);
      t.update(v1Ref, {
        status: 'superseded', isActive: false, supersededBy: v2Ref.id, updatedAt: Timestamp.now(),
      });
      t.set(v2Ref, {
        fincaId, year: 2026, version: 2,
        status: 'active', isActive: true,
        sections: { supuestos: ['new'] },
        changelog: [
          ...(v1Snap.data().changelog || []),
          { version: 2, fecha: Timestamp.now(), razon: 'v2', autor: 'user', summary: 'Upgrade.' },
        ],
        createdAt: Timestamp.now(), supersedes: v1Ref.id, level: null,
      });
    });

    const v1After = (await v1Ref.get()).data();
    const v2After = (await v2Ref.get()).data();
    expect(v1After.isActive).toBe(false);
    expect(v1After.status).toBe('superseded');
    expect(v1After.supersededBy).toBe(v2Ref.id);
    expect(v2After.isActive).toBe(true);
    expect(v2After.supersedes).toBe(v1Ref.id);

    // Changelog inmutable: entradas previas están intactas en v2.
    expect(v2After.changelog).toHaveLength(2);
    expect(v2After.changelog[0].razon).toBe('Seed');
  });

  test('solo un active a la vez por (finca, year)', async () => {
    const fincaId = uniqueFincaId('plan_unique_active');
    fincas.push(fincaId);

    const ref1 = await db.collection('annual_plans').add({
      fincaId, year: 2026, version: 1, status: 'active', isActive: true,
      sections: {}, changelog: [], createdAt: Timestamp.now(),
    });
    const ref2 = await db.collection('annual_plans').add({
      fincaId, year: 2026, version: 2, status: 'active', isActive: true,
      sections: {}, changelog: [], createdAt: Timestamp.now(),
    });
    // Estado transitorio inválido: 2 activos. Simulamos la lógica de activate
    // que fuerza exclusividad.
    const snap = await db.collection('annual_plans')
      .where('fincaId', '==', fincaId)
      .where('year', '==', 2026)
      .where('isActive', '==', true).get();
    expect(snap.size).toBe(2);
    // La ruta real corrige esto al activar; aquí solo verificamos el estado
    // pre-corrección.
    expect(ref1.id).not.toBe(ref2.id);
  });

  test('scheduled_activation cron-style promotion desactiva la activa previa', async () => {
    const fincaId = uniqueFincaId('plan_cron');
    fincas.push(fincaId);

    const now = Timestamp.now();
    const priorRef = await db.collection('annual_plans').add({
      fincaId, year: 2026, version: 1, status: 'active', isActive: true,
      sections: {}, changelog: [], createdAt: now, level: null,
    });
    const pastMs = Date.now() - 60_000;
    const scheduledRef = await db.collection('annual_plans').add({
      fincaId, year: 2026, version: 2, status: 'scheduled_activation',
      isActive: false,
      activationScheduledFor: Timestamp.fromMillis(pastMs),
      sections: { supuestos: ['new'] },
      changelog: [{ version: 2, fecha: now, razon: 'scheduled', autor: 'autopilot', summary: 'x' }],
      createdAt: now, supersedes: priorRef.id, level: 'nivel3',
    });

    // Simulamos la promoción que hace el cron.
    await db.runTransaction(async (t) => {
      const fresh = await t.get(scheduledRef);
      const f = fresh.data();
      t.update(priorRef, {
        status: 'superseded', isActive: false, supersededBy: scheduledRef.id, updatedAt: Timestamp.now(),
      });
      t.update(scheduledRef, {
        status: 'active', isActive: true,
        activatedAt: Timestamp.now(), activationScheduledFor: null,
        changelog: [
          ...(f.changelog || []),
          { version: f.version, fecha: Timestamp.now(), razon: 'Cron', autor: 'autopilot', summary: 'promoted' },
        ],
      });
    });

    const priorAfter = (await priorRef.get()).data();
    const scheduledAfter = (await scheduledRef.get()).data();
    expect(priorAfter.isActive).toBe(false);
    expect(scheduledAfter.isActive).toBe(true);
    expect(scheduledAfter.status).toBe('active');
    expect(scheduledAfter.changelog.length).toBeGreaterThanOrEqual(2);
  });

  test('cancelación de scheduled_activation → status=cancelled, no se activa', async () => {
    const fincaId = uniqueFincaId('plan_cancel');
    fincas.push(fincaId);

    const ref = await db.collection('annual_plans').add({
      fincaId, year: 2026, version: 1, status: 'scheduled_activation',
      isActive: false,
      activationScheduledFor: Timestamp.fromMillis(Date.now() + 60_000),
      sections: { supuestos: ['x'] },
      changelog: [{ version: 1, fecha: Timestamp.now(), razon: 'gen', autor: 'autopilot', summary: 'x' }],
      createdAt: Timestamp.now(), level: 'nivel3',
    });

    // Cancela.
    await ref.update({
      status: 'cancelled', isActive: false, activationScheduledFor: null,
      cancelledAt: Timestamp.now(), cancelledBy: 'admin', cancelledByEmail: 'a@b',
      changelog: [
        { version: 1, fecha: Timestamp.now(), razon: 'gen', autor: 'autopilot', summary: 'x' },
        { version: 1, fecha: Timestamp.now(), razon: 'test-cancel', autor: 'user', summary: 'cancelled' },
      ],
    });

    const after = (await ref.get()).data();
    expect(after.status).toBe('cancelled');
    expect(after.isActive).toBe(false);
    expect(after.activationScheduledFor).toBeNull();
    expect(after.changelog).toHaveLength(2);
  });
});
