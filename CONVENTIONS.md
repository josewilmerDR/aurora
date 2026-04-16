# Code Conventions

> **Audience:** all contributors, including non-Spanish speakers.
> **Project context:** Aurora is an agricultural management platform built for farms in Colombia. Its **users speak Spanish** and its **business domain uses Spanish-only terms** (e.g., *finca*, *lote*, *cédula*, *paquete*). Its **technical stack speaks English** (React, Firebase, Express, npm). This document defines how we keep both worlds coexisting cleanly.

---

## 1. The core rule

| Layer                                      | Language    | Rationale                                                              |
| ------------------------------------------ | ----------- | ---------------------------------------------------------------------- |
| Code identifiers (variables, functions)    | **English** | Aligns with all third-party libraries, AI tooling, and standard lint rules. |
| File and folder names                      | **English** | Searchability; matches framework conventions (Next.js, RN, etc.).      |
| Git branches, commits, PR titles           | **English** | GitHub conventions; readable by any future contributor.                |
| Code comments, JSDoc, inline docs          | **English** | Same as above.                                                         |
| API routes (`/api/...`)                    | **English** | Public-ish surface; standard REST naming.                              |
| **Domain entities** (Firestore collections, fields representing business concepts) | **Spanish** | These names *are the business*. Translating `finca` to `farm` loses meaning and creates ambiguity with users/stakeholders. |
| User-facing UI text (labels, copy, toasts) | **Spanish** | The product is Spanish-only.                                           |
| User-facing error messages                 | **Spanish** | Same.                                                                  |
| Internal logs, thrown `Error()` messages   | **English** | Consumed by developers, not users.                                     |

**Mnemonic:** *English for the engineer, Spanish for the farmer.*

---

## 2. The "domain term" exception, in detail

Some Spanish words are **proper nouns of the domain** and must stay in Spanish even when used inside English code. They are documented in the glossary (§7) so non-Spanish speakers can read the codebase without translation tools.

```js
// ✅ Correct: domain term in Spanish, surrounding code in English
async function getLotesByFinca(fincaId) {
  const snapshot = await db.collection('lotes').where('fincaId', '==', fincaId).get();
  return snapshot.docs.map(formatLoteResponse);
}

// ❌ Wrong: translating domain breaks alignment with database, UI, and stakeholders
async function getPlotsByFarm(farmId) { ... }

// ❌ Wrong: full Spanish, breaks alignment with libraries and tooling
async function obtenerLotesPorFinca(idFinca) { ... }
```

**Rule of thumb:** if the term appears as a Firestore collection name, a UI label the user reads, or a word a Colombian farmer would say out loud — **keep it Spanish**. Everything else is English.

---

## 3. Naming conventions

| Element             | Convention            | Example                                              |
| ------------------- | --------------------- | ---------------------------------------------------- |
| Variables           | `camelCase`           | `loteId`, `currentUser`, `totalHectareas`            |
| Functions           | `camelCase` + verb    | `createLote()`, `enrichTask()`, `validateGuardrails()` |
| React components    | `PascalCase`          | `LoteManagement`, `TaskAction`                       |
| React files         | `PascalCase.jsx`      | `LoteManagement.jsx`                                 |
| Hooks               | `useCamelCase`        | `useCurrentUser()`, `useLotes()`                     |
| Constants           | `SCREAMING_SNAKE_CASE` | `ID_FINCA_ACTUAL`, `ROLE_LEVELS`                    |
| Backend route files | `lowercase.js`        | `lotes.js`, `users.js`                               |
| Backend helpers     | `camelCase.js`        | `firebase.js`, `middleware.js`                       |
| Firestore collections | `lowercase`, plural, Spanish | `lotes`, `productos`, `usuarios`, `cedulas`     |
| Firestore fields    | `camelCase`, Spanish for domain | `nombreLote`, `fincaId`, `stockActual`         |
| API endpoints       | `kebab-case`, English (or domain term) plural | `/api/users`, `/api/scheduled-tasks`, `/api/lotes` |
| CSS classes         | `kebab-case`          | `.info-list`, `.empty-state`                         |
| CSS variables       | `--aurora-kebab-case` | `--aurora-green`, `--aurora-dark-blue`               |
| Booleans            | prefix `is/has/can/should` | `isLoggedIn`, `hasMinRole`, `canEdit`           |
| Event handlers      | prefix `handle` or `on` | `handleSubmit`, `onLoteSelect`                     |

---

## 4. File and folder structure

Aurora's current layout — keep it consistent as the project grows.

```
aurora/
├── functions/                    # Firebase Cloud Functions (backend)
│   ├── index.js                  # Entry point: mount routers, export Cloud Functions
│   ├── lib/                      # Cross-cutting infrastructure
│   │   ├── firebase.js           # admin init, db, secrets
│   │   ├── clients.js            # Lazy singletons (Twilio, Anthropic)
│   │   ├── middleware.js         # authenticate, authorize
│   │   └── helpers.js            # Shared business helpers
│   ├── routes/                   # One file per domain. Each exports an Express Router.
│   │   ├── lotes.js
│   │   ├── users.js
│   │   └── ...
│   └── scheduled/                # Cron-triggered functions
│
├── src/                          # React frontend
│   ├── App.jsx                   # Routing root
│   ├── main.jsx                  # ReactDOM entry
│   ├── index.css                 # Global CSS variables (design system)
│   ├── pages/                    # One folder/file per route. PascalCase.
│   ├── components/               # Reusable UI components. PascalCase.
│   ├── contexts/                 # React Context providers
│   ├── hooks/                    # Custom hooks (use*)
│   ├── lib/                      # Frontend utilities (api client, formatters)
│   └── assets/                   # Static images, icons
│
├── public/                       # Vite static assets
├── CLAUDE.md                     # Guidance for the AI assistant
├── CONVENTIONS.md                # This file
└── README.md                     # Setup, architecture overview
```

