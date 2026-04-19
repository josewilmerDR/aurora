// Manual provider — no hace llamadas externas. Existe para que un usuario
// cargue observaciones de fuentes sin API (p. ej. SIPSA/DANE en CSV, o un
// reporte local del agrónomo). La ingesta no es disparada por el cron; el
// endpoint `POST /api/signals/manual` escribe directamente.
//
// Todos los `signalType` son soportados. El valor/unidad/metadata vienen en
// el payload. El provider solo valida shape y normaliza.

const ID = 'manual';
const ALLOWED_TYPES = ['weather', 'commodity_price', 'fertilizer_price'];

function validateConfig(config) {
  // La config de source es opcional para manual; si viene, se valida que sea
  // objeto.
  if (config === undefined || config === null) return null;
  if (typeof config !== 'object') return 'config must be an object';
  return null;
}

// Valida y normaliza un payload de observación manual.
function normalizeManualObservation(payload = {}) {
  const out = {};
  if (!ALLOWED_TYPES.includes(payload.signalType)) {
    throw badInput('signalType is invalid or missing.');
  }
  out.signalType = payload.signalType;

  const value = Number(payload.value);
  if (!Number.isFinite(value)) throw badInput('value must be a finite number.');
  out.value = parseFloat(value.toFixed(4));

  if (typeof payload.unit !== 'string' || payload.unit.trim().length === 0 || payload.unit.length > 32) {
    throw badInput('unit is required (≤ 32 chars).');
  }
  out.unit = payload.unit.trim();

  const confidence = payload.confidence === undefined ? 0.7 : Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw badInput('confidence must be in [0, 1].');
  }
  out.confidence = confidence;

  if (typeof payload.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.observedAt)) {
    throw badInput('observedAt must be YYYY-MM-DD.');
  }
  out.observedAt = payload.observedAt;

  if (payload.metadata !== undefined && payload.metadata !== null) {
    if (typeof payload.metadata !== 'object' || Array.isArray(payload.metadata)) {
      throw badInput('metadata must be an object.');
    }
    // Rough cap: stringified no mayor a 4 kB.
    if (JSON.stringify(payload.metadata).length > 4096) {
      throw badInput('metadata too large (>4KB).');
    }
    out.metadata = payload.metadata;
  } else {
    out.metadata = {};
  }

  if (payload.note !== undefined && payload.note !== null) {
    if (typeof payload.note !== 'string' || payload.note.length > 512) {
      throw badInput('note too long (>512 chars).');
    }
    out.metadata.note = payload.note;
  }

  out.raw = { manualPayload: { ...payload } };
  return out;
}

function badInput(msg) {
  const err = new Error(msg);
  err.code = 'INVALID_INPUT';
  return err;
}

module.exports = {
  id: ID,
  signalTypes: ALLOWED_TYPES,
  validateConfig,
  // No `fetchSignal` — el cron ignora manual; se ingestan por endpoint.
  normalizeManualObservation,
};
