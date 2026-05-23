import { FiCopy, FiX, FiChevronDown } from 'react-icons/fi';
import ProdCombobox from './ProdCombobox';
import { ACT_NAME_MAX, missingPriceTooltip } from '../lib/packages-helpers';

/**
 * ActivityCard — card de una actividad dentro del form de paquete.
 *
 * Extraído de PackageManagement.jsx (Fase D del refactor para acercar el
 * archivo padre al límite de 600 LOC). Componente "controlado" — todo el
 * estado vive en el padre y aquí solo pintamos + emitimos eventos.
 *
 * Props per-card:
 *   - activity       object  · datos de la actividad
 *   - index          number  · posición en formData.activities
 *   - expanded       bool    · si la sección de productos está abierta
 *   - modified       bool    · si la actividad fue modificada respecto al snapshot
 *   - pendingDelete  bool    · si esta actividad mostró su inline confirm
 *   - costo          object  · resultado de calcularCosto para esta actividad
 *   - formErrors     object  · errores de validación crudos (claves act-{i}-{f})
 *
 * Props catálogos (compartidos por todas las cards):
 *   - users
 *   - productos
 *   - productosById
 *   - calibraciones
 *   - plantillas
 *   - eligibleResponsables
 *
 * Props handlers (el padre binda el index al definirlos):
 *   - onActivityChange(field, value)
 *   - onActivityBlur(field)
 *   - onRequestDelete()
 *   - onCancelDelete()
 *   - onConfirmDelete()
 *   - onDuplicate()
 *   - onToggleExpand()
 *   - onOpenTemplateModal()
 *   - onApplyPlantilla(plantillaId)
 *   - onAddProduct(productoId)
 *   - onRemoveProduct(productoId)
 *   - onProductCantidadChange(productoId, value)
 *   - onProductCantidadBlur(productoId, value)
 */
