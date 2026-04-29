// Smoke test del feature finance. BudgetProgressBar es puramente visual y
// covers todos los estados (sin presupuesto, normal, warning, over).

import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import BudgetProgressBar from '../BudgetProgressBar';

// Helper: la barra renderiza un <span class="finance-progress"> contenedor
// con un hijo .finance-progress-fill. Lo localizamos por clase para no
// depender de aria labels que aplican sólo al estado vacío.
function getBars(container) {
  const wrapper = container.querySelector('.finance-progress');
  const fill = container.querySelector('.finance-progress-fill');
  return { wrapper, fill };
}

describe('<BudgetProgressBar />', () => {
  test('cuando percent es null muestra el aria-label de "sin presupuesto"', () => {
    const { container } = render(<BudgetProgressBar percent={null} />);
    const span = container.querySelector('[aria-label="Sin presupuesto asignado"]');
    expect(span).toBeInTheDocument();
    // Sin presupuesto NO renderiza el fill interno.
    expect(container.querySelector('.finance-progress-fill')).toBeNull();
  });

  test('cuando percent es undefined también es estado vacío', () => {
    const { container } = render(<BudgetProgressBar percent={undefined} />);
    expect(container.querySelector('[aria-label="Sin presupuesto asignado"]')).toBeInTheDocument();
  });

  test('renderiza barra normal (< 80%) sin clases de warning', () => {
    const { container } = render(<BudgetProgressBar percent={50} />);
    const { fill } = getBars(container);
    expect(fill).toHaveClass('finance-progress-fill');
    expect(fill).not.toHaveClass('finance-progress-fill--warn');
    expect(fill).not.toHaveClass('finance-progress-fill--over');
    expect(fill.style.width).toBe('50%');
  });

  test('a 80% o más aplica la clase de warning', () => {
    const { container } = render(<BudgetProgressBar percent={85} />);
    const { fill } = getBars(container);
    expect(fill).toHaveClass('finance-progress-fill--warn');
    expect(fill).not.toHaveClass('finance-progress-fill--over');
  });

  test('por encima de 100% aplica clase de over y cap visual al 100%', () => {
    const { container } = render(<BudgetProgressBar percent={150} />);
    const { fill, wrapper } = getBars(container);
    expect(fill).toHaveClass('finance-progress-fill--over');
    // Visualmente está topado al 100% aunque el dato sea 150.
    expect(fill.style.width).toBe('100%');
    // El title preserva el valor real.
    expect(wrapper).toHaveAttribute('title', '150.0%');
  });

  test('valores negativos se clamping a 0%', () => {
    const { container } = render(<BudgetProgressBar percent={-10} />);
    const { fill } = getBars(container);
    expect(fill.style.width).toBe('0%');
  });
});
