import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EcosystemMenu from '../EcosystemMenu';
import {
  ECOSYSTEM_PRODUCTS,
  CURRENT_APP_ID,
  getEcosystemHref,
} from '../../lib/ecosystem';

describe('ecosystem catalog', () => {
  test('los 4 productos tienen nombre y hint no vacíos', () => {
    expect(ECOSYSTEM_PRODUCTS).toHaveLength(4);
    ECOSYSTEM_PRODUCTS.forEach((product) => {
      expect(product.name.trim()).not.toBe('');
      expect(product.hint.trim()).not.toBe('');
    });
  });

  test('el producto actual apunta a "/" sin parámetros UTM', () => {
    const current = ECOSYSTEM_PRODUCTS.find(p => p.id === CURRENT_APP_ID);
    expect(current).toBeDefined();
    expect(getEcosystemHref(current)).toBe('/');
  });

  test('los productos externos llevan las 3 claves UTM con utm_source correcto', () => {
    const externals = ECOSYSTEM_PRODUCTS.filter(p => p.id !== CURRENT_APP_ID);
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
  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Abrir el menú de productos' }));
  };

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

  test('el tile actual apunta a "/" sin UTM y se marca aria-current', () => {
    render(<EcosystemMenu />);
    openMenu();
    const current = ECOSYSTEM_PRODUCTS.find(p => p.id === CURRENT_APP_ID);
    const tile = screen.getByRole('link', { name: (name) => name.includes(current.name) });
    expect(tile).toHaveAttribute('href', '/');
    expect(tile).toHaveAttribute('aria-current', 'page');
  });

  test('los tiles externos llevan la URL canónica con UTM y no aria-current', () => {
    render(<EcosystemMenu />);
    openMenu();
    ECOSYSTEM_PRODUCTS.filter(p => p.id !== CURRENT_APP_ID).forEach((product) => {
      const tile = screen.getByRole('link', { name: (name) => name.includes(product.name) });
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
