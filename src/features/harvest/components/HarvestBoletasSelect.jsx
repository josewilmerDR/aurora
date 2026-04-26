import { useMemo } from 'react';
import { FiX } from 'react-icons/fi';

// Multi-select para boletas de cosecha (CosechaDespachos): chips removibles
// arriba + lista scroll abajo. Excluye boletas ya usadas en otros despachos.
export default function HarvestBoletasSelect({ registros, selected, onChange, usedIds = new Set() }) {
  const filtered = useMemo(
    () => registros.filter(r => !usedIds.has(r.id)),
    [registros, usedIds],
  );

  const toggle = (reg) => {
    const already = selected.find(s => s.id === reg.id);
    if (already) {
      onChange(selected.filter(s => s.id !== reg.id));
    } else {
      onChange([...selected, {
        id: reg.id,
        consecutivo: reg.consecutivo,
        cantidad: reg.cantidad ?? null,
        unidad: reg.unidad ?? '',
      }]);
    }
  };

  const removeChip = (id) => onChange(selected.filter(s => s.id !== id));

  return (
    <div className="harvest-boletas">
      {selected.length > 0 && (
        <div className="harvest-boletas-chips">
          {selected.map(s => (
            <span key={s.id} className="harvest-boleta-chip">
              {s.consecutivo}
              {s.cantidad != null && (
                <span className="harvest-boleta-chip-qty">
                  · {Number(s.cantidad).toLocaleString('es-ES')} {s.unidad}
                </span>
              )}
              <button
                type="button"
                className="harvest-boleta-chip-remove"
                onClick={() => removeChip(s.id)}
                aria-label="Quitar boleta"
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="harvest-boletas-list">
        {filtered.length === 0 ? (
          <span className="harvest-boletas-empty">Sin boletas de cosecha disponibles</span>
        ) : (
          filtered.map(reg => {
            const checked = !!selected.find(s => s.id === reg.id);
            return (
              <div
                key={reg.id}
                className={`harvest-boleta-item${checked ? ' is-checked' : ''}`}
                onClick={() => toggle(reg)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(reg)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="harvest-boleta-consec">{reg.consecutivo}</span>
                {reg.cantidad != null && (
                  <span className="harvest-boleta-qty">
                    {Number(reg.cantidad).toLocaleString('es-ES')} {reg.unidad || ''}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
