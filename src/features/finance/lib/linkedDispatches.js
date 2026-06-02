// Extracción de despachos ya ligados a un ingreso. La misma lógica vivía
// duplicada en CosechaDespachos, DispatchesSelect e IncomeForm — cada
// consumidor tenía que recordar manejar tanto `despachoIds[]` (modelo nuevo)
// como `despachoId` singular (legacy). Centralizado acá. Puntos #9 y #19 audit.

// Itera los ingresos y construye un Map id-de-despacho → id-de-ingreso que lo
// liga. Permite además navegar al ingreso desde el despacho. `excludeIncomeId`
// ignora un ingreso concreto (útil al editar: no contar sus propios despachos
// como "ya ligados").
export function buildDispatchIncomeMap(incomeData, { excludeIncomeId = null } = {}) {
  const map = new Map();
  if (!Array.isArray(incomeData)) return map;
  for (const inc of incomeData) {
    if (excludeIncomeId && inc.id === excludeIncomeId) continue;
    if (Array.isArray(inc.despachoIds)) {
      for (const d of inc.despachoIds) if (d?.id) map.set(d.id, inc.id);
    }
    if (inc.despachoId) map.set(inc.despachoId, inc.id);
  }
  return map;
}

// Variante que sólo necesita el conjunto de IDs ligados (sin a qué ingreso).
export function extractLinkedDispatchIds(incomeData, opts) {
  return new Set(buildDispatchIncomeMap(incomeData, opts).keys());
}
