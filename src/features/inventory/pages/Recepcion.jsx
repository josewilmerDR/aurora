import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import '../styles/agroquimicos.css';
import { FiPlus, FiCheck, FiX, FiFileText, FiPackage, FiCpu, FiImage, FiList, FiAlertTriangle, FiDroplet } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import PortalCombobox from '../../../components/ui/PortalCombobox';
import { compressImage, MAX_IMAGE_SIZE } from '../../../lib/image';
import { newRow, nextRowKey, calcPrecioUnit, calcIvaAmount, formatDate } from '../lib/recepcion';

// ── Autocompletado de productos (id o nombre) ──────────────────────────────
function AutocompleteInput({ value, onChange, onSelect, suggestions, placeholder, autoFocus }) {
  const items = !value.trim()
    ? []
    : suggestions.filter(p =>
        p.idProducto?.toLowerCase().includes(value.toLowerCase()) ||
        p.nombreComercial?.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 7);
  return (
    <div className="ac-wrap">
      <PortalCombobox
        value={value}
        onType={onChange}
        items={items}
        onPick={onSelect}
        getItemKey={p => p.id}
        placeholder={placeholder}
        autoFocus={autoFocus}
        openOnFocus={false}
        minWidth={280}
        dropdownClassName="ac-dropdown"
        itemClassName=""
        itemActiveClassName="ac-dropdown-item--active"
        renderItem={p => (
          <>
            <span className="ac-id">{p.idProducto}</span>
            <span className="ac-name">{p.nombreComercial}</span>
            <span className="ac-unit">{p.unidad}</span>
          </>
        )}
      />
    </div>
  );
}

