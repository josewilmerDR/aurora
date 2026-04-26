import { useState, useMemo } from 'react';
import { useApiFetch } from '../../../hooks/useApiFetch';

function TomaFisicaModal({ productos, onClose, onSuccess }) {
  const apiFetch = useApiFetch();
  const [stocks, setStocks] = useState(() => {
    const map = {};
    productos.forEach(p => { map[p.id] = String(p.stockActual ?? 0); });
    return map;
  });
  const [nota, setNota] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const filteredProductos = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return productos;
    return productos.filter(p =>
      p.nombreComercial?.toLowerCase().includes(q) ||
      p.idProducto?.toLowerCase().includes(q) ||
      p.ingredienteActivo?.toLowerCase().includes(q)
    );
  }, [productos, search]);

  const cambios = useMemo(() => {
    return productos.filter(p => {
      const nuevo = parseFloat(stocks[p.id]);
      return !isNaN(nuevo) && Math.abs(nuevo - (p.stockActual ?? 0)) >= 0.001;
    });
  }, [stocks, productos]);

  const handleStockChange = (id, value) => {
    if (value === '' || value === '-') { setStocks(prev => ({ ...prev, [id]: '' })); return; }
    const n = parseFloat(value);
    if (isNaN(n) || n < 0 || n > 32768) return;
    setStocks(prev => ({ ...prev, [id]: value }));
  };

  const getDiff = (p) => {
    const nuevo = parseFloat(stocks[p.id]);
    if (isNaN(nuevo)) return null;
    const diff = nuevo - (p.stockActual ?? 0);
    if (Math.abs(diff) < 0.001) return null;
    return diff;
  };

  const handleSubmit = async () => {
    if (saving) return;
    if (!nota.trim()) {
      setError('La nota explicativa es obligatoria.');
      return;
    }
    if (nota.length > 288) {
      setError('La nota no puede exceder 288 caracteres.');
      return;
    }
    if (cambios.length === 0) {
      setError('No hay diferencias que ajustar. Modifica al menos un valor.');
      return;
    }
    const outOfRange = cambios.find(p => {
      const n = parseFloat(stocks[p.id]);
      return isNaN(n) || n < 0 || n > 32768;
    });
    if (outOfRange) {
      setError(`Stock fuera de rango en "${outOfRange.nombreComercial}" (0–32768).`);
      return;
    }

    const ajustes = cambios.map(p => ({
      productoId: p.id,
      stockAnterior: p.stockActual ?? 0,
      stockNuevo: parseFloat(stocks[p.id]),
    }));

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/inventario/ajuste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota: nota.trim(), ajustes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar');
      onSuccess(data.ajustados);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="aur-modal-backdrop" onPointerDown={onClose}>
      <div className="modal-content toma-fisica-modal" onPointerDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Toma Física de Inventario</h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <p className="toma-fisica-desc">
          Ingresa las cantidades reales encontradas en bodega. Solo los productos con diferencia serán ajustados.
        </p>

        <div className="toma-fisica-nota-wrap">
          <label className="toma-fisica-label">
            Nota explicativa <span className="toma-required">*</span>
          </label>
          <textarea
            className="toma-fisica-nota"
            maxLength={288}
            placeholder="Ej: Toma física mensual realizada el 15/03/2026. Se encontraron diferencias por merma en almacenamiento…"
            value={nota}
            onChange={e => setNota(e.target.value)}
            rows={3}
          />
        </div>

        <div className="toma-fisica-search-wrap">
          <input
            type="text"
            className="product-search-input"
            placeholder="Buscar producto…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {cambios.length > 0 && (
            <span className="toma-cambios-badge">{cambios.length} cambio{cambios.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="toma-fisica-table-wrap">
          <table className="toma-fisica-table">
            <thead>
              <tr>
                <th className="col-tf-id">ID</th>
                <th className="col-tf-name">Producto</th>
                <th className="col-tf-unit">Unidad</th>
                <th className="col-tf-actual">Stock actual</th>
                <th className="col-tf-nuevo">Stock físico</th>
                <th className="col-tf-diff">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filteredProductos.map(p => {
                const diff = getDiff(p);
                const isChanged = diff !== null;
                return (
                  <tr key={p.id} className={isChanged ? 'toma-row-changed' : ''}>
                    <td><span className="product-id-tag">{p.idProducto}</span></td>
                    <td className="col-tf-name-cell">
                      <div className="toma-nombre">{p.nombreComercial}</div>
                      <div className="toma-ingrediente">{p.ingredienteActivo}</div>
                    </td>
                    <td className="toma-center">{p.unidad}</td>
                    <td className="toma-center toma-stock-actual">{p.stockActual ?? 0}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="32768"
                        step="0.01"
                        className="toma-stock-input"
                        value={stocks[p.id] ?? ''}
                        onChange={e => handleStockChange(p.id, e.target.value)}
                      />
                    </td>
                    <td className="toma-center">
                      {isChanged && (
                        <span className={`toma-diff ${diff > 0 ? 'toma-diff-pos' : 'toma-diff-neg'}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredProductos.length === 0 && (
            <p className="empty-state">Sin resultados.</p>
          )}
        </div>

        {error && <p className="toma-error">{error}</p>}

        <div className="toma-fisica-footer">
          <button className="aur-btn-text" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="aur-btn-pill"
            onClick={handleSubmit}
            disabled={saving || cambios.length === 0}
          >
            {saving ? 'Guardando…' : `Aplicar ajuste${cambios.length > 0 ? ` (${cambios.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TomaFisicaModal;
