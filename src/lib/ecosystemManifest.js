// ─────────────────────────────────────────────────────────────────────────────
// Ecosystem manifest consumer — fetch + cache + validation.
//
// Contract: docs/ecosystem-manifest.md in josewilmerDR/comunplace (PR #587).
// The manifest is a plain public JSON with open CORS, read from the browser
// (no server hop: Aurora's backend would only add a function invocation in
// front of a 300-byte GET). This is navigation data, not API data, so it does
// NOT go through useApiFetch — no auth, App Check or tenant header applies.
//
// Guarantees for callers:
//   - getInitialEcosystemProducts() is synchronous and never empty: last
//     known-good copy (localStorage) or the embedded fallback.
//   - loadEcosystemProducts() never rejects. Network down, timeout, CORS,
//     malformed body or unknown schema version ⇒ stale copy or fallback.
//   - Network is hit at most once per FRESH_MS across the whole tab (in-memory
//     memo + in-flight dedupe), and localStorage makes that span tabs/reloads.
//     Upstream also sends Cache-Control max-age=300, so the browser cache
//     absorbs anything in between.
// ─────────────────────────────────────────────────────────────────────────────

import { FALLBACK_PRODUCTS } from './ecosystem';

export const MANIFEST_URL = 'https://comunplace.com/.well-known/ecosystem.json';
// Bump only when the upstream contract bumps `version` (incompatible schema).
// An unknown version is treated as unreadable → fallback, never a crash.
export const MANIFEST_VERSION = 1;

const STORAGE_KEY = 'aurora_ecosystem_manifest_v1';
// Inside the contract's 5–60 min window. Short enough that a renamed hint or a
// new product shows up within a coffee break; long enough to be free.
export const FRESH_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

let memo = null;     // { products, fetchedAt } — per-tab cache
let inflight = null; // Promise<products[]> — dedupes concurrent mounts

// ── Validation ──────────────────────────────────────────────────────────────

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Returns the clean product list or null when the body is unusable. Entries
// are validated one by one: a single bad row (e.g. a non-https url, which we
// refuse so a compromised manifest can't inject javascript: links) is dropped
// without discarding the rest. Order is preserved — it is the display order.
export function normalizeManifest(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.version !== MANIFEST_VERSION) return null;
  if (!Array.isArray(body.products)) return null;

  const seen = new Set();
  const products = [];
  for (const raw of body.products) {
    if (!raw || typeof raw !== 'object') continue;
    if (!nonEmptyString(raw.id) || !nonEmptyString(raw.name) || !isHttpsUrl(raw.url)) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    products.push({
      id: raw.id,
      name: raw.name.trim(),
      hint: typeof raw.hint === 'string' ? raw.hint.trim() : '',
      url: raw.url,
    });
  }
  return products.length > 0 ? products : null;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function readStorage() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.fetchedAt !== 'number' || !Array.isArray(entry.products)) return null;
    // Re-validate: a stale/tampered entry must not bypass the schema check.
    const products = normalizeManifest({ version: MANIFEST_VERSION, products: entry.products });
    return products ? { products, fetchedAt: entry.fetchedAt } : null;
  } catch {
    return null;
  }
}

function writeStorage(entry) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Quota / private mode: the in-memory memo still covers this tab.
  }
}

function readCache() {
  if (!memo) memo = readStorage();
  return memo;
}

// ── Fetch ───────────────────────────────────────────────────────────────────

async function fetchManifest() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(MANIFEST_URL, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const products = normalizeManifest(await res.json());
    if (!products) throw new Error('manifest unusable');
    return products;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

// Synchronous: what to render on the very first paint.
export function getInitialEcosystemProducts() {
  return readCache()?.products || FALLBACK_PRODUCTS;
}

// Resolves to the freshest list we can get without ever throwing.
export function loadEcosystemProducts({ now = Date.now() } = {}) {
  const cached = readCache();
  if (cached && now - cached.fetchedAt < FRESH_MS) return Promise.resolve(cached.products);
  if (inflight) return inflight;

  inflight = fetchManifest()
    .then((products) => {
      memo = { products, fetchedAt: now };
      writeStorage(memo);
      return products;
    })
    .catch(() => cached?.products || FALLBACK_PRODUCTS)
    .finally(() => { inflight = null; });
  return inflight;
}

// Test-only: wipe memo, in-flight promise and persisted copy.
export function resetEcosystemManifestCache() {
  memo = null;
  inflight = null;
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
