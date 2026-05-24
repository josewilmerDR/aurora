import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── UserCombo ────────────────────────────────────────────────────────────────
// Input con autocomplete sobre `users`. Sustituye los 4 <input type="text">
// para Operario/Encargado finca/Encargado bodega/Sup. aplicaciones en
// AplicadaModal — antes el usuario tipeaba "Jose Pérez" / "Jose Perez" / "JP"
// creando tres variantes en el historial para la misma persona y rompiendo
// cualquier reportería futura de productividad por aplicador.
//
// El componente NO obliga a elegir del catálogo: permite texto libre para
// asesor externo, regente externo, etc. Cuando el usuario sí elige una opción
// del dropdown, el `userId` companion queda registrado para que el backend
// pueda persistirlo (hoy lo ignora, queda futureproof) y reconciliar por id.
//
// Sigue el mismo patrón visual que el combo de productos en CedulaNuevaModal:
// portal del dropdown a document.body con posición absoluta calculada por
// getBoundingClientRect, cierre en click-outside / scroll / resize / ESC.
//
// Extraído de CedulasAplicacion.jsx (Fase 2 del refactor del punto #7 del
// audit UX/UI). Vive como componente propio porque AplicadaModal lo importa.
export default function UserCombo({ id, value, userId, users, onChange, placeholder, maxLength = 200 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef = useRef(null);

  const filtered = useMemo(() => {
    const q = (value || '').trim().toLowerCase();
    const list = users || [];
    const matches = q
      ? list.filter(u => (u.nombre || '').toLowerCase().includes(q))
      : list;
    return [...matches]
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'))
      .slice(0, 50);
  }, [users, value]);

  const openDropdown = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onMouseDown = (e) => {
      if (!e.target.closest('.aur-combo-input-wrap') && !e.target.closest('.aur-combo-dropdown')) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    // Capture phase para detectar scroll en cualquier ancestro (el modal-content
    // tiene su propio overflow). Sin esto el dropdown queda flotando huérfano
    // cuando el usuario hace scroll dentro del modal.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const handleInputChange = (e) => {
    // Tipear = texto libre. Limpiamos el userId companion para no quedarnos
    // con un id stale apuntando a otro usuario.
    onChange(e.target.value, null);
    if (!open) openDropdown();
  };

  const selectUser = (u) => {
    onChange(u.nombre || '', u.id);
    setOpen(false);
  };

  return (
    <div className="aur-combo ucm-row">
      <div className="aur-combo-input-wrap" ref={wrapRef}>
        <input
          id={id}
          className="aur-combo-input"
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={openDropdown}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
        />
        {userId && (
          <span className="ucm-picked" title="Vinculado al directorio">✓</span>
        )}
      </div>
      {open && createPortal(
        <div
          className="aur-combo-dropdown"
          style={{ top: pos.top, left: pos.left, minWidth: pos.width }}
        >
          {filtered.length === 0 ? (
            <p className="aur-combo-empty">
              {(value || '').trim()
                ? 'Sin coincidencias — se guardará como texto libre.'
                : 'No hay usuarios en el directorio.'}
            </p>
          ) : (
            filtered.map(u => (
              <button
                type="button"
                key={u.id}
                className={`aur-combo-option${u.id === userId ? ' aur-combo-option--active' : ''}`}
                onMouseDown={e => { e.preventDefault(); selectUser(u); }}
              >
                <span className="aur-combo-name">{u.nombre || '—'}</span>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
