import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  FiTrash2, FiCheckCircle, FiCircle, FiAlertCircle, FiMoreVertical,
  FiDownload, FiPrinter, FiFilter, FiChevronLeft, FiX, FiAlertTriangle, FiShare2, FiEdit2, FiPackage,
} from 'react-icons/fi';
import { useUser, hasMinRole } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import Toast from '../components/Toast';
import './Siembra.css';
import './SiembraHistorial.css';

// ── Sort utilities (same as Siembra.jsx) ─────────────────────────────────────
const SORT_FIELDS = [
  { value: 'fecha',    label: 'Fecha' },
  { value: 'lote',     label: 'Lote' },
  { value: 'bloque',   label: 'Bloque' },
  { value: 'plantas',  label: 'Plantas' },
  { value: 'area',     label: 'Área' },
  { value: 'material', label: 'Material' },
  { value: 'variedad', label: 'Variedad' },
  { value: 'fechaCierre', label: 'F. Cierre' },
];

function getSortVal(r, field) {
  switch (field) {
    case 'fecha':    return r.fecha || '';
    case 'lote':     return (r.loteNombre || '').toLowerCase();
    case 'bloque':   return (r.bloque || '').toLowerCase();
    case 'plantas':  return r.plantas || 0;
    case 'area':     return r.areaCalculada || 0;
    case 'material': return (r.materialNombre || '').toLowerCase();
    case 'variedad': return (r.variedad || '').toLowerCase();
    case 'fechaCierre': return r.fechaCierre || '';
    default:            return '';
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

const EMPTY_FILTERS = {
  fechaDesde: '', fechaHasta: '',
  lote: '', bloque: '', material: '', variedad: '',
  cerrado: 'todos',
};

function applyFilters(data, f) {
  return data.filter(r => {
    if (f.fechaDesde && r.fecha < f.fechaDesde) return false;
    if (f.fechaHasta && r.fecha > f.fechaHasta) return false;
    if (f.lote     && !r.loteNombre?.toLowerCase().includes(f.lote.toLowerCase()))     return false;
    if (f.bloque   && !r.bloque?.toLowerCase().includes(f.bloque.toLowerCase()))       return false;
    if (f.material && !r.materialNombre?.toLowerCase().includes(f.material.toLowerCase())) return false;
    if (f.variedad && !r.variedad?.toLowerCase().includes(f.variedad.toLowerCase()))   return false;
    if (f.cerrado === 'cerrado' && !r.cerrado)  return false;
    if (f.cerrado === 'abierto' &&  r.cerrado)  return false;
    return true;
  });
}

const formatFecha = (iso) =>
  new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' });

function SiembraHistorialPreview({ fincaConfig, displayData, stats, onClose }) {
  const fechaEmision = new Date().toLocaleDateString('es-CR', { day: '2-digit', month: 'long', year: 'numeric' });
  const docRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    document.body.classList.add('sh-preview-open');
    return () => document.body.classList.remove('sh-preview-open');
  }, []);

  const handlePrint = () => window.print();

  const handleShare = async () => {
    if (!docRef.current || sharing) return;
    setSharing(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `historial-siembra-${new Date().toISOString().slice(0, 10)}.pdf`;
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
    } catch { /* silencioso */ }
    finally { setSharing(false); }
  };

  return createPortal(
    <div className="sh-preview-backdrop">
      {/* ── Topbar ── */}
      <div className="sh-preview-topbar no-print">
        <span className="sh-preview-title">Vista previa — Historial de Siembra</span>
        <div className="sh-preview-topbar-actions">
          <button className="sh-preview-btn-close" onClick={onClose}><FiX size={15} /> Cerrar</button>
          <button className="sh-preview-btn-share" onClick={handleShare} disabled={sharing}>
            <FiShare2 size={15} /> {sharing ? 'Generando…' : 'Compartir PDF'}
          </button>
          <button className="sh-preview-btn-print" onClick={handlePrint}><FiPrinter size={15} /> Imprimir / PDF</button>
        </div>
      </div>

      {/* ── Documento ── */}
      <div className="sh-preview-doc-wrap">
        <div className="sh-preview-doc" ref={docRef}>

          {/* Encabezado */}
          <div className="pr-doc-header">
            <div className="pr-doc-brand">
              <div className="pr-doc-logo">
                {fincaConfig.logoUrl
                  ? <img src={fincaConfig.logoUrl} alt="Logo" className="pr-doc-logo-img" />
                  : 'AU'}
              </div>
              <div className="pr-doc-brand-info">
                <div className="pr-doc-brand-name">{fincaConfig.nombreEmpresa.toUpperCase()}</div>
                {fincaConfig.identificacion && <div className="pr-doc-brand-sub">Céd. {fincaConfig.identificacion}</div>}
                {fincaConfig.direccion && (
                  <div className="pr-doc-brand-sub">
                    {fincaConfig.direccion}{fincaConfig.whatsapp ? ` · Tel: ${fincaConfig.whatsapp}` : ''}
                  </div>
                )}
              </div>
            </div>
            <div className="pr-doc-title-block">
              <div className="pr-doc-title">HISTORIAL DE SIEMBRA</div>
              <table className="pr-doc-meta-table">
                <tbody>
                  <tr><td>Emisión:</td><td>{fechaEmision}</td></tr>
                  {displayData.find(r => r.variedad) && (
                    <tr><td>Variedad:</td><td>{displayData.find(r => r.variedad)?.variedad}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Resumen */}
          <div className="sh-preview-stats">
            <div className="sh-preview-stat-item">
              <span className="sh-preview-stat-label">Total plantas</span>
              <span className="sh-preview-stat-val">{stats.totalPlantas.toLocaleString()}</span>
            </div>
            <div className="sh-preview-stat-item">
              <span className="sh-preview-stat-label">Área calculada</span>
              <span className="sh-preview-stat-val">{stats.totalArea} ha</span>
            </div>
          </div>

          {/* Tabla */}
          <table className="sh-preview-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Lote</th>
                <th>Bloque</th>
                <th>Plantas</th>
                <th>Densidad</th>
                <th>Área (ha)</th>
                <th>Material</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map(r => (
                <tr key={r.id} className={r.cerrado ? 'sh-preview-row-cerrado' : ''}>
                  <td>{formatFecha(r.fecha)}</td>
                  <td>{r.loteNombre}</td>
                  <td>{r.bloque || '—'}</td>
                  <td className="sh-preview-td-num">{r.plantas?.toLocaleString()}</td>
                  <td className="sh-preview-td-num">{r.densidad?.toLocaleString()}</td>
                  <td className="sh-preview-td-num sh-preview-td-green">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>
                  <td>{r.materialNombre || '—'}</td>
                  <td>{r.responsableNombre || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="sh-preview-footer">
            Generado por Aurora · {fechaEmision}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ConfirmModal({ config, onCancel }) {
  return createPortal(
    <div className="param-modal-backdrop">
      <div className="param-modal">
        <div className="param-modal-header">
          <FiAlertTriangle size={18} className="param-modal-icon-warn" />
          <span>{config.title}</span>
        </div>
        <p className="param-modal-body">{config.body}</p>
        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={config.onConfirm}>
            {config.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Modal editar registro de siembra ─────────────────────────────────────────
function EditSiembraModal({ record, lotes, materiales, onSave, onCancel, saving }) {
  const [fecha, setFecha]           = useState(record.fecha ? record.fecha.slice(0, 10) : '');
  const [loteId, setLoteId]         = useState(record.loteId || '');
  const [bloque, setBloque]         = useState(record.bloque || '');
  const [plantas, setPlantas]       = useState(String(record.plantas || ''));
  const [densidad, setDensidad]     = useState(String(record.densidad || '65000'));
  const [materialId, setMaterialId] = useState(record.materialId || '');

  const area = plantas && densidad && Number(densidad) > 0
    ? (Number(plantas) / Number(densidad)).toFixed(4) : '';

  const handleSave = () => {
    const lote = lotes.find(l => l.id === loteId);
    const mat  = materiales.find(m => m.id === materialId);
    onSave({
      fecha,
      loteId,
      loteNombre:     lote?.nombreLote   || record.loteNombre || '',
      bloque,
      plantas:        Number(plantas)    || 0,
      densidad:       Number(densidad)   || 65000,
      areaCalculada:  area ? parseFloat(area) : null,
      materialId:     mat?.id            || '',
      materialNombre: mat?.nombre        || '',
      rangoPesos:     mat?.rangoPesos    || '',
      variedad:       mat?.variedad      || '',
    });
  };

  return createPortal(
    <div className="param-modal-backdrop" onPointerDown={onCancel}>
      <div className="param-modal" style={{ maxWidth: 480 }} onPointerDown={e => e.stopPropagation()}>
        <div className="param-modal-header">
          <FiEdit2 size={16} style={{ flexShrink: 0 }} />
          <span>Editar registro de siembra</span>
        </div>
        <div className="edit-siembra-grid">
          <label className="mat-modal-label">
            Fecha
            <input className="mat-modal-input" type="date" value={fecha}
              onChange={e => setFecha(e.target.value)} disabled={saving} />
          </label>
          <label className="mat-modal-label">
            Lote
            <select className="mat-modal-input" value={loteId}
              onChange={e => setLoteId(e.target.value)} disabled={saving}>
              <option value="">— seleccionar —</option>
              {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
            </select>
          </label>
          <label className="mat-modal-label">
            Bloque
            <input className="mat-modal-input" placeholder="Ej: A" value={bloque}
              onChange={e => setBloque(e.target.value)} disabled={saving} />
          </label>
          <label className="mat-modal-label">
            Plantas
            <input className="mat-modal-input" type="number" min="0" value={plantas}
              onChange={e => setPlantas(e.target.value)} disabled={saving} />
          </label>
          <label className="mat-modal-label">
            Densidad <span style={{ opacity: 0.55, fontSize: '0.78rem' }}>(pl/ha)</span>
            <input className="mat-modal-input" type="number" min="1" value={densidad}
              onChange={e => setDensidad(e.target.value)} disabled={saving} />
          </label>
          <label className="mat-modal-label">
            Área calculada
            <input className="mat-modal-input" value={area ? area + ' ha' : '—'} readOnly disabled
              style={{ opacity: 0.55 }} />
          </label>
          <label className="mat-modal-label" style={{ gridColumn: '1 / -1' }}>
            Material
            <select className="mat-modal-input" value={materialId}
              onChange={e => setMaterialId(e.target.value)} disabled={saving}>
              <option value="">— sin material —</option>
              {materiales.map(m => (
                <option key={m.id} value={m.id}>
                  {m.nombre}{m.variedad ? ` · ${m.variedad}` : ''}{m.rangoPesos ? ` (${m.rangoPesos})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" disabled={!fecha || !loteId || saving} onClick={handleSave}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SiembraHistorial() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters,   setFilters]   = useState(EMPTY_FILTERS);
  const [confirmModal, setConfirmModal] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [fincaConfig, setFincaConfig] = useState({ nombreEmpresa: 'Finca Aurora', identificacion: '', direccion: '', whatsapp: '', logoUrl: '' });
  const [sortConfig, setSortConfig] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc'  },
  ]);

  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [editRecord, setEditRecord] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const [rowMenu, setRowMenu] = useState(null);
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);

  const [expandedRows, setExpandedRows] = useState(new Set());
  const toggleExpanded = (id) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const swipeState = useRef({});
  const SWIPE_THRESHOLD = 80;
  const getHistSwipeHandlers = (r) => ({
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      swipeState.current['h-' + r.id] = {
        startX: e.clientX, startY: e.clientY, el: e.currentTarget, dx: 0, locked: false, cancelled: false,
        hintLeft:  e.currentTarget.querySelector('.swipe-hint-left'),
        hintRight: null,
      };
    },
    onPointerMove(e) {
      const s = swipeState.current['h-' + r.id];
      if (!s || s.cancelled) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (!s.locked && Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 8) { s.cancelled = true; return; }
      if (!s.locked && Math.abs(dx) > 8) s.locked = true;
      if (!s.locked) return;
      s.dx = dx;
      s.el.style.transform = `translateX(${dx}px)`;
      s.el.style.transition = 'none';
      s.el.style.userSelect = 'none';
      const ratio = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx < 0) {
        s.el.style.background = `rgba(220, 60, 60, ${ratio * 0.3})`;
      } else {
        s.el.style.background = `rgba(51, 255, 153, ${ratio * 0.18})`;
      }
    },
    onPointerUp(e) {
      const s = swipeState.current['h-' + r.id];
      if (!s) return;
      delete swipeState.current['h-' + r.id];
      s.el.style.transition = 'transform 0.22s ease, background 0.22s ease';
      s.el.style.transform = 'translateX(0)';
      s.el.style.background = '';
      s.el.style.userSelect = '';
      if (s.cancelled || !s.locked) return;
      if (s.dx < -SWIPE_THRESHOLD) handleDelete(r.id);
      else if (s.dx > SWIPE_THRESHOLD) toggleExpanded(r.id);
    },
    onPointerCancel(e) {
      const s = swipeState.current['h-' + r.id];
      if (!s) return;
      delete swipeState.current['h-' + r.id];
      s.el.style.transition = 'transform 0.22s ease, background 0.22s ease';
      s.el.style.transform = 'translateX(0)';
      s.el.style.background = '';
      s.el.style.userSelect = '';
    },
  });

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const updateSort   = (idx, key, value) =>
    setSortConfig(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([k, v]) => k === 'cerrado' ? v !== 'todos' : v !== '').length,
  [filters]);

  useEffect(() => {
    if (!showPreview) return;
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => setFincaConfig({
        nombreEmpresa:  data.nombreEmpresa  || 'Finca Aurora',
        identificacion: data.identificacion || '',
        direccion:      data.direccion      || '',
        whatsapp:       data.whatsapp       || '',
        logoUrl:        data.logoUrl        || '',
      }))
      .catch(() => {});
  }, [showPreview]);

  useEffect(() => {
    apiFetch('/api/siembras')
      .then(r => r.json())
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar registros.', 'error'))
      .finally(() => setLoading(false));
    apiFetch('/api/lotes').then(r => r.json()).then(d => setLotes(Array.isArray(d) ? d : [])).catch(() => {});
    apiFetch('/api/materiales-siembra').then(r => r.json()).then(d => setMateriales(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const displayData = useMemo(
    () => applySort(applyFilters(registros, filters), sortConfig),
    [registros, filters, sortConfig],
  );

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalPlantas = displayData.reduce((s, r) => s + (r.plantas || 0), 0);
    const totalArea    = displayData.reduce((s, r) => s + (r.areaCalculada || 0), 0);
    const cerrados     = displayData.filter(r => r.cerrado).length;
    return { totalPlantas, totalArea: totalArea.toFixed(4), cerrados };
  }, [displayData]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const toggleCerrado = (reg) => {
    const esSupervisor = hasMinRole(currentUser?.rol, 'supervisor');
    if (reg.cerrado && !esSupervisor) {
      showToast('Solo un supervisor puede reabrir un bloque cerrado.', 'error');
      return;
    }
    const doToggle = async (nuevoCerrado) => {
      setConfirmModal(null);
      try {
        await apiFetch(`/api/siembras/${reg.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cerrado: nuevoCerrado }),
        });
        const ahora = nuevoCerrado ? new Date().toISOString() : null;
        setRegistros(prev => prev.map(r =>
          (r.loteId === reg.loteId && r.bloque === reg.bloque) ? { ...r, cerrado: nuevoCerrado, fechaCierre: ahora } : r
        ));
      } catch {
        showToast('Error al actualizar.', 'error');
      }
    };
    if (reg.cerrado) {
      setConfirmModal({
        title: `¿Reabrir el bloque "${reg.bloque || '(sin bloque)'}"?`,
        body: `Lote: "${reg.loteNombre}". Se podrán volver a agregar registros de siembra en este bloque.`,
        confirmLabel: 'Reabrir bloque',
        onConfirm: () => doToggle(false),
      });
    } else {
      setConfirmModal({
        title: `¿Cerrar el bloque "${reg.bloque || '(sin bloque)'}"?`,
        body: `Lote: "${reg.loteNombre}". Esto indica que la siembra del bloque está completa. Solo un supervisor puede revertir esta acción.`,
        confirmLabel: 'Cerrar bloque',
        onConfirm: () => doToggle(true),
      });
    }
  };

  const handleDelete = (id) => {
    setConfirmModal({
      title: '¿Eliminar este registro?',
      body: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await apiFetch(`/api/siembras/${id}`, { method: 'DELETE' });
          setRegistros(prev => prev.filter(r => r.id !== id));
          showToast('Registro eliminado.');
        } catch {
          showToast('Error al eliminar.', 'error');
        }
      },
    });
  };

  const handleEditSave = async (data) => {
    setEditSaving(true);
    try {
      await apiFetch(`/api/siembras/${editRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setRegistros(prev => prev.map(r => r.id === editRecord.id ? { ...r, ...data } : r));
      setEditRecord(null);
      showToast('Registro actualizado.');
    } catch {
      showToast('Error al actualizar.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Export CSV ───────────────────────────────────────────────────────────
  const exportXLSX = () => {
    const headers = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'F. Cierre', 'Responsable'];
    const rows = displayData.map(r => [
      r.fecha, r.loteNombre || '', r.bloque || '',
      r.plantas, r.densidad,
      r.areaCalculada || '',
      r.materialNombre || '', r.variedad || '',
      r.cerrado ? 'Sí' : 'No',
      r.fechaCierre ? formatFecha(r.fechaCierre) : '',
      r.responsableNombre || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Ajustar ancho de columnas automáticamente
    ws['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siembras');
    XLSX.writeFile(wb, `siembras_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCSV = () => {
    const headers = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'F. Cierre', 'Responsable'];
    const rows = displayData.map(r => [
      r.fecha, r.loteNombre || '', r.bloque || '',
      r.plantas, r.densidad,
      r.areaCalculada || '',
      r.materialNombre || '', r.variedad || '',
      r.cerrado ? 'Sí' : 'No',
      r.fechaCierre ? formatFecha(r.fechaCierre) : '',
      r.responsableNombre || '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `siembras_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="sh-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <ConfirmModal config={confirmModal} onCancel={() => setConfirmModal(null)} />}
      {editRecord && (
        <EditSiembraModal
          record={editRecord}
          lotes={lotes}
          materiales={materiales}
          onSave={handleEditSave}
          onCancel={() => setEditRecord(null)}
          saving={editSaving}
        />
      )}
      {showPreview && (
        <SiembraHistorialPreview
          fincaConfig={fincaConfig}
          displayData={displayData}
          stats={stats}
          onClose={() => setShowPreview(false)}
        />
      )}

      {loading ? (
        <div className="siembra-page-loading" />
      ) : registros.length === 0 ? (
        <div className="siembra-empty-state">
          <FiPackage size={36} />
          <p>No hay registros aún. Crea el primero en Registro de Siembra.</p>
          <Link to="/siembra" state={{ openForm: true }} className="btn btn-primary">Ir a Registro de Siembra</Link>
        </div>
      ) : (
        <>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="sh-toolbar">
        <Link to="/siembra" className="sh-back-link">
          <FiChevronLeft size={15} /> Registro de Siembra
        </Link>

        <div className="sh-toolbar-actions">
          <button
            className={`btn btn-secondary sh-filter-btn${activeFilterCount ? ' sh-filter-active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
          >
            <FiFilter size={14} />
            Filtros
            {activeFilterCount > 0 && <span className="sh-filter-badge">{activeFilterCount}</span>}
          </button>
          <button className="btn btn-secondary sh-export-btn" onClick={exportXLSX} title="Exportar a Excel">
            <FiDownload size={14} /> Exportar Excel
          </button>
          <button className="btn btn-secondary sh-export-btn" onClick={exportCSV} title="Exportar a CSV">
            <FiDownload size={14} /> Exportar CSV
          </button>
          <button className="btn btn-secondary print-hide" onClick={() => setShowPreview(true)} title="Compartir o imprimir">
            <FiShare2 size={14} /> Compartir
          </button>
        </div>
      </div>

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="sh-filter-panel">
          <div className="sh-filter-grid">
            <div className="form-control">
              <label>Fecha desde</label>
              <input type="date" value={filters.fechaDesde} onChange={e => updateFilter('fechaDesde', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Fecha hasta</label>
              <input type="date" value={filters.fechaHasta} onChange={e => updateFilter('fechaHasta', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Lote</label>
              <input placeholder="Ej: L2610" value={filters.lote} onChange={e => updateFilter('lote', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Bloque</label>
              <input placeholder="Ej: 2A" value={filters.bloque} onChange={e => updateFilter('bloque', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Material</label>
              <input placeholder="Ej: CP" value={filters.material} onChange={e => updateFilter('material', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Variedad</label>
              <input placeholder="Ej: MD2" value={filters.variedad} onChange={e => updateFilter('variedad', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Estado</label>
              <select value={filters.cerrado} onChange={e => updateFilter('cerrado', e.target.value)}>
                <option value="todos">Todos</option>
                <option value="abierto">Abiertos</option>
                <option value="cerrado">Cerrados</option>
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button className="sh-clear-filters" onClick={clearFilters}>
              <FiX size={13} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="sh-stats-bar">
        <div className="sh-stat sh-stat-hide-mobile">
          <span className="sh-stat-value">{displayData.length}</span>
          <span className="sh-stat-label">Registros</span>
        </div>
        <div className="sh-stat-divider sh-stat-hide-mobile" />
        <div className="sh-stat">
          <span className="sh-stat-value">{stats.totalPlantas.toLocaleString()}</span>
          <span className="sh-stat-label">Plantas totales</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{stats.totalArea} ha</span>
          <span className="sh-stat-label">Área calculada</span>
        </div>
        <div className="sh-stat-divider sh-stat-hide-mobile" />
        <div className="sh-stat sh-stat-hide-mobile">
          <span className="sh-stat-value sh-stat-green">{stats.cerrados}</span>
          <span className="sh-stat-label">Bloques cerrados</span>
        </div>
      </div>

      {/* ── Sort controls ──────────────────────────────────────────────────── */}
      <div className="siembra-historial sh-table-card">
        <div className="historial-top-row">
          <span className="sh-result-count print-hide">
            {displayData.length === registros.length
              ? `${registros.length} registros`
              : `${displayData.length} de ${registros.length} registros`}
          </span>
          <div className="historial-sort-row print-hide">
            {sortConfig.map((s, idx) => (
              <div key={idx} className="sort-group">
                <span className="sort-label">{idx === 0 ? 'Ordenar por' : 'Luego por'}</span>
                <select
                  className="sort-select"
                  value={s.field}
                  onChange={e => updateSort(idx, 'field', e.target.value)}
                >
                  <option value="">—</option>
                  {SORT_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <button
                  className={`sort-dir-btn${!s.field ? ' sort-dir-disabled' : ''}`}
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

        {displayData.length === 0 ? (
          <p className="empty-state">No hay registros con los filtros aplicados.</p>
        ) : (
          <div className="siembra-table-wrapper">
            <table className="siembra-table siembra-table-historial">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Lote</th>
                  <th>Bloque</th>
                  <th>Plantas</th>
                  <th>Densidad</th>
                  <th>Área</th>
                  <th>Material</th>
                  <th>Variedad</th>
                  <th>Responsable</th>
                  <th className="td-readonly">F. Cierre</th>
                  <th className="print-hide"></th>
                </tr>
              </thead>
              <tbody>
                {displayData.map(r => {
                  const isExpanded = expandedRows.has(r.id);
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className={r.cerrado ? 'row-cerrado' : ''}
                        {...getHistSwipeHandlers(r)}
                      >
                        <td className="swipe-hint swipe-hint-left" aria-hidden="true"><FiTrash2 size={18} /></td>
                        <td className="td-readonly" data-col="fecha">{formatFecha(r.fecha)}</td>
                        <td data-col="lote">{r.loteNombre}</td>
                        <td data-col="bloque">{r.bloque || '—'}</td>
                        <td className="td-num" data-col="plantas">{r.plantas?.toLocaleString()}</td>
                        <td className="td-num" data-col="densidad">{r.densidad?.toLocaleString()}</td>
                        <td className="td-calc" data-col="area">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>
                        <td data-col="mat">{r.materialNombre || '—'}</td>
                        <td data-col="variedad">{r.variedad || '—'}</td>
                        <td className="td-readonly" data-col="responsable">{r.responsableNombre || '—'}</td>
                        <td className="td-readonly" data-col="fcierre">{r.fechaCierre ? formatFecha(r.fechaCierre) : '—'}</td>
                        <td className="print-hide" data-col="menu">
                          <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                            <button className="hist-kebab-btn" onClick={() => setRowMenu(rowMenu === r.id ? null : r.id)}>
                              <FiMoreVertical size={16} />
                            </button>
                            {rowMenu === r.id && (
                              <div className="hist-kebab-dropdown">
                                <button className="hist-kebab-item" onClick={() => { setRowMenu(null); setEditRecord(r); }}>
                                  <FiEdit2 size={13} />
                                  Editar
                                </button>
                                <button className="hist-kebab-item" onClick={() => { setRowMenu(null); toggleCerrado(r); }}>
                                  {r.cerrado ? <FiCircle size={13} /> : <FiCheckCircle size={13} />}
                                  {r.cerrado ? 'Abrir bloque' : 'Cerrar bloque'}
                                </button>
                                <button className="hist-kebab-item hist-kebab-item-danger" onClick={() => { setRowMenu(null); handleDelete(r.id); }}>
                                  <FiTrash2 size={13} />
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="hist-expanded-row">
                          <td colSpan="11" className="hist-expanded-cell">
                            <div className="hist-expanded-card">
                              <div className="hist-expanded-header">
                                <span className="hist-expand-lote">{r.loteNombre}</span>
                                <button className="hist-expand-close" onClick={() => toggleExpanded(r.id)}>
                                  <FiX size={15} />
                                </button>
                              </div>
                              {[
                                { label: 'Fecha',        value: formatFecha(r.fecha) },
                                { label: 'Bloque',       value: r.bloque || '—' },
                                { label: 'Plantas',      value: r.plantas?.toLocaleString() },
                                { label: 'Densidad',     value: r.densidad?.toLocaleString() },
                                { label: 'Área',         value: r.areaCalculada ? r.areaCalculada + ' ha' : '—' },
                                { label: 'Material',     value: r.materialNombre || '—' },
                                { label: 'Variedad',     value: r.variedad || '—' },
                                { label: 'Responsable',  value: r.responsableNombre || '—' },
                                { label: 'F. Cierre',    value: r.fechaCierre ? formatFecha(r.fechaCierre) : '—' },
                              ].map(({ label, value }) => (
                                <div key={label} className="hist-expanded-field">
                                  <span className="hist-expanded-label">{label}</span>
                                  <span className="hist-expanded-value">{value}</span>
                                </div>
                              ))}
                              <div className="hist-expanded-actions">
                                <button
                                  className={`siembra-cerrado-btn${r.cerrado ? ' is-cerrado' : ''}`}
                                  onClick={() => toggleCerrado(r)}
                                >
                                  {r.cerrado ? <FiCircle size={15} /> : <FiCheckCircle size={15} />}
                                  {r.cerrado ? 'Abrir bloque' : 'Cerrar bloque'}
                                </button>
                                <button className="btn-icon" onClick={() => setEditRecord(r)}>
                                  <FiEdit2 size={14} />
                                </button>
                                <button className="btn-icon btn-danger" onClick={() => handleDelete(r.id)}>
                                  <FiTrash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {displayData.some(r => r.cerrado) && (
          <p className="siembra-cerrado-hint print-hide">
            <FiAlertCircle size={13} />
            Los bloques cerrados están listos para iniciar aplicaciones.
          </p>
        )}
      </div>
        </>
      )}
    </div>
  );
}

export default SiembraHistorial;
