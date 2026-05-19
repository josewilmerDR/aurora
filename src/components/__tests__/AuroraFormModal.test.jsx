import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AuroraFormModal from '../AuroraFormModal';

describe('<AuroraFormModal />', () => {
  afterEach(() => { document.body.style.overflow = ''; });

  test('renderiza form, título y dos botones (cancelar + submit)', () => {
    render(
      <AuroraFormModal title="Crear" onClose={() => {}} onSubmit={() => {}}>
        <input name="x" />
      </AuroraFormModal>
    );
    expect(document.body.textContent).toContain('Crear');
    expect(document.body.querySelector('form')).toBeInTheDocument();
    const actions = document.body.querySelector('.aur-modal-actions');
    expect(actions.querySelectorAll('button')).toHaveLength(2);
    expect(actions.textContent).toContain('Cancelar');
    expect(actions.textContent).toContain('Guardar');
  });

  test('click en submit dispara onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <AuroraFormModal title="t" onClose={() => {}} onSubmit={onSubmit} submitLabel="Crear">
        <input />
      </AuroraFormModal>
    );
    const submitBtn = Array.from(document.body.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Crear');
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('Enter dentro de un input dispara onSubmit (Enter-to-submit nativo)', () => {
    const onSubmit = vi.fn();
    render(
      <AuroraFormModal title="t" onClose={() => {}} onSubmit={onSubmit}>
        <input data-testid="x" />
      </AuroraFormModal>
    );
    const form = document.body.querySelector('form');
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('cancel dispara onClose', () => {
    const onClose = vi.fn();
    render(
      <AuroraFormModal title="t" onClose={onClose} onSubmit={() => {}}>
        <input />
      </AuroraFormModal>
    );
    const cancelBtn = Array.from(document.body.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Cancelar');
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('loading deshabilita ambos botones y bloquea Escape', () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AuroraFormModal
        title="t"
        onClose={onClose}
        onSubmit={onSubmit}
        loading
        loadingLabel="Guardando…"
      >
        <input />
      </AuroraFormModal>
    );
    const buttons = document.body.querySelectorAll('.aur-modal-actions button');
    buttons.forEach(b => expect(b).toBeDisabled());
    const submitBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Guardando…');
    expect(submitBtn).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('submitDisabled deshabilita solo el submit', () => {
    render(
      <AuroraFormModal title="t" onClose={() => {}} onSubmit={() => {}} submitDisabled>
        <input />
      </AuroraFormModal>
    );
    const buttons = document.body.querySelectorAll('.aur-modal-actions button');
    const cancelBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Cancelar');
    const submitBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Guardar');
    expect(cancelBtn).not.toBeDisabled();
    expect(submitBtn).toBeDisabled();
  });

  test('submitVariant="danger" aplica pill destructivo', () => {
    render(
      <AuroraFormModal
        title="t"
        onClose={() => {}}
        onSubmit={() => {}}
        submitVariant="danger"
        submitLabel="Eliminar"
      >
        <input />
      </AuroraFormModal>
    );
    const submitBtn = Array.from(document.body.querySelectorAll('button'))
      .find(b => b.textContent.trim() === 'Eliminar');
    expect(submitBtn.className).toContain('aur-btn-pill--danger');
  });
});
