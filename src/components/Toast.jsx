import { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';

// Shim del Toast legacy: 55+ páginas usan `{toast && <Toast .../>}` con
// useState local. Ahora ese mount registra un elemento en la pila global
// del ToastProvider en vez de pintar inline; así dos toasts simultáneos
// no se pisan y el portal sobrevive a navegaciones. El componente no
// renderiza nada — la UI sale del provider.
function Toast({ message, type = 'success', onClose }) {
  const toast = useToast();
  const idRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (idRef.current != null) toast.dismiss(idRef.current);
    idRef.current = toast(message, {
      type,
      onClose: () => onCloseRef.current?.(),
    });
    return () => {
      if (idRef.current != null) {
        const id = idRef.current;
        idRef.current = null;
        toast.dismiss(id);
      }
    };
  }, [message, type, toast]);

  return null;
}

export default Toast;
