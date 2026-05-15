import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import WidgetSkeleton from '../WidgetSkeleton';

describe('<WidgetSkeleton />', () => {
  test('renderiza un wrapper .fin-widget-skeleton con un AuroraSkeleton text de 4 líneas', () => {
    const { container, getByRole } = render(
      <WidgetSkeleton label="Cargando saldo de caja…" />
    );
    expect(container.querySelector('.fin-widget-skeleton')).toBeInTheDocument();
    expect(container.querySelectorAll('.aur-skeleton-line')).toHaveLength(4);
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Cargando saldo de caja…');
  });

  test('expone aria-busy=true para lectores de pantalla', () => {
    const { getByRole } = render(<WidgetSkeleton />);
    expect(getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  test('label default es genérico cuando no se pasa', () => {
    const { getByRole } = render(<WidgetSkeleton />);
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Cargando contenido del widget…');
  });
});
