// Autopilot/analyze — dispatcher por modo.
//
// Resultado del split de routes/autopilot/analyze.js (792 LOC). Este
// archivo es el handler de POST /api/autopilot/analyze: lee la config,
// carga el snapshot compartido, y delega al nivel correspondiente.
//
//   - off      → 400 (modo deshabilitado)
//   - nivel1   → recomendaciones de texto vía nivel1.js
//   - nivel2   → propuestas para aprobación vía nivel2.js
//   - nivel3   → ejecución autónoma con guardrails vía nivel3.js
//
// Cada nivel.js es independiente; el dispatcher solo orquesta. La carga
// del snapshot vive en snapshot.js para no duplicar las 6 queries.

const { Router } = require('express');
const { db } = require('../../../lib/firebase');
const { authenticate } = require('../../../lib/middleware');
const { getAnthropicClient } = require('../../../lib/clients');
const { hasMinRoleBE } = require('../../../lib/helpers');
const { assertAutopilotActive } = require('../../../lib/autopilotMiddleware');
const { rateLimit } = require('../../../lib/rateLimit');
const { sendApiError, ERROR_CODES } = require('../../../lib/errors');

const { buildFeedbackContext } = require('../helpers');
const { loadAnalyzeSnapshot } = require('./snapshot');
const { runNivel1 } = require('./nivel1');
const { runNivel2 } = require('./nivel2');
const { runNivel3 } = require('./nivel3');

const router = Router();

router.post('/api/autopilot/analyze', authenticate, assertAutopilotActive, rateLimit('autopilot_analyze', 'ai_heavy'), async (req, res) => {
  if (!hasMinRoleBE(req.userRole, 'encargado')) {
    return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Encargado role or higher required.', 403);
  }
  try {
    // 1. Read configuration
    const configDoc = await db.collection('autopilot_config').doc(req.fincaId).get();
    const config = configDoc.exists ? configDoc.data() : { mode: 'off', objectives: '' };
    if (config.mode === 'off') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Autopilot is disabled. Enable it in Settings.', 400);
    }

    // 2. Load shared snapshot (6 parallel queries)
    const {
      snapshot, snapshotText, snapshotTextEnriched,
      taskLoteMap, productStockMap,
    } = await loadAnalyzeSnapshot(req.fincaId);

    const anthropicClient = getAnthropicClient();

    // 3. Feedback/directives context of the user running the analysis
    const { directivesBlock, examplesBlock } = await buildFeedbackContext(req.fincaId, req.uid);
    const feedbackPrefix = [directivesBlock, examplesBlock].filter(Boolean).join('\n\n');

    // 4. Dispatch by mode
    if (config.mode === 'nivel1') {
      return await runNivel1({
        req, res, anthropicClient, config, snapshot, snapshotText, feedbackPrefix,
      });
    }
    if (config.mode === 'nivel2') {
      return await runNivel2({
        req, res, anthropicClient, config, snapshot, snapshotTextEnriched, feedbackPrefix,
      });
    }
    if (config.mode === 'nivel3') {
      return await runNivel3({
        req, res, anthropicClient, config, snapshot, snapshotTextEnriched, feedbackPrefix,
        taskLoteMap, productStockMap,
      });
    }

    // Modo no reconocido
    return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported Autopilot mode.', 400);

  } catch (err) {
    console.error('[AUTOPILOT] Error en analyze:', err);
    return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Internal error running analysis.', 500);
  }
});

module.exports = router;
