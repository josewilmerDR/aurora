import { FiX, FiCheckCircle, FiPlusCircle, FiEye, FiEdit2 } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { hasMinRole } from '../../../contexts/UserContext';
import { formatShortDate, isOverdue, isManualTask } from '../lib/cedulas-helpers';

// ── CedulaCard ───────────────────────────────────────────────────────────────
// Card del listing principal para una task con UNA cédula (o ninguna todavía).
// Para tasks con cédulas split por lote, ver CedulaSplitCard.
//
// El header muestra activityName + lote + responsable + consecutivo + estado.
// La fila de acciones es contextual al status:
//   - sin cédula + rol >= encargado → "Generar cédula" (+ "Omitir" si vencida)
//   - cédula pendiente + rol >= encargado → "Editar" + "Mezcla lista"
//   - cédula en_transito + rol >= trabajador → "Aplicada en campo"
//   - cualquier cédula → "Ver" + (si rol >= encargado y no aplicada) "Anular"
//
// Extraído de CedulasAplicacion.jsx (Fase 5 del refactor del punto #7 del
// audit UX/UI). Junto con CedulaSplitCard cubre los dos caminos de
// renderCedulaRow.
export default function CedulaCard({
  task,
  cedula,                  // single cedula or null
  isHighlighted,
  allowSkipTask,
  actionLoading,
  currentUser,
  onPreview,
  onGenerar,
  onOmitir,
  onEditar,
  onMezclaLista,
  onAplicada,
  onAnular,
}) {
  const overdue   = isOverdue(task);
  const isLdg     = actionLoading.has(cedula ? cedula.id : `new-${task.id}`)
                 || actionLoading.has(`skip-${task.id}`);
  const canAnular = cedula && cedula.status !== 'aplicada_en_campo'
                 && hasMinRole(currentUser?.rol, 'encargado');

  return (
    <article
      data-task-id={task.id}
      className={`ca-cedula-card${overdue ? ' is-overdue' : ''}${isManualTask(task) ? ' is-manual' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
    >
      <div className="ca-cedula-head">
        <div className="ca-cedula-info">
          <h4 className="ca-cedula-name" title={task.activityName}>
            {task.activityName}
            {isManualTask(task) && <span className="aur-badge aur-badge--magenta">Adicional</span>}
          </h4>
          <p className="ca-cedula-meta">
            {task.loteName}
            {task.responsableName ? ` · ${task.responsableName}` : ''}
            {cedula && <span className="ca-cedula-consecutivo">{cedula.consecutivo}</span>}
          </p>
        </div>
        <div className="ca-cedula-status">
          {/* Un solo badge de estado: cédula si existe (fuente de verdad
              de la ejecución), tarea si todavía no se generó. Antes
              mostrábamos ambos: en pendiente+pendiente repetía el badge
              amarillo, y en pendiente+en_transito dejaba al usuario
              adivinando cuál mandaba. Vencida queda como pill paralelo,
              no sustituye al estado. Punto #14 audit. */}
          {cedula
            ? (cedula.status === 'en_transito'
                ? <span className="aur-badge aur-badge--blue">En Tránsito</span>
                : cedula.status === 'aplicada_en_campo'
                  ? <span className="aur-badge aur-badge--green">Aplicada</span>
                  : <span className="aur-badge aur-badge--yellow">Pendiente</span>)
            : <span className="aur-badge aur-badge--yellow">Pendiente</span>
          }
          {overdue && <span className="aur-badge aur-badge--magenta">Vencida</span>}
          <span className="ca-cedula-due">{formatShortDate(task.dueDate)}</span>
        </div>
      </div>

      <div className="ca-cedula-actions">
        {!cedula && hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={() => onGenerar(task.id)}
            disabled={isLdg}
            title="Generar cédula de aplicación"
          >
            <FiPlusCircle size={12} />
            {isLdg ? 'Generando…' : 'Generar cédula'}
          </button>
        )}

        {!cedula && allowSkipTask && hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
            onClick={() => onOmitir(task.id)}
            disabled={isLdg}
            title="Omitir esta tarea sin generar cédula"
          >
            <FiX size={13} />
          </button>
        )}

        {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            type="button"
            className="aur-chip"
            onClick={() => onEditar(cedula.id)}
            disabled={isLdg}
            title="Editar productos y dosis"
          >
            <FiEdit2 size={12} /> Editar
          </button>
        )}

        {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={() => onMezclaLista(cedula.id)}
            disabled={isLdg}
            title="Confirmar que la mezcla está lista"
          >
            <FiCheckCircle size={12} />
            {isLdg ? 'Procesando…' : 'Mezcla lista'}
          </button>
        )}

        {cedula?.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            onClick={() => onAplicada(cedula.id)}
            disabled={isLdg}
            title="Confirmar aplicación en campo"
          >
            <FaTractor size={12} />
            {isLdg ? 'Registrando…' : 'Aplicada en campo'}
          </button>
        )}

        {cedula && (
          <button
            type="button"
            className="aur-chip aur-chip--ghost"
            onClick={() => onPreview(cedula.id)}
            title="Ver cédula de aplicación"
          >
            <FiEye size={12} /> Ver cédula
          </button>
        )}

        {canAnular && (
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
            onClick={() => onAnular(cedula.id)}
            disabled={isLdg}
            title="Anular cédula"
          >
            <FiX size={13} />
          </button>
        )}
      </div>
    </article>
  );
}
