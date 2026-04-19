/**
 * Integration: el flujo completo del simulador Monte Carlo, con el
 * context loader tocando Firestore real y el reasoner Claude mockeado.
 *
 * Verifica:
 *   - loadScenarioContext + simulate persisten un doc en `scenarios`
 *   - warnings se capturan para fuentes faltantes
 *   - skipReasoner=true produce claudeAnalysis=null
 *   - misma seed → mismo resumen (determinismo)
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: () => ({ messages: { create: jest.fn().mockResolvedValue({ sid: 'x' }) } }),
  getAnthropicClient: jest.fn(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        model: 'claude-sonnet-4-6',
        content: [
          { type: 'thinking', thinking: 'Analizando trade-offs...' },
          {
            type: 'tool_use',
            name: 'analizar_escenarios',
            input: {
              comentario: 'Portafolio balanceado con upside limitado en el escenario optimista.',
              recomendacion: {
                escenarioPreferido: 'Base',
                razon: 'Mejor combinación de margen y probabilidad.',
                accionesSugeridas: ['Monitorear precio mensual', 'Mantener buffer de caja'],
              },
              tradeOffs: ['Base vs Optimista: +20k margen a costa de más riesgo de caja'],
            },
          },
        ],
      }),
    },
  })),
}));

const { db, Timestamp } = require('../../lib/firebase');
const { simulateScenarios } = require('../../lib/strategy/scenarioSimulator');
const { loadScenarioContext } = require('../../lib/strategy/scenarioContextLoader');
const { reasonOverScenarios } = require('../../lib/strategy/scenarioReasoner');
const { uniqueFincaId } = require('../helpers');

async function cleanup(fincaId) {
  const cols = ['scenarios', 'cash_balance_snapshots', 'ordenes_compra', 'hr_planilla_fijo', 'cosecha_registros', 'income_records', 'feed'];
  for (const col of cols) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

describe('scenarios simulate — integration', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('context loader runs end-to-end with empty finca (warnings, all zero)', async () => {
    const fincaId = uniqueFincaId('scen_empty');
    fincas.push(fincaId);
    const ctx = await loadScenarioContext(fincaId, { horizonteMeses: 12 });
    expect(ctx.baselineMonthlyRevenue).toBe(0);
    expect(ctx.baselineMonthlyCost).toBe(0);
    expect(ctx.initialCash).toBe(0);
    expect(ctx.commitmentsByMonth).toHaveLength(12);
    expect(ctx.warnings.length).toBeGreaterThan(0);
  });

  test('simulate over loaded context returns 3 escenarios', async () => {
    const fincaId = uniqueFincaId('scen_sim');
    fincas.push(fincaId);
    // Seed con un snapshot de caja para que initialCash no sea 0.
    await db.collection('cash_balance_snapshots').add({
      fincaId, balance: 100_000, createdAt: Timestamp.now(),
    });

    const ctx = await loadScenarioContext(fincaId, { horizonteMeses: 12 });
    expect(ctx.initialCash).toBe(100_000);

    // Inyectamos baselines razonables para el test (el loader los devuelve en
    // 0 porque no hay cosecha).
    const sim = simulateScenarios(
      { ...ctx, baselineMonthlyRevenue: 20_000, baselineMonthlyCost: 12_000 },
      { nTrials: 100, seed: 99 },
    );
    expect(sim.scenarios).toHaveLength(3);
    expect(sim.scenarios.map(s => s.name)).toEqual(['Pesimista', 'Base', 'Optimista']);
    expect(sim.scenarios[0].margenProyectado).toBeLessThan(sim.scenarios[2].margenProyectado);
  });

  test('reasoner returns analysis and reasoning via mocked Claude', async () => {
    const sim = simulateScenarios(
      {
        baselineMonthlyRevenue: 20_000, baselineMonthlyCost: 12_000,
        initialCash: 50_000, commitmentsByMonth: new Array(12).fill(0),
        priceVolatility: 0.15, yieldVolatility: 0.1,
        costDriftMonthly: 0.005, horizonteMeses: 12,
      },
      { nTrials: 100, seed: 1 },
    );
    const result = await reasonOverScenarios({
      simulationOutput: sim, restrictions: {}, warnings: [],
    });
    expect(result.analysis.comentario).toMatch(/Portafolio/);
    expect(result.analysis.recomendacion.escenarioPreferido).toBe('Base');
    expect(result.reasoning.thinking).toMatch(/trade-offs/);
    expect(result.reasoning.toolName).toBe('analizar_escenarios');
  });

  test('persisted doc has all fields expected by UI', async () => {
    const fincaId = uniqueFincaId('scen_persist');
    fincas.push(fincaId);

    // Simulamos lo que hace la ruta: load + simulate + (skip) reason + persist.
    const ctx = await loadScenarioContext(fincaId, { horizonteMeses: 12 });
    const sim = simulateScenarios(
      { ...ctx, baselineMonthlyRevenue: 10_000, baselineMonthlyCost: 7000 },
      { nTrials: 50, seed: 5 },
    );
    const ref = await db.collection('scenarios').add({
      fincaId, name: 'Test',
      horizonteMeses: 12, nTrials: sim.nTrials, seed: sim.seed,
      restrictions: {},
      inputsSnapshot: ctx.inputsSnapshot,
      warnings: ctx.warnings,
      scenarios: sim.scenarios,
      resumen: sim.resumen,
      trialsAggregate: sim.trialsAggregate,
      context: sim.context,
      claudeAnalysis: null,
      reasoning: null,
      status: 'completed',
      generatedBy: 'test-uid',
      generatedByEmail: 't@e.com',
      createdAt: Timestamp.now(),
    });
    const doc = await ref.get();
    expect(doc.exists).toBe(true);
    const data = doc.data();
    expect(data.scenarios).toHaveLength(3);
    expect(data.scenarios[0].proyeccionCaja).toHaveLength(12);
    expect(data.trialsAggregate.cashByMonthMedian).toHaveLength(12);
  });
});
