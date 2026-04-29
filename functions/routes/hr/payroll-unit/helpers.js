// HR/payroll-unit — helpers locales.
//
// Sub-archivo del split de routes/hr/payroll-unit.js. Contiene la lógica de
// validación + enriquecimiento + cálculo de totales que sólo este sub-dominio
// usa. Los helpers cross-HR (limites, role gates, loaders) viven en
// `../helpers.js` y se re-exportan desde aquí cuando son necesarios.
//
//   - isHoraUnit          → ¿la unidad es "hora(s)"?
//   - computeWorkerTotal  → total por trabajador (regla idéntica al frontend)
//   - enrichPlanilla      → re-deriva precios desde fuentes autoritativas
//                            (hr_fichas, unidades_medida, users) y recomputa totales
//   - sanitizeSegmentos / sanitizeTrabajadores → limpieza de input

const { PLANILLA_LIMITS, trimStr, clampNumber, loadFichasMap, loadUnidadesMap, loadUsersMap } = require('../helpers');

const isHoraUnit = (u) => /^horas?$/i.test((u || '').trim());

// Calcula el total por trabajador a través de todos los segmentos.
// Regla idéntica al frontend / snapshot al aprobar.
function computeWorkerTotal(worker, segmentos) {
  return (segmentos || []).reduce((sum, seg) => {
    const cantidad = clampNumber(worker.cantidades?.[seg.id], PLANILLA_LIMITS.numeric);
    if (cantidad <= 0) return sum;
    const horaDirecta = isHoraUnit(seg.unidad);
    const horaConFactor = !horaDirecta && isHoraUnit(seg.unidadBase) && seg.factorConversion != null;
    const precio = (horaDirecta || horaConFactor)
      ? (Number(worker.precioHora) || 0) * (horaConFactor ? Number(seg.factorConversion) : 1)
      : (Number(seg.costoUnitario) || 0);
    return sum + cantidad * precio;
  }, 0);
}

// Re-deriva precios desde fuentes autoritativas, valida identidades y recalcula
// totales:
// - precioHora viene de hr_fichas (no del cliente).
// - costoUnitario / factorConversion / unidadBase vienen del catálogo
//   unidades_medida cuando la unidad existe ahí; para unidades free-form
//   (sin catalogar), se acepta el valor sanitizado del cliente.
// - trabajadorId DEBE existir en `users` y pertenecer a la finca; los demás
//   se descartan silenciosamente (previene inyectar IDs falsos al snapshot).
// - trabajadorNombre se sobrescribe con el `nombre` canónico de `users`.
async function enrichPlanilla(fincaId, segmentos, trabajadores) {
  const [fichasMap, unidadesMap, usersMap] = await Promise.all([
    loadFichasMap(fincaId),
    loadUnidadesMap(fincaId),
    loadUsersMap(fincaId),
  ]);

  const enrichedSegs = (segmentos || []).map(s => {
    const key = String(s.unidad || '').trim().toLowerCase();
    const cat = key ? unidadesMap.get(key) : null;
    if (!cat) return s; // free-form / no catalogada → respetar valor del cliente
    return {
      ...s,
      // Sólo overridear costoUnitario si el catálogo define un precio explícito.
      costoUnitario: (cat.precio != null && cat.precio !== '')
        ? clampNumber(cat.precio, PLANILLA_LIMITS.numeric)
        : s.costoUnitario,
      factorConversion: cat.factorConversion != null
        ? clampNumber(cat.factorConversion, PLANILLA_LIMITS.numeric)
        : null,
      unidadBase: cat.unidadBase || '',
    };
  });

  const enrichedWorkers = (trabajadores || [])
    .filter(t => t.trabajadorId && usersMap.has(t.trabajadorId))
    .map(t => {
      const userDoc = usersMap.get(t.trabajadorId) || {};
      const ficha = fichasMap.get(t.trabajadorId);
      const precioHora = ficha ? clampNumber(ficha.precioHora, PLANILLA_LIMITS.numeric) : 0;
      const next = {
        ...t,
        // Nombre canónico desde users (no del cliente) — previene falsificación cosmética.
        trabajadorNombre: trimStr(userDoc.nombre, PLANILLA_LIMITS.string),
        precioHora,
      };
      next.total = clampNumber(computeWorkerTotal(next, enrichedSegs), PLANILLA_LIMITS.numeric);
      return next;
    });

  const totalGeneral = clampNumber(
    enrichedWorkers.reduce((s, w) => s + (Number(w.total) || 0), 0),
    PLANILLA_LIMITS.numeric
  );

  return { segmentos: enrichedSegs, trabajadores: enrichedWorkers, totalGeneral, usersMap };
}

// Sanitiza segmentos: tipos, longitudes, números finitos.
function sanitizeSegmentos(segmentos) {
  if (!Array.isArray(segmentos)) return { ok: false, msg: 'segmentos must be an array.' };
  if (segmentos.length > PLANILLA_LIMITS.segmentos)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.segmentos} segmentos.` };
  const cleaned = segmentos.map(s => ({
    id: trimStr(s?.id, 64),
    loteId: trimStr(s?.loteId, 64),
    loteNombre: trimStr(s?.loteNombre, PLANILLA_LIMITS.string),
    labor: trimStr(s?.labor, PLANILLA_LIMITS.string),
    grupo: trimStr(s?.grupo, PLANILLA_LIMITS.string),
    avanceHa: clampNumber(s?.avanceHa, PLANILLA_LIMITS.numeric),
    unidad: trimStr(s?.unidad, PLANILLA_LIMITS.string),
    costoUnitario: clampNumber(s?.costoUnitario, PLANILLA_LIMITS.numeric),
    factorConversion: s?.factorConversion == null ? null : clampNumber(s.factorConversion, PLANILLA_LIMITS.numeric),
    unidadBase: trimStr(s?.unidadBase, PLANILLA_LIMITS.string),
  }));
  return { ok: true, value: cleaned };
}

// Sanitiza trabajadores: tipos, longitudes, cantidades finitas.
function sanitizeTrabajadores(trabajadores) {
  if (!Array.isArray(trabajadores)) return { ok: false, msg: 'trabajadores must be an array.' };
  if (trabajadores.length > PLANILLA_LIMITS.trabajadoresPorPlanilla)
    return { ok: false, msg: `Maximum ${PLANILLA_LIMITS.trabajadoresPorPlanilla} trabajadores.` };
  const cleaned = trabajadores.map(t => {
    const cantsIn = (t && typeof t.cantidades === 'object' && t.cantidades) ? t.cantidades : {};
    const cantsOut = {};
    for (const k of Object.keys(cantsIn).slice(0, PLANILLA_LIMITS.segmentos)) {
      const segId = String(k).slice(0, 64);
      cantsOut[segId] = clampNumber(cantsIn[k], PLANILLA_LIMITS.numeric);
    }
    return {
      trabajadorId: trimStr(t?.trabajadorId, 64),
      trabajadorNombre: trimStr(t?.trabajadorNombre, PLANILLA_LIMITS.string),
      precioHora: clampNumber(t?.precioHora, PLANILLA_LIMITS.numeric),
      cantidades: cantsOut,
      total: clampNumber(t?.total, PLANILLA_LIMITS.numeric),
    };
  });
  return { ok: true, value: cleaned };
}

module.exports = {
  isHoraUnit,
  computeWorkerTotal,
  enrichPlanilla,
  sanitizeSegmentos,
  sanitizeTrabajadores,
};
