import { useEffect, useRef } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// useEscapeClose — cierre con ESC para modales custom (createPortal directo).
//
// AuroraModal ya trae su propio handler de ESC; este hook es para modales
// del feature que renderizan directo con createPortal (CedulaPreviewModal,
// FiltroPeriodoModal, AplicadaModal, MezclaListaModal, CedulaNuevaModal).
// Antes ninguno respondía a ESC y los stacks de portales eran confusos:
// abrir Preview + MezclaListaModal y presionar ESC no hacía nada.
//
// Stack innermost-first: el último modal en montarse ocupa el tope del
// stack y es el primero en cerrar con ESC. Cuando se cierra, el siguiente
// ESC va al que estaba debajo. Patrón "modal stack" estándar.
//
// Pasar onClose = null o undefined desactiva el handler para esta
// instancia (útil cuando el cierre depende de otro estado — p.ej.
// MezclaListaModal no debería cerrarse durante un submit en vuelo).
//
// Limitación conocida: si hay un AuroraConfirmModal abierto SOBRE un
// modal que usa este hook, AuroraModal y este hook firan ambos en el
// mismo ESC y se cierran los dos. Por hoy no es un flow real
// (ConfirmModal se abre desde el listing, no desde dentro de los modales
// cubiertos por este hook). Si llega a ser un problema, hay que unificar
// las dos pilas. Punto #28 audit.
// ─────────────────────────────────────────────────────────────────────────────

const escStack = [];
let docHandlerInstalled = false;

const installHandler = () => {
  if (docHandlerInstalled) return;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || escStack.length === 0) return;
    // Walk top-down: el modal innermost que tenga onClose activo cierra
    // primero. Saltar los que pasaron null (p.ej. MezclaListaModal con
    // submit en vuelo, o Preview no montado) permite que un modal de
    // abajo siga respondiendo a ESC en vez de quedar bloqueado.
    for (let i = escStack.length - 1; i >= 0; i--) {
      const fn = escStack[i].current;
      if (typeof fn === 'function') {
        // stopPropagation evita que listeners más abajo en el bubble del
        // document (p.ej. atajos globales) también disparen — el ESC ya
        // tiene un propósito claro: cerrar el modal innermost.
        e.stopPropagation();
        fn();
        return;
      }
    }
  });
  docHandlerInstalled = true;
};

export function useEscapeClose(onClose) {
  // Ref captura la versión más reciente de onClose sin re-registrar el
  // listener en cada render — onClose suele ser una arrow inline.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    installHandler();
    escStack.push(onCloseRef);
    return () => {
      const idx = escStack.lastIndexOf(onCloseRef);
      if (idx !== -1) escStack.splice(idx, 1);
    };
  }, []);
}
