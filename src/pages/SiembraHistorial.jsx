import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  FiTrash2, FiCheckCircle, FiCircle, FiAlertCircle, FiMoreVertical,
  FiDownload, FiPrinter, FiFilter, FiChevronLeft, FiX, FiAlertTriangle, FiShare2, FiEdit2, FiPackage, FiSliders,
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

const COLUMNS = [
  { key: 'fecha',       label: 'Fecha',      type: 'date'   },
  { key: 'lote',        label: 'Lote',        type: 'text'   },
  { key: 'bloque',      label: 'Bloque',      type: 'text'   },
  { key: 'plantas',     label: 'Plantas',     type: 'number' },
  { key: 'densidad',    label: 'Densidad',    type: 'number' },
  { key: 'area',        label: 'Área',        type: 'number' },
  { key: 'material',    label: 'Material',    type: 'text'   },
  { key: 'variedad',    label: 'Variedad',    type: 'text'   },
  { key: 'responsable', label: 'Responsable', type: 'text'   },
  { key: 'fcierre',     label: 'F. Cierre',   type: 'date'   },
];

const ALL_COLS_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

const formatFecha = (iso) =>
  new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' });

function ColMenu({ x, y, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="sh-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="sh-col-menu-title">Columnas visibles</div>
      {COLUMNS.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label key={col.key} className={`sh-col-menu-item${isLast ? ' sh-col-menu-item--disabled' : ''}`}>
            <input type="checkbox" checked={checked} disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)} />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body
  );
}

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

  const plantasNum  = Number(plantas)  || 0;
  const densidadNum = Number(densidad) || 0;
  const plantasInvalid  = plantasNum < 0 || plantasNum > 199999;
  const densidadInvalid = densidadNum < 0 || densidadNum > 199999;

  const area = plantas && densidad && densidadNum > 0
    ? (plantasNum / densidadNum).toFixed(4) : '';

  const handleSave = () => {
    if (plantasInvalid || densidadInvalid) return;
    const lote = lotes.find(l => l.id === loteId);
    const mat  = materiales.find(m => m.id === materialId);
    onSave({
      fecha,
      loteId,
      loteNombre:     lote?.nombreLote   || record.loteNombre || '',
      bloque,
      plantas:        plantasNum,
      densidad:       densidadNum || 65000,
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
              maxLength={4}
              onChange={e => setBloque(e.target.value)} disabled={saving} />
          </label>
          <label className="mat-modal-label">
            Plantas
            <input className={`mat-modal-input${plantasInvalid ? ' mat-modal-input-error' : ''}`} type="number" min="0" max="199999" value={plantas}
              onChange={e => setPlantas(e.target.value)} disabled={saving} />
            {plantasInvalid && <span className="mat-modal-error">Debe ser entre 0 y 199 999</span>}
          </label>
          <label className="mat-modal-label">
            Densidad <span style={{ opacity: 0.55, fontSize: '0.78rem' }}>(pl/ha)</span>
            <input className={`mat-modal-input${densidadInvalid ? ' mat-modal-input-error' : ''}`} type="number" min="0" max="199999" value={densidad}
              onChange={e => setDensidad(e.target.value)} disabled={saving} />
            {densidadInvalid && <span className="mat-modal-error">Debe ser entre 0 y 199 999</span>}
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
          <button className="btn btn-primary" disabled={!fecha || !loteId || saving || plantasInvalid || densidadInvalid} onClick={handleSave}>
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
  const [confirmModal, setConfirmModal] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [fincaConfig, setFincaConfig] = useState({ nombreEmpresa: 'Finca Aurora', identificacion: '', direccion: '', whatsapp: '', logoUrl: '' });
  const [sortField, setSortField] = useState('fecha');
  const [sortDir, setSortDir] = useState('desc');
  const [colFilters, setColFilters] = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [visibleCols, setVisibleCols] = useState(ALL_COLS_VISIBLE);
  const [colMenu, setColMenu] = useState(null);

  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [editRecord, setEditRecord] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const [rowMenu, setRowMenu]     = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);


  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const handleThSort = (field) => {
    if (sortField !== field) { setSortField(field); setSortDir('desc'); }
    else if (sortDir === 'desc') { setSortDir('asc'); }
    else { setSortField(null); setSortDir(null); }
  };

  const getColVal = (r, key) => {
    switch(key) {
      case 'fecha':       return r.fecha?.slice(0,10) || '';
      case 'lote':        return (r.loteNombre || '').toLowerCase();
      case 'bloque':      return (r.bloque || '').toLowerCase();
      case 'plantas':     return r.plantas || 0;
      case 'densidad':    return r.densidad || 0;
      case 'area':        return r.areaCalculada || 0;
      case 'material':    return (r.materialNombre || '').toLowerCase();
      case 'variedad':    return (r.variedad || '').toLowerCase();
      case 'responsable': return (r.responsableNombre || '').toLowerCase();
      case 'fcierre':     return r.fechaCierre?.slice(0,10) || '';
      default:            return '';
    }
  };

  const openColFilter = (e, field, type) => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, type, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, type, key, val) => {
    setColFilters(prev => {
      const cur = prev[field] || (type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: updated };
    });
  };

  const toggleCol = (key) => {
    setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  };
  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

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

  const displayData = useMemo(() => {
    let data = [...registros];
    const activeColFilters = Object.entries(colFilters).filter(([, fv]) => {
      if (fv.text !== undefined) return fv.text.trim();
      return fv.from || fv.to;
    });
    if (activeColFilters.length > 0) {
      data = data.filter(r => {
        for (const [key, fv] of activeColFilters) {
          const col = COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getColVal(r, key);
          if (col.type === 'text') {
            if (fv.text && !val.includes(fv.text.toLowerCase())) return false;
          } else if (col.type === 'date') {
            if (!val) return false;
            if (fv.from && val < fv.from) return false;
            if (fv.to   && val > fv.to)   return false;
          } else if (col.type === 'number') {
            if (fv.from !== '' && val < Number(fv.from)) return false;
            if (fv.to   !== '' && val > Number(fv.to))   return false;
          }
        }
        return true;
      });
    }
    data = applySort(data, sortField && sortDir ? [{ field: sortField, dir: sortDir }] : []);
    return data;
  }, [registros, colFilters, sortField, sortDir]);

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

  // ── Export helpers ────────────────────────────────────────────────────────
  const EXPORT_HEADERS = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'F. Cierre', 'Responsable'];
  const buildExportRows = () => displayData.map(r => [
    r.fecha, r.loteNombre || '', r.bloque || '',
    r.plantas, r.densidad,
    r.areaCalculada || '',
    r.materialNombre || '', r.variedad || '',
    r.cerrado ? 'Sí' : 'No',
    r.fechaCierre ? formatFecha(r.fechaCierre) : '',
    r.responsableNombre || '',
  ]);

  const exportXLSX = () => {
    const rows = buildExportRows();
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows]);
    ws['!cols'] = EXPORT_HEADERS.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siembras');
    XLSX.writeFile(wb, `siembras_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const SortTh = ({ col, children }) => {
    const isSort   = sortField === col.key;
    const hasFilt  = !!colFilters[col.key];
    const isHidden = !visibleCols[col.key];
    if (isHidden) return null;
    return (
      <th
        className={`sh-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(col.key)}
      >
        <span className="sh-th-content">
          {children}
          <span className="sh-th-arrow">{isSort ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
          <span
            className={`sh-th-funnel${hasFilt ? ' is-active' : ''}`}
            onClick={e => openColFilter(e, col.key, col.type)}
            title="Filtrar columna"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  const exportCSV = () => {
    const rows = buildExportRows();
    const csv = [EXPORT_HEADERS, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `siembras_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

      {/* ── Table card ─────────────────────────────────────────────────────── */}
      <div className="siembra-historial sh-table-card">
        <div className="historial-top-row">
          <span className="sh-result-count print-hide">
            {displayData.length === registros.length
              ? `${registros.length} registros`
              : `${displayData.length} de ${registros.length} registros`}
          </span>
          {Object.keys(colFilters).length > 0 && (
            <button className="sh-clear-col-filters" onClick={() => setColFilters({})}>
              <FiX size={11} /> Limpiar filtros de columna
            </button>
          )}
        </div>

        {displayData.length === 0 ? (
          <p className="empty-state">No hay registros con los filtros aplicados.</p>
        ) : (
          <div className="siembra-table-wrapper">
            <table className="siembra-table siembra-table-historial">
              <thead>
                <tr>
                  {COLUMNS.map(col => visibleCols[col.key] && (
                    <SortTh key={col.key} col={col}>
                      {col.label}{col.key === 'densidad' ? <span style={{opacity:0.55, fontSize:'0.78rem'}}> pl/ha</span> : ''}
                    </SortTh>
                  ))}
                  <th className="sh-th-settings print-hide">
                    <button
                      className={`sh-col-toggle-btn${Object.values(visibleCols).some(v=>!v) ? ' sh-col-toggle-btn--active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas"
                    >
                      <FiSliders size={12} />
                      {Object.values(visibleCols).filter(v=>!v).length > 0 && (
                        <span className="sh-col-hidden-badge">{Object.values(visibleCols).filter(v=>!v).length}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayData.map(r => (
                    <tr key={r.id}
                        className={r.cerrado ? 'row-cerrado' : ''}
                      >
                        {visibleCols.fecha       && <td className="td-readonly" data-col="fecha">{formatFecha(r.fecha)}</td>}
                        {visibleCols.lote        && <td data-col="lote">{r.loteNombre}</td>}
                        {visibleCols.bloque      && <td data-col="bloque">{r.bloque || '—'}</td>}
                        {visibleCols.plantas     && <td className="td-num" data-col="plantas">{r.plantas?.toLocaleString()}</td>}
                        {visibleCols.densidad    && <td className="td-num" data-col="densidad">{r.densidad?.toLocaleString()}</td>}
                        {visibleCols.area        && <td className="td-calc" data-col="area">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>}
                        {visibleCols.material    && <td data-col="mat">{r.materialNombre || '—'}</td>}
                        {visibleCols.variedad    && <td data-col="variedad">{r.variedad || '—'}</td>}
                        {visibleCols.responsable && <td className="td-readonly" data-col="responsable">{r.responsableNombre || '—'}</td>}
                        {visibleCols.fcierre     && <td className="td-readonly" data-col="fcierre">{r.fechaCierre ? formatFecha(r.fechaCierre) : '—'}</td>}
                        <td className="print-hide" data-col="menu">
                          <div className="hist-kebab-wrap" onPointerDown={e => e.stopPropagation()}>
                            <button
                              className="hist-kebab-btn"
                              onClick={e => {
                                if (rowMenu === r.id) { setRowMenu(null); return; }
                                const rect = e.currentTarget.getBoundingClientRect();
                                setRowMenuPos({
                                  top: rect.bottom + 4,
                                  right: window.innerWidth - rect.right,
                                });
                                setRowMenu(r.id);
                              }}
                            >
                              <FiMoreVertical size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                ))}
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

      {/* ── Column visibility menu portal ─────────────────────────────────── */}
      {colMenu && (
        <ColMenu x={colMenu.x} y={colMenu.y} visibleCols={visibleCols} onToggle={toggleCol} onClose={() => setColMenu(null)} />
      )}

      {/* ── Column filter popover portal ──────────────────────────────────── */}
      {filterPopover && createPortal(
        <>
          <div className="sh-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div className="sh-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
            {filterPopover.type === 'text' ? (
              <>
                <FiFilter size={13} className="sh-filter-icon" />
                <input autoFocus className="sh-filter-input" placeholder="Filtrar…"
                  value={colFilters[filterPopover.field]?.text || ''}
                  onChange={e => setColFilter(filterPopover.field, 'text', 'text', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setFilterPopover(null); }}
                />
                {colFilters[filterPopover.field]?.text && (
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, 'text', 'text', ''); setFilterPopover(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            ) : (
              <div className="sh-filter-range">
                <span className="sh-filter-range-label">De</span>
                <input className="sh-filter-input sh-filter-input-range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.from || ''}
                  onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'from', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                <span className="sh-filter-range-label">A</span>
                <input className="sh-filter-input sh-filter-input-range"
                  type={filterPopover.type === 'date' ? 'date' : 'number'}
                  value={colFilters[filterPopover.field]?.to || ''}
                  onChange={e => setColFilter(filterPopover.field, filterPopover.type, 'to', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                />
                {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                  <button className="sh-filter-clear" onClick={() => { setColFilter(filterPopover.field, filterPopover.type, 'from', ''); setColFilter(filterPopover.field, filterPopover.type, 'to', ''); setFilterPopover(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )}

      {/* ── Kebab dropdown portal: renders above all overflow/z-index containers ── */}
      {rowMenu !== null && (() => {
        const r = registros.find(x => x.id === rowMenu);
        if (!r) return null;
        return createPortal(
          <div
            className="hist-kebab-dropdown hist-kebab-dropdown-fixed"
            style={{ top: rowMenuPos.top, right: rowMenuPos.right }}
            onPointerDown={e => e.stopPropagation()}
          >
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
          </div>,
          document.body
        );
      })()}
    </div>
  );
}

export default SiembraHistorial;
