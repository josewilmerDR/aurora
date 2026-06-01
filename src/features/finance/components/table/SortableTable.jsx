// Menú kebab de fila compartido por las páginas de finance (Ingresos,
// Compradores, Ofertas de crédito), que usan AuroraDataTable y aportan este
// kebab vía su prop `trailingCell`.
//
// Antes este archivo también exportaba ColMenu y ColFilterPopover (el menú de
// columnas y el popover de filtro de las tablas hechas a mano). Esas páginas
// migraron a AuroraDataTable —que trae su propio menú de columnas y filtro—,
// así que solo queda el kebab de acciones por fila.

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── Menú kebab de fila (acciones por registro, portaleado) ───────────────────
// Accesible: role=menu / role=menuitem, enfoca el primer item al abrir y cierra
// con Escape. El cierre por click-fuera lo maneja el listener `pointerdown` del
// padre (el dropdown frena la propagación con onPointerDown).
// Props:
//   pos    · { top, right } — coordenadas fixed calculadas por el padre
//   items  · [{ icon, label, onClick, danger?, disabled? }]
//   onClose· () => void
export function RowKebabMenu({ pos, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="hist-kebab-dropdown hist-kebab-dropdown-fixed"
      style={{ top: pos.top, right: pos.right }}
      onPointerDown={e => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`hist-kebab-item${it.danger ? ' hist-kebab-item-danger' : ''}`}
          onClick={it.onClick}
          disabled={it.disabled}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
