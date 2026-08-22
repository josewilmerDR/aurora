import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import EcosystemMenu from '../EcosystemMenu';
import {
  FALLBACK_PRODUCTS,
  CURRENT_APP_ID,
  getEcosystemHref,
} from '../../lib/ecosystem';
import { MANIFEST_URL, resetEcosystemManifestCache } from '../../lib/ecosystemManifest';

// Manifiesto remoto con orden distinto al fallback y un producto que este
// build no conoce: prueba que el launcher refleja el JSON, no la copia local.
const REMOTE_BODY = {
  version: 1,
  products: [
    { id: 'luna',      name: 'luna',       hint: 'Lee o escucha tus libros favoritos.', url: 'https://read.comunplace.com' },
    { id: 'aurora',    name: 'aurora',     hint: 'Controla lo que pasa en tus cultivos.', url: 'https://aurora.comunplace.com' },
    { id: 'directory', name: 'comunplace', hint: 'Construye y haz crecer tu comunidad.', url: 'https://comunplace.com' },
    { id: 'nuevo',     name: 'nuevo',      hint: 'Producto de prueba.',                  url: 'https://nuevo.comunplace.com' },
  ],
};

function okResponse(body) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

// Un fetch que nunca resuelve: el manifiesto "tarda", el render no debe esperar.
function pendingFetch() {
  return new Promise(() => {});
}

describe('ecosystem catalog (fallback embebido)', () => {
  test('los 4 productos tienen nombre y hint no vacíos', () => {
    expect(FALLBACK_PRODUCTS).toHaveLength(4);
    FALLBACK_PRODUCTS.forEach((product) => {
      expect(product.name.trim()).not.toBe('');
      expect(product.hint.trim()).not.toBe('');
    });
  });

  test('el producto actual apunta a "/" sin parámetros UTM', () => {
    const current = FALLBACK_PRODUCTS.find(p => p.id === CURRENT_APP_ID);
    expect(current).toBeDefined();
    expect(getEcosystemHref(current)).toBe('/');
  });

  test('los productos externos llevan las 3 claves UTM con utm_source correcto', () => {
    const externals = FALLBACK_PRODUCTS.filter(p => p.id !== CURRENT_APP_ID);
    expect(externals.length).toBeGreaterThan(0);
    externals.forEach((product) => {
      const href = getEcosystemHref(product);
      const url = new URL(href);
      expect(href.startsWith(product.url)).toBe(true);
      expect(url.searchParams.get('utm_source')).toBe(CURRENT_APP_ID);
      expect(url.searchParams.get('utm_medium')).toBe('referral');
      expect(url.searchParams.get('utm_campaign')).toBe('ecosystem_menu');
    });
  });
});

describe('<EcosystemMenu />', () => {
  beforeEach(() => {
    resetEcosystemManifestCache();
    vi.stubGlobal('fetch', vi.fn(pendingFetch));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetEcosystemManifestCache();
  });

  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Abrir el menú de productos' }));
  };
  const tileNames = (panel) =>
    Array.from(panel.querySelectorAll('.aur-ecosystem-tile-name')).map(el => el.textContent);

  test('el botón abre el panel con los 4 tiles y atributos de disclosure', () => {
    render(<EcosystemMenu />);
    const button = screen.getByRole('button', { name: 'Abrir el menú de productos' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
    expect(button).toHaveAttribute('aria-controls', 'ecosystem-menu-panel');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-label', 'Cerrar el menú de productos');

    const panel = screen.getByRole('navigation', { name: 'Productos de la plataforma' });
    expect(panel).toHaveAttribute('id', 'ecosystem-menu-panel');
    expect(panel.querySelectorAll('a.aur-ecosystem-tile')).toHaveLength(4);
  });

  test('mientras el manifiesto no responde, renderiza el fallback embebido (nunca vacío)', () => {
    render(<EcosystemMenu />);
    openMenu();
    const panel = screen.getByRole('navigation');
    expect(tileNames(panel)).toEqual(FALLBACK_PRODUCTS.map(p => p.name));
    expect(fetch).toHaveBeenCalledWith(MANIFEST_URL, expect.any(Object));
  });

  test('con el fetch fallido renderiza el fallback sin error visible', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<EcosystemMenu />);
    // Dejamos resolver la promesa rechazada dentro del ciclo de React.
    await act(async () => {});
    openMenu();
    const panel = screen.getByRole('navigation');
    expect(tileNames(panel)).toEqual(FALLBACK_PRODUCTS.map(p => p.name));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('renderiza los productos del manifiesto en su orden, incluido un id desconocido con arte genérico', async () => {
    fetch.mockResolvedValue(okResponse(REMOTE_BODY));
    render(<EcosystemMenu />);
    openMenu();
    const panel = screen.getByRole('navigation');
    await waitFor(() => {
      expect(tileNames(panel)).toEqual(['luna', 'aurora', 'comunplace', 'nuevo']);
    });

    const nuevo = screen.getByRole('link', { name: (name) => name.includes('Producto de prueba.') });
    expect(nuevo).toHaveAttribute('href', getEcosystemHref(REMOTE_BODY.products[3]));
    expect(nuevo.querySelector('.aur-ecosystem-tile-art--neutral')).not.toBeNull();
    expect(nuevo.querySelector('img')).toBeNull();
  });

  test('el tile actual apunta a "/" sin UTM y se marca aria-current', () => {
    render(<EcosystemMenu />);
    openMenu();
    const current = FALLBACK_PRODUCTS.find(p => p.id === CURRENT_APP_ID);
    const tile = screen.getByRole('link', { name: (name) => name.includes(current.hint) });
    expect(tile).toHaveAttribute('href', '/');
    expect(tile).toHaveAttribute('aria-current', 'page');
  });

  test('los tiles externos llevan la URL canónica con UTM y no aria-current', () => {
    render(<EcosystemMenu />);
    openMenu();
    FALLBACK_PRODUCTS.filter(p => p.id !== CURRENT_APP_ID).forEach((product) => {
      const tile = screen.getByRole('link', { name: (name) => name.includes(product.hint) });
      expect(tile).toHaveAttribute('href', getEcosystemHref(product));
      expect(tile).not.toHaveAttribute('aria-current');
    });
  });

  test('se cierra al tocar un enlace, con Escape y con clic fuera', () => {
    render(<EcosystemMenu />);

    openMenu();
    fireEvent.click(screen.getAllByRole('link')[0]);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
