import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import IndirectoForm from '../IndirectoForm';

const CATEGORIAS = [
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'administrativo', label: 'Administrativo' },
];

describe('<IndirectoForm />', () => {
  test('renderiza los cuatro campos inline en una sola fila, sin fieldsets', () => {
    const { container, getByLabelText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={() => {}} />
    );
    // Los 4 inputs existen y son accesibles por su label.
    expect(getByLabelText('Fecha')).toBeInTheDocument();
    expect(getByLabelText('Categoría')).toBeInTheDocument();
    expect(getByLabelText(/Descripción/)).toBeInTheDocument();
    expect(getByLabelText('Monto')).toBeInTheDocument();
    // El layout viejo de fieldsets quedó eliminado a propósito.
    expect(container.querySelectorAll('fieldset').length).toBe(0);
  });

  test('descripción está marcada como opcional en el label', () => {
    const { getByText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={() => {}} />
    );
    expect(getByText('(opcional)')).toBeInTheDocument();
  });

  test('botón Agregar arranca deshabilitado sin fecha ni monto', () => {
    const { getByRole } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={() => {}} />
    );
    expect(getByRole('button', { name: /Agregar/ })).toBeDisabled();
  });

  test('botón Agregar se habilita cuando fecha y monto están presentes', () => {
    const { getByRole, getByLabelText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={() => {}} />
    );
    fireEvent.change(getByLabelText('Fecha'), { target: { value: '2026-05-15' } });
    fireEvent.change(getByLabelText('Monto'), { target: { value: '1500' } });
    expect(getByRole('button', { name: /Agregar/ })).toBeEnabled();
  });

  test('onSubmit recibe el body con monto parseado a Number', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const { getByRole, getByLabelText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={onSubmit} />
    );
    fireEvent.change(getByLabelText('Fecha'), { target: { value: '2026-05-15' } });
    fireEvent.change(getByLabelText('Monto'), { target: { value: '1500.50' } });
    fireEvent.click(getByRole('button', { name: /Agregar/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      fecha: '2026-05-15',
      categoria: 'mantenimiento',
      descripcion: '',
      monto: 1500.5,
    });
  });

  test('limpia el form cuando onSubmit resuelve sin error', async () => {
    const onSubmit = vi.fn().mockResolvedValue();
    const { getByRole, getByLabelText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={onSubmit} />
    );
    const fecha = getByLabelText('Fecha');
    const monto = getByLabelText('Monto');
    fireEvent.change(fecha, { target: { value: '2026-05-15' } });
    fireEvent.change(monto, { target: { value: '100' } });
    fireEvent.click(getByRole('button', { name: /Agregar/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(fecha.value).toBe(''));
    expect(monto.value).toBe('');
  });

  test('preserva los datos del form cuando onSubmit lanza', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network down'));
    const { getByRole, getByLabelText } = render(
      <IndirectoForm categorias={CATEGORIAS} onSubmit={onSubmit} />
    );
    const fecha = getByLabelText('Fecha');
    const monto = getByLabelText('Monto');
    fireEvent.change(fecha, { target: { value: '2026-05-15' } });
    fireEvent.change(monto, { target: { value: '100' } });
    fireEvent.click(getByRole('button', { name: /Agregar/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // El usuario puede reintentar sin re-tipear.
    expect(fecha.value).toBe('2026-05-15');
    expect(monto.value).toBe('100');
  });
});
