import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UserDeleteWithEmploymentModal from '../UserDeleteWithEmploymentModal';

// El modal compone AuroraConfirmModal con un slot children. Las dos
// invariantes a defender:
//   1. En modo "rescindir contrato" el botón confirmar está bloqueado hasta
//      que el nombre tipeado coincida exactamente (case-insensitive).
//   2. En modo default (sólo revocar acceso) no hace falta tipear nada.
// Los tests no asumen estilos de AuroraConfirmModal — sólo buscan por texto
// y rol accesible para mantenerse robustos ante cambios de estructura.

const user = { id: 'u1', nombre: 'Juan Pérez', empleadoPlanilla: true, tieneAcceso: true };

function renderModal(overrides = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <UserDeleteWithEmploymentModal
      user={user}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { ...utils, onConfirm, onCancel };
}

describe('<UserDeleteWithEmploymentModal />', () => {
  test('starts in "revoke access only" mode — confirm button is enabled and labelled accordingly', () => {
    renderModal();
    const confirm = screen.getByRole('button', { name: /quitar acceso al sistema/i });
    expect(confirm).not.toBeDisabled();
  });

  test('switching to "rescindir contrato" disables confirm until the name is typed exactly', () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/rescindir también el contrato/i));
    const confirm = screen.getByRole('button', { name: /quitar acceso y rescindir contrato/i });
    expect(confirm).toBeDisabled();

    const nameInput = screen.getByLabelText(/escribe el nombre completo/i);
    fireEvent.change(nameInput, { target: { value: 'juan pérez' } });
    expect(confirm).not.toBeDisabled();
  });

  test('typed name comparison is case-insensitive and trims whitespace', () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/rescindir también el contrato/i));
    const nameInput = screen.getByLabelText(/escribe el nombre completo/i);
    fireEvent.change(nameInput, { target: { value: '  JUAN PÉREZ  ' } });
    expect(screen.getByRole('button', { name: /quitar acceso y rescindir contrato/i }))
      .not.toBeDisabled();
  });

  test('mismatched typed name keeps the confirm button disabled', () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/rescindir también el contrato/i));
    const nameInput = screen.getByLabelText(/escribe el nombre completo/i);
    fireEvent.change(nameInput, { target: { value: 'Juan' } }); // incomplete
    expect(screen.getByRole('button', { name: /quitar acceso y rescindir contrato/i }))
      .toBeDisabled();
  });

  test('clicking confirm in default mode calls onConfirm with rescindirContrato=false', () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /quitar acceso al sistema/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].rescindirContrato).toBe(false);
  });

  test('clicking confirm in rescision mode calls onConfirm with rescindirContrato=true plus motivo + fecha', () => {
    const { onConfirm } = renderModal();
    fireEvent.click(screen.getByLabelText(/rescindir también el contrato/i));
    fireEvent.change(screen.getByLabelText(/motivo \(opcional\)/i), { target: { value: 'renuncia' } });
    fireEvent.change(screen.getByLabelText(/escribe el nombre completo/i), { target: { value: 'Juan Pérez' } });
    fireEvent.click(screen.getByRole('button', { name: /quitar acceso y rescindir contrato/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.rescindirContrato).toBe(true);
    expect(arg.motivo).toBe('renuncia');
    expect(typeof arg.fechaSalida).toBe('string');
    expect(arg.fechaSalida).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('cancel button calls onCancel and does not invoke onConfirm', () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
