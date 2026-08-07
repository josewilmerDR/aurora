// ─────────────────────────────────────────────────────────────────────────────
// Ecosystem launcher data — canonical comunplace product catalog.
// Mirror of comunplace's lib/ecosystem.ts; keep names/hints/URLs in sync.
// Adding a product = one entry in ECOSYSTEM_PRODUCTS (plus a URL constant).
// ─────────────────────────────────────────────────────────────────────────────

// Which product THIS app is: its tile links to "/" (own home) without UTM
// and renders the app's own brand asset.
export const CURRENT_APP_ID = 'aurora';

// One named constant per product so a future domain move is a one-line change
// (e.g. Aurora will eventually move to aurora.comunplace.com; luna kept its
// original read.comunplace.com host after the rename from "comunread").
export const DIRECTORY_URL = 'https://comunplace.com';
export const COMUNMARKET_URL = 'https://market.comunplace.com';
export const LUNA_URL = 'https://read.comunplace.com';
export const AURORA_URL = 'https://h-aurora.com';

// Tile order is intentional: comunplace, comunmarket, luna, Aurora.
// `logoSrc` (local asset) wins over `glyph` (fallback icon key + tint tone).
export const ECOSYSTEM_PRODUCTS = [
  {
    id: 'directory',
    name: 'comunplace',
    hint: 'Construye y haz crecer tu comunidad.',
    url: DIRECTORY_URL,
    logoSrc: '/comunplace-logo.png',
  },
  {
    id: 'comunmarket',
    name: 'comunmarket',
    hint: 'Compra y vende en el mercado de todos.',
    url: COMUNMARKET_URL,
    glyph: 'shopping-bag',
    tone: 'cyan',
  },
  {
    id: 'luna',
    name: 'luna',
    hint: 'Tus lecturas favoritas.',
    url: LUNA_URL,
    glyph: 'document',
    tone: 'violet',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    hint: 'Controla lo que pasa en tus cultivos.',
    url: AURORA_URL,
    logoSrc: '/aurora-logo.png',
  },
];

// The current app's tile navigates to its own home without attribution; every
// other tile carries UTM params so each product's analytics can tell which
// app the visitor jumped from.
export function getEcosystemHref(product) {
  if (product.id === CURRENT_APP_ID) return '/';
  const url = new URL(product.url);
  url.searchParams.set('utm_source', CURRENT_APP_ID);
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', 'ecosystem_menu');
  return url.toString();
}
