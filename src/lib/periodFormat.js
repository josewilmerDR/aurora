// Conversión entre formato canónico del backend y el formato que ve el usuario
// en español. El backend/Firestore siempre almacena canónico: YYYY, YYYY-Qn,
// YYYY-MM. La UI muestra: "2026", "T2 2026", "Abril 2026".

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MONTH_NAME_TO_INDEX = new Map(
  MONTHS_ES.map((m, i) => [m.toLowerCase(), i])
);

// Canónico → display ES. Si el input no se reconoce, se devuelve tal cual.
export function formatPeriod(period) {
  if (!period) return '';
  const s = String(period).trim();

  const mMonth = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (mMonth) {
    const idx = Number(mMonth[2]) - 1;
    return `${MONTHS_ES[idx]} ${mMonth[1]}`;
  }

  const mQ = /^(\d{4})-Q([1-4])$/.exec(s);
  if (mQ) return `T${mQ[2]} ${mQ[1]}`;

  if (/^\d{4}$/.test(s)) return s;

  return s;
}

// Display ES (u otras variantes comunes) → canónico. Devuelve null si no
// pudo interpretar el input.
export function parsePeriod(input) {
  if (!input) return null;
  const s = String(input).trim();

  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  if (/^\d{4}-Q[1-4]$/.test(s)) return s;

  const mTDash = /^(\d{4})-T([1-4])$/.exec(s);
  if (mTDash) return `${mTDash[1]}-Q${mTDash[2]}`;

  const mTSpace = /^T([1-4])\s+(\d{4})$/i.exec(s);
  if (mTSpace) return `${mTSpace[2]}-Q${mTSpace[1]}`;

  // "Abril 2026" | "Abril-2026" | "Abril - 2026"
  const mNamed = /^([a-záéíóú]+)\s*-?\s*(\d{4})$/i.exec(s);
  if (mNamed) {
    const idx = MONTH_NAME_TO_INDEX.get(mNamed[1].toLowerCase());
    if (idx !== undefined) {
      return `${mNamed[2]}-${String(idx + 1).padStart(2, '0')}`;
    }
  }

  return null;
}

// Etiqueta corta para burbujas / píldoras (carrusel móvil).
// "2026-04" → "ABR" · "2026-Q2" → "T2" · "2026" → "26".
export function shortPeriod(period) {
  if (!period) return '';
  const s = String(period).trim();
  const mMonth = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
  if (mMonth) return MONTHS_ES[Number(mMonth[2]) - 1].slice(0, 3).toUpperCase();
  const mQ = /^(\d{4})-Q([1-4])$/.exec(s);
  if (mQ) return `T${mQ[2]}`;
  if (/^\d{4}$/.test(s)) return s.slice(2);
  return s;
}

export { MONTHS_ES };
