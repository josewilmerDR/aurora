import { FiCheckCircle } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { hasMinRole } from '../../../contexts/UserContext';

// ── CedulaFlowAction ─────────────────────────────────────────────────────────
// Botón/badge contextual del flujo de una cédula, alineado a la izquierda de
// Compartir/Imprimir en cualquier toolbar que la muestre (preview modal en
// el listing, y el viewer standalone que se navega vía /aplicaciones/cedula/:id).
//
// Antes vivía como helper interno de CedulaPreviewModal (`ToolbarFlowAction`)
// y el viewer no tenía manera de avanzar el flujo desde su chrome — el
// trabajador entraba con un push notification a una cédula en_transito y no
// podía marcarla aplicada sin volver al listing. Punto #5 audit.
//
// Reglas:
//   - Borrador o sin cédula → no renderea nada.
//   - aplicada_en_campo → badge verde estático "Aplicada".
//   - pendiente + rol ≥ encargado → botón "Mezcla Lista".
//   - en_transito + rol ≥ trabajador → botón "Aplicada en Campo".
//
// El loading se infiere del actionLoading Set (consistente con
// CedulasAplicacion); para call sites con un único cedulaId puede pasarse
// `actionLoading=new Set([cedulaId])` o bien un Set local.
export default function CedulaFlowAction({
  cedula,
  isDraft = false,
  actionLoading,
  currentUser,
  onMezclaLista,
  onAplicada,
}) {
  if (isDraft) return null;
  if (!cedula) return null;

  const isLdg = actionLoading?.has?.(cedula.id) || false;

  if (cedula.status === 'aplicada_en_campo') {
    return (
      <span className="ca-toolbar-applied-badge">
        <FiCheckCircle size={14} /> Aplicada
      </span>
    );
  }

  if (cedula.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado')) {
    return (
      <button
        type="button"
        className="aur-btn-pill"
        onClick={() => onMezclaLista(cedula.id)}
        disabled={isLdg}
      >
        <FiCheckCircle size={14} />
        {isLdg ? 'Procesando…' : 'Mezcla Lista'}
      </button>
    );
  }

  if (cedula.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador')) {
    return (
      <button
        type="button"
        className="aur-btn-pill"
        onClick={() => onAplicada(cedula.id)}
        disabled={isLdg}
      >
        <FaTractor size={14} />
        {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
      </button>
    );
  }

  return null;
}
