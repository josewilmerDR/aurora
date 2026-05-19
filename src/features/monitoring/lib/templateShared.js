export const TIPO_OPTIONS = [
  { value: 'texto',  label: 'Texto' },
  { value: 'numero', label: 'Número' },
  { value: 'fecha',  label: 'Fecha' },
];

export const DEFAULT_CAMPOS = [
  { nombre: 'F. Programada', tipo: 'fecha' },
  { nombre: 'F. Muestreo',   tipo: 'fecha' },
  { nombre: 'Muestreador',   tipo: 'texto' },
  { nombre: 'Supervisor',    tipo: 'texto' },
  { nombre: 'Lote',          tipo: 'texto' },
  { nombre: 'Grupo',         tipo: 'texto' },
  { nombre: 'Notas',         tipo: 'texto' },
];

export const MAX_NOMBRE_PLANTILLA = 60;
export const MAX_NOMBRE_CAMPO = 40;

export const emptyCampo = () => ({ nombre: '', tipo: 'numero' });

/**
 * Validación por campo — útil para inline rendering. Devuelve un objeto con
 * el error de `nombre` (si lo hay) y un mapa `campos` con errores por índice.
 * Para validación pre-submit usá `sanitizePayload` que también recorta y
 * normaliza los datos.
 */
export function validatePayload(nombre, campos) {
  const errors = { nombre: undefined, campos: {} };
  const trimmedNombre = (nombre || '').trim();
  if (!trimmedNombre) {
    errors.nombre = 'El nombre es obligatorio.';
  } else if (trimmedNombre.length > MAX_NOMBRE_PLANTILLA) {
    errors.nombre = `El nombre excede ${MAX_NOMBRE_PLANTILLA} caracteres.`;
  }
  (campos || []).forEach((c, i) => {
    const nom = (c.nombre || '').trim();
    if (!nom) {
      errors.campos[i] = 'Este campo no puede quedar sin nombre.';
    } else if (nom.length > MAX_NOMBRE_CAMPO) {
      errors.campos[i] = `El nombre excede ${MAX_NOMBRE_CAMPO} caracteres.`;
    }
  });
  return errors;
}

export function hasValidationErrors(errors) {
  if (!errors) return false;
  if (errors.nombre) return true;
  return Object.keys(errors.campos || {}).length > 0;
}

export function sanitizePayload(nombre, campos) {
  const trimmedNombre = (nombre || '').trim();
  if (!trimmedNombre) return { ok: false, message: 'El nombre es obligatorio.' };
  if (trimmedNombre.length > MAX_NOMBRE_PLANTILLA) {
    return { ok: false, message: `El nombre excede ${MAX_NOMBRE_PLANTILLA} caracteres.` };
  }
  const cleanCampos = [];
  for (const c of (campos || [])) {
    const nom = (c.nombre || '').trim();
    if (!nom) return { ok: false, message: 'Todos los campos deben tener nombre.' };
    if (nom.length > MAX_NOMBRE_CAMPO) {
      return { ok: false, message: `Nombre de campo excede ${MAX_NOMBRE_CAMPO} caracteres.` };
    }
    cleanCampos.push({ nombre: nom, tipo: c.tipo });
  }
  return { ok: true, nombre: trimmedNombre, campos: cleanCampos };
}
