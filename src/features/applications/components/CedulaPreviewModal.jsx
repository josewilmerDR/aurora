import { createPortal } from 'react-dom';
import { FiArrowLeft, FiShare2, FiPrinter, FiCheckCircle } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { hasMinRole } from '../../../contexts/UserContext';

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
                <span className="ca-toolbar-consecutivo">
                  {activeCedula.consecutivo}
                </span>
              )
            }
          </span>
          <div className="ca-preview-toolbar-actions">
            <ToolbarFlowAction
              previewTask={previewTask}
              activeCedula={activeCedula}
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

// ── ToolbarFlowAction ────────────────────────────────────────────────────────
// La acción contextual del flujo de la cédula que aparece a la izquierda de
// Compartir/Imprimir. Antes era un IIFE inline en el toolbar — ahora es un
// pequeño componente para que cada rama (aplicada/pendiente/en_transito) sea
// legible por separado y testeable individualmente.
//
// Reglas:
//   - Borrador → no muestra nada (la cédula aún no existe).
//   - Sin cédula → no muestra nada.
//   - Aplicada → badge verde "Aplicada", sin acción.
//   - Pendiente + rol >= encargado → botón "Mezcla Lista".
//   - En tránsito + rol >= trabajador → botón "Aplicada en Campo".
function ToolbarFlowAction({
  previewTask,
  activeCedula,
  actionLoading,
  currentUser,
  onMezclaLista,
  onAplicada,
}) {
  if (previewTask.isDraft) return null;
  if (!activeCedula) return null;

  const isLdg = actionLoading.has(activeCedula.id);

  if (activeCedula.status === 'aplicada_en_campo') {
    return (
      <span className="ca-toolbar-applied-badge">
        <FiCheckCircle size={14} /> Aplicada
      </span>
    );
  }
  if (activeCedula.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado')) {
    return (
      <button
        className="aur-btn-pill"
        onClick={() => onMezclaLista(activeCedula.id)}
        disabled={isLdg}
      >
        <FiCheckCircle size={14} />
        {isLdg ? 'Procesando…' : 'Mezcla Lista'}
      </button>
    );
  }
  if (activeCedula.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador')) {
    return (
      <button
        className="aur-btn-pill"
        onClick={() => onAplicada(activeCedula.id)}
        disabled={isLdg}
      >
        <FaTractor size={14} />
        {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
      </button>
    );
  }
  return null;
}
