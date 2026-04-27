import { useEffect, useMemo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Selector multi-despacho — patrón idéntico al BoletasSelect del módulo
// Despacho de Cosecha. Filtra por buyerId y excluye despachos ya ligados
// a otros ingresos (usedIds).
function DispatchesSelect({ buyerId, selected, onChange, usedIds = new Set(), excludeIncomeId = null }) {
  const apiFetch = useApiFetch();
  const [despachos, setDespachos] = useState([]);
  const [linkedIds, setLinkedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch('/api/cosecha/despachos').then(r => r.json()),
      apiFetch('/api/income').then(r => r.json()),
    ])
      .then(([dispatchData, incomeData]) => {
        if (cancelled) return;
        setDespachos(Array.isArray(dispatchData) ? dispatchData : []);
        const ids = new Set();
        for (const inc of Array.isArray(incomeData) ? incomeData : []) {
          if (excludeIncomeId && inc.id === excludeIncomeId) continue;
          if (Array.isArray(inc.despachoIds)) {
            for (const d of inc.despachoIds) if (d?.id) ids.add(d.id);
          }
          if (inc.despachoId) ids.add(inc.despachoId);
        }
        setLinkedIds(ids);
      })
      .catch(() => {
        if (!cancelled) { setDespachos([]); setLinkedIds(new Set()); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, excludeIncomeId]);

  const available = useMemo(() => {
    if (!buyerId) return [];
    return despachos.filter(d =>
      d.buyerId === buyerId &&
      d.estado !== 'anulado' &&
      !linkedIds.has(d.id) &&
      !usedIds.has(d.id),
    );
  }, [despachos, buyerId, linkedIds, usedIds]);

  const toggle = (d) => {
    const already = selected.find(s => s.id === d.id);
    if (already) {
      onChange(selected.filter(s => s.id !== d.id));
    } else {
      onChange([...selected, {
        id: d.id,
        consecutivo: d.consecutivo || '',
        cantidad: d.cantidad ?? null,
        unidad: d.unidad || '',
      }]);
    }
  };

  if (!buyerId) {
    return (
      <div className="fin-dispatch-empty">
        Seleccione un comprador primero para ver sus despachos disponibles.
      </div>
    );
  }

  return (
    <div className="fin-dispatch-wrap">
      {selected.length > 0 && (
        <div className="fin-dispatch-chips">
          {selected.map(s => (
            <span key={s.id} className="aur-chip fin-dispatch-chip">
              <span className="fin-dispatch-chip-id">{s.consecutivo || s.id}</span>
              {s.cantidad != null && (
                <span className="fin-dispatch-chip-qty">
                  {Number(s.cantidad).toLocaleString('es-ES')} {s.unidad}
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(selected.filter(x => x.id !== s.id))}
                className="aur-icon-btn aur-icon-btn--sm"
                aria-label={`Quitar despacho ${s.consecutivo || s.id}`}
              >
                <FiX size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="fin-dispatch-list">
        {loading ? (
          <span className="fin-dispatch-empty">Cargando despachos…</span>
        ) : available.length === 0 ? (
          <span className="fin-dispatch-empty">
            No hay despachos disponibles para este comprador.
          </span>
        ) : (
          available.map(d => {
            const checked = !!selected.find(s => s.id === d.id);
            return (
              <div
                key={d.id}
                className={`fin-dispatch-item${checked ? ' fin-dispatch-item--checked' : ''}`}
                onClick={() => toggle(d)}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(d)}
                  onClick={e => e.stopPropagation()}
                />
                <span className="fin-dispatch-consec">{d.consecutivo}</span>
                {d.cantidad != null && (
                  <span className="fin-dispatch-qty">
                    {Number(d.cantidad).toLocaleString('es-ES')} {d.unidad || ''}
                  </span>
                )}
                {d.loteNombre && (
                  <span className="fin-dispatch-lote">{d.loteNombre}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default DispatchesSelect;
