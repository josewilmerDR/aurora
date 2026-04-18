// Rutas de análisis estratégico (Fase 4.1).
//
// Expone dos superficies:
//   1. Temporadas — catálogo editable de ciclos productivos. Se puebla a
//      partir de un detector automático (seasonInference) sobre
//      cosecha_registros, y el usuario puede crear/editar/archivar manualmente.
//   2. Yield — agregador de rendimiento por lote/paquete/cultivo/temporada.
//
// Todo es lectura o escritura sobre el catálogo de temporadas. No dispara
// acciones irreversibles, por lo que no entra en la maquinaria de Autopilot.
// Permisos: supervisor+ por defecto (coherente con dashboards financieros y
// de RRHH de fases anteriores).

const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership, hasMinRoleBE } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { inferSeasons } = require('../lib/strategy/seasonInference');
const { computeYieldAggregate } = require('../lib/strategy/yieldAggregator');

const router = Router();

// ─── Validación común ──────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function validateTemporadaPayload(body, { partial = false } = {}) {
  if (!partial || body.nombre !== undefined) {
    if (typeof body.nombre !== 'string' || body.nombre.trim().length === 0) {
      return 'Season name is required.';
    }
    if (body.nombre.length > 64) return 'Season name cannot exceed 64 characters.';
  }
  if (!partial || body.fechaInicio !== undefined) {
    if (!isValidIsoDate(body.fechaInicio)) {
      return 'fechaInicio must be YYYY-MM-DD.';
    }
  }
  if (!partial || body.fechaFin !== undefined) {
    if (!isValidIsoDate(body.fechaFin)) {
      return 'fechaFin must be YYYY-MM-DD.';
    }
  }
  if (body.fechaInicio && body.fechaFin && body.fechaInicio > body.fechaFin) {
    return 'fechaInicio cannot be after fechaFin.';
  }
  if (body.status !== undefined && !['active', 'archived'].includes(body.status)) {
    return 'status must be "active" or "archived".';
  }
  if (body.notas !== undefined && body.notas !== null && body.notas !== '') {
    if (typeof body.notas !== 'string' || body.notas.length > 512) {
      return 'notas cannot exceed 512 characters.';
    }
  }
  return null;
}

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(
      res,
      ERROR_CODES.INSUFFICIENT_ROLE,
      'Strategy analytics require supervisor role or higher.',
      403,
    );
    return false;
  }
  return true;
}

// ─── Temporadas: listar ────────────────────────────────────────────────────

router.get('/api/analytics/temporadas', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const snap = await db.collection('temporadas')
      .where('fincaId', '==', req.fincaId)
      .get();
    const temporadas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
    res.status(200).json(temporadas);
  } catch (error) {
    console.error('[analytics] list temporadas failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch seasons.', 500);
  }
});

// ─── Temporadas: detectar (no persiste) ────────────────────────────────────

router.post('/api/analytics/temporadas/detect', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const options = {};
    if (Number.isFinite(Number(req.body?.gapDays))) {
      options.gapDays = Math.max(7, Math.min(120, Number(req.body.gapDays)));
    }
    if (Number.isFinite(Number(req.body?.minLengthDays))) {
      options.minLengthDays = Math.max(14, Math.min(365, Number(req.body.minLengthDays)));
    }
    if (Number.isFinite(Number(req.body?.minRecords))) {
      options.minRecords = Math.max(1, Math.min(100, Number(req.body.minRecords)));
    }
    const snap = await db.collection('cosecha_registros')
      .where('fincaId', '==', req.fincaId)
      .get();
    const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const proposals = inferSeasons(records, options);

    // Marcamos cuáles ya existen (por solapamiento exacto o casi-exacto con
    // una temporada activa) para que el frontend las pinte como "existentes".
    const existingSnap = await db.collection('temporadas')
      .where('fincaId', '==', req.fincaId)
      .get();
    const existing = existingSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.status !== 'archived');
    const decorated = proposals.map(p => {
      const match = existing.find(t =>
        t.fechaInicio === p.fechaInicio && t.fechaFin === p.fechaFin
      );
      return match
        ? { ...p, existing: true, temporadaId: match.id, nombre: match.nombre }
        : { ...p, existing: false };
    });

    res.status(200).json({
      proposals: decorated,
      totalRegistros: records.length,
      options: { ...options },
    });
  } catch (error) {
    console.error('[analytics] detect temporadas failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to detect seasons.', 500);
  }
});

// ─── Temporadas: crear ─────────────────────────────────────────────────────

