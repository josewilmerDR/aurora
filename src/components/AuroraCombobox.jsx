import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiSearch } from 'react-icons/fi';

// Combobox con búsqueda libre. Wrapper sobre las primitivas .aur-combo-*
// definidas en src/styles/aurora.css. Reusable cross-domain.
export default function AuroraCombobox({
  value,
  onChange,
  items,
  labelKey = 'nombre',
  labelFn,
  metaFn,
  placeholder = '— Seleccionar —',
  disabled = false,
}) {
  const getLabel = useCallback(
    (item) => labelFn ? labelFn(item) : (item?.[labelKey] || ''),
    [labelFn, labelKey],
  );
  const nameFor = useCallback(
    (id) => { const item = items.find(i => i.id === id); return item ? getLabel(item) : ''; },
    [items, getLabel],
  );

  const [text, setText]       = useState(() => nameFor(value));
  const [open, setOpen]       = useState(false);
  const [hi, setHi]           = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef               = useRef(null);
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(nameFor(value));
  }, [value, nameFor]);

  const filtered = items.filter(i =>
    !text || getLabel(i).toLowerCase().includes(text.toLowerCase()),
  );

  const openDropdown = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (item) => {
    setText(getLabel(item));
    setOpen(false);
    setHi(0);
    onChange(item.id);
  };

  const handleTextChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
    if (value) onChange('');
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setOpen(false);
        setText(nameFor(value));
      }
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
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="aur-combo" ref={wrapRef} style={{ display: 'block', width: '100%' }}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          ref={inputRef}
          className="aur-combo-input"
          value={text}
          autoComplete="off"
          placeholder={placeholder}
          onChange={handleTextChange}
          onFocus={openDropdown}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((item, i) => {
            const meta = metaFn ? metaFn(item) : '';
            return (
              <li
                key={item.id}
                className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
                onMouseDown={() => selectOption(item)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="aur-combo-name">{getLabel(item)}</span>
                {meta && <span className="aur-combo-meta">{meta}</span>}
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
