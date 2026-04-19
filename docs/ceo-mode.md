# CEO Mode — Aurora Meta-agency Operations Manual

**Status:** Active (Fase 6, 2026-04). This document is the definitive reference for the meta-agent layer: what it does, how it decides, what stops it, and the conditions under which an administrator may escalate it to higher autonomy.

## What the meta-agent is

The meta-agent sits **above** the five specialist autopilot agents built in Fases 1-5:

| Specialist | Domain | Max level by policy |
|---|---|---|
| Financial agent (Fase 1.6) | Budget reallocation, cash floor, ROI | Nivel 3 |
| Procurement agent (Fase 2.2) | Stock-gap OCs, supplier scoring, RFQs | Nivel 3 |
| HR agent (Fase 3.4) | Hiring / discipline recommendations | **Nivel 2 capped** |
| Strategy agent (Fase 4.2, 4.5) | Rotation recommender, annual plan | Nivel 3 |
| Financing agent (Fase 5.3-5.4) | Eligibility, debt ROI | **Nivel 1 only** |

The meta-agent's job is to **coordinate** them: observe the finca's state, decide which specialist should act and in what order, and (at higher levels) chain cross-domain actions atomically. It does not replace any of them.

## Five layers of the stack

| Layer | Sub-phase | What it produces |
|---|---|---|
| 6.0 FincaState snapshot | [fincaStateBuilder.js](../functions/lib/meta/fincaStateBuilder.js) | Deterministic, hashed view of all five domains |
| 6.1 Orchestrator | [orchestrator/](../functions/lib/meta/orchestrator/) | Per-domain urgency + ordered call plan |
| 6.2 KPI sweep | [kpi/](../functions/lib/meta/kpi/) | Per-action outcome measurement at 30/90/365d |
| 6.3 Trust manager | [trust/](../functions/lib/meta/trust/) | Domain trust scores → guardrail corridor adjustments |
| 6.4 Chain executor | [chains/](../functions/lib/meta/chains/) | Cross-domain action sequences with rollback cascade |
| 6.5 Observability | [ceo/](../src/pages/ceo/) | Admin dashboard at `/ceo` |

## Autonomy levels

The meta domain (`autopilot_config.dominios.meta.nivel`) controls what the orchestrator and trust manager do, NOT what the specialists do.

| Meta level | Orchestrator | Trust manager | Chain executor |
|---|---|---|---|
| `off` | Disabled | Disabled | Disabled |
| `nivel1` | Emits plan as recommendation only | Proposals await admin approval | Plans only; execute requires N2+ |
| `nivel2` | Fan-out to specialist analyzers | Tightening auto-applies; relax stays proposed | Executes; rollback on failure |
| `nivel3` | Fan-out to specialist analyzers | Both directions auto-apply | Executes; rollback on failure |

