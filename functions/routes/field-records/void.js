// Field-records — anulación de cédulas.
//
// Sub-archivo del split de routes/field-records.js. PUT /api/cedulas/:id/anular
// invierte una cédula. Reglas:
//   - No se puede anular una cédula 'aplicada_en_campo' (ya impactó campo).
//   - No se puede anular una ya 'anulada' (idempotencia).
//   - Si estaba en 'en_transito', revierte el inventario: cada egreso original
//     genera un ingreso compensatorio y el stockActual se incrementa de
//     vuelta. Esto preserva el ledger en `movimientos` (no se borra nada,
//     se compensa).
//   - Si todas las cédulas hermanas terminaron (anulada o aplicada), la
//     scheduled_task también se cierra: 'completed_by_user' si alguna se
//     aplicó, 'skipped' si todas fueron anuladas.

const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { verifyOwnership, writeFeedEvent } = require('../../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { rateLimit } = require('../../lib/rateLimit');
const { requireRole, logCtx } = require('./helpers');

const router = Router();

router.put('/api/cedulas/:id/anular', authenticate, rateLimit('cedulas_write', 'write'), async (req, res) => {
  try {
    if (!requireRole(req, res, 'encargado')) return;
    const ownership = await verifyOwnership('cedulas', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const cedula = ownership.doc.data();
    if (cedula.status === 'aplicada_en_campo') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cannot void a cedula that has already been applied in the field.', 409);
    }
    if (cedula.status === 'anulada') {
      return sendApiError(res, ERROR_CODES.CONFLICT, 'Cedula is already voided.', 409);
    }

    const batch = db.batch();

    // reversalPorProducto se declara afuera del if para que el audit event
    // pueda reportar cuánto inventario fue restaurado (en cédulas pendientes
    // queda como {} — sin reversión, también es información útil).
    const reversalPorProducto = {};
    if (cedula.status === 'en_transito') {
      const movSnap = await db.collection('movimientos')
        .where('cedulaId', '==', req.params.id)
        .where('fincaId', '==', req.fincaId)
        .get();

      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso' && d.productoId) {
          reversalPorProducto[d.productoId] = (reversalPorProducto[d.productoId] || 0) + d.cantidad;
        }
      }
      for (const [productoId, total] of Object.entries(reversalPorProducto)) {
        batch.update(db.collection('productos').doc(productoId), {
          stockActual: FieldValue.increment(total),
        });
      }
      for (const mov of movSnap.docs) {
        const d = mov.data();
        if (d.tipo === 'egreso') {
          batch.set(db.collection('movimientos').doc(), {
            tipo: 'ingreso',
            productoId: d.productoId,
            nombreComercial: d.nombreComercial,
            cantidad: d.cantidad,
            unidad: d.unidad,
            fecha: Timestamp.now(),
            motivo: `Anulación cédula ${cedula.consecutivo}`,
            tareaId: cedula.taskId,
            cedulaId: req.params.id,
            cedulaConsecutivo: cedula.consecutivo,
            loteId: d.loteId || null,
            grupoId: d.grupoId || null,
            loteNombre: d.loteNombre || '',
            fincaId: req.fincaId,
          });
        }
      }
    }

    batch.update(db.collection('cedulas').doc(req.params.id), {
      status: 'anulada',
      anuladaAt: Timestamp.now(),
      anuladaPor: req.uid,
    });
    const siblingsSnap = await db.collection('cedulas')
      .where('taskId', '==', cedula.taskId)
      .where('fincaId', '==', req.fincaId)
      .get();
    const allInactive = siblingsSnap.docs.every(d => {
      if (d.id === req.params.id) return true;
      const s = d.data().status;
      return s === 'anulada' || s === 'aplicada_en_campo';
    });
    let taskClosedAs = null;
    if (allInactive) {
      const anyApplied = siblingsSnap.docs.some(d =>
        d.id !== req.params.id && d.data().status === 'aplicada_en_campo'
      );
      taskClosedAs = anyApplied ? 'completed_by_user' : 'skipped';
      batch.update(db.collection('scheduled_tasks').doc(cedula.taskId), {
        status: taskClosedAs,
      });
    }
    await batch.commit();

    // Audit la anulación. WARNING porque (a) revierte un movimiento de
    // inventario cuando estaba en_transito y (b) cancela un registro
    // regulatorio en curso. previousStatus + reversalCount facilitan filtrar
    // forensicamente "anulaciones con devolución de stock" vs "anulaciones
    // sin impacto en inventario".
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.CEDULA_VOID,
      target: { type: 'cedula', id: req.params.id },
      metadata: {
        consecutivo: cedula.consecutivo || null,
        taskId: cedula.taskId,
        previousStatus: cedula.status,
        reversalCount: Object.keys(reversalPorProducto).length,
        taskClosedAs,
      },
      severity: SEVERITY.WARNING,
    });

    // Feed event de anulación. Para evitar otro fetch del task/lote en el
    // happy path, derivamos el loteNombre de un movimiento (siempre quedan
    // los originales del egreso aunque haya sido aplicada) o del
    // splitLoteNombre. Title con consecutivo para que se distinga del
    // 'cedula_aplicada' en el feed.
    writeFeedEvent({
      fincaId: req.fincaId,
      uid: req.uid,
      userEmail: req.userEmail,
      eventType: 'cedula_anulada',
      activityType: 'aplicacion',
      title: cedula.consecutivo || 'Cédula anulada',
      loteNombre: cedula.splitLoteNombre || '',
    });

    res.json({ id: req.params.id, status: 'anulada' });
  } catch (error) {
    console.error('Error anulando cedula', logCtx(req, { cedulaId: req.params.id, err: error?.message }));
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to void cedula.', 500);
  }
});

module.exports = router;
