# Financing domain — Nivel 1 only by policy

**Status:** Active policy (Fase 5.5, 2026-04-19). Any change requires explicit product-level sign-off — not a code review tweak.

## What this policy says

The `financing` domain of Aurora Autopilot is **Nivel 1 only** — it produces recommendations, never autonomous actions.

Concretely:

- `autopilotActions.js` contains **zero** action handlers in the financing domain. The invariant is asserted by [financing.actionsInvariant.test.js](../functions/tests/unit/financing.actionsInvariant.test.js) and by the `FORBIDDEN_ACTION_TYPES` list in [financingDomainGuards.js](../functions/lib/financing/financingDomainGuards.js).
- `resolveFinancingLevel(config, globalMode)` returns `'nivel1'` unconditionally, even if `autopilot_config.dominios.financing.nivel` is set to `nivel2` or `nivel3`.
- The eligibility and debt-simulation routes read the configured domain level and return **HTTP 423** if the user tried to escalate it.
- The Autopilot settings UI does not offer `nivel2` / `nivel3` options for the financing domain.

## Why

Contracting debt is:

1. **Irreversible on a multi-year horizon.** Unlike an inventory adjustment or a task reassignment, a loan signed today shapes cash flow for 12-60 months. Compensations cannot unwind a bank's ledger.
2. **Externally binding.** An error by Aurora doesn't just affect Firestore — it affects a counterparty (bank, cooperative, fintech) and the legal representative of the finca.
3. **Poorly bounded by existing guardrails.** Budget caps, cash floor, max OC amount — none of them meaningfully limit a decision to *take on* debt. The harm is usually measured in years, not in a single transaction.
4. **Built on information Aurora doesn't own.** The finca's legal standing, the owner's personal credit history, the collateral chain, legal counsel — Aurora has none of these. Any autonomous decision here is made with a partial picture.

Analysis (Nivel 1) remains highly valuable. It is the *execution* — signing, applying, accepting offers — that stays with a human.

## What would justify revisiting this policy

Not a single metric. The bar is cumulative evidence across multiple axes, and it accrues over time:

- **≥ 24 months of production use** of Fases 1-4 in autonomous modes (financial agent, procurement agent, HR recommendations, strategic annual plan).
- **Audited outcomes vs. decisions.** The 4.5 annual-plan changelog + the 3.6 HR audit collection contain machine-readable decision/outcome pairs. Aurora's autonomous recommendations must be validated against realized outcomes with a measurable accuracy (proposal: ≥ 85% agreement with the administrator's retrospective assessment at 6- and 12-month lookback windows).
- **Incident-free record on Nivel 3 domains.** Zero data-loss incidents and zero guardrail violations that required manual rollback across Fases 1-4 for at least 12 consecutive months.
- **Stakeholder review.** Legal counsel, accountant, and the finca owner sign off on any automation of credit application, with the specific product class and amount ceiling documented.
- **Regulatory context.** Whatever the financial regulator says about AI-driven credit applications at the time.

## Operational details

- **Kill switch per domain.** `autopilot_config.dominios.financing.activo = false` disables all financing endpoints with HTTP 423, independent of the rest of Autopilot. The global kill switch (`isPaused(fincaId)`) also applies.
- **Role gating is additive to this policy.** `administrador` is required to create snapshots, write catalog entries, and trigger eligibility analysis. Simulation and reads are open to `supervisor+`. None of these roles can escalate autonomy — the domain-level cap takes precedence.
- **Where the guard lives.** [financingDomainGuards.js](../functions/lib/financing/financingDomainGuards.js) exports `assertNivelAllowed(level)` for any future code path that processes an explicit level. [eligibility.js](../functions/routes/financing/eligibility.js) and [debtSimulations.js](../functions/routes/financing/debtSimulations.js) read `dominios.financing.nivel` from the config and block if the user set anything other than `nivel1`.

## Related Fase 5 sub-phases

- **5.1 Financial profile** — the data a credit application needs (balance sheet, income statement, 12m cash flow + 6m projection) exportable as JSON/HTML.
- **5.2 Credit product catalog** — the shelf of financing options with amortization math.
- **5.3 Eligibility analysis** — scoring + Claude refinement; persisted, auditable.
- **5.4 Debt ROI Monte Carlo** — simulates the effect of a loan on the annual margin across Pesimista/Base/Optimista scenarios, seed-reproducible.
- **5.5 (this policy)** — the human boundary that keeps 5.1-5.4 useful without becoming dangerous.
