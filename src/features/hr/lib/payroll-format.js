// Formato compartido entre FixedPayroll, FixedPayrollReport y helpers de
// cálculo. Centralizado acá para que un cambio de moneda/locale o de la tasa
// legal no haya que replicarlo en cada página (antes vivía duplicado).

// CCSS: cuota obrera de la Caja Costarricense de Seguro Social sobre el bruto.
export const CCSS_RATE = 0.1083;

// Monto en colones, clampado a >= 0. Usar para columnas de salario/deducción
// donde un negativo no tiene sentido contable (paridad con el PDF/CSV).
export const fmt = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;

// Monto en colones SIN clampear: conserva el signo. Usar para el neto, que
// puede quedar negativo si las deducciones superan el bruto y el usuario
// necesita VERLO (no esconderlo como ₡0).
export const fmtSigned = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '-' : ''}₡${Math.abs(v).toLocaleString('es-CR')}`;
};

export const fmtDate  = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtShort = (d) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Normaliza cualquier fecha (ISO o 'YYYY-MM-DD...') al prefijo 'YYYY-MM-DD'.
export const dateStr = (s) => (s || '').substring(0, 10);
