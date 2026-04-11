import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiCheckCircle, FiTrash2, FiPlusCircle, FiAlertTriangle } from 'react-icons/fi';

const MAX_OBS_LEN = 500;
const MAX_PRODUCTOS = 50;
const MAX_CANTIDAD_POR_HA = 100000;

const MOTIVO_LABELS = {
  sustitucion: 'Sustitución por falta de stock',
  ajuste_dosis: 'Ajuste de dosis',
  otro: 'Otro',
};

// Compara una fila editable contra el array de productosOriginales para saber
// si fue modificada (producto distinto o dosis distinta).
function isRowChanged(row, originales) {
  if (!row.productoOriginalId && !originales.some(o => o.productoId === row.productoId)) {
    return true; // producto añadido, no estaba en el original
  }
  const origRef = row.productoOriginalId
    ? originales.find(o => o.productoId === row.productoOriginalId)
    : originales.find(o => o.productoId === row.productoId);
  if (!origRef) return true;
  if (origRef.productoId !== row.productoId) return true;
  const origCant = parseFloat(origRef.cantidadPorHa);
  const newCant  = parseFloat(row.cantidadPorHa);
  if (!Number.isFinite(origCant) || !Number.isFinite(newCant)) return true;
  return Math.abs(origCant - newCant) > 1e-9;
}

