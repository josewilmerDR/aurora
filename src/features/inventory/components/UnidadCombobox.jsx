import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { UNIDAD_OPTIONS } from '../lib/bodega';

// Combobox con autocompletado de unidades. Texto libre permitido (no fuerza
// a elegir de la lista); el dropdown se portalea para no quedar clipeado.
export default function UnidadCombobox({ value, onChange }) {
  const [text, setText]       = useState(value || '');
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(value || '');
  }, [value]);

  const filtered = useMemo(() =>
    UNIDAD_OPTIONS.filter(u =>
      !text || u.toLowerCase().includes(text.toLowerCase())
    ), [text]);

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (u) => {
    setText(u);
    setOpen(false);
    setHi(0);
    onChange(u);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
    onChange(e.target.value);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) setOpen(false);
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

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

  return (
    <>
      <input
        ref={inputRef}
        className="aur-input"
        value={text}
        autoComplete="off"
        placeholder="Ej: litros, kg, unidades"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="bg-unidad-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((u, i) => (
            <li
              key={u}
              className={`bg-unidad-dropdown-item${i === hi ? ' bg-unidad-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHi(i)}
            >
              {u}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}
