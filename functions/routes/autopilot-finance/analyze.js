// POST /api/autopilot/finance/analyze
//
// Corre el análisis del dominio financiero: cruza la ejecución presupuestaria
// actual con heurísticas simples para identificar categorías en riesgo y
// proponer reasignaciones.
//
// Comportamiento según el nivel configurado:
//   - nivel1 / off  → solo recomendaciones (status=proposed, no se ejecuta)
//   - nivel2        → propuestas escaladas (awaiting_approval)
//   - nivel3        → intenta ejecutar si pasa guardrails; escala si no
//
// Kill switch del dominio (`dominios.financiera.activo=false`) detiene todo.

const { db, Timestamp } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { periodToDateRange } = require('../../lib/finance/periodRange');
const { computePeriodCosts } = require('../../lib/finance/periodCosts');
const { buildExecutionReport } = require('../../lib/finance/budgetConsumption');
const { findReallocationCandidates } = require('../../lib/finance/financeAnalyzerHeuristics');
const { isFinancialDomainActive, resolveDomainLevel } = require('../../lib/finance/financeDomainGuards');
const { validateGuardrails } = require('../../lib/autopilotGuardrails');
const { executeAutopilotAction } = require('../../lib/autopilotActions');

function currentMonthPeriod(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Dado un array de budgets, los agrupa por categoría. Si una categoría tiene
// múltiples budgets (ej: finca-wide + lote-específico), el ejecutor elige
// el primero — la heurística v1 no resuelve multi-budget.
function groupByCategory(budgets) {
  const map = {};
  for (const b of budgets) {
    if (!b.category) continue;
    if (!map[b.category]) map[b.category] = [];
    map[b.category].push(b);
  }
  return map;
}

async function analyze(req, res) {
  try {
    const fincaId = req.fincaId;
    const period = typeof req.body?.period === 'string' ? req.body.period : currentMonthPeriod();
    const range = periodToDateRange(period);
    if (!range) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'period debe ser YYYY, YYYY-Qn o YYYY-MM.', 400);
    }

    // Config del autopilot — para kill switch, nivel, guardrails.
    const configSnap = await db.collection('autopilot_config').doc(fincaId).get();
    const config = configSnap.exists ? configSnap.data() : {};
    const guardrails = config.guardrails || {};

    if (!isFinancialDomainActive(guardrails)) {
      return res.json({
        ran: false,
        reason: 'Dominio financiero desactivado (kill switch).',
        recommendations: [],
      });
    }

    // Ejecución presupuestaria del período.
    const [budgetsSnap, costTotals] = await Promise.all([
      db.collection('budgets')
        .where('fincaId', '==', fincaId)
        .where('period', '==', period)
        .get(),
      computePeriodCosts(fincaId, range),
    ]);
    const budgets = budgetsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const executionRows = buildExecutionReport(budgets, costTotals);
    const budgetsByCategory = groupByCategory(budgets);

    // Heurísticas → candidatos.
    const candidates = findReallocationCandidates(executionRows, budgetsByCategory);

    // Nivel del dominio determina qué hacer con los candidatos.
    const level = resolveDomainLevel(guardrails, config.mode);
    const sessionRef = db.collection('autopilot_sessions').doc();
    const sessionId = sessionRef.id;

    const results = [];
    for (const cand of candidates) {
      const source = budgetsByCategory[cand.fromCategory]?.[0];
      const target = budgetsByCategory[cand.toCategory]?.[0];
      if (!source || !target) continue;

      const params = {
        sourceBudgetId: source.id,
        targetBudgetId: target.id,
        amount: cand.amount,
        reason: cand.reason,
        sourceAssigned: source.assignedAmount,  // para el cap de desviación
      };

      const actionDocRef = db.collection('autopilot_actions').doc();
      const baseDoc = {
        fincaId,
        sessionId,
        type: 'reasignar_presupuesto',
        params,
        titulo: `Reasignar ${cand.amount} de ${cand.fromCategory} → ${cand.toCategory}`,
        descripcion: cand.reason,
        prioridad: 'media',
        categoria: 'financiera',
        autonomous: level === 'nivel3',
        escalated: false,
        guardrailViolations: null,
        proposedBy: req.uid || null,
        proposedByName: req.userEmail || 'autopilot',
        createdAt: Timestamp.now(),
        reviewedBy: null, reviewedByName: null, reviewedAt: null, rejectionReason: null,
      };

      // Nivel 1 u off → recomendación plana, no se ejecuta.
      if (level === 'nivel1' || level === 'off') {
        await actionDocRef.set({ ...baseDoc, status: 'proposed', escalated: true });
        results.push({ actionId: actionDocRef.id, status: 'proposed', level });
        continue;
      }

      // Nivel 2/3 → validamos guardrails.
      const guardResult = await validateGuardrails(
        'reasignar_presupuesto', params, guardrails,
        { fincaId, sessionExecutedCount: 0 }
      );

      // Nivel 2 → propuesta escalada (requiere aprobación).
      if (level === 'nivel2' || !guardResult.allowed) {
        await actionDocRef.set({
          ...baseDoc,
          status: 'proposed',
          escalated: true,
          guardrailViolations: guardResult.allowed ? null : guardResult.violations,
        });
        results.push({
          actionId: actionDocRef.id,
          status: 'proposed',
          escalated: true,
          reason: guardResult.allowed ? 'nivel2' : 'guardrails',
        });
        continue;
      }

      // Nivel 3 + pasa guardrails → ejecuta.
      try {
        const execResult = await executeAutopilotAction(
          'reasignar_presupuesto', params, fincaId,
          { actionDocRef, actionInitialDoc: baseDoc }
        );
        results.push({ actionId: actionDocRef.id, status: 'executed', result: execResult });
      } catch (execErr) {
        results.push({ actionId: actionDocRef.id, status: 'failed', error: execErr.message });
      }
    }

    // Persistimos la sesión para auditoría (solo si hubo acciones).
    if (results.length > 0) {
      await sessionRef.set({
        fincaId,
        kind: 'finance_analysis',
        period,
        level,
        startedAt: Timestamp.now(),
        finishedAt: Timestamp.now(),
        actionCount: results.length,
        executedCount: results.filter(r => r.status === 'executed').length,
        proposedCount: results.filter(r => r.status === 'proposed').length,
      });
    }

    res.json({
      ran: true,
      period,
      level,
      candidatesFound: candidates.length,
      results,
      sessionId: results.length > 0 ? sessionId : null,
    });
  } catch (error) {
    console.error('[AUTOPILOT-FINANCE] analyze failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to run finance analysis.', 500);
  }
}

module.exports = { analyze };
