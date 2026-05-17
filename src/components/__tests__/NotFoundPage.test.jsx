import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFoundPage from '../NotFoundPage';

// Mock navigate para verificar que el CTA dispara la navegación a "/".
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('<NotFoundPage />', () => {
  test('renderiza el EmptyState con título, subtítulo y CTA', () => {
    const { getByText } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    expect(getByText(/no encontramos esa página/i)).toBeInTheDocument();
    expect(getByText(/vuelve al inicio para seguir trabajando/i)).toBeInTheDocument();
    expect(getByText(/volver al inicio/i)).toBeInTheDocument();
  });

  test('el CTA navega al home', () => {
    navigateMock.mockReset();
    const { getByText } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    );
    fireEvent.click(getByText(/volver al inicio/i));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
