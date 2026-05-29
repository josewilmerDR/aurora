import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiSearch } from 'react-icons/fi';

/**
 * LaborCombobox — picker de labor que persiste el **id** de la labor.
 * Dropdown en portal sobre primitivas .aur-combo-*. Contrato: value=id,
 * onChange(id), '' = sin labor.
 *
 * Nota de diseño: UnitPayroll tiene una variante propia que persiste el string
 * "codigo - descripcion" dentro de los segmentos de planilla (contrato de datos
 * distinto) y está acoplada a su navegación por teclado en grilla
 * (forwardRef/onTabDown/onAfterSelect). Por eso no comparte este componente:
 * unificarlos exigiría migrar el formato persistido de las planillas.
 *
 * Props:
 *   - value     string · id de la labor seleccionada ('' = ninguna)
 *   - onChange  fn      · recibe el id elegido (o '' al limpiar)
 *   - labores   array   · [{ id, codigo, descripcion }]
 *   - inputId   string  · id del <input> para asociar un <label htmlFor>
 *   - placeholder string
 *   - className string  · clase extra opcional sobre el wrapper .aur-combo
 */
export default function LaborCombobox({
  value,
  onChange,
  labores,
  inputId,
  placeholder = 'Buscar labor…',
  className = '',
}) {
  const labelFor = useCallback((id) => {
    const l = labores.find(l => l.id === id);
    if (!l) return '';
    return l.descripcion + (l.codigo ? ` (${l.codigo})` : '');
  }, [labores]);

  const [text,    setText]    = useState(() => labelFor(value));
  const [open,    setOpen]    = useState(false);
  const [hi,      setHi]      = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef    = useRef(null);
  const inputRef   = useRef(null);
  const listRef    = useRef(null);
  const userTyping = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(labelFor(value));
  }, [value, labelFor]);

  const filtered = labores.filter(l => {
    if (!text) return true;
    const q = text.toLowerCase();
    return l.descripcion?.toLowerCase().includes(q) || l.codigo?.toLowerCase().includes(q);
  });

  const openDropdown = () => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (labor) => {
    setText(labelFor(labor.id));
    setOpen(false);
    setHi(0);
    onChange(labor.id);
  };

  // Al tipear NO limpiamos el value: la selección previa sobrevive hasta que el
  // usuario elija otra opción explícitamente.
  const handleChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
  };

  // Reconciliación al salir: si quedó vacío → limpia la selección; si quedó
  // texto que no terminó en selección → revierte al label vigente. Como las
  // opciones hacen preventDefault en mousedown (ver abajo), clickearlas NO
  // dispara blur, así que esto corre sólo en una salida real del campo — sin
  // el setTimeout(150) frágil que tenía la versión anterior.
  const closeAndReconcile = () => {
    setOpen(false);
    if (!text.trim()) {
      if (value) onChange('');
      setText('');
    } else {
      setText(labelFor(value));
    }
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
      setText(labelFor(value));
    }
  };

  // Click afuera: sólo cierra el dropdown (el blur del input reconcilia el texto).
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={`aur-combo${className ? ' ' + className : ''}`} ref={wrapRef}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="aur-combo-input"
          value={text}
          autoComplete="off"
          placeholder={placeholder}
          onChange={handleChange}
          onFocus={openDropdown}
          onBlur={closeAndReconcile}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
              // preventDefault evita que el input pierda foco al clickear: sin
              // blur no hay carrera entre el cierre y la selección.
              onMouseDown={(e) => { e.preventDefault(); selectOption(l); }}
              onMouseEnter={() => setHi(i)}
            >
              <span className="aur-combo-name">{l.descripcion}</span>
              {l.codigo && <span className="aur-combo-meta">{l.codigo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
