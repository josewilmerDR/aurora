const { Router } = require('express');
const { admin, db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { hasMinRoleBE } = require('../../lib/helpers');
const { rateLimit } = require('../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { buildConfigUpdate } = require('./schemas');

const router = Router();

// --- API ENDPOINTS: ACCOUNT CONFIGURATION ---
// Lectura gateada a encargado+. El doc incluye identidad legal/fiscal de la
// finca, contactos, logoUrl y parámetros de cultivo (proyecciones de cosecha
// y costos). Todos los consumers de UI ya son encargado+ (Grupos, Lotes,
// Cédulas, Siembra, Cosecha, Planilla, Compras) y la página de ajustes de
// cuenta es administrador. Sin gate, un trabajador podía leer todo eso vía
// API directa.
router.get('/api/config', authenticate, rateLimit('config_read', 'costly_read'), async (req, res) => {
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
//
// Validación: schemas.js (Zod) acota tipos, longitudes, rangos numéricos y el
// logo (tipo MIME + tamaño). Rate limit 'write' frena spam de escrituras /
// subidas de logo a Storage. Cada PUT exitoso queda en audit_events.
router.put('/api/config', authenticate, rateLimit('config', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only administrador can update finca config.', 403);
    }

    const { data, logo, error } = buildConfigUpdate(req.body);
    if (error) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    }

    data.fincaId = req.fincaId;
    data.updatedAt = Timestamp.now();

    // El logo se sube ANTES de persistir el doc: si Storage falla, abortamos
    // con error en vez de tragar la excepción y seguir. Tragarla guardaba el
    // resto de los campos y respondía 200 sin logoUrl — el admin veía "guardado
    // correctamente" mientras el logo nunca subió (falla silenciosa parcial).
    if (logo) {
      try {
        const { randomUUID } = require('crypto');
        const bucket = admin.storage().bucket();
        const mt = logo.mediaType || '';
        const ext = mt.includes('png') ? 'png' : mt.includes('webp') ? 'webp' : 'jpg';
        const fileName = `config/${req.fincaId}/logo.${ext}`;
        const file = bucket.file(fileName);
        const token = randomUUID();
        await file.save(Buffer.from(logo.base64, 'base64'), {
          contentType: logo.mediaType || 'image/jpeg',
          metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });
        const isEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        const encodedPath = encodeURIComponent(fileName);
        data.logoUrl = isEmulator
          ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`
          : `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
      } catch (storageErr) {
        console.error('Logo upload failed:', storageErr.message);
        return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Failed to upload logo to storage.', 502);
      }
    }

    await db.collection('config').doc(req.fincaId).set(data, { merge: true });
    const updated = await db.collection('config').doc(req.fincaId).get();

    // Auditar la mutación privilegiada: changedKeys da el "qué" sin volcar los
    // valores (algunos son PII de identidad legal). Severity WARNING porque un
    // cambio acá mueve proyecciones/KPIs de toda la plataforma.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.CONFIG_UPDATE,
      metadata: {
        changedKeys: Object.keys(data).filter((k) => k !== 'fincaId' && k !== 'updatedAt'),
        logoUpdated: Boolean(data.logoUrl),
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save config.', 500);
  }
});

module.exports = router;
