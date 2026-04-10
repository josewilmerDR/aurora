const { Router } = require('express');
const { db, FieldValue } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');

const router = Router();

// --- API ENDPOINTS: PROVEEDORES ---
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
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas, moneda,
            contacto, whatsapp, sitioWeb, paisOrigen, tiempoEntregaDias,
            limiteCredito, banco, cuentaBancaria, descuentoHabitual, categoria, estado } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ message: 'El nombre del proveedor es obligatorio.' });
    }
    const doc = await db.collection('proveedores').add({
      nombre: nombre.trim(),
      ruc: ruc?.trim() || '',
      telefono: telefono?.trim() || '',
      email: email?.trim() || '',
      direccion: direccion?.trim() || '',
      tipoPago: tipoPago || 'contado',
      diasCredito: tipoPago === 'credito' ? (parseInt(diasCredito) || 30) : null,
      notas: notas?.trim() || '',
      moneda: moneda || 'USD',
      contacto: contacto?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      sitioWeb: sitioWeb?.trim() || '',
      paisOrigen: paisOrigen?.trim() || '',
      tiempoEntregaDias: tiempoEntregaDias ? parseInt(tiempoEntregaDias) : null,
      limiteCredito: limiteCredito ? parseFloat(limiteCredito) : null,
      banco: banco?.trim() || '',
      cuentaBancaria: cuentaBancaria?.trim() || '',
      descuentoHabitual: descuentoHabitual ? parseFloat(descuentoHabitual) : null,
      categoria: categoria?.trim() || '',
      estado: estado || 'activo',
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
    const { nombre, ruc, telefono, email, direccion, tipoPago, diasCredito, notas, moneda,
            contacto, whatsapp, sitioWeb, paisOrigen, tiempoEntregaDias,
            limiteCredito, banco, cuentaBancaria, descuentoHabitual, categoria, estado } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ message: 'El nombre del proveedor es obligatorio.' });
    }
    await db.collection('proveedores').doc(req.params.id).update({
      nombre: nombre.trim(),
      ruc: ruc?.trim() || '',
      telefono: telefono?.trim() || '',
      email: email?.trim() || '',
      direccion: direccion?.trim() || '',
      tipoPago: tipoPago || 'contado',
      diasCredito: tipoPago === 'credito' ? (parseInt(diasCredito) || 30) : null,
      notas: notas?.trim() || '',
      moneda: moneda || 'USD',
      contacto: contacto?.trim() || '',
      whatsapp: whatsapp?.trim() || '',
      sitioWeb: sitioWeb?.trim() || '',
      paisOrigen: paisOrigen?.trim() || '',
      tiempoEntregaDias: tiempoEntregaDias ? parseInt(tiempoEntregaDias) : null,
      limiteCredito: limiteCredito ? parseFloat(limiteCredito) : null,
      banco: banco?.trim() || '',
      cuentaBancaria: cuentaBancaria?.trim() || '',
      descuentoHabitual: descuentoHabitual ? parseFloat(descuentoHabitual) : null,
      categoria: categoria?.trim() || '',
      estado: estado || 'activo',
    });
    res.json({ message: 'Proveedor actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar proveedor.' });
  }
});

router.delete('/api/proveedores/:id', authenticate, async (req, res) => {
  try {
    await db.collection('proveedores').doc(req.params.id).delete();
    res.json({ message: 'Proveedor eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar proveedor.' });
  }
});

module.exports = router;
