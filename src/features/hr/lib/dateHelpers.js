// Helpers de fecha puros compartidos por las páginas de RRHH (Asistencia,
// LeaveRequests). Antes vivían duplicados byte a byte inline en cada página;
// centralizarlos evita que divergan y permite testearlos sin montar React.

/** Fecha de hoy en formato YYYY-MM-DD usando la zona horaria local. */
export const todayLocal = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Fecha de hace `n` días en formato YYYY-MM-DD (zona local). */
export const dateNDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
