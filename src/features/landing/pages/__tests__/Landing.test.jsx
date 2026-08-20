import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../Landing';
import { LANDING_MODULES } from '../../lib/content';

// Smoke test de la landing publica: es la unica pagina de la app que ve alguien
// sin cuenta, asi que lo que se protege aca es que exista y que sus dos salidas
// (crear cuenta / iniciar sesion) sigan apuntando al flujo de auth.
describe('<Landing />', () => {
  const renderLanding = () =>
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );

  test('presenta el producto con un solo h1', () => {
    const { container } = renderLanding();
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toMatch(/tu finca ordenada/i);
  });

  test('ofrece crear cuenta e iniciar sesion', () => {
    const { container } = renderLanding();
    expect(container.querySelectorAll('a[href="/register"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('a[href="/login"]').length).toBeGreaterThan(0);
  });

  test('lista todos los modulos del contenido', () => {
    const { getByText } = renderLanding();
    LANDING_MODULES.forEach((mod) => {
      expect(getByText(mod.name)).toBeInTheDocument();
    });
  });

  test('fija el titulo de la pestana', () => {
    renderLanding();
    expect(document.title).toBe('Aurora — Software de gestión para fincas');
  });
});
