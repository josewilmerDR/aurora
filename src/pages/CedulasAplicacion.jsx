import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { FiFileText, FiPrinter, FiShare2, FiX } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './CedulasAplicacion.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return new Date(ts);
};

const formatDateLong = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

const formatShortDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

const isOverdue = (task) => {
  if (task.status === 'completed_by_user') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  return new Date(due.getFullYear(), due.getMonth(), due.getDate())
    < new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

// ─────────────────────────────────────────────────────────────────────────────
function CedulasAplicacion() {
  const apiFetch = useApiFetch();
  const [tasks,    setTasks]    = useState([]);
  const [lotes,    setLotes]    = useState([]);
  const [grupos,   setGrupos]   = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [packages, setPackages] = useState([]);
  const [productos, setProductos] = useState([]);
  const [config,   setConfig]   = useState({});
  const [loading,  setLoading]  = useState(true);
  const [previewTask, setPreviewTask] = useState(null);
  const docRef = useRef(null);

  const location = useLocation();

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tasks').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/packages').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ]).then(([t, l, g, s, p, pr, c]) => {
      setTasks(Array.isArray(t) ? t : []);
      setLotes(Array.isArray(l) ? l : []);
      setGrupos(Array.isArray(g) ? g : []);
      setSiembras(Array.isArray(s) ? s : []);
      setPackages(Array.isArray(p) ? p : []);
      setProductos(Array.isArray(pr) ? pr : []);
      setConfig(c || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Auto-open cedula from query param ?open=taskId
  useEffect(() => {
    if (!tasks.length) return;
    const params = new URLSearchParams(location.search);
    const openId = params.get('open');
    if (openId) {
      const task = tasks.find(t => t.id === openId);
      if (task) setPreviewTask(task);
    }
  }, [tasks, location.search]);

  // ── Derived data ─────────────────────────────────────────────────────────
  const aplicacionTasks = useMemo(() =>
    tasks
      .filter(t =>
        (t.activity?.type === 'aplicacion' || (t.activity?.productos?.length > 0 && t.type !== 'SOLICITUD_COMPRA')) &&
        t.status !== 'completed_by_user' &&
        t.type !== 'REMINDER_3_DAY'
      )
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    [tasks]
  );

  const getSource = (task) => {
    if (task.loteId)  return lotes.find(l => l.id === task.loteId)   || null;
    if (task.grupoId) return grupos.find(g => g.id === task.grupoId) || null;
    return null;
  };

  const getPackageName = (paqueteId) =>
    packages.find(p => p.id === paqueteId)?.nombrePaquete || null;

  const getProductoCatalog = (productoId) =>
    productos.find(p => p.id === productoId) || null;

  // ── Computed preview data ─────────────────────────────────────────────────
  const previewSource = previewTask ? getSource(previewTask) : null;
  const previewPackageName = previewSource?.paqueteId
    ? getPackageName(previewSource.paqueteId) : null;
  const previewProductos = previewTask?.activity?.productos || [];

  const previewBloques = useMemo(() => {
    if (!previewSource?.bloques) return [];
    return previewSource.bloques
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [previewSource, siembras]);

  const pvTotalHa = previewBloques.reduce(
    (s, b) => s + (parseFloat(b.areaCalculada) || 0), 0
  );

  // ── PDF share ─────────────────────────────────────────────────────────────
  const handleShare = async () => {
    if (!docRef.current || !previewTask) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Cedula-${previewTask.activityName || previewTask.id}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // silently fail
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Cargando cédulas...</div>;

  return (
    <div>
      {aplicacionTasks.length === 0 ? (
        <div className="empty-state">No hay tareas de aplicación pendientes.</div>
      ) : (
        <div className="cedulas-list">
          {aplicacionTasks.map(task => (
            <div key={task.id} className={`cedula-row${isOverdue(task) ? ' overdue' : ''}`}>
              <div className="cedula-row-info">
                <span className="cedula-row-name">{task.activityName}</span>
                <span className="cedula-row-meta">
                  {task.loteName}
                  {task.responsableName ? ` · ${task.responsableName}` : ''}
                </span>
              </div>
              <div className="cedula-row-right">
                <span className={`cedula-status-badge${isOverdue(task) ? ' overdue' : ''}`}>
                  {isOverdue(task) ? 'Vencida' : 'Pendiente'}
                </span>
                <span className="cedula-due-date">{formatShortDate(task.dueDate)}</span>
                <button
                  className="btn btn-secondary cedula-btn-preview"
                  onClick={() => setPreviewTask(task)}
                  title="Ver Cédula de Aplicación"
                >
                  <FiFileText size={15} /> Ver Cédula
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PREVIEW MODAL ── */}
      {previewTask && createPortal(
        <div className="ca-preview-backdrop" onClick={() => setPreviewTask(null)}>
          <div className="ca-preview-container" onClick={e => e.stopPropagation()}>

            {/* Toolbar */}
            <div className="ca-preview-toolbar">
              <span className="ca-preview-toolbar-title">
                Cédula de Aplicación — {previewTask.activityName}
              </span>
              <div className="ca-preview-toolbar-actions">
                <button className="btn btn-secondary" onClick={handleShare}>
                  <FiShare2 size={15} /> Compartir
                </button>
                <button className="btn btn-secondary" onClick={() => window.print()}>
                  <FiPrinter size={15} /> Imprimir
                </button>
                <button className="btn btn-secondary" onClick={() => setPreviewTask(null)}>
                  <FiX size={15} /> Cerrar
                </button>
              </div>
            </div>

            {/* Documento */}
            <div className="ca-doc-wrap">
              <div className="ca-document" ref={docRef}>

                {/* ── Encabezado ── */}
                <div className="ca-doc-header">
                  <div className="ca-doc-brand">
                    {config.logoUrl
                      ? <img src={config.logoUrl} alt="Logo" className="ca-doc-logo-img" />
                      : <div className="ca-doc-logo">AU</div>
                    }
                    <div className="ca-doc-brand-info">
                      <div className="ca-doc-brand-name">{config.nombreEmpresa || 'Finca Aurora'}</div>
                      {config.identificacion && <div className="ca-doc-brand-sub">Cédula: {config.identificacion}</div>}
                      {config.whatsapp      && <div className="ca-doc-brand-sub">Tel: {config.whatsapp}</div>}
                      {config.correo        && <div className="ca-doc-brand-sub">{config.correo}</div>}
                      {config.direccion     && <div className="ca-doc-brand-sub">{config.direccion}</div>}
                    </div>
                  </div>
                  <div className="ca-doc-title-block">
                    <div className="ca-doc-title">CÉDULA DE APLICACIÓN DE AGROQUÍMICOS</div>
                    <div className="ca-doc-subtitle">Aplicación: {previewTask.activityName}</div>
                  </div>
                </div>

                <hr className="ca-doc-divider" />

                {/* ── Datos generales ── */}
                <div className="ca-section-title">Datos Generales</div>
                <div className="ca-datos-grid">
                  <div className="ca-dato">
                    <span className="ca-dato-label">Fecha Programada de Aplicación</span>
                    <span className="ca-dato-value">{formatDateLong(previewTask.dueDate)}</span>
                  </div>
                  <div className="ca-dato">
                    <span className="ca-dato-label">Lote / Grupo</span>
                    <span className="ca-dato-value">{previewTask.loteName}</span>
                  </div>
                  {previewSource?.fechaCreacion && (
                    <div className="ca-dato">
                      <span className="ca-dato-label">Fecha de Creación</span>
                      <span className="ca-dato-value">{formatDateLong(tsToDate(previewSource.fechaCreacion))}</span>
                    </div>
                  )}
                  {(previewSource?.cosecha || previewSource?.etapa) && (
                    <div className="ca-dato">
                      <span className="ca-dato-label">Cosecha / Etapa</span>
                      <span className="ca-dato-value">
                        {[previewSource.cosecha, previewSource.etapa].filter(Boolean).join(' / ')}
                      </span>
                    </div>
                  )}
                  <div className="ca-dato">
                    <span className="ca-dato-label">Área Calculada (ha)</span>
                    <span className="ca-dato-value">{previewTask.loteHectareas ?? '—'}</span>
                  </div>
                  <div className="ca-dato">
                    <span className="ca-dato-label">Responsable</span>
                    <span className="ca-dato-value">{previewTask.responsableName || '—'}</span>
                  </div>
                  {previewPackageName && (
                    <div className="ca-dato ca-dato-full">
                      <span className="ca-dato-label">Paquete Técnico</span>
                      <span className="ca-dato-value">{previewPackageName}</span>
                    </div>
                  )}
                </div>

                {/* ── Tabla de bloques (sólo para grupos) ── */}
                {previewBloques.length > 0 && (
                  <>
                    <div className="ca-section-title">Bloques Incluidos</div>
                    <table className="ca-doc-table ca-table-sm">
                      <thead>
                        <tr>
                          <th>Lote</th>
                          <th>Bloque</th>
                          <th className="ca-col-num">Ha.</th>
                          <th className="ca-col-num">Plantas</th>
                          <th>Material / Variedad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewBloques.map(b => (
                          <tr key={b.id}>
                            <td>{b.loteNombre || '—'}</td>
                            <td>{b.bloque || '—'}</td>
                            <td className="ca-col-num">{b.areaCalculada ?? '—'}</td>
                            <td className="ca-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                            <td>{b.materialNombre || b.variedad || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      {previewBloques.length > 1 && (
                        <tfoot>
                          <tr>
                            <td colSpan={2}><strong>Total</strong></td>
                            <td className="ca-col-num"><strong>{pvTotalHa.toFixed(4)}</strong></td>
                            <td colSpan={2}></td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </>
                )}

                {/* ── Tabla de productos ── */}
                <div className="ca-section-title">Total Productos (Dosificación)</div>
                {previewProductos.length === 0 ? (
                  <p className="ca-empty-products">Sin productos registrados.</p>
                ) : (
                  <table className="ca-doc-table">
                    <thead>
                      <tr>
                        <th>Id</th>
                        <th>Nombre Comercial — Ingrediente Activo</th>
                        <th className="ca-col-num">Días a Cosecha</th>
                        <th className="ca-col-num">Per. Reingreso (h)</th>
                        <th className="ca-col-num">Cant./Ha</th>
                        <th>Unidad</th>
                        <th className="ca-col-num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewProductos.map((prod, i) => {
                        const info       = getProductoCatalog(prod.productoId);
                        const cantPorHa  = prod.cantidadPorHa ?? prod.cantidad;
                        const hectareas  = parseFloat(previewTask.loteHectareas || 1);
                        const total      = cantPorHa != null
                          ? (parseFloat(cantPorHa) * hectareas).toFixed(3)
                          : '—';
                        const nombreFull = info?.ingredienteActivo
                          ? `${prod.nombreComercial} — ${info.ingredienteActivo}`
                          : prod.nombreComercial;
                        return (
                          <tr key={prod.productoId || i}>
                            <td>{info?.idProducto || '—'}</td>
                            <td>{nombreFull}</td>
                            <td className="ca-col-num">{prod.periodoACosecha ?? '—'}</td>
                            <td className="ca-col-num">{prod.periodoReingreso ?? '—'}</td>
                            <td className="ca-col-num">{cantPorHa ?? '—'}</td>
                            <td>{prod.unidad || '—'}</td>
                            <td className="ca-col-num"><strong>{total}</strong></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* ── Nota de seguridad ── */}
                <div className="ca-doc-safety-note">
                  No olvide usar el Equipo de Protección Personal durante la aplicación.
                  Recuerde no contaminar fuentes de agua con productos o envases vacíos.
                </div>

                {/* ── Firma operarios ── */}
                <div className="ca-doc-sig-row">
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Fecha de Aplicación</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Hora Inicial / Hora Final</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Operario</div>
                  </div>
                </div>

                {/* ── Firmas finales ── */}
                <div className="ca-doc-sig-row ca-doc-sig-final">
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Encargado de Finca</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Encargado de Bodega</div>
                  </div>
                  <div className="ca-sig-block">
                    <div className="ca-sig-line" />
                    <div className="ca-sig-label">Sup. Aplicaciones / Regente</div>
                  </div>
                </div>

                <div className="ca-doc-footer">
                  Documento generado por Sistema Aurora · {new Date().toLocaleDateString('es-ES')}
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

export default CedulasAplicacion;
