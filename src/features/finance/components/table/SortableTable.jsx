// Primitivas compartidas de las tablas de finance (Compradores, Ingresos,
// Ofertas de crédito). Antes cada página tenía su propia copia byte a byte de
// `ColMenu` y del popover de filtro de columna (~180 líneas triplicadas). Acá
// viven una sola vez; las páginas sólo aportan su `COLUMNS` y su `getColVal`.
//
// Mejoras de accesibilidad respecto de las copias inline:
//   - El popover cierra con Escape sin importar dónde esté el foco (antes el
//     handler vivía en el <input>, así que Escape no cerraba si el foco se iba).
//   - El primer input del rango recibe foco al abrir (antes sólo el de texto).

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX } from 'react-icons/fi';

// ── Menú de columnas visibles (checkbox dropdown portaleado) ─────────────────
export function ColMenu({ x, y, columns, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const visibleCount = Object.values(visibleCols).filter(Boolean).length;

  return createPortal(
    <div ref={menuRef} className="sh-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="sh-col-menu-title">Columnas visibles</div>
      {columns.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && visibleCount === 1;
        return (
          <label key={col.key} className={`sh-col-menu-item${isLast ? ' sh-col-menu-item--disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)} />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body,
  );
}

// ── Popover de filtro de una columna (texto / número / fecha) ────────────────
// Props:
//   popover  · { field, type, x, y }
//   value    · objeto de filtro actual ({ text } | { from, to }) o undefined
//   onChange · (key, val) => void  — key ∈ 'text' | 'from' | 'to'
//   onClear  · () => void          — limpia el filtro de esta columna
//   onClose  · () => void
export function ColFilterPopover({ popover, value, onChange, onClear, onClose }) {
  const firstRef = useRef(null);
  const { field, type, x, y } = popover;
  const isText = type === 'text';

  // Escape global: cierra el popover sin depender de dónde esté el foco.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Foco al primer input cada vez que el popover apunta a otra columna.
  useEffect(() => { firstRef.current?.focus(); }, [field]);

  const hasVal = isText ? !!value?.text : (!!value?.from || !!value?.to);
  const clearAndClose = () => { onClear(); onClose(); };

  return createPortal(
    <>
      <div className="sh-filter-backdrop" onClick={onClose} />
      <div className="sh-filter-popover" style={{ left: x, top: y }} role="dialog" aria-label="Filtrar columna">
        {isText ? (
          <>
            <FiFilter size={13} className="sh-filter-icon" />
            <input
              ref={firstRef}
              className="sh-filter-input"
              placeholder="Filtrar…"
              value={value?.text || ''}
              onChange={e => onChange('text', e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onClose(); }}
            />
            {hasVal && (
              <button className="sh-filter-clear" onClick={clearAndClose} aria-label="Limpiar filtro">
                <FiX size={13} />
              </button>
            )}
          </>
        ) : (
          <div className="sh-filter-range">
            <span className="sh-filter-range-label">De</span>
            <input
              ref={firstRef}
              className="sh-filter-input sh-filter-input-range"
              type={type === 'date' ? 'date' : 'number'}
              value={value?.from || ''}
              onChange={e => onChange('from', e.target.value)}
            />
            <span className="sh-filter-range-label">A</span>
            <input
              className="sh-filter-input sh-filter-input-range"
              type={type === 'date' ? 'date' : 'number'}
              value={value?.to || ''}
              onChange={e => onChange('to', e.target.value)}
            />
            {hasVal && (
              <button className="sh-filter-clear" onClick={clearAndClose} aria-label="Limpiar filtro">
                <FiX size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
