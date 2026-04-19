// Rutas del plan anual vivo (Fase 4.5).
//
// Endpoints:
//   GET    /api/strategy/annual-plans?year=YYYY   — lista versiones del año
//   GET    /api/strategy/annual-plans/active?year=YYYY — activo
//   GET    /api/strategy/annual-plans/:id         — detalle
//   POST   /api/strategy/annual-plans             — crear draft manual (supervisor+)
//   POST   /api/strategy/annual-plans/generate    — generar vía Claude (3 niveles)
//   POST   /api/strategy/annual-plans/:id/activate— promover draft/proposed → active
//   POST   /api/strategy/annual-plans/:id/cancel-scheduled — cancelar N3 scheduled
//
// Contrato de versionado:
//   - Una sola versión activa por (fincaId, year) en todo momento (flag
//     `isActive`).
//   - Crear/activar una versión NUEVA siempre supersede la activa previa
//     (status='superseded', isActive=false) en una transacción.
//   - `changelog` nunca se mutan; cada cambio añade una entrada.

const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership, hasMinRoleBE, writeFeedEvent } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { isPaused: isAutopilotPaused } = require('../lib/autopilotKillSwitch');
const { stripReasoning } = require('../lib/autopilotReasoning');
const { validateAnnualPlanPayload } = require('../lib/strategy/annualPlanValidator');
const { diffSections, summarizeDiff } = require('../lib/strategy/annualPlanDiff');
const {
  validateVersionCreation,
  checkForbiddenSideEffects,
  DEFAULT_WEEKLY_CAP,
} = require('../lib/strategy/annualPlanGuardrails');
const { loadPlanContext, countVersionsLast7Days } = require('../lib/strategy/annualPlanContextLoader');
const { generatePlanUpdate } = require('../lib/strategy/annualPlanUpdater');

const router = Router();

const ACTIVATION_DELAY_MS = 24 * 60 * 60 * 1000; // 24h para N3

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireSupervisor(req, res) {
  if (!hasMinRoleBE(req.userRole, 'supervisor')) {
    sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Annual plans require supervisor+.', 403);
    return false;
  }
  return true;
}

function stripByRole(data, userRole) {
  return hasMinRoleBE(userRole, 'supervisor') ? data : stripReasoning(data);
}

async function findActivePlan(fincaId, year) {
  const snap = await db.collection('annual_plans')
    .where('fincaId', '==', fincaId)
    .where('year', '==', year)
    .where('isActive', '==', true)
    .limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref, ...snap.docs[0].data() };
}

async function nextVersionNumber(fincaId, year) {
  const snap = await db.collection('annual_plans')
    .where('fincaId', '==', fincaId)
    .where('year', '==', year)
    .get();
  let max = 0;
  snap.docs.forEach(d => { max = Math.max(max, Number(d.data().version) || 0); });
  return max + 1;
}

// Crea una versión nueva en transacción, supersediendo la activa previa si
// el nuevo status es 'active'. changelog siempre crece (nunca muta el previo).
async function createVersion({
  fincaId, year, version, sections, status,
  level, generatedBy, generatedByEmail, razon, reasoning = null,
  diff, supersedesId = null, activationScheduledFor = null,
}) {
  const newRef = db.collection('annual_plans').doc();
  const now = Timestamp.now();
  const changelogEntry = {
    version,
    fecha: now,
    razon: razon || 'Sin razón registrada.',
    diff: diff || null,
    autor: level ? 'autopilot' : 'user',
    autorUid: generatedBy || null,
    autorEmail: generatedByEmail || null,
    level: level || null,
    summary: diff ? summarizeDiff(diff) : 'Versión inicial.',
  };
  // Heredamos el changelog previo cuando supersedes; así la cadena es completa.
  let priorChangelog = [];
  if (supersedesId) {
    const prior = await db.collection('annual_plans').doc(supersedesId).get();
    if (prior.exists) priorChangelog = prior.data().changelog || [];
  }

  const doc = {
    fincaId, year, version,
    status,
    isActive: status === 'active',
    activationScheduledFor,
    sections,
    changelog: [...priorChangelog, changelogEntry],
    level: level || null,
    reasoning,
    supersedes: supersedesId,
    supersededBy: null,
    generatedBy: generatedBy || null,
    generatedByEmail: generatedByEmail || null,
    createdAt: now,
    lastUpdatedBy: generatedBy || null,
    lastUpdatedReason: razon,
    lastUpdatedLevel: level || null,
  };

  await db.runTransaction(async (t) => {
    // Si la nueva versión será active, primero marcamos la previa.
    if (status === 'active' && supersedesId) {
      const priorRef = db.collection('annual_plans').doc(supersedesId);
      const priorSnap = await t.get(priorRef);
      if (priorSnap.exists && priorSnap.data().isActive) {
        t.update(priorRef, {
          status: 'superseded',
          isActive: false,
          supersededBy: newRef.id,
          updatedAt: now,
        });
      }
    }
    // scheduled_activation: no toca la activa hasta que el cron la promueva.
    t.set(newRef, doc);
  });

  return { id: newRef.id, ref: newRef, ...doc };
}

