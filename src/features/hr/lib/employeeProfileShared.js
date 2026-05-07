// Constantes y helpers compartidos por EmployeeProfile y sus componentes
// extraídos (form, hub panel, list panel). Mantenerlos en un módulo
// separado evita duplicación y permite testear la lógica pura sin
// montar componentes React.

export const DIAS_SEMANA = [
  { key: 'lunes',     label: 'Lunes',     letra: 'L' },
  { key: 'martes',    label: 'Martes',    letra: 'M' },
  { key: 'miercoles', label: 'Miércoles', letra: 'M' },
  { key: 'jueves',    label: 'Jueves',    letra: 'J' },
  { key: 'viernes',   label: 'Viernes',   letra: 'V' },
  { key: 'sabado',    label: 'Sábado',    letra: 'S' },
  { key: 'domingo',   label: 'Domingo',   letra: 'D' },
];

export const DIAS_LABORALES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
export const TIPOS_CONTRATO = ['permanente', 'temporal', 'por_obra'];
export const ROLES_VALIDOS = ['ninguno', 'trabajador', 'encargado', 'supervisor', 'administrador'];

export const EMPTY_HORARIO = Object.fromEntries(
  DIAS_SEMANA.map(d => [d.key, { activo: false, inicio: '', fin: '' }])
);

export const EMPTY_FICHA = {
  puesto: '', departamento: '', fechaIngreso: '', tipoContrato: 'permanente',
  salarioBase: '', precioHora: '', cedula: '', encargadoId: '',
  direccion: '', contactoEmergencia: '', telefonoEmergencia: '',
  notas: '',
  horarioSemanal: EMPTY_HORARIO,
};

export const EMPTY_USER = { nombre: '', email: '', telefono: '', rol: 'trabajador' };

export const LIMITS = {
  nombre: 80, email: 120, telefono: 20, cedula: 30,
  puesto: 80, departamento: 80, direccion: 200,
  contactoEmergencia: 80, telefonoEmergencia: 20, notas: 2000,
};

export const SALARIO_MAX = 10_000_000;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[\d\s+\-()]+$/;

export const DRAFT_KEY = 'aurora_hr_ficha_draft';

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function calcHorasSemanales(horario = {}) {
  return DIAS_SEMANA.reduce((sum, { key }) => {
    const dia = horario[key];
    if (!dia?.activo || !dia.inicio || !dia.fin) return sum;
    const [h1, m1] = dia.inicio.split(':').map(Number);
    const [h2, m2] = dia.fin.split(':').map(Number);
    return sum + Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
  }, 0);
}

export const getInitials = (nombre) => {
  if (!nombre) return '?';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export function validateForms(userForm, fichaForm) {
  const errors = {};

  const nombre = (userForm.nombre || '').trim();
  if (nombre.length < 2) errors.nombre = 'Mínimo 2 caracteres.';
  else if (nombre.length > LIMITS.nombre) errors.nombre = `Máximo ${LIMITS.nombre} caracteres.`;

  const email = (userForm.email || '').trim();
  if (!email) errors.email = 'Email requerido.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Email con formato inválido.';
  else if (email.length > LIMITS.email) errors.email = `Máximo ${LIMITS.email} caracteres.`;

  const tel = (userForm.telefono || '').trim();
  if (tel) {
    if (!PHONE_RE.test(tel)) errors.telefono = 'Solo dígitos, espacios, +, -, ( ).';
    else if (tel.length > LIMITS.telefono) errors.telefono = `Máximo ${LIMITS.telefono} caracteres.`;
  }

  if (!ROLES_VALIDOS.includes(userForm.rol)) errors.rol = 'Rol inválido.';

  ['cedula', 'puesto', 'departamento', 'direccion', 'contactoEmergencia', 'notas'].forEach((k) => {
    const v = fichaForm[k];
    if (typeof v === 'string' && v.length > LIMITS[k]) errors[k] = `Máximo ${LIMITS[k]} caracteres.`;
  });

  const telEm = (fichaForm.telefonoEmergencia || '').trim();
  if (telEm) {
    if (!PHONE_RE.test(telEm)) errors.telefonoEmergencia = 'Formato inválido.';
    else if (telEm.length > LIMITS.telefonoEmergencia) errors.telefonoEmergencia = `Máximo ${LIMITS.telefonoEmergencia} caracteres.`;
  }

  if (fichaForm.fechaIngreso) {
    const d = new Date(fichaForm.fechaIngreso);
    if (Number.isNaN(d.getTime())) {
      errors.fechaIngreso = 'Fecha inválida.';
    } else {
      const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
      if (d > hoy) errors.fechaIngreso = 'No puede ser futura.';
    }
  }

  ['salarioBase', 'precioHora'].forEach((k) => {
    const raw = fichaForm[k];
    if (raw === '' || raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) errors[k] = 'Debe ser un número ≥ 0.';
    else if (n > SALARIO_MAX) errors[k] = `Máximo ₡${SALARIO_MAX.toLocaleString('es-CR')}.`;
  });

  if (fichaForm.tipoContrato && !TIPOS_CONTRATO.includes(fichaForm.tipoContrato)) {
    errors.tipoContrato = 'Contrato inválido.';
  }

  DIAS_SEMANA.forEach(({ key, label }) => {
    const dia = fichaForm.horarioSemanal?.[key];
    if (!dia?.activo) return;
    if (!dia.inicio || !dia.fin) {
      errors[`horario_${key}`] = `${label}: ingrese entrada y salida.`;
      return;
    }
    if (toMinutes(dia.fin) <= toMinutes(dia.inicio)) {
      errors[`horario_${key}`] = `${label}: salida debe ser posterior a entrada.`;
    }
  });

  return errors;
}
