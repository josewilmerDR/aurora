import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// Componente que tira para forzar el boundary. Necesita ser un componente
// real (no inline) para que React lo trate como un error de render normal.
function Bomb({ shouldThrow = true }) {
  if (shouldThrow) throw new Error('boom');
  return <div data-testid="ok">ok</div>;
}

describe('<ErrorBoundary />', () => {
  // El boundary llama console.error en componentDidCatch. Lo silenciamos para
  // no contaminar el output del test runner.
  let consoleSpy;
  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test('renderiza los hijos cuando no hay error', () => {
    const { getByTestId, queryByText } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(getByTestId('ok')).toBeInTheDocument();
    expect(queryByText(/algo salió mal/i)).not.toBeInTheDocument();
  });

  test('muestra fallback con CTA cuando un hijo tira', () => {
    const { getByText, container } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    expect(getByText(/algo salió mal/i)).toBeInTheDocument();
    expect(getByText(/volver al inicio/i)).toBeInTheDocument();
    expect(getByText(/recargar la página/i)).toBeInTheDocument();
    // Estructura visual mínima — wrapper + card + icono.
    expect(container.querySelector('.aur-error-boundary')).toBeInTheDocument();
    expect(container.querySelector('.aur-error-boundary-card')).toBeInTheDocument();
  });

  test('loguea el error en consola para QA/dev', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>
    );
    // console.error se llama una vez por React (boundary nativo) y una por
    // nuestro componentDidCatch. Verificamos solo que el nuestro corrió.
    const matchingCalls = consoleSpy.mock.calls.filter(
      args => typeof args[0] === 'string' && args[0].includes('[Aurora]')
    );
    expect(matchingCalls.length).toBeGreaterThan(0);
  });
});