router.post('/api/analytics/temporadas', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const allowed = ['nombre', 'fechaInicio', 'fechaFin', 'autoDetected', 'notas'];
    const data = pick(req.body, allowed);
    const validationError = validateTemporadaPayload(data);
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }

    // Rechazo de solapamiento contra temporadas activas del mismo fincaId.
    // Dos temporadas activas no deberían tener ventanas superpuestas — si el
    // usuario quiere redefinir, archiva la anterior primero.
    const existingSnap = await db.collection('temporadas')
      .where('fincaId', '==', req.fincaId)
      .get();
    const conflict = existingSnap.docs
      .map(d => d.data())
      .filter(t => t.status !== 'archived')
      .find(t => t.fechaInicio <= data.fechaFin && t.fechaFin >= data.fechaInicio);
    if (conflict) {
      return sendApiError(
        res,
        ERROR_CODES.CONFLICT,
        `Season overlaps with existing active season "${conflict.nombre}".`,
        409,
      );
    }

    const toStore = {
      nombre: data.nombre.trim(),
      fechaInicio: data.fechaInicio,
      fechaFin: data.fechaFin,
      autoDetected: Boolean(data.autoDetected),
      status: 'active',
      notas: data.notas || null,
      fincaId: req.fincaId,
      createdBy: req.uid,
      createdByEmail: req.userEmail || null,
      createdAt: Timestamp.now(),
    };
    const ref = await db.collection('temporadas').add(toStore);
    res.status(201).json({ id: ref.id, ...toStore });
  } catch (error) {
    console.error('[analytics] create temporada failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create season.', 500);
  }
});

// ─── Temporadas: actualizar ────────────────────────────────────────────────

router.put('/api/analytics/temporadas/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('temporadas', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const allowed = ['nombre', 'fechaInicio', 'fechaFin', 'status', 'notas'];
    const data = pick(req.body, allowed);
    const validationError = validateTemporadaPayload(data, { partial: true });
    if (validationError) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, validationError, 400);
    }

    // Si se cambian fechas o se reactiva, re-checar solapamiento.
    if (data.fechaInicio || data.fechaFin || data.status === 'active') {
      const current = ownership.doc.data();
      const nextInicio = data.fechaInicio || current.fechaInicio;
      const nextFin = data.fechaFin || current.fechaFin;
      const nextStatus = data.status || current.status;
      if (nextStatus === 'active') {
        const existingSnap = await db.collection('temporadas')
          .where('fincaId', '==', req.fincaId)
          .get();
        const conflict = existingSnap.docs
          .filter(d => d.id !== id)
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(t => t.status !== 'archived')
          .find(t => t.fechaInicio <= nextFin && t.fechaFin >= nextInicio);
        if (conflict) {
          return sendApiError(
            res,
            ERROR_CODES.CONFLICT,
            `Update overlaps with active season "${conflict.nombre}".`,
            409,
          );
        }
      }
    }

    const toUpdate = {
      ...data,
      updatedBy: req.uid,
      updatedAt: Timestamp.now(),
    };
    if (typeof toUpdate.nombre === 'string') toUpdate.nombre = toUpdate.nombre.trim();
    await db.collection('temporadas').doc(id).update(toUpdate);
    res.status(200).json({ id, ...toUpdate });
  } catch (error) {
    console.error('[analytics] update temporada failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update season.', 500);
  }
});

// ─── Temporadas: eliminar / archivar ──────────────────────────────────────
// Regla: las temporadas auto-detectadas se borran con hard delete (el usuario
// puede re-detectar en cualquier momento). Las creadas manualmente se
// archivan para preservar el historial de decisiones que las referenciaron.

router.delete('/api/analytics/temporadas/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('temporadas', id, req.fincaId);
    if (!ownership.ok) {
      return sendApiError(res, ownership.code, ownership.message, ownership.status);
    }
    const current = ownership.doc.data();
    if (current.autoDetected) {
      await db.collection('temporadas').doc(id).delete();
      return res.status(200).json({ id, deleted: true });
    }
    await db.collection('temporadas').doc(id).update({
      status: 'archived',
      updatedBy: req.uid,
      updatedAt: Timestamp.now(),
    });
    res.status(200).json({ id, archived: true });
  } catch (error) {
    console.error('[analytics] delete temporada failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete season.', 500);
  }
});

// ─── Yield: agregador histórico ────────────────────────────────────────────

router.get('/api/analytics/yield', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { desde, hasta, groupBy } = req.query;
    if (!desde || !hasta) {
      return sendApiError(
        res,
        ERROR_CODES.MISSING_REQUIRED_FIELDS,
        'Query params "desde" and "hasta" are required (YYYY-MM-DD).',
        400,
      );
    }
    if (!isValidIsoDate(desde) || !isValidIsoDate(hasta)) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'Dates must be YYYY-MM-DD.',
        400,
      );
    }
    if (desde > hasta) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        '"desde" cannot be after "hasta".',
        400,
      );
    }
    const mode = groupBy || 'lote';
    if (!['lote', 'paquete', 'cultivo', 'temporada'].includes(mode)) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        'groupBy must be one of: lote, paquete, cultivo, temporada.',
        400,
      );
    }
    const result = await computeYieldAggregate(req.fincaId, {
      desde, hasta, groupBy: mode,
    });
    res.status(200).json(result);
  } catch (error) {
    console.error('[analytics] yield failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to compute yield analytics.', 500);
  }
});

module.exports = router;
