const { Router } = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

const VALID_PAYMENT_TYPES = new Set(['contado', 'credito']);
const VALID_CURRENCIES = new Set(['USD', 'CRC']);
const VALID_STATUSES = new Set(['activo', 'inactivo']);
const VALID_CATEGORIES = new Set(['', 'agroquimicos', 'fertilizantes', 'maquinaria', 'servicios', 'combustible', 'semillas', 'otros']);

const MAX_NOMBRE = 150;
const MAX_TEXT = 200;
const MAX_DIRECCION = 300;
const MAX_URL = 300;
const MAX_TELEFONO = 30;
const MAX_RUC = 50;
const MAX_CUENTA = 100;
const MAX_NOTAS = 2000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const intInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const floatInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

function buildProveedorDoc(body) {
  const nombre = str(body.nombre, MAX_NOMBRE);
  if (!nombre) return { error: 'Supplier name is required.' };

  const email = str(body.email, MAX_TEXT);
  if (email && !EMAIL_RE.test(email)) return { error: 'Invalid email address.' };

  const tipoPago = VALID_PAYMENT_TYPES.has(body.tipoPago) ? body.tipoPago : 'contado';
  const moneda = VALID_CURRENCIES.has(body.moneda) ? body.moneda : 'USD';
  const estado = VALID_STATUSES.has(body.estado) ? body.estado : 'activo';
  const categoria = VALID_CATEGORIES.has(body.categoria) ? (body.categoria || '') : '';

  return {
    data: {
      nombre,
      ruc: str(body.ruc, MAX_RUC),
      telefono: str(body.telefono, MAX_TELEFONO),
      email,
      direccion: str(body.direccion, MAX_DIRECCION),
      tipoPago,
      diasCredito: tipoPago === 'credito' ? (intInRange(body.diasCredito, 1, 365) ?? 30) : null,
      notas: str(body.notas, MAX_NOTAS),
      moneda,
      contacto: str(body.contacto, MAX_TEXT),
      whatsapp: str(body.whatsapp, MAX_TELEFONO),
      sitioWeb: str(body.sitioWeb, MAX_URL),
      paisOrigen: str(body.paisOrigen, MAX_TEXT),
      tiempoEntregaDias: intInRange(body.tiempoEntregaDias, 0, 365),
      limiteCredito: floatInRange(body.limiteCredito, 0, 1e12),
      banco: str(body.banco, MAX_TEXT),
      cuentaBancaria: str(body.cuentaBancaria, MAX_CUENTA),
      descuentoHabitual: floatInRange(body.descuentoHabitual, 0, 100),
      categoria,
      estado,
    },
  };
}

router.get('/api/proveedores', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('proveedores')
      .where('fincaId', '==', req.fincaId)
      .orderBy('nombre', 'asc')
      .get();
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(data);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch proveedores.', 500);
  }
});

router.post('/api/proveedores', authenticate, async (req, res) => {
  try {
    const { error, data } = buildProveedorDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    const doc = await db.collection('proveedores').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create proveedor.', 500);
  }
});

router.put('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('proveedores', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const { error, data } = buildProveedorDoc(req.body);
    if (error) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, error, 400);
    await db.collection('proveedores').doc(req.params.id).update(data);
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update proveedor.', 500);
  }
});

router.delete('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('proveedores', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('proveedores').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete proveedor.', 500);
  }
});

module.exports = router;
