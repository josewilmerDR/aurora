import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useApiFetch antes de importar el componente.
const apiFetchMock = vi.fn();
vi.mock('../../../../../hooks/useApiFetch', () => ({
  useApiFetch: () => apiFetchMock,
}));

import SetupChecklist from '../SetupChecklist';

const renderInRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

// Helper: simula el shape de respuesta de cada endpoint.
function mockResponses({ proj = null, budgets = [], income = [] } = {}) {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation((url) => {
    if (url.startsWith('/api/treasury/projection')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(proj) });
    }
    if (url.startsWith('/api/budgets')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(budgets) });
    }
    if (url.startsWith('/api/income')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(income) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  apiFetchMock.mockReset();
});

describe('<SetupChecklist />', () => {
  test('cuando los 3 endpoints están vacíos, muestra el checklist con 0/3', async () => {
    mockResponses(); // todos vacíos
    renderInRouter(<SetupChecklist />);
    await waitFor(() => {
      expect(screen.getByText('Cómo empezar')).toBeInTheDocument();
    });
    expect(screen.getByText(/0\/3 pasos/)).toBeInTheDocument();
    // 3 pasos pendientes → 3 links "Ir →"
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  test('marca pasos completados con líneas tachadas y oculta su CTA', async () => {
    mockResponses({
      proj: { startingBalanceSource: { currency: 'CRC' } },
      budgets: [],
      income: [],
    });
    renderInRouter(<SetupChecklist />);
    await waitFor(() => expect(screen.getByText(/1\/3/)).toBeInTheDocument());
    // El primer paso ya no muestra CTA "Ir →"; quedan 2.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  test('cuando los 3 pasos están completos, no renderiza nada y persiste el flag', async () => {
    mockResponses({
      proj: { startingBalanceSource: { currency: 'CRC' } },
      budgets: [{ id: 'b1' }],
      income: [{ id: 'i1' }],
    });
    const { container } = renderInRouter(<SetupChecklist />);
    await waitFor(() => {
      expect(window.localStorage.getItem('aurora_finance_setup_done')).toBe('1');
    });
    // Tras setear el flag el componente se oculta — no debe quedar UI.
    expect(container.querySelector('.fin-setup-checklist')).toBeNull();
  });

  test('si el setup ya está marcado como done, no fetchea ni renderiza', () => {
    window.localStorage.setItem('aurora_finance_setup_done', '1');
    const { container } = renderInRouter(<SetupChecklist />);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('.fin-setup-checklist')).toBeNull();
  });

  test('botón cerrar persiste dismiss y oculta el checklist', async () => {
    mockResponses();
    renderInRouter(<SetupChecklist />);
    await waitFor(() => expect(screen.getByText('Cómo empezar')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Cerrar guía de inicio'));
    expect(window.localStorage.getItem('aurora_finance_checklist_dismissed')).toBe('1');
    expect(screen.queryByText('Cómo empezar')).toBeNull();
  });

  test('si el usuario ya cerró el checklist, no vuelve a fetchear', () => {
    window.localStorage.setItem('aurora_finance_checklist_dismissed', '1');
    renderInRouter(<SetupChecklist />);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
