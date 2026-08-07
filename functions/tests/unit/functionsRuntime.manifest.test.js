/**
 * Guardia del manifiesto de deploy de exports.api (PR 7/9 Fase 0).
 *
 * El criterio del PR es un diff del manifiesto contra la línea base: los
 * campos de recursos pasan de null a los valores elegidos y NADA más
 * cambia. Este test congela ese contrato leyendo el __endpoint que el SDK
 * arma para el deploy:
 *
 *   1. El fallo silencioso del PR: agregar opciones a exports.api perdiendo
 *      `secrets: allSecrets`. Despliega bien, arranca bien, y en runtime
 *      todo lo de Claude y push falla por credenciales vacías. Acá
 *      se exige la lista COMPLETA de secrets.
 *   2. La región no se toca: fijar us-central1 es un no-op, pero cambiarla
 *      borra y recrea la función, cambia la URL y rompe el rewrite de
 *      firebase.json. Se exige que el código NO declare región.
 *   3. Recursos explícitos: 512MiB / 120s / maxInstances 10 (techo de gasto
 *      y de disponibilidad — al saturar, Cloud Run responde 429).
 *   4. Plataforma gcfv2 — el runtime es Gen 2 (la memoria del proyecto
 *      decía Gen 1; verificado por SDK v7, __endpoint.platform y CLAUDE.md).
 */

const { allSecrets } = require('../../lib/firebase');

function loadApi() {
  process.env.APP_CHECK_MODE = 'off';
  process.env.FEATURES_ADVANCED = 'false';
  let mod;
  jest.isolateModules(() => { mod = require('../../index.js'); });
  return mod;
}

describe('manifiesto de exports.api', () => {
  let logSpy;
  beforeAll(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterAll(() => { logSpy.mockRestore(); });

  test('recursos explícitos, sin región, secrets completos, Gen 2', () => {
    const { api } = loadApi();
    const ep = api.__endpoint;

    // (4) Gen 2
    expect(ep.platform).toBe('gcfv2');

    // (3) recursos elegidos
    expect(ep.availableMemoryMb).toBe(512);
    expect(ep.timeoutSeconds).toBe(120);
    expect(ep.maxInstances).toBe(10);

    // (2) región NO declarada en código (default us-central1 del deploy)
    expect(ep.region).toBeUndefined();

    // (1) la lista completa de secrets sobrevive a las opciones nuevas
    // (6 desde que se eliminaron los TWILIO_* junto con el canal WhatsApp)
    const declared = (ep.secretEnvironmentVariables || []).map(s => s.key).sort();
    const expected = allSecrets.map(s => s.name).sort();
    expect(declared).toEqual(expected);
    expect(declared.length).toBeGreaterThanOrEqual(6);
    expect(declared).toEqual(expect.arrayContaining([
      'ANTHROPIC_API_KEY', 'VAPID_PRIVATE_KEY', 'TASK_LINK_SECRET',
    ]));
  });
});
