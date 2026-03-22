import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, Link } from 'react-router-dom';
import { FiFileText, FiPrinter, FiShare2, FiX, FiCheckCircle, FiPlusCircle } from 'react-icons/fi';
import { FaTractor } from 'react-icons/fa';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser, hasMinRole } from '../contexts/UserContext';
import NuevaCedulaModal from './NuevaCedulaModal';
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

// Semana: domingo → sábado. offsetWeeks=0 → esta semana, 1 → próxima semana
const getWeekBounds = (offsetWeeks = 0) => {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() + offsetWeeks * 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);
  return { start: startOfWeek, end: endOfWeek };
};

const CEDULA_STATUS_LABEL = {
  pendiente:          'Pendiente',
  en_transito:        'En Tránsito',
  aplicada_en_campo:  'Aplicada',
};

// ─────────────────────────────────────────────────────────────────────────────
function CedulasAplicacion() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [tasks,     setTasks]     = useState([]);
  const [lotes,     setLotes]     = useState([]);
  const [grupos,    setGrupos]    = useState([]);
  const [siembras,  setSiembras]  = useState([]);
  const [packages,  setPackages]  = useState([]);
  const [productos, setProductos] = useState([]);
  const [cedulas,   setCedulas]   = useState([]);
  const [config,    setConfig]    = useState({});
  const [loading,   setLoading]   = useState(true);
  const [previewTask, setPreviewTask] = useState(null);
  const [anchorWeek, setAnchorWeek] = useState(0);  // 0 = esta semana
  const [weeksShown, setWeeksShown] = useState(2);  // cuántas semanas mostrar
  const [actionLoading, setActionLoading] = useState(null); // cedulaId | 'new-{taskId}'
  const [showNuevaModal, setShowNuevaModal] = useState(false);
  const docRef = useRef(null);

  const location = useLocation();

  const loadCedulas = useCallback(() =>
    apiFetch('/api/cedulas').then(r => r.json()).then(d => {
      setCedulas(Array.isArray(d) ? d : []);
    }).catch(console.error),
    [apiFetch]
  );

  useEffect(() => {
    Promise.all([
      apiFetch('/api/tasks').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/packages').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/cedulas').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ]).then(([t, l, g, s, p, pr, c, cfg]) => {
      setTasks(Array.isArray(t) ? t : []);
      setLotes(Array.isArray(l) ? l : []);
      setGrupos(Array.isArray(g) ? g : []);
      setSiembras(Array.isArray(s) ? s : []);
      setPackages(Array.isArray(p) ? p : []);
      setProductos(Array.isArray(pr) ? pr : []);
      setCedulas(Array.isArray(c) ? c : []);
      setConfig(cfg || {});
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
        t.status !== 'skipped' &&
        t.type !== 'REMINDER_3_DAY'
      )
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    [tasks]
  );

  const cedulasByTaskId = useMemo(() => {
    const map = {};
    for (const c of cedulas) map[c.taskId] = c;
    return map;
  }, [cedulas]);

  const visibleTasks = useMemo(() => {
    const start = getWeekBounds(anchorWeek).start;
    const end   = getWeekBounds(anchorWeek + weeksShown - 1).end;
    return aplicacionTasks.filter(t => {
      const due = new Date(t.dueDate);
      return due >= start && due <= end;
    });
  }, [aplicacionTasks, anchorWeek, weeksShown]);

  const rangeLabel = useMemo(() => {
    const from = getWeekBounds(anchorWeek);
    const to   = getWeekBounds(anchorWeek + weeksShown - 1);
    const fmt  = d => d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    return `${fmt(from.start)} – ${fmt(to.end)}`;
  }, [anchorWeek, weeksShown]);

  const hasMoreWeeks = useMemo(() => {
    const currentEnd = getWeekBounds(anchorWeek + weeksShown - 1).end;
    return aplicacionTasks.some(t => new Date(t.dueDate) > currentEnd);
  }, [aplicacionTasks, anchorWeek, weeksShown]);

  const overdueItems = useMemo(() =>
    aplicacionTasks.filter(isOverdue),
    [aplicacionTasks]
  );

  const [showOverdue, setShowOverdue] = useState(false);

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
    // For manual cedulas, use task-level bloques (subset); otherwise use source bloques
    const bloqueIds = previewTask?.bloques || previewSource?.bloques;
    if (!bloqueIds) return [];
    return bloqueIds
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [previewSource, siembras]);

  const pvTotalHa = previewBloques.reduce(
    (s, b) => s + (parseFloat(b.areaCalculada) || 0), 0
  );

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleGenerarCedula = async (taskId) => {
    setActionLoading(`new-${taskId}`);
    try {
      const res = await apiFetch('/api/cedulas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.cedula) {
          // Cedula already exists in DB but wasn't in local state (stale cache) — recover silently
          setCedulas(prev =>
            prev.some(c => c.taskId === data.cedula.taskId) ? prev : [...prev, data.cedula]
          );
        } else {
          alert(data.message || 'Error al generar la cédula.');
        }
        return;
      }
      // Use the returned cedula directly to avoid stale-cache issues on GET
      setCedulas(prev => [...prev, data]);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMezclaLista = async (cedulaId) => {
    if (!confirm('¿Confirmar que la mezcla está lista? Esto debitará el inventario.')) return;
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/mezcla-lista`, { method: 'PUT' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Error al actualizar la cédula.');
        return;
      }
      // Update local state directly — avoids stale GET cache on Firebase Hosting
      setCedulas(prev => prev.map(c =>
        c.id === cedulaId ? { ...c, status: 'en_transito', mezclaListaAt: new Date().toISOString() } : c
      ));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAplicada = async (cedulaId) => {
    if (!confirm('¿Confirmar que la aplicación fue realizada en campo?')) return;
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/aplicada`, { method: 'PUT' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Error al registrar la aplicación.');
        return;
      }
      // Update local state directly — avoids stale GET cache on Firebase Hosting
      const taskId = cedulas.find(c => c.id === cedulaId)?.taskId;
      setCedulas(prev => prev.map(c =>
        c.id === cedulaId ? { ...c, status: 'aplicada_en_campo', aplicadaAt: new Date().toISOString() } : c
      ));
      if (taskId) {
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'completed_by_user' } : t
        ));
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleAnular = async (cedulaId) => {
    const cedula = cedulas.find(c => c.id === cedulaId);
    const msg = cedula?.status === 'en_transito'
      ? '¿Anular esta cédula? La mezcla ya fue preparada — el inventario será restaurado automáticamente.'
      : '¿Anular esta cédula? La tarea asociada quedará como omitida.';
    if (!confirm(msg)) return;
    setActionLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/anular`, { method: 'PUT' });
      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Error al anular la cédula.');
        return;
      }
      const taskId = cedulas.find(c => c.id === cedulaId)?.taskId;
      setCedulas(prev => prev.filter(c => c.id !== cedulaId));
      if (taskId) {
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, status: 'skipped' } : t
        ));
      }
      window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleOmitirTarea = async (taskId) => {
    if (!confirm('¿Omitir esta tarea vencida? No se generará cédula de aplicación.')) return;
    setActionLoading(`skip-${taskId}`);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'skipped' }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.message || 'Error al omitir la tarea.');
        return;
      }
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: 'skipped' } : t
      ));
      window.dispatchEvent(new CustomEvent('aurora-tasks-changed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleNuevaCedulaSuccess = (cedula, task) => {
    setCedulas(prev => [...prev, cedula]);
    setTasks(prev => [...prev, task]);
    setShowNuevaModal(false);
  };

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

  // ── Row renderer (shared between overdue panel and main list) ────────────
  const renderCedulaRow = (task, { allowSkipTask = false } = {}) => {
    const cedula   = cedulasByTaskId[task.id];
    const isLdg    = actionLoading === (cedula ? cedula.id : `new-${task.id}`)
                  || actionLoading === `skip-${task.id}`;
    return (
      <div key={task.id} className={`cedula-row${isOverdue(task) ? ' overdue' : ''}`}>
        <div className="cedula-row-info">
          <span className="cedula-row-name">{task.activityName}</span>
          <span className="cedula-row-meta">
            {task.loteName}
            {task.responsableName ? ` · ${task.responsableName}` : ''}
          </span>
          {cedula && (
            <span className="cedula-consecutivo">{cedula.consecutivo}</span>
          )}
        </div>
        <div className="cedula-row-badges">
          <span className={`cedula-status-badge${isOverdue(task) ? ' overdue' : ''}`}>
            {isOverdue(task) ? 'Vencida' : 'Pendiente'}
          </span>
          <span className="cedula-due-date">{formatShortDate(task.dueDate)}</span>
          {cedula?.status === 'pendiente' && (
            <span className="cedula-flow-badge pendiente">Pendiente</span>
          )}
          {cedula?.status === 'en_transito' && (
            <span className="cedula-flow-badge en-transito">En Tránsito</span>
          )}
        </div>

        <div className="cedula-row-actions">
            {!cedula && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-secondary cedula-btn-action"
                onClick={() => handleGenerarCedula(task.id)}
                disabled={isLdg}
                title="Generar Cédula de Aplicación"
              >
                <FiPlusCircle size={14} />
                {isLdg ? 'Generando…' : 'Generar Cédula'}
              </button>
            )}

            {!cedula && allowSkipTask && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-danger cedula-btn-action cedula-btn-anular"
                onClick={() => handleOmitirTarea(task.id)}
                disabled={isLdg}
                title="Omitir esta tarea sin generar cédula"
              >
                <FiX size={14} />
                {isLdg ? 'Omitiendo…' : 'Omitir Tarea'}
              </button>
            )}

            {cedula?.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-secondary cedula-btn-action"
                onClick={() => handleMezclaLista(cedula.id)}
                disabled={isLdg}
                title="Confirmar que la mezcla está lista"
              >
                <FiCheckCircle size={14} />
                {isLdg ? 'Procesando…' : 'Mezcla Lista'}
              </button>
            )}

            {cedula?.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador') && (
              <button
                className="btn btn-primary cedula-btn-action"
                onClick={() => handleAplicada(cedula.id)}
                disabled={isLdg}
                title="Confirmar aplicación en campo"
              >
                <FaTractor size={14} />
                {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
              </button>
            )}

            {cedula && cedula.status !== 'aplicada_en_campo' && hasMinRole(currentUser?.rol, 'encargado') && (
              <button
                className="btn btn-danger cedula-btn-action cedula-btn-anular"
                onClick={() => handleAnular(cedula.id)}
                disabled={isLdg}
                title="Anular cédula"
              >
                <FiX size={14} />
                {isLdg ? 'Anulando…' : 'Anular'}
              </button>
            )}

            {cedula && (
              <button
                className="btn btn-secondary cedula-btn-preview"
                onClick={() => setPreviewTask(task)}
                title="Ver Cédula de Aplicación"
              >
                <FiFileText size={15} /> Ver Cédula
              </button>
            )}
          </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Cargando cédulas...</div>;

  return (
    <div>
      {/* ── Panel de Vencidas ── */}
      {overdueItems.length > 0 && (
        <div className="cedulas-overdue-panel">
          <button
            className="cedulas-overdue-header"
            onClick={() => setShowOverdue(v => !v)}
          >
            <span className="cedulas-overdue-title">
              ⚠ Cédulas Vencidas
              <span className="cedulas-overdue-badge">{overdueItems.length}</span>
            </span>
            <span className="cedulas-overdue-chevron">{showOverdue ? '▲' : '▼'}</span>
          </button>
          {showOverdue && (
            <div className="cedulas-overdue-list">
              {overdueItems.map(task => renderCedulaRow(task, { allowSkipTask: true }))}
            </div>
          )}
        </div>
      )}

      {/* ── Barra de filtro ── */}
      <div className="cedulas-filter-bar">
        <div className="cedulas-period-nav">
          <button
            className="btn btn-secondary cedulas-nav-btn"
            onClick={() => { setAnchorWeek(w => w - 1); setWeeksShown(2); }}
            title="Semana anterior"
          >‹</button>
          <span className="cedulas-period-label">{rangeLabel}</span>
          <button
            className="btn btn-secondary cedulas-nav-btn"
            onClick={() => { setAnchorWeek(w => w + 1); setWeeksShown(2); }}
            title="Semana siguiente"
          >›</button>
          {anchorWeek !== 0 && (
            <button
              className="btn btn-secondary cedulas-nav-today"
              onClick={() => { setAnchorWeek(0); setWeeksShown(2); }}
              title="Volver a esta semana"
            >Hoy</button>
          )}
        </div>
        <span className="cedulas-filter-count">{visibleTasks.length} tarea(s)</span>
        {hasMoreWeeks && (
          <button
            className="btn btn-secondary cedulas-filter-toggle"
            onClick={() => setWeeksShown(n => n + 1)}
          >
            Ver más cédulas
          </button>
        )}
        {hasMinRole(currentUser?.rol, 'encargado') && (
          <button
            className="btn btn-primary cedulas-nueva-btn"
            onClick={() => setShowNuevaModal(true)}
          >
            <FiPlusCircle size={14} /> Nueva Cédula
          </button>
        )}
        <Link to="/aplicaciones/historial" className="btn btn-secondary cedulas-historial-btn">
          📋 Historial
        </Link>
      </div>

      {visibleTasks.length === 0 ? (
        <div className="empty-state">
          {aplicacionTasks.length === 0
            ? 'No hay tareas de aplicación pendientes.'
            : 'No hay aplicaciones programadas para este período.'}
        </div>
      ) : (
        <div className="cedulas-list">
          {visibleTasks.map(task => renderCedulaRow(task))}
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
                {cedulasByTaskId[previewTask.id] && (
                  <span className="ca-toolbar-consecutivo">
                    {cedulasByTaskId[previewTask.id].consecutivo}
                  </span>
                )}
              </span>
              <div className="ca-preview-toolbar-actions">
                {/* ── Acciones de flujo inline ── */}
                {(() => {
                  const cedula = cedulasByTaskId[previewTask.id];
                  const isLdg  = actionLoading === cedula?.id;
                  if (!cedula) return null;
                  if (cedula.status === 'aplicada_en_campo') {
                    return (
                      <span className="ca-toolbar-applied-badge">
                        <FiCheckCircle size={14} /> Aplicada
                      </span>
                    );
                  }
                  if (cedula.status === 'pendiente' && hasMinRole(currentUser?.rol, 'encargado')) {
                    return (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleMezclaLista(cedula.id)}
                        disabled={isLdg}
                      >
                        <FiCheckCircle size={14} />
                        {isLdg ? 'Procesando…' : 'Mezcla Lista'}
                      </button>
                    );
                  }
                  if (cedula.status === 'en_transito' && hasMinRole(currentUser?.rol, 'trabajador')) {
                    return (
                      <button
                        className="btn btn-primary"
                        onClick={() => handleAplicada(cedula.id)}
                        disabled={isLdg}
                      >
                        <FaTractor size={14} />
                        {isLdg ? 'Registrando…' : 'Aplicada en Campo'}
                      </button>
                    );
                  }
                  return null;
                })()}

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
                    {cedulasByTaskId[previewTask.id] && (
                      <div className="ca-doc-consecutivo">{cedulasByTaskId[previewTask.id].consecutivo}</div>
                    )}
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
                    <span className="ca-dato-value">{pvTotalHa > 0 ? pvTotalHa.toFixed(4) : (previewTask.loteHectareas ?? '—')}</span>
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
                        const hectareas  = pvTotalHa > 0 ? pvTotalHa : parseFloat(previewTask.loteHectareas || 1);
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

      {/* ── Nueva Cédula Modal ── */}
      {showNuevaModal && (
        <NuevaCedulaModal
          lotes={lotes}
          grupos={grupos}
          siembras={siembras}
          productos={productos}
          apiFetch={apiFetch}
          onSuccess={handleNuevaCedulaSuccess}
          onClose={() => setShowNuevaModal(false)}
        />
      )}
    </div>
  );
}

export default CedulasAplicacion;
