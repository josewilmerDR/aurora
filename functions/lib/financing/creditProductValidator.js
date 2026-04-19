// Pure validator for `credit_products` documents. Returns { error, data }
// following the same pattern as income/budgets validators.
//
// Range policy (intentionally wide to accept real-world Latin American
// agricultural credit): APR 0-80%, term 1-60 months, amount up to 1e9.
// All 3 amortization schemes supported: cuota_fija | amortizacion_constante |
// bullet (interest only monthly, principal at maturity).

const VALID_TIPOS = new Set(['agricola', 'capital_trabajo', 'leasing', 'rotativo']);
const VALID_PROVIDER_TYPES = new Set(['banco', 'cooperativa', 'microfinanciera', 'fintech']);
const VALID_ESQUEMAS = new Set(['cuota_fija', 'amortizacion_constante', 'bullet']);
const VALID_MONEDAS = new Set(['USD', 'CRC']);
const VALID_REQ_TIPOS = new Set(['documento', 'garantia', 'metrica']);

const MAX_NAME = 150;
const MAX_DESCRIPCION = 500;
const MAX_CODIGO = 64;
const MAX_REQUISITOS = 30;
const MAX_MONEDA = 1e9;
const MAX_APR = 0.80;   // 80% APR ceiling — real products rarely exceed this.
const MIN_PLAZO = 1;
const MAX_PLAZO = 60;   // 5 years. Longer-term agricultural loans are rare.

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Validate a single requisito. Returns the normalized object or an error string.
function normalizeRequisito(raw) {
  if (!raw || typeof raw !== 'object') return 'invalid_shape';
  const tipo = str(raw.tipo, 32);
  if (!VALID_REQ_TIPOS.has(tipo)) return 'invalid_tipo';
  const codigo = str(raw.codigo, MAX_CODIGO);
  if (!codigo) return 'missing_codigo';
  const descripcion = str(raw.descripcion, MAX_DESCRIPCION);
  if (!descripcion) return 'missing_descripcion';
  return { tipo, codigo, descripcion };
}

// ─── Main ─────────────────────────────────────────────────────────────────

function buildCreditProductDoc(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Body is required.' };
  }

  const providerName = str(body.providerName, MAX_NAME);
  if (!providerName) return { error: 'providerName is required.' };

  const providerType = str(body.providerType, 32);
  if (!VALID_PROVIDER_TYPES.has(providerType)) {
    return { error: `providerType must be one of: ${[...VALID_PROVIDER_TYPES].join(', ')}.` };
  }

  const tipo = str(body.tipo, 32);
  if (!VALID_TIPOS.has(tipo)) {
    return { error: `tipo must be one of: ${[...VALID_TIPOS].join(', ')}.` };
  }

  const esquemaAmortizacion = str(body.esquemaAmortizacion, 32);
  if (!VALID_ESQUEMAS.has(esquemaAmortizacion)) {
    return { error: `esquemaAmortizacion must be one of: ${[...VALID_ESQUEMAS].join(', ')}.` };
  }

  const moneda = VALID_MONEDAS.has(body.moneda) ? body.moneda : 'USD';

  // Amount bounds.
  const monedaMin = num(body.monedaMin);
  const monedaMax = num(body.monedaMax);
  if (monedaMin === null || monedaMin <= 0 || monedaMin > MAX_MONEDA) {
    return { error: 'monedaMin must be > 0.' };
  }
  if (monedaMax === null || monedaMax <= 0 || monedaMax > MAX_MONEDA) {
    return { error: 'monedaMax must be > 0.' };
  }
  if (monedaMin > monedaMax) {
    return { error: 'monedaMin cannot exceed monedaMax.' };
  }

  // Term bounds.
  const plazoMesesMin = num(body.plazoMesesMin);
  const plazoMesesMax = num(body.plazoMesesMax);
  if (plazoMesesMin === null || plazoMesesMin < MIN_PLAZO || plazoMesesMin > MAX_PLAZO) {
    return { error: `plazoMesesMin must be in [${MIN_PLAZO}, ${MAX_PLAZO}].` };
  }
  if (plazoMesesMax === null || plazoMesesMax < MIN_PLAZO || plazoMesesMax > MAX_PLAZO) {
    return { error: `plazoMesesMax must be in [${MIN_PLAZO}, ${MAX_PLAZO}].` };
  }
  if (plazoMesesMin > plazoMesesMax) {
    return { error: 'plazoMesesMin cannot exceed plazoMesesMax.' };
  }
  if (!Number.isInteger(plazoMesesMin) || !Number.isInteger(plazoMesesMax)) {
    return { error: 'plazo bounds must be integers (months).' };
  }

  // APR bounds (as decimals, e.g. 0.18 = 18%).
  const aprMin = num(body.aprMin);
  const aprMax = num(body.aprMax);
  if (aprMin === null || aprMin < 0 || aprMin > MAX_APR) {
    return { error: `aprMin must be in [0, ${MAX_APR}] (decimal, e.g. 0.18 for 18%).` };
  }
  if (aprMax === null || aprMax < 0 || aprMax > MAX_APR) {
    return { error: `aprMax must be in [0, ${MAX_APR}] (decimal).` };
  }
  if (aprMin > aprMax) {
    return { error: 'aprMin cannot exceed aprMax.' };
  }

  // Requisitos array.
  const rawReqs = Array.isArray(body.requisitos) ? body.requisitos : [];
  if (rawReqs.length > MAX_REQUISITOS) {
    return { error: `Too many requisitos (max ${MAX_REQUISITOS}).` };
  }
  const requisitos = [];
  for (let i = 0; i < rawReqs.length; i += 1) {
    const r = normalizeRequisito(rawReqs[i]);
    if (typeof r === 'string') {
      return { error: `requisitos[${i}] ${r}.` };
    }
    requisitos.push(r);
  }

  // fuente — 'manual' default; 'api:xxx' for provider-ingested entries.
  const fuenteRaw = str(body.fuente, 64);
  const fuente = fuenteRaw || 'manual';
  if (fuente !== 'manual' && !fuente.startsWith('api:')) {
    return { error: 'fuente must be "manual" or start with "api:".' };
  }

  const activo = body.activo !== false; // default true
  const descripcion = str(body.descripcion, MAX_DESCRIPCION);

  return {
    data: {
      providerName,
      providerType,
      tipo,
      esquemaAmortizacion,
      moneda,
      monedaMin,
      monedaMax,
      plazoMesesMin,
      plazoMesesMax,
      aprMin,
      aprMax,
      requisitos,
      fuente,
      activo,
      descripcion: descripcion || null,
    },
  };
}

module.exports = {
  buildCreditProductDoc,
  VALID_TIPOS,
  VALID_PROVIDER_TYPES,
  VALID_ESQUEMAS,
  VALID_MONEDAS,
  VALID_REQ_TIPOS,
  // internals exported for tests
  _internals: { normalizeRequisito },
  _limits: { MAX_APR, MIN_PLAZO, MAX_PLAZO, MAX_MONEDA, MAX_REQUISITOS },
};
