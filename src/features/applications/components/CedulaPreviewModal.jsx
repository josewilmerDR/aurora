import { createPortal } from 'react-dom';
import { FiArrowLeft, FiShare2, FiPrinter } from 'react-icons/fi';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import CedulaFlowAction from './CedulaFlowAction';

// ── CedulaPreviewModal ────────────────────────────────────────────────────────
// Full-screen preview overlay para una cédula. **Único uso vivo**: preview
// del DRAFT en CedulaNuevaModal (botón "Vista previa" — el draft existe en
// memoria pero no tiene id en backend, así que no puede navegarse al viewer
// dedicado /aplicaciones/cedula/:id). El listing tras la unificación
// navega directo al viewer; CedulaFlowAction internamente retorna null
// cuando isDraft=true, así que los handlers onMezclaLista/onAplicada son
// no-ops en este modal — quedan en la API por si una futura iteración
// agrega "guardar como cédula" desde el preview.
//
// Contiene:
//   1. Backdrop oscuro + container (cierra al clickear el backdrop).
//   2. Toolbar: botón Volver, título + BORRADOR badge, acciones (no-op),
//      Compartir/Imprimir del draft.
//   3. `children` — el `<CedulaDocumento>` lo pasa el caller para mantener
//      la separación cromo vs contenido y dejar el ref bajo control del
//      caller (html2canvas captura solo el papel).
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
