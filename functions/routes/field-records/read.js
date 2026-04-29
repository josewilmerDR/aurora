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
const { serializeCedula } = require('./helpers');

const router = Router();

router.get('/api/cedulas', authenticate, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const snap = await db.collection('cedulas')
      .where('fincaId', '==', req.fincaId)
      .orderBy('generadaAt', 'desc')
      .get();
    res.json(snap.docs.map(d => serializeCedula(d.id, d.data())));
  } catch (error) {
    console.error('Error fetching cedulas:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedulas.', 500);
  }
});

router.get('/api/cedulas/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    const cedula = serializeCedula(ownership.doc.id, data);

    if (data.snap_calibracionId) {
      const calDoc = await db.collection('calibraciones').doc(data.snap_calibracionId).get();
      if (calDoc.exists) {
        cedula.calibracion = { id: calDoc.id, ...calDoc.data() };
        const cal = calDoc.data();
        const maqIds = [cal.aplicadorId, cal.tractorId].filter(Boolean);
        if (maqIds.length > 0) {
          const maqDocs = await Promise.all(maqIds.map(mid => db.collection('maquinaria').doc(mid).get()));
          const maqMap = {};
          maqDocs.forEach(d => { if (d.exists) maqMap[d.id] = d.data(); });
          cedula.calibracionAplicador = cal.aplicadorId ? (maqMap[cal.aplicadorId] || null) : null;
          cedula.calibracionTractor   = cal.tractorId   ? (maqMap[cal.tractorId]   || null) : null;
        }
      }
    }

    res.json(cedula);
  } catch (error) {
    console.error('Error fetching cedula by id:', error);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch cedula.', 500);
  }
});

module.exports = router;