function MezclaListaModal({ cedula, task, productos, currentUser, onConfirm, onClose }) {
  // Fuente inicial: productos originales de la cédula (snapshot) o del plan del task
  const productosInicial = useMemo(() => {
    const src = (Array.isArray(cedula?.productosOriginales) && cedula.productosOriginales.length > 0)
      ? cedula.productosOriginales
      : (task?.activity?.productos || []);
    return src.map(p => ({
      productoId: p.productoId || '',
      nombreComercial: p.nombreComercial || '',
      cantidadPorHa: p.cantidadPorHa != null ? String(p.cantidadPorHa) : (p.cantidad != null ? String(p.cantidad) : ''),
      unidad: p.unidad || '',
      motivoCambio: '',
      productoOriginalId: p.productoId || '',
    }));
  }, [cedula, task]);

  // Lista de productoIds originales para detectar cambios
  const originalesRef = useMemo(() => {
    const src = (Array.isArray(cedula?.productosOriginales) && cedula.productosOriginales.length > 0)
      ? cedula.productosOriginales
      : (task?.activity?.productos || []);
    return src.map(p => ({
      productoId: p.productoId || '',
      cantidadPorHa: p.cantidadPorHa != null ? parseFloat(p.cantidadPorHa) : (p.cantidad != null ? parseFloat(p.cantidad) : null),
    }));
  }, [cedula, task]);

  const [nombre, setNombre] = useState(currentUser?.nombre || '');
  const [hayCambios, setHayCambios] = useState(false);
  const [productosEdit, setProductosEdit] = useState(productosInicial);
  const [observaciones, setObservaciones] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const catalogoMap = useMemo(() => {
    const m = {};
    for (const p of productos || []) m[p.id] = p;
    return m;
  }, [productos]);

  const updateRow = (idx, patch) => {
    setProductosEdit(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const onChangeProducto = (idx, newProductoId) => {
    const cat = catalogoMap[newProductoId];
    if (!cat) return;
    updateRow(idx, {
      productoId: newProductoId,
      nombreComercial: cat.nombreComercial || '',
      unidad: cat.unidad || '',
    });
  };

  const removeRow = (idx) => {
    setProductosEdit(prev => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    if (productosEdit.length >= MAX_PRODUCTOS) return;
    setProductosEdit(prev => [...prev, {
      productoId: '',
      nombreComercial: '',
      cantidadPorHa: '',
      unidad: '',
      motivoCambio: 'sustitucion',
      productoOriginalId: '',
    }]);
  };

  // Filas que difieren del plan original — necesitan motivoCambio
  const rowsChanged = useMemo(() => {
    if (!hayCambios) return [];
    return productosEdit.map((r, i) => isRowChanged(r, originalesRef) ? i : -1).filter(i => i >= 0);
  }, [productosEdit, originalesRef, hayCambios]);

  const huboCambiosReal = hayCambios && (
    rowsChanged.length > 0 || productosEdit.length !== originalesRef.length
  );

  const handleSubmit = async () => {
    setError('');
    // Validaciones cliente
    if (hayCambios) {
      if (productosEdit.length === 0) {
        setError('Agregue al menos un producto.');
        return;
      }
      if (productosEdit.length > MAX_PRODUCTOS) {
        setError(`Máximo ${MAX_PRODUCTOS} productos.`);
        return;
      }
      for (let i = 0; i < productosEdit.length; i++) {
        const r = productosEdit[i];
        if (!r.productoId) {
          setError(`Seleccione un producto en la fila ${i + 1}.`);
          return;
        }
        const c = parseFloat(r.cantidadPorHa);
        if (!Number.isFinite(c) || c <= 0 || c > MAX_CANTIDAD_POR_HA) {
          setError(`Dosis/Ha inválida en la fila ${i + 1}.`);
          return;
        }
      }
      // Filas modificadas deben llevar motivo
      for (const i of rowsChanged) {
        if (!productosEdit[i].motivoCambio) {
          setError(`Seleccione un motivo de cambio en la fila ${i + 1}.`);
          return;
        }
      }
    }
    if (observaciones.length > MAX_OBS_LEN) {
      setError(`Las observaciones no pueden exceder ${MAX_OBS_LEN} caracteres.`);
      return;
    }

    const payload = { nombre: nombre || null };
    if (hayCambios && huboCambiosReal) {
      payload.productosAplicados = productosEdit.map((r, i) => {
        const out = {
          productoId: r.productoId,
          cantidadPorHa: parseFloat(r.cantidadPorHa),
        };
        if (rowsChanged.includes(i) && r.motivoCambio) {
          out.motivoCambio = r.motivoCambio;
        }
        if (r.productoOriginalId && r.productoOriginalId !== r.productoId) {
          out.productoOriginalId = r.productoOriginalId;
        }
        return out;
      });
    }
    if (observaciones.trim()) {
      payload.observacionesMezcla = observaciones.trim();
    }

    setSubmitting(true);
    try {
      await onConfirm(payload);
    } catch (e) {
      setError(e?.message || 'Error al procesar la mezcla.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="ca-preview-backdrop" onClick={submitting ? undefined : onClose}>
      <div className="ca-preview-container mla-modal" onClick={e => e.stopPropagation()}>
        <div className="ca-preview-toolbar">
          <span className="ca-preview-toolbar-title">
            Mezcla Lista · {cedula?.consecutivo || ''}
          </span>
          <div className="ca-preview-toolbar-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              <FiCheckCircle size={14} />
              {submitting ? 'Procesando…' : 'Confirmar mezcla'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              <FiX size={15} /> Cancelar
            </button>
          </div>
        </div>

        <div className="mla-body">
          <p className="mla-info">
            Al confirmar, se descontará del inventario la cantidad de cada producto según
            las hectáreas a aplicar. Si un producto no está disponible en bodega o es
            necesario ajustar la dosis, activá la edición antes de confirmar.
          </p>

          {error && <div className="nca-error">{error}</div>}

          <label className="mla-field">
            <span className="mla-label">Nombre de quien prepara la mezcla</span>
            <input
              type="text"
              className="nca-input"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Nombre"
            />
          </label>

          <label className="mla-toggle">
            <input
              type="checkbox"
              checked={hayCambios}
              onChange={e => setHayCambios(e.target.checked)}
            />
            <span>Se realizaron cambios respecto al programa (sustitución o ajuste de dosis)</span>
          </label>

          <div className="mla-productos-section">
            <span className="mla-label">Productos {hayCambios ? '(editables)' : ''}</span>
            <table className="mla-productos-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="ca-col-num">Dosis / Ha</th>
                  <th>Unidad</th>
                  {hayCambios && <th>Motivo (si cambió)</th>}
                  {hayCambios && <th></th>}
                </tr>
              </thead>
              <tbody>
                {productosEdit.map((row, idx) => {
                  const changed = hayCambios && rowsChanged.includes(idx);
                  return (
                    <tr key={idx} className={changed ? 'mla-row-changed' : ''}>
                      <td>
                        {hayCambios ? (
                          <select
                            className="nca-select"
                            value={row.productoId}
                            onChange={e => onChangeProducto(idx, e.target.value)}
                          >
                            <option value="">— Seleccionar —</option>
                            {productos.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.nombreComercial}
                                {p.stockActual != null ? ` · stock: ${p.stockActual}` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{row.nombreComercial || '—'}</span>
                        )}
                      </td>
                      <td className="ca-col-num">
                        {hayCambios ? (
                          <input
                            type="number"
                            className="nca-input nca-input-num"
                            min="0"
                            max={MAX_CANTIDAD_POR_HA}
                            step="any"
                            value={row.cantidadPorHa}
                            onChange={e => updateRow(idx, { cantidadPorHa: e.target.value })}
                          />
                        ) : (
                          <span>{row.cantidadPorHa || '—'}</span>
                        )}
                      </td>
                      <td>{row.unidad || '—'}</td>
                      {hayCambios && (
                        <td>
                          {changed ? (
                            <select
                              className="nca-select"
                              value={row.motivoCambio}
                              onChange={e => updateRow(idx, { motivoCambio: e.target.value })}
                            >
                              <option value="">— Motivo —</option>
                              <option value="sustitucion">{MOTIVO_LABELS.sustitucion}</option>
                              <option value="ajuste_dosis">{MOTIVO_LABELS.ajuste_dosis}</option>
                              <option value="otro">{MOTIVO_LABELS.otro}</option>
                            </select>
                          ) : (
                            <span className="mla-motivo-none">—</span>
                          )}
                        </td>
                      )}
                      {hayCambios && (
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger nca-remove-btn"
                            onClick={() => removeRow(idx)}
                            title="Quitar producto"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hayCambios && productosEdit.length < MAX_PRODUCTOS && (
              <button type="button" className="mla-add-btn" onClick={addRow}>
                <FiPlusCircle size={13} /> Agregar producto
              </button>
            )}
            {hayCambios && huboCambiosReal && (
              <div className="mla-warn">
                <FiAlertTriangle size={13} />
                <span>Se registrarán los cambios en el documento auditable de la cédula.</span>
              </div>
            )}
          </div>

          <label className="mla-field">
            <span className="mla-label">
              Observaciones de mezcla (opcional) · {observaciones.length}/{MAX_OBS_LEN}
            </span>
            <textarea
              className="mla-textarea"
              value={observaciones}
              onChange={e => setObservaciones(e.target.value.slice(0, MAX_OBS_LEN))}
              rows={3}
              placeholder="Ej: Producto X agotado en bodega, se sustituyó por Y. Dosis aumentada por alta población de plaga."
            />
          </label>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MezclaListaModal;
