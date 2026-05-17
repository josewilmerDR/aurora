import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FiUsers } from 'react-icons/fi';
import EmptyState from '../EmptyState';

describe('<EmptyState />', () => {
  test('renderiza title y default variant default con icono FiInbox', () => {
    const { container, getByText } = render(<EmptyState title="No hay datos" />);
    expect(getByText('No hay datos')).toBeInTheDocument();
    expect(container.querySelector('.aur-empty--default')).toBeInTheDocument();
    expect(container.querySelector('.aur-empty-icon')).toBeInTheDocument();
    // El icono es decorativo: aria-hidden para no contaminar lectores de pantalla.
    expect(container.querySelector('.aur-empty-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  test('variant compact aplica clase modifier', () => {
    const { container } = render(<EmptyState variant="compact" title="x" />);
    expect(container.querySelector('.aur-empty--compact')).toBeInTheDocument();
    expect(container.querySelector('.aur-empty--default')).not.toBeInTheDocument();
  });

  test('subtitle y action solo se renderizan cuando se pasan', () => {
    const { container, rerender, getByText } = render(<EmptyState title="t" />);
    expect(container.querySelector('.aur-empty-subtitle')).not.toBeInTheDocument();
    expect(container.querySelector('.aur-empty-action')).not.toBeInTheDocument();

    rerender(
      <EmptyState title="t" subtitle="s" action={<button>Crear</button>} />
    );
    expect(getByText('s')).toBeInTheDocument();
    expect(getByText('Crear')).toBeInTheDocument();
    expect(container.querySelector('.aur-empty-action')).toBeInTheDocument();
  });

  test('icon prop reemplaza el default', () => {
    const { container } = render(<EmptyState title="t" icon={FiUsers} />);
    // FiUsers se renderiza como svg dentro del wrapper de icono.
    expect(container.querySelector('.aur-empty-icon svg')).toBeInTheDocument();
  });

  test('className adicional se concatena al wrapper', () => {
    const { container } = render(<EmptyState title="t" className="my-extra" />);
    const root = container.querySelector('.aur-empty');
    expect(root).toHaveClass('aur-empty--default');
    expect(root).toHaveClass('my-extra');
  });
});
