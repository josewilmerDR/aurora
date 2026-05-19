import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmployeeTerminationModal from '../EmployeeTerminationModal';

// Espejo de UserDeleteWithEmploymentModal pero invertido: la rescisión es la
// acción primaria (siempre requiere typing), y la revocación de acceso es
// opcional vía checkbox sólo visible si la persona también es usuario.

function renderModal(user, overrides = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <EmployeeTerminationModal
      user={user}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />
  );
  return { ...utils, onConfirm, onCancel };
}

describe('<EmployeeTerminationModal />', () => {
  test('confirm is disabled until the full name is typed exactly', () => {
    renderModal({ id: 'e1', nombre: 'Carmen Solís', empleadoPlanilla: true });
    const confirm = screen.getByRole('button', { name: /rescindir contrato/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/escribe el nombre completo/i), {
      target: { value: 'carmen solís' },
    });
    expect(confirm).not.toBeDisabled();
  });

  test('shows the "also revoke access" checkbox only when the user has access', () => {
    const { rerender } = render(
      <EmployeeTerminationModal
        user={{ id: 'e1', nombre: 'Sin acceso', empleadoPlanilla: true, tieneAcceso: false }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByLabelText(/quitar también el acceso/i)).toBeNull();

    rerender(
      <EmployeeTerminationModal
        user={{ id: 'e2', nombre: 'Con acceso', empleadoPlanilla: true, tieneAcceso: true }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByLabelText(/quitar también el acceso/i)).toBeInTheDocument();
  });

  test('confirm payload reflects checkbox + motivo + fecha', () => {
    const user = { id: 'e1', nombre: 'Diego Pérez', empleadoPlanilla: true, tieneAcceso: true };
    const { onConfirm } = renderModal(user);

    fireEvent.change(screen.getByLabelText(/motivo \(opcional\)/i), {
      target: { value: 'fin de contrato' },
    });
    fireEvent.click(screen.getByLabelText(/quitar también el acceso/i));
    fireEvent.change(screen.getByLabelText(/escribe el nombre completo/i), {
      target: { value: 'Diego Pérez' },
    });
    fireEvent.click(screen.getByRole('button', { name: /rescindir contrato y quitar acceso/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0][0];
    expect(arg.motivo).toBe('fin de contrato');
    expect(arg.tambienQuitarAcceso).toBe(true);
    expect(arg.fechaSalida).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('button label switches when the "also revoke access" checkbox is on', () => {
    const user = { id: 'e1', nombre: 'Ana', empleadoPlanilla: true, tieneAcceso: true };
    renderModal(user);
    expect(screen.getByRole('button', { name: /rescindir contrato/i })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/quitar también el acceso/i));
    expect(screen.getByRole('button', { name: /rescindir contrato y quitar acceso/i })).toBeInTheDocument();
  });

  test('when user lacks access, the payload reports tambienQuitarAcceso=false even if no checkbox shown', () => {
    const user = { id: 'e1', nombre: 'María', empleadoPlanilla: true, tieneAcceso: false };
    const { onConfirm } = renderModal(user);
    fireEvent.change(screen.getByLabelText(/escribe el nombre completo/i), {
      target: { value: 'María' },
    });
    fireEvent.click(screen.getByRole('button', { name: /rescindir contrato/i }));
    expect(onConfirm.mock.calls[0][0].tambienQuitarAcceso).toBe(false);
  });
});
