/**
 * Guardia de los controles de rol en endpoints mutantes.
 *
 * Contexto: el proyecto tenía cuatro implementaciones locales del mismo guard
 * (analytics.js, annualPlans.js, field-records/helpers.js, harvest/validation.js).
 * Los dominios que se acordaron de escribir la suya quedaron protegidos; el
 * resto quedó con `authenticate` a secas, y siete DELETE terminaron siendo
 * ejecutables por un `trabajador` — borraba tipos de muestreo, calibraciones,
 * registros de muestreo y horímetro de TODA la finca. El aislamiento por finca
 * estaba bien; faltaba el escalón de rol.
 *
 * Este test es la defensa contra la regresión, no contra el bug de entonces:
 * un DELETE nuevo montado sin guard aparece acá y falla, sin que nadie tenga
 * que acordarse de revisarlo.
 *
 * Método: se leen los fuentes de routes/ y se parsea la definición de cada
 * `router.delete(...)`. Es análisis de texto, no introspección de Express,
 * porque lo que queremos afirmar es una propiedad del CÓDIGO ("la ruta declara
 * un guard"), no del runtime. La contrapartida está cubierta por el bloque 3,
 * que verifica que los nombres de guard que buscamos existen de verdad.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', '..', 'routes');

// Nombres que cuentan como guard de rol en la definición de una ruta. Incluye
// el guard compartido (lib/guards.js) y los locales que siguen vivos.
const GUARD_NAMES = [
  'requireRole',
  'requireEncargado',
  'requireSupervisor',
  'requireAdmin',
];

// Señales de que el ARCHIVO ejerce algún control de autorización más allá de
// la membresía. No alcanza con mirar la línea de la ruta: buena parte del
// código chequea rol o AUTORÍA dentro del handler —
// `if (docEncargadoId !== authUserId && !canActOnBehalf(req))` en
// hr/payroll-unit/*, `doc.uid !== req.uid` en reminders— y esos controles son
// más estrictos que un rol, no menos.
//
// Por qué a nivel de archivo y no de handler: el handler puede estar definido
// como función nombrada lejos de la ruta (deleteRfq, deletePlanillaUnidad),
// así que recortar "el bloque de la ruta" produce falsos positivos. La señal
// por archivo es deliberadamente más laxa, y aun así habría atrapado los siete
// agujeros originales: calibrations.js, equipment-hours.js, rfqs/index.js y
// los tres de monitoring/ no tenían NINGUNA de estas señales.
const AUTHZ_SIGNALS = [
  ...GUARD_NAMES,
  'hasMinRoleBE',
  'INSUFFICIENT_ROLE',
  'userRole',
  'canActOnBehalf',   // autoría + supervisor+, hr/payroll-unit
  'resolveAuthUserId',
];

// DELETEs que NO llevan control de autorización a propósito. Cada entrada
// exige un motivo — si agregás una acá sin poder escribir el porqué, el
// hallazgo es real.
const INTENTIONAL_NO_ROLE_GUARD = {
  '/api/reminders/:id':
    'Recordatorio personal: reminders.js compara doc.uid === req.uid, más estricto que un rol.',
  '/api/push/subscribe':
    'Suscripción push del propio dispositivo: webpush.js verifica uid + fincaId del doc antes de borrar.',
  '/api/autopilot/feedback':
    'Superficie de Fases 2-6: solo se monta con FEATURES_ADVANCED=true (ver index.js e ' +
    'tests/unit/autopilot.featureGate.test.js). Endurecerla es trabajo de la ola de autopilot, no de v1.',
  '/api/autopilot/directives/:id':
    'Ídem: detrás del feature gate isAdvanced(), no montado en v1.',
};

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** Extrae { file, routePath, definition } de cada router.delete(...) del repo. */
function collectDeleteRoutes() {
  const out = [];
  for (const file of walk(ROUTES_DIR)) {
    const src = fs.readFileSync(file, 'utf8');
    // La definición puede abarcar varias líneas (handler multilínea), así que
    // cortamos en el primer `async` / `=>` / cierre de paréntesis de la firma.
    const re = /router\.delete\(\s*(['"`])([^'"`]+)\1([^\n]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      out.push({
        file: path.relative(ROUTES_DIR, file).replace(/\\/g, '/'),
        routePath: m[2],
        definition: m[3],
        fileHasAuthzSignal: AUTHZ_SIGNALS.some((s) => src.includes(s)),
        line: src.slice(0, m.index).split('\n').length,
      });
    }
  }
  return out;
}

