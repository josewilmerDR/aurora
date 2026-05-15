import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import AuroraSkeleton from '../AuroraSkeleton';

describe('<AuroraSkeleton />', () => {
  test('por defecto renderiza variant card con role status y aria-busy', () => {
    const { container, getByRole } = render(<AuroraSkeleton />);
    const status = getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-label', 'Cargando contenido…');
    expect(container.querySelector('.aur-skeleton--card')).toBeInTheDocument();
  });

  test('variant widget renderiza header + value + 3 stats', () => {
    const { container } = render(<AuroraSkeleton variant="widget" />);
    expect(container.querySelector('.aur-skeleton--widget')).toBeInTheDocument();
    expect(container.querySelector('.aur-skeleton-line--header')).toBeInTheDocument();
    expect(container.querySelector('.aur-skeleton-line--value')).toBeInTheDocument();
    expect(container.querySelectorAll('.aur-skeleton-line--stat')).toHaveLength(3);
  });

  test('variant row con count=4 renderiza 4 filas', () => {
    const { container } = render(<AuroraSkeleton variant="row" count={4} />);
    expect(container.querySelectorAll('.aur-skeleton-row')).toHaveLength(4);
  });

  test('variant text con width custom aplica el ancho inline', () => {
    const { container } = render(
      <AuroraSkeleton variant="text" count={2} width="40%" />
    );
    const lines = container.querySelectorAll('.aur-skeleton-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].style.width).toBe('40%');
  });

  test('count se clamping a [1, 50] para evitar valores absurdos', () => {
    const { container: cZero } = render(<AuroraSkeleton variant="row" count={0} />);
    expect(cZero.querySelectorAll('.aur-skeleton-row')).toHaveLength(1);

    const { container: cHuge } = render(<AuroraSkeleton variant="row" count={999} />);
    expect(cHuge.querySelectorAll('.aur-skeleton-row')).toHaveLength(50);
  });

  test('label custom se refleja en aria-label', () => {
    const { getByRole } = render(
      <AuroraSkeleton variant="widget" label="Cargando saldo de caja…" />
    );
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Cargando saldo de caja…');
  });

  test('className adicional se concatena al wrapper', () => {
    const { container } = render(
      <AuroraSkeleton variant="card" className="my-extra-class" />
    );
    const root = container.querySelector('.aur-skeleton');
    expect(root).toHaveClass('aur-skeleton--card');
    expect(root).toHaveClass('my-extra-class');
  });
});
