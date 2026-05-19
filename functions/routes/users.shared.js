// Shared constants, validators and helpers for the users domain.
//
// users.js (CRUD) and users-facets.js (grant/revoke endpoints) both need the
// same cross-field invariants and the same module-id whitelist. Centralising
// them here keeps the rules in one place and lets unit tests target the pure
// logic without spinning up the HTTP stack.

const { Timestamp } = require('../lib/firebase');
const { MODULE_PREFIXES } = require('../lib/moduleMap');

const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+\-()]+$/;
const LIMITS = { nombre: 80, email: 120, telefono: 20, motivoSalida: 200 };
const MODULE_IDS = new Set(Object.keys(MODULE_PREFIXES));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanRestrictedTo(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  for (const v of raw) {
    if (typeof v === 'string' && MODULE_IDS.has(v)) seen.add(v);
  }
  return [...seen].sort();
}

// Normalize the two facet flags against the rules:
//   - tieneAcceso=true requires a valid (non-'ninguno') rol and a valid email.
//   - tieneAcceso=false forces rol='ninguno' and restrictedTo=[].
//   - at least one of (tieneAcceso, empleadoPlanilla) must be true on create.
// Returns { errs, clean } where clean has the canonical field values.
function validateUserPayload(body, { mode } = { mode: 'create' }) {
  const errs = [];
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const telefono = typeof body.telefono === 'string' ? body.telefono.trim() : '';
  let rol = body.rol;
  const tieneAcceso = body.tieneAcceso === true;
  const empleadoPlanilla = body.empleadoPlanilla === true;

  if (nombre.length < 2 || nombre.length > LIMITS.nombre) {
    errs.push(`Nombre: 2–${LIMITS.nombre} caracteres.`);
  }
  if (telefono && (!PHONE_RE.test(telefono) || telefono.length > LIMITS.telefono)) {
    errs.push('Teléfono inválido.');
  }

  if (tieneAcceso) {
    if (!emailRaw || !EMAIL_RE.test(emailRaw) || emailRaw.length > LIMITS.email) {
      errs.push('Email inválido (requerido para usuarios con acceso al sistema).');
    }
    if (rol == null || rol === 'ninguno' || !ROLES_VALIDOS.includes(rol)) {
      errs.push('Rol inválido (requerido para usuarios con acceso al sistema).');
    }
  } else {
    if (emailRaw && (!EMAIL_RE.test(emailRaw) || emailRaw.length > LIMITS.email)) {
      errs.push('Email inválido.');
    }
    rol = 'ninguno';
  }

  if (body.restrictedTo !== undefined && !Array.isArray(body.restrictedTo)) {
    errs.push('restrictedTo debe ser un arreglo.');
  }

  if (mode === 'create' && !tieneAcceso && !empleadoPlanilla) {
    errs.push('La persona debe tener acceso al sistema o estar en planilla (o ambas).');
  }

  return {
    errs,
    clean: {
      nombre,
      email: emailRaw,
      telefono,
      rol: rol || 'ninguno',
      tieneAcceso,
      empleadoPlanilla,
    },
  };
}

// Parse a YYYY-MM-DD date, falling back to today if absent. Returns a
// Firestore Timestamp set to noon UTC of that date (matches the convention
// used in hr_asistencia/hr_permisos so subsequent date comparisons line up).
function parseFechaSalida(raw) {
  if (typeof raw === 'string' && DATE_RE.test(raw)) {
    const d = new Date(raw + 'T12:00:00');
    if (!Number.isNaN(d.getTime())) return Timestamp.fromDate(d);
  }
  return Timestamp.now();
}

module.exports = {
  ROLES_VALIDOS,
  EMAIL_RE,
  PHONE_RE,
  LIMITS,
  DATE_RE,
  cleanRestrictedTo,
  validateUserPayload,
  parseFechaSalida,
};
