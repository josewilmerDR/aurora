import { describe, test, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import CostTable from '../CostTable';

const SAMPLE_ROWS = [
  {
    displayName: 'Lote A',
    desglose: { combustible: 100, planilla: 200, insumos: 50, depreciacion: 30, indirectos: 20 },
    costoTotal: 400,
    kg: 1000,
    costoPorKg: 0.4,
  },
  {
    displayName: 'Lote B',
    desglose: { combustible: 0, planilla: 100, insumos: 0, depreciacion: 0, indirectos: 0 },
    costoTotal: 100,
    kg: 500,
    costoPorKg: 0.2,
  },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe('<CostTable />', () => {
  test('sin filas muestra el mensaje empty con sugerencia accionable', () => {
    const { getByText } = render(<CostTable rows={[]} nameLabel="Lote" />);
    expect(getByText(/Sin datos/)).toBeInTheDocument();
    expect(getByText(/ampliar las fechas/)).toBeInTheDocument();
  });

  test('emptyMessage custom reemplaza el default', () => {
    const { getByText, queryByText } = render(
      <CostTable rows={[]} nameLabel="Lote" emptyMessage="Vacío." />
    );
    expect(getByText('Vacío.')).toBeInTheDocument();
    expect(queryByText(/ampliar las fechas/)).toBeNull();
  });

  test('por defecto arranca en vista compacta (5 columnas)', () => {
    const { container } = render(<CostTable rows={SAMPLE_ROWS} nameLabel="Lote" />);
    const headers = container.querySelectorAll('thead th');
    expect(headers).toHaveLength(5);
    const labels = Array.from(headers).map((h) => h.textContent);
    expect(labels).toEqual(['Lote', 'Total', 'Kg', 'Costo/Kg', 'Composición']);
  });

  test('toggle del botón cambia a vista completa (10 columnas)', () => {
    const { container, getByRole } = render(
      <CostTable rows={SAMPLE_ROWS} nameLabel="Lote" />
    );
    const btn = getByRole('button', { name: /Mostrar todas/ });
    fireEvent.click(btn);
    const headers = container.querySelectorAll('thead th');
    expect(headers).toHaveLength(10);
  });

  test('showColumnToggle={false} oculta el botón de columnas', () => {
    const { queryByRole } = render(
      <CostTable rows={SAMPLE_ROWS} nameLabel="Lote" showColumnToggle={false} />
    );
    expect(queryByRole('button', { name: /Mostrar todas/ })).toBeNull();
    expect(queryByRole('button', { name: /Vista compacta/ })).toBeNull();
  });

  test('renderiza una fila por entrada con nombre', () => {
    const { getByText } = render(<CostTable rows={SAMPLE_ROWS} nameLabel="Lote" />);
    expect(getByText('Lote A')).toBeInTheDocument();
    expect(getByText('Lote B')).toBeInTheDocument();
  });

  test('preferencia de columnas persiste entre renders', () => {
    const { getByRole, unmount } = render(
      <CostTable rows={SAMPLE_ROWS} nameLabel="Lote" />
    );
    fireEvent.click(getByRole('button', { name: /Mostrar todas/ }));
    unmount();

    const { container } = render(<CostTable rows={SAMPLE_ROWS} nameLabel="Lote" />);
    const headers = container.querySelectorAll('thead th');
    expect(headers).toHaveLength(10);
  });
});