export default function ActivityCard({
  activity,
  index,
  expanded,
  modified,
  pendingDelete,
  costo,
  formErrors,
  users,
  productos,
  productosById,
  calibraciones,
  plantillas,
  eligibleResponsables,
  onActivityChange,
  onActivityBlur,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onDuplicate,
  onToggleExpand,
  onOpenTemplateModal,
  onApplyPlantilla,
  onAddProduct,
  onRemoveProduct,
  onProductCantidadChange,
  onProductCantidadBlur,
}) {
  const costEntries = costo?.totals || [];

  // Si el responsable ya guardado no está en la lista elegible (perdió
  // acceso o salió de planilla), lo añadimos como opción "huérfana" para
  // no descartar el valor silenciosamente — el usuario decide si lo
  // mantiene o lo cambia.
  const currentResponsable = activity.responsableId;
  const orphanResponsable = currentResponsable
    && !eligibleResponsables.some(u => u.id === currentResponsable)
    && users.find(u => u.id === currentResponsable);

  return (
    <li className={`pkg-act-card${modified ? ' pkg-act-card--modified' : ''}`}>
      <div className="pkg-act-row">
        <div className="pkg-act-day">
          <input
            type="number"
            min={0}
            max={1825}
            step={1}
            value={activity.day}
            onChange={(e) => onActivityChange('day', e.target.value)}
            onBlur={() => onActivityBlur('day')}
            aria-label="Día"
            placeholder="0"
            className={formErrors[`act-${index}-day`] ? 'fld-error-input' : ''}
            title={formErrors[`act-${index}-day`] || undefined}
            required
          />
          <span className="pkg-act-day-suffix">día</span>
        </div>

        <div className="pkg-act-body">
          <input
            type="text"
            className={`pkg-act-name${formErrors[`act-${index}-name`] ? ' fld-error-input' : ''}`}
            value={activity.name}
            onChange={(e) => onActivityChange('name', e.target.value)}
            onBlur={() => onActivityBlur('name')}
            placeholder="Nombre de la actividad"
            required
            maxLength={ACT_NAME_MAX}
            aria-label="Nombre de la actividad"
            title={formErrors[`act-${index}-name`] || undefined}
          />
          <div className="pkg-act-meta">
            <select
              className="aur-chip"
              value={currentResponsable || ''}
              onChange={(e) => onActivityChange('responsableId', e.target.value)}
              aria-label="Responsable"
            >
              <option value="">Responsable</option>
              {eligibleResponsables.map(user => (
                <option key={user.id} value={user.id}>{user.nombre}</option>
              ))}
              {orphanResponsable && (
                <option value={orphanResponsable.id}>{orphanResponsable.nombre} (no disponible)</option>
              )}
              {eligibleResponsables.length === 0 && !orphanResponsable && (
                <option value="" disabled>No hay empleados con acceso</option>
              )}
            </select>
            <select
              className="aur-chip"
              value={activity.calibracionId || ''}
              onChange={(e) => onActivityChange('calibracionId', e.target.value)}
              aria-label="Calibración"
            >
              <option value="">Calibración</option>
              {calibraciones.map(cal => <option key={cal.id} value={cal.id}>{cal.nombre}</option>)}
            </select>
            <select
              className="aur-chip aur-chip--ghost"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__create__') onOpenTemplateModal();
                else if (v) onApplyPlantilla(v);
              }}
              aria-label="Plantillas de aplicaciones"
            >
              <option value="">+ Plantilla</option>
              {plantillas.length === 0 && (
                <option value="" disabled>No hay plantillas de aplicaciones</option>
              )}
              {plantillas.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
              <option value="__create__">+ Crear plantilla a partir de esta actividad…</option>
            </select>
          </div>
        </div>

        <div
          className={`pkg-act-cost${costEntries.length === 0 ? ' pkg-act-cost--empty' : ''}`}
          title={
            costo.total === 0
              ? 'Sin productos asignados'
              : costo.allMissingPrice
                ? 'Todos los productos están sin precio en el catálogo'
                : costo.hasMissingPrice
                  ? `Costo de la mezcla por hectárea. ${missingPriceTooltip(costo.withoutPrice)}`
                  : 'Costo de la mezcla por hectárea'
          }
        >
          {costEntries.length === 0 ? (
            <span aria-label={costo.allMissingPrice ? 'Sin precio' : 'Sin productos'}>
              {costo.allMissingPrice ? 'Sin precio' : '—'}
            </span>
          ) : (
            <>
              {costEntries.map(([mon, total]) => (
                <div key={mon}>
                  {total.toFixed(2)}
                  <span className="pkg-act-cost-mon">{mon}/Ha</span>
                </div>
              ))}
              {costo.hasMissingPrice && (
                <span className="pkg-cost-warn" role="status">Costo incompleto</span>
              )}
            </>
          )}
        </div>

        <div className="pkg-act-actions">
          {pendingDelete ? (
            <div className="aur-inline-confirm">
              <span className="aur-inline-confirm-text">¿Eliminar?</span>
              <button type="button" className="aur-inline-confirm-yes" onClick={onConfirmDelete}>Sí</button>
              <button type="button" className="aur-inline-confirm-no" onClick={onCancelDelete}>No</button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="aur-icon-btn"
                onClick={onDuplicate}
                title="Duplicar actividad"
              >
                <FiCopy size={14} />
              </button>
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--danger"
                onClick={onRequestDelete}
                title="Eliminar actividad"
              >
                <FiX size={15} />
              </button>
              <button
                type="button"
                className={`aur-icon-btn pkg-act-expand${expanded ? ' is-open' : ''}`}
                onClick={onToggleExpand}
                title={expanded ? 'Ocultar productos' : 'Productos de mezcla'}
              >
                <FiChevronDown size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="pkg-act-products">
          <span className="pkg-act-products-label">Productos de mezcla</span>
          <div className="pkg-act-products-list">
            {(activity.productos || []).map(p => {
              const catProd = productosById.get(p.productoId);
              const precioUnitario = parseFloat(catProd?.precioUnitario) || 0;
              const moneda = catProd?.moneda || '';
              const qty = parseFloat(p.cantidadPorHa) || 0;
              const precioTotal = qty * precioUnitario;
              return (
                <div key={p.productoId} className="pkg-prod-row">
                  <span className="pkg-prod-row-name">{p.nombreComercial}</span>
                  <div className="pkg-prod-row-qty">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="1023.99"
                      value={p.cantidadPorHa}
                      onChange={(e) => onProductCantidadChange(p.productoId, e.target.value)}
                      onBlur={(e) => onProductCantidadBlur(p.productoId, e.target.value)}
                      data-prod-qty={`${index}-${p.productoId}`}
                      className={formErrors[`act-${index}-prod-${p.productoId}-cant`] ? 'fld-error-input' : ''}
                      title={formErrors[`act-${index}-prod-${p.productoId}-cant`] || 'Cantidad por Ha'}
                    />
                    <span className="pkg-prod-row-unit">{p.unidad}/Ha</span>
                  </div>
                  {precioUnitario > 0 ? (
                    <span className="pkg-prod-row-cost" title="Costo por hectárea">
                      {precioTotal.toFixed(2)}
                      <span className="pkg-prod-row-mon">{moneda}/Ha</span>
                    </span>
                  ) : <span />}
                  <button
                    type="button"
                    className="pkg-prod-row-remove"
                    onClick={() => onRemoveProduct(p.productoId)}
                    title="Quitar producto"
                  >
                    <FiX size={12} />
                  </button>
                </div>
              );
            })}
            <ProdCombobox
              productos={productos}
              excludeIds={(activity.productos || []).map(p => p.productoId)}
              onSelect={onAddProduct}
            />
          </div>
        </div>
      )}
    </li>
  );
}
