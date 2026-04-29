// Smoke test para PerformanceAlertsCard (feature hr). Demuestra el patrón de
// mockear los hooks cross-cutting (useApiFetch + useUser) cuando el componente
// hace network. Comprueba los tres estados visibles: loading, empty, list.

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock de los hooks ANTES de importar el componente. Vitest lo eleva al top
// del módulo automáticamente, así que cualquier `import` posterior recibirá
// las versiones mockeadas.
vi.mock('../../../../../hooks/useApiFetch', () => ({
  useApiFetch: vi.fn(),
}));

vi.mock('../../../../../contexts/UserContext', async () => {
  const actual = await vi.importActual('../../../../../contexts/UserContext');
  return {
    ...actual,
    useUser: vi.fn(),
  };
});

import PerformanceAlertsCard from '../PerformanceAlertsCard';
import { useApiFetch } from '../../../../../hooks/useApiFetch';
import { useUser } from '../../../../../contexts/UserContext';

// Helper para construir un fetch que devuelve un array JSON.
function fakeApiFetchReturning(data) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe('<PerformanceAlertsCard />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('muestra estado de carga inicial', () => {
    useApiFetch.mockReturnValue(vi.fn(() => new Promise(() => {})));  // never resolves
    useUser.mockReturnValue({ currentUser: { rol: 'supervisor' } });

    render(<PerformanceAlertsCard />);
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument();
  });

  test('muestra estado vacío cuando el backend no devuelve alertas', async () => {
    useApiFetch.mockReturnValue(fakeApiFetchReturning([]));
    useUser.mockReturnValue({ currentUser: { rol: 'supervisor' } });

    render(<PerformanceAlertsCard />);
    await waitFor(() => {
      expect(screen.getByText(/Sin alertas abiertas/i)).toBeInTheDocument();
    });
  });

  test('renderiza una alerta con su severidad y título', async () => {
    const fakeFetch = fakeApiFetchReturning([
      {
        id: 'a1',
        type: 'sugerir_revision_desempeno',
        titulo: 'Revisar a Juan',
        descripcion: 'Caída en productividad las últimas 2 semanas.',
        params: { severity: 'alta' },
      },
    ]);
    useApiFetch.mockReturnValue(fakeFetch);
    useUser.mockReturnValue({ currentUser: { rol: 'supervisor' } });

    render(<PerformanceAlertsCard />);
    await waitFor(() => {
      expect(screen.getByText('Revisar a Juan')).toBeInTheDocument();
    });
    expect(screen.getByText('Caída en productividad las últimas 2 semanas.')).toBeInTheDocument();
    expect(screen.getByText('alta')).toBeInTheDocument();
  });

  test('rrhh+ pide reasoning al backend (includeReasoning=1 en la URL)', async () => {
    const fakeFetch = fakeApiFetchReturning([]);
    useApiFetch.mockReturnValue(fakeFetch);
    useUser.mockReturnValue({ currentUser: { rol: 'supervisor' } });

    render(<PerformanceAlertsCard />);
    await waitFor(() => {
      expect(fakeFetch).toHaveBeenCalled();
    });
    const url = fakeFetch.mock.calls[0][0];
    expect(url).toContain('includeReasoning=1');
  });

  test('trabajador NO pide reasoning (URL sin includeReasoning)', async () => {
    const fakeFetch = fakeApiFetchReturning([]);
    useApiFetch.mockReturnValue(fakeFetch);
    useUser.mockReturnValue({ currentUser: { rol: 'trabajador' } });

    render(<PerformanceAlertsCard />);
    await waitFor(() => {
      expect(fakeFetch).toHaveBeenCalled();
    });
    const url = fakeFetch.mock.calls[0][0];
    expect(url).not.toContain('includeReasoning');
  });
});
