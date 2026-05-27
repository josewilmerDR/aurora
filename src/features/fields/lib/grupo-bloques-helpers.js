// Helpers de dominio para Grupos. Hoy son consumidos por GrupoManagement
// (lookup en el hub del grupo seleccionado), GrupoPreviewModal (lookup en
// el documento del PDF) y futuras extracciones del refactor del #12 del
// audit. Si emergen nuevos consumers que necesitan estas mismas reglas
// (e.g. dashboard de grupos), importar de acá.

import { tsToDate } from './lotes-helpers';

// Consolida un arreglo de siembras (varios registros para el mismo
// lote+bloque) en una fila única por bloque físico. Las áreas y plantas
// se suman; los materiales/variedades distintos se concatenan con " · ".
// Filtra entradas falsy para tolerar `.map(id => siembrasById.get(id))`
// donde algún id quedó huérfano.
export function consolidateSiembrasByBloque(siembras) {
  const map = new Map();
  for (const s of siembras) {
    if (!s) continue;
    const key = `${s.loteId}__${s.bloque}`;
    if (!map.has(key)) {
      map.set(key, {
        id: `${s.loteId}__${s.bloque}`,
        siembraIds: [],
        loteId: s.loteId,
        loteNombre: s.loteNombre || s.loteId,
        bloque: s.bloque,
        plantas: 0,
        areaCalculada: 0,
        _materiales: new Set(),
        _variedades: new Set(),
      });
    }
    const entry = map.get(key);
    entry.siembraIds.push(s.id);
    entry.plantas += (s.plantas || 0);
    entry.areaCalculada += (parseFloat(s.areaCalculada) || 0);
    if (s.materialNombre) entry._materiales.add(s.materialNombre);
    if (s.variedad) entry._variedades.add(s.variedad);
  }
  return [...map.values()].map(e => {
    const materialNombre = [...e._materiales].join(' · ');
    const variedad = [...e._variedades].join(' · ');
    delete e._materiales;
    delete e._variedades;
    return { ...e, materialNombre, variedad };
  });
}

// Calcula la fecha estimada de cosecha sumando días al fechaCreacion según
// la etapa/cosecha del grupo. Los días por defecto (150 post-forza, 215
// cosecha II, 250 cosecha I) son sobrescribibles desde empresaConfig en
// `/config` — esto permite que cada finca calibre sus tiempos sin tocar
// código.
export function calcFechaCosecha(grupo, config) {
  const etapa   = (grupo.etapa   || '').toLowerCase();
  const cosecha = (grupo.cosecha || '').toLowerCase();
  let dias;
  if (etapa.includes('postforza') || etapa.includes('post forza')) {
    dias = config.diasPostForza ?? 150;
  } else if (cosecha.includes('ii') || cosecha.includes('2')) {
    dias = config.diasIIDesarrollo ?? 215;
  } else {
    dias = config.diasIDesarrollo ?? 250;
  }
  const base = tsToDate(grupo.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + dias);
  return result;
}
