// Helpers compartidos del dominio autopilot.
//
// Sub-archivo del split de routes/autopilot.js. Aísla utilidades que se
// reutilizan entre los handlers de /analyze, /command, /actions:
//   - buildFeedbackContext  — combina directivas duras + few-shot de feedback
//                             para inyectar en el prompt de Claude.
//   - serializeAction       — formatea un autopilot_action para el wire,
//                             gateando reasoning según rol.

const { db } = require('../../lib/firebase');

// ─── Feedback context para prompts ───────────────────────────────────────

// Construye el contexto de feedback por usuario: directivas duras (reglas que
// el usuario explícitamente activó) + few-shot ejemplos de votos previos.
// Las directivas son reglas firmes; el feedback es señal de estilo solamente.
async function buildFeedbackContext(fincaId, userId) {
  try {
    const [feedbackSnap, directivesSnap] = await Promise.all([
      db.collection('copilot_feedback')
        .where('fincaId', '==', fincaId)
        .where('userId', '==', userId)
        .orderBy('updatedAt', 'desc')
        .limit(20)
        .get(),
      db.collection('copilot_directives')
        .where('fincaId', '==', fincaId)
        .where('userId', '==', userId)
        .where('active', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get(),
    ]);

    const directives = directivesSnap.docs
      .map(d => String(d.data().text || '').trim())
      .filter(Boolean);
    const feedback = feedbackSnap.docs.map(d => d.data());

    const directivesBlock = directives.length
      ? [
          '<reglas_del_usuario>',
          'Reglas firmes establecidas explícitamente por este usuario. Respétalas sin excepciones:',
          ...directives.map((t, i) => `${i + 1}. ${t}`),
          '</reglas_del_usuario>',
        ].join('\n')
      : '';

    const positive = feedback.filter(f => f.signal === 'up').slice(0, 5);
    const negative = feedback.filter(f => f.signal === 'down').slice(0, 5);

    let examplesBlock = '';
    if (positive.length || negative.length) {
      const lines = ['<feedback_previo>'];
      lines.push('Historial de feedback de este usuario. Úsalo como guía de ESTILO — qué tipo de sugerencias valora y cuáles no. NO lo uses como filtro de temas: un 👎 no significa "evitar este tema", solo "esta sugerencia específica no sirvió". Sigue proponiendo en todas las categorías a menos que una regla explícita en <reglas_del_usuario> lo prohíba.');
      if (positive.length) {
        lines.push('');
        lines.push('Marcadas como útiles (👍):');
        positive.forEach(f => {
          const titulo = f.targetTitle || '(sin título)';
          const cat = f.categoria || 'general';
          const c = f.comment ? ` — comentario: "${f.comment}"` : '';
          lines.push(`- [${cat}] "${titulo}"${c}`);
        });
      }
      if (negative.length) {
        lines.push('');
        lines.push('Marcadas como NO útiles (👎):');
        negative.forEach(f => {
          const titulo = f.targetTitle || '(sin título)';
          const cat = f.categoria || 'general';
          const c = f.comment ? ` — comentario: "${f.comment}"` : '';
          lines.push(`- [${cat}] "${titulo}"${c}`);
        });
      }
      lines.push('</feedback_previo>');
      examplesBlock = lines.join('\n');
    }

    return { directivesBlock, examplesBlock };
  } catch (err) {
    console.error('[AUTOPILOT] Error al construir contexto de feedback:', err);
    return { directivesBlock: '', examplesBlock: '' };
  }
}

// ─── Serialización de acciones ───────────────────────────────────────────

// Formatea un doc de autopilot_actions para el wire, opcionalmente incluyendo
// el reasoning del modelo. El reasoning es potencialmente sensible (datos del
// snapshot, nombres de usuario), así que callers sin supervisor+ NUNCA lo ven,
// independientemente del flag includeReasoning.
function serializeAction(doc, { includeReasoning } = {}) {
  const d = doc.data();
  const base = {
    id: doc.id,
    type: d.type,
    params: d.params,
    titulo: d.titulo,
    descripcion: d.descripcion,
    prioridad: d.prioridad,
    categoria: d.categoria,
    status: d.status,
    sessionId: d.sessionId,
    // Modo que originó la acción. La UI lo compara contra el modo actual de
    // la finca para decidir si los botones approve/reject quedan habilitados.
    // Acciones legacy sin el campo se serializan con null y la UI las trata
    // como no-bloqueadas.
    sourceMode: d.sourceMode || null,
    createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
    reviewedByName: d.reviewedByName || null,
    reviewedAt: d.reviewedAt?.toDate?.()?.toISOString() ?? null,
    rejectionReason: d.rejectionReason || null,
    executedAt: d.executedAt?.toDate?.()?.toISOString() ?? null,
    executionResult: d.executionResult || null,
    autonomous: d.autonomous || false,
    escalated: d.escalated || false,
    guardrailViolations: d.guardrailViolations || null,
    rolledBack: d.rolledBack || false,
    rolledBackAt: d.rolledBackAt?.toDate?.()?.toISOString() ?? null,
  };
  return includeReasoning ? { ...base, reasoning: d.reasoning || null } : base;
}

module.exports = {
  buildFeedbackContext,
  serializeAction,
};
