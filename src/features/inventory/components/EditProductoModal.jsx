import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useDraft, markDraftActive, clearDraftActive } from '../../../hooks/useDraft';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const MONEDAS = ['USD', 'CRC', 'EUR'];

/* ── Limits ──────────────────────────────────────────────────────────────── */
const LIMITS = {
  idProducto:            { maxLen: 32 },
  nombreComercial:       { maxLen: 64, required: true },
  ingredienteActivo:     { maxLen: 64 },
  tipo:                  { maxLen: 64 },
  proveedor:             { maxLen: 128 },
  registroFitosanitario: { maxLen: 32 },
  observacion:           { maxLen: 288 },
  plagaQueControla:      { maxLen: 128 },
  cantidadPorHa:         { min: 0, max: 2048, exclusive: true },
  periodoReingreso:      { min: 0, max: 512, exclusive: true },
  periodoACosecha:       { min: 0, max: 512, exclusive: true },
  stockActual:           { min: 0, max: 32768, exclusive: true },
  stockMinimo:           { min: 0, max: 32768, exclusive: true },
  precioUnitario:        { min: 0, max: 2097152, exclusive: true },
  tipoCambio:            { min: 0, max: 2097152, exclusive: true },
  iva:                   { min: 0, max: 100 },
};

function validate(form, isNew) {
  const errors = {};
  const checkText = (key) => {
    const v = (form[key] ?? '').toString();
    const l = LIMITS[key];
    if (l?.required && !v.trim()) errors[key] = 'Campo obligatorio';
    else if (l?.maxLen && v.length > l.maxLen) errors[key] = `Máx ${l.maxLen} caracteres`;
  };
  const checkNum = (key) => {
    const raw = form[key];
    if (raw === '' || raw === null || raw === undefined) return;
    const n = Number(raw);
    const l = LIMITS[key];
    if (!l) return;
    if (isNaN(n)) { errors[key] = 'Debe ser un número'; return; }
    if (n < l.min) { errors[key] = `Mínimo ${l.min}`; return; }
    if (l.exclusive && n >= l.max) errors[key] = `Debe ser menor a ${l.max}`;
    else if (!l.exclusive && n > l.max) errors[key] = `Máximo ${l.max}`;
  };

  checkText('idProducto');
  checkText('nombreComercial');
  checkText('ingredienteActivo');
  checkText('proveedor');
  checkText('registroFitosanitario');
  checkText('observacion');
  checkText('plagaQueControla');

  // Tipo comes from a select, but guard against crafted values
  if (form.tipo && !TIPOS.includes(form.tipo)) errors.tipo = 'Tipo no válido';
  if (form.moneda && !MONEDAS.includes(form.moneda)) errors.moneda = 'Moneda no válida';

  checkNum('cantidadPorHa');
  checkNum('periodoReingreso');
  checkNum('periodoACosecha');
  if (isNew) checkNum('stockActual');
  checkNum('stockMinimo');
  checkNum('precioUnitario');
  checkNum('tipoCambio');
  checkNum('iva');

  return errors;
}

