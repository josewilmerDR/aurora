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

// Compara una fila contra su baseline de sesión (estado al abrir el modal) para
// detectar si fue editada DURANTE esta sesión. Filas añadidas en la sesión tienen
// _baseline = null y siempre se consideran cambiadas.
function isRowChanged(row) {
  if (!row._baseline) return true;
  if (row._baseline.productoId !== row.productoId) return true;
  const origCant = row._baseline.cantidadPorHa;
  const newCant  = parseFloat(row.cantidadPorHa);
  const origFinite = Number.isFinite(origCant);
  const newFinite  = Number.isFinite(newCant);
  if (origFinite !== newFinite) return true;
  if (!origFinite) return false;
  return Math.abs(origCant - newCant) > 1e-9;
}

function MezclaListaModal({ mode = 'mezcla-lista', cedula, task, productos, currentUser, onConfirm, onClose }) {
  const isEditMode = mode === 'edit';

  // Fuente inicial: estado guardado actual. Prioridad:
  //   1. productosAplicados (ediciones previas o ajustes en mezcla lista)
  //   2. productosOriginales (snapshot inmutable de la receta original)
  //   3. task.activity.productos (fallback para cédulas muy viejas sin snapshot)
  //
  // Cada fila carga un `_baseline` con el estado al abrir el modal, para que
  // isRowChanged detecte sólo ediciones de ESTA sesión (no las heredadas de una
  // sesión previa). El `productoOriginalId` se mantiene apuntando al canónico en
  // productosOriginales para preservar el audit trail A→C vía la sustitución.
  const productosInicial = useMemo(() => {
    const aplicados  = Array.isArray(cedula?.productosAplicados)  ? cedula.productosAplicados  : [];
    const originales = Array.isArray(cedula?.productosOriginales) ? cedula.productosOriginales : [];
    const src = aplicados.length > 0
      ? aplicados
      : (originales.length > 0 ? originales : (task?.activity?.productos || []));
    const loadedFromAplicados = aplicados.length > 0;
    const originalesIds = new Set(originales.map(o => o.productoId).filter(Boolean));
    return src.map(p => {
      const rawCant = p.cantidadPorHa != null ? p.cantidadPorHa : (p.cantidad != null ? p.cantidad : null);
      const baselineCant = rawCant != null ? parseFloat(rawCant) : null;
      // canonicalOriginalId: apunta a la entrada en productosOriginales si la fila deriva
      // de (o es) un producto originalmente recetado. Se preserva a través de sesiones.
      let canonicalOriginalId;
      if (loadedFromAplicados) {
        // Si la fila existente ya trae un productoOriginalId que apunta a un producto
        // canónico, conservarlo. Si no, y el productoId actual está en originales,
        // la fila es "misma receta, quizá ajuste de dosis" → productoOriginalId = productoId.
        if (p.productoOriginalId && originalesIds.has(p.productoOriginalId)) {
          canonicalOriginalId = p.productoOriginalId;
        } else if (originalesIds.has(p.productoId)) {
          canonicalOriginalId = p.productoId;
        } else {
          canonicalOriginalId = ''; // fila añadida que no está en el plan original
        }
      } else {
        canonicalOriginalId = p.productoId || '';
      }
      return {
        productoId: p.productoId || '',
        nombreComercial: p.nombreComercial || '',
        cantidadPorHa: rawCant != null ? String(rawCant) : '',
        unidad: p.unidad || '',
        // Preservar motivoCambio heredado de sesiones previas; se reenvía al
        // backend aunque esta sesión no modifique la fila, para no perder la
        // razón del cambio ya registrada.
        motivoCambio: loadedFromAplicados ? (p.motivoCambio || '') : '',
        productoOriginalId: canonicalOriginalId,
        _baseline: {
          productoId: p.productoId || '',
          cantidadPorHa: Number.isFinite(baselineCant) ? baselineCant : null,
        },
      };
    });
  }, [cedula, task]);

  const [nombre, setNombre] = useState(currentUser?.nombre || '');
  const [hayCambios, setHayCambios] = useState(isEditMode); // en edit mode siempre activo
  const [productosEdit, setProductosEdit] = useState(productosInicial);
  const [observaciones, setObservaciones] = useState(
    (isEditMode && typeof cedula?.observacionesMezcla === 'string') ? cedula.observacionesMezcla : ''
  );
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
      _baseline: null, // añadida en esta sesión → siempre "changed"
    }]);
  };

  // Filas modificadas o añadidas durante ESTA sesión del modal.
  const rowsChanged = useMemo(() => {
    if (!hayCambios) return [];
    return productosEdit.map((r, i) => isRowChanged(r) ? i : -1).filter(i => i >= 0);
  }, [productosEdit, hayCambios]);

  const huboCambiosReal = hayCambios && (
    rowsChanged.length > 0 || productosEdit.length !== productosInicial.length
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
    // En edit mode siempre enviamos productosAplicados (es el objetivo de la acción);
    // en mezcla-lista sólo si el usuario activó el toggle y realmente hubo cambios.
    const shouldSendProductos = isEditMode || (hayCambios && huboCambiosReal);
    if (shouldSendProductos) {
      payload.productosAplicados = productosEdit.map((r) => {
        const out = {
          productoId: r.productoId,
          cantidadPorHa: parseFloat(r.cantidadPorHa),
        };
        // Enviar motivoCambio si la fila lo trae (tanto editado en esta sesión
        // como heredado de una edición previa).
        if (r.motivoCambio) {
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
            {isEditMode ? 'Editar Cédula' : 'Mezcla Lista'} · {cedula?.consecutivo || ''}
          </span>
          <div className="ca-preview-toolbar-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              <FiCheckCircle size={14} />
              {submitting
                ? 'Procesando…'
                : isEditMode ? 'Guardar cambios' : 'Confirmar mezcla'}
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
            {isEditMode
              ? 'Los cambios se guardarán en la cédula y quedará registro de quién los realizó. El inventario se descontará más adelante, al marcar la mezcla como lista.'
              : 'Al confirmar, se descontará del inventario la cantidad de cada producto según las hectáreas a aplicar. Si un producto no está disponible en bodega o es necesario ajustar la dosis, activá la edición antes de confirmar.'}
          </p>

          {error && <div className="nca-error">{error}</div>}

          <label className="mla-field">
            <span className="mla-label">
              {isEditMode ? 'Nombre de quien edita' : 'Nombre de quien prepara la mezcla'}
            </span>
            <input
              type="text"
              className="nca-input"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Nombre"
            />
          </label>

          {!isEditMode && (
            <label className="mla-toggle">
              <input
                type="checkbox"
                checked={hayCambios}
                onChange={e => setHayCambios(e.target.checked)}
              />
              <span>Se realizaron cambios respecto al programa (sustitución o ajuste de dosis)</span>
            </label>
          )}

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
