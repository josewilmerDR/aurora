import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useId } from 'react';

/**
 * SegmentCombobox — combobox de selección dentro de la grilla de segmentos de la
 * planilla por unidad. Unifica los tres comboboxes que vivían duplicados en
 * UnitPayroll.jsx (Labor / Grupo / Unidad): misma máquina de teclado, dropdown,
 * click-outside y navegación por grilla (forwardRef + onTabDown + onAfterSelect).
 *
 * Mantiene el contrato string de los segmentos (no el id-based de
 * components/ui/LaborCombobox) porque ese es el formato persistido en las
 * planillas — migrarlo exigiría reescribir datos guardados.
 *
 * Props:
 *   - value        string   · texto visible del input
 *   - onChange     fn       · onChange(...selectArgs) — se invoca tanto al tipear
 *                             (1 arg) como al elegir opción (getSelectArgs)
 *   - items        array    · opciones a listar
 *   - filter       fn       · (item, query) => bool — filtro de coincidencia
 *   - getKey       fn       · (item) => key React
 *   - renderOption fn       · (item) => ReactNode contenido del <li>
 *   - getSelectArgs fn      · (item) => array de args pasados a onChange al elegir
 *   - placeholder  string
 *   - displayValue fn?      · (value) => string mostrado en el input (default: identity)
 *   - ariaLabel    string?  · etiqueta accesible del input
 *   - onAfterSelect fn?     · callback tras elegir (mueve foco a la sig. celda)
 *   - onTabDown    fn?      · handler de Tab cuando el dropdown está cerrado
 */
const SegmentCombobox = forwardRef(function SegmentCombobox({
  value,
  onChange,
  items,
  filter,
  getKey,
  renderOption,
  getSelectArgs,
  placeholder,
  displayValue,
  ariaLabel,
  onAfterSelect,
  onTabDown,
}, ref) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const filtered = items.filter(item => filter(item, value));

  const selectOption = (item) => {
    onChange(...getSelectArgs(item));
    setOpen(false);
    setHighlighted(0);
    onAfterSelect?.();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); setHighlighted(0); e.preventDefault(); return; }
      if (e.key === 'Tab' && onTabDown) { onTabDown(e); return; }
      return;
    }
    if (e.key === 'Tab') { setOpen(false); if (onTabDown) onTabDown(e); return; }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => {
        const next = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => {
        const next = Math.max(h - 1, 0);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted] !== undefined) { selectOption(filtered[highlighted]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const shown = displayValue ? displayValue(value) : value;
  const activeId = open && filtered[highlighted] ? `${listId}-opt-${highlighted}` : undefined;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="ut-ctrl"
        value={shown}
        autoComplete="off"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        onChange={e => { onChange(e.target.value, null); setOpen(true); setHighlighted(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} id={listId} role="listbox" className="labor-dropdown">
          {filtered.map((item, i) => (
            <li
              key={getKey(item)}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === highlighted}
              className={`labor-dropdown-item${i === highlighted ? ' labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(item)}
              onMouseEnter={() => setHighlighted(i)}
            >
              {renderOption(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export default SegmentCombobox;
