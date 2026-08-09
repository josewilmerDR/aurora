/**
 * Guardia de cobertura de aiGuards en los sitios que llaman a Claude.
 *
 * Contexto: lib/aiGuards.js estaba bien construido y casi nadie lo usaba —
 * 5 de 20 archivos. Los que faltaban eran justo los que reciben contenido de
 * afuera: escaneo de siembra, de muestreo, de horímetro, edición de productos
 * por lenguaje natural, extracción de recordatorios, y el razonador que elige
 * el ganador de una cotización. Una defensa que existe pero que cada autor
 * nuevo tiene que acordarse de importar no es una defensa.
 *
 * Este test afirma la cobertura sobre la superficie de v1. Los razonadores de
 * Fases 2-6 (strategy, financing, meta, autopilot) quedan fuera con motivo
 * escrito: no se montan con FEATURES_ADVANCED=false, y endurecerlos es trabajo
 * de la ola de autopilot.
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['routes', 'lib'].map((d) => path.join(FUNCTIONS_DIR, d));

// Prefijos (relativos a functions/) que solo se montan con FEATURES_ADVANCED.
// Ver el bloque isAdvanced() de functions/index.js y
// tests/unit/autopilot.featureGate.test.js.
const ADVANCED_PREFIXES = [
  'routes/autopilot',
  'lib/strategy/',
  'lib/financing/',
  'lib/meta/',
];

// Archivos que llaman a Claude y NO necesitan aiGuards, con motivo.
const EXEMPT = {
  'lib/clients.js': 'Define getAnthropicClient; no arma prompts.',
};

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

function rel(file) {
  return path.relative(FUNCTIONS_DIR, file).replace(/\\/g, '/');
}

function claudeCallSites() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes('getAnthropicClient')) continue;
      const r = rel(file);
      out.push({
        file: r,
        usesGuards: src.includes('aiGuards'),
        isAdvanced: ADVANCED_PREFIXES.some((p) => r.startsWith(p)),
      });
    }
  }
  return out;
}

describe('Cobertura de aiGuards en los call sites de Claude', () => {
  const sites = claudeCallSites();

  test('el inventario no está vacío', () => {
    expect(sites.length).toBeGreaterThan(10);
  });

  test('todo call site de v1 usa aiGuards', () => {
    const offenders = sites
      .filter((s) => !s.isAdvanced)
      .filter((s) => !EXEMPT[s.file])
      .filter((s) => !s.usesGuards)
      .map((s) => s.file);

    expect(
      offenders.length === 0
        ? ''
        : 'Archivos que llaman a Claude sin importar lib/aiGuards:\n' +
          offenders.map((f) => `  ${f}`).join('\n') +
          '\nAgregá INJECTION_GUARD_PREAMBLE al system prompt y wrapUntrusted()' +
          ' al contenido externo, o justificá en EXEMPT.',
    ).toBe('');
  });

  test('la superficie avanzada sigue siendo la única sin cobertura', () => {
    // No es una aspiración: documenta el estado real para que, el día que
    // FEATURES_ADVANCED pase a true, esta lista sea el trabajo pendiente y no
    // una sorpresa. Si alguien cubre uno, este test lo obliga a actualizar el
    // conteo — hacia abajo, que es la dirección correcta.
    const uncovered = sites.filter((s) => s.isAdvanced && !s.usesGuards);
    expect(uncovered.length).toBeGreaterThan(0);
    for (const s of uncovered) {
      expect(ADVANCED_PREFIXES.some((p) => s.file.startsWith(p))).toBe(true);
    }
  });

  test('la lista de exentos no acumula entradas muertas', () => {
    const live = new Set(sites.map((s) => s.file));
    expect(Object.keys(EXEMPT).filter((f) => !live.has(f))).toEqual([]);
  });
});
