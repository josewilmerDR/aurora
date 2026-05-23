import { FiArrowLeft, FiArchive, FiEdit, FiCopy, FiRotateCcw, FiTrash2, FiEye } from 'react-icons/fi';
import PackageTimeline from './PackageTimeline';
import { missingPriceTooltip } from '../lib/packages-helpers';

/**
 * PackageHub — vista de lectura de un paquete seleccionado.
 *
 * Extraído de PackageManagement.jsx (Fase E del refactor para acercar el
 * archivo padre al límite de 600 LOC). Read-only: ningún campo es editable
 * desde acá; el usuario abre el form vía `onEdit`.
 *
 * Renderiza:
 *   - Banner de archivado (si aplica).
 *   - Header: nombre del paquete, costo total, acciones (edit/duplicate/
 *     archive|unarchive/delete).
 *   - Pills: tipoCosecha, etapaCultivo, tecnicoResponsable, uso actual.
 *   - Descripción.
 *   - Sección de actividades (cuando hay): PackageTimeline + lista
 *     expandible. Cada actividad puede mostrar productos y calibración
 *     en su detalle.
 *
 * Props data:
 *   - selectedPkg          object         · paquete completo
 *   - totalCost            object         · packageCostsById.get(selectedPkg.id)
 *   - usage                {lotes,grupos} · selectedPkgUsage
 *   - users                array          · para mapear responsableId → nombre
 *   - calibraciones        array          · para mapear calibracionId → nombre
 *   - productosById        Map<id,prod>   · para precios en detalle
 *   - expandedActivities   Set<number>    · índices (post-sort) expandidos
 *   - activityCosts        array          · selectedPkgActivityCosts (post-sort)
 *
 * Props gating / estado de mutación:
 *   - canDelete            bool         · si false, el botón de eliminar se
 *                                         oculta (defense-in-depth contra el
 *                                         backend que solo exige supervisor).
 *   - isMutating           bool         · si true, todas las acciones se
 *                                         deshabilitan — evita doble-click →
 *                                         doble request → "Error" en el segundo
 *                                         (DELETE 404 sobre doc ya borrado, etc.).
 *
 * Props handlers (recibe el paquete cuando aplica para no acoplar al closure):
 *   - onBack()
 *   - onEdit(pkg)
 *   - onDuplicate(pkg)
 *   - onArchive(pkg)
 *   - onUnarchive(pkg)
 *   - onDelete(pkg)
 *   - onToggleActivityExpand(index)
 */
