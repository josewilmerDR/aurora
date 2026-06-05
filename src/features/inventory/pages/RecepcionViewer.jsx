import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { FiArrowLeft, FiPackage, FiCalendar, FiUser, FiFileText, FiImage, FiSlash, FiEdit, FiAlertTriangle, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { usePageTitle } from '../../../hooks/usePageTitle';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { formatDateLong, formatDateTime, formatMoney, recepcionShortId } from '../lib/recepcion';
import '../styles/agroquimicos.css';

export default function RecepcionViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const toast = useToast();

  const [recepcion, setRecepcion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(false);

  const [showAnularModal, setShowAnularModal] = useState(false);
  const [showEditarModal, setShowEditarModal] = useState(false);
  const [razonAnular, setRazonAnular] = useState('');
  const [razonEditar, setRazonEditar] = useState('');
  const [anularError, setAnularError] = useState(null); // detalle 422 persistente
  const [busy, setBusy] = useState(false);

  const lightboxCloseRef = useRef(null);

  const shortId = useMemo(() => recepcionShortId(recepcion?.id || id), [recepcion, id]);
  usePageTitle(`Recepción ${shortId}`);

  // ESC + foco en el lightbox (innermost).
  useEscapeClose(lightbox ? () => setLightbox(false) : null);
  useEffect(() => { if (lightbox) lightboxCloseRef.current?.focus(); }, [lightbox]);

  const loadRecepcion = useCallback(async () => {
    setLoading(true);
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
    setBusy(true);
    setAnularError(null);
    try {
      const res = await apiFetch(`/api/recepciones/${id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razon: razonAnular.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        // El 422 (stock insuficiente) trae una lista multi-producto que no se
        // alcanza a leer en un toast → se muestra persistente dentro del modal.
        if (res.status === 422) setAnularError(data.message || 'No se puede anular: stock insuficiente.');
        else toast.error(data.message || 'No se pudo anular la recepción.');
        return;
      }
      setShowAnularModal(false);
      setRazonAnular('');
      toast.success('Recepción anulada. Stock revertido.', { duration: 6000 });
      await loadRecepcion();
    } catch {
      toast.error('Error al anular la recepción.');
    } finally {
      setBusy(false);
    }
  };

  // Editar = anular esta recepción + navegar al form precargado con sus datos.
  // Al guardar se crea una NUEVA recepción; la original queda anulada (con la
  // razón ingresada) en el historial, enlazando ambos eventos en el audit trail.
  // OJO: la operación es anular-then-navigate (no atómica). Si el navigate se
  // interrumpe, la original queda anulada; el reemplazo se re-registra desde el
  // form. El backend recupera precio/idProducto por línea, así que el form
  // reabre completo (ver intake.js: recepcionItems persiste ambos campos).
  const handleEditar = async () => {
    setBusy(true);
    setAnularError(null);
    try {
      const res = await apiFetch(`/api/recepciones/${id}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razon: razonEditar.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 422) setAnularError(data.message || 'No se puede editar: stock insuficiente.');
        else toast.error(data.message || 'No se pudo editar la recepción.');
        return;
      }
      const fechaStr = recepcion.fechaRecepcion
        ? new Date(recepcion.fechaRecepcion).toISOString().split('T')[0]
        : '';
      const formItems = (recepcion.items || []).map(it => ({
        idProducto: it.idProducto || '',
        nombreComercial: it.nombreComercial || '',
        unidad: it.unidad || '',
        cantidad: String(it.cantidadRecibida || ''),
        precioUnitario: it.precioUnitario != null ? String(it.precioUnitario) : '',
        productoId: it.productoId || null,
      }));
      navigate('/bodega/agroquimicos/recepcion', {
        state: {
          editandoRecepcion: {
            originalShortId: shortId,
            fecha: fechaStr,
            factura: recepcion.facturaNumero || '',
            proveedor: recepcion.proveedor || '',
            items: formItems,
          },
        },
      });
    } catch {
      toast.error('Error al editar la recepción.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="pg-page-loading" />;
  }

  if (error) {
    return (
      <div className="lote-management-layout">
        <EmptyState
          icon={FiAlertTriangle}
          title={error}
          action={
            <div className="recv-error-actions">
              <button type="button" className="aur-btn-pill" onClick={loadRecepcion}>Reintentar</button>
              <button type="button" className="aur-chip" onClick={() => navigate(-1)}>
                <FiArrowLeft size={14} /> Volver
              </button>
            </div>
          }
        />
      </div>
    );
  }

  const items = Array.isArray(recepcion.items) ? recepcion.items : [];
  const itemsConProducto = items.filter(i => i.productoId);
  const totalGeneral = items.reduce((sum, it) => {
    const cant = parseFloat(it.cantidadRecibida) || 0;
    const precio = parseFloat(it.precioUnitario) || 0;
    return sum + cant * precio;
  }, 0);

  return (
    <div className="lote-management-layout">
      <div className="recv-header">
        <button type="button" className="aur-chip" onClick={() => navigate(-1)}>
          <FiArrowLeft size={14} /> Volver
        </button>
        <h2 className="recv-title">Detalle de Recepción</h2>
        <span className="recv-id">{shortId}</span>
        {recepcion.anulada && <span className="recv-anulada-badge">Anulada</span>}
      </div>

      {recepcion.anulada && (
        <div className="recv-anulada-banner" role="status">
          <FiAlertTriangle size={16} />
          <div>
            <strong>Esta recepción fue anulada</strong>
            <div className="recv-anulada-meta">
              {recepcion.anuladaAt && <>el {formatDateTime(recepcion.anuladaAt)}</>}
              {recepcion.anuladaRazon && <> · Razón: <em>{recepcion.anuladaRazon}</em></>}
            </div>
          </div>
        </div>
      )}

      <div className="recv-meta">
        <div className="recv-meta-item">
          <span className="recv-meta-label"><FiCalendar size={13} /> Fecha</span>
          <span className="recv-meta-value">{formatDateLong(recepcion.fechaRecepcion)}</span>
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
            <span className="recv-meta-value">
              {recepcion.ordenCompraId
                ? <Link className="recv-link" to={`/orden-compra/${recepcion.ordenCompraId}`}>{recepcion.poNumber}</Link>
                : recepcion.poNumber}
            </span>
          </div>
        )}
        {(recepcion.createdAt || recepcion.createdByEmail) && (
          <div className="recv-meta-item">
            <span className="recv-meta-label"><FiUser size={13} /> Registrada</span>
            <span className="recv-meta-value">
              {formatDateTime(recepcion.createdAt)}
              {recepcion.createdByEmail && <> · {recepcion.createdByEmail}</>}
            </span>
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
        <table className="ingreso-table recv-items-table">
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
                <td colSpan={6} className="recv-empty-cell">Sin productos.</td>
              </tr>
            ) : items.map((it, i) => {
              const cant = parseFloat(it.cantidadRecibida) || 0;
              const precio = parseFloat(it.precioUnitario) || 0;
              return (
                <tr key={it.productoId || it.idProducto || i}>
                  <td>{it.idProducto || '—'}</td>
                  <td>{it.nombreComercial || '—'}</td>
                  <td className="col-narrow">{it.unidad || '—'}</td>
                  <td className="col-number">{cant.toLocaleString('es-CR')}</td>
                  <td className="col-number">{precio > 0 ? formatMoney(precio) : '—'}</td>
                  <td className="col-total col-total-value">
                    {precio > 0 ? formatMoney(cant * precio) : '—'}
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
          <span className="ingreso-total-value">{formatMoney(totalGeneral)}</span>
        </div>
      )}

      {recepcion.imageUrl && (
        <div className="recv-image-section">
          <span className="recv-meta-label"><FiImage size={13} /> Factura adjunta</span>
          <button
            type="button"
            className="recv-image-thumb"
            onClick={() => setLightbox(true)}
            aria-label="Ver factura adjunta"
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
            onClick={() => { setRazonEditar(''); setAnularError(null); setShowEditarModal(true); }}
          >
            <FiEdit size={14} /> Editar
          </button>
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--danger"
            onClick={() => { setRazonAnular(''); setAnularError(null); setShowAnularModal(true); }}
          >
            <FiSlash size={14} /> Anular recepción
          </button>
        </div>
      )}

      {showEditarModal && (
        <AuroraConfirmModal
          title="Editar recepción"
          body={
            <>
              <FiAlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Esta recepción se anulará y se cargará el formulario con sus datos para que la registres de nuevo. La original queda en el historial como "Anulada".
            </>
          }
          confirmLabel="Continuar"
          loadingLabel="Cargando…"
          loading={busy}
          confirmDisabled={!razonEditar.trim()}
          onConfirm={handleEditar}
          onCancel={() => setShowEditarModal(false)}
        >
          {itemsConProducto.length > 0 && (
            <div className="recv-impact-table">
              <div className="recv-impact-title">Se revertirá el stock de:</div>
              <ul>
                {itemsConProducto.map((it, i) => (
                  <li key={it.productoId || i}>
                    <span>{it.nombreComercial || it.idProducto}</span>
                    <strong>{parseFloat(it.cantidadRecibida) || 0} {it.unidad}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="recv-razon-label">
            Razón <span className="toma-required">*</span>
            <textarea
              rows={3}
              maxLength={200}
              value={razonEditar}
              onChange={e => setRazonEditar(e.target.value)}
              placeholder="Ej. Corrigiendo cantidad de Glifosato"
              disabled={busy}
              autoFocus
            />
            <span className="recv-razon-count">{razonEditar.length}/200</span>
          </label>
          {anularError && (
            <div className="recv-anular-warn" role="alert">
              <FiAlertTriangle size={14} /> {anularError}
            </div>
          )}
        </AuroraConfirmModal>
      )}

      {showAnularModal && (
        <AuroraConfirmModal
          danger
          title="Anular recepción"
          body={
            <>
              <FiAlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Esta acción revertirá el stock ingresado. No se puede deshacer y debe quedar justificada.
            </>
          }
          confirmLabel="Confirmar anulación"
          loadingLabel="Anulando…"
          loading={busy}
          confirmDisabled={!razonAnular.trim()}
          onConfirm={handleAnular}
          onCancel={() => setShowAnularModal(false)}
        >
          {itemsConProducto.length > 0 && (
            <div className="recv-impact-table">
              <div className="recv-impact-title">Se revertirá el stock de:</div>
              <ul>
                {itemsConProducto.map((it, i) => (
                  <li key={it.productoId || i}>
                    <span>{it.nombreComercial || it.idProducto}</span>
                    <strong>{parseFloat(it.cantidadRecibida) || 0} {it.unidad}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="recv-razon-label">
            Razón <span className="toma-required">*</span>
            <textarea
              rows={3}
              maxLength={200}
              value={razonAnular}
              onChange={e => setRazonAnular(e.target.value)}
              placeholder="Ej. Factura duplicada, proveedor equivocado…"
              disabled={busy}
              autoFocus
            />
            <span className="recv-razon-count">{razonAnular.length}/200</span>
          </label>
          {anularError && (
            <div className="recv-anular-warn" role="alert">
              <FiAlertTriangle size={14} /> {anularError}
            </div>
          )}
        </AuroraConfirmModal>
      )}

      {lightbox && (
        <div className="ingreso-scan-overlay" onClick={(e) => { if (e.target === e.currentTarget) setLightbox(false); }}>
          <div className="factura-lightbox-inner" role="dialog" aria-modal="true" aria-label="Factura adjunta">
            <button
              ref={lightboxCloseRef}
              type="button"
              className="ingreso-scan-modal-close"
              onClick={() => setLightbox(false)}
              aria-label="Cerrar"
            >
              <FiX size={18} />
            </button>
            <img src={recepcion.imageUrl} alt="Factura" className="factura-lightbox-img" />
          </div>
        </div>
      )}
    </div>
  );
}
