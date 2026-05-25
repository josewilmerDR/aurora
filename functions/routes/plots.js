const { Router } = require('express');
const { z } = require('zod');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, writeFeedEvent, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../lib/auditLog');
const { rateLimit } = require('../lib/rateLimit');

const router = Router();

// --- Lote payload validation (Zod) ---
//
// Migración desde validador hand-rolled a Zod (CLAUDE.md §3 / docs/code-
// standards.md exigen Zod cuando se toca el archivo). Reemplaza los typeof
// checks + parseFloat + isNaN sueltos por un schema único. Material change
// respecto al legacy: `hectareas: {evil: 'object'}` ahora rechaza con
// VALIDATION_FAILED en vez de aceptar silenciosamente con NaN → 0.
//
// `buildLoteCreatePayload` / `buildLoteUpdatePayload` retornan { data, error }
// — el handler solo agrega fincaId y persiste. El error es el mensaje en
// inglés del primer issue de Zod (mismo contrato que packages.js).

const MAX_CODIGO_LOTE = 16;
const MAX_NOMBRE_LOTE = 32;
const MAX_HECTAREAS = 1_000_000; // sanity cap; en la práctica fincas son <1k ha

const loteCreateSchema = z.object({
  codigoLote: z.string().trim().min(1).max(MAX_CODIGO_LOTE),
  nombreLote: z.string().trim().max(MAX_NOMBRE_LOTE).optional().default(''),
  fechaCreacion: z.string().refine((s) => !isNaN(new Date(s).getTime()), {
    message: 'fechaCreacion must be a valid ISO date string.',
  }).refine((s) => {
    const d = new Date(s);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    return d <= today;
  }, { message: 'fechaCreacion cannot be in the future.' }),
  hectareas: z.coerce.number()
    .refine((n) => Number.isFinite(n) && n >= 0 && n < MAX_HECTAREAS, {
      message: `hectareas must be a finite number between 0 and ${MAX_HECTAREAS}.`,
    })
    .optional().default(0),
  // paqueteId quedó fuera del modelo (vive en grupo). Si llega, se ignora.
  paqueteId: z.any().optional(),
});

// UPDATE acepta el mismo shape pero todos los campos son opcionales — Firestore
// .update() solo toca las keys presentes en el payload. Strip de paqueteId es
// idéntico al create.
const loteUpdateSchema = loteCreateSchema.partial();

function buildLoteCreatePayload(body) {
  const parsed = loteCreateSchema.safeParse(body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { error: `${path}${issue.message}` };
  }
  const { paqueteId: _drop, ...clean } = parsed.data;
  return { data: clean };
}

function buildLoteUpdatePayload(body) {
  const parsed = loteUpdateSchema.safeParse(body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return { error: `${path}${issue.message}` };
  }
  const { paqueteId: _drop, ...clean } = parsed.data;
  return { data: clean };
}

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
    const validated = buildLoteCreatePayload(req.body);
    if (validated.error) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validated.error, 400);
    }
    const { codigoLote, nombreLote, fechaCreacion, hectareas } = validated.data;

    // El paquete técnico ya no se asigna a nivel lote — siempre vive en el
    // grupo. El lote se crea "vacío" y la cobertura de aplicaciones se
    // resuelve cuando el usuario agrupe los bloques y le asigne paquete a
    // cada grupo. Por eso este handler no genera scheduled_tasks.
    try {
        const loteRef = await db.collection('lotes').add({
            codigoLote,
            ...(nombreLote ? { nombreLote } : {}),
            fechaCreacion: Timestamp.fromDate(new Date(fechaCreacion)),
            hectareas,
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
        const validated = buildLoteUpdatePayload(req.body);
        if (validated.error) {
            return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validated.error, 400);
        }
        const loteData = { ...validated.data };
        const originalData = ownership.doc.data();

        // Normaliza fechaCreacion a Timestamp para Firestore. Zod ya validó
        // que es ISO string parseable y no futura.
        if (loteData.fechaCreacion) {
            loteData.fechaCreacion = Timestamp.fromDate(new Date(loteData.fechaCreacion));
        }

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

        // Feed event: lote_updated. POST registra lote_created; sin este, las
        // ediciones de hectáreas / fecha de siembra / nombre no quedaban en el
        // muro de actividad. Fire-and-forget al estilo del resto de callers.
        const finalLabel = newNombre || (loteData.codigoLote || originalData.codigoLote || '');
        writeFeedEvent({
            fincaId: req.fincaId,
            uid: req.uid,
            userEmail: req.userEmail,
            eventType: 'lote_updated',
            title: finalLabel,
            loteNombre: finalLabel,
        });

        res.status(200).json({ id, ...loteData });
    } catch (error) {
        console.error("Error updating lote:", error);
        sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update lote.', 500);
    }
});

router.get('/api/lotes/:id/task-count', authenticate, rateLimit('lotes_read', 'public_read'), async (req, res) => {
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
        // Defensa en profundidad: filtro in-memory por fincaId tras el read.
        // El invariante del sistema garantiza que toda scheduled_task creada
        // para este loteId comparte la fincaId del lote (es field denormalizado
        // al crear), así que en operación normal `ownedTaskDocs` == `docs`.
        // Filtramos igual para que si alguna vez el invariante se rompe (bug,
        // import legacy, write directo), no borremos tasks de otra finca por
        // colisión de loteId. Hacerlo así evita un índice compuesto nuevo
        // (fincaId, loteId) sobre scheduled_tasks.
        const ownedTaskDocs = tasksSnapshot.docs.filter(d => d.data().fincaId === req.fincaId);
        const batch = db.batch();
        ownedTaskDocs.forEach(doc => { batch.delete(doc.ref); });
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
                tasksDeleted: ownedTaskDocs.length,
                tasksSkippedForeignFinca: tasksSnapshot.size - ownedTaskDocs.length,
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
