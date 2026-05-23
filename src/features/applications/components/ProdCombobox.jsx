import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiSearch } from 'react-icons/fi';

/**
 * ProdCombobox — combobox de búsqueda de productos con dropdown portaled.
 *
 * Extraído de PackageManagement.jsx (Fase C del refactor para acercar el
 * archivo padre al límite de 600 LOC). Usa los estilos `.aur-combo-*` del
 * design system + `.pkg-prod-combo` para el padding/min-width específicos
 * de esta página.
 *
 * Props:
 *   - productos    array         · catálogo completo de productos
 *   - excludeIds   string[]      · ids a esconder (productos ya en la mezcla)
 *   - onSelect     (id) => void  · callback con el id del producto elegido
 *
 * Comportamiento:
 *   - Filtra por nombreComercial o ingredienteActivo (case-insensitive).
 *   - Teclas: ArrowDown/Up navega, Enter selecciona, Escape cierra.
 *   - Click outside cierra (mousedown listener en document).
 *   - Dropdown va por createPortal a document.body para no quedar atrapado
 *     por overflow:hidden de contenedores ancestros (caso típico en cards).
 */
export default function ProdCombobox({ productos, excludeIds, onSelect }) {
  const [text, setText]       = useState('');
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef               = useRef(null);
  const listRef               = useRef(null);

  const filtered = productos
    .filter(p => !excludeIds.includes(p.id))
    .filter(p => !text ||
      p.nombreComercial?.toLowerCase().includes(text.toLowerCase()) ||
      p.ingredienteActivo?.toLowerCase().includes(text.toLowerCase())
    );

  const openDropdown = useCallback(() => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  }, []);

  const selectOption = (producto) => {
    setText('');
    setOpen(false);
    setHi(0);
    onSelect(producto.id);
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
      setText('');
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
    <div className="aur-combo pkg-prod-combo" ref={wrapRef}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          type="text"
          className="aur-combo-input"
          placeholder="+ Agregar producto..."
          value={text}
          autoComplete="off"
          onChange={e => { setText(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => {
            if (!listRef.current?.contains(document.activeElement)) setOpen(false);
          }, 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="aur-combo-name">{p.nombreComercial}</span>
              {p.ingredienteActivo && <span className="aur-combo-meta">{p.ingredienteActivo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
