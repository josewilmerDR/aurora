const { Router } = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');

const router = Router();

const TIPO_PAGO_VALIDOS = new Set(['contado', 'credito']);
const MONEDAS_VALIDAS = new Set(['USD', 'CRC']);
const ESTADOS_VALIDOS = new Set(['activo', 'inactivo']);
const CATEGORIAS_VALIDAS = new Set(['', 'agroquimicos', 'fertilizantes', 'maquinaria', 'servicios', 'combustible', 'semillas', 'otros']);

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
  if (!nombre) return { error: 'El nombre del proveedor es obligatorio.' };

  const email = str(body.email, MAX_TEXT);
  if (email && !EMAIL_RE.test(email)) return { error: 'El correo electrónico no es válido.' };

  const tipoPago = TIPO_PAGO_VALIDOS.has(body.tipoPago) ? body.tipoPago : 'contado';
  const moneda = MONEDAS_VALIDAS.has(body.moneda) ? body.moneda : 'USD';
  const estado = ESTADOS_VALIDOS.has(body.estado) ? body.estado : 'activo';
  const categoria = CATEGORIAS_VALIDAS.has(body.categoria) ? (body.categoria || '') : '';

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
    res.status(500).json({ message: 'Error al obtener proveedores.' });
  }
});

router.post('/api/proveedores', authenticate, async (req, res) => {
  try {
    const { error, data } = buildProveedorDoc(req.body);
    if (error) return res.status(400).json({ message: error });
    const doc = await db.collection('proveedores').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: doc.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear proveedor.' });
  }
});

router.put('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('proveedores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const { error, data } = buildProveedorDoc(req.body);
    if (error) return res.status(400).json({ message: error });
    await db.collection('proveedores').doc(req.params.id).update(data);
    res.json({ message: 'Proveedor actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar proveedor.' });
  }
});

router.delete('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('proveedores', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('proveedores').doc(req.params.id).delete();
    res.json({ message: 'Proveedor eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar proveedor.' });
  }
});

module.exports = router;