### Co-location rule

Component-specific styles live next to the component:
`LoteManagement.jsx` + `LoteManagement.css` in the same folder. Do **not** create a parallel `styles/` tree.

### When a page grows too large

If a page exceeds ~500 LOC or grows several sub-views, promote it from a single file to a folder:

```
pages/Cosecha.jsx                 →    pages/Cosecha/
                                        ├── index.jsx           # Default export
                                        ├── CosechaHeader.jsx
                                        ├── CosechaTable.jsx
                                        └── Cosecha.css
```

Imports stay clean: `import Cosecha from './pages/Cosecha'`.

---

## 5. Backend conventions

- **One router per domain.** New domain → new file in `functions/routes/`. Mount it in `index.js` with `app.use(require('./routes/<name>'))`.
- **Full paths inside the router.** Use `router.get('/api/lotes', ...)`, not `router.get('/', ...)`. This keeps every endpoint greppable.
- **Validate at the boundary.** Trust internal calls; validate user input on the way in.
- **Auth middleware:** `authenticate` for endpoints that need a user, `authenticateOnly` for token-only checks. Don't roll your own.
- **Errors:** throw or return `res.status(4xx).json({ error: 'message in English for devs' })`. UI translates if needed.
- **Secrets:** declare with `defineSecret()` in `lib/firebase.js`, never inline in route files.

---

## 6. Frontend conventions

- **One concern per component.** A page composes; a component renders.
- **Data fetching** lives in the page or a custom hook, not deep in leaves.
- **State:** local `useState` first, lift only when shared, reach for context only for truly global state (`UserContext`).
- **Styling:** use the CSS variables in [src/index.css](src/index.css). Don't hardcode colors. Add a new variable instead of duplicating a hex value.
- **API calls:** use relative `/api/...` paths. The Vite proxy handles dev; production hits the same origin.
- **Imports order:** (1) external libs, (2) absolute internal, (3) relative, (4) styles. Blank line between groups.

---

## 7. Domain glossary

This glossary is the **single source of truth** for what each Spanish term means. Add to it whenever you introduce a new domain term.

| Spanish term       | English meaning                                      | Notes                                      |
| ------------------ | ---------------------------------------------------- | ------------------------------------------ |
| `finca`            | farm / agricultural estate                           | Top-level tenant boundary.                 |
| `lote`             | plot / field within a farm                           | Has hectares and a crop package.           |
| `paquete`          | crop package / cultivation plan template             | Defines activities to run for a crop.      |
| `actividad`        | activity / scheduled work item                       | Belongs to a paquete.                      |
| `cédula`           | application record / spray record document           | Legal/regulatory record of a treatment.    |
| `bodega`           | warehouse / storehouse                               | Holds inventory.                           |
| `producto`         | input product (agrochemical, seed, fertilizer)       | Has stock, recipe per hectare.             |
| `aplicación`       | application of an agrochemical                       | Activity type that deducts stock.          |
| `cosecha`          | harvest                                              |                                            |
| `siembra`          | planting / sowing                                    |                                            |
| `monitoreo`        | crop monitoring / scouting                           |                                            |
| `horímetro`        | hour meter (machinery)                               |                                            |
| `combustible`      | fuel                                                 |                                            |
| `maquinaria`       | machinery                                            |                                            |
| `proveedor`        | supplier / vendor                                    |                                            |
| `compra`           | purchase                                             |                                            |
| `OC` / `orden de compra` | purchase order                                 |                                            |
| `solicitud de compra`    | purchase request                               |                                            |
| `unidad de medida` | unit of measure                                      |                                            |
| `calibración`      | equipment calibration                                |                                            |
| `labor`            | labor task / fieldwork                               |                                            |
| `grupo`            | crew / group of workers                              |                                            |
| `planilla`         | payroll                                              |                                            |
| `responsable`      | assignee / person in charge                          |                                            |
| `encargado`, `supervisor`, `administrador`, `trabajador` | role names | See `ROLE_LEVELS` in [src/contexts/UserContext.jsx](src/contexts/UserContext.jsx). |

---

## 8. Git conventions

- **Branches:** `type/short-description` in English. Types: `feat`, `fix`, `improve`, `refactor`, `chore`, `docs`.
  - `feat/cosecha-projection`, `fix/lote-creation-validation`
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) style.
  - `feat(cosecha): add yield projection by lote`
  - `fix(maquinaria): prevent negative horímetro values`
  - Scope is usually the domain/route name.
- **PRs:** title in English, description may include Spanish if it helps explain user-facing behavior.

---

## 9. When in doubt

1. Check this document.
2. Check the [glossary](#7-domain-glossary).
3. Check existing code in the same domain.
4. Pick the option that a future non-Spanish-speaking contributor could understand with the glossary alone.

---

## 10. Industry references

These conventions follow widely-adopted standards. Useful reading:

- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript) — naming, structure
- [Conventional Commits](https://www.conventionalcommits.org/) — commit messages
- [12factor.net](https://12factor.net/) — config, secrets, environments
- [Google Engineering Practices](https://google.github.io/eng-practices/) — code review
- [React docs: Thinking in React](https://react.dev/learn/thinking-in-react) — component structure
