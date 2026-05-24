import { FiX, FiCheckCircle, FiEye, FiEdit2 } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { hasMinRole } from '../../../contexts/UserContext';
import { formatShortDate, isOverdue, isManualTask } from '../lib/cedulas-helpers';

// Mapping del status de cédula a clase de badge + label. Local porque solo
// la usa el split-card: la single-card en CedulaCard.jsx muestra el status
// como dos badges separados (pendiente/en_transito) en el header, no como
// pill resumido en una fila.
const STATUS_BADGE = {
  aplicada_en_campo: { cls: 'aur-badge--green',  label: 'Aplicada' },
  en_transito:       { cls: 'aur-badge--blue',   label: 'En Tránsito' },
  pendiente:         { cls: 'aur-badge--yellow', label: 'Pendiente' },
};
const statusBadge = (status) => STATUS_BADGE[status] || STATUS_BADGE.pendiente;

// ── CedulaSplitCard ──────────────────────────────────────────────────────────
// Card del listing principal para una task con MÚLTIPLES cédulas (una por
// lote del grupo). Cada cédula es una sub-fila con sus propias acciones.
// Para tasks con una sola cédula, ver CedulaCard.
//
// El header muestra activityName + responsable + estado de la TASK (no de las
// cédulas individuales). Las sub-filas listan {loteNombre, consecutivo, status
// badge} y acciones por cédula:
//   - pendiente + rol >= encargado → "Editar" + "Mezcla lista"
//   - en_transito + rol >= trabajador → "Aplicada en campo"
//   - cualquiera → "Ver" + (si no aplicada + rol >= encargado) "Anular"
//
// Extraído de CedulasAplicacion.jsx (Fase 5 del refactor del punto #7 del
// audit UX/UI). Junto con CedulaCard cubre los dos caminos de
// renderCedulaRow.
export default function CedulaSplitCard({
  task,
  cedulas,                 // array of cedulas (≥2)
  isHighlighted,
  actionLoading,
  currentUser,
  onPreview,
  onEditar,
  onMezclaLista,
  onAplicada,
  onAnular,
}) {
  const overdue = isOverdue(task);

  return (
    <article
      data-task-id={task.id}
      className={`ca-cedula-card ca-cedula-card--split${overdue ? ' is-overdue' : ''}${isManualTask(task) ? ' is-manual' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
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
          </p>
        </div>
        <div className="ca-cedula-status">
          {/* En split no mostramos badge de estado a nivel task: cada
              sub-row pinta el estado real de su cédula. Antes era una
              "Pendiente" conflada con "Vencida" en el mismo slot, que
              fingía hablar del task pero competía visualmente con los
              badges de las sub-rows. Vencida queda como pill paralelo.
              Punto #14 audit. */}
          {overdue && <span className="aur-badge aur-badge--magenta">Vencida</span>}
          <span className="ca-cedula-due">{formatShortDate(task.dueDate)}</span>
        </div>
      </div>

      <ul className="ca-split-list">
        {cedulas.map(c => {
          const isLdg     = actionLoading.has(c.id);
          const canAnular = c.status !== 'aplicada_en_campo' && hasMinRole(currentUser?.rol, 'encargado');
          const sb        = statusBadge(c.status);
          return (
            <li key={c.id} className="ca-split-row">
              <div className="ca-split-info">
                <span className="ca-split-lote">{c.splitLoteNombre || '—'}</span>
                <span className="ca-cedula-consecutivo">{c.consecutivo}</span>
                <span className={`aur-badge ${sb.cls}`}>{sb.label}</span>
              </div>
              <div className="ca-split-actions">
                {c.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
                  <button
                    type="button"
                    className="aur-chip"
                    onClick={() => onEditar(c.id)}
                    disabled={isLdg}
                    title="Editar productos y dosis"
                  >
                    <FiEdit2 size={12} /> Editar
                  </button>
                )}
                {c.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={() => onMezclaLista(c.id)}
                    disabled={isLdg}
                  >
                    <FiCheckCircle size={12} />
                    {isLdg ? 'Procesando…' : 'Mezcla lista'}
                  </button>
                )}
                {c.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
                  <button
                    type="button"
                    className="aur-btn-pill aur-btn-pill--sm"
                    onClick={() => onAplicada(c.id)}
                    disabled={isLdg}
                  >
                    <FaTractor size={12} />
                    {isLdg ? 'Registrando…' : 'Aplicada en campo'}
                  </button>
                )}
                <button
                  type="button"
                  className="aur-chip aur-chip--ghost"
                  onClick={() => onPreview(c.id)}
                  title="Ver cédula de aplicación"
                >
                  <FiEye size={12} /> Ver
                </button>
                {canAnular && (
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
                    onClick={() => onAnular(c.id)}
                    disabled={isLdg}
                    title="Anular cédula"
                  >
                    <FiX size={13} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
