import { createPortal } from 'react-dom';
import { FiX, FiFilter } from 'react-icons/fi';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import '../styles/filtro-periodo-modal.css';

// ── FiltroPeriodoModal ───────────────────────────────────────────────────────
// Modal compacto con dos inputs date (Desde / Hasta) para filtrar listings de
// cédulas por rango. Setters expuestos directos al caller — el estado vive
// arriba (CedulasAplicacion / HistorialAplicaciones) porque la lista lo consume.
//
// Botón Limpiar aparece solo si hay al menos uno de los dos campos con valor;
// botón Listo cierra el modal (no aplica nada, los inputs son live-bound).
//
// Props opcionales para soportar Historial (filtra por uno de varios campos
// de fecha distintos según el sentido del rango — programada, cosecha,
// aplicación, edición):
//   - dateField + setDateField + dateFields[]  → renderiza un selector
//     "Filtrar por" arriba de los inputs.
//   - recordWord (default 'cédula') → palabra usada en el contador live
//     "X cédula(s) en el periodo". Historial usa 'fila'.
export default function FiltroPeriodoModal({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  matchCount,
  onClose,
  dateField,
  setDateField,
  dateFields,
  recordWord = 'cédula',
}) {
  useEscapeClose(onClose); // Punto #28 audit.
  // Live count: cuando hay rango activo, "X cédulas en el periodo"; cuando
  // está vacío, "X cédulas en total". Resuelve el roundtrip Listo → "0
  // resultados" → reabrir filtro → probar otro rango. Punto #17 audit.
  const hasRange = !!(dateFrom || dateTo);
  const cedulaWord = matchCount === 1 ? recordWord : `${recordWord}s`;
  const countLabel = `${matchCount} ${cedulaWord} en ${hasRange ? 'el periodo' : 'total'}`;
  const showFieldSelector = !!(dateField !== undefined && setDateField && Array.isArray(dateFields) && dateFields.length > 0);

  return createPortal(
    <div
      className="aur-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="aur-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ca-filtro-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiFilter size={16} />
          </span>
          <h3 className="aur-modal-title" id="ca-filtro-modal-title">
            Filtrar por periodo
          </h3>
          <button
            type="button"
            className="aur-icon-btn aur-modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <FiX size={16} />
          </button>
        </div>
        <div className="aur-modal-content">
          <div className="ca-periodo-grid">
            {showFieldSelector && (
              <div className="ca-periodo-field ca-periodo-field--full">
                <label htmlFor="ca-field">Filtrar por</label>
                <select
                  id="ca-field"
                  className="aur-select"
                  value={dateField}
                  onChange={e => setDateField(e.target.value)}
                >
                  {dateFields.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="ca-periodo-field">
              <label htmlFor="ca-from">Desde</label>
              <input
                id="ca-from"
                type="date"
                className="aur-input"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>
            <div className="ca-periodo-field">
              <label htmlFor="ca-to">Hasta</label>
              <input
                id="ca-to"
                type="date"
                className="aur-input"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="aur-modal-actions">
          <span className="aur-field-hint ca-periodo-count" aria-live="polite">
            {countLabel}
          </span>
          {hasRange && (
            <button
              type="button"
              className="aur-chip aur-chip--ghost"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
            >
              <FiX size={12} /> Limpiar
            </button>
          )}
          <button
            type="button"
            className="aur-btn-pill"
            onClick={onClose}
          >
            Listo
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
