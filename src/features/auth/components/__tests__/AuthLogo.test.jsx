// Smoke test del componente más simple del feature auth. Verifica que el
// pipeline de RTL + jsdom funciona en el contexto del feature.

import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthLogo from '../AuthLogo';

describe('<AuthLogo />', () => {
  test('renderiza el logo con alt accesible', () => {
    render(<AuthLogo />);
    const img = screen.getByAltText('Aurora');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/aurora-logo.png');
  });

  test('muestra la etiqueta "Aurora"', () => {
    render(<AuthLogo />);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
  });
});
