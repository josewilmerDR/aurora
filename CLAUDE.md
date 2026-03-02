# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

There are no unit tests configured in this project.

## Architecture Overview

**Full-stack Firebase app** — React 18 + Vite frontend with Firebase Cloud Functions (Gen 1, Express) as the backend. Firestore named database `auroradatabase`. Fixed tenant: `ID_FINCA_ACTUAL = 'finca_aurora_test'`.

### Backend: `functions/index.js`

Single-file Express app (746 LOC). All routes share one Express instance exported as a Cloud Function named `api`.

**Key patterns:**
- `enrichTask(taskDoc)` — augments scheduled task docs with lote name, hectares, responsible user name/phone, and a computed `dueDate`
- Creating a lote triggers automatic task generation from the linked package's `activities[]`, scheduling both a 3-day reminder and a due-date task per activity
- Completing a task where `activity.type === 'aplicacion'` deducts stock using `FieldValue.increment()` for each product in the recipe
- WhatsApp notifications via Twilio sent at task creation if the task is due within 3 days
- Invoice scanning (`POST /api/compras/escanear`) uses Claude claude-sonnet-4-6 vision to extract line items from an image, then fuzzy-matches against the productos catalog
- Secrets loaded with Firebase `defineSecret()`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `ANTHROPIC_API_KEY`
- Local emulator secrets go in `functions/.env.local`

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
