# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Code standards are authoritative in [docs/code-standards.md](docs/code-standards.md).** Read it before adding new domains, validators, repositories, or tests. When the rules below and that document disagree, the standards doc wins (this file is a quick-reference snapshot).

## Development Commands

**Start local development (2 terminals required):**
```bash
# Terminal 1 – Firebase emulators (Firestore + Functions + Hosting)
firebase emulators:start --import=./.firebase/emulators-data --export-on-exit=./.firebase/emulators-data

# Terminal 2 – Vite dev server
npm run dev
```

**Build & deploy:**
```bash
npm run build && firebase deploy
```

**Emulators UI:** http://localhost:4000
**Frontend dev:** http://localhost:5173
**Functions (local):** http://127.0.0.1:5001/aurora-7dc9b/us-central1/api

**Tests:**
```bash
# Backend (Jest)
cd functions && npm test               # unit + integration (assumes emulator running)
cd functions && npm run test:emulator  # boots emulator, runs tests, tears down
cd functions && npm run test:coverage  # with coverage report

# Frontend (Vitest + React Testing Library)
npm test                # one-shot run
npm run test:watch      # watch mode
npm run test:coverage   # with coverage report
```

Test conventions and target structure: see [docs/code-standards.md §7](docs/code-standards.md).

## Architecture Overview

**Full-stack Firebase app** — React 18 + Vite frontend with Firebase Cloud Functions (Gen 2, Express) as the backend. Firestore named database `auroradatabase`.

### Backend: `functions/`

Modular Express app split into domain-specific route files. All routes share one Express instance exported as a Cloud Function named `api`.

**Target structure for new and migrated domains** ([docs/code-standards.md §1](docs/code-standards.md)):
```
functions/routes/<domain>/
  index.js          — Router; mounted by functions/index.js
  schemas.js        — Zod schemas (single source of truth for payloads)
  routes.js         — Thin handlers: parse → validate → service → respond
  service.js        — Business logic (optional; required when handlers do >1 thing)
  repository.js     — Only file in the domain that touches db.collection()
  __tests__/        — Collocated unit + integration tests
```

Reference implementation: [functions/routes/budgets/](functions/routes/budgets/). When in doubt, copy that layout.

**Structure:**
```
functions/
  index.js              — Entry point (~53 LOC): mounts routers, exports Cloud Functions
  lib/
    firebase.js         — admin.initializeApp, db, Timestamp, FieldValue, secrets, constants
    clients.js          — getTwilioClient(), getAnthropicClient() (lazy singletons)
    middleware.js        — authenticate, authenticateOnly
    helpers.js          — enrichTask, writeFeedEvent, sendPush*, sendWhatsApp*, pick, verifyOwnership, hasMinRoleBE, sendNotificationWithLink, executeAutopilotAction, validateGuardrails
  routes/               — 28 Express Router modules (one per domain)
    auth.js, feed.js, tasks.js, cedulas.js, templates.js, users.js,
    bodegas.js, productos.js, packages.js, lotes.js, grupos.js,
    compras.js, hr.js, config.js, monitoreo.js, siembra.js,
    proveedores.js, maquinaria.js, chat.js, reminders.js,
    horimetro.js, combustible.js, unidades.js, labores.js,
    webpush.js, calibraciones.js, autopilot.js, cosecha.js, costos.js
  scheduled/
    reminders-cron.js   — sendDuePushReminders (every 5 min)
```

**Patterns:**
- Each route file exports an `express.Router()` with full paths (e.g., `/api/tasks`)
- `index.js` mounts routers with `app.use(require('./routes/...'))` — no path prefixes
- Shared state via singleton modules: `lib/firebase.js` (db, secrets), `lib/clients.js` (lazy Twilio/Anthropic)
- `enrichTask(taskDoc)` — augments scheduled task docs with lote name, hectares, responsible user name/phone, and a computed `dueDate`
- Creating a lote triggers automatic task generation from the linked package's `activities[]`
- Completing a task where `activity.type === 'aplicacion'` deducts stock using `FieldValue.increment()`
- WhatsApp notifications via Twilio sent at task creation if the task is due within 3 days
- Invoice scanning (`POST /api/compras/escanear`) uses Claude vision to extract line items
- Secrets loaded with Firebase `defineSecret()`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Local emulator secrets go in `functions/.env.local`
- **Validation:** Zod schemas in `<domain>/schemas.js`. Hand-rolled `if (!req.body.x)` checks are legacy — convert to Zod when you touch the file. Pattern: [docs/code-standards.md §3](docs/code-standards.md).
- **Errors:** every error response goes through `sendApiError(res, code, devMessage, status)` from [functions/lib/errors.js](functions/lib/errors.js). Codes are English; the frontend maps them to Spanish in [src/lib/errorMessages.js](src/lib/errorMessages.js).

### Frontend: `src/`

**Routing (`src/App.jsx`):**
- `MainLayout` — Sidebar + header, wraps most pages via `<Outlet>`
- `SimpleLayout` — No sidebar, used for `/task/:taskId` (TaskAction)

**Pages (`src/pages/`):** Dashboard, TaskTracking, TaskAction, LoteManagement, PackageManagement, UserManagement, ProductManagement, InvoiceScan

**Vite proxy** rewrites `/api/*` → `http://127.0.0.1:5001/aurora-7dc9b/us-central1/api/*` so frontend fetch calls work identically in dev and production.

### Data Model

| Collection | Key fields |
|---|---|
| `lotes` | `nombreLote`, `paqueteId`, `hectareas`, `fincaId` |
| `packages` | `nombrePaquete`, `tipoCosecha`, `etapaCultivo`, `activities[]` |
| `scheduled_tasks` | `type`, `executeAt`, `status`, `loteId`, `fincaId`, `activity: {name, day, responsableId, type?, productos?[]}` |
| `usuarios` | `nombre`, `email`, `telefono`, `fincaId` |
| `productos` | `idProducto`, `nombreComercial`, `ingredienteActivo`, `tipo`, `stockActual`, `stockMinimo`, `cantidadPorHa`, `unidad`, `fincaId` |

Activity `type`: `notificacion` (default) | `aplicacion` (has `productos[]` recipe)
Task `status` lifecycle: `pending` → `completed_by_user` | `skipped`

### CSS Design System

CSS variables defined in `src/index.css`:
- `--aurora-dark-blue: #0d1a26` — main background
- `--aurora-background: #1a2a3a` — secondary background
- `--aurora-green: #33ff99` — primary accent (active nav, buttons)
- `--aurora-magenta: #cc33ff` — secondary accent
- `--aurora-light: #e6f2ff` — text color
- `--aurora-border: #2a4a6a` — border color

`LoteManagement.css` is the base stylesheet; Package and Product pages `@import` it and add overrides. Global utility classes `.info-list`, `.empty-state`, `.item-main-text` are defined in `Dashboard.css`.
