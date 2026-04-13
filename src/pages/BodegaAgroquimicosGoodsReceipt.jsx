import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiArrowLeft, FiCheckCircle, FiEye, FiPackage,
  FiX, FiImage, FiAlertTriangle, FiCheck, FiPlus
} from 'react-icons/fi';
import './BodegaAgroquimicosGoodsReceipt.css';
import { useApiFetch } from '../hooks/useApiFetch';

const STATUS = {
  activa:           { label: 'Activa',            cls: 'gr-s-activa' },
  recibida:         { label: 'Recibida',           cls: 'gr-s-recibida' },
  recibida_parcial: { label: 'Recibida parcial',   cls: 'gr-s-parcial' },
  cancelada:        { label: 'Cancelada',           cls: 'gr-s-cancelada' },
};

const compressImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1400;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
      resolve({ base64, mediaType: 'image/jpeg', preview: `data:image/jpeg;base64,${base64}` });
    };
    img.onerror = reject;
    img.src = e.target.result;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const GoodsReceipt = () => {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const imageInputRef = useRef(null);

  // List state
  const [ordenes, setOrdenes] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [filterEstado, setFilterEstado] = useState('activa');

  // Receipt state
  const [step, setStep] = useState('list');
  const [selectedOrden, setSelectedOrden] = useState(null);
  const [items, setItems] = useState([]);
  const [notas, setNotas] = useState('');
  const [image, setImage] = useState(null);
  const [imageError, setImageError] = useState('');

  // UI state
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [detailModal, setDetailModal] = useState({ open: false, orden: null, recepcion: null, loading: false });
  const [lightboxUrl, setLightboxUrl] = useState(null);

  useEffect(() => {
    apiFetch('/api/ordenes-compra')
      .then(r => r.json())
      .then(data => setOrdenes(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const filteredOrdenes = filterEstado === 'todas'
    ? ordenes
    : ordenes.filter(o => o.estado === filterEstado);

  const handleSelectOrden = (orden) => {
    setSelectedOrden(orden);
    setItems((orden.items || []).map(i => ({
      productoId: i.productoId,
      nombreComercial: i.nombreComercial,
      ingredienteActivo: i.ingredienteActivo || '',
      cantidadOC: parseFloat(i.cantidad) || 0,
      cantidadRecibida: String(parseFloat(i.cantidad) || ''),
      unidad: i.unidad,
      precioUnitario: parseFloat(i.precioUnitario) || 0,
    })));
    setNotas('');
    setImage(null);
    setImageError('');
    setStep('receipt');
  };

  const updateQty = (idx, value) =>
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, cantidadRecibida: value } : item));

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setImageError('Solo se aceptan archivos de imagen.'); return; }
    setImageError('');
    try {
      setImage(await compressImage(file));
    } catch {
      setImageError('No se pudo procesar la imagen.');
    }
    e.target.value = '';
  };

  const handleViewDetail = async (orden) => {
    setDetailModal({ open: true, orden, recepcion: null, loading: true });
    try {
      const res = await apiFetch(`/api/recepciones?ordenCompraId=${orden.id}`);
      const data = await res.json();
      setDetailModal(prev => ({ ...prev, recepcion: Array.isArray(data) ? data[0] || null : null, loading: false }));
    } catch {
      setDetailModal(prev => ({ ...prev, loading: false }));
    }
  };

  const closeDetail = () => setDetailModal({ open: false, orden: null, recepcion: null, loading: false });

  const hasValidQty = items.some(i => parseFloat(i.cantidadRecibida) > 0);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/recepciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ordenCompraId: selectedOrden.id,
          poNumber: selectedOrden.poNumber,
          proveedor: selectedOrden.proveedor,
          items: items.map(i => ({
            productoId: i.productoId,
            nombreComercial: i.nombreComercial,
            cantidadOC: i.cantidadOC,
            cantidadRecibida: parseFloat(i.cantidadRecibida) || 0,
            unidad: i.unidad,
            precioUnitario: i.precioUnitario || 0,
          })),
          notas,
          imageBase64: image?.base64 || null,
          mediaType: image?.mediaType || null,
        }),
      });
      if (!res.ok) throw new Error();

      // Update local OC status without refetching
      const allFull = items.every(
        i => parseFloat(i.cantidadRecibida) >= i.cantidadOC
      );
      const nuevoEstado = allFull ? 'recibida' : 'recibida_parcial';
      setOrdenes(prev =>
        prev.map(o => o.id === selectedOrden.id ? { ...o, estado: nuevoEstado } : o)
      );

      setShowPreview(false);
      setStep('list');
      setSelectedOrden(null);
      showToast('Recepción registrada. El inventario ha sido actualizado.');
    } catch {
      showToast('Error al registrar la recepción.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════
  if (step === 'list') {
    return (
      <div className="gr-page">
        {toast && (
          <div className={`gr-toast gr-toast--${toast.type}`}>
            {toast.type === 'success' ? <FiCheck size={15} /> : <FiAlertTriangle size={15} />}
            {toast.message}
          </div>
        )}

        {/* Filter bar */}
        <div className="gr-filter-bar">
          {[
            { key: 'activa',           label: 'Activas' },
            { key: 'recibida_parcial', label: 'Parciales' },
            { key: 'recibida',         label: 'Recibidas' },
            { key: 'todas',            label: 'Todas' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`gr-filter-btn ${filterEstado === key ? 'active' : ''}`}
              onClick={() => setFilterEstado(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loadingList ? (
          <p className="gr-empty">Cargando órdenes…</p>
        ) : filteredOrdenes.length === 0 ? (
          <div className="gr-empty-state">
            <FiPackage size={36} />
            <p>No hay recepciones pendientes</p>
            {filterEstado === 'activa' && (
              <button className="btn btn-primary" onClick={() => navigate('/ingreso-productos')}>
                <FiPlus size={14} /> Crear una
              </button>
            )}
          </div>
        ) : (
          <div className="gr-oc-grid">
            {filteredOrdenes.map(orden => {
              const st = STATUS[orden.estado] || { label: orden.estado, cls: '' };
              return (
                <div key={orden.id} className="gr-oc-card">
                  <div className="gr-oc-card-head">
                    <span className="gr-oc-number">{orden.poNumber}</span>
                    <span className={`gr-status-badge ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="gr-oc-card-body">
                    <div className="gr-oc-row">
                      <span className="gr-oc-label">Proveedor</span>
                      <span>{orden.proveedor || '—'}</span>
                    </div>
                    <div className="gr-oc-row">
                      <span className="gr-oc-label">Fecha OC</span>
                      <span>
                        {orden.fecha
                          ? new Date(orden.fecha).toLocaleDateString('es-ES', { timeZone: 'UTC' })
                          : '—'}
                      </span>
                    </div>
                    <div className="gr-oc-row">
                      <span className="gr-oc-label">Productos</span>
                      <span>{orden.items?.length || 0} ítem(s)</span>
                    </div>
                    {orden.elaboradoPor && (
                      <div className="gr-oc-row">
                        <span className="gr-oc-label">Por</span>
                        <span>{orden.elaboradoPor}</span>
                      </div>
                    )}
                  </div>
                  {orden.notas && <p className="gr-oc-notes">{orden.notas}</p>}
                  {orden.estado === 'activa' && (
                    <button
                      className="gr-btn-receive"
                      onClick={() => handleSelectOrden(orden)}
                    >
                      <FiCheckCircle size={15} /> Registrar Recepción
                    </button>
                  )}
                  {(orden.estado === 'recibida' || orden.estado === 'recibida_parcial') && (
                    <button
                      className="gr-btn-detail"
                      onClick={() => handleViewDetail(orden)}
                    >
                      <FiEye size={15} /> Ver Recepción
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

      {/* ════════════════════════════════════════════
          DETAIL MODAL
          ════════════════════════════════════════════ */}
      {detailModal.open && (
        <div className="gr-modal-backdrop" onClick={closeDetail}>
          <div className="gr-modal" onClick={e => e.stopPropagation()}>

            <div className="gr-modal-header">
              <div>
                <h2>Detalle de Recepción</h2>
                <p className="gr-modal-sub">
                  {detailModal.orden.poNumber} · {detailModal.orden.proveedor || '—'}
                  {detailModal.recepcion?.fechaRecepcion && (
                    <> · {new Date(detailModal.recepcion.fechaRecepcion).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</>
                  )}
                </p>
              </div>
              <button className="gr-modal-close" onClick={closeDetail}><FiX size={20} /></button>
            </div>

            <div className="gr-modal-body">
              {detailModal.loading ? (
                <p className="gr-empty">Cargando detalle…</p>
              ) : !detailModal.recepcion ? (
                <p className="gr-empty">No se encontró el registro de recepción.</p>
              ) : (
                <>
                  <table className="gr-preview-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Cant. OC</th>
                        <th>Cant. Recibida</th>
                        <th>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailModal.recepcion.items.map((item, idx) => {
                        const diff = item.cantidadRecibida - item.cantidadOC;
                        return (
                          <tr key={idx}>
                            <td>{item.nombreComercial}</td>
                            <td className="gr-td-center">{item.cantidadOC} {item.unidad}</td>
                            <td className="gr-td-center gr-preview-qty">{item.cantidadRecibida} {item.unidad}</td>
                            <td className="gr-td-center" style={{
                              color: diff < 0 ? '#ff6b6b' : diff > 0 ? '#ffcc44' : 'var(--aurora-green)',
                              fontWeight: 600,
                            }}>
                              {diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)} ${item.unidad}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {detailModal.recepcion.notas && (
                    <div className="gr-preview-notes">
                      <strong>Notas:</strong> {detailModal.recepcion.notas}
                    </div>
                  )}

                  {detailModal.recepcion.imageUrl && (
                    <div className="gr-preview-image-wrap">
                      <p className="gr-preview-image-label">Documento adjunto:</p>
                      <img
                        src={detailModal.recepcion.imageUrl}
                        alt="Documento de recepción"
                        className="gr-preview-image gr-preview-image--clickable"
                        onClick={() => setLightboxUrl(detailModal.recepcion.imageUrl)}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="gr-modal-footer">
              <button className="btn btn-secondary" onClick={closeDetail}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxUrl && (
        <div className="gr-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Documento adjunto" className="gr-lightbox-img" />
        </div>
      )}
    </div>
    );
  }

  // ════════════════════════════════════════════
  // RECEIPT VIEW
  // ════════════════════════════════════════════
  return (
    <div className="gr-page">
      {toast && (
        <div className={`gr-toast gr-toast--${toast.type}`}>
          {toast.type === 'success' ? <FiCheck size={15} /> : <FiAlertTriangle size={15} />}
          {toast.message}
        </div>
      )}

      <button
        className="gr-back-link"
        onClick={() => { setStep('list'); setSelectedOrden(null); }}
      >
        <FiArrowLeft size={15} /> Volver a Órdenes de Compra
      </button>

      <div className="gr-receipt-header">
        <div>
          <h2 className="gr-receipt-title">{selectedOrden.poNumber}</h2>
          <p className="gr-receipt-sub">
            Proveedor: <strong>{selectedOrden.proveedor || '—'}</strong>
            {selectedOrden.fecha && (
              <> · OC del {new Date(selectedOrden.fecha).toLocaleDateString('es-ES', { timeZone: 'UTC' })}</>
            )}
          </p>
        </div>
        <button
          className="gr-btn-preview"
          onClick={() => setShowPreview(true)}
          disabled={!hasValidQty}
        >
          <FiEye size={15} /> Ver vista previa
        </button>
      </div>

      <div className="gr-receipt-layout">

        {/* ── Items table ── */}
        <div className="form-card gr-items-card">
          <h3 className="gr-section-title">Productos recibidos</h3>
          <p className="gr-section-hint">
            Ajusta las cantidades según lo que realmente entregó el proveedor.
          </p>
          <table className="gr-items-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="gr-th-center">Und.</th>
                <th className="gr-th-center">Cant. OC</th>
                <th className="gr-th-center">Cant. Recibida</th>
                <th className="gr-th-center">Dif.</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const received = parseFloat(item.cantidadRecibida) || 0;
                const oc = item.cantidadOC;
                const diff = received - oc;
                const hasId = !!item.productoId;
                return (
                  <tr key={idx} className={!hasId ? 'gr-row-no-id' : ''}>
                    <td>
                      <span className="gr-item-name">{item.nombreComercial}</span>
                      {item.ingredienteActivo && (
                        <span className="gr-item-ai">{item.ingredienteActivo}</span>
                      )}
                      {!hasId && (
                        <span className="gr-no-id-warn">
                          <FiAlertTriangle size={11} /> Sin vínculo al catálogo
                        </span>
                      )}
                    </td>
                    <td className="gr-td-center">{item.unidad}</td>
                    <td className="gr-td-center gr-qty-oc">{oc}</td>
                    <td className="gr-td-center">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={item.cantidadRecibida}
                        onChange={e => updateQty(idx, e.target.value)}
                        className={`gr-qty-input ${diff < 0 ? 'gr-qty--short' : diff > 0 ? 'gr-qty--over' : 'gr-qty--ok'}`}
                      />
                    </td>
                    <td className="gr-td-center">
                      {received === 0 ? (
                        <span className="gr-diff gr-diff--zero">—</span>
                      ) : diff === 0 ? (
                        <span className="gr-diff gr-diff--ok">✓</span>
                      ) : (
                        <span className={`gr-diff ${diff < 0 ? 'gr-diff--neg' : 'gr-diff--pos'}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Notes & image ── */}
        <div className="form-card gr-notes-card">
          <h3 className="gr-section-title">Notas y Documentación</h3>

          <div className="form-control">
            <label>Comentarios</label>
            <textarea
              rows={5}
              placeholder="Observaciones sobre la entrega, diferencias, condiciones…"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              className="gr-textarea"
            />
          </div>

          <div className="gr-image-section">
            <label className="gr-image-label">Adjuntar imagen</label>
            <p className="gr-image-hint">Factura, remisión u otro documento de soporte</p>
            {image ? (
              <div className="gr-image-preview">
                <img src={image.preview} alt="Documento adjunto" />
                <button className="gr-image-remove" onClick={() => setImage(null)}>
                  <FiX size={14} /> Quitar imagen
                </button>
              </div>
            ) : (
              <button
                className="gr-image-upload-btn"
                onClick={() => imageInputRef.current?.click()}
              >
                <FiImage size={20} />
                <span>Subir imagen</span>
                <span className="gr-image-formats">JPG, PNG, WebP</span>
              </button>
            )}
            {imageError && <p className="gr-image-error"><FiAlertTriangle size={13} /> {imageError}</p>}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════
          PREVIEW MODAL
          ════════════════════════════════════════════ */}
      {showPreview && (
        <div className="gr-modal-backdrop" onClick={() => setShowPreview(false)}>
          <div className="gr-modal" onClick={e => e.stopPropagation()}>

            <div className="gr-modal-header">
              <div>
                <h2>Vista Previa de Recepción</h2>
                <p className="gr-modal-sub">
                  {selectedOrden.poNumber} · {selectedOrden.proveedor || '—'} ·{' '}
                  {new Date().toLocaleDateString('es-ES')}
                </p>
              </div>
              <button className="gr-modal-close" onClick={() => setShowPreview(false)}>
                <FiX size={20} />
              </button>
            </div>

            <div className="gr-modal-body">
              <table className="gr-preview-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant. OC</th>
                    <th>Cant. Recibida</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const received = parseFloat(item.cantidadRecibida) || 0;
                    const diff = received - item.cantidadOC;
                    return (
                      <tr key={idx}>
                        <td>
                          {item.nombreComercial}
                          {!item.productoId && (
                            <span className="gr-no-id-warn"> (sin catálogo)</span>
                          )}
                        </td>
                        <td className="gr-td-center">{item.cantidadOC} {item.unidad}</td>
                        <td className="gr-td-center gr-preview-qty">{received} {item.unidad}</td>
                        <td className="gr-td-center" style={{
                          color: diff < 0 ? '#ff6b6b' : diff > 0 ? '#ffcc44' : 'var(--aurora-green)',
                          fontWeight: 600,
                        }}>
                          {diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)} ${item.unidad}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {notas && (
                <div className="gr-preview-notes">
                  <strong>Notas:</strong> {notas}
                </div>
              )}

              {image && (
                <div className="gr-preview-image-wrap">
                  <p className="gr-preview-image-label">Documento adjunto:</p>
                  <img src={image.preview} alt="Adjunto" className="gr-preview-image" />
                </div>
              )}
            </div>

            <div className="gr-modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPreview(false)}>
                <FiArrowLeft size={15} /> Volver a editar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={submitting}
              >
                <FiCheckCircle size={16} />
                {submitting ? 'Procesando…' : 'Confirmar y actualizar inventario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GoodsReceipt;
