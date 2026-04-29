// Field-records — helpers compartidos.
//
// Sub-archivo del split de routes/field-records.js. Aglomera todo lo que
// más de un endpoint del dominio necesita: constantes de validación,
// sanitizers, generadores de consecutivos atómicos, serializadores y
// validadores de productos aplicados.
//
// Las rutas (read/create/mix/apply/void) importan de aquí; este módulo
// no monta rutas.

const { db, Timestamp } = require('../../lib/firebase');
const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

// ── Validation constants ────────────────────────────────────────────────────
const MAX_STR = 200;
const MAX_SHORT = 60;
const MAX_ACTIVITY_LEN = 64;
const MAX_TECNICO_LEN = 48;
const MAX_PRODUCTOS = 50;
const MAX_BLOQUES = 500;
const MAX_CANTIDAD_POR_HA = 100000;
const MAX_OBS_LEN = 500;
// Limits specific to the Edit / Mezcla Lista modal — aligned with the
// frontend (MezclaListaModal.jsx). We don't reuse MAX_OBS_LEN because other
// endpoints (e.g. aplicada) keep the historical limit.
const MAX_OBS_MEZCLA_LEN = 288;
const MAX_NOMBRE_MEZCLA_LEN = 48;
const MAX_FUTURE_DAYS = 1825; // hard cap: ~5 years
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MOTIVOS_CAMBIO = new Set(['sustitucion', 'ajuste_dosis', 'otro']);

// ── Sanitizers ──────────────────────────────────────────────────────────────

const sanitizeStr = (v, max = MAX_STR) => {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

// Like sanitizeStr, but rejects (returns null) when the value exceeds the max,
// instead of silently truncating. Used for fields with a hard cap that is also
// validated on the frontend.
const sanitizeStrStrict = (v, max) => {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return null;
  return trimmed;
};

const isValidYmd = (s) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime());
};

// True if the YYYY-MM-DD date is within the allowed range (<= today + MAX_FUTURE_DAYS).
const isWithinFutureLimit = (ymd) => {
  const sel = new Date(ymd + 'T12:00:00');
  if (isNaN(sel.getTime())) return false;
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  const diffDays = Math.round((sel - hoy) / 86400000);
  return diffDays <= MAX_FUTURE_DAYS;
};

const requireRole = (req, res, min) => {
  if (!hasMinRoleBE(req.userRole, min)) {
    sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Insufficient role for this action.', 403);
    return false;
  }
  return true;
};

// ── Atomic consecutive generators (transactional counter) ───────────────────

async function nextCedulaConsecutivo(fincaId) {
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  let consecutivo;
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { ultimo: next }, { merge: true });
    consecutivo = `#CA-${String(next).padStart(5, '0')}`;
  });
  return consecutivo;
}

async function nextCedulasConsecutivos(fincaId, count) {
  if (count <= 1) return [await nextCedulaConsecutivo(fincaId)];
  const counterRef = db.collection('cedula_counters').doc(fincaId);
  const consecutivos = [];
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(counterRef);
    const current = doc.exists ? (doc.data().ultimo || 0) : 0;
    tx.set(counterRef, { ultimo: current + count }, { merge: true });
    for (let i = 0; i < count; i++) {
      consecutivos.push(`#CA-${String(current + 1 + i).padStart(5, '0')}`);
    }
  });
  return consecutivos;
}

// ── Serializers ─────────────────────────────────────────────────────────────

const serializeCedula = (id, data) => ({
  id,
  ...data,
  generadaAt:        data.generadaAt?.toDate?.()?.toISOString()        || null,
  mezclaListaAt:     data.mezclaListaAt?.toDate?.()?.toISOString()     || null,
  aplicadaAt:        data.aplicadaAt?.toDate?.()?.toISOString()        || null,
  modificadaEnMezclaAt: data.modificadaEnMezclaAt?.toDate?.()?.toISOString() || null,
  editadaAt:         data.editadaAt?.toDate?.()?.toISOString()         || null,
});

