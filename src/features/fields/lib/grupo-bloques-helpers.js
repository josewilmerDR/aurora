// Helpers de dominio para Grupos. Consumidos por GrupoManagement,
// GrupoHub (vía useGrupoBloqueTable), GrupoFormSheet y GrupoPreviewModal.
// Tener una sola fuente de verdad evita que un fix sobre "cómo se mergean
// las siembras por bloque" se aplique en un sitio y quede viejo en otro.

import { tsToDate } from './lotes-helpers';

// ── Consolidación por bloque físico (lote, bloque) ──────────────────────────
// Múltiples siembras pueden compartir un (loteId, bloque) cuando se hicieron
// capturas parciales o se sembraron materiales distintos. Acá las mergeamos
// en una fila única por bloque físico: las áreas y plantas se suman, los
// fields "extra" se controlan vía los hooks del segundo argumento.
//
// Los hooks permiten que cada callsite decida qué llevar al output sin
// duplicar el loop principal. Hay dos pistas separadas a propósito:
//   - Públicas (entry): viven en el objeto final.
//       initExtras(s)         · campos iniciales en la entrada nueva.
//       mergeExtras(entry, s) · mutación in-place de campos públicos.
//   - Privadas (acc): vivían como underscore-props mutables sobre la
//     entry (e.g. _materiales: new Set) hasta que finalize las borraba.
//     Ese patrón era frágil — un caller que leyera del Map entre el
//     loop y el .map(finalize) veía Sets, y un dev podía agregar otra
//     prop con el mismo nombre por accidente. Ahora viven en un Map
//     paralelo, completamente fuera de la entry pública.
//       initAcc(s)            · seed del acumulador privado por clave.
//       mergeAcc(acc, s)      · mutación in-place del acumulador.
//   - finalize(entry, acc)    · combina ambos en el objeto de salida.
//
// Output base: { id, key, ids, loteId, loteNombre, bloque, plantas,
//                areaCalculada, ...extras }. `id` y `key` son aliases del
// string `${loteId}__${bloque}` — los callsites históricos usaban uno u otro.
export function consolidateByBloque(items, hooks = {}) {
  const {
    initExtras   = () => ({}),
    initAcc      = () => null,
    mergeExtras  = () => {},
    mergeAcc     = () => {},
    finalize     = (entry) => entry,
  } = hooks;
  const map  = new Map();
  const accs = new Map();
  for (const s of items) {
    if (!s) continue;
    const key = `${s.loteId}__${s.bloque}`;
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        key,
        ids: [],
        loteId: s.loteId,
        loteNombre: s.loteNombre || s.loteId,
        bloque: s.bloque,
        plantas: 0,
        areaCalculada: 0,
        ...initExtras(s),
      });
      accs.set(key, initAcc(s));
    }
    const entry = map.get(key);
    const acc   = accs.get(key);
    entry.ids.push(s.id);
    entry.plantas += (s.plantas || 0);
    entry.areaCalculada += (parseFloat(s.areaCalculada) || 0);
    mergeExtras(entry, s);
    mergeAcc(acc, s);
  }
  return [...map.entries()].map(([key, entry]) => finalize(entry, accs.get(key)));
}

// Wrapper para siembras crudas del backend (endpoint /api/siembras).
// Los materiales y variedades distintos se concatenan con " · " porque un
// usuario que mira el hub/preview quiere ver TODO lo que se sembró en ese
// bloque, no solo el primer registro. Los Sets viven fuera de la entry
// pública en el Map paralelo de acumuladores — finalize() los lee de
// ahí, no necesita borrar nada de la entry.
export function consolidateSiembrasByBloque(siembras) {
  return consolidateByBloque(siembras, {
    initAcc: () => ({
      materiales: new Set(),
      variedades: new Set(),
    }),
    mergeAcc: (acc, s) => {
      if (s.materialNombre) acc.materiales.add(s.materialNombre);
      if (s.variedad)       acc.variedades.add(s.variedad);
    },
    finalize: (entry, acc) => ({
      ...entry,
      materialNombre: [...acc.materiales].join(' · '),
      variedad:       [...acc.variedades].join(' · '),
    }),
  });
}

// Wrapper para el endpoint /api/siembras/disponibles (enriquecido con
// metadata del grupo actual, estado de aplicación y conteos). Usado por
// el picker tabulado del form (libres → fuera de aplicación → en
// aplicación activa).
//
// Reglas distintas a las de siembras crudas:
//   - material / variedad: primer valor gana (no se concatenan porque el
//     endpoint ya devuelve uno solo coherente por siembra).
//   - estado: se promueve al más activo del grupo (en_aplicacion >
//     fuera_aplicacion > libre). En la práctica todas las siembras de un
//     (lote, bloque) comparten grupo y el merge es no-op, pero blindamos
//     el edge case.
//   - grupoActualId y campos asociados: el primer registro con valor gana.
export function consolidateBloquesDisponibles(bloquesDisponibles) {
  return consolidateByBloque(bloquesDisponibles, {
    initExtras: (s) => ({
      variedad: s.variedad || '',
      materialNombre: s.materialNombre || '',
      estado: 'libre',
      grupoActualId: null,
      grupoActualNombre: null,
      grupoActualEtapa: null,
      grupoActualCosecha: null,
      aplicacionesCompletadas: null,
      aplicacionesTotales: null,
    }),
    mergeExtras: (entry, s) => {
      if (s.estado === 'en_aplicacion') entry.estado = 'en_aplicacion';
      else if (s.estado === 'fuera_aplicacion' && entry.estado === 'libre') entry.estado = 'fuera_aplicacion';

      if (s.grupoActualId && !entry.grupoActualId) {
        entry.grupoActualId           = s.grupoActualId;
        entry.grupoActualNombre       = s.grupoActualNombre;
        entry.grupoActualEtapa        = s.grupoActualEtapa;
        entry.grupoActualCosecha      = s.grupoActualCosecha;
        entry.aplicacionesCompletadas = s.aplicacionesCompletadas;
        entry.aplicacionesTotales     = s.aplicacionesTotales;
      }
    },
  });
}

// ── Kg estimados por planta ──────────────────────────────────────────────
// Default 1.6 kg por planta. Cada finca puede sobrescribirlo desde
// empresaConfig.kgPorPlanta en /config (Parameters > Cultivo). Antes el
// 1.6 vivía hardcoded en 4 sitios (tabla del hub, footer del hub, preview
// totales, preview por fila) — un ajuste de promedio forzaba a tocar todo
// sin tipo compartido. Nota: CosechaProyeccion usa kgPorPlanta /
// kgPorPlantaII / kgPorPlantaIII según el tipo de cosecha; acá usamos
// solo el valor base porque la tabla muestra una proyección rápida sin
// distinguir cosecha. Si en algún momento se quiere refinar por cosecha,
// el call-site queda centralizado en un solo helper.
export function getKgPorPlanta(config) {
  return config?.kgPorPlanta ?? 1.6;
}

// ── Fecha estimada de cosecha ────────────────────────────────────────────
// Calcula sumando días al fechaCreacion según la etapa/cosecha del grupo.
// Los días por defecto (150 post-forza, 215 cosecha II, 250 cosecha I) son
// sobrescribibles desde empresaConfig en /config — esto permite que cada
// finca calibre sus tiempos sin tocar código.
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
