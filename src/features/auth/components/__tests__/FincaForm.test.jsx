import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FincaForm, { validateFincaStep } from '../FincaForm';
import { LEGAL_VERSION } from '../../../legal/lib/legal';

// El checkbox de consentimiento es la captura del contrato de encargo entre la
// finca y Aurora. Lo que se protege: que sin marcarlo no se emita el submit, y
// que al marcarlo el padre reciba aceptaTerminos + la versión legal vigente
// (el backend la persiste en el doc de la finca).
const renderForm = (props = {}) =>
  render(
    <MemoryRouter>
      <FincaForm onSubmit={vi.fn()} {...props} />
    </MemoryRouter>
  );

const fill = () => {
  fireEvent.change(screen.getByLabelText(/Nombre de tu organización/), { target: { value: 'Finca Test' } });
  fireEvent.change(screen.getByLabelText(/Tu nombre/), { target: { value: 'Ana Mora' } });
};

describe('validateFincaStep', () => {
  test('exige aceptación explícita de términos', () => {
    const errs = validateFincaStep({ fincaNombre: 'X', nombreAdmin: 'Y' });
    expect(errs.aceptaTerminos).toBeTruthy();
    expect(validateFincaStep({ fincaNombre: 'X', nombreAdmin: 'Y', aceptaTerminos: true })).toEqual({});
  });
});

describe('<FincaForm /> consentimiento', () => {
  test('enlaza a términos y privacidad', () => {
    renderForm();
    expect(screen.getByRole('link', { name: /Términos del servicio/ })).toHaveAttribute('href', '/terminos');
    expect(screen.getByRole('link', { name: /Política de privacidad/ })).toHaveAttribute('href', '/privacidad');
  });

  test('el botón queda deshabilitado hasta marcar el checkbox', () => {
    renderForm();
    fill();
    const btn = screen.getByRole('button', { name: /Crear organización/ });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).toBeEnabled();
  });

  test('sin consentimiento el submit no llega al padre', () => {
    const onSubmit = vi.fn();
    const { container } = renderForm({ onSubmit });
    fill();
    fireEvent.submit(container.querySelector('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Debes aceptar/)).toBeInTheDocument();
  });

  test('con consentimiento el padre recibe aceptaTerminos y la versión legal', () => {
    const onSubmit = vi.fn();
    const { container } = renderForm({ onSubmit });
    fill();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(container.querySelector('form'));
    expect(onSubmit).toHaveBeenCalledWith({
      fincaNombre: 'Finca Test',
      nombreAdmin: 'Ana Mora',
      aceptaTerminos: true,
      legalVersion: LEGAL_VERSION,
    });
  });
});
