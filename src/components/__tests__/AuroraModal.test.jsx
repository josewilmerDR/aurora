import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import AuroraModal from '../AuroraModal';

describe('<AuroraModal />', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  test('renderiza children, título y portea a body', () => {
    render(
      <AuroraModal title="Hola" onClose={() => {}}>
        <p>Contenido</p>
      </AuroraModal>
    );
    expect(document.body.textContent).toContain('Hola');
    expect(document.body.textContent).toContain('Contenido');
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  test('click puro en backdrop cierra', () => {
    const onClose = vi.fn();
    render(
      <AuroraModal title="t" onClose={onClose}><p>x</p></AuroraModal>
    );
    const backdrop = document.body.querySelector('.aur-modal-backdrop');
    fireEvent.mouseDown(backdrop, { target: backdrop });
    fireEvent.click(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('drag de texto desde dentro hacia backdrop NO cierra', () => {
    const onClose = vi.fn();
    render(
      <AuroraModal title="t" onClose={onClose}><p>texto largo</p></AuroraModal>
    );
    const backdrop = document.body.querySelector('.aur-modal-backdrop');
    const dialog = document.body.querySelector('[role="dialog"]');
    // El usuario hace mousedown dentro del modal (seleccionar texto)…
    fireEvent.mouseDown(backdrop, { target: dialog });
    // …suelta fuera, el click bubble llega al backdrop.
    fireEvent.click(backdrop, { target: backdrop });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('click en el modal interior NO cierra', () => {
    const onClose = vi.fn();
    render(
      <AuroraModal title="t" onClose={onClose}><button>btn</button></AuroraModal>
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Escape cierra; preventClose lo bloquea', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <AuroraModal title="t" onClose={onClose}><p>x</p></AuroraModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <AuroraModal title="t" onClose={onClose} preventClose><p>x</p></AuroraModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('closeOnEscape=false ignora Escape', () => {
    const onClose = vi.fn();
    render(
      <AuroraModal title="t" onClose={onClose} closeOnEscape={false}>
        <p>x</p>
      </AuroraModal>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('showCloseButton=true renderiza el botón X que cierra', () => {
    const onClose = vi.fn();
    render(<AuroraModal title="t" onClose={onClose}><p>x</p></AuroraModal>);
    const closeBtn = document.body.querySelector('.aur-modal-close');
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('showCloseButton=false oculta el X', () => {
    render(
      <AuroraModal title="t" onClose={() => {}} showCloseButton={false}>
        <p>x</p>
      </AuroraModal>
    );
    expect(document.body.querySelector('.aur-modal-close')).toBeNull();
  });

  test('focus inicial recae sobre el primer focusable (sin botón X)', async () => {
    render(
      <AuroraModal title="t" onClose={() => {}} showCloseButton={false}>
        <input data-testid="first" />
        <input data-testid="second" />
      </AuroraModal>
    );
    // Esperar el requestAnimationFrame del effect de focus.
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    expect(document.activeElement).toBe(document.querySelector('[data-testid="first"]'));
  });

  test('con botón X, el primer focusable es el X', async () => {
    render(
      <AuroraModal title="t" onClose={() => {}}>
        <input data-testid="first" />
      </AuroraModal>
    );
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    expect(document.activeElement).toBe(document.body.querySelector('.aur-modal-close'));
  });

  test('initialFocusRef enfoca el ref pasado', async () => {
    function Wrapper() {
      const ref = useRef(null);
      return (
        <AuroraModal title="t" onClose={() => {}} initialFocusRef={ref}>
          <input />
          <button ref={ref} data-testid="target">objetivo</button>
        </AuroraModal>
      );
    }
    render(<Wrapper />);
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    expect(document.activeElement).toBe(document.querySelector('[data-testid="target"]'));
  });

  test('Tab en el último elemento vuelve al primero (focus trap)', async () => {
    render(
      <AuroraModal title="t" onClose={() => {}} showCloseButton={false}>
        <input data-testid="a" />
        <input data-testid="b" />
        <input data-testid="c" />
      </AuroraModal>
    );
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    const a = document.querySelector('[data-testid="a"]');
    const c = document.querySelector('[data-testid="c"]');
    c.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(a);
  });

  test('Shift+Tab en el primer elemento salta al último', async () => {
    render(
      <AuroraModal title="t" onClose={() => {}} showCloseButton={false}>
        <input data-testid="a" />
        <input data-testid="b" />
      </AuroraModal>
    );
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    const a = document.querySelector('[data-testid="a"]');
    const b = document.querySelector('[data-testid="b"]');
    a.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  test('focus se restaura al elemento previo al desmontar', async () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>abrir</button>
          {open && (
            <AuroraModal title="t" onClose={() => setOpen(false)} showCloseButton={false}>
              <input data-testid="inside" />
            </AuroraModal>
          )}
        </>
      );
    }
    const { getByTestId } = render(<Wrapper />);
    const trigger = getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    await act(async () => { await new Promise(r => requestAnimationFrame(r)); });
    expect(document.activeElement).toBe(document.querySelector('[data-testid="inside"]'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  test('aplica clase de size y className extra', () => {
    render(
      <AuroraModal title="t" onClose={() => {}} size="xl" className="mi-modal">
        <p>x</p>
      </AuroraModal>
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog.className).toContain('aur-modal');
    expect(dialog.className).toContain('aur-modal--xl');
    expect(dialog.className).toContain('mi-modal');
  });

  test('scrollable envuelve children en aur-modal-content', () => {
    render(
      <AuroraModal title="t" onClose={() => {}} scrollable>
        <p data-testid="c">x</p>
      </AuroraModal>
    );
    const content = document.body.querySelector('.aur-modal-content');
    expect(content).toBeInTheDocument();
    expect(content.contains(document.querySelector('[data-testid="c"]'))).toBe(true);
  });

  test('footer prop renderiza aur-modal-actions', () => {
    render(
      <AuroraModal
        title="t"
        onClose={() => {}}
        footer={<button data-testid="ok">OK</button>}
      >
        <p>x</p>
      </AuroraModal>
    );
    const actions = document.body.querySelector('.aur-modal-actions');
    expect(actions).toBeInTheDocument();
    expect(actions.querySelector('[data-testid="ok"]')).toBeInTheDocument();
  });

  test('lockea body scroll mientras vive y lo restaura al desmontar', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(
      <AuroraModal title="t" onClose={() => {}}><p>x</p></AuroraModal>
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
  });
});