// ── Selector con opción "Nuevo" ────────────────────────────────────────────
function EditableSelect({ value, options, onChange, onAddOption, renderLabel }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const confirmedRef = useRef(false); // evita doble confirm (Enter + blur)

  const handleSelectChange = (e) => {
    if (e.target.value === '__nuevo__') {
      setAdding(true);
      setDraft('');
      confirmedRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onChange(e.target.value);
    }
  };

  const confirm = () => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
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
    if (e.key === 'Escape') { confirmedRef.current = true; setAdding(false); setDraft(''); }
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

// ── Card de OC reutilizable (panel lateral + modal) ────────────────────────
function OcCard({ orden, isLoaded, isParcial, onClick }) {
  return (
    <div
      className={[
        'ingreso-oc-card',
        isLoaded ? 'ingreso-oc-card--loaded' : '',
        isParcial ? 'ingreso-oc-card--parcial' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="ingreso-oc-title-row">
        <span className="ingreso-oc-title">{orden.poNumber || 'OC sin número'}</span>
        {isParcial && <span className="ingreso-oc-badge-parcial">Parcial</span>}
        {isLoaded && <span className="ingreso-oc-badge-loaded">Cargada</span>}
      </div>
      <div className="ingreso-oc-meta">
        <span>{orden.proveedor || <em>Sin proveedor</em>}</span>
        <span><FiPackage size={11} /> {Array.isArray(orden.items) ? orden.items.length : 0} prod.</span>
      </div>
      <div className="ingreso-oc-fecha">{formatDate(orden.fecha)}</div>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────
function Recepcion() {
  const apiFetch = useApiFetch();
  const location = useLocation();
  const toast = useToast();

  const [filas, setFilas] = useState([newRow()]);
  const [factura, setFactura] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0]);
  const [proveedor, setProveedor] = useState('');
  const [saving, setSaving] = useState(false);
  const [catalogo, setCatalogo] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [editandoRecepcion, setEditandoRecepcion] = useState(null);
  const [unidadesMedida, setUnidadesMedida] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [ordenesError, setOrdenesError] = useState(false);
  const [loadedOrdenId, setLoadedOrdenId] = useState(null);
  const [loadedOrden, setLoadedOrden] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [ocModalOpen, setOcModalOpen] = useState(false);
  const [step, setStep] = useState('form');
  const [invoiceImage, setInvoiceImage] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [confirmLimpiar, setConfirmLimpiar] = useState(false);
  const [newRowKey, setNewRowKey] = useState(null);
  const [ivaOpciones, setIvaOpciones] = useState([0, 4, 8, 13, 15]);

  const imageFileInputRef = useRef(null);
  const scanFileInputRef = useRef(null);
  const lightboxCloseRef = useRef(null);
  const ocModalCloseRef = useRef(null);

  const showToast = useCallback((msg, type = 'success', opts) => {
    if (type === 'error') toast.error(msg, opts);
    else toast.success(msg, opts);
  }, [toast]);

  // Índice id→producto: evita catalogo.find() O(N) por línea escaneada/OC.
  const catalogoById = useMemo(() => {
    const m = new Map();
    for (const p of catalogo) m.set(p.id, p);
    return m;
  }, [catalogo]);

  const ocVisibles = useMemo(
    () => ordenes.filter(o => o.estado !== 'recibida' && o.estado !== 'completada' && o.estado !== 'cancelada'),
    [ordenes]
  );

  // ESC cierra el modal/overlay innermost.
  useEscapeClose(lightboxSrc ? () => setLightboxSrc(null) : null);
  useEscapeClose(ocModalOpen ? () => setOcModalOpen(false) : null);

  // Mover el foco al botón cerrar al abrir modal/lightbox (a11y).
  useEffect(() => { if (lightboxSrc) lightboxCloseRef.current?.focus(); }, [lightboxSrc]);
  useEffect(() => { if (ocModalOpen) ocModalCloseRef.current?.focus(); }, [ocModalOpen]);

  // Limpia newRowKey tras el autoFocus inicial para que no recapture el foco
  // si la fila se remonta más tarde.
  useEffect(() => {
    if (newRowKey == null) return;
    const t = setTimeout(() => setNewRowKey(null), 120);
    return () => clearTimeout(t);
  }, [newRowKey]);

  // ── Carga de datos (re-disparable; depende de apiFetch → re-fetch al cambiar finca) ──
  const fetchOrdenes = useCallback(() => {
    return apiFetch('/api/ordenes-compra')
      .then(r => { if (!r.ok) throw new Error('ordenes'); return r.json(); })
      .then(d => { setOrdenes(Array.isArray(d) ? d : []); setOrdenesError(false); })
      .catch(() => setOrdenesError(true));
  }, [apiFetch]);

  const fetchData = useCallback(() => {
    const safe = (url, setter, label) =>
      apiFetch(url)
        .then(r => { if (!r.ok) throw new Error(label); return r.json(); })
        .then(d => setter(Array.isArray(d) ? d : []))
        .catch(() => showToast(`No se pudo cargar ${label}.`, 'error'));
    safe('/api/productos', setCatalogo, 'el catálogo de productos');
    safe('/api/proveedores', setProveedores, 'los proveedores');
    safe('/api/unidades-medida', setUnidadesMedida, 'las unidades de medida');
    fetchOrdenes();
  }, [apiFetch, fetchOrdenes, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Hidratación desde navegación (editProducto / editandoRecepcion) ──
  // Separado del fetch: depende de location.key para re-procesar si el usuario
  // re-entra a la página con otro state sin desmontar.
  useEffect(() => {
    if (location.state?.editProducto) {
      const p = location.state.editProducto;
      const cant = parseFloat(p.stockActual) || 0;
      const precio = parseFloat(p.precioUnitario) || 0;
      setFilas([{
        ...newRow(),
        idProducto: p.idProducto || '',
        nombreComercial: p.nombreComercial || '',
        unidad: p.unidad || 'L',
        cantidad: cant > 0 ? String(cant) : '',
        total: cant > 0 && precio > 0 ? String(cant * precio) : '',
        iva: 0,
      }]);
      setProveedor(p.proveedor || '');
      window.scrollTo(0, 0);
    } else if (location.state?.editandoRecepcion) {
      const ed = location.state.editandoRecepcion;
      setEditandoRecepcion({ originalShortId: ed.originalShortId });
      if (ed.fecha) setFecha(ed.fecha);
      setFactura(ed.factura || '');
      setProveedor(ed.proveedor || '');
      const filasCargadas = (ed.items || []).map(it => {
        const cant = parseFloat(it.cantidad) || 0;
        const precio = parseFloat(it.precioUnitario) || 0;
        return {
          ...newRow(),
          idProducto: it.idProducto || '',
          nombreComercial: it.nombreComercial || '',
          unidad: it.unidad || 'L',
          cantidad: cant > 0 ? String(cant) : '',
          total: cant > 0 && precio > 0 ? String(cant * precio) : '',
          iva: 0,
        };
      });
      if (filasCargadas.length > 0) setFilas(filasCargadas);
      window.scrollTo(0, 0);
    }
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProductsScanned = (lineas, catalogoEscaneado, imgData) => {
    const escaneadoById = new Map((catalogoEscaneado || []).map(p => [p.id, p]));
    const newFilas = lineas
      .map(linea => {
        const cat = catalogoById.get(linea.productoId) || escaneadoById.get(linea.productoId);
        return {
          _key: nextRowKey(),
          idProducto: cat?.idProducto || linea.idProducto || '',
          nombreComercial: cat?.nombreComercial || linea.nombreComercial || linea.nombreFactura || '',
          unidad: cat?.unidad || linea.unidad || linea.unidadFactura || 'L',
          cantidad: String(linea.cantidadIngresada || linea.cantidadFactura || ''),
          total: linea.subtotalLinea != null ? String(linea.subtotalLinea) : '',
          iva: cat?.iva != null ? cat.iva : 0,
          cantidadOC: '',
        };
      })
      .filter(f => f.nombreComercial.trim());

    if (newFilas.length === 0) {
      showToast('No se encontraron productos en la factura.', 'error');
    } else {
      setFilas(newFilas);
      showToast(`${newFilas.length} producto(s) cargado(s) desde la factura. Revisa y guarda.`);
    }
    if (imgData) setInvoiceImage(imgData);
  };

  const handleScanFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Solo se aceptan archivos de imagen.', 'error'); return; }
    if (file.size > MAX_IMAGE_SIZE) { showToast('La imagen no debe superar 10 MB.', 'error'); return; }
    setScanning(true);
    try {
      const imgData = await compressImage(file);
      const res = await apiFetch('/api/compras/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imgData.base64, mediaType: imgData.mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error del servidor');

      const lineasNormalizadas = (data.lineas || []).map(l => ({
        productoId: l.productoId || null,
        nombreFactura: l.nombreFactura || '',
        cantidadFactura: l.cantidadFactura ?? 0,
        unidadFactura: l.unidadFactura || '',
        notas: l.notas || '',
        cantidadIngresada: l.cantidadCatalogo ?? l.cantidadFactura ?? 0,
        unidad: l.unidadCatalogo || l.unidadFactura || 'L',
        subtotalLinea: l.subtotalLinea ?? null,
        idProducto: '',
        nombreComercial: l.nombreFactura || '',
      }));

      handleProductsScanned(lineasNormalizadas, data.catalogo || [], imgData);
    } catch (err) {
      showToast(err.message || 'Error al escanear la factura.', 'error');
    } finally {
      setScanning(false);
    }
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

  const handleAutocompleteSelect = (rowKey, producto) => {
    setFilas(prev => prev.map(f => f._key === rowKey ? {
      ...f,
      idProducto: producto.idProducto || f.idProducto,
      nombreComercial: producto.nombreComercial || f.nombreComercial,
      unidad: producto.unidad || f.unidad,
      iva: producto.iva != null ? producto.iva : f.iva,
    } : f));
  };

  const loadOrdenIntoForm = (orden) => {
    const items = orden.items || [];
    const filasCargadas = items
      .map(item => {
        const cat = catalogoById.get(item.productoId);
        const ordered = parseFloat(item.cantidad) || 0;
        const received = parseFloat(item.cantidadRecibida) || 0;
        const remaining = Math.max(0, ordered - received);
        if (remaining <= 0) return null;
        const precio = parseFloat(item.precioUnitario) || 0;
        return {
          _key: nextRowKey(),
          idProducto: cat?.idProducto || '',
          nombreComercial: item.nombreComercial || cat?.nombreComercial || '',
          unidad: item.unidad || cat?.unidad || 'L',
          cantidad: String(remaining),
          total: precio > 0 ? String(remaining * precio) : '',
          iva: item.iva ?? cat?.iva ?? 0,
          cantidadOC: ordered,   // cantidad ordenada original → conciliación backend
        };
      })
      .filter(Boolean);
    if (filasCargadas.length === 0) {
      showToast('Esta OC ya fue recibida por completo.', 'error');
      return;
    }
    setFilas(filasCargadas);
    if (orden.proveedor) setProveedor(orden.proveedor);
    setLoadedOrdenId(orden.id);
    setLoadedOrden(orden);
    setStep('form');
  };

  const update = (key, field, value) =>
    setFilas(prev => prev.map(f => f._key === key ? { ...f, [field]: value } : f));

  const addFila = () => {
    const row = newRow();
    setFilas(prev => [...prev, row]);
    setNewRowKey(row._key);
  };

  const removeFila = (key) =>
    setFilas(prev => prev.length > 1 ? prev.filter(f => f._key !== key) : prev);

  const subtotal = filas.reduce((sum, f) => sum + (parseFloat(f.total) || 0), 0);
  const ivaTotal = filas.reduce((sum, f) => sum + calcIvaAmount(f), 0);
  const totalGeneral = subtotal + ivaTotal;

  // ¿Hay datos que valga la pena confirmar antes de descartar?
  const hayDatos = filas.some(f => f.nombreComercial.trim() || f.idProducto.trim() || f.total)
    || !!invoiceImage || !!proveedor || !!factura;

  const doLimpiar = () => {
    setFilas([newRow()]);
    setFactura('');
    setProveedor('');
    setInvoiceImage(null);
    if (loadedOrdenId) setStep('list');
    setLoadedOrdenId(null);
    setLoadedOrden(null);
    setEditandoRecepcion(null);
    setConfirmLimpiar(false);
  };

  const handleLimpiarClick = () => {
    if (hayDatos) setConfirmLimpiar(true);
    else doLimpiar();
  };

  const handleGuardarTodo = async () => {
    const conNombre = filas.filter(f => f.nombreComercial.trim());
    const validas = conNombre.filter(f => (parseFloat(f.cantidad) || 0) > 0);
    if (validas.length === 0) {
      showToast('Completa Nombre Comercial y una Cantidad mayor a 0 en al menos una fila.', 'error');
      return;
    }
    const ignoradas = conNombre.length - validas.length;
    setSaving(true);

    try {
      const res = await apiFetch('/api/ingreso/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validas.map(f => ({
            idProducto: f.idProducto.trim(),
            nombreComercial: f.nombreComercial.trim(),
            unidad: f.unidad,
            cantidad: parseFloat(f.cantidad) || 0,
            cantidadOC: parseFloat(f.cantidadOC) || 0,
            precioUnitario: calcPrecioUnit(f),
            iva: f.iva ?? 0,
          })),
          proveedor,
          fecha,
          facturaNumero: factura,
          ordenCompraId: loadedOrdenId || null,
          ocPoNumber: loadedOrden?.poNumber || '',
          imageBase64: invoiceImage?.base64 || null,
          mediaType: invoiceImage?.mediaType || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error');

      if (loadedOrden) fetchOrdenes();

      const backToList = !!loadedOrden;
      const wasEditando = editandoRecepcion;
      setFilas([newRow()]);
      setFactura('');
      setProveedor('');
      setLoadedOrdenId(null);
      setLoadedOrden(null);
      setInvoiceImage(null);
      setEditandoRecepcion(null);
      if (backToList) setStep('list');

      if (wasEditando) {
        // Evento contable importante (la original quedó anulada): toast persistente.
        showToast(`Recepción re-registrada. La original (${wasEditando.originalShortId}) queda anulada.`, 'success', { duration: 8000 });
      } else {
        const detalle = [
          data.creados > 0 && `${data.creados} creado(s)`,
          data.mergeados > 0 && `${data.mergeados} stock actualizado`,
        ].filter(Boolean).join(' · ') || 'Ingreso registrado.';
        showToast(ignoradas > 0 ? `${detalle}. ${ignoradas} fila(s) sin cantidad fueron ignoradas.` : detalle);
      }
    } catch (err) {
      showToast(err.message || 'Error al registrar el ingreso.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Empty / error del panel de órdenes (compartido panel + modal).
  const renderOcEmpty = () => (
    ordenesError ? (
      <EmptyState
        variant="compact"
        icon={FiAlertTriangle}
        title="No se pudieron cargar las órdenes."
        action={<button className="aur-btn-pill" onClick={fetchOrdenes}>Reintentar</button>}
      />
    ) : (
      <div className="ingreso-oc-empty"><p>Sin órdenes pendientes.</p></div>
    )
  );

  return (
    <>
    <div className="lote-management-layout">
      {(step !== 'list' || ocVisibles.length > 0) && (
      <div className="ingreso-title-row">
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
        <Link
          to="/bodega/agroquimicos/existencias"
          className="aur-chip"
          style={{ marginLeft: 'auto' }}
        >
          <FiDroplet size={14} /> Existencias
        </Link>
        <Link
          to="/bodega/agroquimicos/movimientos?tab=ingresos"
          className="aur-chip"
        >
          <FiList size={14} /> Historial
        </Link>
      </div>
      )}

      {editandoRecepcion && step === 'form' && (
        <div className="ingreso-editando-banner">
          <FiFileText size={14} />
          <span>
            Editando — la recepción <strong>{editandoRecepcion.originalShortId}</strong> fue anulada.
            Guarda para registrarla de nuevo.
          </span>
          <button
            type="button"
            className="ingreso-editando-dismiss"
            onClick={() => setEditandoRecepcion(null)}
            aria-label="Quitar aviso"
            title="Quitar aviso"
          >
            <FiX size={14} />
          </button>
        </div>
      )}

      {/* ── Vista lista ── */}
      {step === 'list' && ocVisibles.length > 0 && (
          <div className="ingreso-oc-list-view">
            <p className="ingreso-oc-list-legend">
              Estas son las órdenes de compra abiertas (generadas desde las solicitudes
              de compra). Elegí una para conciliar lo recibido contra lo ordenado, o
              registrá una entrada manual.
              {' '}
              <Link to="/procurement/ordenes/historial" className="ingreso-oc-legend-link">
                Ver órdenes en Compras
              </Link>
            </p>
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
              onClick={() => scanFileInputRef.current?.click()}
              disabled={scanning}
              title="Toma una foto de la factura y se extraen los productos."
            >
              <FiCpu size={14} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
            </button>
            <input
              ref={scanFileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleScanFile}
            />
            <label
              className={`ingreso-scan-btn ingreso-attach-label${invoiceImage ? ' ingreso-attach-label--active' : ''}`}
              htmlFor="invoiceImageInput"
              title="Adjuntar foto de la factura"
            >
              <FiImage size={14} /> Adjuntar
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
                <button
                  type="button"
                  className="ingreso-image-thumb-btn"
                  onClick={() => setLightboxSrc(invoiceImage.previewUrl)}
                  aria-label="Ver imagen de factura adjunta"
                  title="Ver imagen adjunta"
                >
                  <img
                    src={invoiceImage.previewUrl}
                    alt="Factura adjunta"
                    className="ingreso-image-thumb"
                  />
                </button>
                <button
                  type="button"
                  className="ingreso-image-remove"
                  onClick={() => setInvoiceImage(null)}
                  aria-label="Quitar imagen adjunta"
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
              <PortalCombobox
                value={proveedor}
                onType={setProveedor}
                items={proveedores.filter(p => !proveedor || p.nombre.toLowerCase().includes(proveedor.toLowerCase()))}
                onPick={p => setProveedor(p.nombre)}
                getItemKey={p => p.id}
                inputId="proveedorGlobal"
                inputClassName="ingreso-proveedor-input"
                placeholder="Nombre del proveedor"
                renderItem={p => p.nombre}
              />
            </div>
          </div>
        </div>

        {/* Grilla */}
        <div className="ingreso-grid-wrapper">
          <table className="ingreso-table">
            <thead>
              <tr>
                <th className="col-id">ID Producto</th>
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
                      <PortalCombobox
                        value={f.unidad}
                        onType={val => update(f._key, 'unidad', val)}
                        items={unidadesMedida.filter(u => !f.unidad || u.nombre.toLowerCase().includes(f.unidad.toLowerCase()))}
                        onPick={u => update(f._key, 'unidad', u.nombre)}
                        getItemKey={u => u.id}
                        inputClassName="ingreso-um-input"
                        placeholder="UM"
                        minWidth={140}
                        renderItem={u => (
                          <>
                            <span className="um-nombre">{u.nombre}</span>
                            {u.descripcion && <span className="um-desc">{u.descripcion}</span>}
                          </>
                        )}
                      />
                    </td>
                    <td className="col-number">
                      <input
                        type="number" step="0.01" min="0"
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
                        type="number" step="0.01" min="0"
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
                        aria-label="Eliminar fila"
                        title="Eliminar fila"
                      >
                        <FiX size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ingreso-add-row-tr">
                <td colSpan={8}>
                  <button type="button" className="ingreso-add-row-btn" onClick={addFila}>
                    <FiPlus size={13} /> Agregar fila
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="ingreso-grid-footer">
          {totalGeneral > 0 && (
            <div className="ingreso-totales">
              {ivaTotal > 0 && (
                <div className="ingreso-total-item">
                  <span className="ingreso-total-label">Total IVA:</span>
                  <span className="ingreso-total-value ingreso-total-iva">
                    {ivaTotal.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="ingreso-total-item">
                <span className="ingreso-total-label">Total General:</span>
                <span className="ingreso-total-value">
                  {totalGeneral.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
          <div className="ingreso-footer-actions">
            <button type="button" className="aur-btn-text" onClick={handleLimpiarClick} disabled={saving}>
              <FiX size={15} /> Limpiar
            </button>
            <button type="button" className="aur-btn-pill" onClick={handleGuardarTodo} disabled={saving}>
              <FiCheck size={15} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
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

          {ocVisibles.length === 0 ? renderOcEmpty() : (
            <div className="ingreso-oc-list">
              {ocVisibles.map(orden => (
                <OcCard
                  key={orden.id}
                  orden={orden}
                  isLoaded={loadedOrdenId === orden.id}
                  isParcial={orden.estado === 'recibida_parcialmente'}
                  onClick={() => loadOrdenIntoForm(orden)}
                />
              ))}
            </div>
          )}
        </aside>

      </div>}{/* /ingreso-top-layout + step form */}

    </div>

    {/* Modal: Órdenes de Compra */}
    {ocModalOpen && (
      <div className="ingreso-scan-overlay" onClick={e => { if (e.target === e.currentTarget) setOcModalOpen(false); }}>
        <div className="ingreso-oc-modal" role="dialog" aria-modal="true" aria-label="Órdenes de Compra">
          <div className="ingreso-oc-modal-header">
            <div className="ingreso-oc-modal-title">
              <FiFileText size={16} />
              <span>Órdenes de Compra</span>
              {ocVisibles.length > 0 && (
                <span className="ingreso-oc-count">{ocVisibles.length}</span>
              )}
            </div>
            <button
              ref={ocModalCloseRef}
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setOcModalOpen(false)}
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
          </div>
          <div className="ingreso-oc-modal-body">
            {ocVisibles.length === 0 ? renderOcEmpty() : (
              <div className="ingreso-oc-list">
                {ocVisibles.map(orden => (
                  <OcCard
                    key={orden.id}
                    orden={orden}
                    isLoaded={loadedOrdenId === orden.id}
                    isParcial={orden.estado === 'recibida_parcialmente'}
                    onClick={() => { loadOrdenIntoForm(orden); setOcModalOpen(false); }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Lightbox: imagen de factura */}
    {lightboxSrc && (
      <div className="ingreso-scan-overlay" onClick={e => { if (e.target === e.currentTarget) setLightboxSrc(null); }}>
        <div className="factura-lightbox-inner" role="dialog" aria-modal="true" aria-label="Imagen de factura">
          <button
            ref={lightboxCloseRef}
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

    {confirmLimpiar && (
      <AuroraConfirmModal
        danger
        title="Descartar la recepción"
        body={`Vas a descartar ${filas.filter(f => f.nombreComercial.trim()).length || 'las'} línea(s) cargada(s)${invoiceImage ? ' y la imagen adjunta' : ''}. Esta acción no se puede deshacer.`}
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        onConfirm={doLimpiar}
        onCancel={() => setConfirmLimpiar(false)}
      />
    )}
    </>
  );
}

export default Recepcion;
