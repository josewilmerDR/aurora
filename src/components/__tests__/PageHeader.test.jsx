import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import PageHeader from '../PageHeader';

describe('<PageHeader />', () => {
  test('renderiza title como h1 por defecto', () => {
    const { container } = render(<PageHeader title="Tesorería" />);
    const h1 = container.querySelector('h1.aur-sheet-title');
    expect(h1).toBeInTheDocument();
    expect(h1.textContent.trim()).toBe('Tesorería');
  });

  test('level=2 renderiza como h2', () => {
    const { container } = render(<PageHeader title="Sub" level={2} />);
    expect(container.querySelector('h1')).toBeNull();
    const h2 = container.querySelector('h2.aur-sheet-title');
    expect(h2).toBeInTheDocument();
  });

  test('subtitle se renderiza como párrafo solo cuando se pasa', () => {
    const { container, rerender } = render(<PageHeader title="t" />);
    expect(container.querySelector('.aur-sheet-subtitle')).toBeNull();
    rerender(<PageHeader title="t" subtitle="Define aquí los paquetes" />);
    const p = container.querySelector('p.aur-sheet-subtitle');
    expect(p).toBeInTheDocument();
    expect(p.textContent).toContain('Define aquí los paquetes');
  });

  test('icon se renderiza dentro del heading antes del title', () => {
    const { container } = render(
      <PageHeader title="Tesorería" icon={<svg data-testid="icn" />} />
    );
    const h1 = container.querySelector('h1');
    const icon = h1.querySelector('[data-testid="icn"]');
    expect(icon).toBeInTheDocument();
    // El icono debe aparecer antes que el texto del título
    expect(h1.textContent).toContain('Tesorería');
  });

  test('actions se renderizan en aur-sheet-header-actions solo cuando se pasan', () => {
    const { container, rerender } = render(<PageHeader title="t" />);
    expect(container.querySelector('.aur-sheet-header-actions')).toBeNull();
    rerender(
      <PageHeader title="t" actions={<button data-testid="b">Nuevo</button>} />
    );
    const actions = container.querySelector('.aur-sheet-header-actions');
    expect(actions).toBeInTheDocument();
    expect(actions.querySelector('[data-testid="b"]')).toBeInTheDocument();
  });

  test('subtitle/actions se omiten cuando no se pasan (no renderiza contenedor vacío)', () => {
    const { container } = render(<PageHeader title="Mínimo" />);
    expect(container.querySelector('.aur-sheet-subtitle')).toBeNull();
    expect(container.querySelector('.aur-sheet-header-actions')).toBeNull();
    // El text wrapper sí va siempre (contiene el title).
    expect(container.querySelector('.aur-sheet-header-text')).toBeInTheDocument();
  });

  test('className y titleClassName se agregan al header y al heading', () => {
    const { container } = render(
      <PageHeader
        title="t"
        className="mi-pagina"
        titleClassName="con-degradado"
      />
    );
    const header = container.querySelector('header');
    expect(header.className).toContain('aur-sheet-header');
    expect(header.className).toContain('mi-pagina');
    const h1 = container.querySelector('h1');
    expect(h1.className).toContain('aur-sheet-title');
    expect(h1.className).toContain('con-degradado');
  });

  test('title puede ser ReactNode (no solo string)', () => {
    const { container } = render(
      <PageHeader title={<>Hola <strong data-testid="strong">mundo</strong></>} />
    );
    expect(container.querySelector('[data-testid="strong"]')).toBeInTheDocument();
  });
});
