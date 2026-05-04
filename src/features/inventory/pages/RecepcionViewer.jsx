import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPackage, FiCalendar, FiUser, FiFileText, FiImage, FiSlash, FiEdit, FiAlertTriangle } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import '../styles/agroquimicos.css';

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const fmtMoney = (n) =>
  Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RecepcionViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [recepcion, setRecepcion] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lightbox,  setLightbox]  = useState(false);
  const [toast,     setToast]     = useState(null);

  const [showAnularModal, setShowAnularModal] = useState(false);
  const [showEditarModal, setShowEditarModal] = useState(false);
  const [razon, setRazon] = useState('');
  const [anulando, setAnulando] = useState(false);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const loadRecepcion = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/recepciones/${id}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'Recepción no encontrada.' : 'Error al cargar la recepción.');
        return;
      }
      setRecepcion(await res.json());
      setError(null);
    } catch {
      setError('Error al cargar la recepción.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => { loadRecepcion(); }, [loadRecepcion]);

  const handleAnular = async () => {
    const r = razon.trim();
    if (!r) { showToast('Escribe una razón para anular.', 'error'); return; }
    if (r.length > 200) { showToast('La razón excede 200 caracteres.', 'error'); return; }
    setAnulando(true);
    try {
      const res = await apiFetch(`/api/recepciones/${id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razon: r }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'No se pudo anular la recepción.', 'error');
        return;
      }
      setShowAnularModal(false);
      setRazon('');
      showToast('Recepción anulada. Stock revertido.');
      await loadRecepcion();
    } catch {
      showToast('Error al anular la recepción.', 'error');
    } finally {
      setAnulando(false);
    }
  };

  // Editar = anular esta recepción + navegar al form precargado con sus
  // datos. El usuario edita lo que necesite y al guardar se crea una NUEVA
  // recepción. La original queda anulada (con la razón ingresada) en el
  // historial, así el audit trail enlaza ambos eventos.
  const handleEditar = async () => {
    const r = razon.trim();
    if (!r) { showToast('Escribe una razón para editar.', 'error'); return; }
    if (r.length > 200) { showToast('La razón excede 200 caracteres.', 'error'); return; }
    setAnulando(true);
    try {
      const res = await apiFetch(`/api/recepciones/${id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razon: r }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'No se pudo editar la recepción.', 'error');
        return;
      }
      // Build the form-friendly payload from the recepción we just anulada.
      const fechaStr = recepcion.fechaRecepcion
        ? new Date(recepcion.fechaRecepcion).toISOString().split('T')[0]
        : '';
      const formItems = (recepcion.items || []).map(it => ({
        idProducto:      it.idProducto || '',
        nombreComercial: it.nombreComercial || '',
        unidad:          it.unidad || '',
        cantidad:        String(it.cantidadRecibida || ''),
        precioUnitario:  it.precioUnitario != null ? String(it.precioUnitario) : '',
        productoId:      it.productoId || null,
      }));
      navigate('/bodega/agroquimicos/recepcion', {
        state: {
          editandoRecepcion: {
            originalId: id,
            originalShortId: `REC-${id.slice(-6).toUpperCase()}`,
            fecha: fechaStr,
            factura: recepcion.facturaNumero || '',
            proveedor: recepcion.proveedor || '',
            items: formItems,
          },
        },
      });
    } catch {
      showToast('Error al editar la recepción.', 'error');
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return <div className="pg-page-loading" />;
  }

  if (error) {
    return (
      <div className="lote-management-layout">
        <div className="aur-sheet aur-sheet--empty">
          <p style={{ textAlign: 'center', color: 'var(--aurora-light)', opacity: 0.65 }}>{error}</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button type="button" className="aur-btn-pill" onClick={() => navigate(-1)}>
              <FiArrowLeft size={14} /> Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  const items = Array.isArray(recepcion.items) ? recepcion.items : [];
  const totalGeneral = items.reduce((sum, it) => {
    const cant = parseFloat(it.cantidadRecibida) || 0;
    const precio = parseFloat(it.precioUnitario) || 0;
    return sum + cant * precio;
  }, 0);

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="recv-header">
        <button type="button" className="aur-chip" onClick={() => navigate(-1)}>
          <FiArrowLeft size={14} /> Volver
        </button>
        <h2 className="recv-title">Detalle de Recepción</h2>
        <span className="recv-id">REC-{(recepcion.id || '').slice(-6).toUpperCase()}</span>
        {recepcion.anulada && <span className="recv-anulada-badge">Anulada</span>}
      </div>

      {recepcion.anulada && (
        <div className="recv-anulada-banner">
          <FiAlertTriangle size={16} />
          <div>
            <strong>Esta recepción fue anulada</strong>
            <div className="recv-anulada-meta">
              {recepcion.anuladaAt && <>el {fmtDateTime(recepcion.anuladaAt)}</>}
              {recepcion.anuladaRazon && <> · Razón: <em>{recepcion.anuladaRazon}</em></>}
            </div>
          </div>
        </div>
      )}

      <div className="recv-meta">
        <div className="recv-meta-item">
          <span className="recv-meta-label"><FiCalendar size={13} /> Fecha</span>
          <span className="recv-meta-value">{fmtDate(recepcion.fechaRecepcion)}</span>
        </div>
        <div className="recv-meta-item">
          <span className="recv-meta-label"><FiUser size={13} /> Proveedor</span>
          <span className="recv-meta-value">{recepcion.proveedor || '—'}</span>
        </div>
        <div className="recv-meta-item">
          <span className="recv-meta-label"><FiFileText size={13} /> Factura</span>
          <span className="recv-meta-value">{recepcion.facturaNumero || '—'}</span>
        </div>
        {recepcion.poNumber && (
          <div className="recv-meta-item">
            <span className="recv-meta-label"><FiPackage size={13} /> OC</span>
            <span className="recv-meta-value">{recepcion.poNumber}</span>
          </div>
        )}
      </div>

      {recepcion.notas && (
        <div className="recv-notas">
          <span className="recv-notas-label">Notas</span>
          <p>{recepcion.notas}</p>
        </div>
      )}

      <div className="ingreso-grid-wrapper">
        <table className="ingreso-table">
          <thead>
            <tr>
              <th className="col-id">ID Producto</th>
              <th className="col-name">Nombre Comercial</th>
              <th className="col-narrow">UM</th>
              <th className="col-number">Cantidad</th>
              <th className="col-number">Precio Unit.</th>
              <th className="col-total">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '24px', opacity: 0.55 }}>
                  Sin productos.
                </td>
              </tr>
            ) : items.map((it, i) => {
              const cant   = parseFloat(it.cantidadRecibida) || 0;
              const precio = parseFloat(it.precioUnitario) || 0;
              return (
                <tr key={i}>
                  <td>{it.idProducto || '—'}</td>
                  <td>{it.nombreComercial || '—'}</td>
                  <td className="col-narrow">{it.unidad || '—'}</td>
                  <td className="col-number">{cant.toLocaleString('es-CR')}</td>
                  <td className="col-number">{precio > 0 ? fmtMoney(precio) : '—'}</td>
                  <td className="col-total col-total-value">
                    {precio > 0 ? fmtMoney(cant * precio) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalGeneral > 0 && (
        <div className="recv-total-row">
          <span className="ingreso-total-label">Total General:</span>
          <span className="ingreso-total-value">{fmtMoney(totalGeneral)}</span>
        </div>
      )}

      {recepcion.imageUrl && (
        <div className="recv-image-section">
          <span className="recv-meta-label"><FiImage size={13} /> Factura adjunta</span>
          <button
            type="button"
            className="recv-image-thumb"
            onClick={() => setLightbox(true)}
            title="Ver factura"
          >
            <img src={recepcion.imageUrl} alt="Factura" />
          </button>
        </div>
      )}

      {!recepcion.anulada && (
        <div className="recv-actions">
          <button
            type="button"
            className="aur-chip"
            onClick={() => { setRazon('Edición — corrigiendo datos'); setShowEditarModal(true); }}
          >
            <FiEdit size={14} /> Editar
          </button>
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--danger"
            onClick={() => { setRazon(''); setShowAnularModal(true); }}
          >
            <FiSlash size={14} /> Anular recepción
          </button>
        </div>
      )}

      {showEditarModal && (
        <div className="aur-modal-backdrop" onPointerDown={() => !anulando && setShowEditarModal(false)}>
          <div className="aur-modal" onPointerDown={(e) => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">Editar recepción</h2>
            </header>
            <div className="aur-modal-content">
              <p className="recv-anular-warn">
                <FiAlertTriangle size={14} /> Esta recepción se anulará y se cargará el formulario con sus datos para que la registres de nuevo. La original queda en el historial como "Anulada".
              </p>
              <label className="recv-razon-label">
                Razón <span style={{ color: '#ff6680' }}>*</span>
                <textarea
                  rows={3}
                  maxLength={200}
                  value={razon}
                  onChange={e => setRazon(e.target.value)}
                  placeholder="Ej. Corrigiendo cantidad de Glifosato"
                  disabled={anulando}
                  autoFocus
                />
                <span className="recv-razon-count">{razon.length}/200</span>
              </label>
            </div>
            <div className="aur-modal-actions">
              <button
                type="button"
                className="aur-btn-text"
                onClick={() => setShowEditarModal(false)}
                disabled={anulando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleEditar}
                disabled={anulando || !razon.trim()}
              >
                {anulando ? 'Cargando…' : 'Continuar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAnularModal && (
        <div className="aur-modal-backdrop" onPointerDown={() => !anulando && setShowAnularModal(false)}>
          <div className="aur-modal" onPointerDown={(e) => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">Anular recepción</h2>
            </header>
            <div className="aur-modal-content">
              <p className="recv-anular-warn">
                <FiAlertTriangle size={14} /> Esta acción reversará el stock ingresado de los {items.filter(i => i.productoId).length} producto(s).
                No se puede deshacer y debe quedar justificada.
              </p>
              <label className="recv-razon-label">
                Razón <span style={{ color: '#ff6680' }}>*</span>
                <textarea
                  rows={3}
                  maxLength={200}
                  value={razon}
                  onChange={e => setRazon(e.target.value)}
                  placeholder="Ej. Factura duplicada, proveedor equivocado…"
                  disabled={anulando}
                  autoFocus
                />
                <span className="recv-razon-count">{razon.length}/200</span>
              </label>
            </div>
            <div className="aur-modal-actions">
              <button
                type="button"
                className="aur-btn-text"
                onClick={() => setShowAnularModal(false)}
                disabled={anulando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill aur-btn-pill--danger"
                onClick={handleAnular}
                disabled={anulando || !razon.trim()}
              >
                {anulando ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="ingreso-scan-overlay" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(false); }}>
          <div className="factura-lightbox-inner">
            <button
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setLightbox(false)}
              aria-label="Cerrar"
            >
              ×
            </button>
            <img src={recepcion.imageUrl} alt="Factura" style={{ maxWidth: '100%', maxHeight: '90vh' }} />
          </div>
        </div>
      )}
    </div>
  );
}
