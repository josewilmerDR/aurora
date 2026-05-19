import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { ToastProvider, useToast } from '../ToastContext';
import Toast from '../../components/Toast';

// Sonda mínima que solo dispara toasts; no renderiza UI propia.
function Probe({ onReady }) {
  const toast = useToast();
  onReady(toast);
  return null;
}

const renderWithProvider = (children) => render(<ToastProvider>{children}</ToastProvider>);

describe('<ToastProvider /> + useToast()', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('toast.success encola y muestra el mensaje en el portal', () => {
    let api;
    renderWithProvider(<Probe onReady={(t) => { api = t; }} />);
    act(() => { api.success('Guardado'); });
    expect(document.body.querySelector('.aur-toast-stack')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Guardado');
    const btn = document.body.querySelector('.toast');
    expect(btn).toHaveClass('toast-success');
  });

  test('auto-dismiss tras la duración por defecto', () => {
    let api;
    renderWithProvider(<Probe onReady={(t) => { api = t; }} />);
    act(() => { api('Mensaje'); });
    expect(document.body.textContent).toContain('Mensaje');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(document.body.textContent).not.toContain('Mensaje');
  });

  test('click en el toast lo descarta y llama onClose', () => {
    let api;
    const onClose = vi.fn();
    renderWithProvider(<Probe onReady={(t) => { api = t; }} />);
    act(() => { api.error('Falló', { onClose }); });
    const btn = document.body.querySelector('.toast');
    act(() => { fireEvent.click(btn); });
    expect(document.body.querySelector('.toast')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('múltiples toasts coexisten sin pisarse', () => {
    let api;
    renderWithProvider(<Probe onReady={(t) => { api = t; }} />);
    act(() => {
      api.success('Uno');
      api.warning('Dos');
      api.error('Tres');
    });
    const toasts = document.body.querySelectorAll('.toast');
    expect(toasts).toHaveLength(3);
    expect(document.body.textContent).toContain('Uno');
    expect(document.body.textContent).toContain('Dos');
    expect(document.body.textContent).toContain('Tres');
  });

  test('límite MAX_VISIBLE descarta los más antiguos', () => {
    let api;
    renderWithProvider(<Probe onReady={(t) => { api = t; }} />);
    act(() => {
      api('a'); api('b'); api('c'); api('d'); api('e'); api('f');
    });
    const toasts = document.body.querySelectorAll('.toast');
    expect(toasts).toHaveLength(4);
    expect(document.body.textContent).not.toContain('a');
    expect(document.body.textContent).not.toContain('b');
    expect(document.body.textContent).toContain('f');
  });

  test('shim legacy <Toast> registra en el provider al montar', () => {
    const onClose = vi.fn();
    const { rerender } = renderWithProvider(
      <Toast message="Hola desde shim" type="success" onClose={onClose} />
    );
    expect(document.body.textContent).toContain('Hola desde shim');
    // Desmontar (patrón típico: setToast(null) en el padre) cierra el toast.
    rerender(<ToastProvider>{null}</ToastProvider>);
    expect(document.body.querySelector('.toast')).toBeNull();
  });

  test('shim legacy: auto-dismiss llama onClose una sola vez', () => {
    const onClose = vi.fn();
    renderWithProvider(
      <Toast message="auto" type="success" onClose={onClose} />
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('useToast() fuera del provider', () => {
  test('retorna una API noop y no lanza', () => {
    let api;
    render(<Probe onReady={(t) => { api = t; }} />);
    expect(() => api('x')).not.toThrow();
    expect(() => api.success('x')).not.toThrow();
    expect(() => api.dismiss(1)).not.toThrow();
  });
});
