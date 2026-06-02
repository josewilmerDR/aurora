// Validación + middleware compartidos del dominio Cosecha (registros y despachos).
// Sin acceso a Firestore: lógica pura de payload + el gate de rol.

const { hasMinRoleBE } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

// Cosecha es un módulo operativo de encargado+ (gateado así en el frontend,
// routeRoles.js → '/cosecha/*': 'encargado'). El backend re-aplica el piso para
// que un trabajador no pueda crear/anular despachos ni tocar registros llamando
// la API directamente.
function requireEncargado(req, res, next) {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only encargado or above can access harvest data.', 403);
  }
  next();
}

// Normaliza y valida el array de boletas que compone un despacho. Cada boleta
// debe ser un objeto con un id de registro (string), y opcionalmente consecutivo
// (string) y cantidad (número). Descarta cualquier campo no whitelisteado para
// que el cliente no pueda inyectar objetos arbitrarios/anidados al doc, y capa
// el tamaño del array. Devuelve { error, boletas }.
const MAX_BOLETAS = 256;
function normalizeBoletas(raw) {
  if (raw === undefined || raw === null) return { boletas: [] };
  if (!Array.isArray(raw)) return { error: 'Boletas must be an array.' };
  if (raw.length > MAX_BOLETAS) return { error: `Too many boletas (max ${MAX_BOLETAS}).` };
  const boletas = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      return { error: 'Each boleta must be an object.' };
    }
    if (typeof b.id !== 'string' || b.id.length === 0 || b.id.length > 1500) {
      return { error: 'Each boleta requires a valid id.' };
    }
    const boleta = { id: b.id };
    if (b.consecutivo !== undefined && b.consecutivo !== null) {
      if (typeof b.consecutivo !== 'string' || b.consecutivo.length > 64) {
        return { error: 'Invalid boleta consecutivo.' };
      }
      boleta.consecutivo = b.consecutivo;
    }
    if (b.cantidad !== undefined && b.cantidad !== null && b.cantidad !== '') {
      const c = Number(b.cantidad);
      if (!Number.isFinite(c) || c < 0 || c >= 16384) {
        return { error: 'Invalid boleta cantidad.' };
      }
      boleta.cantidad = c;
    }
    boletas.push(boleta);
  }
  return { boletas };
}

// ── Harvest record payload validation ────────────────────────────────────────
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// Strict validation: rejects non-existent dates like "2026-02-30"
// (which `new Date()` would silently normalize to another real date).
function isValidISODate(s) {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

// Upper bound of the allowed `fecha` range. Uses "tomorrow UTC" as the ceiling
// to tolerate timezone differences between the client (local time) and the
// server (UTC) — avoids rejecting a valid "today" date in the user's TZ when
// UTC has not yet advanced to the same day.
function maxAllowedFechaISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function validateCosechaPayload(body, { partial = false } = {}) {
  // fecha — required, strict YYYY-MM-DD format, not after current day
  if (!partial || body.fecha !== undefined) {
    if (!isValidISODate(body.fecha)) {
      return 'Date is required in YYYY-MM-DD format.';
    }
    if (body.fecha > maxAllowedFechaISO()) {
      return 'Date cannot be after the current day.';
    }
  }

  // loteId — required
  if (!partial || body.loteId !== undefined) {
    const loteId = body.loteId;
    if (typeof loteId !== 'string' || loteId.trim().length === 0) {
      return 'Lote is required.';
    }
    if (loteId.length > 128) return 'Lote identifier is too long.';
  }

  // loteNombre
  if (body.loteNombre !== undefined && body.loteNombre !== null && body.loteNombre !== '') {
    if (typeof body.loteNombre !== 'string' || body.loteNombre.length > 128) {
      return 'Lote name cannot exceed 128 characters.';
    }
  }

  // grupo
  if (body.grupo !== undefined && body.grupo !== null && body.grupo !== '') {
    if (typeof body.grupo !== 'string' || body.grupo.length > 128) {
      return 'Grupo cannot exceed 128 characters.';
    }
  }

  // bloque
  if (body.bloque !== undefined && body.bloque !== null && body.bloque !== '') {
    if (typeof body.bloque !== 'string' || body.bloque.length > 64) {
      return 'Bloque cannot exceed 64 characters.';
    }
  }

  // cantidad — required, > 0 and < 16384
  if (!partial || body.cantidad !== undefined) {
    const cant = Number(body.cantidad);
    if (!Number.isFinite(cant) || cant <= 0 || cant >= 16384) {
      return 'Harvested quantity must be greater than 0 and less than 16384.';
    }
  }

  // cantidadRecibidaPlanta — optional, ≥ 0 and < 16384 when present
  if (
    body.cantidadRecibidaPlanta !== undefined &&
    body.cantidadRecibidaPlanta !== null &&
    body.cantidadRecibidaPlanta !== ''
  ) {
    const cr = Number(body.cantidadRecibidaPlanta);
    if (!Number.isFinite(cr) || cr < 0 || cr >= 16384) {
      return 'Quantity received at plant must be between 0 and 16384.';
    }
  }

  // unidad
  if (body.unidad !== undefined && body.unidad !== null && body.unidad !== '') {
    if (typeof body.unidad !== 'string' || body.unidad.length > 64) {
      return 'Unit cannot exceed 64 characters.';
    }
  }

  // unidadId — id de catálogo persistido para poder pre-seleccionar la unidad
  // si en el futuro se edita el registro (round-trip). #13 audit.
  if (body.unidadId !== undefined && body.unidadId !== null && body.unidadId !== '') {
    if (typeof body.unidadId !== 'string' || body.unidadId.length > 128) {
      return 'Invalid unit identifier.';
    }
  }

  // operarioId / operarioNombre
  if (body.operarioId !== undefined && body.operarioId !== null && body.operarioId !== '') {
    if (typeof body.operarioId !== 'string' || body.operarioId.length > 128) {
      return 'Invalid operario identifier.';
    }
  }
  if (body.operarioNombre !== undefined && body.operarioNombre !== null && body.operarioNombre !== '') {
    if (typeof body.operarioNombre !== 'string' || body.operarioNombre.length > 128) {
      return 'Operario name cannot exceed 128 characters.';
    }
  }

  // activoId / activoNombre
  if (body.activoId !== undefined && body.activoId !== null && body.activoId !== '') {
    if (typeof body.activoId !== 'string' || body.activoId.length > 128) {
      return 'Invalid asset identifier.';
    }
  }
  if (body.activoNombre !== undefined && body.activoNombre !== null && body.activoNombre !== '') {
    if (typeof body.activoNombre !== 'string' || body.activoNombre.length > 160) {
      return 'Asset name cannot exceed 160 characters.';
    }
  }

  // implementoId / implementoNombre
  if (body.implementoId !== undefined && body.implementoId !== null && body.implementoId !== '') {
    if (typeof body.implementoId !== 'string' || body.implementoId.length > 128) {
      return 'Invalid implement identifier.';
    }
  }
  if (body.implementoNombre !== undefined && body.implementoNombre !== null && body.implementoNombre !== '') {
    if (typeof body.implementoNombre !== 'string' || body.implementoNombre.length > 160) {
      return 'Implement name cannot exceed 160 characters.';
    }
  }

  // nota — strictly less than 288 characters
  if (body.nota !== undefined && body.nota !== null && body.nota !== '') {
    if (typeof body.nota !== 'string' || body.nota.length >= 288) {
      return 'Note cannot exceed 287 characters.';
    }
  }

  return null;
}

module.exports = {
  requireEncargado,
  normalizeBoletas,
  validateCosechaPayload,
};
