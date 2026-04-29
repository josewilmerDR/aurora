# Aurora — Code Standards

**Status:** Active (2026-04). This is the reference contract for new code AND the migration target for legacy code. When you touch a file, leave it closer to this standard than you found it.

This document exists because Aurora grew from a small Express app into a full-stack agronomy platform with 50+ Firebase routers, 6 autopilot phases, and 100+ tests. The codebase is now mixed: some domains are clean (`routes/budgets/`, `routes/financing/`), some are monoliths (`routes/autopilot.js`, `routes/hr.js`). To stay maintainable for both humans and AI agents, every domain should look the same.

The two non-negotiable principles:

1. **A new contributor (human or AI) should be able to open any domain folder and understand it without reading the rest of the codebase.**
2. **Cross-cutting concerns (auth, validation, errors, logging, rate limiting) live in [functions/lib/](../functions/lib/) and are imported, never duplicated.**

---

## 1. Backend domain structure

Every backend domain lives under `functions/routes/<domain>/` with this exact layout:

```
functions/routes/<domain>/
  index.js          — Router definition. Mounts handlers from this folder. Imported by functions/index.js.
  schemas.js        — Zod schemas + inferred types. Single source of truth for the domain's payloads.
  routes.js         — HTTP handlers. Thin: parse → validate → service → respond.
                      (Or split into crud.js + <feature>.js when there are 5+ handlers.)
  service.js        — Business logic. Orchestrates the repository + cross-domain helpers.
                      Optional for pure CRUD domains; required when handlers do anything beyond a single Firestore call.
  repository.js     — The ONLY file in the domain that touches db.collection(). Owns all queries.
                      Optional for trivial CRUD; required when queries are reused or non-trivial.
  __tests__/
    schemas.test.js       — Pure unit, mocks nothing.
    service.test.js       — Pure unit, mocks the repository.
    routes.integ.test.js  — Integration, runs against the Firestore emulator.
```

**Reference implementation:** [functions/routes/budgets/](../functions/routes/budgets/) (after Zod migration) is the canonical template. When in doubt, copy its layout.

**When you don't need every file:**
- A domain with one endpoint and a single `db.collection().get()` can collapse `service.js` and `repository.js` into the handler.
- A domain with no schemas (e.g. `GET /api/health`) doesn't need `schemas.js`.
- The structure scales: add files as complexity grows; never invent new top-level kinds (no `controllers.js`, no `validators.js`, no `utils.js`).

### Mounting

[functions/index.js](../functions/index.js) requires the domain folder once: `app.use(require('./routes/budgets'))`. No path prefixes — full paths (`/api/budgets`) live inside the router. This is already the convention; preserve it.

---

## 2. Naming conventions

| Element | Convention | Examples |
|---|---|---|
| Domain folders | `kebab-case`, **English** | `routes/procurement-invoices/`, `routes/field-records/` |
| JS files | `camelCase` | `creditProductValidator.js`, `annualPlans.js` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_NOTES`, `BUDGET_CATEGORIES` |
| Functions | `camelCase`, verb-first | `buildBudgetDoc`, `computeRoi`, `enrichTask` |
| Firestore collections | `snake_case` (legacy keeps Spanish) | `scheduled_tasks`, `audit_events`, `credit_products` |
| Firestore field names | `camelCase` (legacy mixed) | `fincaId`, `assignedAmountCRC`, `executeAt` |
| HTTP routes | `kebab-case`, **English** | `/api/credit-products`, `/api/debt-simulations` |
| Error codes | `SCREAMING_SNAKE_CASE` | `VALIDATION_FAILED`, `NO_FINCA_ACCESS` |
| User-facing strings (UI) | **Spanish** | `"Presupuesto creado"`, `"Crédito no elegible"` |
| Code comments | English preferred, Spanish allowed | — |

**Spanish → English domain renames** are part of the migration. Keep the legacy route as an alias during the cutover; remove once the frontend is migrated:

| Legacy (Spanish) | Target (English) |
|---|---|
| `routes/compras` | `routes/procurement-invoices` |
| `routes/cedulas` | `routes/field-records` |
| `routes/siembra` | `routes/planting` |
| `routes/cosecha` | `routes/harvest` |
| `routes/productos` | `routes/products` |
| `routes/proveedores` | `routes/suppliers-legacy` (then merge into new `routes/suppliers`) |
| `routes/horimetro` | `routes/equipment-hours` |
| `routes/combustible` | `routes/fuel` |
| `routes/maquinaria` | `routes/machinery` |
| `routes/calibraciones` | `routes/calibrations` |
| `routes/labores` | `routes/labor-records` |
| `routes/lotes` | `routes/plots` |
| `routes/grupos` | `routes/groups` |
| `routes/bodegas` | `routes/warehouses` |
| `routes/unidades` | `routes/units` |
| `routes/monitoreo` | `routes/monitoring` |
| `routes/costos` | `routes/costs` |

Renames are cosmetic — schedule them last, never first. Doing one per touched PR avoids a giant migration commit.

---

## 3. Validation — Zod

Validation lives in `<domain>/schemas.js`. Use [Zod](https://zod.dev) for every request payload.

**Why Zod:**
- One declaration = type, runtime validation, error message
- Composable schemas (extend, pick, partial, refine)
- Predictable error format we can map to our `ApiError` shape
- Reads like documentation — both humans and AI parse it instantly

**The pattern:**

```js
// functions/routes/budgets/schemas.js
const { z } = require('zod');
const { BUDGET_CATEGORY_SET } = require('../../lib/finance/categories');
const { isValidPeriod } = require('../../lib/finance/periodRange');

