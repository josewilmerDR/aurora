// Diff puro entre dos `sections` de annual_plans. Resultado alimenta el
// `changelog` de la versión nueva: cada entry describe qué cambió en cada
// sección, útil para auditoría humana y para que el frontend renderice
// "qué está proponiendo Claude cambiar".
//
// Formato de salida:
//   {
//     added:    { [section]: [items] },   // items presentes en `next` que no estaban en `prev`
//     removed:  { [section]: [items] },   // items presentes en `prev` que ya no están
//     modified: { [section]: [{key, prev, next}] },  // items con mismo identificador pero contenido distinto
//     replaced: { [section]: {prev, next} },        // objetos escalares (presupuesto, escenarioBase)
//     sectionsChanged: [string],           // nombres de secciones con cambios
//   }
//
// Identificadores por sección:
//   cultivos    → loteId
//   rotaciones  → recommendationId
//   hitos       → fecha+descripcion (compuesto)
//   supuestos   → valor completo (equality)
//
// `presupuesto` y `escenarioBase` son objetos escalares → diff por replace.

function idOf(section, item) {
  if (section === 'cultivos') return item?.loteId || null;
  if (section === 'rotaciones') return item?.recommendationId || null;
  if (section === 'hitos') return `${item?.fecha || ''}::${item?.descripcion || ''}`;
  if (section === 'supuestos') return typeof item === 'string' ? item : null;
  return null;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    } else if (typeof va === 'object' && typeof vb === 'object' && va && vb) {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    } else if (va !== vb) {
      return false;
    }
  }
  return true;
}

function diffArraySection(section, prevArr, nextArr) {
  const prevMap = new Map();
  const nextMap = new Map();
  for (const item of prevArr || []) {
    const id = idOf(section, item);
    if (id != null) prevMap.set(id, item);
  }
  for (const item of nextArr || []) {
    const id = idOf(section, item);
    if (id != null) nextMap.set(id, item);
  }

  const added = [];
  const removed = [];
  const modified = [];

  for (const [id, item] of nextMap) {
    if (!prevMap.has(id)) {
      added.push(item);
    } else if (section !== 'supuestos' && !shallowEqual(prevMap.get(id), item)) {
      modified.push({ key: id, prev: prevMap.get(id), next: item });
    }
  }
  for (const [id, item] of prevMap) {
    if (!nextMap.has(id)) removed.push(item);
  }
  return { added, removed, modified };
}

function diffObjectSection(prev, next) {
  if (shallowEqual(prev || null, next || null)) return null;
  return { prev: prev || null, next: next || null };
}

function diffSections(prevSections = {}, nextSections = {}) {
  const added = {};
  const removed = {};
  const modified = {};
  const replaced = {};
  const sectionsChanged = new Set();

  for (const section of ['cultivos', 'rotaciones', 'hitos', 'supuestos']) {
    const prevArr = Array.isArray(prevSections[section]) ? prevSections[section] : [];
    const nextArr = Array.isArray(nextSections[section]) ? nextSections[section] : [];
    if (prevArr.length === 0 && nextArr.length === 0) continue;
    const d = diffArraySection(section, prevArr, nextArr);
    if (d.added.length > 0) { added[section] = d.added; sectionsChanged.add(section); }
    if (d.removed.length > 0) { removed[section] = d.removed; sectionsChanged.add(section); }
    if (d.modified.length > 0) { modified[section] = d.modified; sectionsChanged.add(section); }
  }

  for (const section of ['presupuesto', 'escenarioBase']) {
    const d = diffObjectSection(prevSections[section], nextSections[section]);
    if (d) { replaced[section] = d; sectionsChanged.add(section); }
  }

  return {
    added, removed, modified, replaced,
    sectionsChanged: Array.from(sectionsChanged),
  };
}

// Resumen textual del diff, útil para changelog.razon (corto, una línea por
// sección).
function summarizeDiff(diff) {
  if (!diff || diff.sectionsChanged.length === 0) return 'Sin cambios.';
  const parts = [];
  for (const section of diff.sectionsChanged) {
    if (section === 'presupuesto' || section === 'escenarioBase') {
      parts.push(`${section}: actualizado`);
    } else {
      const a = diff.added?.[section]?.length || 0;
      const r = diff.removed?.[section]?.length || 0;
      const m = diff.modified?.[section]?.length || 0;
      const bits = [];
      if (a) bits.push(`+${a}`);
      if (r) bits.push(`-${r}`);
      if (m) bits.push(`~${m}`);
      parts.push(`${section}: ${bits.join(' ')}`);
    }
  }
  return parts.join(' · ');
}

module.exports = {
  diffSections,
  summarizeDiff,
  _idOf: idOf,
  _shallowEqual: shallowEqual,
};
