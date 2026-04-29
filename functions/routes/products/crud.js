// Products — CRUD + activar/inactivar de productos.
//
// Sub-archivo del split de routes/products.js. Endpoints básicos del
// catálogo `productos`:
//
//   - GET    /api/productos               lista por finca
//   - POST   /api/productos               crea o suma stock si idProducto
//                                          ya existe (con movimiento opcional)
//   - PUT    /api/productos/:id           edita campos del catálogo
//   - DELETE /api/productos/:id           sólo si stockActual === 0; audit WARNING
//   - PUT    /api/productos/:id/inactivar borrado lógico (sólo con stock 0)
//   - PUT    /api/productos/:id/activar   reactiva un producto inactivo

const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { pick, verifyOwnership } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { PRODUCT_FIELDS, validateProducto } = require('./helpers');

const router = Router();

router.get('/api/productos', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(productos);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch productos.', 500);
  }
});

router.post('/api/productos', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, true);
    if (valErrors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, valErrors.join('; '), 400);

    const { fechaIngreso, facturaNumero, registrarIngreso, ordenCompraId, ocPoNumber } = req.body;
    const fechaTs = fechaIngreso
      ? Timestamp.fromDate(new Date(fechaIngreso + 'T12:00:00'))
      : Timestamp.now();
    const producto = { ...pick(req.body, PRODUCT_FIELDS), fincaId: req.fincaId };

    // Check if a producto with the same idProducto already exists
    if (producto.idProducto) {
      const existing = await db.collection('productos')
        .where('fincaId', '==', req.fincaId)
        .where('idProducto', '==', producto.idProducto)
        .limit(1)
        .get();

      if (!existing.empty) {
        const doc = existing.docs[0];
        const stockIngresado = parseFloat(producto.stockActual) || 0;
        if (registrarIngreso && stockIngresado > 0) {
          const batch = db.batch();
          batch.update(doc.ref, { stockActual: FieldValue.increment(stockIngresado) });
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: doc.id,
            idProducto: producto.idProducto || doc.data().idProducto || '',
            nombreComercial: producto.nombreComercial || doc.data().nombreComercial || '',
            cantidad: stockIngresado,
            unidad: producto.unidad || doc.data().unidad || '',
            precioUnitario: parseFloat(producto.precioUnitario) || 0,
            iva: parseFloat(producto.iva) || 0,
            proveedor: producto.proveedor || '',
            fecha: fechaTs,
            motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Ingreso de inventario',
            ...(facturaNumero  ? { facturaNumero }  : {}),
            ...(ordenCompraId  ? { ordenCompraId }  : {}),
            ...(ocPoNumber     ? { ocPoNumber }     : {}),
            fincaId: req.fincaId,
          });
          await batch.commit();
        } else {
          await doc.ref.update({ stockActual: FieldValue.increment(stockIngresado) });
        }
        const updated = { ...doc.data(), stockActual: (doc.data().stockActual || 0) + stockIngresado };
        return res.status(200).json({ id: doc.id, ...updated, merged: true });
      }
    }

    const stockIngresado = parseFloat(producto.stockActual) || 0;
    const newProdRef = db.collection('productos').doc();
    const batch = db.batch();
    batch.set(newProdRef, producto);
    if (stockIngresado > 0) {
      batch.set(db.collection('movimientos').doc(), {
        tipo: 'ingreso',
        productoId: newProdRef.id,
        idProducto: producto.idProducto || '',
        nombreComercial: producto.nombreComercial || '',
        cantidad: stockIngresado,
        unidad: producto.unidad || '',
        precioUnitario: parseFloat(producto.precioUnitario) || 0,
        iva: parseFloat(producto.iva) || 0,
        proveedor: producto.proveedor || '',
        fecha: fechaTs,
        motivo: producto.proveedor ? `Ingreso: ${producto.proveedor}` : 'Carga inicial',
        ...(facturaNumero  ? { facturaNumero }  : {}),
        ...(ordenCompraId  ? { ordenCompraId }  : {}),
        ...(ocPoNumber     ? { ocPoNumber }     : {}),
        fincaId: req.fincaId,
      });
    }
    await batch.commit();
    res.status(201).json({ id: newProdRef.id, ...producto, merged: false });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create producto.', 500);
  }
});

router.put('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const valErrors = validateProducto(req.body, false);
    if (valErrors.length) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, valErrors.join('; '), 400);

    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const productoData = pick(req.body, PRODUCT_FIELDS);
    await db.collection('productos').doc(id).update(productoData);
    res.status(200).json({ id, ...productoData });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update producto.', 500);
  }
});

router.delete('/api/productos/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('productos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const prevData = ownership.doc.data();
    const stock = prevData.stockActual ?? 0;
    if (stock > 0) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Only products with zero stock can be deleted.', 409);
    }
    await db.collection('productos').doc(id).delete();

    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.PRODUCTO_DELETE,
      target: { type: 'producto', id },
      metadata: {
        idProducto: prevData.idProducto || null,
        nombreComercial: prevData.nombreComercial || null,
        tipo: prevData.tipo || null,
      },
      severity: SEVERITY.WARNING,
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete producto.', 500);
  }
});

router.put('/api/productos/:id/inactivar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const stock = ownership.doc.data().stockActual ?? 0;
    if (stock > 0) {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Only products with zero stock can be deactivated.', 409);
    }
    await db.collection('productos').doc(req.params.id).update({ activo: false });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to deactivate producto.', 500);
  }
});

router.put('/api/productos/:id/activar', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('productos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('productos').doc(req.params.id).update({ activo: true });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to activate producto.', 500);
  }
});

module.exports = router;
