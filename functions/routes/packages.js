const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- Package payload validation ---
const VALID_HARVEST_TYPES = ['I Cosecha', 'II Cosecha', 'III Cosecha', 'Semillero'];
const VALID_CROP_STAGES = ['Desarrollo', 'Postforza', 'N/A'];

function validatePackagePayload(body) {
  const nombre = body.nombrePaquete;
  if (typeof nombre !== 'string' || nombre.trim().length === 0) {
    return 'Package name is required.';
  }
  if (nombre.length > 128) {
    return 'Package name cannot exceed 128 characters.';
  }
  const descripcion = body.descripcion || '';
  if (typeof descripcion !== 'string' || descripcion.length > 1024) {
    return 'Description cannot exceed 1024 characters.';
  }
  const tecnico = body.tecnicoResponsable || '';
  if (typeof tecnico !== 'string' || tecnico.length > 48) {
    return 'Responsible technician cannot exceed 48 characters.';
  }
  if (body.tipoCosecha && !VALID_HARVEST_TYPES.includes(body.tipoCosecha)) {
    return 'Invalid harvest type.';
  }
  if (body.etapaCultivo && !VALID_CROP_STAGES.includes(body.etapaCultivo)) {
    return 'Invalid crop stage.';
  }
  const activities = Array.isArray(body.activities) ? body.activities : [];
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i] || {};
    const actName = typeof a.name === 'string' ? a.name : '';
    if (actName.trim().length === 0) {
      return `Activity ${i + 1}: name is required.`;
    }
    if (actName.length > 120) {
      return `Activity ${i + 1}: name cannot exceed 120 characters.`;
    }
    const day = Number(a.day);
    if (!Number.isInteger(day) || day < 0 || day > 1825) {
      return `Activity ${i + 1}: day must be an integer between 0 and 1825.`;
    }
    const prods = Array.isArray(a.productos) ? a.productos : [];
    if (prods.length > 24) {
      return `Activity ${i + 1}: maximum 24 products per application.`;
    }
    for (const p of prods) {
      const qty = Number(p && p.cantidadPorHa);
      if (!Number.isFinite(qty) || qty <= 0 || qty >= 1024) {
        const nombre = (p && p.nombreComercial) || 'product';
        return `Activity ${i + 1}: quantity for "${nombre}" must be greater than 0 and less than 1024.`;
      }
    }
  }
  return null;
}

// --- API ENDPOINTS: PACKAGES ---
router.get('/api/packages', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('packages').where('fincaId', '==', req.fincaId).get();
    const packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch packages.', 500);
  }
});

router.post('/api/packages', authenticate, async (req, res) => {
  try {
    const validationError = validatePackagePayload(req.body);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const pkg = { ...pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']), fincaId: req.fincaId };
    const docRef = await db.collection('packages').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create package.', 500);
  }
});

router.put('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const validationError = validatePackagePayload(req.body);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }
    const pkgData = pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']);
    await db.collection('packages').doc(id).update(pkgData);
    res.status(200).json({ id, ...pkgData });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update package.', 500);
  }
});

router.delete('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    await db.collection('packages').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete package.', 500);
  }
});

module.exports = router;
