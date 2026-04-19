// Validador puro del payload de annual_plans.
//
// Valida:
//   - year: entero razonable (2020-2099).
//   - sections: objeto con las 5 secciones permitidas.
//   - Cada sección tiene su propio validador (forma, no semántica).
//
// NO valida referencias cruzadas (p. ej. que el scenarioId exista en
// `scenarios`) — eso queda para la ruta, que sí toca Firestore.

const ALLOWED_SECTIONS = ['cultivos', 'rotaciones', 'presupuesto', 'hitos', 'supuestos', 'escenarioBase'];
const SAFE_SECTIONS = new Set(['supuestos', 'hitos', 'escenarioBase']);
const SENSITIVE_SECTIONS = new Set(['cultivos', 'rotaciones', 'presupuesto']);

const LIMITS = Object.freeze({
  yearMin: 2020,
  yearMax: 2099,
  cultivosMax: 50,
  rotacionesMax: 50,
  hitosMax: 100,
  supuestosMax: 30,
  budgetsSnapshotMax: 100,
  stringMax: 512,
  labelMax: 128,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIso(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isNonEmptyString(v, max = LIMITS.labelMax) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function validateYear(year) {
  const n = Number(year);
  if (!Number.isInteger(n)) return 'year must be integer.';
  if (n < LIMITS.yearMin || n > LIMITS.yearMax) {
    return `year must be in [${LIMITS.yearMin}, ${LIMITS.yearMax}].`;
  }
  return null;
}

function validateCultivos(arr) {
  if (!Array.isArray(arr)) return 'cultivos must be an array.';
  if (arr.length > LIMITS.cultivosMax) return `cultivos cannot exceed ${LIMITS.cultivosMax} items.`;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (!c || typeof c !== 'object') return `cultivos[${i}] must be an object.`;
    if (!isNonEmptyString(c.loteId, LIMITS.labelMax)) return `cultivos[${i}].loteId is required.`;
    if (!isNonEmptyString(c.paqueteId, LIMITS.labelMax)) return `cultivos[${i}].paqueteId is required.`;
    if (c.fechaEstimada !== undefined && c.fechaEstimada !== null && !isValidIso(c.fechaEstimada)) {
      return `cultivos[${i}].fechaEstimada must be YYYY-MM-DD.`;
    }
    if (c.loteNombre !== undefined && typeof c.loteNombre !== 'string') return `cultivos[${i}].loteNombre must be string.`;
    if (c.nombrePaquete !== undefined && typeof c.nombrePaquete !== 'string') return `cultivos[${i}].nombrePaquete must be string.`;
  }
  return null;
}

function validateRotaciones(arr) {
  if (!Array.isArray(arr)) return 'rotaciones must be an array.';
  if (arr.length > LIMITS.rotacionesMax) return `rotaciones cannot exceed ${LIMITS.rotacionesMax} items.`;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || typeof r !== 'object') return `rotaciones[${i}] must be an object.`;
    if (!isNonEmptyString(r.loteId, LIMITS.labelMax)) return `rotaciones[${i}].loteId is required.`;
    if (!isNonEmptyString(r.recommendationId, LIMITS.labelMax)) return `rotaciones[${i}].recommendationId is required.`;
    if (r.summary !== undefined && typeof r.summary !== 'string') return `rotaciones[${i}].summary must be string.`;
  }
  return null;
}

function validatePresupuesto(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) return 'presupuesto must be an object.';
  for (const k of ['totalAsignado', 'ingresoEsperado', 'margenEsperado']) {
    if (obj[k] !== undefined && obj[k] !== null && !Number.isFinite(Number(obj[k]))) {
      return `presupuesto.${k} must be a finite number.`;
    }
  }
  if (obj.budgetsSnapshot !== undefined) {
    if (!Array.isArray(obj.budgetsSnapshot)) return 'presupuesto.budgetsSnapshot must be an array.';
    if (obj.budgetsSnapshot.length > LIMITS.budgetsSnapshotMax) {
      return `presupuesto.budgetsSnapshot cannot exceed ${LIMITS.budgetsSnapshotMax} items.`;
    }
    for (let i = 0; i < obj.budgetsSnapshot.length; i++) {
      const b = obj.budgetsSnapshot[i];
      if (!b || typeof b !== 'object') return `presupuesto.budgetsSnapshot[${i}] must be object.`;
    }
  }
  return null;
}

function validateHitos(arr) {
  if (!Array.isArray(arr)) return 'hitos must be an array.';
  if (arr.length > LIMITS.hitosMax) return `hitos cannot exceed ${LIMITS.hitosMax} items.`;
  for (let i = 0; i < arr.length; i++) {
    const h = arr[i];
    if (!h || typeof h !== 'object') return `hitos[${i}] must be an object.`;
    if (!isValidIso(h.fecha)) return `hitos[${i}].fecha must be YYYY-MM-DD.`;
    if (!isNonEmptyString(h.descripcion, LIMITS.stringMax)) return `hitos[${i}].descripcion required (≤${LIMITS.stringMax}).`;
  }
  return null;
}

function validateSupuestos(arr) {
  if (!Array.isArray(arr)) return 'supuestos must be an array.';
  if (arr.length > LIMITS.supuestosMax) return `supuestos cannot exceed ${LIMITS.supuestosMax} items.`;
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string' || arr[i].length > LIMITS.stringMax) {
      return `supuestos[${i}] must be string (≤${LIMITS.stringMax}).`;
    }
  }
  return null;
}

function validateEscenarioBase(obj) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) return 'escenarioBase must be an object.';
  if (obj.scenarioId !== undefined && !isNonEmptyString(obj.scenarioId, LIMITS.labelMax)) {
    return 'escenarioBase.scenarioId must be a non-empty string.';
  }
  return null;
}

function validateSections(sections) {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return 'sections is required (object).';
  }
  for (const k of Object.keys(sections)) {
    if (!ALLOWED_SECTIONS.includes(k)) return `Unknown section "${k}".`;
  }
  if (sections.cultivos !== undefined) {
    const e = validateCultivos(sections.cultivos); if (e) return e;
  }
  if (sections.rotaciones !== undefined) {
    const e = validateRotaciones(sections.rotaciones); if (e) return e;
  }
  if (sections.presupuesto !== undefined) {
    const e = validatePresupuesto(sections.presupuesto); if (e) return e;
  }
  if (sections.hitos !== undefined) {
    const e = validateHitos(sections.hitos); if (e) return e;
  }
  if (sections.supuestos !== undefined) {
    const e = validateSupuestos(sections.supuestos); if (e) return e;
  }
  if (sections.escenarioBase !== undefined) {
    const e = validateEscenarioBase(sections.escenarioBase); if (e) return e;
  }
  return null;
}

function validateAnnualPlanPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') return 'payload required.';
  if (!partial || body.year !== undefined) {
    const e = validateYear(body.year); if (e) return e;
  }
  if (!partial || body.sections !== undefined) {
    const e = validateSections(body.sections); if (e) return e;
  }
  return null;
}

module.exports = {
  validateAnnualPlanPayload,
  validateSections,
  ALLOWED_SECTIONS,
  SAFE_SECTIONS,
  SENSITIVE_SECTIONS,
  LIMITS,
};
