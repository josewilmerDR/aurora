// ── Definición canónica de parámetros del sistema (frontend) ─────────────────
//
// Fuente única del FRONTEND para el set de parámetros de cultivo que edita la
// página Parameters. Espejo de las claves numéricas que persiste el backend en
// functions/routes/config.js (CONFIG_NUMERIC_KEYS) — no hay módulo compartido
// FE↔BE, así que al sumar un parámetro hay que tocar ambos lados.
//
// Helpers puros (fromApi / formatValue / getInvalidParams) viven acá para
// mantener la página delgada y poder testearlos sin montar el componente.

export const SECTIONS = [
  {
    title: 'Tiempos de Cosecha',
    // Estos días sólo alimentan el cálculo de fechas estimadas en las cédulas
    // (cedulas-helpers / field-records). Las proyecciones por grupo usan los
    // días de desarrollo de Ajustes de cuenta, por eso lo aclaramos en la UI.
    note: 'Estos días alimentan las fechas estimadas de cosecha en las cédulas. Las proyecciones por grupo usan los días de desarrollo configurados en Ajustes de cuenta.',
    params: [
      { key: 'diasSiembraICosecha', label: 'Días desde siembra hasta I Cosecha', unit: 'días', default: 400, min: 1, step: 1 },
      { key: 'diasForzaICosecha',   label: 'Días desde forza hasta I Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      // default alineado con el fallback real del cálculo (cedulas-helpers.js,
      // field-records/{apply,create}.js usan 215). Antes la UI mostraba 365 y
      // el cálculo usaba 215 → el admin leía un número y el sistema usaba otro.
      { key: 'diasChapeaIICosecha',  label: 'Días desde chapea hasta II Cosecha',  unit: 'días', default: 215, min: 1, step: 1 },
      { key: 'diasForzaIICosecha',   label: 'Días desde forza hasta II Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      // Nota: las cosechas III+ (caña hasta 5, piña extendida tras valoración)
      // todavía no tienen consumo en los cálculos de cédulas/proyección, así que
      // no exponemos días editables que no moverían nada. Reintroducir cuando
      // exista el modelo multi-cosecha robusto.
    ],
  },
  {
    title: 'Producción',
    params: [
      { key: 'plantasPorHa',    label: 'Plantas por Ha.',              unit: 'plantas', default: 65000,  min: 1,   step: 1    },
      { key: 'kgPorCaja',        label: 'Kg/Caja',                             unit: 'kg', default: 12,  min: 0, step: 0.1  },
      { key: 'kgPorPlanta',      label: 'Kg estimados por planta - I Cosecha',  unit: 'kg', default: 1.8, min: 0, step: 0.01 },
      { key: 'kgPorPlantaII',   label: 'Kg estimados por planta - II Cosecha', unit: 'kg', default: 1.6, min: 0, step: 0.01 },
      { key: 'kgPorPlantaIII',  label: 'Kg estimados por planta - III Cosecha',unit: 'kg', default: 1.5, min: 0, step: 0.01 },
      { key: 'rechazoICosecha',       label: 'Rechazo estimado — I Cosecha',        unit: '%', default: 10, min: 0, max: 100, step: 0.1 },
      { key: 'rechazoIICosecha',      label: 'Rechazo estimado — II Cosecha',       unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
      { key: 'rechazoIIICosecha',     label: 'Rechazo estimado — III Cosecha',      unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadICosecha',    label: 'Mortalidad en primera cosecha',       unit: '%', default: 2,  min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadIICosecha',   label: 'Mortalidad en segunda cosecha',       unit: '%', default: 10, min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadIIICosecha',  label: 'Mortalidad en tercera cosecha',       unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
    ],
  },
];

export const ALL_PARAMS = SECTIONS.flatMap(s => s.params);
export const DEFAULTS   = Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));

// Mapea la respuesta de /api/config al shape del draft, completando con los
// defaults las claves que el doc todavía no tenga.
export function fromApi(data) {
  return Object.fromEntries(ALL_PARAMS.map(p => [p.key, data[p.key] ?? p.default]));
}

// Formato con separador de miles local (es-CR), consistente con el resto de la
// app. Si el valor no es numérico lo devuelve crudo para no romper el render.
export function formatValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('es-CR') : value;
}

// Devuelve los params cuyo valor en el draft es inválido: vacío, no numérico, o
// fuera del rango [min, max]. El backend hace Number() y convertiría '' en 0,
// así que validamos en cliente antes de guardar para no envenenar las
// proyecciones (p.ej. mortalidad > 100% daría Kg negativos).
export function getInvalidParams(draft) {
  return ALL_PARAMS.filter(p => {
    const raw = draft[p.key];
    if (raw === '' || raw === null || raw === undefined) return true;
    const n = Number(raw);
    if (!Number.isFinite(n)) return true;
    if (p.min != null && n < p.min) return true;
    if (p.max != null && n > p.max) return true;
    return false;
  });
}

// True si algún parámetro del draft difiere del guardado (comparación numérica
// laxa para que '12' y 12 no cuenten como cambio).
export function hasUnsavedChanges(saved, draft) {
  return ALL_PARAMS.some(p => Number(saved[p.key]) !== Number(draft[p.key]));
}

// Claves que cambiaron entre dos snapshots (para resaltar las filas guardadas).
export function changedKeys(before, after) {
  return ALL_PARAMS.filter(p => Number(before[p.key]) !== Number(after[p.key])).map(p => p.key);
}
