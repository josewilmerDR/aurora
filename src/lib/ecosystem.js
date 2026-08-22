// ─────────────────────────────────────────────────────────────────────────────
// Ecosystem launcher data — comunplace product catalog.
//
// The catalog's single source of truth is the manifest comunplace publishes at
// https://comunplace.com/.well-known/ecosystem.json (contract:
// docs/ecosystem-manifest.md in josewilmerDR/comunplace, PR #587). Aurora reads
// it through loadEcosystemProducts() in ./ecosystemManifest.js; the list below
// is ONLY the embedded last-resort fallback rendered while the manifest has
// not loaded yet or when the fetch fails — it must never be the primary source
// again. Keep it a mirror of the manifest so an offline launcher looks the
// same as an online one; do not add products here without adding them to the
// manifest first.
// ─────────────────────────────────────────────────────────────────────────────

// Which product THIS app is (manifest `id`): its tile links to "/" (own home)
// without UTM and renders as "you are here".
export const CURRENT_APP_ID = 'aurora';

// Named origins for the few places that link to a sibling product outside the
// launcher (landing footer, legal identity). The launcher itself takes URLs
// from the manifest, so a domain move only needs to touch these for those
// static uses.
export const DIRECTORY_URL = 'https://comunplace.com';
export const COMUNMARKET_URL = 'https://market.comunplace.com';
export const LUNA_URL = 'https://read.comunplace.com';
export const AURORA_URL = 'https://aurora.comunplace.com';

// Embedded fallback (see header). Same shape and order as the manifest
// `products[]`; lowercase names are intentional across the ecosystem.
export const FALLBACK_PRODUCTS = [
  { id: 'directory',   name: 'comunplace', hint: 'Construye y haz crecer tu comunidad.',   url: DIRECTORY_URL },
  { id: 'comunmarket', name: 'market',     hint: 'Compra y vende lo que quieras, gratis.', url: COMUNMARKET_URL },
  { id: 'luna',        name: 'luna',       hint: 'Lee o escucha tus libros favoritos.',    url: LUNA_URL },
  { id: 'aurora',      name: 'aurora',     hint: 'Controla lo que pasa en tus cultivos.',  url: AURORA_URL },
];

// Per-product art lives locally (the manifest carries no assets). Keyed by
// manifest id; `logoSrc` (local asset) wins over `glyph` (icon key + tint
// tone). Any id not listed here — e.g. a product added to the manifest after
// this build shipped — renders with GENERIC_ART, so new products appear in the
// launcher without a code change.
export const ECOSYSTEM_ART = {
  directory:   { logoSrc: '/comunplace-logo.png' },
  comunmarket: { glyph: 'shopping-bag', tone: 'cyan' },
  luna:        { glyph: 'document', tone: 'violet' },
  aurora:      { logoSrc: '/aurora-logo.png' },
};
export const GENERIC_ART = { glyph: 'grid', tone: 'neutral' };

export function getEcosystemArt(product) {
  return ECOSYSTEM_ART[product.id] || GENERIC_ART;
}

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
