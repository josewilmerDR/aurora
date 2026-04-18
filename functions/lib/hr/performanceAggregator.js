// Monthly HR performance aggregator — Firestore-aware.
//
// Pulls the inputs the pure scorer needs from their respective
// collections and fans out across the finca's workers, then persists
// results to `hr_performance_scores` (one doc per (fincaId, userId, period)).
//
// Queries are deliberately small-per-user: reading all finca tasks in a
// month then filtering in-memory by responsableId avoids the N+1
// pattern you'd get by querying per worker.

const { db, Timestamp, FieldValue } = require('../firebase');
const { scoreWorkerMonth } = require('./performanceScorer');

const SCORES_COLLECTION = 'hr_performance_scores';

function periodToRange(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || '');
  if (!m) throw new Error('period must be YYYY-MM');
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

function tsFromDate(d) {
  return Timestamp.fromDate(d);
}

// Pulls every input collection once and buckets rows by userId. Returns
// a map { userId: { tasks, horimetroRows, asistencia, permisos, ficha } }.
async function gatherInputs(fincaId, periodStart, periodEnd) {
  const startTs = tsFromDate(periodStart);
  const endTs = tsFromDate(periodEnd);

  const [tasksSnap, horimetroSnap, asistenciaSnap, permisosSnap, fichasSnap] = await Promise.all([
    db.collection('scheduled_tasks')
      .where('fincaId', '==', fincaId)
      .where('executeAt', '>=', startTs)
      .where('executeAt', '<', endTs)
      .get(),
    db.collection('horimetro')
      .where('fincaId', '==', fincaId)
      .where('fecha', '>=', periodStart.toISOString().slice(0, 10))
      .where('fecha', '<', periodEnd.toISOString().slice(0, 10))
      .get(),
    db.collection('hr_asistencia')
      .where('fincaId', '==', fincaId)
      .where('fecha', '>=', startTs)
      .where('fecha', '<', endTs)
      .get(),
    // Permisos can overlap the period from either end; pull any approved
    // record whose end is >= periodStart, then filter by conGoce downstream.
    db.collection('hr_permisos')
      .where('fincaId', '==', fincaId)
      .where('fechaFin', '>=', startTs)
      .get(),
    db.collection('hr_fichas')
      .where('fincaId', '==', fincaId)
      .get(),
  ]);

  const byUser = new Map();
  const ensure = (uid) => {
    if (!byUser.has(uid)) {
      byUser.set(uid, { tasks: [], horimetroRows: [], asistencia: [], permisos: [], ficha: null });
    }
    return byUser.get(uid);
  };

  for (const doc of tasksSnap.docs) {
    const data = doc.data();
    const uid = data.activity?.responsableId;
    if (!uid) continue;
    ensure(uid).tasks.push({ id: doc.id, ...data });
  }
  for (const doc of horimetroSnap.docs) {
    const data = doc.data();
    const uid = data.operarioId;
    if (!uid) continue;
    ensure(uid).horimetroRows.push({ id: doc.id, ...data });
  }
  for (const doc of asistenciaSnap.docs) {
    const data = doc.data();
    const uid = data.trabajadorId;
    if (!uid) continue;
    ensure(uid).asistencia.push({ id: doc.id, ...data });
  }
  for (const doc of permisosSnap.docs) {
    const data = doc.data();
    const uid = data.trabajadorId;
    if (!uid) continue;
    ensure(uid).permisos.push({ id: doc.id, ...data });
  }
  for (const doc of fichasSnap.docs) {
    const entry = ensure(doc.id);
    entry.ficha = doc.data();
  }

  return byUser;
}

async function computeFincaScores(fincaId, period, { computedBy = 'manual' } = {}) {
  const { start, end } = periodToRange(period);
  const byUser = await gatherInputs(fincaId, start, end);

  const results = [];
  for (const [userId, inputs] of byUser.entries()) {
    if (!inputs.ficha) continue; // only score workers with an ficha
    const scored = scoreWorkerMonth({
      userId,
      tasks: inputs.tasks,
      horimetroRows: inputs.horimetroRows,
      asistencia: inputs.asistencia,
      permisos: inputs.permisos,
      ficha: inputs.ficha,
      periodStart: start,
      periodEnd: end,
    });
    results.push(scored);
  }

  const now = Timestamp.now();
  const batch = db.batch();
  for (const r of results) {
    const docId = `${fincaId}_${r.userId}_${period}`;
    const ref = db.collection(SCORES_COLLECTION).doc(docId);
    batch.set(ref, {
      fincaId,
      userId: r.userId,
      period,
      score: r.score,
      subscores: r.subscores,
      weights: r.weights,
      sampleSize: r.sampleSize,
      lowConfidence: r.lowConfidence,
      details: r.details,
      computedAt: now,
      computedBy,
      updatedAt: now,
    }, { merge: true });
  }
  if (results.length > 0) await batch.commit();
  return results;
}

async function listScores(fincaId, period) {
  const snap = await db.collection(SCORES_COLLECTION)
    .where('fincaId', '==', fincaId)
    .where('period', '==', period)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getScore(fincaId, userId, period) {
  const docId = `${fincaId}_${userId}_${period}`;
  const doc = await db.collection(SCORES_COLLECTION).doc(docId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

module.exports = {
  computeFincaScores,
  listScores,
  getScore,
  SCORES_COLLECTION,
};
