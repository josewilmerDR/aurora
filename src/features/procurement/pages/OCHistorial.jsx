import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  FiChevronLeft, FiFilter, FiX, FiEye, FiShare2, FiPrinter, FiPackage,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useUser } from '../../../contexts/UserContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/oc-nueva.css';
import '../styles/oc-desde-solicitud.css';
import '../styles/oc-historial.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ESTADO_LABELS = { activa: 'Activa', completada: 'Completada', cancelada: 'Cancelada' };

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const formatDateLong = (dateStr) => {
  if (!dateStr) return '___________________________';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

// ─── Sort ─────────────────────────────────────────────────────────────────────
const SORT_FIELDS = [
  { value: 'fecha',        label: 'Fecha' },
  { value: 'poNumber',     label: 'N° OC' },
  { value: 'proveedor',    label: 'Proveedor' },
  { value: 'fechaEntrega', label: 'Entrega' },
  { value: 'productos',    label: 'Productos' },
  { value: 'estado',       label: 'Estado' },
];

function getSortVal(r, field) {
  switch (field) {
    case 'fecha':        return (r.fecha || '').slice(0, 10);
    case 'poNumber':     return r.poNumber || '';
    case 'proveedor':    return (r.proveedor || '').toLowerCase();
    case 'fechaEntrega': return (r.fechaEntrega || '').slice(0, 10);
    case 'productos':    return Array.isArray(r.items) ? r.items.length : 0;
    case 'estado':       return r.estado || 'activa';
    default:             return '';
  }
}

function applySort(data, sortConfig) {
  const active = sortConfig.filter(s => s.field);
  if (!active.length) return [...data];
  return [...data].sort((a, b) => {
    for (const { field, dir } of active) {
      const av = getSortVal(a, field);
      const bv = getSortVal(b, field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

const EMPTY_FILTERS = { fechaDesde: '', fechaHasta: '', proveedor: '', estado: 'todos' };

function applyFilters(data, f) {
  return data.filter(r => {
    const fecha = (r.fecha || '').slice(0, 10);
    if (f.fechaDesde && fecha < f.fechaDesde) return false;
    if (f.fechaHasta && fecha > f.fechaHasta) return false;
    if (f.proveedor && !(r.proveedor || '').toLowerCase().includes(f.proveedor.toLowerCase())) return false;
    if (f.estado !== 'todos' && (r.estado || 'activa') !== f.estado) return false;
    return true;
  });
}

// ─── Main component ───────────────────────────────────────────────────────────
function OrdenesHistorial() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const elaboradoPor = currentUser?.nombre || '';

  const [ordenes, setOrdenes] = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortConfig, setSortConfig] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc'  },
  ]);

  const [showPreview, setShowPreview] = useState(false);
  const [savedPoNumber, setSavedPoNumber] = useState('');
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const poDocRef = useRef(null);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const updateSort = (idx, key, value) =>
    setSortConfig(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([k, v]) => k === 'estado' ? v !== 'todos' : v !== '').length,
  [filters]);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/ordenes-compra').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ])
      .then(([ocs, cfg]) => {
        setOrdenes(Array.isArray(ocs) ? ocs : []);
        setEmpresaConfig(cfg || {});
      })
      .catch(() => showToast('Error al cargar órdenes.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const displayData = useMemo(
    () => applySort(applyFilters(ordenes, filters), sortConfig),
    [ordenes, filters, sortConfig],
  );

  const stats = useMemo(() => ({
    total:       displayData.length,
    activas:     displayData.filter(o => (o.estado || 'activa') === 'activa').length,
    completadas: displayData.filter(o => o.estado === 'completada').length,
    canceladas:  displayData.filter(o => o.estado === 'cancelada').length,
  }), [displayData]);

  const handleVisualizarOrden = (orden) => {
    setSavedPoNumber(orden.poNumber || '');
    setSavedSnapshot({
      filas: (orden.items || []).map((item, i) => ({
        _key: i,
        productoId:      item.productoId      || '',
        nombreComercial: item.nombreComercial  || '',
        cantidad:        String(item.cantidad  ?? ''),
        unidad:          item.unidad           || 'L',
        precioUnitario:  String(item.precioUnitario ?? ''),
        iva:             item.iva              ?? 0,
        moneda:          item.moneda           || 'USD',
      })),
      proveedor:    orden.proveedor             || '',
      contacto:     orden.direccionProveedor    || '',
      fechaOC:      (orden.fecha        || '').split('T')[0],
      fechaEntrega: (orden.fechaEntrega || '').split('T')[0],
      notas:        orden.notas                 || '',
    });
    setShowPreview(true);
  };

  const closePreview = () => {
    setShowPreview(false);
    setSavedPoNumber('');
    setSavedSnapshot(null);
  };

  const handleCompartir = async () => {
    if (!poDocRef.current) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(poDocRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `OC-${savedPoNumber || 'historial'}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast('PDF descargado');
      }
    } catch {
      showToast('No se pudo generar el PDF.', 'error');
    }
  };

  // Preview computed values
  const pvSrc = savedSnapshot || {};
  const pvFilas = pvSrc.filas || [];
  const pvProveedor = pvSrc.proveedor || '';
  const pvContacto = pvSrc.contacto || '';
  const pvFechaOC = pvSrc.fechaOC || '';
  const pvFechaEntrega = pvSrc.fechaEntrega || '';
  const pvNotas = pvSrc.notas || '';
  const pvSubtotal = pvFilas.reduce((s, f) =>
    s + (parseFloat(f.cantidad) || 0) * (parseFloat(f.precioUnitario) || 0), 0);
  const pvIvaTotal = pvFilas.reduce((s, f) => {
    const rowSub = (parseFloat(f.cantidad) || 0) * (parseFloat(f.precioUnitario) || 0);
    return s + rowSub * ((f.iva || 0) / 100);
  }, 0);
  const pvTotal = pvSubtotal + pvIvaTotal;

  return (
    <div className="oh-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Toolbar ── */}
      <div className="oh-toolbar">
        <Link to="/ordenes-compra" className="oh-back-link">
          <FiChevronLeft size={15} /> Órdenes de Compra
        </Link>
        <div className="oh-toolbar-actions">
          <button
            className={`btn btn-secondary oh-filter-btn${activeFilterCount ? ' oh-filter-active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
          >
            <FiFilter size={14} />
            Filtros
            {activeFilterCount > 0 && <span className="oh-filter-badge">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilters && (
        <div className="oh-filter-panel">
          <div className="oh-filter-grid">
            <div className="oh-filter-field">
              <label>Fecha desde</label>
              <input type="date" value={filters.fechaDesde} onChange={e => updateFilter('fechaDesde', e.target.value)} />
            </div>
            <div className="oh-filter-field">
              <label>Fecha hasta</label>
              <input type="date" value={filters.fechaHasta} onChange={e => updateFilter('fechaHasta', e.target.value)} />
            </div>
            <div className="oh-filter-field">
              <label>Proveedor</label>
              <input placeholder="Ej: Novagro" value={filters.proveedor} onChange={e => updateFilter('proveedor', e.target.value)} />
            </div>
            <div className="oh-filter-field">
              <label>Estado</label>
              <select value={filters.estado} onChange={e => updateFilter('estado', e.target.value)}>
                <option value="todos">Todos</option>
                <option value="activa">Activa</option>
                <option value="completada">Completada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button className="oh-clear-filters" onClick={clearFilters}>
              <FiX size={13} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="oh-stats-bar">
        <div className="oh-stat">
          <span className="oh-stat-value">{stats.total}</span>
          <span className="oh-stat-label">Total</span>
        </div>
        <div className="oh-stat-divider" />
        <div className="oh-stat">
          <span className="oh-stat-value oh-stat-green">{stats.activas}</span>
          <span className="oh-stat-label">Activas</span>
        </div>
        <div className="oh-stat-divider" />
        <div className="oh-stat">
          <span className="oh-stat-value">{stats.completadas}</span>
          <span className="oh-stat-label">Completadas</span>
        </div>
        {stats.canceladas > 0 && (
          <>
            <div className="oh-stat-divider" />
            <div className="oh-stat">
              <span className="oh-stat-value oh-stat-red">{stats.canceladas}</span>
              <span className="oh-stat-label">Canceladas</span>
            </div>
          </>
        )}
      </div>

      {/* ── Table card ── */}
      <div className="oh-table-card">
        <div className="oh-table-toprow">
          <span className="oh-result-count">
            {displayData.length === ordenes.length
              ? `${ordenes.length} orden${ordenes.length !== 1 ? 'es' : ''}`
              : `${displayData.length} de ${ordenes.length} órdenes`}
          </span>
          <div className="oh-sort-row">
            {sortConfig.map((s, idx) => (
              <div key={idx} className="oh-sort-group">
                <span className="oh-sort-label">{idx === 0 ? 'Ordenar por' : 'Luego por'}</span>
                <select
                  className="oh-sort-select"
                  value={s.field}
                  onChange={e => updateSort(idx, 'field', e.target.value)}
                >
                  <option value="">—</option>
                  {SORT_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <button
                  className={`oh-sort-dir-btn${!s.field ? ' oh-sort-dir-disabled' : ''}`}
                  disabled={!s.field}
                  onClick={() => updateSort(idx, 'dir', s.dir === 'asc' ? 'desc' : 'asc')}
                  title={s.dir === 'asc' ? 'Ascendente' : 'Descendente'}
                >
                  {s.dir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="empty-state">Cargando…</p>
        ) : displayData.length === 0 ? (
          <p className="empty-state">No hay órdenes con los filtros aplicados.</p>
        ) : (
          <div className="oh-table-wrapper">
            <table className="ol-table">
              <thead>
                <tr>
                  <th>N° OC</th>
                  <th>Proveedor</th>
                  <th className="ol-col-center">Fecha</th>
                  <th className="ol-col-center">Entrega est.</th>
                  <th className="ol-col-center">Productos</th>
                  <th className="ol-col-center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayData.map((orden) => (
                  <tr key={orden.id} className="ol-row">
                    <td className="ol-po-number">{orden.poNumber || '—'}</td>
                    <td>{orden.proveedor || <span className="ol-muted">Sin proveedor</span>}</td>
                    <td className="ol-col-center">{formatDate(orden.fecha)}</td>
                    <td className="ol-col-center">{formatDate(orden.fechaEntrega)}</td>
                    <td className="ol-col-center">
                      <span className="ol-items-count">
                        <FiPackage size={13} />
                        {Array.isArray(orden.items) ? orden.items.length : 0}
                      </span>
                    </td>
                    <td className="ol-col-center">
                      <span className={`ol-estado ol-estado--${orden.estado || 'activa'}`}>
                        {ESTADO_LABELS[orden.estado] || 'Activa'}
                      </span>
                    </td>
                    <td className="ol-col-action">
                      <button className="ol-btn-open"
                        onClick={() => handleVisualizarOrden(orden)}
                        title="Visualizar OC">
                        <FiEye size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Preview Modal ── */}
      {showPreview && savedSnapshot && createPortal(
        <div className="ol-preview-backdrop" onClick={closePreview}>
          <div className="ol-preview-container" onClick={e => e.stopPropagation()}>
            <div className="ol-preview-toolbar">
              <span className="ol-preview-toolbar-title">Vista previa — Orden de Compra</span>
              <div className="ol-preview-toolbar-actions">
                <button className="btn btn-secondary" onClick={handleCompartir}>
                  <FiShare2 size={15} /> Compartir
                </button>
                <button className="btn btn-secondary" onClick={() => window.print()}>
                  <FiPrinter size={15} /> Imprimir / PDF
                </button>
                <button className="btn btn-secondary" onClick={closePreview}>
                  <FiX size={15} /> Cerrar
                </button>
              </div>
            </div>

            <div className="po-doc-wrap">
              <div className="po-document" ref={poDocRef}>
                <div className="po-doc-header">
                  <div className="po-doc-brand">
                    {empresaConfig.logoUrl
                      ? <img src={empresaConfig.logoUrl} alt="Logo" className="po-doc-logo-img" />
                      : <div className="po-doc-logo">AU</div>
                    }
                    <div className="po-doc-brand-info">
                      <div className="po-doc-brand-name">{empresaConfig.nombreEmpresa || 'Finca Aurora'}</div>
                      {empresaConfig.identificacion && <div className="po-doc-brand-sub">Cédula: {empresaConfig.identificacion}</div>}
                      {empresaConfig.whatsapp      && <div className="po-doc-brand-sub">Tel: {empresaConfig.whatsapp}</div>}
                      {empresaConfig.correo        && <div className="po-doc-brand-sub">{empresaConfig.correo}</div>}
                      {empresaConfig.direccion     && <div className="po-doc-brand-sub">{empresaConfig.direccion}</div>}
                    </div>
                  </div>
                  <div className="po-doc-title-block">
                    <div className="po-doc-title">ORDEN DE COMPRA</div>
                    <table className="po-doc-meta-table">
                      <tbody>
                        <tr><td>N°:</td><td><strong>{savedPoNumber || '—'}</strong></td></tr>
                        <tr><td>Fecha:</td><td><strong>{formatDateLong(pvFechaOC)}</strong></td></tr>
                        {pvFechaEntrega && (
                          <tr><td>Entrega:</td><td><strong>{formatDateLong(pvFechaEntrega)}</strong></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="po-doc-parties">
                  <div className="po-doc-party">
                    <div className="po-doc-party-label">PROVEEDOR</div>
                    <div className="po-doc-party-value">{pvProveedor || '___________________________'}</div>
                    {pvContacto && <div className="po-doc-party-contact">{pvContacto}</div>}
                  </div>
                </div>

                {(() => {
                  const previewItems = pvFilas.filter(f => f.nombreComercial.trim());
                  return (
                    <table className="po-doc-table">
                      <thead>
                        <tr>
                          <th className="po-col-num">#</th>
                          <th className="po-col-product">Producto</th>
                          <th className="po-col-qty">Cantidad</th>
                          <th className="po-col-unit">Unidad</th>
                          <th className="po-col-price">Precio Unit.</th>
                          <th className="po-col-price">IVA</th>
                          <th className="po-col-total">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewItems.length === 0 && (
                          <tr><td colSpan={7} className="po-table-empty">Sin productos</td></tr>
                        )}
                        {previewItems.map((f, idx) => {
                          const qty = parseFloat(f.cantidad) || 0;
                          const price = parseFloat(f.precioUnitario) || 0;
                          const total = qty * price;
                          return (
                            <tr key={f._key}>
                              <td className="po-col-num">{idx + 1}</td>
                              <td className="po-col-product">{f.nombreComercial}</td>
                              <td className="po-col-qty">{f.cantidad || '—'}</td>
                              <td className="po-col-unit">{f.unidad}</td>
                              <td className="po-col-price">{price > 0 ? `${price.toFixed(2)} ${f.moneda}` : '—'}</td>
                              <td className="po-col-price">{f.iva > 0 ? `${f.iva}%` : '—'}</td>
                              <td className="po-col-total">{total > 0 ? `${total.toFixed(2)} ${f.moneda}` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {pvTotal > 0 && (
                        <tfoot>
                          {pvIvaTotal > 0 && (
                            <tr>
                              <td colSpan={6} className="po-total-label" style={{ opacity: 0.7 }}>IVA</td>
                              <td className="po-total-value" style={{ color: '#cc33ff' }}>{pvIvaTotal.toFixed(2)}</td>
                            </tr>
                          )}
                          <tr>
                            <td colSpan={6} className="po-total-label">TOTAL ESTIMADO</td>
                            <td className="po-total-value">{pvTotal.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  );
                })()}

                {pvNotas && (
                  <div className="po-doc-notes">
                    <strong>Notas / Condiciones:</strong> {pvNotas}
                  </div>
                )}

                <div className="po-doc-signatures">
                  <div className="po-sig">
                    <div className="po-sig-line" />
                    <div className="po-sig-role">Elaborado por</div>
                    {elaboradoPor && <div className="po-sig-name">{elaboradoPor}</div>}
                  </div>
                  <div className="po-sig">
                    <div className="po-sig-line" />
                    <div className="po-sig-role">Aprobado por</div>
                  </div>
                  <div className="po-sig">
                    <div className="po-sig-line" />
                    <div className="po-sig-role">Recibido por / Fecha</div>
                  </div>
                </div>

                <div className="po-doc-footer">
                  Documento generado por Sistema Aurora
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default OrdenesHistorial;