// Snapshot of a product from the original plan (task.activity.productos) to
// store in cedula.productosOriginales when the cédula is created. Never changes afterwards.
const serializeProductoOriginal = (p) => {
  if (!p) return null;
  const cant = p.cantidadPorHa !== undefined
    ? parseFloat(p.cantidadPorHa)
    : (p.cantidad !== undefined ? parseFloat(p.cantidad) : null);
  return {
    productoId: p.productoId || null,
    nombreComercial: p.nombreComercial || '',
    cantidadPorHa: Number.isFinite(cant) ? cant : null,
    unidad: p.unidad || '',
    periodoReingreso: p.periodoReingreso ?? null,
    periodoACosecha: p.periodoACosecha ?? null,
  };
};

// Validates and enriches a productosAplicados array from the PUT mezcla-lista body.
// Throws { status, message } on error so the caller can catch and respond to the client.
async function validateAndEnrichProductosAplicados(input, fincaId) {
  if (!Array.isArray(input)) {
    throw { status: 400, message: 'productosAplicados must be an array.' };
  }
  if (input.length === 0) {
    throw { status: 400, message: 'productosAplicados cannot be empty.' };
  }
  if (input.length > MAX_PRODUCTOS) {
    throw { status: 400, message: `Maximum ${MAX_PRODUCTOS} products per cedula.` };
  }
  const enriched = [];
  for (const p of input) {
    if (!p || typeof p.productoId !== 'string' || !p.productoId) {
      throw { status: 400, message: 'Invalid product in productosAplicados.' };
    }
    const cant = parseFloat(p.cantidadPorHa);
    if (!Number.isFinite(cant) || cant <= 0 || cant > MAX_CANTIDAD_POR_HA) {
      throw { status: 400, message: `Invalid dose/Ha for product ${p.productoId}.` };
    }
    const doc = await db.collection('productos').doc(p.productoId).get();
    if (!doc.exists || doc.data().fincaId !== fincaId) {
      throw { status: 400, message: `Product ${p.productoId} not found.` };
    }
    const info = doc.data();
    const row = {
      productoId: p.productoId,
      nombreComercial: info.nombreComercial || '',
      cantidadPorHa: cant,
      unidad: info.unidad || '',
      periodoReingreso: info.periodoReingreso ?? null,
      periodoACosecha: info.periodoACosecha ?? null,
    };
    if (p.motivoCambio != null && p.motivoCambio !== '') {
      if (typeof p.motivoCambio !== 'string' || !MOTIVOS_CAMBIO.has(p.motivoCambio)) {
        throw { status: 400, message: `Invalid motivoCambio: ${p.motivoCambio}.` };
      }
      row.motivoCambio = p.motivoCambio;
    }
    if (p.productoOriginalId != null && p.productoOriginalId !== '') {
      if (typeof p.productoOriginalId !== 'string') {
        throw { status: 400, message: 'Invalid productoOriginalId.' };
      }
      row.productoOriginalId = p.productoOriginalId;
    }
    enriched.push(row);
  }
  return enriched;
}

// Compares productosOriginales vs productosAplicados ignoring motivos and metadata,
// detecting differences in productoId or cantidadPorHa.
function computeHuboCambios(originales, aplicados) {
  if (!Array.isArray(originales) || !Array.isArray(aplicados)) return true;
  if (originales.length !== aplicados.length) return true;
  const sig = (arr) => arr
    .map(p => `${p.productoId || ''}|${p.cantidadPorHa ?? ''}`)
    .sort()
    .join(',');
  return sig(originales) !== sig(aplicados);
}

module.exports = {
  // Constants
  MAX_STR, MAX_SHORT, MAX_ACTIVITY_LEN, MAX_TECNICO_LEN, MAX_PRODUCTOS,
  MAX_BLOQUES, MAX_CANTIDAD_POR_HA, MAX_OBS_LEN, MAX_OBS_MEZCLA_LEN,
  MAX_NOMBRE_MEZCLA_LEN, MAX_FUTURE_DAYS,
  DATE_RE, TIME_RE, MOTIVOS_CAMBIO,
  // Sanitizers
  sanitizeStr, sanitizeStrStrict,
  // Date helpers
  isValidYmd, isWithinFutureLimit,
  // Auth
  requireRole,
  // Counters
  nextCedulaConsecutivo, nextCedulasConsecutivos,
  // Serializers
  serializeCedula, serializeProductoOriginal,
  // Validators
  validateAndEnrichProductosAplicados, computeHuboCambios,
};
