// POST /api/siembras/bulk — escribe N siembras en un solo batch atómico
// (todas o ninguna). Vive en su propio archivo por dos razones:
//
//   1) Por la política de LOC (<500 por archivo, ver
//      docs/code-standards.md §1) — la lógica de bulk es la más densa del
//      dominio y empujaba a siembras.js por encima del cap.
//   2) Por afinidad: bulk tiene comportamiento propio que no comparte con
//      el CRUD single — validación per-row con resultados parciales,
//      cascade-close best-effort, audit por bloque cerrado. Sacarlo
//      mantiene siembras.js delgado y este archivo enfocado.
//
// Patrón análogo al de scan.js y available.js — un endpoint con superficie
// propia merece su propio archivo. El mount en index.js va antes del
// router de siembras para que `/bulk` no caiga en `/:id`.

const { Router } = require('express');
const { db, Timestamp } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');
const { getResponsableFromUid } = require('./helpers');
const { buildSiembraCreateDoc, BULK_MAX_ROWS } = require('./schemas');

const router = Router();

// Devuelve { results: [{ index, ok, id?, areaCalculada?, code?, message? }] }
// para que la UI sepa exactamente qué filas fallaron y las pueda mantener
// en el form para reintento. Las filas que no pasan validación pre-batch
// (Zod, ownership, bloque cerrado) marcan a la fila como falló pero no
// abortan el resto; el batch solo contiene las filas válidas.
//
// Nota de "transaccionalidad": Firestore batch.commit() es write-atomic
// (todas las writes del batch suceden o ninguna). El check de bloque cerrado
// se hace antes del batch (read-then-write), así que existe una ventana
// teórica donde otro user cierra el bloque entre el read y el commit.
// Para Aurora a la escala actual ese riesgo es aceptable; un upgrade futuro
// puede envolver todo en runTransaction si la concurrencia se vuelve tema.
router.post('/api/siembras/bulk', authenticate, rateLimit('siembras_write', 'write'), async (req, res) => {
  try {
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can register siembras.', 403);
    }
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'rows must be a non-empty array.', 400);
    }
    if (rows.length > BULK_MAX_ROWS) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Too many rows (max ${BULK_MAX_ROWS}).`, 400);
    }

    // Per-row validation. Failed rows carry their reason; valid rows carry
    // normalized data for the batch step below. `data.fechaCierre` is the
    // validated YYYY-MM-DD value (or undefined) — no need to re-read from
    // the raw row.
    const results = rows.map((row, index) => {
      const { error, data } = buildSiembraCreateDoc(row);
      if (error) return { index, ok: false, code: ERROR_CODES.VALIDATION_FAILED, message: error };
      return { index, ok: true, data };
    });

    // Verify each unique loteId belongs to this finca (single read per lote).
    const uniqueLoteIds = [...new Set(results.filter(r => r.ok).map(r => r.data.loteId))];
    const loteSnaps = await Promise.all(
      uniqueLoteIds.map(id => db.collection('lotes').doc(id).get()),
    );
    const loteData = new Map();
    loteSnaps.forEach(snap => loteData.set(snap.id, snap.exists ? snap.data() : null));
    for (const r of results) {
      if (!r.ok) continue;
      const lote = loteData.get(r.data.loteId);
      if (!lote || lote.fincaId !== req.fincaId) {
        r.ok = false;
        r.code = ERROR_CODES.VALIDATION_FAILED;
        r.message = 'Lote does not belong to this finca.';
      }
    }

    // Check closed (lote, bloque) pairs. Group by key so we issue one query
    // per unique pair instead of one per row.
    const bloqueKeys = new Set();
    for (const r of results) {
      if (r.ok && r.data.bloque) bloqueKeys.add(`${r.data.loteId}__${r.data.bloque}`);
    }
    for (const key of bloqueKeys) {
      const [loteId, bloque] = key.split('__');
      const closedSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloque)
        .where('cerrado', '==', true)
        .limit(1)
        .get();
      if (!closedSnap.empty) {
        for (const r of results) {
          if (r.ok && r.data.loteId === loteId && r.data.bloque === bloque) {
            r.ok = false;
            r.code = ERROR_CODES.CONFLICT;
            r.message = 'Cannot add a siembra to a closed bloque. Reopen it first.';
          }
        }
      }
    }

    const valid = results.filter(r => r.ok);
    if (valid.length === 0) {
      return res.status(200).json({ results: results.map(stripInternalFields) });
    }

    // Derive responsable once (single read regardless of batch size).
    const responsable = await getResponsableFromUid(req.uid, req.fincaId);

    // Build the atomic batch.
    const batch = db.batch();
    const cascadeWork = []; // { loteId, bloque, newRefIds: Set, fechaCierre }
    const cascadeIndex = new Map();
    for (const r of valid) {
      const d = r.data;
      const areaCalculada = d.densidad > 0 ? parseFloat((d.plantas / d.densidad).toFixed(4)) : 0;
      const fechaCierre = d.cerrado
        ? (d.fechaCierre
            ? Timestamp.fromDate(new Date(d.fechaCierre + 'T12:00:00'))
            : Timestamp.now())
        : null;
      const ref = db.collection('siembras').doc();
      batch.set(ref, {
        fincaId: req.fincaId,
        loteId: d.loteId,
        loteNombre: d.loteNombre,
        bloque: d.bloque,
        plantas: d.plantas,
        densidad: d.densidad,
        areaCalculada,
        materialId: d.materialId,
        materialNombre: d.materialNombre,
        rangoPesos: d.rangoPesos,
        variedad: d.variedad,
        cerrado: d.cerrado,
        ...(fechaCierre && { fechaCierre }),
        fecha: Timestamp.fromDate(new Date(d.fecha + 'T12:00:00')),
        responsableId: responsable.id,
        responsableNombre: responsable.nombre,
        createdAt: Timestamp.now(),
      });
      r.id = ref.id;
      r.areaCalculada = areaCalculada;

      if (d.cerrado && d.bloque) {
        const key = `${d.loteId}__${d.bloque}`;
        if (!cascadeIndex.has(key)) {
          const entry = { loteId: d.loteId, bloque: d.bloque, newRefIds: new Set(), fechaCierre };
          cascadeIndex.set(key, entry);
          cascadeWork.push(entry);
        }
        cascadeIndex.get(key).newRefIds.add(ref.id);
      }
    }

    await batch.commit();

    // Cascade-close siblings of any (lote, bloque) that has at least one
    // new cerrado=true row. Best-effort: an error here doesn't roll back
    // the primary batch (it already committed) but is logged.
    for (const entry of cascadeWork) {
      try {
        const siblingsSnap = await db.collection('siembras')
          .where('fincaId', '==', req.fincaId)
          .where('loteId', '==', entry.loteId)
          .where('bloque', '==', entry.bloque)
          .get();
        const cascadeBatch = db.batch();
        let siblingsClosed = 0;
        siblingsSnap.docs.forEach(d => {
          if (!entry.newRefIds.has(d.id)) {
            cascadeBatch.update(d.ref, { cerrado: true, fechaCierre: entry.fechaCierre });
            siblingsClosed++;
          }
        });
        await cascadeBatch.commit();
        // One audit event per (lote, bloque) that transitioned to closed via
        // this bulk call. Symmetric with the single-POST and PUT close audits;
        // a bulk that closes N blocks yields N events, which matches forensic
        // intent (each closed bloque is its own state transition).
        writeAuditEvent({
          fincaId: req.fincaId,
          actor: req,
          action: ACTIONS.SIEMBRA_BLOCK_CLOSE,
          target: { type: 'siembra_block', id: `${entry.loteId}__${entry.bloque}` },
          metadata: {
            loteId: entry.loteId,
            bloque: entry.bloque,
            via: 'bulk',
            newRows: entry.newRefIds.size,
            siblingsClosed,
          },
          severity: SEVERITY.INFO,
        });
      } catch (err) {
        console.error('[siembras/bulk] cascade-close failed', entry.loteId, entry.bloque, err);
      }
    }

    res.status(200).json({ results: results.map(stripInternalFields) });
  } catch (error) {
    console.error('[siembras/bulk] failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register siembras.', 500);
  }
});

// Don't leak internal scratch fields (`data`) to the client.
function stripInternalFields(r) {
  if (r.ok) return { index: r.index, ok: true, id: r.id, areaCalculada: r.areaCalculada };
  return { index: r.index, ok: false, code: r.code, message: r.message };
}

module.exports = router;