export default function PackageHub({
  selectedPkg,
  totalCost,
  usage,
  users,
  calibraciones,
  productosById,
  expandedActivities,
  activityCosts,
  canDelete = true,
  isMutating = false,
  onBack,
  onEdit,
  onDuplicate,
  onArchive,
  onUnarchive,
  onDelete,
  onToggleActivityExpand,
}) {
  if (!selectedPkg) return null;

  const safeTotalCost = totalCost || { totals: [], hasMissingPrice: false, withoutPrice: 0 };

  return (
    <div className="lote-hub">
      <button className="lote-hub-back" onClick={onBack}>
        <FiArrowLeft size={13} /> Todos los paquetes
      </button>

      {selectedPkg.archivedAt && (
        <div className="pkg-archived-banner" role="status">
          <FiArchive size={13} aria-hidden="true" />
          <span>Este paquete está archivado. Los lotes y grupos que ya lo referencian siguen funcionando, pero no aparece al elegir paquete para uno nuevo.</span>
          <button
            type="button"
            className="pkg-archived-banner-action"
            onClick={() => onUnarchive(selectedPkg)}
          >
            Desarchivar
          </button>
        </div>
      )}

      <div className="hub-header">
        <div className="hub-title-block">
          <h2 className="hub-lote-code">{selectedPkg.nombrePaquete}</h2>
          {safeTotalCost.totals.length > 0 && (
            <span
              className="pkg-hub-total-cost"
              title={
                safeTotalCost.hasMissingPrice
                  ? `Costo total del paquete por hectárea. ${missingPriceTooltip(safeTotalCost.withoutPrice)}`
                  : 'Costo total del paquete por hectárea'
              }
            >
              {safeTotalCost.totals.map(([mon, total]) => (
                <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-total-cost-mon">{mon}/Ha</span></span>
              ))}
              {safeTotalCost.hasMissingPrice && (
                <span className="pkg-cost-warn" role="status">Costo incompleto</span>
              )}
            </span>
          )}
        </div>
        <div className="hub-header-actions">
          <button
            onClick={() => onEdit(selectedPkg)}
            className="icon-btn"
            title="Editar paquete"
            disabled={isMutating}
          >
            <FiEdit size={16} />
          </button>
          <button
            onClick={() => onDuplicate(selectedPkg)}
            className="icon-btn"
            title="Duplicar paquete"
            disabled={isMutating}
          >
            <FiCopy size={16} />
          </button>
          {selectedPkg.archivedAt ? (
            <button
              onClick={() => onUnarchive(selectedPkg)}
              className="icon-btn pkg-icon-btn--archived"
              title="Desarchivar paquete"
              disabled={isMutating}
            >
              <FiRotateCcw size={16} />
            </button>
          ) : (
            <button
              onClick={() => onArchive(selectedPkg)}
              className="icon-btn"
              title="Archivar paquete"
              disabled={isMutating}
            >
              <FiArchive size={16} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(selectedPkg)}
              className="icon-btn delete"
              title="Eliminar permanentemente"
              disabled={isMutating}
            >
              <FiTrash2 size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="hub-info-pills">
        {selectedPkg.tipoCosecha && <span className="hub-pill">{selectedPkg.tipoCosecha}</span>}
        {selectedPkg.etapaCultivo && selectedPkg.etapaCultivo !== 'N/A' && (
          <span className="hub-pill">{selectedPkg.etapaCultivo}</span>
        )}
        {selectedPkg.tecnicoResponsable && (
          <span className="hub-pill">{selectedPkg.tecnicoResponsable}</span>
        )}
        {/* Uso actual del paquete: cuántos lotes/grupos lo aplican.
            Pill con estilo diferenciado para que se lea como "estado vivo"
            y no como "categoría". Si nadie lo usa, mostramos "Sin uso aún"
            en lugar de ocultar — ayuda a confirmar que es seguro archivar
            o eliminar. */}
        {(() => {
          const { lotes: nLotes, grupos: nGrupos } = usage;
          if (nLotes === 0 && nGrupos === 0) {
            return <span className="hub-pill hub-pill--usage hub-pill-muted">Sin uso aún</span>;
          }
          const parts = [];
          if (nLotes > 0) parts.push(`${nLotes} ${nLotes === 1 ? 'lote' : 'lotes'}`);
          if (nGrupos > 0) parts.push(`${nGrupos} ${nGrupos === 1 ? 'grupo' : 'grupos'}`);
          return (
            <span
              className="hub-pill hub-pill--usage"
              title="Lotes y grupos que aplican este paquete actualmente"
            >
              Aplicado en {parts.join(' · ')}
            </span>
          );
        })()}
      </div>

      {selectedPkg.descripcion && (
        <p className="pkg-hub-desc">{selectedPkg.descripcion}</p>
      )}

      <div className="pkg-hub-section-label">
        Actividades <span className="pkg-hub-count">{selectedPkg.activities?.length || 0}</span>
      </div>
      {(!selectedPkg.activities || selectedPkg.activities.length === 0) ? (
        <p className="empty-state">Sin actividades programadas.</p>
      ) : (
        <>
          <PackageTimeline activities={selectedPkg.activities} />
          <ul className="pkg-hub-activities">
            {[...selectedPkg.activities]
              .sort((a, b) => Number(a.day) - Number(b.day))
              .map((act, i) => {
                const resp = users.find(u => u.id === act.responsableId);
                const cal = calibraciones.find(c => c.id === act.calibracionId);
                const hasDetails = (act.productos?.length > 0) || !!cal;
                const expanded = expandedActivities.has(i);
                const actCostoInfo = activityCosts[i]
                  || { totals: [], hasMissingPrice: false, withoutPrice: 0 };
                return (
                  <li key={i} className="pkg-hub-activity-item">
                    <span className="pkg-hub-activity-day">Día {act.day}</span>
                    <div className="pkg-hub-activity-info">
                      <span className="pkg-hub-activity-name">{act.name}</span>
                      {(resp || act.productos?.length > 0 || cal) && (
                        <div className="pkg-hub-activity-meta">
                          {resp && <span className="pkg-hub-activity-resp">{resp.nombre}</span>}
                          {act.productos?.length > 0 && (
                            <button
                              type="button"
                              className="pkg-hub-activity-chip"
                              title="Ver productos y dosis"
                              onClick={() => onToggleActivityExpand(i)}
                            >
                              {act.productos.length} {act.productos.length === 1 ? 'producto' : 'productos'}
                            </button>
                          )}
                          {cal && (
                            <button
                              type="button"
                              className="pkg-hub-activity-chip pkg-hub-activity-chip--cal"
                              title={`Calibración: ${cal.nombre}`}
                              onClick={() => onToggleActivityExpand(i)}
                            >
                              Calibración
                            </button>
                          )}
                        </div>
                      )}
                      {actCostoInfo.totals.length > 0 && (
                        <span
                          className="pkg-hub-activity-cost"
                          title={
                            actCostoInfo.hasMissingPrice
                              ? `Costo de la mezcla por hectárea. ${missingPriceTooltip(actCostoInfo.withoutPrice)}`
                              : 'Costo de la mezcla por hectárea'
                          }
                        >
                          {actCostoInfo.totals.map(([mon, total]) => (
                            <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-activity-cost-mon">{mon}/Ha</span></span>
                          ))}
                          {actCostoInfo.hasMissingPrice && (
                            <span className="pkg-cost-warn" role="status">Costo incompleto</span>
                          )}
                        </span>
                      )}
                      {expanded && (
                        <div className="pkg-hub-activity-detail">
                          {cal && (
                            <span className="pkg-hub-detail-cal">Cal: {cal.nombre}</span>
                          )}
                          {act.productos?.map(p => {
                            const cat = productosById.get(p.productoId);
                            const precioUnitario = parseFloat(cat?.precioUnitario) || 0;
                            const moneda = cat?.moneda || '';
                            const precioTotal = (p.cantidadPorHa || 0) * precioUnitario;
                            return (
                              <span key={p.productoId} className="pkg-hub-detail-prod">
                                <span className="pkg-hub-detail-prod-name">{p.nombreComercial}</span>
                                <span className="pkg-hub-detail-prod-dose">{p.cantidadPorHa} {p.unidad}/Ha</span>
                                {precioUnitario > 0 && (
                                  <>
                                    <span className="pkg-hub-detail-prod-price">P.U.: {precioUnitario.toFixed(2)} {moneda}</span>
                                    <span className="pkg-hub-detail-prod-total">Total/Ha: {precioTotal.toFixed(2)} {moneda}</span>
                                  </>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {hasDetails && (
                      <button
                        className={`icon-btn pkg-action-btn${expanded ? ' expanded' : ''}`}
                        title={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                        onClick={() => onToggleActivityExpand(i)}
                      >
                        <FiEye size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </div>
  );
}