const budgetInputSchema = z.object({
  period: z.string().refine(isValidPeriod, {
    message: 'Period must be YYYY, YYYY-Qn, or YYYY-MM.',
  }),
  category: z.string().refine((c) => BUDGET_CATEGORY_SET.has(c), {
    message: 'Category is not valid.',
  }),
  assignedAmount: z.coerce.number().min(0).max(1e12),
  currency: z.enum(['USD', 'CRC']).catch('CRC'),  // soft fallback
  exchangeRateToCRC: z.coerce.number().min(0.0001).max(100000).optional(),
  loteId: z.string().trim().max(128).nullish(),
  grupoId: z.string().trim().max(128).nullish(),
  notes: z.string().trim().max(1000).default(''),
});

function buildBudgetDoc(body) {
  const parsed = budgetInputSchema.safeParse(body);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  // Cross-field rules go here (Zod's .refine on object can also do this).
  // ...
  return { data: { ... } };
}

module.exports = { buildBudgetDoc, budgetInputSchema };
```

**Conventions:**
- Schemas return `{ data, error }` from a `buildXDoc(body)` wrapper. The route handler stays the same.
- Soft-fallback fields (currency, status, paymentType) use `.catch(default)` — silently coerce invalid values. Reserve hard errors for truly required fields.
- Trim strings with `.trim()`. Cap lengths with `.max()`. Don't sanitize HTML at this layer (that's the renderer's job).
- Cross-field rules (e.g. "USD requires exchangeRateToCRC") go in a `.refine()` on the object schema OR in the `buildXDoc` wrapper if the rule needs computed fields.
- Export the schema itself, not just the wrapper — tests and other domains may want to compose it.

**What NOT to do:**
- Don't put Zod inside `routes.js` handlers — keep handlers thin.
- Don't write hand-rolled validators in new code (`if (typeof body.x !== 'string')`). The existing 36 loose routes will be migrated incrementally.
- Don't validate query params and body with the same schema — they have different shapes. Use `z.object({ ... }).parse(req.query)` separately.

---

## 4. Data access — repository pattern

`db.collection(...)` calls live in `<domain>/repository.js`. **Nothing else in the domain touches Firestore directly.** Routes call services; services call the repository; the repository owns queries.

**Why:**
- One place to add an index hint, change a query shape, or memoize.
- Tests can mock the repository instead of Firestore.
- Cross-domain duplication becomes visible — if `routes/strategy.js` and `routes/cosecha.js` both query `siembras`, that query belongs in a shared `lib/<domain>/repository.js`.

**Example skeleton:**

```js
// functions/routes/budgets/repository.js
const { db, FieldValue } = require('../../lib/firebase');

