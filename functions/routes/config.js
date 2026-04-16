const { Router } = require('express');
const { admin, db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: ACCOUNT CONFIGURATION ---
router.get('/api/config', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('config').doc(req.fincaId).get();
    res.status(200).json(doc.exists ? { id: doc.id, ...doc.data() } : {});
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch config.', 500);
  }
});

router.put('/api/config', authenticate, async (req, res) => {
  try {
    const { nombreEmpresa, identificacion, representanteLegal, administrador, direccion, whatsapp, correo, logoBase64, mediaType,
            diasIDesarrollo, diasIIDesarrollo, diasPostForza,
            diasSiembraICosecha, diasForzaICosecha, diasChapeaIICosecha, diasForzaIICosecha,
            diasChapeaIIICosecha, diasForzaIIICosecha,
            plantasPorHa, kgPorCaja, kgPorPlanta, kgPorPlantaII, kgPorPlantaIII, rechazoICosecha, rechazoIICosecha,
            rechazoIIICosecha, mortalidadICosecha, mortalidadIICosecha, mortalidadIIICosecha } = req.body;

    const data = { fincaId: req.fincaId, updatedAt: Timestamp.now() };
    if (nombreEmpresa      !== undefined) data.nombreEmpresa      = nombreEmpresa;
    if (identificacion     !== undefined) data.identificacion     = identificacion;
    if (representanteLegal !== undefined) data.representanteLegal = representanteLegal;
    if (administrador      !== undefined) data.administrador      = administrador;
    if (direccion          !== undefined) data.direccion          = direccion;
    if (whatsapp         !== undefined) data.whatsapp         = whatsapp;
    if (correo           !== undefined) data.correo           = correo;
    if (diasIDesarrollo  !== undefined) data.diasIDesarrollo  = Number(diasIDesarrollo);
    if (diasIIDesarrollo !== undefined) data.diasIIDesarrollo = Number(diasIIDesarrollo);
    if (diasPostForza    !== undefined) data.diasPostForza    = Number(diasPostForza);
    if (diasSiembraICosecha !== undefined) data.diasSiembraICosecha = Number(diasSiembraICosecha);
    if (diasForzaICosecha   !== undefined) data.diasForzaICosecha   = Number(diasForzaICosecha);
    if (diasChapeaIICosecha !== undefined) data.diasChapeaIICosecha = Number(diasChapeaIICosecha);
    if (diasForzaIICosecha   !== undefined) data.diasForzaIICosecha   = Number(diasForzaIICosecha);
    if (diasChapeaIIICosecha !== undefined) data.diasChapeaIIICosecha = Number(diasChapeaIIICosecha);
    if (diasForzaIIICosecha  !== undefined) data.diasForzaIIICosecha  = Number(diasForzaIIICosecha);
    if (plantasPorHa        !== undefined) data.plantasPorHa        = Number(plantasPorHa);
    if (kgPorCaja           !== undefined) data.kgPorCaja           = Number(kgPorCaja);
    if (kgPorPlanta         !== undefined) data.kgPorPlanta         = Number(kgPorPlanta);
    if (kgPorPlantaII       !== undefined) data.kgPorPlantaII       = Number(kgPorPlantaII);
    if (kgPorPlantaIII      !== undefined) data.kgPorPlantaIII      = Number(kgPorPlantaIII);

    if (rechazoICosecha      !== undefined) data.rechazoICosecha      = Number(rechazoICosecha);
    if (rechazoIICosecha     !== undefined) data.rechazoIICosecha     = Number(rechazoIICosecha);
    if (rechazoIIICosecha    !== undefined) data.rechazoIIICosecha    = Number(rechazoIIICosecha);
    if (mortalidadICosecha   !== undefined) data.mortalidadICosecha   = Number(mortalidadICosecha);
    if (mortalidadIICosecha  !== undefined) data.mortalidadIICosecha  = Number(mortalidadIICosecha);
    if (mortalidadIIICosecha !== undefined) data.mortalidadIIICosecha = Number(mortalidadIIICosecha);

    if (logoBase64) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const ext = (mediaType || '').includes('png') ? 'png' : 'jpg';
        const fileName = `config/${req.fincaId}/logo.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(logoBase64, 'base64'), {
          contentType: mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        data.logoUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Logo upload failed:', storageErr.message);
      }
    }

    await db.collection('config').doc(req.fincaId).set(data, { merge: true });
    const updated = await db.collection('config').doc(req.fincaId).get();
    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save config.', 500);
  }
});

module.exports = router;
