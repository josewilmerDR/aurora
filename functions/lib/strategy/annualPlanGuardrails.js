// Guardrails puros para annual_plans. Aplicables a la creación de una
// versión nueva (manual o por Claude).
//
// Reglas:
//   G1 WEEKLY_CAP        — no más de N versiones nuevas en los últimos 7 días
//                          (default N=3). Evita "thrashing" del plan.
//   G2 LEVEL_SAFETY      — en N2, si el diff toca secciones sensibles
//                          (cultivos/rotaciones/presupuesto), la nueva versión
//                          queda como 'proposed', no como 'active'.
//                          En N3, TODAS las secciones se aplican pero con
//                          delay de activación (nunca inmediato).
//   G3 CHANGELOG_GROWS   — el changelog de la versión nueva debe contener
//                          al menos la entrada que describe este cambio.
//   G4 FORBIDDEN_SIDE_EFFECTS — el updater no puede "disparar" compras ni
//                          contrataciones desde el plan. Estas secciones
//                          existen en el plan pero sus ejecuciones quedan
//                          en las Fases 2 y 3 respectivamente.
//
// El guardian de compras/contrataciones se valida aquí solo a nivel de
// contenido del diff: si el diff propone `added/modified` en una sección
// reservada a otra fase, se bloquea.
//
// No incluye G4 automáticamente en este validador — se deja como función
// separada `checkForbiddenSideEffects` para que el caller decida cuándo
// aplicarla (se aplica siempre desde el updater de Claude; los creates
// manuales pueden ser más laxos si el usuario lo hace explícitamente).

const { SAFE_SECTIONS, SENSITIVE_SECTIONS } = require('./annualPlanValidator');

const DEFAULT_WEEKLY_CAP = 3;

// Fases de orden: weeklyCount / sectionsChanged / level / changelogEntry
function validateVersionCreation({
  weeklyCount = 0,
  maxWeeklyVersions = DEFAULT_WEEKLY_CAP,
  sectionsChanged = [],
  level = 'nivel1',      // 'nivel1' | 'nivel2' | 'nivel3' | 'manual'
  newChangelogEntry = null,
} = {}) {
  const violations = [];

  // G1 WEEKLY_CAP
  if (Number.isFinite(Number(weeklyCount)) && weeklyCount >= maxWeeklyVersions) {
    violations.push({
      code: 'WEEKLY_CAP',
      severity: 'block',
      message: `Ya hay ${weeklyCount} versiones creadas en los últimos 7 días (cap ${maxWeeklyVersions}).`,
    });
  }

  // G3 CHANGELOG_GROWS
  if (!newChangelogEntry || typeof newChangelogEntry !== 'object') {
    violations.push({
      code: 'CHANGELOG_GROWS',
      severity: 'block',
      message: 'La nueva versión debe incluir al menos una entrada en changelog describiendo el cambio.',
    });
  } else if (!newChangelogEntry.razon || String(newChangelogEntry.razon).trim().length === 0) {
    violations.push({
      code: 'CHANGELOG_GROWS',
      severity: 'block',
      message: 'La entrada del changelog requiere una razón no vacía.',
    });
  }

  // G2 LEVEL_SAFETY — decide el status de la versión resultante.
  const touchesSensitive = (sectionsChanged || []).some(s => SENSITIVE_SECTIONS.has(s));
  let resolvedStatus;
  if (level === 'nivel1') {
    // N1 nunca activa automáticamente: siempre 'proposed'.
    resolvedStatus = 'proposed';
  } else if (level === 'nivel2') {
    resolvedStatus = touchesSensitive ? 'proposed' : 'active';
  } else if (level === 'nivel3') {
    // N3 siempre va a 'scheduled_activation' (delay 24h); nunca inmediato.
    resolvedStatus = 'scheduled_activation';
  } else {
    // Manual: el caller decide; pasamos 'draft' como safe default.
    resolvedStatus = 'draft';
  }

  const blocking = violations.filter(v => v.severity === 'block');
  return {
    allowed: blocking.length === 0,
    violations,
    resolvedStatus,
    touchesSensitive,
  };
}

// Inspecciona el diff + sections propuestas y marca violación si aparecen
// campos/secciones reservadas a otras fases (contrataciones, compras).
function checkForbiddenSideEffects({ diff, sections }) {
  const violations = [];
  const forbidden = ['contrataciones', 'compras', 'hiring', 'procurement'];
  const checkKey = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (forbidden.some(f => k.toLowerCase().includes(f))) {
        violations.push({
          code: 'FORBIDDEN_SECTION',
          severity: 'block',
          message: `La sección "${k}" no puede actualizarse desde el plan anual; pertenece a otra fase del autopilot.`,
        });
      }
    }
  };
  checkKey(sections || {});
  checkKey(diff?.added || {});
  checkKey(diff?.modified || {});
  checkKey(diff?.replaced || {});
  return {
    allowed: violations.length === 0,
    violations,
  };
}

module.exports = {
  validateVersionCreation,
  checkForbiddenSideEffects,
  DEFAULT_WEEKLY_CAP,
  SAFE_SECTIONS,
  SENSITIVE_SECTIONS,
};
