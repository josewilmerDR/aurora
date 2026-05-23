// ═══════════════════════════════════════════════════════════════════════════
// PACKAGES — Diff entre formData actual y el snapshot guardado
//
// Helpers extraídos de PackageManagement.jsx (Fase B del refactor — ver
// docs/code-standards.md §9 para el límite de 600 LOC en React pages).
//
// Identifica qué campos/actividades fueron modificados respecto al snapshot
// del servidor para que la UI pueda marcar dot indicators y mostrar el badge
// "N cambios sin guardar". Comparación por posición en activities: añadidas
// y modificadas se marcan en card; eliminadas se cuentan en el header pero
// no tienen card a marcar.
// ═══════════════════════════════════════════════════════════════════════════

export const PKG_DIFF_FIELDS = [
  'nombrePaquete',
  'descripcion',
  'tipoCosecha',
  'etapaCultivo',
  'tecnicoResponsable',
];

export function activitiesEqual(a, b) {
  if (!a || !b) return false;
  if ((a.name || '') !== (b.name || '')) return false;
  if (String(a.day ?? '') !== String(b.day ?? '')) return false;
  if ((a.responsableId || '') !== (b.responsableId || '')) return false;
  if ((a.calibracionId || '') !== (b.calibracionId || '')) return false;
  const aprods = a.productos || [];
  const bprods = b.productos || [];
  if (aprods.length !== bprods.length) return false;
  // Productos no tienen orden estable; sort por productoId antes de comparar.
  const sortByPid = (arr) => [...arr].sort((x, y) => (x.productoId || '').localeCompare(y.productoId || ''));
  const sA = sortByPid(aprods);
  const sB = sortByPid(bprods);
  for (let i = 0; i < sA.length; i++) {
    if (sA[i].productoId !== sB[i].productoId) return false;
    if (Number(sA[i].cantidadPorHa) !== Number(sB[i].cantidadPorHa)) return false;
  }
  return true;
}

export function computePackageChanges(current, original) {
  const empty = { count: 0, fields: new Set(), activities: new Set() };
  if (!original) return empty;
  const fields = new Set();
  for (const f of PKG_DIFF_FIELDS) {
    if ((current[f] || '') !== (original[f] || '')) fields.add(f);
  }
  const activities = new Set();
  const curActs = current.activities || [];
  const origActs = original.activities || [];
  let removed = 0;
  const maxLen = Math.max(curActs.length, origActs.length);
  for (let i = 0; i < maxLen; i++) {
    const cur = curActs[i];
    const orig = origActs[i];
    if (cur && !orig) activities.add(i);                 // añadida
    else if (!cur && orig) removed += 1;                  // eliminada (no card a marcar)
    else if (cur && orig && !activitiesEqual(cur, orig)) activities.add(i); // modificada
  }
  return {
    count: fields.size + activities.size + removed,
    fields,
    activities,
  };
}