/* ── Proveedor combobox (portal, teclado, filtro — igual a LoteCombobox) ── */
function ProveedorCombobox({ value, onChange }) {
  const apiFetch = useApiFetch();
  const [options, setOptions] = useState([]);

  const [text, setText]       = useState(value);
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/proveedores').then(r => r.json()).then(data => {
      if (!cancelled) setOptions(Array.isArray(data) ? data : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiFetch]);

  // Sync display text when parent changes value externally (e.g. form reset)
  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(value);
  }, [value]);

  const filtered = options.filter(p =>
    !text || (p.nombre || '').toLowerCase().includes(text.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (prov) => {
    setText(prov.nombre);
    setOpen(false);
    setHi(0);
    onChange(prov.nombre);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    const v = e.target.value;
    setText(v);
    onChange(v);
    openDropdown();
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setOpen(false);
        setText(value);
      }
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => {
        const n = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => {
        const n = Math.max(h - 1, 0);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        value={text}
        maxLength={128}
        autoComplete="off"
        placeholder="Buscar proveedor…"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="ep-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={i === hi ? 'ep-combo-item--active' : undefined}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              {p.nombre}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

/* ── Unidad combobox (portal, teclado, filtro — mismo patrón) ────────────── */
function UnidadCombobox({ value, onChange }) {
  const apiFetch = useApiFetch();
  const [options, setOptions] = useState([]);

  const [text, setText]       = useState(value);
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/unidades-medida').then(r => r.json()).then(data => {
      if (!cancelled) setOptions(Array.isArray(data) ? data : []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [apiFetch]);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(value);
  }, [value]);

  const filtered = options.filter(u =>
    !text || (u.nombre || '').toLowerCase().includes(text.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (unit) => {
    setText(unit.nombre);
    setOpen(false);
    setHi(0);
    onChange(unit.nombre);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    const v = e.target.value;
    setText(v);
    onChange(v);
    openDropdown();
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setOpen(false);
        setText(value);
      }
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => {
        const n = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => {
        const n = Math.max(h - 1, 0);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        value={text}
        maxLength={40}
        autoComplete="off"
        placeholder="Buscar unidad…"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="ep-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((u, i) => (
            <li
              key={u.id || u.nombre}
              className={i === hi ? 'ep-combo-item--active' : undefined}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHi(i)}
            >
              {u.nombre}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

/* ── Main modal ──────────────────────────────────────────────────────────── */
function EditProductoModal({ producto = {}, onClose, onSaved, isNew = false }) {
  const apiFetch = useApiFetch();
  const initialForm = {
    idProducto:            producto.idProducto            ?? '',
    nombreComercial:       producto.nombreComercial        ?? '',
    ingredienteActivo:     producto.ingredienteActivo      ?? '',
    tipo:                  producto.tipo                   ?? '',
    plagaQueControla:      producto.plagaQueControla       ?? '',
    periodoReingreso:      producto.periodoReingreso       ?? '',
    periodoACosecha:       producto.periodoACosecha        ?? '',
    cantidadPorHa:         producto.cantidadPorHa          ?? '',
    unidad:                producto.unidad                 ?? '',
    stockActual:           producto.stockActual            ?? '',
    stockMinimo:           producto.stockMinimo            ?? '',
    precioUnitario:        producto.precioUnitario         ?? '',
    moneda:                producto.moneda                 ?? 'USD',
    tipoCambio:            producto.tipoCambio             ?? 1,
    iva:                   producto.iva                    ?? 0,
    proveedor:             producto.proveedor              ?? '',
    registroFitosanitario: producto.registroFitosanitario  ?? '',
    observacion:           producto.observacion            ?? '',
  };

  // Siempre se llaman ambos hooks (regla de hooks); se usa el apropiado según isNew.
  const [draftForm, setDraftForm, clearFormDraft] = useDraft('nuevo-producto', initialForm, { storage: 'local' });
  const [editFormState, setEditFormState] = useState(initialForm);

  const form    = isNew ? draftForm    : editFormState;
  const setForm = isNew ? setDraftForm : setEditFormState;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Marca el badge de draft en la sidebar mientras haya contenido en el formulario nuevo
  useEffect(() => {
    if (!isNew) return;
    const hasContent = Object.values(form).some(v => v !== '' && v !== 0 && v !== 1 && v !== 'USD');
    if (hasContent) markDraftActive('nuevo-producto');
  }, [form, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    // Clear field error on change
    if (fieldErrors[field]) setFieldErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  const numericPayload = () => ({
    ...form,
    periodoReingreso: form.periodoReingreso !== '' ? Number(form.periodoReingreso) : 0,
    periodoACosecha:  form.periodoACosecha  !== '' ? Number(form.periodoACosecha)  : 0,
    cantidadPorHa:    form.cantidadPorHa    !== '' ? Number(form.cantidadPorHa)    : 0,
    stockActual:      form.stockActual      !== '' ? Number(form.stockActual)      : 0,
    stockMinimo:      form.stockMinimo      !== '' ? Number(form.stockMinimo)      : 0,
    precioUnitario:   form.precioUnitario   !== '' ? Number(form.precioUnitario)   : 0,
    tipoCambio:       form.tipoCambio       !== '' ? Number(form.tipoCambio)       : 1,
    iva:              form.iva              !== '' ? Number(form.iva)              : 0,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(form, isNew);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Corrige los campos marcados.');
      return;
    }
    setFieldErrors({});
    setSaving(true);
    setError(null);
    try {
      const url    = isNew ? '/api/productos' : `/api/productos/${producto.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(numericPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar');
      if (isNew) { clearFormDraft(); clearDraftActive('nuevo-producto'); }
      onSaved(data);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const fieldErr = (key) => fieldErrors[key] ? <span className="ep-field-error">{fieldErrors[key]}</span> : null;

  return (
    <div className="aur-modal-backdrop" onPointerDown={onClose}>
      <div className="modal-content edit-producto-modal" onPointerDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isNew ? 'Nuevo Producto' : 'Editar producto'}</h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <form className="edit-producto-form" onSubmit={handleSubmit} noValidate>
          {/* Identificación */}
          <div className="ep-section-title">Identificación</div>
          <div className="ep-grid">
            <div className="ep-field">
              <label>ID Producto</label>
              <input value={form.idProducto} maxLength={32} onChange={e => set('idProducto', e.target.value)} placeholder="Ej: AGR-001" />
              {fieldErr('idProducto')}
            </div>
            <div className="ep-field ep-field-wide">
              <label>Nombre Comercial <span className="toma-required">*</span></label>
              <input value={form.nombreComercial} maxLength={64} onChange={e => set('nombreComercial', e.target.value)} placeholder="Nombre del producto" required />
              {fieldErr('nombreComercial')}
            </div>
            <div className="ep-field ep-field-wide">
              <label>Ingrediente Activo</label>
              <input value={form.ingredienteActivo} maxLength={64} onChange={e => set('ingredienteActivo', e.target.value)} placeholder="Ej: Glifosato 48%" />
              {fieldErr('ingredienteActivo')}
            </div>
            <div className="ep-field">
              <label>Tipo</label>
              <select value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {fieldErr('tipo')}
            </div>
            <div className="ep-field ep-field-wide">
              <label>Proveedor</label>
              <ProveedorCombobox value={form.proveedor} onChange={v => set('proveedor', v)} />
              {fieldErr('proveedor')}
            </div>
            <div className="ep-field">
              <label>No. Registro Fitosanitario</label>
              <input value={form.registroFitosanitario} maxLength={32} onChange={e => set('registroFitosanitario', e.target.value)} placeholder="Ej. B-0123" />
              {fieldErr('registroFitosanitario')}
            </div>
            <div className="ep-field ep-field-wide">
              <label>Observación</label>
              <input value={form.observacion} maxLength={288} onChange={e => set('observacion', e.target.value)} placeholder="Notas sobre el producto" />
              {fieldErr('observacion')}
            </div>
          </div>

          {/* Uso agronómico */}
          <div className="ep-section-title">Uso agronómico</div>
          <div className="ep-grid">
            <div className="ep-field ep-field-wide">
              <label>Plaga / Enfermedad que controla</label>
              <input value={form.plagaQueControla} maxLength={128} onChange={e => set('plagaQueControla', e.target.value)} placeholder="Ej: Botrytis, maleza hoja ancha…" />
              {fieldErr('plagaQueControla')}
            </div>
            <div className="ep-field">
              <label>Dosis por Ha</label>
              <input type="number" min="0" max="2047.99" step="0.01" value={form.cantidadPorHa} onChange={e => set('cantidadPorHa', e.target.value)} placeholder="0" />
              {fieldErr('cantidadPorHa')}
            </div>
            <div className="ep-field">
              <label>Unidad</label>
              <UnidadCombobox value={form.unidad} onChange={v => set('unidad', v)} />
              {fieldErr('unidad')}
            </div>
            <div className="ep-field">
              <label>Período reingreso (h)</label>
              <input type="number" min="0" max="511" step="1" value={form.periodoReingreso} onChange={e => set('periodoReingreso', e.target.value)} placeholder="0" />
              {fieldErr('periodoReingreso')}
            </div>
            <div className="ep-field">
              <label>Período a cosecha (días)</label>
              <input type="number" min="0" max="511" step="1" value={form.periodoACosecha} onChange={e => set('periodoACosecha', e.target.value)} placeholder="0" />
              {fieldErr('periodoACosecha')}
            </div>
          </div>

          {/* Inventario y costo */}
          <div className="ep-section-title">Inventario y costo</div>
          <div className="ep-grid">
            {isNew && (
              <div className="ep-field">
                <label>Stock inicial</label>
                <input type="number" min="0" max="32767" step="0.01" value={form.stockActual} onChange={e => set('stockActual', e.target.value)} placeholder="0" />
                {fieldErr('stockActual')}
              </div>
            )}
            <div className="ep-field">
              <label>Stock mínimo</label>
              <input type="number" min="0" max="32767" step="0.01" value={form.stockMinimo} onChange={e => set('stockMinimo', e.target.value)} placeholder="0" />
              {fieldErr('stockMinimo')}
            </div>
            <div className="ep-field">
              <label>Precio unitario</label>
              <input type="number" min="0" max="2097151" step="0.01" value={form.precioUnitario} onChange={e => set('precioUnitario', e.target.value)} placeholder="0.00" />
              {fieldErr('precioUnitario')}
            </div>
            <div className="ep-field">
              <label>Moneda</label>
              <select value={form.moneda} onChange={e => set('moneda', e.target.value)}>
                {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {fieldErr('moneda')}
            </div>
            <div className="ep-field">
              <label>Tipo de cambio</label>
              <input type="number" min="0" max="2097151" step="0.01" value={form.tipoCambio} onChange={e => set('tipoCambio', e.target.value)} placeholder="1" />
              {fieldErr('tipoCambio')}
            </div>
            <div className="ep-field">
              <label>IVA (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.iva} onChange={e => set('iva', e.target.value)} placeholder="0" />
              {fieldErr('iva')}
            </div>
          </div>

          {error && <p className="toma-error">{error}</p>}

          <div className="toma-fisica-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { if (isNew) { clearFormDraft(); clearDraftActive('nuevo-producto'); } onClose(); }}
              disabled={saving}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : isNew ? 'Crear producto' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditProductoModal;
