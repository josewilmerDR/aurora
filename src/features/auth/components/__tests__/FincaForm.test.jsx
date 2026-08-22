import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FincaForm, { validateFincaStep } from '../FincaForm';
import { LEGAL_VERSION } from '../../../legal/lib/legal';

// The consent checkbox captures the processing mandate between the finca and
// Aurora. Protected here: no submit is emitted without it, and when checked
// the parent receives acceptsTerms + the current legal version (the backend
// persists it on the finca document).
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
  test('requires explicit acceptance of the terms', () => {
    const errs = validateFincaStep({ fincaNombre: 'X', nombreAdmin: 'Y' });
    expect(errs.acceptsTerms).toBeTruthy();
    expect(validateFincaStep({ fincaNombre: 'X', nombreAdmin: 'Y', acceptsTerms: true })).toEqual({});
  });
});

describe('<FincaForm /> consent', () => {
  test('links to terms and privacy', () => {
    renderForm();
    expect(screen.getByRole('link', { name: /Términos del servicio/ })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /Política de privacidad/ })).toHaveAttribute('href', '/privacy');
  });

  test('submit button stays disabled until the checkbox is checked', () => {
    renderForm();
    fill();
    const btn = screen.getByRole('button', { name: /Crear organización/ });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(btn).toBeEnabled();
  });

  test('without consent the submit never reaches the parent', () => {
    const onSubmit = vi.fn();
    const { container } = renderForm({ onSubmit });
    fill();
    fireEvent.submit(container.querySelector('form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Debes aceptar/)).toBeInTheDocument();
  });

  test('with consent the parent receives acceptsTerms and the legal version', () => {
    const onSubmit = vi.fn();
    const { container } = renderForm({ onSubmit });
    fill();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(container.querySelector('form'));
    expect(onSubmit).toHaveBeenCalledWith({
      fincaNombre: 'Finca Test',
      nombreAdmin: 'Ana Mora',
      acceptsTerms: true,
      legalVersion: LEGAL_VERSION,
    });
  });
});
