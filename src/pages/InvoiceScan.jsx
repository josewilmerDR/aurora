import { useState, useRef } from 'react';
import {
  FiCamera, FiX, FiCheck, FiAlertCircle,
  FiCpu, FiChevronLeft, FiChevronRight, FiPlus,
} from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './InvoiceScan.css';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const UNIDADES = ['L', 'mL', 'kg', 'g'];
const MONEDAS = ['USD', 'EUR', 'CRC', 'COP', 'MXN', 'BRL', 'PEN', 'GTQ', 'HNL', 'NIO'];

const MAX_IMAGE_PX = 1600;

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

const emptyNuevoProducto = {
  idProducto: '',
  nombreComercial: '',
  ingredienteActivo: '',
  tipo: '',
  plagaQueControla: '',
  periodoReingreso: '',
  periodoACosecha: '',
  stockMinimo: '',
  moneda: 'USD',
  tipoCambio: 1,
  precioUnitario: '',
};

function InvoiceScan({ onDone, onImageScanned, onProductsScanned } = {}) {
  const apiFetch = useApiFetch();
  const [step, setStep] = useState('upload');
  const [imageData, setImageData] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  const [lineas, setLineas] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [proveedor, setProveedor] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  const fileInputRef = useRef(null);

  // ── Touch / swipe ──────────────────────────────────────────────────────────
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    // Solo swipe horizontal (evita conflicto con scroll vertical)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48) {
      if (dx > 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  // ── Navegación del carrusel ────────────────────────────────────────────────
  const goNext = () => setCurrentIndex(i => Math.min(i + 1, lineas.length - 1));
  const goPrev = () => setCurrentIndex(i => Math.max(i - 1, 0));

  // ── Paso 1: cargar imagen ──────────────────────────────────────────────────
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setScanError(null);
    try { setImageData(await compressImage(file)); }
    catch { setScanError('No se pudo procesar la imagen. Intenta con otro archivo.'); }
    e.target.value = '';
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    setScanError(null);
    try { setImageData(await compressImage(file)); }
    catch { setScanError('No se pudo procesar la imagen.'); }
  };

  const handleScan = async () => {
    if (!imageData) return;
    setScanning(true);
    setScanError(null);
    try {
      const res = await apiFetch('/api/compras/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageData.base64, mediaType: imageData.mediaType }),
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
        ...emptyNuevoProducto,
        nombreComercial: l.nombreFactura || '',
      }));

      if (onProductsScanned) {
        onProductsScanned(lineasNormalizadas, data.catalogo || [], imageData);
      } else {
        setLineas(lineasNormalizadas);
        setCatalogo(data.catalogo || []);
        setCurrentIndex(0);
        setStep('review');
        onImageScanned?.(imageData);
      }
    } catch (err) {
      setScanError(err.message || 'Error al escanear la factura.');
    } finally {
      setScanning(false);
    }
  };

  // ── Paso 2: editar líneas ──────────────────────────────────────────────────
  const updateLinea = (index, field, value) => {
    setLineas(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === 'productoId') {
        const prod = catalogo.find(p => p.id === value);
        if (prod) next[index].unidad = prod.unidad;
      }
      return next;
    });
  };

  const removeLinea = (index) => {
    const newLineas = lineas.filter((_, i) => i !== index);
    setLineas(newLineas);
    setCurrentIndex(i => Math.min(i, Math.max(0, newLineas.length - 1)));
  };

  const addLinea = () => {
    const newLineas = [...lineas, {
      productoId: null,
      nombreFactura: '',
      cantidadFactura: 0,
      unidadFactura: '',
      notas: '',
      cantidadIngresada: 0,
      unidad: 'L',
      ...emptyNuevoProducto,
    }];
    setLineas(newLineas);
    setCurrentIndex(newLineas.length - 1); // Ir al nuevo
  };

  // ── Paso 3: confirmar ──────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (lineas.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch('/api/compras/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageData?.base64 || null,
          mediaType: imageData?.mediaType || null,
          proveedor,
          fecha,
          lineas,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar');
      setSaveResult(data);
      setStep('done');
      onDone?.();
    } catch (err) {
      setSaveError(err.message || 'Error al registrar la compra.');
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    setStep('upload');
    setImageData(null);
    setLineas([]);
    setCatalogo([]);
    setCurrentIndex(0);
    setProveedor('');
    setFecha(new Date().toISOString().split('T')[0]);
    setScanError(null);
    setSaveError(null);
    setSaveResult(null);
  };

  const matchedCount = lineas.filter(l => l.productoId).length;
  const unmatchedCount = lineas.length - matchedCount;
  const linea = lineas[currentIndex]; // línea actualmente visible

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="invoice-scan-layout">


      {/* ══════ STEP 1: UPLOAD ══════ */}
      {step === 'upload' && (
        <div className="scan-card">
          <h2>Escanear Factura con IA</h2>
          <p className="scan-description">
            Sube una foto de la factura. Aurora extraerá los productos y cantidades
            y los asociará con tu catálogo de bodega automáticamente.
          </p>

          <div
            className={`drop-zone ${imageData ? 'has-image' : ''}`}
            onClick={() => !imageData && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {imageData ? (
              <div className="drop-zone-preview">
                <img src={imageData.previewUrl} alt="Vista previa" className="preview-img" />
                <button
                  type="button"
                  className="preview-remove"
                  onClick={(e) => { e.stopPropagation(); setImageData(null); setScanError(null); }}
                >
                  <FiX size={16} />
                </button>
              </div>
            ) : (
              <div className="drop-zone-empty">
                <FiCamera size={40} className="drop-icon" />
                <p className="drop-text">Haz clic aquí para agregar una imagen, o arrástrala y suéltala</p>
                <p className="drop-hint">JPG, PNG, WebP — máx. ~4 MB</p>
              </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelect} />

          {scanError && <div className="scan-error"><FiAlertCircle size={16} />{scanError}</div>}

          <div className="scan-actions">
            <button type="button" className="btn btn-ia btn-scan" onClick={handleScan} disabled={!imageData || scanning}>
              <FiCpu size={15} />{scanning ? 'Leyendo…' : 'Leer con IA'}
            </button>
          </div>

          {scanning && (
            <div className="scanning-indicator">
              <div className="scanning-pulse" />
              Procesando imagen — esto puede tomar unos segundos…
            </div>
          )}
        </div>
      )}

      {/* ══════ STEP 2: REVIEW (CARRUSEL) ══════ */}
      {step === 'review' && (
        <div className="scan-card scan-card-wide">

          {/* Encabezado */}
          <div className="review-header">
            <div>
              <h2>Revisar Productos Extraídos</h2>
              <p className="scan-description">
                La IA identificó <strong>{lineas.length}</strong> línea(s).
                {matchedCount > 0 && <span className="match-ok"> {matchedCount} asociada(s) al catálogo.</span>}
                {unmatchedCount > 0 && <span className="match-warn"> {unmatchedCount} sin asociar — completa los datos para crear nuevo producto.</span>}
              </p>
            </div>
            {imageData && <img src={imageData.previewUrl} alt="Factura" className="review-thumbnail" />}
          </div>

          {/* Proveedor + Fecha */}
          <div className="compra-meta">
            <div className="form-control">
              <label htmlFor="proveedor">Proveedor</label>
              <input id="proveedor" value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor" />
            </div>
            <div className="form-control">
              <label htmlFor="fechaCompra">Fecha de compra</label>
              <input id="fechaCompra" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>

          {/* ── CARRUSEL ── */}
          {lineas.length > 0 && linea ? (
            <div className="carousel-wrapper">

              {/* Barra superior: contador + badge de estado + barra de progreso */}
              <div className="carousel-topbar">
                <div className="carousel-counter">
                  <span className="carousel-pos">
                    <strong>{currentIndex + 1}</strong>
                    <span className="carousel-total"> / {lineas.length}</span>
                  </span>
                  <span className={`carousel-status ${linea.productoId ? 'status-matched' : 'status-new'}`}>
                    {linea.productoId ? '● Asociado al catálogo' : '● Producto nuevo'}
                  </span>
                </div>
                <div className="carousel-progress-track">
                  <div
                    className="carousel-progress-fill"
                    style={{ width: `${((currentIndex + 1) / lineas.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Fila principal: flecha izquierda + slide + flecha derecha */}
              <div className="carousel-main">
                <button
                  type="button"
                  className="carousel-arrow"
                  onClick={goPrev}
                  disabled={currentIndex === 0}
                  aria-label="Producto anterior"
                >
                  <FiChevronLeft size={22} />
                </button>

                <div
                  className="carousel-track-wrapper"
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  <div
                    className="carousel-track"
                    style={{ transform: `translateX(-${currentIndex * 100}%)` }}
                  >
                    {lineas.map((l, i) => (
                      <div key={i} className="carousel-slide">
                        <div className={`linea-card ${l.productoId ? 'linea-matched' : 'linea-unmatched'}`}>

                          {/* Cabecera del card */}
                          <div className="linea-card-header">
                            <div className="linea-header-info">
                              <span className="linea-nombre-header">{l.nombreFactura || `Línea ${i + 1}`}</span>
                              {l.cantidadFactura > 0 && (
                                <span className="linea-original-badge">{l.cantidadFactura} {l.unidadFactura}</span>
                              )}
                              {l.notas && <span className="linea-notas-header">{l.notas}</span>}
                            </div>
                            <button
                              type="button"
                              className="icon-btn delete"
                              onClick={() => removeLinea(i)}
                              title="Quitar línea"
                            >
                              <FiX size={15} />
                            </button>
                          </div>

                          {/* Asociar al catálogo */}
                          <div className="linea-asociar-row">
                            <div className="form-control">
                              <label>Asociar a producto existente en bodega</label>
                              <select
                                value={l.productoId || ''}
                                onChange={e => updateLinea(i, 'productoId', e.target.value || null)}
                                className={l.productoId ? 'select-matched' : 'select-unmatched'}
                              >
                                <option value="">— Crear como producto nuevo —</option>
                                {catalogo.map(p => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombreComercial} ({p.unidad}) · Stock: {p.stockActual}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {/* ── CASO A: Asociado → solo cantidad ── */}
                          {l.productoId ? (
                            <div className="linea-matched-fields">
                              <div className="form-control">
                                <label>Cantidad a agregar al stock</label>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={l.cantidadIngresada}
                                  onChange={e => updateLinea(i, 'cantidadIngresada', e.target.value)}
                                />
                              </div>
                              <div className="form-control">
                                <label>Unidad</label>
                                <input value={l.unidad} readOnly className="input-readonly" />
                              </div>
                            </div>

                          ) : (
                            /* ── CASO B: Nuevo → formulario completo ── */
                            <>
                              <p className="linea-section-title">Ficha Técnica del Nuevo Producto</p>
                              <div className="form-grid product-form-grid">
                                <div className="form-control">
                                  <label>ID de Producto</label>
                                  <input value={l.idProducto} onChange={e => updateLinea(i, 'idProducto', e.target.value)} placeholder="Ej: PD-011" />
                                </div>
                                <div className="form-control">
                                  <label>Nombre Comercial</label>
                                  <input value={l.nombreComercial} onChange={e => updateLinea(i, 'nombreComercial', e.target.value)} required />
                                </div>
                                <div className="form-control">
                                  <label>Ingrediente Activo</label>
                                  <input value={l.ingredienteActivo} onChange={e => updateLinea(i, 'ingredienteActivo', e.target.value)} required />
                                </div>
                                <div className="form-control">
                                  <label>Tipo</label>
                                  <select value={l.tipo} onChange={e => updateLinea(i, 'tipo', e.target.value)}>
                                    <option value="">-- Seleccionar --</option>
                                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                                  </select>
                                </div>
                                <div className="form-control form-control-wide">
                                  <label>Plaga que Controla</label>
                                  <input value={l.plagaQueControla} onChange={e => updateLinea(i, 'plagaQueControla', e.target.value)} />
                                </div>
                                <div className="form-control">
                                  <label>Período Reingreso (horas)</label>
                                  <input type="number" min="0" value={l.periodoReingreso} onChange={e => updateLinea(i, 'periodoReingreso', e.target.value)} />
                                </div>
                                <div className="form-control">
                                  <label>Período a Cosecha (días)</label>
                                  <input type="number" min="0" value={l.periodoACosecha} onChange={e => updateLinea(i, 'periodoACosecha', e.target.value)} />
                                </div>
                                <div className="form-control">
                                  <label>Unidad</label>
                                  <select value={l.unidad} onChange={e => updateLinea(i, 'unidad', e.target.value)}>
                                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                                  </select>
                                </div>
                                <div className="form-control">
                                  <label>Cantidad Ingresada (Stock Inicial)</label>
                                  <input type="number" step="0.01" min="0" value={l.cantidadIngresada} onChange={e => updateLinea(i, 'cantidadIngresada', e.target.value)} />
                                </div>
                                <div className="form-control">
                                  <label>Stock Mínimo</label>
                                  <input type="number" step="0.01" min="0" value={l.stockMinimo} onChange={e => updateLinea(i, 'stockMinimo', e.target.value)} />
                                </div>
                              </div>

                              <p className="linea-section-title" style={{ marginTop: '16px' }}>Información Comercial</p>
                              <div className="form-grid product-form-grid">
                                <div className="form-control">
                                  <label>Moneda</label>
                                  <select value={l.moneda} onChange={e => updateLinea(i, 'moneda', e.target.value)}>
                                    {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </div>
                                <div className="form-control">
                                  <label>Tipo de Cambio</label>
                                  <input type="number" step="0.0001" min="0" value={l.tipoCambio} onChange={e => updateLinea(i, 'tipoCambio', e.target.value)} />
                                </div>
                                <div className="form-control">
                                  <label>Precio Unitario</label>
                                  <input type="number" step="0.01" min="0" value={l.precioUnitario} onChange={e => updateLinea(i, 'precioUnitario', e.target.value)} placeholder="0.00" />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="carousel-arrow"
                  onClick={goNext}
                  disabled={currentIndex === lineas.length - 1}
                  aria-label="Producto siguiente"
                >
                  <FiChevronRight size={22} />
                </button>
              </div>

              {/* Puntos indicadores */}
              <div className="carousel-dots" role="tablist">
                {lineas.map((l, i) => (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === currentIndex}
                    className={`carousel-dot ${i === currentIndex ? 'dot-active' : ''} ${l.productoId ? 'dot-matched' : 'dot-new'}`}
                    onClick={() => setCurrentIndex(i)}
                    aria-label={`Ir al producto ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">No hay productos extraídos.</p>
          )}

          <button type="button" className="btn btn-secondary btn-add-line" onClick={addLinea}>
            <FiPlus size={14} /> Agregar línea manualmente
          </button>

          {saveError && <div className="scan-error"><FiAlertCircle size={16} />{saveError}</div>}

          <div className="scan-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setStep('upload')}>← Volver</button>
            <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={saving || lineas.length === 0}>
              <FiCheck size={15} />{saving ? 'Registrando…' : 'Confirmar y registrar ingreso'}
            </button>
          </div>
        </div>
      )}

      {/* ══════ STEP 3: DONE ══════ */}
      {step === 'done' && (
        <div className="scan-card scan-done-card">
          <div className="done-icon"><FiCheck size={36} /></div>
          <h2>¡Ingreso registrado!</h2>
          <p className="scan-description">El stock de la bodega ha sido actualizado exitosamente.</p>

          {saveResult && (
            <div className="done-stats">
              {saveResult.stockActualizados > 0 && (
                <div className="done-stat done-stat-ok">
                  <strong>{saveResult.stockActualizados}</strong>
                  <span>stock actualizado</span>
                </div>
              )}
              {saveResult.productosCreados > 0 && (
                <div className="done-stat done-stat-new">
                  <strong>{saveResult.productosCreados}</strong>
                  <span>producto(s) nuevo(s)</span>
                </div>
              )}
            </div>
          )}

          {imageData && <img src={imageData.previewUrl} alt="Factura" className="done-thumbnail" />}

          <div className="done-summary">
            {proveedor && <div><span>Proveedor:</span> {proveedor}</div>}
            <div><span>Fecha:</span> {fecha}</div>
            {saveResult?.id && <div><span>ID compra:</span> <code>{saveResult.id}</code></div>}
          </div>

          <div className="scan-actions">
            <button type="button" className="btn btn-secondary" onClick={resetAll}>Escanear otra factura</button>
            <a href="/productos" className="btn btn-primary">Ver bodega actualizada</a>
          </div>
        </div>
      )}
    </div>
  );
}

export default InvoiceScan;
