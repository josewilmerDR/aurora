/**
 * Guardia de tiers de rate limit en los endpoints que llaman a Claude.
 *
 * El riesgo que cubre no es de confidencialidad, es de FACTURA. Los tiers de
 * lib/rateLimit.js difieren en dos órdenes de magnitud: 'write' permite 120
 * requests por minuto y 5000 por día, mientras 'ai_heavy' permite 20 y 300.
 * Poner un endpoint que razona con Claude en el tier 'write' deja un techo de
 * gasto de ~120 llamadas razonadas por minuto y por usuario — el límite está
 * puesto, se ve bien en el código, y no acota nada de lo que importa.
 *
 * Pasó de verdad: POST /api/rfqs/:id/close entró con tier 'write' en la
 * misma ola que agregó los límites, porque el CRUD de RFQ es 'write' y ese
 * endpoint parecía uno más — pero dispara reasonAboutRfqWinner, con thinking
 * habilitado. Este test existe para que la próxima vez falle el PR.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');
const AI_TIERS = ['ai_heavy', 'ai_medium', 'ai_light'];

// Prefijos que solo se montan con FEATURES_ADVANCED (ver isAdvanced() en
// functions/index.js). Fuera del alcance de v1.
const ADVANCED_PREFIXES = ['autopilot', 'strategy', 'signals', 'scenarios', 'annualPlans', 'financing', 'meta'];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/**
 * Un archivo de rutas "gasta IA" si él mismo llama a Claude, o si delega en un
 * módulo de lib/ que lo hace. Lo segundo es lo que hace falta detectar: el
 * caso de rfqs/index.js, donde el endpoint es una línea que apunta a un
 * handler y la llamada a Claude vive dos saltos más allá.
 */
function spendsOnAi(file, src) {
  if (src.includes('getAnthropicClient')) return true;
  // Handlers importados desde el mismo dominio: seguimos un nivel.
  const dir = path.dirname(file);
  for (const m of src.matchAll(/require\('\.\/([^']+)'\)/g)) {
    const sibling = path.join(dir, m[1].endsWith('.js') ? m[1] : `${m[1]}.js`);
    if (fs.existsSync(sibling) && fs.readFileSync(sibling, 'utf8').includes('reasonAbout')) return true;
  }
  return false;
}

describe('Tiers de rate limit en endpoints con gasto de IA', () => {
  const offenders = [];
  const checked = [];

  for (const file of walk(ROUTES_DIR)) {
    const relative = path.relative(ROUTES_DIR, file).replace(/\\/g, '/');
    if (ADVANCED_PREFIXES.some((p) => relative.startsWith(p))) continue;

    const src = fs.readFileSync(file, 'utf8');
    if (!spendsOnAi(file, src)) continue;

    // Endpoints del archivo cuyo nombre delata la operación de IA. Se limita a
    // los que nombran scan/escanear/close/ai/chat/parse para no exigir tier de
    // IA a los CRUD que conviven en el mismo archivo.
    const re = /router\.(post|patch)\(\s*(['"])([^'"]*(?:escanear|scan|ai-|chat|close|parse)[^'"]*)\2([^\n]*)/gi;
    for (const m of src.matchAll(re)) {
      const routePath = m[3];
      const defn = m[4];
      checked.push(routePath);
      const tier = AI_TIERS.find((t) => defn.includes(`'${t}'`));
      if (!tier) offenders.push(`${relative}  ${routePath}  →  ${defn.trim().slice(0, 80)}`);
    }
  }

  test('el inventario no está vacío', () => {
    expect(checked.length).toBeGreaterThan(3);
  });

  test('todo endpoint de IA usa un tier ai_*', () => {
    expect(
      offenders.length === 0
        ? ''
        : 'Endpoints que gastan tokens de Claude con un tier que no es ai_*:\n' +
          offenders.map((o) => `  ${o}`).join('\n') +
          "\nUsá 'ai_heavy' (razonamiento/thinking), 'ai_medium' (visión de un" +
          " disparo) o 'ai_light' (asistentes livianos).",
    ).toBe('');
  });
});
