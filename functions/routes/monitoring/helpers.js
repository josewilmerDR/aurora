// Monitoring — sanitizers compartidos.
//
// Sub-archivo del split de routes/monitoring.js. Aglomera los validators
// de plantillas de monitoreo (tipos), paquetes, y constantes que más de
// un sub-archivo usa.

const VALID_FIELD_TYPES = ['texto', 'numero', 'fecha'];
const MAX_NOMBRE_PLANTILLA = 60;
const MAX_NOMBRE_CAMPO = 40;
const MAX_CAMPOS_PERSONALIZADOS = 50;

const MAX_NOMBRE_PAQUETE = 40;
const MAX_DESCRIPCION = 500;
const MAX_TECNICO = 80;
const MAX_ACTIVITY_NAME = 80;
const MAX_ACTIVITY_RESPONSABLE_ID = 80;
const MAX_ACTIVITIES = 100;
const MAX_FORMULARIOS_X_ACTIVITY = 20;
const MAX_TIPO_ID = 40;
const MAX_TIPO_NOMBRE = 60;
const MAX_DAY = 9999;

const MEDIA_TYPES_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_OBSERVACIONES = 2000;
const MAX_REGISTROS_ROWS = 500;
const MAX_REGISTRO_VALUE = 500;
const MAX_SCAN_IMAGE_BASE64 = 8 * 1024 * 1024; // ~6MB de imagen binaria
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_MONITOREO_STR = 200;
const MAX_MONITOREO_OBS = 2000;

const sanitizeCampos = (campos) => {
  if (!Array.isArray(campos)) return { ok: true, value: [] };
  if (campos.length > MAX_CAMPOS_PERSONALIZADOS) {
    return { ok: false, message: `Max ${MAX_CAMPOS_PERSONALIZADOS} custom fields.` };
  }
  const out = [];
  for (const c of campos) {
    if (!c || typeof c !== 'object') {
      return { ok: false, message: 'Invalid fields format.' };
    }
    const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
    if (!nombre) return { ok: false, message: 'All fields must have a name.' };
    if (nombre.length > MAX_NOMBRE_CAMPO) {
      return { ok: false, message: `Field name exceeds ${MAX_NOMBRE_CAMPO} characters.` };
    }
    if (!VALID_FIELD_TYPES.includes(c.tipo)) {
      return { ok: false, message: 'Invalid field type.' };
    }
    out.push({ nombre, tipo: c.tipo });
  }
  return { ok: true, value: out };
};

const sanitizeNombre = (nombre) => {
  if (typeof nombre !== 'string') return { ok: false, message: 'Name is required.' };
  const trimmed = nombre.trim();
  if (!trimmed) return { ok: false, message: 'Name is required.' };
  if (trimmed.length > MAX_NOMBRE_PLANTILLA) {
    return { ok: false, message: `Name exceeds ${MAX_NOMBRE_PLANTILLA} characters.` };
  }
  return { ok: true, value: trimmed };
};

const sanitizePaquete = (body) => {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Body inválido.' };

  const nombre = typeof body.nombrePaquete === 'string' ? body.nombrePaquete.trim() : '';
  if (!nombre) return { ok: false, message: 'nombrePaquete es requerido.' };
  if (nombre.length > MAX_NOMBRE_PAQUETE) {
    return { ok: false, message: `nombrePaquete excede ${MAX_NOMBRE_PAQUETE} caracteres.` };
  }

  const descripcion = body.descripcion == null ? '' : String(body.descripcion);
  if (descripcion.length > MAX_DESCRIPCION) {
    return { ok: false, message: `descripcion excede ${MAX_DESCRIPCION} caracteres.` };
  }

  const tecnico = body.tecnicoResponsable == null ? '' : String(body.tecnicoResponsable);
  if (tecnico.length > MAX_TECNICO) {
    return { ok: false, message: `tecnicoResponsable excede ${MAX_TECNICO} caracteres.` };
  }

  const rawActivities = Array.isArray(body.activities) ? body.activities : [];
  if (rawActivities.length > MAX_ACTIVITIES) {
    return { ok: false, message: `Máximo ${MAX_ACTIVITIES} actividades.` };
  }

  const activities = [];
  for (const a of rawActivities) {
    if (!a || typeof a !== 'object') return { ok: false, message: 'Actividad inválida.' };
    const dayNum = Number(a.day);
    if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > MAX_DAY) {
      return { ok: false, message: 'El día de actividad debe ser un entero entre 0 y 9999.' };
    }
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (!name) return { ok: false, message: 'Toda actividad debe tener nombre.' };
    if (name.length > MAX_ACTIVITY_NAME) {
      return { ok: false, message: `Nombre de actividad excede ${MAX_ACTIVITY_NAME} caracteres.` };
    }
    const responsableId = typeof a.responsableId === 'string' ? a.responsableId.slice(0, MAX_ACTIVITY_RESPONSABLE_ID) : '';

    const rawForms = Array.isArray(a.formularios) ? a.formularios : [];
    if (rawForms.length > MAX_FORMULARIOS_X_ACTIVITY) {
      return { ok: false, message: `Máximo ${MAX_FORMULARIOS_X_ACTIVITY} plantillas por actividad.` };
    }
    const seenTipos = new Set();
    const formularios = [];
    for (const f of rawForms) {
      if (!f || typeof f !== 'object') continue;
      const tipoId = typeof f.tipoId === 'string' ? f.tipoId.slice(0, MAX_TIPO_ID) : '';
      if (!tipoId || seenTipos.has(tipoId)) continue;
      const tipoNombre = typeof f.tipoNombre === 'string' ? f.tipoNombre.slice(0, MAX_TIPO_NOMBRE) : '';
      seenTipos.add(tipoId);
      formularios.push({ tipoId, tipoNombre });
    }

    activities.push({ day: dayNum, name, responsableId, formularios });
  }

  return {
    ok: true,
    value: { nombrePaquete: nombre, descripcion, tecnicoResponsable: tecnico, activities },
  };
};

const parseIsoDate = (s) => {
  if (!s || !DATE_ISO_RE.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  return isNaN(d.getTime()) ? null : d;
};

module.exports = {
  // Constants
  VALID_FIELD_TYPES, MAX_NOMBRE_PLANTILLA, MAX_NOMBRE_CAMPO, MAX_CAMPOS_PERSONALIZADOS,
  MAX_NOMBRE_PAQUETE, MAX_DESCRIPCION, MAX_TECNICO, MAX_ACTIVITY_NAME,
  MAX_ACTIVITY_RESPONSABLE_ID, MAX_ACTIVITIES, MAX_FORMULARIOS_X_ACTIVITY,
  MAX_TIPO_ID, MAX_TIPO_NOMBRE, MAX_DAY,
  MEDIA_TYPES_IMG, MAX_OBSERVACIONES, MAX_REGISTROS_ROWS, MAX_REGISTRO_VALUE,
  MAX_SCAN_IMAGE_BASE64, DATE_ISO_RE,
  MAX_MONITOREO_STR, MAX_MONITOREO_OBS,
  // Validators
  sanitizeCampos, sanitizeNombre, sanitizePaquete,
  // Date helpers
  parseIsoDate,
};
