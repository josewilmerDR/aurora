const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, writeFeedEvent, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { rateLimit } = require('../lib/rateLimit');

const router = Router();

// --- API ENDPOINTS: LOTES ---
router.get('/api/lotes', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('lotes').where('fincaId', '==', req.fincaId).get();
    const lotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(lotes);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch lotes.', 500);
  }
});

router.post('/api/lotes', authenticate, rateLimit('lotes_write', 'write'), async (req, res) => {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
        return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can create lotes.', 403);
    }
    const codigoLote = typeof req.body.codigoLote === 'string' ? req.body.codigoLote.trim() : '';
    const nombreLote = typeof req.body.nombreLote === 'string' ? req.body.nombreLote.trim() : '';
    const { fechaCreacion, hectareas } = req.body;

    if (!codigoLote || !fechaCreacion) {
        return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'codigoLote and fechaCreacion are required.', 400);
    }
    if (codigoLote.length > 16) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'codigoLote cannot exceed 16 characters.', 400);
    }
    if (nombreLote.length > 32) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'nombreLote cannot exceed 32 characters.', 400);
    }
    const parsedDate = new Date(fechaCreacion);
    if (isNaN(parsedDate.getTime())) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid creation date.', 400);
    }
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (parsedDate > today) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Creation date cannot be in the future.', 400);
    }

    // El paquete técnico ya no se asigna a nivel lote — siempre vive en el
    // grupo. El lote se crea "vacío" y la cobertura de aplicaciones se
    // resuelve cuando el usuario agrupe los bloques y le asigne paquete a
    // cada grupo. Por eso este handler no genera scheduled_tasks.
    try {
        const loteRef = await db.collection('lotes').add({
            codigoLote,
            ...(nombreLote ? { nombreLote } : {}),
            fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
            hectareas: parseFloat(hectareas) || 0,
            fincaId: req.fincaId,
        });
        writeFeedEvent({ fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail, eventType: 'lote_created', title: nombreLote || codigoLote, loteNombre: nombreLote || codigoLote });
        return res.status(201).json({ id: loteRef.id, code: 'LOTE_CREATED' });
    } catch (error) {
        console.error("[ERROR] Creating lote:", error);
        return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create lote.', 500);
    }
});

router.put('/api/lotes/:id', authenticate, rateLimit('lotes_write', 'write'), async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can update lotes.', 403);
        }
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) {
            return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        // paqueteId quedó fuera del modelo de lote — todo paquete vive en el
        // grupo. Si llega en el body (cliente viejo) se ignora silenciosamente
        // en lugar de aceptarse y disparar el branch de regeneración.
        const loteData = pick(req.body, ['codigoLote', 'nombreLote', 'fechaCreacion', 'hectareas']);
        if (loteData.codigoLote !== undefined) {
            loteData.codigoLote = typeof loteData.codigoLote === 'string' ? loteData.codigoLote.trim() : '';
            if (!loteData.codigoLote) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'codigoLote is required.', 400);
            if (loteData.codigoLote.length > 16) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'codigoLote cannot exceed 16 characters.', 400);
        }
        if (loteData.nombreLote !== undefined) {
            loteData.nombreLote = typeof loteData.nombreLote === 'string' ? loteData.nombreLote.trim() : '';
            if (loteData.nombreLote.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'nombreLote cannot exceed 32 characters.', 400);
        }
        const originalDoc = ownership.doc;
        const originalData = originalDoc.data();

        if (loteData.fechaCreacion && typeof loteData.fechaCreacion === 'string') {
             const parsedDate = new Date(loteData.fechaCreacion);
             if (isNaN(parsedDate.getTime())) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid creation date.', 400);
             const today = new Date(); today.setHours(23, 59, 59, 999);
             if (parsedDate > today) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Creation date cannot be in the future.', 400);
             loteData.fechaCreacion = Timestamp.fromDate(parsedDate);
        }

        delete loteData.id;
        await db.collection('lotes').doc(id).update(loteData);

        // Propagate nombreLote changes to related collections
        const originalNombre = originalData.nombreLote || '';
        const newNombre = loteData.nombreLote !== undefined ? (loteData.nombreLote || '') : originalNombre;
        if (originalNombre !== newNombre) {
            const [siembrasSnap, monitoreosSnap] = await Promise.all([
                db.collection('siembras').where('fincaId', '==', req.fincaId).where('loteId', '==', id).get(),
                db.collection('monitoreos').where('fincaId', '==', req.fincaId).where('loteId', '==', id).get(),
            ]);
            const allDocs = [...siembrasSnap.docs, ...monitoreosSnap.docs];
            if (allDocs.length > 0) {
                const propagateBatch = db.batch();
                allDocs.forEach(doc => propagateBatch.update(doc.ref, { loteNombre: newNombre }));
                await propagateBatch.commit();
            }
        }

        res.status(200).json({ id, ...loteData });
    } catch (error) {
        console.error("Error updating lote:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update lote.', 500);
    }
});

router.get('/api/lotes/:id/task-count', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        // verifyOwnership cierra el cross-tenant leak: sin esto, cualquier
        // usuario autenticado podía contar tareas de un loteId de OTRA finca
        // (la query a scheduled_tasks no estaba scoped por fincaId, y este
        // handler no validaba ownership). Una vez verificado que el lote
        // pertenece a req.fincaId, las scheduled_tasks asociadas también lo
        // hacen por construcción, así que el filter por loteId basta.
        // verifyOwnership retorna 404 tanto para "no existe" como para "otra
        // finca", evitando además enumeración por timing.
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) {
            return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const snapshot = await db.collection('scheduled_tasks')
            .where('loteId', '==', id)
            .get();
        const count = snapshot.docs.filter(doc => doc.data().type !== 'REMINDER_3_DAY').length;
        res.status(200).json({ count });
    } catch (error) {
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to count tasks.', 500);
    }
});

router.delete('/api/lotes/:id', authenticate, rateLimit('lotes_write', 'write'), async (req, res) => {
    try {
        if (!hasMinRoleBE(req.userRole, 'encargado')) {
            return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can delete lotes.', 403);
        }
        const { id } = req.params;
        const ownership = await verifyOwnership('lotes', id, req.fincaId);
        if (!ownership.ok) {
            return sendApiError(res, ownership.code, ownership.message, ownership.status);
        }
        const prevData = ownership.doc.data();
        const tasksQuery = db.collection('scheduled_tasks').where('loteId', '==', id);
        const tasksSnapshot = await tasksQuery.get();
        const batch = db.batch();
        tasksSnapshot.docs.forEach(doc => { batch.delete(doc.ref); });
        const loteRef = db.collection('lotes').doc(id);
        batch.delete(loteRef);
        await batch.commit();

        writeAuditEvent({
            fincaId: req.fincaId,
            actor: req,
            action: ACTIONS.LOTE_DELETE,
            target: { type: 'lote', id },
            metadata: {
                codigoLote: prevData.codigoLote || null,
                nombreLote: prevData.nombreLote || null,
                hectareas: prevData.hectareas || null,
                paqueteId: prevData.paqueteId || null,
                tasksDeleted: tasksSnapshot.size,
            },
            severity: SEVERITY.WARNING,
        });

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error("Error deleting lote:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete lote.', 500);
    }
});

module.exports = router;
