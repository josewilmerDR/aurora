// ── Helpers puros de AccountSettings ─────────────────────────────────────────
//
// Definición canónica (frontend) de los campos que edita la página de Ajustes de
// cuenta y su validación. Se mantienen acá — y no dentro del componente — para
// que la página quede delgada y los helpers sean testeables sin montar React.
//
// NOTA DE SINCRONÍA: las claves numéricas (díasIDesarrollo/IIDesarrollo/PostForza)
// y las de identidad son ESPEJO de functions/routes/config/schemas.js. No hay
// módulo compartido FE↔BE: al sumar/cambiar un campo hay que tocar ambos lados.
// Estos días alimentan las proyecciones de cosecha por grupo
// (src/features/fields/lib/grupo-bloques-helpers.js).

// Campos de identidad/contacto (strings). `type` mapea al input HTML.
export const COMPANY_FIELDS = [
  { name: 'nombreEmpresa',      label: 'Nombre de la Empresa',  placeholder: 'Ej: Finca Aurora S.A.',           type: 'text' },
  { name: 'identificacion',     label: 'Identificación',         placeholder: 'Ej: 3-101-123456',                type: 'text' },
  { name: 'representanteLegal', label: 'Representante legal',     placeholder: 'Nombre del representante legal',  type: 'text' },
  { name: 'administrador',      label: 'Administrador',          placeholder: 'Nombre del administrador',        type: 'text' },
  { name: 'direccion',          label: 'Dirección',              placeholder: 'Ej: Upala, Alajuela, Costa Rica', type: 'text' },
  { name: 'whatsapp',           label: 'Teléfono / WhatsApp',    placeholder: 'Ej: +506 8888-8888',              type: 'tel'  },
  { name: 'correo',             label: 'Correo electrónico',     placeholder: 'Ej: contacto@fincaaurora.com',    type: 'email' },
];

// Días de desarrollo: rango espejo de NUMERIC_RANGES en schemas.js [1, 3650].
const MAX_DIAS = 3650;
export const TIMING_FIELDS = [
  { name: 'diasIDesarrollo',  label: 'Días de desarrollo — I Cosecha',  default: 250, min: 1, max: MAX_DIAS, step: 1 },
  { name: 'diasIIDesarrollo', label: 'Días de desarrollo — II Cosecha', default: 215, min: 1, max: MAX_DIAS, step: 1 },
  { name: 'diasPostForza',    label: 'Días post-forza',                 default: 150, min: 1, max: MAX_DIAS, step: 1 },
];

const TIMING_DEFAULTS = Object.fromEntries(TIMING_FIELDS.map(f => [f.name, f.default]));

export const EMPTY_FORM = {
  nombreEmpresa: '', identificacion: '', representanteLegal: '', administrador: '',
  direccion: '', whatsapp: '', correo: '',
  ...TIMING_DEFAULTS,
};

// Límites de validación de logo (espejo de la UI/back). Aceptamos los 3 tipos
// que el backend permite: png, jpeg y webp.
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

// Mapea la respuesta de /api/config al shape del form, completando con defaults.
export function fromApi(data) {
  const next = { ...EMPTY_FORM };
  for (const f of COMPANY_FIELDS) next[f.name] = data[f.name] || '';
  for (const f of TIMING_FIELDS) next[f.name] = data[f.name] ?? f.default;
  return next;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Devuelve las claves inválidas del form (para marcarlas en rojo). El backend
// también valida, pero chequear en cliente evita un round-trip y da feedback
// campo a campo en vez de un toast genérico.
export function getInvalidKeys(form) {
  const invalid = [];
  const correo = String(form.correo ?? '').trim();
  if (correo && !EMAIL_RE.test(correo)) invalid.push('correo');
  for (const f of TIMING_FIELDS) {
    const raw = form[f.name];
    const n = Number(raw);
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) { invalid.push(f.name); continue; }
    if (!Number.isInteger(n) || n < f.min || n > f.max) invalid.push(f.name);
  }
  return invalid;
}

// Compara dos snapshots y dice si hay cambios sin guardar (strings exactos,
// números laxos para que '250' y 250 no cuenten como cambio).
export function hasUnsavedChanges(saved, form) {
  for (const f of COMPANY_FIELDS) {
    if ((saved[f.name] || '') !== (form[f.name] || '')) return true;
  }
  for (const f of TIMING_FIELDS) {
    if (Number(saved[f.name]) !== Number(form[f.name])) return true;
  }
  return false;
}
