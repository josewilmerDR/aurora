const { Router } = require('express');
const { db } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

// --- Validación de payload de paquete ---
const TIPOS_COSECHA_VALIDOS = ['I Cosecha', 'II Cosecha', 'III Cosecha', 'Semillero'];
const ETAPAS_CULTIVO_VALIDAS = ['Desarrollo', 'Postforza', 'N/A'];

function validatePackagePayload(body) {
  const nombre = body.nombrePaquete;
  if (typeof nombre !== 'string' || nombre.trim().length === 0) {
    return 'El nombre del paquete es requerido.';
  }
  if (nombre.length > 128) {
    return 'El nombre del paquete no puede superar 128 caracteres.';
  }
  const descripcion = body.descripcion || '';
  if (typeof descripcion !== 'string' || descripcion.length > 1024) {
    return 'La descripción no puede superar 1024 caracteres.';
  }
  const tecnico = body.tecnicoResponsable || '';
  if (typeof tecnico !== 'string' || tecnico.length > 48) {
    return 'El técnico responsable no puede superar 48 caracteres.';
  }
  if (body.tipoCosecha && !TIPOS_COSECHA_VALIDOS.includes(body.tipoCosecha)) {
    return 'Tipo de cosecha inválido.';
  }
  if (body.etapaCultivo && !ETAPAS_CULTIVO_VALIDAS.includes(body.etapaCultivo)) {
    return 'Etapa de cultivo inválida.';
  }
  const activities = Array.isArray(body.activities) ? body.activities : [];
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i] || {};
    const actName = typeof a.name === 'string' ? a.name : '';
    if (actName.trim().length === 0) {
      return `Actividad ${i + 1}: el nombre es requerido.`;
    }
    if (actName.length > 120) {
      return `Actividad ${i + 1}: el nombre no puede superar 120 caracteres.`;
    }
    const day = Number(a.day);
    if (!Number.isInteger(day) || day < 0 || day > 1825) {
      return `Actividad ${i + 1}: el día debe ser un entero entre 0 y 1825.`;
    }
    const prods = Array.isArray(a.productos) ? a.productos : [];
    if (prods.length > 24) {
      return `Actividad ${i + 1}: máximo 24 productos por aplicación.`;
    }
    for (const p of prods) {
      const cant = Number(p && p.cantidadPorHa);
      if (!Number.isFinite(cant) || cant <= 0 || cant >= 1024) {
        const nombre = (p && p.nombreComercial) || 'producto';
        return `Actividad ${i + 1}: la cantidad de "${nombre}" debe ser mayor a 0 y menor a 1024.`;
      }
    }
  }
  return null;
}

// --- API ENDPOINTS: PACKAGES (PLANTILLAS) ---
router.get('/api/packages', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('packages').where('fincaId', '==', req.fincaId).get();
    const packages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener paquetes.' });
  }
});

router.post('/api/packages', authenticate, async (req, res) => {
  try {
    const validationError = validatePackagePayload(req.body);
    if (validationError) return res.status(400).json({ message: validationError });
    const pkg = { ...pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']), fincaId: req.fincaId };
    const docRef = await db.collection('packages').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear paquete.' });
  }
});

router.put('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const validationError = validatePackagePayload(req.body);
    if (validationError) return res.status(400).json({ message: validationError });
    const pkgData = pick(req.body, ['nombrePaquete', 'tipoCosecha', 'etapaCultivo', 'tecnicoResponsable', 'activities', 'descripcion']);
    await db.collection('packages').doc(id).update(pkgData);
    res.status(200).json({ id, ...pkgData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el paquete.' });
  }
});

router.delete('/api/packages/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('packages', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('packages').doc(id).delete();
    res.status(200).json({ message: 'Paquete eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el paquete.' });
  }
});

module.exports = router;
