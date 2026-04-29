// Helpers compartidos del dominio HR. Este archivo es el resultado del split
// del monolito routes/hr.js (1898 LOC) en routes/hr/. Aquí viven utilidades
// usadas por dos o más sub-archivos: regex de fechas/horas, límites globales
// de planillas, normalizadores numéricos, cargadores de mapas (fichas, users,
// unidades), helpers de auditoría y rate limiter de planillas.
//
// Convenciones (docs/code-standards.md): ningún sub-archivo de hr/ duplica
// estas utilidades; cada uno las importa desde aquí. Cuando un helper sólo
// lo usa un sub-archivo, vive con él (e.g. parsePeriodoISO en payroll-fixed,
// enrichPlanilla en payroll-unit).

const { db } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

// ─── Regex compartidos ────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Constantes de planillas ──────────────────────────────────────────────

const PLANILLA_LIMITS = {
  segmentos: 50,
  trabajadoresPorPlanilla: 500,
  observaciones: 1000,
  nombrePlantilla: 100,
  string: 200,        // cap para nombres de lote, labor, grupo, unidad, etc.
  numeric: 9_999_999, // cap para totalGeneral, costos, cantidades
  filasPorPlanilla: 500,
  diasPorFila: 400,   // defensivo (~1 año + margen)
  deduccionesPorFila: 50,
  conceptoDeduccion: 100,
  periodoDiasMax: 366,
};

const PLANILLA_ESTADOS = ['borrador', 'pendiente', 'aprobada', 'pagada'];

// Roles que pueden crear/editar planillas en nombre de otros encargados.
const PLANILLA_ROLES_ON_BEHALF = ['supervisor', 'administrador', 'rrhh'];
const canActOnBehalf = (req) => PLANILLA_ROLES_ON_BEHALF.includes(req.userRole);

// ─── Normalizadores numéricos / strings ──────────────────────────────────

function trimStr(v, max) {
  if (v == null) return '';
  return String(v).slice(0, max);
}

function clampNumber(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > max) return max;
  return n;
}

// ─── Resolución de identidad ──────────────────────────────────────────────

// Resuelve el doc id del usuario autenticado (colección `users`) a partir
// de email + fincaId. Cachea en req para evitar repeticiones dentro del
// mismo request.
async function resolveAuthUserId(req) {
  if (req._authUserId !== undefined) return req._authUserId;
  if (!req.userEmail) { req._authUserId = null; return null; }
  const snap = await db.collection('users')
    .where('email', '==', req.userEmail)
    .where('fincaId', '==', req.fincaId)
    .limit(1).get();
  req._authUserId = snap.empty ? null : snap.docs[0].id;
  return req._authUserId;
}

// ─── Cargadores de mapas (lectura-pesada por finca) ──────────────────────

async function loadFichasMap(fincaId) {
  const snap = await db.collection('hr_fichas').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

async function loadUnidadesMap(fincaId) {
  const snap = await db.collection('unidades_medida').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => {
    const u = d.data() || {};
    if (u.nombre) map.set(String(u.nombre).trim().toLowerCase(), u);
  });
  return map;
}

async function loadUsersMap(fincaId) {
  const snap = await db.collection('users').where('fincaId', '==', fincaId).get();
  const map = new Map();
  snap.docs.forEach(d => map.set(d.id, d.data() || {}));
  return map;
}

// ─── Audit trail ─────────────────────────────────────────────────────────

const PLANILLA_HISTORY_MAX = 50;

function buildHistoryEntry({ userId, email, action }) {
  return { at: new Date(), by: userId || null, byEmail: email || null, action };
}

function appendHistory(currentHistory, entry) {
  const arr = Array.isArray(currentHistory) ? currentHistory : [];
  const next = [...arr, entry];
  return next.length > PLANILLA_HISTORY_MAX ? next.slice(-PLANILLA_HISTORY_MAX) : next;
}

// ─── Rate limiter (in-memory, por instancia de Cloud Function) ───────────
//
// Defensa en profundidad — no reemplaza las quotas de API Gateway.

const RATE_BUCKETS = new Map();
const RATE_BUCKET_MAX = 5000;

function planillaRateLimit({ windowMs = 60_000, max = 60 } = {}) {
  return (req, res, next) => {
    const uid = req.uid;
    if (!uid) return next();
    const key = `${uid}:${req.method}:${req.baseUrl || ''}${req.path}`;
    const now = Date.now();
    let bucket = RATE_BUCKETS.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      if (RATE_BUCKETS.size > RATE_BUCKET_MAX) {
        for (const [k, b] of RATE_BUCKETS) {
          if (now - b.windowStart > windowMs) RATE_BUCKETS.delete(k);
          if (RATE_BUCKETS.size <= RATE_BUCKET_MAX / 2) break;
        }
      }
      bucket = { count: 0, windowStart: now };
      RATE_BUCKETS.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.windowStart + windowMs - now) / 1000)));
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Rate limit exceeded. Try again later.', 429);
    }
    next();
  };
}

module.exports = {
  // Regex
  TIME_RE,
  DATE_RE,
  FECHA_RE,
  // Constantes
  PLANILLA_LIMITS,
  PLANILLA_ESTADOS,
  PLANILLA_ROLES_ON_BEHALF,
  canActOnBehalf,
  // Normalizadores
  trimStr,
  clampNumber,
  // Identidad
  resolveAuthUserId,
  // Mapas
  loadFichasMap,
  loadUnidadesMap,
  loadUsersMap,
  // Audit
  PLANILLA_HISTORY_MAX,
  buildHistoryEntry,
  appendHistory,
  // Rate limit
  planillaRateLimit,
};
