import { useEffect, useState } from 'react';
import { CURRENT_APP_ID, getEcosystemArt, getEcosystemHref } from '../lib/ecosystem';
import { getInitialEcosystemProducts, loadEcosystemProducts } from '../lib/ecosystemManifest';

// Products for the ecosystem launcher, in manifest order, each decorated with
// `current` (this app), `href` (own home or UTM-tagged origin) and `art`.
// First render is synchronous (cached copy or embedded fallback) so the menu
// is never empty; the manifest refresh swaps the list in when it lands.
// Contract: docs/ecosystem-manifest.md in josewilmerDR/comunplace.
export function useEcosystemProducts() {
  const [products, setProducts] = useState(getInitialEcosystemProducts);

  useEffect(() => {
    let alive = true;
    loadEcosystemProducts().then((next) => { if (alive) setProducts(next); });
    return () => { alive = false; };
  }, []);

  return products.map((product) => ({
    ...product,
    current: product.id === CURRENT_APP_ID,
    href: getEcosystemHref(product),
    art: getEcosystemArt(product),
  }));
}
