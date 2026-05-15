import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import DesgloseBar from '../DesgloseBar';

describe('<DesgloseBar />', () => {
  test('cuando todos los segmentos son 0 no renderiza nada', () => {
    const { container } = render(
      <DesgloseBar desglose={{ combustible: 0, planilla: 0, insumos: 0, depreciacion: 0, indirectos: 0 }} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('cuando desglose es null/undefined no renderiza nada', () => {
    const { container: c1 } = render(<DesgloseBar desglose={null} />);
    const { container: c2 } = render(<DesgloseBar desglose={undefined} />);
    expect(c1.firstChild).toBeNull();
    expect(c2.firstChild).toBeNull();
  });

  test('omite segmentos con valor 0 y renderiza los que tienen monto', () => {
    const { container } = render(
      <DesgloseBar desglose={{ combustible: 100, planilla: 0, insumos: 50, depreciacion: 0, indirectos: 0 }} />
    );
    expect(container.querySelector('.cost-bar-comb')).toBeInTheDocument();
    expect(container.querySelector('.cost-bar-plan')).toBeNull();
    expect(container.querySelector('.cost-bar-ins')).toBeInTheDocument();
    expect(container.querySelector('.cost-bar-dep')).toBeNull();
    expect(container.querySelector('.cost-bar-ind')).toBeNull();
  });

  test('los anchos suman 100% en proporción al total', () => {
    const { container } = render(
      <DesgloseBar desglose={{ combustible: 100, planilla: 100, insumos: 0, depreciacion: 0, indirectos: 0 }} />
    );
    const comb = container.querySelector('.cost-bar-comb');
    const plan = container.querySelector('.cost-bar-plan');
    // jsdom puede normalizar "50.0%" → "50%", por eso parseamos numéricamente.
    expect(parseFloat(comb.style.width)).toBe(50);
    expect(parseFloat(plan.style.width)).toBe(50);
  });
});