// ══════════════════════════════════════════════════════════════════════════
// LIST + GET
// ══════════════════════════════════════════════════════════════════════════

router.get('/api/strategy/annual-plans', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const year = req.query.year ? Number(req.query.year) : null;
    let query = db.collection('annual_plans').where('fincaId', '==', req.fincaId);
    if (Number.isInteger(year)) query = query.where('year', '==', year);
    const snap = await query.get();
    const items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        // más reciente primero por year DESC + version DESC
        if (a.year !== b.year) return b.year - a.year;
        return b.version - a.version;
      })
      .map(item => stripByRole(item, req.userRole));
    res.status(200).json(items);
  } catch (error) {
    console.error('[annualPlans] list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list annual plans.', 500);
  }
});

router.get('/api/strategy/annual-plans/active', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const year = Number(req.query.year);
    if (!Number.isInteger(year)) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'year required.', 400);
    }
    const active = await findActivePlan(req.fincaId, year);
    if (!active) return res.status(200).json(null);
    res.status(200).json(stripByRole(active, req.userRole));
  } catch (error) {
    console.error('[annualPlans] get active failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch active plan.', 500);
  }
});

router.get('/api/strategy/annual-plans/:id', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('annual_plans', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id, ...stripByRole(ownership.doc.data(), req.userRole) });
  } catch (error) {
    console.error('[annualPlans] get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch plan.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CREATE (manual draft)
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/strategy/annual-plans', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const vErr = validateAnnualPlanPayload(req.body);
    if (vErr) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, vErr, 400);
    const { year, sections, razon } = req.body;
    const sections_ = sections || {};

    // Forbidden side-effects check.
    const sideFx = checkForbiddenSideEffects({ sections: sections_, diff: null });
    if (!sideFx.allowed) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, sideFx.violations[0].message, 400);
    }

    // Weekly cap.
    const weeklyCount = await countVersionsLast7Days(req.fincaId, year);
    const guard = validateVersionCreation({
      weeklyCount,
      sectionsChanged: Object.keys(sections_),
      level: 'manual',
      newChangelogEntry: { razon: razon || 'Versión manual' },
    });
    if (!guard.allowed) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, guard.violations[0].message, 400);
    }

    const active = await findActivePlan(req.fincaId, year);
    const nextVersion = await nextVersionNumber(req.fincaId, year);
    const diff = diffSections(active?.sections || {}, sections_);

    const out = await createVersion({
      fincaId: req.fincaId, year, version: nextVersion,
      sections: sections_, status: 'draft',
      level: null, generatedBy: req.uid, generatedByEmail: req.userEmail,
      razon: razon || 'Borrador manual',
      diff, supersedesId: active?.id || null,
    });
    res.status(201).json({ id: out.id, ...stripByRole(out, req.userRole) });
  } catch (error) {
    console.error('[annualPlans] create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create annual plan.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GENERATE (Claude, 3 niveles)
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/strategy/annual-plans/generate', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    if (await isAutopilotPaused(req.fincaId)) {
      return sendApiError(res, ERROR_CODES.AUTOPILOT_PAUSED, 'Autopilot is paused.', 423);
    }
    const body = req.body || {};
    const year = Number(body.year);
    if (!Number.isInteger(year)) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'year required.', 400);
    }
    const level = ['nivel1', 'nivel2', 'nivel3'].includes(body.level) ? body.level : 'nivel1';

    const context = await loadPlanContext(req.fincaId, year);

    // Capa Claude.
    let update;
    try {
      update = await generatePlanUpdate({ context, level });
    } catch (err) {
      console.error('[annualPlans] Claude failed:', err);
      return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, `Claude failed: ${err.message}`, 502);
    }

    // Validamos el payload que devolvió Claude.
    const vErr = validateAnnualPlanPayload({ year, sections: update.mergedSections });
    if (vErr) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Claude returned invalid sections: ${vErr}`, 502);
    }

    const diff = diffSections(context.activePlan?.sections || {}, update.mergedSections);

    // Forbidden side-effects.
    const sideFx = checkForbiddenSideEffects({ sections: update.proposedSections, diff });
    if (!sideFx.allowed) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, sideFx.violations[0].message, 400);
    }

    // Guardrails (cap semanal + resolvedStatus por nivel).
    const guard = validateVersionCreation({
      weeklyCount: context.weeklyCount,
      sectionsChanged: diff.sectionsChanged,
      level,
      newChangelogEntry: { razon: update.razon },
    });
    if (!guard.allowed) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, guard.violations[0].message, 400);
    }

    const nextVersion = await nextVersionNumber(req.fincaId, year);
    const status = guard.resolvedStatus;
    const activationScheduledFor = status === 'scheduled_activation'
      ? Timestamp.fromMillis(Date.now() + ACTIVATION_DELAY_MS)
      : null;

    const out = await createVersion({
      fincaId: req.fincaId, year, version: nextVersion,
      sections: update.mergedSections, status,
      level, generatedBy: req.uid, generatedByEmail: req.userEmail,
      razon: update.razon, reasoning: update.reasoning,
      diff, supersedesId: context.activePlan?.id || null,
      activationScheduledFor,
    });

    writeFeedEvent({
      fincaId: req.fincaId, uid: req.uid, userEmail: req.userEmail,
      eventType: 'annual_plan_generated',
      activityType: 'strategy',
      title: `Plan anual ${year} v${nextVersion} — ${status}`,
      loteNombre: null,
    });

    res.status(201).json({ id: out.id, ...stripByRole(out, req.userRole) });
  } catch (error) {
    console.error('[annualPlans] generate failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to generate plan.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ACTIVATE (draft/proposed → active)
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/strategy/annual-plans/:id/activate', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('annual_plans', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const plan = ownership.doc.data();
    if (!['draft', 'proposed', 'scheduled_activation'].includes(plan.status)) {
      return sendApiError(res, ERROR_CODES.CONFLICT,
        `Plan status "${plan.status}" cannot be activated.`, 409);
    }

    const now = Timestamp.now();
    await db.runTransaction(async (t) => {
      // Supersedemos la activa previa.
      if (plan.supersedes) {
        const priorRef = db.collection('annual_plans').doc(plan.supersedes);
        const priorSnap = await t.get(priorRef);
        if (priorSnap.exists && priorSnap.data().isActive) {
          t.update(priorRef, {
            status: 'superseded', isActive: false,
            supersededBy: id, updatedAt: now,
          });
        }
      }
      // También aseguramos que no exista otra versión active para (finca, year)
      // (p. ej. si alguien creó una fuera del flujo).
      const existingActiveSnap = await db.collection('annual_plans')
        .where('fincaId', '==', req.fincaId)
        .where('year', '==', plan.year)
        .where('isActive', '==', true)
        .get();
      for (const doc of existingActiveSnap.docs) {
        if (doc.id !== id) {
          t.update(doc.ref, {
            status: 'superseded', isActive: false,
            supersededBy: id, updatedAt: now,
          });
        }
      }
      // Promovemos la solicitud.
      const changelogEntry = {
        version: plan.version,
        fecha: now,
        razon: req.body?.razon || 'Activación manual',
        diff: null,
        autor: 'user',
        autorUid: req.uid || null,
        autorEmail: req.userEmail || null,
        level: null,
        summary: `Activada (desde ${plan.status}).`,
      };
      t.update(ownership.doc.ref, {
        status: 'active',
        isActive: true,
        activatedAt: now,
        activatedBy: req.uid || null,
        activatedByEmail: req.userEmail || null,
        activationScheduledFor: null,
        changelog: [...(plan.changelog || []), changelogEntry],
      });
    });

    const updated = (await ownership.doc.ref.get()).data();
    res.status(200).json({ id, ...stripByRole(updated, req.userRole) });
  } catch (error) {
    console.error('[annualPlans] activate failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to activate plan.', 500);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// CANCEL SCHEDULED (N3 en ventana de 24h)
// ══════════════════════════════════════════════════════════════════════════

router.post('/api/strategy/annual-plans/:id/cancel-scheduled', authenticate, async (req, res) => {
  try {
    if (!requireSupervisor(req, res)) return;
    const { id } = req.params;
    const ownership = await verifyOwnership('annual_plans', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const plan = ownership.doc.data();
    if (plan.status !== 'scheduled_activation') {
      return sendApiError(res, ERROR_CODES.CONFLICT,
        `Only plans in status "scheduled_activation" can be cancelled. Current: "${plan.status}".`, 409);
    }
    const now = Timestamp.now();
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 512) : 'Cancelled by supervisor';
    await ownership.doc.ref.update({
      status: 'cancelled',
      isActive: false,
      activationScheduledFor: null,
      cancelledAt: now,
      cancelledBy: req.uid || null,
      cancelledByEmail: req.userEmail || null,
      changelog: [...(plan.changelog || []), {
        version: plan.version,
        fecha: now,
        razon: reason,
        diff: null,
        autor: 'user',
        autorUid: req.uid || null,
        autorEmail: req.userEmail || null,
        level: null,
        summary: 'Cancelada antes de activación automática.',
      }],
    });
    const updated = (await ownership.doc.ref.get()).data();
    res.status(200).json({ id, ...stripByRole(updated, req.userRole) });
  } catch (error) {
    console.error('[annualPlans] cancel-scheduled failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to cancel scheduled activation.', 500);
  }
});

module.exports = router;
