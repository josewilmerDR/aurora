import { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiCheckCircle, FiTrash2, FiPlusCircle, FiAlertTriangle, FiInfo, FiEdit2 } from 'react-icons/fi';

const MAX_NOMBRE_LEN = 48;
const MAX_OBS_LEN = 288;
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

  const [nombre, setNombre] = useState(
    (currentUser?.nombre || '').slice(0, MAX_NOMBRE_LEN)
  );
  const [hayCambios, setHayCambios] = useState(isEditMode); // en edit mode siempre activo
  const [productosEdit, setProductosEdit] = useState(productosInicial);
  const [observaciones, setObservaciones] = useState(() => {
    const raw = (isEditMode && typeof cedula?.observacionesMezcla === 'string')
      ? cedula.observacionesMezcla
      : '';
    return raw.slice(0, MAX_OBS_LEN);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Guardia contra doble submit: setSubmitting(true) es async, un doble click
  // rápido podría disparar onConfirm dos veces antes del primer re-render.
  const submittingRef = useRef(false);

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
    if (submittingRef.current) return;
    setError('');
    // Validación de nombre: tipo, trim, longitud máxima.
    const nombreTrim = typeof nombre === 'string' ? nombre.trim() : '';
    if (nombreTrim.length > MAX_NOMBRE_LEN) {
      setError(`El nombre no puede exceder ${MAX_NOMBRE_LEN} caracteres.`);
      return;
    }
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
    const obsTrim = observaciones.trim();
    if (obsTrim.length > MAX_OBS_LEN) {
      setError(`Las observaciones no pueden exceder ${MAX_OBS_LEN} caracteres.`);
      return;
    }

    const payload = { nombre: nombreTrim || null };
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
    if (obsTrim) {
      payload.observacionesMezcla = obsTrim;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm(payload);
    } catch (e) {
      setError(e?.message || 'Error al procesar la mezcla.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={submitting ? undefined : onClose}>
      <div className="aur-modal aur-modal--lg mla-modal" onPointerDown={e => e.stopPropagation()}>

        <div className="aur-modal-header">
          <span className={`aur-modal-icon${isEditMode ? ' aur-modal-icon--warn' : ''}`}>
            {isEditMode ? <FiEdit2 size={14} /> : <FiCheckCircle size={14} />}
          </span>
          <span className="aur-modal-title">
            {isEditMode ? 'Editar cédula' : 'Mezcla lista'}
            {cedula?.consecutivo && <span className="mla-modal-subtitle"> · {cedula.consecutivo}</span>}
          </span>
        </div>

        <div className="aur-modal-content">
          <div className="aur-banner aur-banner--info">
            <FiInfo size={14} />
            <span>
              {isEditMode
                ? 'Los cambios se guardarán en la cédula y quedará registro de quién los realizó. El inventario se descontará más adelante, al marcar la mezcla como lista.'
                : 'Al confirmar, se descontará del inventario la cantidad de cada producto según las hectáreas a aplicar. Si un producto no está disponible o es necesario ajustar la dosis, activá la edición antes de confirmar.'}
            </span>
          </div>

          {error && (
            <div className="aur-banner aur-banner--danger">
              <FiAlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="mla-nombre">
                {isEditMode ? 'Nombre de quien edita' : 'Nombre de quien prepara'}
              </label>
              <input
                id="mla-nombre"
                type="text"
                className="aur-input"
                value={nombre}
                onChange={e => setNombre(e.target.value.slice(0, MAX_NOMBRE_LEN))}
                maxLength={MAX_NOMBRE_LEN}
                placeholder="Nombre"
                autoComplete="off"
              />
            </div>

            {!isEditMode && (
              <div className="aur-row">
                <span className="aur-row-label">Cambios al programa</span>
                <label className="aur-toggle">
                  <input
                    type="checkbox"
                    checked={hayCambios}
                    onChange={e => setHayCambios(e.target.checked)}
                  />
                  <span className="aur-toggle-track">
                    <span className="aur-toggle-thumb" />
                  </span>
                  <span className="aur-toggle-label">
                    {hayCambios ? 'Se hicieron cambios' : 'Sin cambios respecto al programa'}
                  </span>
                </label>
              </div>
            )}
          </div>

          <section className="mla-section">
            <div className="aur-section-header">
              <span className="aur-section-num">⚗</span>
              <h3>Productos {hayCambios ? '· editables' : ''}</h3>
              <span className="aur-section-count">{productosEdit.length}</span>
            </div>

            <table className="aur-table mla-productos-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="aur-td-num">Dosis / Ha</th>
                  <th>Unidad</th>
                  {hayCambios && <th>Motivo (si cambió)</th>}
                  {hayCambios && <th aria-hidden="true"></th>}
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
                            className="aur-select"
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
                      <td className="aur-td-num">
                        {hayCambios ? (
                          <input
                            type="number"
                            className="aur-input aur-input--num"
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
                              className="aur-select"
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
                            className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
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
              <button type="button" className="aur-chip aur-chip--ghost mla-add-btn" onClick={addRow}>
                <FiPlusCircle size={13} /> Agregar producto
              </button>
            )}
            {hayCambios && huboCambiosReal && (
              <div className="aur-banner aur-banner--warn">
                <FiAlertTriangle size={13} />
                <span>Se registrarán los cambios en el documento auditable de la cédula.</span>
              </div>
            )}
          </section>

          <div className="aur-field">
            <label className="aur-field-label" htmlFor="mla-obs">
              Observaciones de mezcla (opcional)
              <span className="aur-field-hint">{observaciones.length}/{MAX_OBS_LEN}</span>
            </label>
            <textarea
              id="mla-obs"
              className="aur-textarea"
              value={observaciones}
              onChange={e => setObservaciones(e.target.value.slice(0, MAX_OBS_LEN))}
              maxLength={MAX_OBS_LEN}
              rows={3}
              placeholder="Ej. Producto X agotado en bodega, se sustituyó por Y. Dosis aumentada por alta población de plaga."
            />
          </div>
        </div>

        <div className="aur-modal-actions">
          <button
            type="button"
            className="aur-btn-text"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="aur-btn-pill"
            onClick={handleSubmit}
            disabled={submitting}
          >
            <FiCheckCircle size={14} />
            {submitting
              ? 'Procesando…'
              : isEditMode ? 'Guardar cambios' : 'Confirmar mezcla'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default MezclaListaModal;
