// Helpers de fecha del dominio harvest. Antes vivían sólo en
// CosechaRegistroModal; CosechaDespachoModal usaba toISOString() (UTC) y no
// validaba fechas inexistentes. Punto #7 audit.

// Fecha local en formato YYYY-MM-DD (sin shift por UTC). Usar esto en vez de
// new Date().toISOString().slice(0,10), que en husos al oeste de UTC puede
// devolver el día siguiente cerca de medianoche.
export const toLocalISODate = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const todayISO = () => toLocalISODate(new Date());

// Validación estricta: rechaza fechas inexistentes ("2026-02-30").
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isValidISODate = (s) => {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
};