async function listByFinca(fincaId, { period, category } = {}) {
  let q = db.collection('budgets').where('fincaId', '==', fincaId);
  if (period) q = q.where('period', '==', period);
  if (category) q = q.where('category', '==', category);
  const snap = await q.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function create(fincaId, uid, userEmail, data) {
  const doc = await db.collection('budgets').add({
    ...data,
    fincaId,
    createdBy: uid,
    createdByEmail: userEmail || '',
    createdAt: FieldValue.serverTimestamp(),
  });
  return doc.id;
}

module.exports = { listByFinca, create };
```

**Allowed exceptions** (don't extract a repository for these):
- One-shot scripts in `functions/seed.js`, `functions/dump-seed.js`.
- Scheduled functions in `functions/scheduled/` that run a single query — those are the repository.

---

## 5. Cross-cutting helpers — where to import from

Don't duplicate any of these. If you need something similar, extend the existing helper or add a sibling.

| Concern | Module | Exports |
|---|---|---|
| Auth + finca membership | [lib/middleware.js](../functions/lib/middleware.js) | `authenticate`, `authenticateOnly` |
| API errors | [lib/errors.js](../functions/lib/errors.js) | `ERROR_CODES`, `ApiError`, `sendApiError`, `handleApiError` |
| Firestore handles | [lib/firebase.js](../functions/lib/firebase.js) | `db`, `admin`, `Timestamp`, `FieldValue`, `functions`, `allSecrets` |
| Lazy clients | [lib/clients.js](../functions/lib/clients.js) | `getTwilioClient()`, `getAnthropicClient()` |
| Roles + ownership | [lib/helpers.js](../functions/lib/helpers.js) | `verifyOwnership`, `hasMinRoleBE`, `ROLE_LEVELS_BE`, `pick`, `writeFeedEvent` |
| AI prompt safety | [lib/aiGuards.js](../functions/lib/aiGuards.js) | `INJECTION_GUARD_PREAMBLE`, `wrapUntrusted`, `stripCodeFence`, `looksInjected`, `boundedNumber`, `boundedString` |
| Rate limiting | [lib/rateLimit.js](../functions/lib/rateLimit.js) | `rateLimit(uid, bucket, opts)` |
| Audit logging | [lib/auditLog.js](../functions/lib/auditLog.js) | `writeAuditEvent`, `ACTIONS`, `SEVERITY` |
| Module access (custom roles) | [lib/moduleMap.js](../functions/lib/moduleMap.js) | `checkModuleAccess` |

**Rule of thumb:** if a domain reaches for the same utility three times across the codebase, it belongs in `lib/`. If it's specific to one domain, it stays in the domain folder.

---

## 6. Error responses — the contract

Every error response goes through `sendApiError(res, code, devMessage, status)`. Response shape:

```json
{ "code": "VALIDATION_FAILED", "message": "Period must be YYYY, YYYY-Qn, or YYYY-MM." }
```

- `code` is one of `ERROR_CODES` from [lib/errors.js](../functions/lib/errors.js). Add new codes there, never inline.
- `message` is **English** (it's a dev message; logs and external APIs read it). The frontend maps codes to Spanish strings in [src/lib/errorMessages.js](../src/lib/errorMessages.js).
- HTTP status: `400` for validation/input, `401` for auth, `403` for authz, `404` for missing resource, `409` for conflict, `429` for rate limit, `500` for server bugs.

In handlers, prefer `try { ... } catch (err) { handleApiError(res, err, 'Failed to create budget.') }` over manual `console.error + sendApiError` — `handleApiError` already covers the `ApiError` instance case.

---

## 7. Testing

### 7.1 Where tests live

| Kind | Location | Filename |
|---|---|---|
| Unit (pure / mocked deps) | `functions/routes/<domain>/__tests__/` (collocated) | `<thing>.test.js` |
| Unit (cross-domain logic) | `functions/lib/<area>/__tests__/` | `<thing>.test.js` |
| Integration (Firestore emulator) | Same `__tests__/` folder | `<thing>.integ.test.js` |
| Frontend unit | `src/features/<domain>/__tests__/` | `<thing>.test.jsx` |

**Migration note:** existing tests in [functions/tests/unit/](../functions/tests/unit/) and [functions/tests/integration/](../functions/tests/integration/) stay where they are. New tests go collocated. Move legacy tests next to their code only when you're already touching the file.

### 7.2 Frameworks

- **Backend:** Jest 29 (already configured in [functions/jest.config.js](../functions/jest.config.js)).
- **Frontend:** Vitest + React Testing Library (to be added in F4 of the production-grade plan). Don't add another runner.
- **No Mocha, Vitest-on-backend, or Cypress.** Adding a runner needs a doc update first.

### 7.3 Conventions

- **`describe()` + `test()`** (not `it()`).
- Test names describe **outcomes**, not implementation: `'rejects negative assignedAmount'` ✅, `'returns error from numberInRange'` ❌.
- One assertion per test where reasonable. Multiple `expect()` are fine when they describe one outcome (e.g. shape of returned doc).
- Integration tests use `uniqueFincaId()` to namespace their data and clean up after themselves. See [functions/tests/integration/actions.happy.test.js](../functions/tests/integration/actions.happy.test.js) for the pattern.
- Mock Twilio/Anthropic via `jest.mock('../../lib/clients')`. Never mock Firestore — use the emulator for integration, pure inputs for unit.

### 7.4 Coverage

- Global threshold (to be enforced in CI, F7): `statements 60 / branches 50 / functions 60 / lines 60`.
- Per-domain overrides for safety-critical code (autopilot guardrails, financing, killswitch): `statements 80 / branches 70`.
- Coverage is reported per PR but failing thresholds is **only blocking on CI**, not locally — running `npm test` should be fast.

### 7.5 Fixtures

Builders live in [functions/tests/fixtures/](../functions/tests/fixtures/) (to be created in F4). One file per collection. Builders compose:

```js
const { buildLote } = require('../fixtures/lote');
const lote = buildLote({ fincaId: 'finca_x', hectareas: 5 });
```

When you find yourself writing the same `db.collection('lotes').add({ ... })` twice, extract a builder.

---

## 8. Frontend structure

The frontend is already mostly aligned. The standard:

```
src/
  features/<domain>/
    pages/             — Route-level components
    components/        — Domain-scoped components (subfolder per page if needed)
    hooks/             — Domain-scoped hooks
    api.js             — Wraps useApiFetch calls for this domain (single import surface)
    schemas.js         — Frontend-side schemas (form validation) — same Zod schemas reused if shared
    styles/            — Domain-scoped CSS
    __tests__/         — Component and hook tests
  components/ui/       — Primitives only (AuroraCombobox, Toast, AuroraConfirmModal). NO domain logic.
  components/shell/    — App chrome (Sidebar, AppHeader, MobileNav). NOT shared, just hoisted.
  hooks/               — Cross-cutting hooks (useApiFetch, usePushNotifications, useDraft)
  lib/                 — Cross-cutting utilities (apiFetch, firebase, errorMessages)
  contexts/            — Cross-cutting contexts (UserContext, RemindersContext)
```

**Conventions:**
- Components: `PascalCase.jsx`. Hooks: `useXxx.js`. Utils: `camelCase.js`.
- API calls go through `useApiFetch()` ([src/hooks/useApiFetch.js](../src/hooks/useApiFetch.js)) — never `fetch()` directly. The hook attaches Firebase Auth, App Check, and `X-Finca-Id`.
- One CSS file per component or per feature (`src/features/hr/styles/hr.css`). No CSS-in-JS, no Tailwind, no CSS Modules. Existing convention is BEM-ish with `.aur-*`, `.hr-*`, `.fin-*` prefixes — keep it.
- A component over **400 LOC** is a smell. Over **600 LOC** is a refactor target ([Sidebar.jsx](../src/components/Sidebar.jsx), [AuroraChat.jsx](../src/components/AuroraChat.jsx) qualify today).

---

## 9. File size budget

| File kind | Soft limit | Hard limit (refactor target) |
|---|---|---|
| `routes/<domain>/index.js` | 50 LOC | 100 LOC |
| `routes/<domain>/routes.js` (or `crud.js`) | 200 LOC | 400 LOC |
| `routes/<domain>/service.js` | 300 LOC | 500 LOC |
| `routes/<domain>/repository.js` | 200 LOC | 400 LOC |
| `routes/<domain>/schemas.js` | 150 LOC | 300 LOC |
| Single-file route (legacy, pre-domain) | 300 LOC | 500 LOC |
| React component | 250 LOC | 400 LOC |
| React page | 400 LOC | 600 LOC |

Hard-limit violators today: [routes/autopilot.js](../functions/routes/autopilot.js) (2085), [routes/hr.js](../functions/routes/hr.js) (1898), [routes/chat.js](../functions/routes/chat.js) (1341), [routes/cedulas.js](../functions/routes/cedulas.js) (1193), [routes/compras.js](../functions/routes/compras.js) (870). These are explicit refactor targets in F5.

---

## 10. Migration strategy

This document is the target. The existing 50+ routers don't all match it today. Migration rules:

1. **New domains** must follow this standard from day one. No exceptions.
2. **Touched legacy code** moves at least one step closer to the standard:
   - Adding a handler to `routes/hr.js`? Extract the relevant schema to a new `routes/hr/schemas.js` first.
   - Fixing a bug in `routes/compras.js`? Convert that endpoint's validation to Zod.
   - Renaming Spanish → English happens last; not while fixing bugs.
3. **Scheduled migrations** (F2-F7 of the production-grade plan):
   - F2: Zod for all currently-modular domains.
   - F3: Repository pattern for the same domains.
   - F4: Frontend testing setup + 3 smoke suites.
   - F5: Split monoliths into domains.
   - F6: ES → EN renames.
   - F7: CI coverage thresholds.
4. **Don't refactor speculatively.** A refactor PR is OK; a refactor PR bundled with feature work is not. Keep diffs reviewable.

---

## 11. When this document changes

If you change any rule here, the PR must:
- Update this file
- Update [CLAUDE.md](../CLAUDE.md) if it mentions the changed rule
- Add a `## What changed` section at the bottom of the PR description so reviewers see the policy delta

The point is to keep this file authoritative. If two parts of the codebase contradict it, the codebase is wrong, not the doc — fix it forward.
