// Identidad del inquilino (empresa/finca) para documentos imprimibles.
//
// Única fuente de verdad para (1) la cascada de nombre y (2) el saneo de
// logoUrl. Antes había CUATRO implementaciones distintas del saneo (Cedula,
// GrupoPreview, UnitPayroll, SiembraHistorial) y cuatro sitios sin ninguna
// (LotePreview, FixedPayroll, OCNueva, OCHistorial), más el nombre de la
// finca de pruebas hardcodeado como fallback en nueve documentos — imprimir
// el nombre de otra empresa es peor que un documento incompleto. El guard de
// CI (scripts/check-tenant-literal.cjs) impide que el literal vuelva.

// Default-deny: https siempre; http solo loopback (emulador de Storage en
// dev); data:image/ para logos legacy embebidos. Todo lo demás (javascript:,
// file:, data: no-imagen, rutas relativas) cae al placeholder de iniciales.
// El logo puede venir de una escritura directa vía Admin SDK/consola, así
// que el sink no confía en que el backend ya haya validado.
export const sanitizeLogoUrl = (url) => {
  if (typeof url !== 'string' || url === '') return '';
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) return url;
  if (/^data:image\//i.test(url)) return url;
  return '';
};

// Iniciales del nombre para el placeholder de logo (máx 2 chars). Sin nombre
// no inventamos marca ("AU" sugería Aurora en fincas ajenas): guion neutro.
export const empresaInitials = (nombre) => {
  const txt = typeof nombre === 'string' ? nombre.trim() : '';
  if (!txt) return '—';
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

// Cascada de identidad: nombreEmpresa configurado → nombre de la organización
// (fincaNombre de /api/auth/me, visible para cualquier rol autenticado).
// `missingIdentity` marca que se está usando el fallback — la UI muestra un
// aviso NO imprimible con enlace a configuración (IdentityNotice).
export const resolveEmpresa = (config = {}, fincaNombre = '') => {
  const cfg = config || {};
  const propio = typeof cfg.nombreEmpresa === 'string' ? cfg.nombreEmpresa.trim() : '';
  const org = typeof fincaNombre === 'string' ? fincaNombre.trim() : '';
  return {
    nombre: propio || org,
    missingIdentity: !propio,
    identificacion: cfg.identificacion || '',
    whatsapp: cfg.whatsapp || '',
    correo: cfg.correo || '',
    direccion: cfg.direccion || '',
    logoUrl: sanitizeLogoUrl(cfg.logoUrl),
  };
};
