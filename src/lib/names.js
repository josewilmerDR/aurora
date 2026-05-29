// Helpers puros de presentación de nombres de persona. Sin React ni fetch.
// Centralizan lo que antes estaba duplicado entre UserManagement (admin) y
// employeeProfileShared (hr), para que avatar e iniciales se calculen igual
// en toda la app.

// Iniciales para el avatar: "Juan Pérez" → "JP", "Madonna" → "MA".
export const getInitials = (nombre) => {
  if (!nombre) return '?';
  const parts = nombre.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Primer nombre para labels compactos (ej. burbujas del carrusel móvil).
export const firstName = (nombre) => {
  if (!nombre || typeof nombre !== 'string') return '';
  return nombre.trim().split(/\s+/)[0] || '';
};
