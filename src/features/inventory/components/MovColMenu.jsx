import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MOV_COLUMNS } from '../lib/bodega';

// Menú de visibilidad de columnas de la tabla de movimientos. Portaled,
// cierra por click afuera o Escape. No deja desactivar la última columna.
export default function MovColMenu({ x, y, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="bgm-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="bgm-col-menu-title">Columnas visibles</div>
      {MOV_COLUMNS.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label key={col.key} className={`bgm-col-menu-item${isLast ? ' bgm-col-menu-item--disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)} />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body
  );
}
