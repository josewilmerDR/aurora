import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import '../styles/agroquimicos.css';
import { FiPlus, FiCheck, FiX, FiFileText, FiPackage, FiZap, FiCamera, FiMenu, FiArrowLeft } from 'react-icons/fi';
import InvoiceScan from '../../../pages/InvoiceScan';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';

const MAX_IMAGE_PX = 1600;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_PX || height > MAX_IMAGE_PX) {
          const ratio = Math.min(MAX_IMAGE_PX / width, MAX_IMAGE_PX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let _uid = Date.now();
const newRow = () => ({
  _key: ++_uid,
  idProducto: '',
  nombreComercial: '',
  unidad: 'L',
  cantidad: '',
  total: '',
  iva: 0,
});

function calcPrecioUnit(f) {
  const cant = parseFloat(f.cantidad) || 0;
  const tot  = parseFloat(f.total)    || 0;
  return cant > 0 ? tot / cant : 0;
}

function calcIvaAmount(f) {
  const tot = parseFloat(f.total) || 0;
  return tot * (f.iva / 100);
}

// ── Autocompletado con Portal (escapa del overflow del contenedor) ─────────
function AutocompleteInput({ value, onChange, onSelect, suggestions, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);

  const filtered = !value.trim()
    ? []
    : suggestions.filter(p =>
        p.idProducto?.toLowerCase().includes(value.toLowerCase()) ||
        p.nombreComercial?.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 7);

  const calcPos = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 3, left: r.left + window.scrollX, width: Math.max(r.width, 280) });
  };

  return (
    <div className="ac-wrap">
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); calcPos(); setOpen(true); }}
        onFocus={() => { calcPos(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && createPortal(
        <ul className="ac-dropdown" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {filtered.map(p => (
            <li key={p.id} onMouseDown={() => { onSelect(p); setOpen(false); }}>
              <span className="ac-id">{p.idProducto}</span>
              <span className="ac-name">{p.nombreComercial}</span>
              <span className="ac-unit">{p.unidad}</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

// ── Combobox proveedor con portal ─────────────────────────────────────────
function ProveedorCombobox({ value, onChange, proveedores }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = proveedores.filter(p =>
    !value || p.nombre.toLowerCase().includes(value.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (p) => {
    onChange(p.nombre);
    setOpen(false);
    setHi(0);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
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
        id="proveedorGlobal"
        className="ingreso-proveedor-input"
        value={value}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => { if (document.activeElement !== inputRef.current) setOpen(false); }, 150)}
        onKeyDown={handleKeyDown}
        placeholder="Nombre del proveedor"
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="proveedor-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`proveedor-dropdown-item${i === hi ? ' proveedor-dropdown-item--active' : ''}`}
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

// ── Combobox unidad de medida con portal ──────────────────────────────────
function UMCombobox({ value, onChange, unidadesMedida }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = unidadesMedida.filter(u =>
    !value || u.nombre.toLowerCase().includes(value.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: Math.max(r.width, 140) });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (u) => {
    onChange(u.nombre);
    setOpen(false);
    setHi(0);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
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
        className="ingreso-um-input"
        value={value}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => { if (document.activeElement !== inputRef.current) setOpen(false); }, 150)}
        onKeyDown={handleKeyDown}
        placeholder="UM"
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="proveedor-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((u, i) => (
            <li
              key={u.id}
              className={`proveedor-dropdown-item${i === hi ? ' proveedor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="um-nombre">{u.nombre}</span>
              {u.descripcion && <span className="um-desc">{u.descripcion}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

// ── Selector con opción "Nuevo" ────────────────────────────────────────────
function EditableSelect({ value, options, onChange, onAddOption, renderLabel }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const handleSelectChange = (e) => {
    if (e.target.value === '__nuevo__') {
      setAdding(true);
      setDraft('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onChange(e.target.value);
    }
  };

  const confirm = () => {
    const trimmed = draft.trim();
    if (trimmed) {
      onAddOption(trimmed);
      onChange(trimmed);
    }
    setAdding(false);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { setAdding(false); setDraft(''); }
  };

  if (adding) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={confirm}
        onKeyDown={handleKeyDown}
        placeholder="Nuevo valor…"
        className="ingreso-new-option-input"
      />
    );
  }

  return (
    <select value={value} onChange={handleSelectChange}>
      {options.map(o => (
        <option key={o} value={o}>{renderLabel ? renderLabel(o) : o}</option>
      ))}
      <option disabled>──────────</option>
      <option value="__nuevo__">— Nuevo... —</option>
    </select>
  );
}

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// ── Componente principal ───────────────────────────────────────────────────
function Recepcion() {
  const apiFetch = useApiFetch();
  const location = useLocation();
  const navigate = useNavigate();
  const [filas, setFilas] = useState([newRow()]);
  const [factura, setFactura] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [proveedor, setProveedor] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [unidadesMedida, setUnidadesMedida] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [loadedOrdenId, setLoadedOrdenId] = useState(null);
  const [loadedOrden, setLoadedOrden] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [ocModalOpen, setOcModalOpen] = useState(false);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [step, setStep] = useState('form');
  const ocVisibles = ordenes.filter(o => o.estado !== 'recibida' && o.estado !== 'completada' && o.estado !== 'cancelada');
  const [invoiceImage, setInvoiceImage] = useState(null); // { base64, mediaType, previewUrl }
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const imageFileInputRef = useRef(null);
  // Listas de opciones compartidas (persisten durante la sesión)
  const [ivaOpciones, setIvaOpciones] = useState([0, 4, 8, 13, 15]);

  const handleProductsScanned = (lineas, catalogoEscaneado, imgData) => {
    const newFilas = lineas
      .map(linea => {
        const cat = catalogo.find(p => p.id === linea.productoId)
                 || catalogoEscaneado.find(p => p.id === linea.productoId);
        return {
          _key: ++_uid,
          idProducto:      cat?.idProducto      || linea.idProducto      || '',
          nombreComercial: cat?.nombreComercial  || linea.nombreComercial || linea.nombreFactura || '',
          unidad:          cat?.unidad           || linea.unidad          || linea.unidadFactura || 'L',
          cantidad:        String(linea.cantidadIngresada || linea.cantidadFactura || ''),
          total:           linea.subtotalLinea != null ? String(linea.subtotalLinea) : '',
          iva:             cat?.iva != null ? cat.iva : 0,
        };
      })
      .filter(f => f.nombreComercial.trim());

    if (newFilas.length === 0) {
      showToast('No se encontraron productos en la factura.', 'error');
    } else {
      setFilas(newFilas);
      showToast(`${newFilas.length} producto(s) cargado(s) desde la factura. Revisa y guarda.`, 'success');
    }
    if (imgData) setInvoiceImage(imgData);
    setShowScan(false);
  };

  const handleImageFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Solo se aceptan archivos de imagen.', 'error'); e.target.value = ''; return; }
    if (file.size > MAX_IMAGE_SIZE) { showToast('La imagen no debe superar 10 MB.', 'error'); e.target.value = ''; return; }
    try { setInvoiceImage(await compressImage(file)); }
    catch { showToast('No se pudo procesar la imagen.', 'error'); }
    e.target.value = '';
  };

  const addIva = (val) => {
    const num = parseFloat(val);
    if (!isNaN(num) && !ivaOpciones.includes(num))
      setIvaOpciones(prev => [...prev, num].sort((a, b) => a - b));
  };

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });


  const handleAutocompleteSelect = (rowKey, producto) => {
    setFilas(prev => prev.map(f => f._key === rowKey ? {
      ...f,
      idProducto:      producto.idProducto                          || f.idProducto,
      nombreComercial: producto.nombreComercial                     || f.nombreComercial,
      unidad:          producto.unidad                              || f.unidad,
      iva:             producto.iva != null ? producto.iva          : f.iva,
    } : f));
  };

  const loadOrdenIntoForm = (orden) => {
    const items = orden.items || [];
    const filasCargadas = items
      .map(item => {
        const cat       = catalogo.find(c => c.id === item.productoId);
        const ordered   = parseFloat(item.cantidad)          || 0;
        const received  = parseFloat(item.cantidadRecibida)  || 0;
        const remaining = Math.max(0, ordered - received);
        if (remaining <= 0) return null;            // ya recibido completamente
        const precio = parseFloat(item.precioUnitario) || 0;
        return {
          _key:            ++_uid,
          idProducto:      cat?.idProducto      || '',
          nombreComercial: item.nombreComercial  || cat?.nombreComercial || '',
          unidad:          item.unidad           || cat?.unidad || 'L',
          cantidad:        String(remaining),
          total:           precio > 0 ? String(remaining * precio) : '',
          iva:             item.iva ?? cat?.iva ?? 0,
        };
      })
      .filter(Boolean);
    setFilas(filasCargadas.length > 0 ? filasCargadas : [newRow()]);
    if (orden.proveedor) setProveedor(orden.proveedor);
    setLoadedOrdenId(orden.id);
    setLoadedOrden(orden);
    setStep('form');
  };

  useEffect(() => {
    apiFetch('/api/productos').then(r => r.json()).then(setCatalogo).catch(console.error);
    apiFetch('/api/proveedores').then(r => r.json()).then(setProveedores).catch(console.error);
    apiFetch('/api/unidades-medida').then(r => r.json()).then(setUnidadesMedida).catch(console.error);
    apiFetch('/api/ordenes-compra').then(r => r.json()).then(setOrdenes).catch(console.error);
    if (location.state?.editProducto) {
      const p = location.state.editProducto;
      const cant  = parseFloat(p.stockActual)    || 0;
      const precio = parseFloat(p.precioUnitario) || 0;
      setFilas([{
        ...newRow(),
        idProducto:      p.idProducto      || '',
        nombreComercial: p.nombreComercial  || '',
        unidad:          p.unidad           || 'L',
        cantidad:        cant  > 0 ? String(cant)            : '',
        total:           cant > 0 && precio > 0 ? String(cant * precio) : '',
        iva:             0,
      }]);
      setProveedor(p.proveedor || '');
      window.scrollTo(0, 0);
    }
  }, []);

  const update = (key, field, value) =>
    setFilas(prev => prev.map(f => f._key === key ? { ...f, [field]: value } : f));

  const [newRowKey, setNewRowKey] = useState(null);
  const addFila = () => {
    const row = newRow();
    setFilas(prev => [...prev, row]);
    setNewRowKey(row._key);
  };

  const removeFila = (key) =>
    setFilas(prev => prev.length > 1 ? prev.filter(f => f._key !== key) : prev);

  const subtotal     = filas.reduce((sum, f) => sum + (parseFloat(f.total) || 0), 0);
  const ivaTotal     = filas.reduce((sum, f) => sum + calcIvaAmount(f), 0);
  const totalGeneral = subtotal + ivaTotal;

  const handleGuardarTodo = async () => {
    const validas = filas.filter(f => f.nombreComercial.trim());
    if (validas.length === 0) {
      showToast('Completa al menos el Nombre Comercial en una fila.', 'error');
      return;
    }
    setSaving(true);

    try {
      const res = await apiFetch('/api/ingreso/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validas.map(f => ({
            idProducto:      f.idProducto.trim(),
            nombreComercial: f.nombreComercial,
            unidad:          f.unidad,
            cantidad:        parseFloat(f.cantidad) || 0,
            cantidadOC:      parseFloat(f.cantidadOC) || 0,
            precioUnitario:  calcPrecioUnit(f),
            iva:             f.iva ?? 0,
          })),
          proveedor,
          fecha,
          facturaNumero: factura,
          ordenCompraId: loadedOrdenId  || null,
          ocPoNumber:    loadedOrden?.poNumber || '',
          imageBase64:   invoiceImage?.base64    || null,
          mediaType:     invoiceImage?.mediaType || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error');

      if (loadedOrden) apiFetch('/api/ordenes-compra').then(r => r.json()).then(setOrdenes).catch(console.error);

      const backToList = !!loadedOrden;
      setFilas([newRow()]);
      setFactura('');
      setProveedor('');
      setLoadedOrdenId(null);
      setLoadedOrden(null);
      setInvoiceImage(null);
      if (backToList) setStep('list');

      const msg = [
        data.creados   > 0 && `${data.creados} creado(s)`,
        data.mergeados > 0 && `${data.mergeados} stock actualizado`,
      ].filter(Boolean).join(' · ');
      showToast(msg || 'Ingreso registrado.', 'success');
    } catch (err) {
      showToast(err.message || 'Error al registrar el ingreso.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {(step !== 'list' || ocVisibles.length > 0) && (
      <div className="ingreso-title-row">
        <div className="kebab-menu-wrap">
          <button className="btn-kebab" onClick={() => setKebabOpen(o => !o)} title="Más opciones">
            <FiMenu size={17} />
          </button>
          {kebabOpen && (
            <>
              <div className="kebab-backdrop" onClick={() => setKebabOpen(false)} />
              <ul className="kebab-dropdown">
                <li onClick={() => { navigate('/bodega/agroquimicos/movimientos'); setKebabOpen(false); }}>
                  <FiFileText size={14} /> Ver historial
                </li>
              </ul>
            </>
          )}
        </div>
        <h2 className="ingreso-page-title">Recepción de Mercancía</h2>
        {step === 'form' && (
          <button
            type="button"
            className="ingreso-oc-trigger-btn"
            onClick={() => setOcModalOpen(true)}
          >
            <FiFileText size={13} />
            OC
            {ocVisibles.length > 0 && (
              <span className="ingreso-oc-trigger-badge">{ocVisibles.length}</span>
            )}
          </button>
        )}
      </div>
      )}

      {/* ── Vista lista ── */}
      {step === 'list' && ocVisibles.length > 0 && (
          <div className="ingreso-oc-list-view">
            {ocVisibles.map(orden => {
              const isParcial = orden.estado === 'recibida_parcialmente';
              return (
                <div
                  key={orden.id}
                  className={`ingreso-oc-list-card${isParcial ? ' ingreso-oc-card--parcial' : ''}`}
                  onClick={() => loadOrdenIntoForm(orden)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && loadOrdenIntoForm(orden)}
                >
                  <div className="ingreso-oc-list-card-head">
                    <span className="ingreso-oc-title">{orden.poNumber || 'OC sin número'}</span>
                    {isParcial && <span className="ingreso-oc-badge-parcial">Parcial</span>}
                  </div>
                  <div className="ingreso-oc-meta">
                    <span>{orden.proveedor || <em>Sin proveedor</em>}</span>
                    <span><FiPackage size={11} /> {Array.isArray(orden.items) ? orden.items.length : 0} prod.</span>
                    <span>{formatDate(orden.fecha)}</span>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="ingreso-add-row-btn ingreso-manual-btn"
              onClick={() => setStep('form')}
            >
              <FiPlus size={13} /> Nueva entrada manual
            </button>
          </div>
      )}

      {/* ── Vista formulario ── */}
      {step === 'form' && <div className="ingreso-top-layout">

      <div className="form-card ingreso-grid-card">

        {/* Cabecera */}
        <div className="ingreso-grid-header">
          <div className="ingreso-header-left-actions">
            <button
              type="button"
              className="ingreso-scan-btn"
              onClick={() => setShowScan(true)}
            >
              <FiZap size={14} /> Escanear factura
            </button>
            <label
              className={`ingreso-scan-btn ingreso-attach-label${invoiceImage ? ' ingreso-attach-label--active' : ''}`}
              htmlFor="invoiceImageInput"
              title="Adjuntar foto de la factura"
            >
              <FiCamera size={14} /> {invoiceImage ? 'Cambiar imagen' : 'Adjuntar imagen'}
            </label>
            <input
              id="invoiceImageInput"
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageFileSelect}
            />
            {invoiceImage && (
              <div className="ingreso-image-preview-wrap">
                <img
                  src={invoiceImage.previewUrl}
                  alt="Factura adjunta"
                  className="ingreso-image-thumb"
                  onClick={() => setLightboxSrc(invoiceImage.previewUrl)}
                  title="Ver imagen adjunta"
                />
                <button
                  type="button"
                  className="ingreso-image-remove"
                  onClick={() => setInvoiceImage(null)}
                  title="Quitar imagen"
                >
                  <FiX size={11} />
                </button>
              </div>
            )}
          </div>
          <div className="ingreso-header-right">
            <div className="ingreso-fecha-wrap">
              <label htmlFor="fechaIngreso">Fecha de recepción</label>
              <input
                type="date"
                id="fechaIngreso"
                value={fecha}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setFecha(e.target.value)}
                className="ingreso-fecha-input"
              />
            </div>
            <div className="ingreso-factura-wrap">
              <label htmlFor="facturaIngreso">Factura</label>
              <input
                type="text"
                id="facturaIngreso"
                maxLength={100}
                value={factura}
                onChange={e => setFactura(e.target.value)}
                className="ingreso-factura-input"
                placeholder="N° de factura"
              />
            </div>
            <div className="ingreso-proveedor-wrap">
              <label htmlFor="proveedorGlobal">Proveedor</label>
              <ProveedorCombobox
                value={proveedor}
                onChange={setProveedor}
                proveedores={proveedores}
              />
            </div>
          </div>
        </div>

        {/* Grilla */}
        <div className="ingreso-grid-wrapper">
          <table className="ingreso-table">
            <thead>
              <tr>
                <th className="col-id">ID Producto <span className="col-optional">(opcional)</span></th>
                <th className="col-name">Nombre Comercial</th>
                <th className="col-narrow">UM</th>
                <th className="col-number">Cantidad</th>
                <th className="col-number">Precio Unit.</th>
                <th className="col-iva">IVA</th>
                <th className="col-total">Total</th>
                <th className="col-del"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const precioUnit = calcPrecioUnit(f);
                return (
                  <tr key={f._key}>
                    <td>
                      <AutocompleteInput
                        value={f.idProducto}
                        onChange={val => update(f._key, 'idProducto', val)}
                        onSelect={p => handleAutocompleteSelect(f._key, p)}
                        suggestions={catalogo}
                        placeholder="PD-001"
                        autoFocus={f._key === newRowKey}
                      />
                    </td>
                    <td>
                      <AutocompleteInput
                        value={f.nombreComercial}
                        onChange={val => update(f._key, 'nombreComercial', val)}
                        onSelect={p => handleAutocompleteSelect(f._key, p)}
                        suggestions={catalogo}
                        placeholder="Nombre"
                      />
                    </td>
                    <td className="col-narrow">
                      <UMCombobox
                        value={f.unidad}
                        onChange={val => update(f._key, 'unidad', val)}
                        unidadesMedida={unidadesMedida}
                      />
                    </td>
                    <td className="col-number">
                      <input
                        type="number" step="0.01" min="0" max="999999"
                        value={f.cantidad}
                        onChange={e => update(f._key, 'cantidad', e.target.value)}
                        placeholder="0"
                      />
                    </td>
                    <td className="col-number col-calculated">
                      {precioUnit > 0
                        ? precioUnit.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                        : <span className="col-empty">—</span>}
                    </td>
                    <td className="col-narrow">
                      <EditableSelect
                        value={f.iva}
                        options={ivaOpciones}
                        onChange={val => {
                          const num = parseFloat(val);
                          update(f._key, 'iva', isNaN(num) ? 0 : num);
                        }}
                        onAddOption={addIva}
                        renderLabel={v => `${v}%`}
                      />
                    </td>
                    <td className="col-total">
                      <input
                        type="number" step="0.01" min="0" max="9999999999"
                        value={f.total}
                        onChange={e => update(f._key, 'total', e.target.value)}
                        placeholder="0.00"
                        className="col-total-input"
                      />
                    </td>
                    <td className="col-del">
                      <button
                        type="button"
                        className="ingreso-row-del"
                        onClick={() => removeFila(f._key)}
                        title="Eliminar fila"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ingreso-add-row-bar">
          <button type="button" className="ingreso-add-row-btn" onClick={addFila}>
            <FiPlus size={13} /> Agregar fila
          </button>
        </div>

        <div className="ingreso-grid-footer">
          <div className="ingreso-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { setFilas([newRow()]); setFactura(''); setProveedor(''); setInvoiceImage(null); if (loadedOrdenId) setStep('list'); setLoadedOrdenId(null); setLoadedOrden(null); }} disabled={saving}>
              <FiX size={15} /> Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={handleGuardarTodo} disabled={saving}>
              <FiCheck size={15} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          {totalGeneral > 0 && (
            <div className="ingreso-totales">
              {ivaTotal > 0 && (
                <div className="ingreso-total-item">
                  <span className="ingreso-total-label">Total IVA</span>
                  <span className="ingreso-total-value ingreso-total-iva">
                    {ivaTotal.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="ingreso-total-item">
                <span className="ingreso-total-label">Total General</span>
                <span className="ingreso-total-value">
                  {totalGeneral.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
        </div>

      </div>

        {/* Panel derecho: Órdenes de Compra */}
        <aside className="ingreso-oc-panel">
          <div className="ingreso-oc-header">
            <FiFileText size={15} />
            <span>Órdenes de Compra</span>
            {ocVisibles.length > 0 && (
              <span className="ingreso-oc-count">{ocVisibles.length}</span>
            )}
          </div>

          {(() => {
            if (ocVisibles.length === 0) return (
              <div className="ingreso-oc-empty">
                <p>Sin órdenes pendientes.</p>
              </div>
            );
            return (
              <div className="ingreso-oc-list">
                {ocVisibles.map(orden => {
                  const isLoaded   = loadedOrdenId === orden.id;
                  const isParcial  = orden.estado === 'recibida_parcialmente';
                  return (
                    <div
                      key={orden.id}
                      className={[
                        'ingreso-oc-card',
                        isLoaded  ? 'ingreso-oc-card--loaded'  : '',
                        isParcial ? 'ingreso-oc-card--parcial' : '',
                      ].join(' ')}
                      onClick={() => loadOrdenIntoForm(orden)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && loadOrdenIntoForm(orden)}
                    >
                      <div className="ingreso-oc-title-row">
                        <span className="ingreso-oc-title">{orden.poNumber || 'OC sin número'}</span>
                        {isParcial && <span className="ingreso-oc-badge-parcial">Parcial</span>}
                      </div>
                      <div className="ingreso-oc-meta">
                        <span>{orden.proveedor || <em>Sin proveedor</em>}</span>
                        <span><FiPackage size={11} /> {Array.isArray(orden.items) ? orden.items.length : 0} prod.</span>
                      </div>
                      <div className="ingreso-oc-fecha">{formatDate(orden.fecha)}</div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </aside>

      </div>}{/* /ingreso-top-layout + step form */}

    </div>

    {/* Modal: Órdenes de Compra */}
    {ocModalOpen && (
      <div className="ingreso-scan-overlay" onClick={e => { if (e.target === e.currentTarget) setOcModalOpen(false); }}>
        <div className="ingreso-oc-modal">
          <div className="ingreso-oc-modal-header">
            <div className="ingreso-oc-modal-title">
              <FiFileText size={16} />
              <span>Órdenes de Compra</span>
              {ocVisibles.length > 0 && (
                <span className="ingreso-oc-count">{ocVisibles.length}</span>
              )}
            </div>
            <button
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setOcModalOpen(false)}
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
          </div>
          <div className="ingreso-oc-modal-body">
            {ocVisibles.length === 0 ? (
              <div className="ingreso-oc-empty">
                <p>Sin órdenes pendientes.</p>
              </div>
            ) : (
              <div className="ingreso-oc-list">
                {ocVisibles.map(orden => {
                  const isLoaded  = loadedOrdenId === orden.id;
                  const isParcial = orden.estado === 'recibida_parcialmente';
                  return (
                    <div
                      key={orden.id}
                      className={[
                        'ingreso-oc-card',
                        isLoaded  ? 'ingreso-oc-card--loaded'  : '',
                        isParcial ? 'ingreso-oc-card--parcial' : '',
                      ].join(' ')}
                      onClick={() => { loadOrdenIntoForm(orden); setOcModalOpen(false); }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && (loadOrdenIntoForm(orden), setOcModalOpen(false))}
                    >
                      <div className="ingreso-oc-title-row">
                        <span className="ingreso-oc-title">{orden.poNumber || 'OC sin número'}</span>
                        {isParcial && <span className="ingreso-oc-badge-parcial">Parcial</span>}
                        {isLoaded  && <span className="ingreso-oc-badge-loaded">Cargada</span>}
                      </div>
                      <div className="ingreso-oc-meta">
                        <span>{orden.proveedor || <em>Sin proveedor</em>}</span>
                        <span><FiPackage size={11} /> {Array.isArray(orden.items) ? orden.items.length : 0} prod.</span>
                      </div>
                      <div className="ingreso-oc-fecha">{formatDate(orden.fecha)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Modal: Escanear factura */}
    {showScan && (
      <div className="ingreso-scan-overlay" onClick={e => { if (e.target === e.currentTarget) setShowScan(false); }}>
        <div className="ingreso-scan-modal">
          <button
            type="button"
            className="ingreso-scan-modal-close"
            onClick={() => setShowScan(false)}
            aria-label="Cerrar"
          >
            <FiX size={18} />
          </button>
          <InvoiceScan
            onDone={() => {}}
            onProductsScanned={handleProductsScanned}
          />
        </div>
      </div>
    )}

    {/* Lightbox: imagen de factura */}
    {lightboxSrc && (
      <div className="ingreso-scan-overlay" onClick={e => { if (e.target === e.currentTarget) setLightboxSrc(null); }}>
        <div className="factura-lightbox-inner">
          <button
            type="button"
            className="ingreso-scan-modal-close"
            onClick={() => setLightboxSrc(null)}
            aria-label="Cerrar"
          >
            <FiX size={18} />
          </button>
          <img src={lightboxSrc} alt="Imagen de factura" className="factura-lightbox-img" />
        </div>
      </div>
    )}
    </>
  );
}

export default Recepcion;
