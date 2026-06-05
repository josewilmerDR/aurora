import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * PortalCombobox — input con dropdown renderizado por portal a document.body
 * (escapa del overflow de contenedores con scroll). Maneja teclado
 * (↑/↓/Enter/Esc), clic-fuera y reposicionamiento en scroll/resize mientras
 * está abierto. El padre controla el texto (`value`) y el filtrado (`items`),
 * para que cada uso filtre como necesite.
 *
 * Extraído de los 3 comboboxes casi idénticos de Recepcion.jsx
 * (Autocomplete/Proveedor/UM). Sigue el patrón de LaborCombobox.
 *
 * Props:
 *   - value         string  · texto del input (controlado por el padre)
 *   - onType        fn(text) · al tipear
 *   - items         array   · opciones ya filtradas a mostrar
 *   - onPick        fn(item) · al seleccionar una opción (click/Enter)
 *   - renderItem    fn(item) · contenido del <li>
 *   - getItemKey    fn(item) · key de React por item (default: item.id)
 *   - placeholder   string
 *   - inputClassName / dropdownClassName / inputId
 *   - minWidth      number  · ancho mínimo del dropdown (default: ancho del input)
 *   - autoFocus     bool
 *   - openOnFocus   bool    · abrir al enfocar aunque value esté vacío (default: true)
 */
export default function PortalCombobox({
  value,
  onType,
  items,
  onPick,
  renderItem,
  getItemKey = (it) => it.id,
  placeholder,
  inputClassName,
  dropdownClassName = 'proveedor-dropdown',
  itemClassName = 'proveedor-dropdown-item',
  itemActiveClassName = 'proveedor-dropdown-item--active',
  inputId,
  minWidth,
  autoFocus,
  openOnFocus = true,
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const calcPos = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const width = minWidth ? Math.max(r.width, minWidth) : r.width;
    setPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width });
  };

  // Reset highlight cuando cambia el texto.
  useEffect(() => { setHi(0); }, [value]);

  // Reposicionar mientras está abierto: si el usuario scrollea la grilla, el
  // dropdown (en body) seguiría anclado a la posición vieja y quedaría flotando.
  useEffect(() => {
    if (!open) return;
    const reposition = () => calcPos();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cerrar en clic fuera (input o lista).
  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openDropdown = () => { calcPos(); setOpen(true); };

  const pick = (item) => { onPick(item); setOpen(false); setHi(0); };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, items.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (items[hi]) { pick(items[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        className={inputClassName}
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        onChange={e => { onType(e.target.value); openDropdown(); }}
        onFocus={() => { if (openOnFocus || value) openDropdown(); }}
        onBlur={() => setTimeout(() => { if (document.activeElement !== inputRef.current) setOpen(false); }, 150)}
        onKeyDown={handleKeyDown}
      />
      {open && items.length > 0 && createPortal(
        <ul
          ref={listRef}
          className={dropdownClassName}
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {items.map((item, i) => (
            <li
              key={getItemKey(item)}
              className={`${itemClassName}${i === hi ? ' ' + itemActiveClassName : ''}`.trim()}
              onMouseDown={() => pick(item)}
              onMouseEnter={() => setHi(i)}
            >
              {renderItem(item)}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}
