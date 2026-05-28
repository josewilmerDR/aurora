// Field-records — endpoints de lectura.
//
// Sub-archivo del split de routes/field-records.js. Cubre los dos GETs:
//   - /api/cedulas         lista por finca, ordenada por generadaAt desc
//   - /api/cedulas/:id     detalle, enriquecido con la calibración usada y
//                          la maquinaria asociada cuando snap_calibracionId
//                          está presente

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { serializeCedula, requireRole, logCtx } = require('./helpers');

const router = Router();

// Ambos GETs gated a encargado+ y rate-limited. El listing nunca estuvo
// abierto a trabajadores; el GET por id sí lo estaba con la excusa de que
// "workers acceden desde /task/:taskId", pero TaskAction usa /api/tasks/:id
// — ningún flow legítimo de trabajador llega a este endpoint. Sin el gate,
// un trabajador autenticado podía enumerar la historia completa de cédulas
// (productos, dosis, firmas, snap_productos con precioUnitario) incrementando
// IDs. El rate-limit acota a un actor con token válido — la combinación
// gate+limit cierra la enumeración por scraping.
// ?include=costs es opt-in para snap_productos[].precioUnitario + moneda.
// Default strip — el viewer/listing no lo necesitan. HistorialAplicaciones
// lo pide explícito porque calcula costo histórico. Ver serializeCedula
// en helpers.js. M2 audit.
router.get('/api/cedulas', authenticate, rateLimit('cedulas_read', 'public_read'), async (req, res) => {
  if (!requireRole(req, res, 'encargado')) return;
  try {
    res.set('Cache-Control', 'no-store');
    const includeCosts = req.query.include === 'costs';
    const snap = await db.collection('cedulas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('generadaAt', 'desc')
      .get();
    res.json(snap.docs.map(d => serializeCedula(d.id, d.data(), { includeCosts })));
  } catch (error) {
    console.error('Error fetching cedulas', logCtx(req, { err: error?.message }));
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedulas.', 500);
  }
});

router.get('/api/cedulas/:id', authenticate, rateLimit('cedulas_read', 'public_read'), async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const includeCosts = req.query.include === 'costs';
    const data = ownership.doc.data();
    const cedula = serializeCedula(ownership.doc.id, data, { includeCosts });

    if (data.snap_calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(data.snap_calibracionId).get();
      // Defense-in-depth: re-verificar fincaId en la calibración y en cada
      // maquinaria. Los IDs vienen del doc cédula (ya fincaId-scoped), pero
      // un upstream vía Admin SDK (chat tool, autopilot, seed bug) podría
      // colgar un ID cross-tenant. Mismo patrón que apply.js al armar el
      // snapshot histórico de bloques y productos.
      if (calDoc.exists && calDoc.data().fincaId === req.fincaId) {
        cedula.calibracion = { id: calDoc.id, ...calDoc.data() };
        const cal = calDoc.data();
        const maqIds = [cal.aplicadorId, cal.tractorId].filter(Boolean);
        if (maqIds.length > 0) {
          const maqDocs = await Promise.all(maqIds.map(mid => db.collection('maquinaria').doc(mid).get()));
          const maqMap = {};
          maqDocs.forEach(d => {
            if (d.exists && d.data().fincaId === req.fincaId) maqMap[d.id] = d.data();
          });
          cedula.calibracionAplicador = cal.aplicadorId ? (maqMap[cal.aplicadorId] || null) : null;
          cedula.calibracionTractor   = cal.tractorId   ? (maqMap[cal.tractorId]   || null) : null;
        }
      }
    }

    res.json(cedula);
  } catch (error) {
    console.error('Error fetching cedula by id', logCtx(req, { cedulaId: req.params.id, err: error?.message }));
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedula.', 500);
  }
});

module.exports = router;
