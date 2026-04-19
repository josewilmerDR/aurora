// Validador puro del payload de `rotation_constraints`.
//
// Un "rotation_constraint" describe reglas agronómicas sobre un cultivo:
// a qué familia botánica pertenece, cuántos ciclos consecutivos se permiten
// repetirlo en el mismo lote, cuántos días de descanso requiere entre ciclos
// y qué otros cultivos no deben seguirle.
//
// Este módulo solamente valida forma; las reglas se aplican en
// rotationGuardrails.js.

const CULTIVO_MAX = 64;
const FAMILIA_MAX = 64;
const INCOMPAT_MAX = 20;              // cap al tamaño del array
const INCOMPAT_ITEM_MAX = 64;
const NOTAS_MAX = 512;

// Rangos razonables (conservadores, editables):
const DESCANSO_CICLOS_MIN = 0;        // 0 = no hay descanso mínimo por ciclos
const DESCANSO_CICLOS_MAX = 6;
const DESCANSO_DIAS_MIN = 0;
const DESCANSO_DIAS_MAX = 365 * 3;    // 3 años cap

function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function isIntInRange(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  if (!Number.isInteger(n)) return false;
  return n >= min && n <= max;
}

function normalizeIncompatibleCon(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, INCOMPAT_ITEM_MAX);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.slice(0, INCOMPAT_MAX);
}

function validateConstraintPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') return 'Payload is required.';

  if (!partial || body.cultivo !== undefined) {
    if (!isNonEmptyString(body.cultivo, CULTIVO_MAX)) {
      return 'cultivo is required (string up to 64 chars).';
    }
  }
  if (!partial || body.familiaBotanica !== undefined) {
    if (!isNonEmptyString(body.familiaBotanica, FAMILIA_MAX)) {
      return 'familiaBotanica is required (string up to 64 chars).';
    }
  }
  if (body.descansoMinCiclos !== undefined && body.descansoMinCiclos !== null) {
    if (!isIntInRange(body.descansoMinCiclos, DESCANSO_CICLOS_MIN, DESCANSO_CICLOS_MAX)) {
      return `descansoMinCiclos must be an integer between ${DESCANSO_CICLOS_MIN} and ${DESCANSO_CICLOS_MAX}.`;
    }
  }
  if (body.descansoMinDias !== undefined && body.descansoMinDias !== null) {
    if (!isIntInRange(body.descansoMinDias, DESCANSO_DIAS_MIN, DESCANSO_DIAS_MAX)) {
      return `descansoMinDias must be an integer between ${DESCANSO_DIAS_MIN} and ${DESCANSO_DIAS_MAX}.`;
    }
  }
  if (body.incompatibleCon !== undefined && body.incompatibleCon !== null) {
    if (!Array.isArray(body.incompatibleCon)) {
      return 'incompatibleCon must be an array of strings.';
    }
    if (body.incompatibleCon.length > INCOMPAT_MAX) {
      return `incompatibleCon cannot exceed ${INCOMPAT_MAX} items.`;
    }
  }
  if (body.notas !== undefined && body.notas !== null && body.notas !== '') {
    if (typeof body.notas !== 'string' || body.notas.length > NOTAS_MAX) {
      return `notas cannot exceed ${NOTAS_MAX} characters.`;
    }
  }
  return null;
}

// Devuelve el cuerpo listo para persistir: tipos normalizados, defaults y
// strings recortados. No toca `fincaId`/auditoría — eso es trabajo de la
// ruta.
function normalizeConstraintPayload(body) {
  const out = {};
  if (typeof body.cultivo === 'string') out.cultivo = body.cultivo.trim().slice(0, CULTIVO_MAX);
  if (typeof body.familiaBotanica === 'string') {
    out.familiaBotanica = body.familiaBotanica.trim().slice(0, FAMILIA_MAX);
  }
  if (body.descansoMinCiclos !== undefined) {
    out.descansoMinCiclos = Number(body.descansoMinCiclos) || 0;
  }
  if (body.descansoMinDias !== undefined) {
    out.descansoMinDias = Number(body.descansoMinDias) || 0;
  }
  if (body.incompatibleCon !== undefined) {
    out.incompatibleCon = normalizeIncompatibleCon(body.incompatibleCon);
  }
  if (body.notas !== undefined) {
    out.notas = typeof body.notas === 'string' ? body.notas.slice(0, NOTAS_MAX) : null;
  }
  return out;
}

module.exports = {
  validateConstraintPayload,
  normalizeConstraintPayload,
  // Para tests.
  LIMITS: Object.freeze({
    CULTIVO_MAX, FAMILIA_MAX, INCOMPAT_MAX, INCOMPAT_ITEM_MAX, NOTAS_MAX,
    DESCANSO_CICLOS_MIN, DESCANSO_CICLOS_MAX,
    DESCANSO_DIAS_MIN, DESCANSO_DIAS_MAX,
  }),
};
