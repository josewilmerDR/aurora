import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiPlusCircle, FiTrash2, FiSearch, FiEye, FiAlertTriangle } from 'react-icons/fi';

// Frontend validation limits
const MAX_ACTIVITY_LEN = 64;
const MAX_TECNICO_LEN = 48;
const MAX_FUTURE_DAYS = 1825; // tope duro ~5 años
const WARN_FUTURE_DAYS = 14;  // umbral de alerta "fecha inusual"

const addDaysYmd = (days) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

function CedulaNuevaModal({ lotes, grupos, siembras, productos, calibraciones, apiFetch, onSuccess, onClose, onPreviewDraft }) {
  const [form, setForm] = useState({
    activityName: '',
    fecha: new Date().toISOString().split('T')[0],
    tecnicoResponsable: '',
    loteId: '',
    calibracionId: '',
    selectedBloques: [],
    productos: [],
  });
  const [prodSearch, setProdSearch] = useState('');
  const [prodOpen, setProdOpen] = useState(false);
  const [prodDropdownPos, setProdDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const [activeIdx, setActiveIdx] = useState(-1);
  const prodInputWrapRef = useRef(null);
  const prodInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const cantidadRefs = useRef({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── Plantillas ────────────────────────────────────────────────────────────
  const [plantillas, setPlantillas] = useState([]);
  const [savingPlantilla, setSavingPlantilla] = useState(false);
  const [plantillaSaved, setPlantillaSaved] = useState(false);

  useEffect(() => {
    apiFetch('/api/cedula-templates').then(r => r.json()).then(setPlantillas).catch(() => {});
  }, []);

  const aplicarPlantilla = (p) => {
    if (!p || !Array.isArray(p.productos)) return;
    const validProds = p.productos
      .map(tp => {
        const cat = productos.find(pr => pr.id === tp.productoId);
        if (!cat) return null;
        return {
          productoId: cat.id,
          nombreComercial: cat.nombreComercial,
          cantidadPorHa: tp.cantidadPorHa ?? '',
          unidad: cat.unidad || tp.unidad || '',
        };
      })
      .filter(Boolean);
    setForm(prev => ({ ...prev, activityName: (p.nombre || '').slice(0, MAX_ACTIVITY_LEN), productos: validProds }));
  };

  const guardarComoPlantilla = async () => {
    if (!form.activityName.trim()) return;
    setSavingPlantilla(true);
    try {
      const res = await apiFetch('/api/cedula-templates', {
        method: 'POST',
        body: JSON.stringify({
          nombre: form.activityName.trim(),
          productos: form.productos.map(p => ({
            productoId: p.productoId,
            nombreComercial: p.nombreComercial,
            cantidadPorHa: parseFloat(p.cantidadPorHa) || 0,
            unidad: p.unidad,
          })),
        }),
      });
      if (!res.ok) throw new Error();
      const nueva = await res.json();
      setPlantillas(prev => [...prev, nueva]);
      setPlantillaSaved(true);
      setTimeout(() => setPlantillaSaved(false), 2500);
    } catch {
      // silently ignore
    } finally {
      setSavingPlantilla(false);
    }
  };

  const eliminarPlantilla = async (id) => {
    try {
      await apiFetch(`/api/cedula-templates/${id}`, { method: 'DELETE' });
      setPlantillas(prev => prev.filter(p => p.id !== id));
    } catch {
      // silently ignore
    }
  };

  // ── Bloques agrupados por grupo ───────────────────────────────────────────
  const loteBloques = useMemo(() => {
    if (!form.loteId) return [];
    return siembras.filter(s => s.loteId === form.loteId);
  }, [form.loteId, siembras]);

  // Bloques del lote agrupados: [{id, nombre, bloques[]}]
  // Bloques sin grupo van al final en un grupo especial
  const bloquesByGrupo = useMemo(() => {
    if (loteBloques.length === 0) return [];
    const result = [];
    const assigned = new Set();
    for (const g of grupos) {
      const bloquesDG = (g.bloques || [])
        .map(id => loteBloques.find(b => b.id === id))
        .filter(Boolean);
      if (bloquesDG.length > 0) {
        result.push({ id: g.id, nombre: g.nombreGrupo, bloques: bloquesDG });
        bloquesDG.forEach(b => assigned.add(b.id));
      }
    }
    const sinGrupo = loteBloques.filter(b => !assigned.has(b.id));
    if (sinGrupo.length > 0) {
      result.push({ id: '__sin_grupo__', nombre: 'Sin grupo', bloques: sinGrupo });
    }
    return result;
  }, [loteBloques, grupos]);

  const toggleBloque = (bloqueId) => {
    setForm(prev => ({
      ...prev,
      selectedBloques: prev.selectedBloques.includes(bloqueId)
        ? prev.selectedBloques.filter(id => id !== bloqueId)
        : [...prev.selectedBloques, bloqueId],
    }));
  };

  const toggleGrupo = (grupoId) => {
    const grupo = bloquesByGrupo.find(g => g.id === grupoId);
    if (!grupo) return;
    const ids = grupo.bloques.map(b => b.id);
    const allSelected = ids.every(id => form.selectedBloques.includes(id));
    setForm(prev => ({
      ...prev,
      selectedBloques: allSelected
        ? prev.selectedBloques.filter(id => !ids.includes(id))
        : [...new Set([...prev.selectedBloques, ...ids])],
    }));
  };

  // ── Producto combobox ─────────────────────────────────────────────────────
  const openProdCombo = () => {
    if (!prodInputWrapRef.current) return;
    const rect = prodInputWrapRef.current.getBoundingClientRect();
    setProdDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setProdOpen(true);
  };

  useEffect(() => { setActiveIdx(-1); }, [prodSearch]);

  useEffect(() => {
    if (!prodOpen || activeIdx < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll('.aur-combo-option');
    items[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, prodOpen]);

  useEffect(() => {
    if (!prodOpen) return;
    const close = () => { setProdOpen(false); setActiveIdx(-1); };
    const handler = (e) => {
      if (!e.target.closest('.aur-combo-input-wrap') && !e.target.closest('.aur-combo-dropdown')) close();
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [prodOpen]);

  const addProducto = (p) => {
    if (!p) return;
    if (form.productos.some(fp => fp.productoId === p.id)) return;
    setForm(prev => ({
      ...prev,
      productos: [...prev.productos, {
        productoId: p.id,
        nombreComercial: p.nombreComercial,
        cantidadPorHa: '',
        unidad: p.unidad || '',
      }],
    }));
    setProdSearch('');
    setProdOpen(false);
    setActiveIdx(-1);
    setTimeout(() => cantidadRefs.current[p.id]?.focus(), 0);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!prodOpen) openProdCombo();
      setActiveIdx(i => Math.min(i + 1, productosFiltrados.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && productosFiltrados[activeIdx]) {
        addProducto(productosFiltrados[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setProdOpen(false);
      setActiveIdx(-1);
    }
  };

  const handleCantidadKeyDown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      prodInputRef.current?.focus();
      setTimeout(() => openProdCombo(), 0);
    }
  };

  const updateCantidad = (productoId, val) => {
    setForm(prev => ({
      ...prev,
      productos: prev.productos.map(p =>
        p.productoId === productoId ? { ...p, cantidadPorHa: val } : p
      ),
    }));
  };

  const removeProducto = (productoId) => {
    delete cantidadRefs.current[productoId];
    setForm(prev => ({ ...prev, productos: prev.productos.filter(p => p.productoId !== productoId) }));
  };

  const handleSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setError('');
    const activityName = form.activityName.trim();
    if (!activityName) { setError('El nombre de la aplicación es requerido.'); return; }
    if (activityName.length > MAX_ACTIVITY_LEN) { setError(`El nombre de la aplicación es demasiado largo (máx. ${MAX_ACTIVITY_LEN}).`); return; }
    if (!form.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) { setError('Fecha inválida.'); return; }
    const fechaSel = new Date(form.fecha + 'T12:00:00');
    if (isNaN(fechaSel.getTime())) { setError('Fecha inválida.'); return; }
    const tecnico = form.tecnicoResponsable.trim();
    if (tecnico.length > MAX_TECNICO_LEN) { setError(`El nombre del técnico es demasiado largo (máx. ${MAX_TECNICO_LEN}).`); return; }
    if (!form.loteId)              { setError('Seleccione un lote.'); return; }
    if (form.productos.length === 0) { setError('Agregue al menos un producto.'); return; }
    if (form.productos.length > 50) { setError('Máximo 50 productos por cédula.'); return; }
    const invalidProd = form.productos.find(p => {
      const v = parseFloat(p.cantidadPorHa);
      return !Number.isFinite(v) || v <= 0 || v > 100000;
    });
    if (invalidProd) { setError(`Ingrese una dosis válida para "${invalidProd.nombreComercial}".`); return; }

    setSubmitting(true);
    try {
      const body = {
        activityName,
        fecha: form.fecha,
        loteId: form.loteId,
        ...(form.calibracionId ? { calibracionId: form.calibracionId } : {}),
        ...(tecnico ? { tecnicoResponsable: tecnico.slice(0, MAX_TECNICO_LEN) } : {}),
        ...(form.selectedBloques.length > 0 ? { bloques: form.selectedBloques } : {}),
        productos: form.productos.map(p => ({
          productoId: p.productoId,
          cantidadPorHa: parseFloat(p.cantidadPorHa),
        })),
      };
      const res = await apiFetch('/api/cedulas/manual', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Error al crear la cédula.'); return; }
      onSuccess(data.cedula, data.task);
    } catch {
      setError('Error de conexión. Intente nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Warnings derivados (alerta inline al usuario) ─────────────────────────
  const maxFechaStr = useMemo(() => addDaysYmd(MAX_FUTURE_DAYS), []);
  const fechaInfo = useMemo(() => {
    if (!form.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) return { warning: '', isExceeded: false };
    const sel = new Date(form.fecha + 'T12:00:00');
    if (isNaN(sel.getTime())) return { warning: '', isExceeded: false };
    const hoy = new Date(); hoy.setHours(12, 0, 0, 0);
    const diff = Math.round((sel - hoy) / 86400000);
    if (diff > MAX_FUTURE_DAYS) {
      return { warning: `Fecha inusual: ${diff} días en el futuro. Excede el máximo permitido (${MAX_FUTURE_DAYS} días).`, isExceeded: true };
    }
    if (diff > WARN_FUTURE_DAYS) {
      return { warning: `Fecha inusual: ${diff} días en el futuro. Continúa si es correcto.`, isExceeded: false };
    }
    return { warning: '', isExceeded: false };
  }, [form.fecha]);
  const activityWarning = form.activityName.length >= MAX_ACTIVITY_LEN
    ? `Máximo ${MAX_ACTIVITY_LEN} caracteres alcanzado.`
    : '';
  const tecnicoWarning = form.tecnicoResponsable.length >= MAX_TECNICO_LEN
    ? `Máximo ${MAX_TECNICO_LEN} caracteres alcanzado.`
    : '';

  const productosDisponibles = productos.filter(
    p => !form.productos.some(fp => fp.productoId === p.id)
  );

  const productosFiltrados = productosDisponibles.filter(p =>
    !prodSearch ||
    p.nombreComercial?.toLowerCase().includes(prodSearch.toLowerCase()) ||
    p.ingredienteActivo?.toLowerCase().includes(prodSearch.toLowerCase())
  );

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={onClose}>
      <div className="aur-modal aur-modal--xl nca-modal" onPointerDown={e => e.stopPropagation()}>

        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiPlusCircle size={16} />
          </span>
          <span className="aur-modal-title">Nueva cédula de aplicación</span>
        </div>

        <form className="aur-modal-content" onSubmit={handleSubmit}>

          {plantillas.length > 0 && (
            <div className="nca-plantillas-section">
              <span className="aur-field-label">Plantillas</span>
              {plantillas.map(p => (
                <div key={p.id} className="nca-plantilla-chip">
                  <button
                    type="button"
                    className="nca-plantilla-apply"
                    onClick={() => aplicarPlantilla(p)}
                    title={`Aplicar plantilla: ${p.nombre}`}
                  >
                    ⚗ {p.nombre}
                  </button>
                  <button
                    type="button"
                    className="nca-plantilla-delete"
                    onClick={() => eliminarPlantilla(p.id)}
                    title="Eliminar plantilla"
                  >
                    <FiX size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="aur-banner aur-banner--danger">
              <FiAlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Settings list: campos del encabezado */}
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="nca-fecha">Fecha</label>
              <div>
                <input
                  id="nca-fecha"
                  className="aur-input"
                  type="date"
                  max={maxFechaStr}
                  value={form.fecha}
                  onChange={e => setForm(prev => ({ ...prev, fecha: e.target.value }))}
                />
                {fechaInfo.warning && <span className="aur-field-error">{fechaInfo.warning}</span>}
              </div>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="nca-actividad">Actividad</label>
              <div>
                <input
                  id="nca-actividad"
                  className="aur-input"
                  type="text"
                  maxLength={MAX_ACTIVITY_LEN}
                  placeholder="Ej. Fungicida preventivo"
                  value={form.activityName}
                  onChange={e => setForm(prev => ({ ...prev, activityName: e.target.value.slice(0, MAX_ACTIVITY_LEN) }))}
                />
                {activityWarning && <span className="aur-field-error">{activityWarning}</span>}
              </div>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="nca-calibracion">Calibración</label>
              <select
                id="nca-calibracion"
                className="aur-select"
                value={form.calibracionId}
                onChange={e => setForm(prev => ({ ...prev, calibracionId: e.target.value }))}
              >
                <option value="">— Ninguna —</option>
                {(calibraciones || []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}{c.volumen ? ` (${c.volumen} lt/ha)` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="nca-tecnico">Técnico responsable</label>
              <div>
                <input
                  id="nca-tecnico"
                  className="aur-input"
                  type="text"
                  maxLength={MAX_TECNICO_LEN}
                  placeholder="Opcional"
                  value={form.tecnicoResponsable}
                  onChange={e => setForm(prev => ({ ...prev, tecnicoResponsable: e.target.value.slice(0, MAX_TECNICO_LEN) }))}
                />
                {tecnicoWarning && <span className="aur-field-error">{tecnicoWarning}</span>}
              </div>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="nca-lote">Lote</label>
              <select
                id="nca-lote"
                className="aur-select"
                value={form.loteId}
                onChange={e => setForm(prev => ({ ...prev, loteId: e.target.value, selectedBloques: [] }))}
              >
                <option value="">— Seleccione un lote —</option>
                {lotes.map(l => (
                  <option key={l.id} value={l.id}>{l.nombreLote}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Productos */}
          <section className="nca-section">
            <div className="aur-section-header">
              <span className="aur-section-num">+</span>
              <h3>Productos</h3>
              <span className="aur-section-count">{form.productos.length}</span>
            </div>

            {form.productos.length > 0 && (
              <table className="aur-table nca-productos-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="aur-td-num">Dosis / Ha</th>
                    <th>Unidad</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.productos.map(p => (
                    <tr key={p.productoId}>
                      <td>{p.nombreComercial}</td>
                      <td className="aur-td-num">
                        <input
                          ref={el => { if (el) cantidadRefs.current[p.productoId] = el; else delete cantidadRefs.current[p.productoId]; }}
                          className="aur-input aur-input--num"
                          type="number"
                          min="0"
                          max="100000"
                          step="any"
                          value={p.cantidadPorHa}
                          onChange={e => updateCantidad(p.productoId, e.target.value)}
                          onKeyDown={handleCantidadKeyDown}
                          placeholder="0"
                        />
                      </td>
                      <td>{p.unidad}</td>
                      <td>
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--danger aur-icon-btn--sm"
                          onClick={() => removeProducto(p.productoId)}
                          title="Quitar producto"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Combobox de productos */}
            <div className="aur-combo nca-prod-combo">
              <div
                className="aur-combo-input-wrap"
                ref={prodInputWrapRef}
                onClick={() => { prodInputRef.current?.focus(); openProdCombo(); }}
              >
                <FiSearch size={13} />
                <input
                  ref={prodInputRef}
                  className="aur-combo-input"
                  type="text"
                  placeholder={form.productos.length === 0 ? 'Buscar y agregar producto…' : '+ Agregar otro producto…'}
                  value={prodSearch}
                  onChange={e => { setProdSearch(e.target.value); openProdCombo(); }}
                  onFocus={() => openProdCombo()}
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
            </div>

            {prodOpen && createPortal(
              <div
                ref={dropdownRef}
                className="aur-combo-dropdown"
                style={{ top: prodDropdownPos.top, left: prodDropdownPos.left, minWidth: prodDropdownPos.width }}
              >
                {productosFiltrados.length === 0 ? (
                  <p className="aur-combo-empty">Sin resultados</p>
                ) : (
                  productosFiltrados.map((p, i) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`aur-combo-option${i === activeIdx ? ' aur-combo-option--active' : ''}`}
                      onMouseDown={e => { e.preventDefault(); addProducto(p); }}
                      onMouseEnter={() => setActiveIdx(i)}
                    >
                      <span className="aur-combo-name">{p.nombreComercial}</span>
                      {p.ingredienteActivo && <span className="aur-combo-meta">{p.ingredienteActivo}</span>}
                    </button>
                  ))
                )}
              </div>,
              document.body
            )}
          </section>

          {/* Bloques (page-specific accordion checkbox) */}
          {bloquesByGrupo.length > 0 && (
            <section className="nca-section">
              <div className="aur-section-header">
                <span className="aur-section-num">⚑</span>
                <h3>Bloques</h3>
                <span className="aur-section-count">{form.selectedBloques.length}</span>
                <div className="aur-section-actions">
                  <button
                    type="button"
                    className="aur-chip aur-chip--ghost"
                    onClick={() => setForm(prev => ({
                      ...prev,
                      selectedBloques: prev.selectedBloques.length === loteBloques.length
                        ? []
                        : loteBloques.map(b => b.id),
                    }))}
                  >
                    {form.selectedBloques.length === loteBloques.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </button>
                </div>
              </div>
              <div className="nca-bloques-grid">
                {bloquesByGrupo.map(grupo => {
                  const ids = grupo.bloques.map(b => b.id);
                  const selCount = ids.filter(id => form.selectedBloques.includes(id)).length;
                  const allSel = selCount === ids.length;
                  const someSel = selCount > 0 && !allSel;
                  return (
                    <div key={grupo.id} className="nca-bloques-group">
                      <button
                        type="button"
                        className="nca-bloques-group-header"
                        onClick={() => toggleGrupo(grupo.id)}
                        title={allSel ? 'Deseleccionar grupo' : 'Seleccionar grupo'}
                      >
                        <span className={`nca-grupo-check-icon${allSel ? ' all' : someSel ? ' some' : ''}`}>
                          {allSel ? '▣' : someSel ? '▪' : '▢'}
                        </span>
                        <span className="nca-grupo-name">{grupo.nombre}</span>
                        {selCount > 0 && (
                          <span className="nca-grupo-count">{selCount}/{ids.length}</span>
                        )}
                      </button>
                      <div className="nca-bloques-list">
                        {grupo.bloques.map(b => (
                          <label key={b.id} className="nca-bloque-check">
                            <input
                              type="checkbox"
                              checked={form.selectedBloques.includes(b.id)}
                              onChange={() => toggleBloque(b.id)}
                            />
                            <span className="nca-bloque-name">{b.bloque || b.id}</span>
                            {b.areaCalculada != null && (
                              <span className="nca-bloque-ha">{b.areaCalculada} ha</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Guardar como plantilla */}
          <button
            type="button"
            className={`aur-chip aur-chip--ghost nca-guardar-plantilla${plantillaSaved ? ' saved' : ''}`}
            onClick={guardarComoPlantilla}
            disabled={savingPlantilla || !form.activityName.trim()}
            title="Guardar nombre y productos como plantilla reutilizable"
          >
            {plantillaSaved ? '✓ Plantilla guardada' : savingPlantilla ? 'Guardando…' : '📋 Guardar como plantilla'}
          </button>
        </form>

        <div className="aur-modal-actions">
          {onPreviewDraft && (
            <button
              type="button"
              className="aur-btn-text"
              onClick={() => onPreviewDraft({ ...form })}
              disabled={submitting}
              title="Ver borrador de la cédula"
            >
              <FiEye size={14} /> Vista previa
            </button>
          )}
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
            disabled={submitting || fechaInfo.isExceeded}
          >
            <FiPlusCircle size={14} />
            {submitting ? 'Generando…' : 'Generar cédula'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CedulaNuevaModal;
