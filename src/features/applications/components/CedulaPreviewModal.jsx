import { createPortal } from 'react-dom';
import { FiArrowLeft, FiShare2, FiPrinter } from 'react-icons/fi';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import CedulaFlowAction from './CedulaFlowAction';

// ── CedulaPreviewModal ────────────────────────────────────────────────────────
// Full-screen preview overlay para una cédula. Contiene:
//   1. Backdrop oscuro + container (cierra al clickear el backdrop).
//   2. Toolbar: botón Volver, título + consecutivo/BORRADOR badge, acciones
//      contextuales (Mezcla lista / Aplicada en campo) según status + rol, y
//      acciones Compartir/Imprimir.
//   3. `children` — el `<CedulaDocumento>` (u otro renderer del papel blanco)
//      lo pasa el caller para mantener la separación cromo vs contenido.
//
// Patrón children (no owns-document):
// El modal NO recibe los ~14 props del documento. El caller compone
// `<CedulaPreviewModal>…<CedulaDocumento .../></CedulaPreviewModal>`, lo que:
//  - mantiene el ref del documento bajo el control del caller (html2canvas
//    captura solo el papel, sin la chrome del modal),
//  - permite que diferentes consumidores pasen documentos con shapes distintos
//    (relevante para una futura unificación con CedulaViewer.jsx que no usa
//    este modal pero sí el mismo documento).
//
// Extraído de CedulasAplicacion.jsx (Fase 4 del refactor del punto #7 del
// audit UX/UI). Junto con fase 3 (CedulaDocumento), saca todo el preview
// del orquestador.
export default function CedulaPreviewModal({
  previewTask,
  activeCedula,
  actionLoading,
  currentUser,
  onClose,
  onShare,
  onPrint,
  onMezclaLista,
  onAplicada,
  children,
}) {
  // Cierre con ESC — solo activo cuando el modal está visible. Punto #28
  // audit. El hook se llama incondicionalmente (rule of hooks); el null
  // gating se aplica adentro: cuando previewTask es null, el modal no
  // está montado y onClose no debe disparar.
  useEscapeClose(previewTask ? onClose : null);

  if (!previewTask) return null;

  return createPortal(
    <div className="ca-preview-backdrop" onClick={onClose}>
      <div className="ca-preview-container" onClick={e => e.stopPropagation()}>

        {/* Toolbar */}
        <div className="ca-preview-toolbar">
          <button className="ca-preview-back-btn" onClick={onClose} title="Volver">
            <FiArrowLeft size={16} />
            <span>Volver</span>
          </button>
          <span className="ca-preview-toolbar-title">
            Cédula de Aplicación — {previewTask.activityName}
            {previewTask.isDraft
              ? <span className="ca-toolbar-draft-badge">BORRADOR</span>
              : activeCedula && (
                // Label "Cédula" inline: antes el consecutivo flotaba como
                // código sin contexto. Punto #20 audit (mismo fix que en
                // CedulaViewer, ambos lugares mostraban el dato pelado).
                <span className="ca-toolbar-consecutivo">
                  Cédula {activeCedula.consecutivo}
                </span>
              )
            }
          </span>
          <div className="ca-preview-toolbar-actions">
            <CedulaFlowAction
              cedula={activeCedula}
              isDraft={previewTask.isDraft}
              actionLoading={actionLoading}
              currentUser={currentUser}
              onMezclaLista={onMezclaLista}
              onAplicada={onAplicada}
            />

            <button className="aur-chip ca-toolbar-icon-btn" onClick={onShare}>
              <FiShare2 size={15} /> <span className="ca-toolbar-btn-text">Compartir</span>
            </button>
            <button className="aur-chip ca-toolbar-icon-btn" onClick={onPrint}>
              <FiPrinter size={15} /> <span className="ca-toolbar-btn-text">Imprimir</span>
            </button>
          </div>
        </div>

        {children}

      </div>
    </div>,
    document.body
  );
}