describe('Guardas de rol en endpoints DELETE', () => {
  const routes = collectDeleteRoutes();

  test('el inventario no está vacío (si no, el resto pasaría por vacuidad)', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  test('todo DELETE ejerce algún control de autorización, o está justificado', () => {
    const offenders = routes.filter(({ routePath, definition, fileHasAuthzSignal }) => {
      if (INTENTIONAL_NO_ROLE_GUARD[routePath]) return false;
      if (GUARD_NAMES.some((g) => definition.includes(g))) return false;
      return !fileHasAuthzSignal;
    });

    const detail = offenders
      .map((o) => `  ${o.file}:${o.line}  DELETE ${o.routePath}`)
      .join('\n');

    expect(
      offenders.length === 0
        ? ''
        : `DELETE sin ningún control de autorización más allá de la membresía.\n` +
          `Montá requireEncargado/requireSupervisor de lib/guards.js, o —si el control\n` +
          `correcto es autoría y no rol— dejalo explícito y justificá en\n` +
          `INTENTIONAL_NO_ROLE_GUARD:\n${detail}`,
    ).toBe('');
  });

  test('los seis endpoints endurecidos en esta ola declaran su guard en la ruta', () => {
    // Afirmación fuerte y puntual sobre lo que ESTE cambio arregló: acá no
    // alcanza la señal a nivel de archivo, el guard tiene que estar montado
    // como middleware en la definición. Si alguien lo saca, esto falla aunque
    // el archivo siga teniendo otras señales de autorización.
    const EXPECTED = {
      '/api/muestreos/tipos/:id': 'requireSupervisor',
      '/api/muestreos/:id': 'requireEncargado',
      '/api/muestreos/:id/registros/:regIdx': 'requireEncargado',
      '/api/muestreos/ordenes/:id': 'requireEncargado',
      '/api/calibraciones/:id': 'requireSupervisor',
      '/api/horimetro/:id': 'requireEncargado',
      '/api/rfqs/:id': 'requireEncargado',
    };
    for (const [routePath, guard] of Object.entries(EXPECTED)) {
      const route = routes.find((r) => r.routePath === routePath);
      expect(route ? `${routePath} → ${route.definition.includes(guard)}` : `${routePath} → NO EXISTE`)
        .toBe(`${routePath} → true`);
    }
  });

  test('la allowlist no acumula entradas muertas', () => {
    const live = new Set(routes.map((r) => r.routePath));
    const stale = Object.keys(INTENTIONAL_NO_ROLE_GUARD).filter((p) => !live.has(p));
    expect(stale).toEqual([]);
  });
});

describe('lib/guards.js', () => {
  const guards = require('../../lib/guards');

  test('exporta los guards que el inventario da por válidos', () => {
    for (const name of GUARD_NAMES) {
      expect(typeof guards[name]).toBe('function');
    }
  });

  test('un minRole inválido revienta al construir, no en runtime', () => {
    // hasMinRoleBE hace `ROLE_LEVELS_BE[minRole] || 0`: con un typo el nivel
    // exigido es 0 y `cualquierRol >= 0` es true — el guard queda montado, se
    // ve bien en el código y deja pasar a todo el mundo. Tiene que fallar el
    // require del router, no atender requests.
    expect(() => guards.requireRole('supervisior')).toThrow(/rol inválido/i);
    expect(() => guards.requireRole(undefined)).toThrow(/rol inválido/i);
  });

  test('deniega por debajo del escalón y deja pasar desde el escalón', () => {
    const run = (guard, userRole) => {
      const req = { userRole };
      let status = null;
      const res = { status: (s) => { status = s; return res; }, json: () => res };
      let passed = false;
      guard(req, res, () => { passed = true; });
      return { passed, status };
    };

    expect(run(guards.requireEncargado, 'trabajador').passed).toBe(false);
    expect(run(guards.requireEncargado, 'trabajador').status).toBe(403);
    expect(run(guards.requireEncargado, 'encargado').passed).toBe(true);
    expect(run(guards.requireEncargado, 'administrador').passed).toBe(true);

    expect(run(guards.requireSupervisor, 'encargado').passed).toBe(false);
    expect(run(guards.requireSupervisor, 'supervisor').passed).toBe(true);
    // rrhh vale 3 igual que supervisor: es la semántica existente del proyecto.
    expect(run(guards.requireSupervisor, 'rrhh').passed).toBe(true);
  });

  test('falla cerrado cuando authenticate no corrió (sin req.userRole)', () => {
    const req = {};
    let status = null;
    const res = { status: (s) => { status = s; return res; }, json: () => res };
    let passed = false;
    guards.requireEncargado(req, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(status).toBe(403);
  });
});
