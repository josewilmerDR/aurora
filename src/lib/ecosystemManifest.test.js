import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FALLBACK_PRODUCTS, CURRENT_APP_ID, getEcosystemHref, getEcosystemArt, GENERIC_ART } from './ecosystem';
import {
  MANIFEST_URL,
  FRESH_MS,
  normalizeManifest,
  getInitialEcosystemProducts,
  loadEcosystemProducts,
  resetEcosystemManifestCache,
} from './ecosystemManifest';

// Cuerpo tal como lo publica comunplace, más un producto que Aurora no conoce
// (simula "producto nuevo agregado solo al JSON").
const REMOTE_BODY = {
  version: 1,
  products: [
    { id: 'luna',      name: 'luna',      hint: 'Lee o escucha tus libros favoritos.', url: 'https://read.comunplace.com' },
    { id: 'directory', name: 'comunplace', hint: 'Construye y haz crecer tu comunidad.', url: 'https://comunplace.com' },
    { id: 'aurora',    name: 'aurora',    hint: 'Controla lo que pasa en tus cultivos.', url: 'https://aurora.comunplace.com' },
    { id: 'nuevo',     name: 'nuevo',     hint: 'Producto de prueba.',                  url: 'https://nuevo.comunplace.com' },
  ],
};

function okResponse(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe('normalizeManifest', () => {
  test('acepta el shape del contrato y conserva el orden', () => {
    const products = normalizeManifest(REMOTE_BODY);
    expect(products.map(p => p.id)).toEqual(['luna', 'directory', 'aurora', 'nuevo']);
    expect(products[0]).toEqual(REMOTE_BODY.products[0]);
  });

  test('rechaza versión desconocida, cuerpo no-objeto o products no-array', () => {
    expect(normalizeManifest({ version: 2, products: REMOTE_BODY.products })).toBeNull();
    expect(normalizeManifest(null)).toBeNull();
    expect(normalizeManifest('x')).toBeNull();
    expect(normalizeManifest({ version: 1, products: {} })).toBeNull();
  });

  test('descarta filas inválidas sin tirar el resto; sin filas válidas devuelve null', () => {
    const products = normalizeManifest({
      version: 1,
      products: [
        { id: 'ok', name: 'ok', url: 'https://ok.example' },
        { id: 'js', name: 'js', url: 'javascript:alert(1)' },   // protocolo no https
        { id: 'http', name: 'http', url: 'http://plain.example' },
        { id: '', name: 'sin-id', url: 'https://x.example' },
        { id: 'ok', name: 'duplicado', url: 'https://dup.example' },
        { id: 'sin-hint', name: 'sin hint', url: 'https://y.example' },
        null,
      ],
    });
    expect(products.map(p => p.id)).toEqual(['ok', 'sin-hint']);
    expect(products[1].hint).toBe('');
    expect(normalizeManifest({ version: 1, products: [{ id: 'js', name: 'js', url: 'javascript:1' }] })).toBeNull();
  });
});

describe('loadEcosystemProducts', () => {
  beforeEach(() => {
    resetEcosystemManifestCache();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetEcosystemManifestCache();
  });

  test('sin caché el render inicial es el fallback embebido', () => {
    expect(getInitialEcosystemProducts()).toBe(FALLBACK_PRODUCTS);
    expect(FALLBACK_PRODUCTS.find(p => p.id === CURRENT_APP_ID)).toBeDefined();
  });

  test('con red OK devuelve los productos del manifiesto en su orden y los persiste', async () => {
    fetch.mockResolvedValue(okResponse(REMOTE_BODY));
    const products = await loadEcosystemProducts({ now: 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(MANIFEST_URL);
    expect(products.map(p => p.id)).toEqual(['luna', 'directory', 'aurora', 'nuevo']);

    // Segunda lectura dentro de la ventana: sin red.
    await loadEcosystemProducts({ now: 1000 + FRESH_MS - 1 });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Nuevo tab (memo vacío): localStorage sirve el render inicial.
    resetMemoOnly();
    expect(getInitialEcosystemProducts().map(p => p.id)).toEqual(['luna', 'directory', 'aurora', 'nuevo']);
  });

  test('vencida la ventana vuelve a pedir el manifiesto', async () => {
    fetch.mockResolvedValue(okResponse(REMOTE_BODY));
    await loadEcosystemProducts({ now: 1000 });
    await loadEcosystemProducts({ now: 1000 + FRESH_MS });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('fetch rechazado ⇒ fallback, sin lanzar', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadEcosystemProducts()).resolves.toBe(FALLBACK_PRODUCTS);
  });

  test('HTTP no-OK, JSON roto o versión desconocida ⇒ fallback', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await expect(loadEcosystemProducts({ now: 1 })).resolves.toBe(FALLBACK_PRODUCTS);

    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad json')) });
    await expect(loadEcosystemProducts({ now: 2 })).resolves.toBe(FALLBACK_PRODUCTS);

    fetch.mockResolvedValueOnce(okResponse({ version: 99, products: REMOTE_BODY.products }));
    await expect(loadEcosystemProducts({ now: 3 })).resolves.toBe(FALLBACK_PRODUCTS);
  });

  test('si la red cae después de un éxito, sirve la última copia buena (stale) y no el fallback', async () => {
    fetch.mockResolvedValueOnce(okResponse(REMOTE_BODY));
    await loadEcosystemProducts({ now: 1000 });

    fetch.mockRejectedValueOnce(new TypeError('offline'));
    const stale = await loadEcosystemProducts({ now: 1000 + FRESH_MS + 1 });
    expect(stale.map(p => p.id)).toEqual(['luna', 'directory', 'aurora', 'nuevo']);
  });

  test('llamadas concurrentes comparten un único fetch', async () => {
    fetch.mockResolvedValue(okResponse(REMOTE_BODY));
    const [a, b] = await Promise.all([loadEcosystemProducts(), loadEcosystemProducts()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test('un id desconocido recibe arte genérico y href con UTM', () => {
    const nuevo = REMOTE_BODY.products[3];
    expect(getEcosystemArt(nuevo)).toBe(GENERIC_ART);
    const url = new URL(getEcosystemHref(nuevo));
    expect(url.origin).toBe('https://nuevo.comunplace.com');
    expect(url.searchParams.get('utm_source')).toBe('aurora');
  });
});

// Simula un tab nuevo: vacía el memo de módulo pero deja localStorage intacto.
// resetEcosystemManifestCache() borra ambos, así que guardamos y restauramos.
function resetMemoOnly() {
  const saved = localStorage.getItem('aurora_ecosystem_manifest_v1');
  resetEcosystemManifestCache();
  if (saved) localStorage.setItem('aurora_ecosystem_manifest_v1', saved);
}
