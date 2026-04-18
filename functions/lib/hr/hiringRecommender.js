// Hiring recommender — pure.
//
// Consumes the output of workloadProjector + capacityCalculator and
// emits hiring recommendations when projected demand exceeds available
// capacity within the horizon. Each recommendation targets a specific
// week and names how many workers short we are, plus a suggested
// contract type.
//
// Deliberate omissions:
//   - No salaries, no budget figures. That's administrador territory.
//   - Never recommends firing or reducing headcount. Contraction of
//     staff is out of scope for an autopilot agent and always will be.
//   - Never infers "this specific person should be hired" — only
//     "you'll need N additional workers around <date>". Who and at
//     what terms is a human decision.
//
// The reasoning field is templated deterministic text. Claude reasoning
// belongs in sub-fase 3.5 (alerts), not here — hiring language carries
// enough weight that a deterministic sentence is more defensible.

const DEFAULT_OPTS = Object.freeze({
  // Demand must exceed capacity by at least this much to trigger.
  // Prevents flagging when load is a couple of hours over — the
  // recommender's job is to detect sustained shortfall, not noise.
  triggerShortfallHours: 4,
  // Weeks within this horizon (inclusive, 0-indexed) classify as
  // "urgent": recommendation for hire should start RIGHT NOW.
  urgentWindowWeeks: 3,
  // Minimum consecutive weeks of shortfall before we recommend
  // permanent hire. Single-week spikes get 'contratar_temporal'.
  permanentContractThreshold: 4,
});

// Per-week shortfall helper. Null when capacity info is missing —
// the recommender won't fire blindly.
function weeklyShortfall(week, capacityHoursPerWeek) {
  if (!week || capacityHoursPerWeek == null || !Number.isFinite(capacityHoursPerWeek)) return null;
  const demand = Number(week.estimatedPersonHours) || 0;
  const shortfall = demand - capacityHoursPerWeek;
  return shortfall > 0 ? shortfall : 0;
}

// Groups consecutive weeks of shortfall into runs. A run is
// { startIndex, endIndex (inclusive), weeks[], peakShortfallHours,
//   averageShortfallHours }.
function findShortfallRuns(weeks, capacityHoursPerWeek, triggerHours) {
  const runs = [];
  let current = null;
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const shortfall = weeklyShortfall(w, capacityHoursPerWeek);
    if (shortfall != null && shortfall >= triggerHours) {
      if (!current) {
        current = { startIndex: i, endIndex: i, weeks: [w], shortfalls: [shortfall] };
      } else {
        current.endIndex = i;
        current.weeks.push(w);
        current.shortfalls.push(shortfall);
      }
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs.map(r => ({
    ...r,
    length: r.weeks.length,
    peakShortfallHours: Math.max(...r.shortfalls),
    averageShortfallHours: r.shortfalls.reduce((s, x) => s + x, 0) / r.shortfalls.length,
  }));
}

function classifyUrgency(run, urgentWindowWeeks) {
  if (run.startIndex < urgentWindowWeeks) return 'alta';
  if (run.startIndex < urgentWindowWeeks * 2) return 'media';
  return 'baja';
}

function recommendedAction(run, permanentThreshold) {
  return run.length >= permanentThreshold ? 'contratar_permanente' : 'contratar_temporal';
}

function describeRun(run, capacity, avgHoursPerWorker) {
  const startWeek = run.weeks[0]?.weekStart;
  const endWeek = run.weeks[run.weeks.length - 1]?.weekStart;
  const workersShort = Math.ceil(run.peakShortfallHours / Math.max(avgHoursPerWorker, 1));
  const sustainedWord = run.length > 1
    ? `entre las semanas del ${startWeek} y del ${endWeek}`
    : `la semana del ${startWeek}`;
  const tipo = recommendedAction(run, DEFAULT_OPTS.permanentContractThreshold);
  const contrato = tipo === 'contratar_permanente' ? 'permanente' : 'temporal';
  return `Se proyecta déficit de ${Math.round(run.peakShortfallHours)}h ${sustainedWord}` +
    ` con la capacidad permanente actual (${capacity.baselineWeeklyHours}h/sem).` +
    ` Se requieren ~${workersShort} persona(s) adicionales bajo contrato ${contrato}` +
    ` para cubrir el pico.` +
    ` Nota: la proyección usa ${avgHoursPerWorker}h/sem como base por trabajador y un` +
    ` supuesto de horas por actividad; revisa los supuestos antes de actuar.`;
}

function recommendHiring(input = {}) {
  const { projection, capacity, opts = {} } = input;
  const cfg = { ...DEFAULT_OPTS, ...opts };
  if (!projection || !Array.isArray(projection.weeks)) {
    return { recommendations: [], reason: 'missing_projection' };
  }
  if (!capacity || typeof capacity !== 'object') {
    return { recommendations: [], reason: 'missing_capacity' };
  }

  const avgHoursPerWorker = capacity.avgWeeklyHoursPermanent > 0
    ? capacity.avgWeeklyHoursPermanent
    : 40;
  const runs = findShortfallRuns(projection.weeks, capacity.baselineWeeklyHours, cfg.triggerShortfallHours);

  const recommendations = runs.map(run => {
    const tipo = recommendedAction(run, cfg.permanentContractThreshold);
    return {
      weekStart: run.weeks[0]?.weekStart,
      weekEnd: run.weeks[run.weeks.length - 1]?.weekEnd,
      consecutiveWeeks: run.length,
      peakShortfallHours: Math.round(run.peakShortfallHours * 10) / 10,
      averageShortfallHours: Math.round(run.averageShortfallHours * 10) / 10,
      workersShort: Math.ceil(run.peakShortfallHours / Math.max(avgHoursPerWorker, 1)),
      urgency: classifyUrgency(run, cfg.urgentWindowWeeks),
      recommendedAction: tipo,
      reasoning: describeRun(run, capacity, avgHoursPerWorker),
    };
  });

  return {
    recommendations,
    reason: recommendations.length > 0 ? 'shortfall_detected' : 'no_shortfall',
    summary: {
      totalRunsDetected: runs.length,
      baselineWeeklyHours: capacity.baselineWeeklyHours,
      avgWeeklyHoursPerWorker: avgHoursPerWorker,
    },
  };
}

module.exports = {
  recommendHiring,
  weeklyShortfall,
  findShortfallRuns,
  classifyUrgency,
  recommendedAction,
  DEFAULT_OPTS,
};
