import { createPortal } from 'react-dom';
import { FiFilter, FiX } from 'react-icons/fi';

// Popover de filtro de columna compartido cross-domain. Se renderiza portaled
// a body. La página dueña controla apertura/cierre vía `<state> && <Popover />`.
//
// Soporta 3 filterType:
//   · "text"   → un input de texto (props textValue/onTextChange)
//   · "number" → dos inputs numéricos (range: fromValue/toValue + handlers)
//   · "date"   → dos inputs de fecha (range: fromValue/toValue + handlers)
//
// El botón de limpiar sólo aparece cuando hay valor Y se pasa `onClear`. Si
// la página no necesita botón de limpiar, omite la prop.
//
// Cierre: click en backdrop, Escape, o (en text) Enter — todos disparan
// `onClose`. Position: fixed via x/y props, clampado al viewport derecho.
export default function AuroraFilterPopover({
  x,
  y,
  filterType = 'text',
  textValue = '',
  onTextChange,
  textPlaceholder = 'Filtrar…',
  textMaxLength,
  fromValue = '',
  toValue = '',
  onFromChange,
  onToChange,
  onClear,
  onClose,
}) {
  const isText  = filterType === 'text';
  const inputType = filterType === 'date' ? 'date' : 'number';

  const hasTextValue  = !!textValue;
  const hasRangeValue = !!fromValue || !!toValue;
  const showClear     = !!onClear && (isText ? hasTextValue : hasRangeValue);

  const handleClear = () => {
    onClear?.();
    onClose?.();
  };

  const left = Math.min(x, window.innerWidth - 260);

  return createPortal(
    <>
      <div className="aur-filter-backdrop" onClick={onClose} />
      <div className="aur-filter-popover" style={{ left, top: y }}>
        <FiFilter size={13} className="aur-filter-icon" />
        {isText ? (
          <input
            autoFocus
            className="aur-filter-input"
            placeholder={textPlaceholder}
            maxLength={textMaxLength}
            value={textValue}
            onChange={(e) => onTextChange?.(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') onClose?.(); }}
          />
        ) : (
          <div className="aur-filter-range">
            <span className="aur-filter-range-label">De</span>
            <input
              autoFocus
              type={inputType}
              className="aur-filter-input aur-filter-input--range"
              value={fromValue}
              onChange={(e) => onFromChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}
            />
            <span className="aur-filter-range-label">A</span>
            <input
              type={inputType}
              className="aur-filter-input aur-filter-input--range"
              value={toValue}
              onChange={(e) => onToChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose?.(); }}
            />
          </div>
        )}
        {showClear && (
          <button
            type="button"
            className="aur-filter-clear"
            title="Limpiar filtro"
            onClick={handleClear}
          >
            <FiX size={13} />
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
