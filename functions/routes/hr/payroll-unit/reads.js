// HR/payroll-unit — endpoints de lectura.
//
// Sub-archivo del split de routes/hr/payroll-unit.js. Dos GETs:
//   - /api/hr/planilla-unidad             planillas activas (incl. borradores y aprobadas)
//   - /api/hr/planilla-unidad/historial   snapshots inmutables creados al aprobar
//
// El historial se materializa al aprobar (ver mutations.js) precisamente
// para que esta lectura no tenga que recomputar nada — los reportes leen
// snapshot frio.

const { Router } = require('express');
const { db, Timestamp } = require('../../../lib/firebase');
const { authenticate } = require('../../../lib/middleware');
const { hasMinRoleBE } = require('../../../lib/helpers');
const { rateLimit } = require('../../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');
const { FECHA_RE, canActOnBehalf, resolveAuthUserId } = require('../helpers');

const router = Router();

// Campos que la página de planilla por unidad realmente consume (lista + editor
// + comprobante PDF). Whitelist explícita para NO filtrar el `history[]` (con
// `byEmail` de quien creó/aprobó/editó) ni `createdBy`/`updatedBy` (emails de
// auditoría) a cualquier encargado. El doc completo solo lo necesitan los
// mutadores server-side, no esta lectura. #H2 auditoría dominio.
const PLANILLA_UNIDAD_LIST_FIELDS = [
  'encargadoId', 'encargadoNombre', 'consecutivo', 'estado',
  'segmentos', 'trabajadores', 'totalGeneral', 'observaciones',
  'snapshotCreado',
];

// Tope duro de filas devueltas por el historial. La colección crece sin cota
// (1 doc por trabajador × segmento × planilla aprobada); sin límite, cada
// apertura del tab descargaría toda la historia de la finca. El front pagina de
// 50 en 50, así que 1000 cubre con holgura una vista filtrada por período.
const HISTORIAL_MAX = 1000;

// Campos que la vista de historial realmente consume. Whitelist explícita para
// no filtrar IDs internos (planillaId, trabajadorId) ni notas libres
// (observaciones) que la tabla no muestra. #2 auditoría.
const HISTORIAL_FIELDS = [
  'consecutivo', 'encargadoNombre', 'aprobadoPor', 'loteNombre', 'grupo',
  'labor', 'avanceHa', 'unidad', 'costoUnitario', 'trabajadorNombre',
  'cantidad', 'subtotal',
];

// Proyecta un doc de hr_planilla_unidad a la forma de lista (whitelist + fechas
// ISO). Pura y exportada para test: garantiza que history/createdBy/updatedBy
// (emails de auditoría) nunca salen al cliente. #H2 auditoría dominio.
function projectPlanillaUnidadList(id, v) {
  const out = { id };
  for (const f of PLANILLA_UNIDAD_LIST_FIELDS) out[f] = v[f];
  out.fecha = v.fecha?.toDate ? v.fecha.toDate().toISOString() : null;
  out.createdAt = v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : null;
  return out;
}

async function listPlanillasUnidad(req, res) {
  try {
    // Las planillas llevan salarios (precioHora) y totales de pago de cada
    // trabajador. Gate a encargado+ para que un trabajador no pueda enumerar
    // la nómina de la finca por API directa (igual que GET /api/hr/fichas).
    if (!hasMinRoleBE(req.userRole, 'encargado'))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read planillas.', 403);

    // Scope al dueño: un encargado solo ve SUS propias planillas, espejando el
    // gate de escritura (mutations.js bloquea editar/borrar las de otro). Sin
    // esto, cualquier encargado enumeraba las planillas de TODAS las cuadrillas
    // con precioHora por trabajador y emails de auditoría. supervisor/admin/rrhh
    // (canActOnBehalf) sí ven toda la finca. #H2 auditoría dominio.
    let query = db.collection('hr_planilla_unidad').where('fincaId', '==', req.fincaId);
    if (!canActOnBehalf(req)) {
      const authUserId = await resolveAuthUserId(req);
      // Sin identidad resoluble no hay planillas propias que mostrar (fail-closed).
      if (!authUserId) return res.status(200).json([]);
      query = query.where('encargadoId', '==', authUserId);
    }

    const snap = await query.orderBy('createdAt', 'desc').get();
    const data = snap.docs.map(d => projectPlanillaUnidadList(d.id, d.data()));
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planillas.', 500);
  }
}

router.get('/api/hr/planilla-unidad', authenticate, rateLimit('hr_planilla_read', 'costly_read'), listPlanillasUnidad);

router.get('/api/hr/planilla-unidad/historial', authenticate, rateLimit('hr_planilla_read', 'costly_read'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado'))
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read planilla history.', 403);

    // Filtro de período server-side: acota el payload en origen en vez de traer
    // toda la historia y filtrar en el cliente. `from`/`to` son YYYY-MM-DD
    // (mismo formato que los datepickers de la página). #1 auditoría.
    const { from, to } = req.query;
    if (from !== undefined && (typeof from !== 'string' || !FECHA_RE.test(from)))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid from (expected YYYY-MM-DD).', 400);
    if (to !== undefined && (typeof to !== 'string' || !FECHA_RE.test(to)))
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid to (expected YYYY-MM-DD).', 400);

    let query = db.collection('hr_planilla_unidad_historial')
      .where('fincaId', '==', req.fincaId);
    // El rango se aplica sobre `fecha` (fecha de la planilla), que es la columna
    // que el usuario filtra en la UI — no sobre aprobadoAt.
    if (from) query = query.where('fecha', '>=', Timestamp.fromDate(new Date(from + 'T00:00:00')));
    if (to)   query = query.where('fecha', '<=', Timestamp.fromDate(new Date(to + 'T23:59:59')));

    const snap = await query
      .orderBy('fecha', 'desc')
      .limit(HISTORIAL_MAX)
      .get();
    const data = snap.docs.map(d => {
      const raw = d.data();
      const out = { id: d.id };
      for (const f of HISTORIAL_FIELDS) out[f] = raw[f];
      out.fecha      = raw.fecha?.toDate?.()?.toISOString()      || null;
      out.aprobadoAt = raw.aprobadoAt?.toDate?.()?.toISOString() || null;
      return out;
    });
    res.status(200).json(data);
  } catch (error) {
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch planilla history.', 500);
  }
});

module.exports = router;
// Exportados para tests.
module.exports.listPlanillasUnidad = listPlanillasUnidad;
module.exports.projectPlanillaUnidadList = projectPlanillaUnidadList;
module.exports.PLANILLA_UNIDAD_LIST_FIELDS = PLANILLA_UNIDAD_LIST_FIELDS;
