import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../components/Toast.css';

// Toast global. Una única pila vive en el provider y se renderiza vía
// portal a document.body, así sobrevive a navegaciones entre rutas. Los
// disparos ocurren con `useToast()` o, por compatibilidad, montando el
// <Toast> legacy (que actúa como shim sobre esta misma cola).

const ToastContext = createContext(null);
const DEFAULT_DURATION = 3000;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());
  const callbacksRef = useRef(new Map()); // id -> onClose; ref keeps callbacks out of state updaters

  const dismiss = useCallback((id) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
    const cb = callbacksRef.current.get(id);
    callbacksRef.current.delete(id);
    setItems(prev => prev.filter(x => x.id !== id));
    if (cb) { try { cb(); } catch { /* aislar callbacks del usuario */ } }
  }, []);

  const push = useCallback((message, opts = {}) => {
    const id = ++idRef.current;
    const duration = opts.duration ?? DEFAULT_DURATION;
    const type = opts.type || 'success';
    if (opts.onClose) callbacksRef.current.set(id, opts.onClose);
    setItems(prev => {
      const next = [...prev, { id, message, type }];
      while (next.length > MAX_VISIBLE) {
        const dropped = next.shift();
        callbacksRef.current.delete(dropped.id);
        const dt = timersRef.current.get(dropped.id);
        if (dt) { clearTimeout(dt); timersRef.current.delete(dropped.id); }
      }
      return next;
    });
    if (duration > 0) {
      timersRef.current.set(id, setTimeout(() => dismiss(id), duration));
    }
    return id;
  }, [dismiss]);

  const api = useMemo(() => {
    const fn = (message, opts) => push(message, opts);
    fn.success = (message, opts) => push(message, { ...opts, type: 'success' });
    fn.error   = (message, opts) => push(message, { ...opts, type: 'error' });
    fn.warning = (message, opts) => push(message, { ...opts, type: 'warning' });
    fn.info    = (message, opts) => push(message, { ...opts, type: 'info' });
    fn.dismiss = dismiss;
    return fn;
  }, [push, dismiss]);

  useEffect(() => () => {
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current.clear();
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div className="aur-toast-stack" role="region" aria-label="Notificaciones">
          {items.map(it => (
            <button
              key={it.id}
              type="button"
              className={`toast toast-${it.type}`}
              aria-live="polite"
              onClick={() => dismiss(it.id)}
            >
              {it.message}
            </button>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

let _warnedOutsideProvider = false;
const noopApi = Object.assign(() => {}, {
  success: () => {}, error: () => {}, warning: () => {}, info: () => {}, dismiss: () => {},
});

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    if (!_warnedOutsideProvider && typeof window !== 'undefined' && import.meta.env?.DEV) {
      _warnedOutsideProvider = true;
      // eslint-disable-next-line no-console
      console.warn('[useToast] llamado fuera de <ToastProvider>. Los toasts no se mostrarán.');
    }
    return noopApi;
  }
  return ctx;
}