Specialists keep their own caps in every case. Raising meta to nivel3 does NOT let HR or financing escalate past their architectural ceilings. This is enforced at four distinct layers — see [Defense in depth](#defense-in-depth).

## Defense in depth

The meta-agent can never bypass the caps baked into earlier phases. There is no single point of failure; every potentially risky code path is blocked at multiple layers:

### HR forbidden-at-nivel3 (Fase 3.0 cap)

Actions `sugerir_contratacion`, `sugerir_despido`, `sugerir_sancion`, `sugerir_memorando`, `sugerir_revision_desempeno` are never executable autonomously.

1. **UI** — [AutopilotConfig.jsx](../src/pages/AutopilotConfig.jsx) does not offer `nivel3` for the HR domain.
2. **PUT /api/autopilot/config** — rejects `dominios.rrhh.nivel='nivel3'` with HTTP 400.
3. **validateGuardrails** — returns an `hr`-category violation for any HR action at nivel3.
4. **Dispatcher** — `executeAutopilotAction` in [autopilotActions.js](../functions/lib/autopilotActions.js) throws `HrActionNotExecutableError` before the switch.

Chain allowlist excludes these types ([chainValidator.js](../functions/lib/meta/chains/chainValidator.js)); Claude's chain-planner tool excludes the `hr` domain from its enum; the rollout invariant test fails if any of the layers drift out of sync.

### Financing Nivel 1 only (Fase 5.5 policy)

The financing domain never produces autopilot actions. Action types `aplicar_credito`, `tomar_prestamo`, `contratar_deuda`, etc. do NOT exist in the dispatcher.

1. **[financingDomainGuards.js](../functions/lib/financing/financingDomainGuards.js)** — `resolveFinancingLevel()` always returns `'nivel1'`; `FORBIDDEN_ACTION_TYPES` names the types that would violate the policy.
2. **Routes** — eligibility and debt-simulation endpoints return HTTP 423 for non-`nivel1` configurations.
3. **UI** — AutopilotConfig's nivel selector for financing is `disabled` and fixed at nivel1.
4. **Actions invariant test** — [financing.actionsInvariant.test.js](../functions/tests/unit/financing.actionsInvariant.test.js) scans `autopilotActions.js` and fails if a financing action case appears.

See [financing-autonomy.md](./financing-autonomy.md) for the full policy.

### Trust corridor never touches architectural caps

The [trust corridor](../functions/lib/meta/trust/corridor.js) contains 8 quantitative guardrails (monetary amounts, counters, percentages). It contains zero level settings, zero kill-switch flags, zero references to financing or HR action types. `FORBIDDEN_CORRIDOR_KEYS` + the [meta.corridor.test.js](../functions/tests/unit/meta.corridor.test.js) invariant enforce this.

### Chain allowlist is positive, not a blocklist

[ALLOWED_CHAIN_ACTIONS](../functions/lib/meta/chains/chainValidator.js) names exactly 9 action types that are **compensable, non-HR, non-financing, non-notification**. Adding a new action to the chain set requires explicit editing of this list; adding a new action ANYWHERE else does not automatically make it chainable.

### Kill switches at every layer

- **Global:** `autopilot_config.paused` halts the dispatcher, chain executor, chain preflight, and orchestrator analyze — all return HTTP 423 or throw `AutopilotPausedError`. [meta.killSwitchCoverage.test.js](../functions/tests/unit/meta.killSwitchCoverage.test.js) enforces up-front rejection in the chain executor.
- **Per domain:** `autopilot_config.dominios.{finance|procurement|rrhh|strategy|financing|meta}.activo = false` disables that domain independently. Other domains keep running.
- **Rollback:** every compensable action writes a compensation descriptor during the same transaction. Admin can `POST /api/autopilot/actions/:id/rollback` within 7 days (compensation TTL). Chain failures trigger automatic rollback cascade in reverse order.

## Crons

| Cron | Schedule (UTC) | What it does |
|---|---|---|
| `hrMonthlyScoring` | `0 3 1 * *` | Day 1 of month: computes previous month's HR scores |
| `metaKpiSweep` | `0 4 * * *` | Daily: evaluates expired KPI windows for each action / run |
| `metaTrustRecompute` | `0 4 2 * *` | Day 2 of month: recomputes trust + emits guardrail proposals |
| `metaOrchestratorTick` | `0 */6 * * *` | Every 6h: invokes the orchestrator at the finca's configured meta level |
| `signalsIngestCron` | `every 60 minutes` | External signal ingestion (Fase 4.3) |
| `annualPlanActivator` | `every 60 minutes` | Promotes scheduled plans to active (Fase 4.5) |

Crons never raise their own level. They pass through `autopilot_config`. If an admin flips the finca to `nivel1`, the next cron tick produces recommendations only — no code change required.

## What to watch on the CEO Dashboard

`/ceo` (administrador-only) surfaces five widgets corresponding to the five layers of the stack. Check these at least weekly during the first three months after enabling nivel3:

- **Orchestrator.** The urgency tiles should mostly be green/low. Persistent `critical` urgencies in the same domain over multiple runs indicate a specialist agent is missing context — investigate before raising levels further.
- **Trust scores.** Healthy fincas converge to 0.7-0.9 per active domain after 2-3 months. A drop below 0.5 with non-trivial sample size is a signal to pause that domain and review recent actions.
- **Hit-rate (KPI).** Overall hit-rate ≥ 0.75 across 30-day windows is the go-ahead for considering N3 on domains that are currently N2. Below 0.6 → tighten guardrails or drop the domain's level.
- **Chain history.** Any `rolled_back_partial` chain is an incident. Investigate, resolve the pending compensations manually, document in the audit trail.
- **Dynamic guardrails.** Review pending proposals within a week. The corridor is bounded so approval is low-risk, but unreviewed proposals mask a stale configuration.

## When it's safe to move to nivel3

There is no single trigger. The bar is cumulative, and it accrues over time:

1. **≥ 3 consecutive months at nivel2** with zero unexpected executions.
2. **Overall hit-rate ≥ 0.75** in the 30-day window, with ≥ 50 decided observations.
3. **No rolled-back-partial chains** in the same window.
4. **Trust score ≥ 0.7** for every active non-frozen domain (finance, procurement, strategy).
5. **Review of the last 10 approved guardrail proposals** — the administrator genuinely read and evaluated each one.
6. **Written sign-off** from the finca owner that this is OK, recorded in the annual plan changelog or equivalent audit trail.

HR and financing never move to nivel3 regardless of these conditions. Those caps are architectural, not configurational.

## When to pull back

Signs that warrant dropping from N3 back to N2 (or N2 to N1):

- A chain rolls back and the admin realizes the rollback itself was too coarse.
- An autonomous guardrail relax leads to a `maxOrdenCompraMonto` violation in the subsequent month.
- Trust score in any domain drops by ≥ 0.2 from the prior month.
- Any data-loss event, even if caused by a different system — pause while investigating.
- Regulatory or ownership changes at the finca.

Dropping a level is a one-line config edit. Doing it reflexively under stress is the correct behavior — the agent is a tool, not an identity.

## The rollback flow

If something goes wrong, here is the cascade of recovery options from cheapest to most disruptive:

1. **Individual action rollback.** `POST /api/autopilot/actions/:id/rollback` within 7 days. Compensation handlers in [autopilotCompensations.js](../functions/lib/autopilotCompensations.js) reverse the specific side effect.
2. **Pause the meta domain.** `autopilot_config.dominios.meta.activo = false`. Orchestrator + chains + trust manager halt; specialists keep operating at their own levels.
3. **Pause a specific specialist.** Flip its per-domain `activo` flag.
4. **Global pause.** `POST /api/autopilot/pause`. Halts everything, including in-flight chains (next step refuses). Rollback still available for past actions.
5. **Manual intervention.** If a compensation fails or the chain state is `rolled_back_partial`, a human has to clean up via direct Firestore edits. Every partial rollback logs `execution.rollback.perStepOutcome[]` with the specific action IDs that remain non-reverted.

## Related documents

- [financing-autonomy.md](./financing-autonomy.md) — why financing is N1-only forever.
- Per-phase project memory files in `memory/project_fase_6_*.md` — the historical record of what each sub-phase shipped.

## Changelog

- 2026-04 — Fases 6.0 through 6.6 landed. Initial release of this document.
