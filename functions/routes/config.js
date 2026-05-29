const { Router } = require('express');
const { admin, db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// Claves persistidas en el doc config/{fincaId}. Lista canónica del backend:
// agregar acá cualquier campo nuevo o el PUT lo descartará en silencio.
//
// NOTA DE SINCRONÍA: estas claves son ESPEJO de las que editan dos páginas del
// frontend — src/features/admin/pages/Parameters.jsx (SECTIONS: tiempos +
// producción) y src/features/account/pages/AccountSettings.jsx (identidad +
// díasIDesarrollo/IIDesarrollo/PostForza). No hay módulo compartido FE↔BE, así
// que al sumar un parámetro hay que tocar ambos lados.
const CONFIG_STRING_KEYS = [
  'nombreEmpresa', 'identificacion', 'representanteLegal', 'administrador',
  'direccion', 'whatsapp', 'correo',
];
const CONFIG_NUMERIC_KEYS = [
  'diasIDesarrollo', 'diasIIDesarrollo', 'diasPostForza',
  'diasSiembraICosecha', 'diasForzaICosecha', 'diasChapeaIICosecha', 'diasForzaIICosecha',
  'diasChapeaIIICosecha', 'diasForzaIIICosecha',
  'plantasPorHa', 'kgPorCaja', 'kgPorPlanta', 'kgPorPlantaII', 'kgPorPlantaIII',
  'rechazoICosecha', 'rechazoIICosecha', 'rechazoIIICosecha',
  'mortalidadICosecha', 'mortalidadIICosecha', 'mortalidadIIICosecha',
];

// --- API ENDPOINTS: ACCOUNT CONFIGURATION ---
// Lectura gateada a encargado+. El doc incluye identidad legal/fiscal de la
// finca, contactos, logoUrl y parámetros de cultivo (proyecciones de cosecha
// y costos). Todos los consumers de UI ya son encargado+ (Grupos, Lotes,
// Cédulas, Siembra, Cosecha, Planilla, Compras) y la página de ajustes de
// cuenta es administrador. Sin gate, un trabajador podía leer todo eso vía
// API directa.
router.get('/api/config', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can read finca config.', 403);
    }
    const doc = await db.collection('config').doc(req.fincaId).get();
    res.status(200).json(doc.exists ? { id: doc.id, ...doc.data() } : {});
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch config.', 500);
  }
});

// Escritura de config requiere administrador. El payload incluye logoUrl (que
// se renderiza embebido en PDFs de Lotes/Grupos/Cédulas), identidad legal de
// la finca, contactos públicos y parámetros de cultivo (díasIDesarrollo,
// kgPorPlanta, etc.) que alimentan proyecciones de cosecha y costos. Sin
// gate, un trabajador podía alterar todo eso vía API directa — desde plantar
// un tracking pixel como logo hasta envenenar las proyecciones del año.
router.put('/api/config', authenticate, async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only administrador can update finca config.', 403);
    }
    const { logoBase64, mediaType } = req.body;

    const data = { fincaId: req.fincaId, updatedAt: Timestamp.now() };
    for (const key of CONFIG_STRING_KEYS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    for (const key of CONFIG_NUMERIC_KEYS) {
      if (req.body[key] === undefined) continue;
      const n = Number(req.body[key]);
      // Ignorar valores no numéricos en vez de escribir NaN al doc.
      if (Number.isFinite(n)) data[key] = n;
    }

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
