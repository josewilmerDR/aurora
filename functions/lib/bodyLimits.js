// Request body limits.
//
// Two parsers instead of one global 15mb limit:
//   - `jsonBody`: app-level, 1mb, mounted AFTER App Check. Skips the routes in
//     LARGE_BODY_ROUTES so their bodies are neither parsed nor rejected here.
//   - `largeJsonBody`: 15mb, mounted INSIDE the route chain of the endpoints
//     that legitimately receive base64 images — after `authenticate` (and
//     the role/rate-limit middlewares), so an anonymous or rate-limited
//     client never gets a large body parsed.
//
// Why: a single global parser before auth let anyone push 15mb per request
// and have it fully parsed before being rejected; with 512MiB per instance
// and concurrency 80 that is an OOM lever, not a billing one (maxInstances
// caps the bill) — it takes an instance down.
//
// Any new endpoint that needs large bodies must (1) be added to
// LARGE_BODY_ROUTES (Express-style path, exactly as written in router.post)
// and (2) mount `largeJsonBody` after its auth middleware.
// tests/unit/bodyLimits.test.js scans routes/ and fails if either half is
// missing.

const express = require('express');

const DEFAULT_LIMIT = '1mb';
const LARGE_LIMIT = '15mb';

// Express-style paths (":param" segments allowed) of large-body endpoints.
// Keep sorted; the guard test compares this list with the routes that mount
// largeJsonBody.
const LARGE_BODY_ROUTES = [
  '/api/bodegas/:id/movimientos',           // warehouse movement with receipt photo
  '/api/chat',                              // assistant with attached image
  '/api/compras/confirmar',                 // invoice confirm, carries the scanned image
  '/api/compras/escanear',                  // invoice scan
  '/api/config',                            // organization logo (≤2MB base64)
  '/api/horimetro/escanear',                // hour-meter scan
  '/api/ingreso/confirmar',                 // product intake confirm with invoice image
  '/api/muestreos/escanear-formulario',     // sampling form scan
  '/api/muestreos/ordenes/:id/complete',    // sampling order completion with scan image
  '/api/recepciones',                       // receipt with invoice image
  '/api/siembras/escanear',                 // planting scan
];

// ":param" → one path segment. Anchored, exact match on req.path (no query).
function toMatcher(route) {
  const re = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+');
  return new RegExp(`^${re}$`);
}

const LARGE_BODY_MATCHERS = LARGE_BODY_ROUTES.map(toMatcher);

function isLargeBodyPath(p) {
  return LARGE_BODY_MATCHERS.some((re) => re.test(p));
}

const smallJson = express.json({ limit: DEFAULT_LIMIT });
const largeJson = express.json({ limit: LARGE_LIMIT });

function jsonBody(req, res, next) {
  if (isLargeBodyPath(req.path)) return next();
  return smallJson(req, res, next);
}

function largeJsonBody(req, res, next) {
  return largeJson(req, res, next);
}

module.exports = {
  DEFAULT_LIMIT,
  LARGE_LIMIT,
  LARGE_BODY_ROUTES,
  isLargeBodyPath,
  jsonBody,
  largeJsonBody,
};
