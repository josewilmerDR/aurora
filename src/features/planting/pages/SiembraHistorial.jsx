import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  FiTrash2, FiCheckCircle, FiCircle, FiMoreVertical,
  FiDownload, FiPrinter, FiX, FiShare2, FiEdit2, FiPlus,
} from 'react-icons/fi';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import '../styles/siembra.css';
import '../styles/siembra-historial.css';

// ── Column value extractor (sort + filter source of truth) ─────────────────
function getColVal(r, field) {
  switch (field) {
    case 'fecha':       return r.fecha?.slice(0, 10) || '';
    case 'lote':        return (r.loteNombre || '').toLowerCase();
    case 'bloque':      return (r.bloque || '').toLowerCase();
    case 'plantas':     return r.plantas || 0;
    case 'densidad':    return r.densidad || 0;
    case 'area':        return r.areaCalculada || 0;
    case 'material':    return (r.materialNombre || '').toLowerCase();
    case 'variedad':    return (r.variedad || '').toLowerCase();
    case 'responsable': return (r.responsableNombre || '').toLowerCase();
    case 'fcierre':     return r.fechaCierre?.slice(0, 10) || '';
    default:            return '';
  }
}

const COLUMNS = [
  { key: 'fecha',       label: 'Fecha',       type: 'date'   },
  { key: 'lote',        label: 'Lote',        type: 'text'   },
  { key: 'bloque',      label: 'Bloque',      type: 'text'   },
  { key: 'plantas',     label: 'Plantas',     type: 'number', align: 'right' },
  {
    key: 'densidad',
    label: (
      <>
        Densidad{' '}
        <span style={{ opacity: 0.55, fontSize: '0.78em', textTransform: 'none', letterSpacing: 0 }}>
          pl/ha
        </span>
      </>
    ),
    type: 'number',
    align: 'right',
  },
  { key: 'area',        label: 'Área',        type: 'number', align: 'right' },
  { key: 'material',    label: 'Material',    type: 'text'   },
  { key: 'variedad',    label: 'Variedad',    type: 'text'   },
  { key: 'responsable', label: 'Responsable', type: 'text'   },
  { key: 'fcierre',     label: 'F. Cierre',   type: 'date'   },
];

const formatFecha = (iso) =>
  new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: '2-digit' });

// Defense-in-depth: only allow https logo URLs so an admin-controlled config
// can't be abused to point at an attacker-controlled origin (the URL is loaded
// every time the preview opens). Data URIs are also accepted for uploaded
// logos. Anything else falls back to the "AU" placeholder.
const sanitizeLogoUrl = (url) => {
  if (typeof url !== 'string' || !url) return '';
  if (url.startsWith('https://') || url.startsWith('data:image/')) return url;
  return '';
};

const EXPORT_HEADERS = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'F. Cierre', 'Responsable'];

function SiembraHistorialPreview({ fincaConfig, displayData, stats, onClose, onExportXLSX, onError }) {
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
    } catch {
      // PDF generation or share pipeline failed (canvas, jspdf, file API).
      // Surface to the user so they can retry or fall back to print.
      onError?.('No se pudo generar el PDF. Intenta de nuevo o usa "Imprimir / PDF".');
    }
    finally { setSharing(false); }
  };

  return createPortal(
    <div className="sh-preview-backdrop">
      {/* ── Topbar ── */}
      <div className="sh-preview-topbar no-print">
        <span className="sh-preview-title">Vista previa — Historial de Siembra</span>
        <div className="sh-preview-topbar-actions">
          <button className="sh-preview-btn-close" onClick={onClose}><FiX size={15} /> Cerrar</button>
          <button className="sh-preview-btn-excel" onClick={onExportXLSX} title="Descargar Excel">
            <FiDownload size={15} /> <span className="sh-preview-btn-label">Excel</span>
          </button>
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
                  ? <img
                      src={fincaConfig.logoUrl}
                      alt="Logo"
                      className="pr-doc-logo-img"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
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
                  {(() => {
                    const conVariedad = displayData.find(r => r.variedad);
                    return conVariedad && (
                      <tr><td>Variedad:</td><td>{conVariedad.variedad}</td></tr>
                    );
                  })()}
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

// ── Modal editar registro de siembra (sobre .aur-modal-*) ───────────────────
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
    <div className="aur-modal-backdrop" onPointerDown={onCancel}>
      <div className="aur-modal aur-modal--wide" onPointerDown={e => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiEdit2 size={14} />
          </span>
          <span className="aur-modal-title">Editar registro de siembra</span>
        </div>
        <div className="aur-modal-grid">
          <label className="aur-field">
            <span className="aur-field-label">Fecha</span>
            <input className="aur-input" type="date" value={fecha}
              onChange={e => setFecha(e.target.value)} disabled={saving} />
          </label>
          <label className="aur-field">
            <span className="aur-field-label">Lote</span>
            <select className="aur-select" value={loteId}
              onChange={e => setLoteId(e.target.value)} disabled={saving}>
              <option value="">— seleccionar —</option>
              {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
            </select>
          </label>
          <label className="aur-field">
            <span className="aur-field-label">Bloque</span>
            <input className="aur-input" placeholder="Ej: A" value={bloque}
              maxLength={4}
              onChange={e => setBloque(e.target.value)} disabled={saving} />
          </label>
          <label className="aur-field">
            <span className="aur-field-label">Plantas</span>
            <input
              className={`aur-input aur-input--num${plantasInvalid ? ' aur-input--error' : ''}`}
              type="number" min="0" max="199999" value={plantas}
              onChange={e => setPlantas(e.target.value)} disabled={saving}
            />
            {plantasInvalid && <span className="aur-field-error">Debe ser entre 0 y 199 999</span>}
          </label>
          <label className="aur-field">
            <span className="aur-field-label">Densidad <span className="aur-field-hint">pl/ha</span></span>
            <input
              className={`aur-input aur-input--num${densidadInvalid ? ' aur-input--error' : ''}`}
              type="number" min="0" max="199999" value={densidad}
              onChange={e => setDensidad(e.target.value)} disabled={saving}
            />
            {densidadInvalid && <span className="aur-field-error">Debe ser entre 0 y 199 999</span>}
          </label>
          <label className="aur-field">
            <span className="aur-field-label">Área calculada</span>
            <input className="aur-input aur-input--readonly aur-input--num" value={area ? area + ' ha' : '—'} readOnly disabled />
          </label>
          <label className="aur-field aur-field--full">
            <span className="aur-field-label">Material</span>
            <select className="aur-select" value={materialId}
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
        <div className="aur-modal-actions">
          <button type="button" className="aur-btn-text" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button
            type="button"
            className="aur-btn-pill"
            disabled={!fecha || !loteId || saving || plantasInvalid || densidadInvalid}
            onClick={handleSave}
          >
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
  const [displayData, setDisplayData] = useState([]); // filtered+sorted snapshot from AuroraDataTable
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [fincaConfig, setFincaConfig] = useState({ nombreEmpresa: 'Finca Aurora', identificacion: '', direccion: '', whatsapp: '', logoUrl: '' });

  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [editRecord, setEditRecord] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  const [rowMenu, setRowMenu]       = useState(null);
  const [rowMenuPos, setRowMenuPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    if (!showPreview) return;
    apiFetch('/api/config')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => setFincaConfig({
        nombreEmpresa:  data.nombreEmpresa  || 'Finca Aurora',
        identificacion: data.identificacion || '',
        direccion:      data.direccion      || '',
        whatsapp:       data.whatsapp       || '',
        logoUrl:        sanitizeLogoUrl(data.logoUrl),
      }))
      .catch(() => showToast('No se pudo cargar la configuración de la finca. El encabezado del reporte usará valores por defecto.', 'error'));
  }, [showPreview]);

  useEffect(() => {
    apiFetch('/api/siembras')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar registros.', 'error'))
      .finally(() => setLoading(false));
    apiFetch('/api/lotes')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => setLotes(Array.isArray(d) ? d : []))
      .catch(() => showToast('No se pudieron cargar los lotes. La edición de registros podría no funcionar correctamente.', 'error'));
    apiFetch('/api/materiales-siembra')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => setMateriales(Array.isArray(d) ? d : []))
      .catch(() => showToast('No se pudieron cargar los materiales. La edición de registros podría no funcionar correctamente.', 'error'));
  }, []);

  // ── Stats reflejan la data visible (filtros + orden de AuroraDataTable) ──
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
        const res = await apiFetch(`/api/siembras/${reg.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cerrado: nuevoCerrado }),
        });
        if (!res.ok) {
          if (res.status === 403) {
            showToast('No tienes permiso para reabrir un bloque cerrado.', 'error');
          } else {
            showToast('Error al actualizar.', 'error');
          }
          return;
        }
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
      danger: true,
      title: '¿Eliminar este registro?',
      body: 'Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await apiFetch(`/api/siembras/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            if (res.status === 403) {
              showToast('No tienes permiso para eliminar registros de siembra.', 'error');
            } else {
              showToast('Error al eliminar.', 'error');
            }
            return;
          }
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
      const res = await apiFetch(`/api/siembras/${editRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        if (res.status === 403) {
          showToast('No tienes permiso para realizar esta acción.', 'error');
        } else if (res.status === 400) {
          showToast('Los datos no son válidos. Revisa los campos.', 'error');
        } else {
          showToast('Error al actualizar.', 'error');
        }
        return;
      }
      // Trust the server-canonical record over the form input: backend may
      // normalize fields (truncate, recompute areaCalculada, set fechaCierre).
      const body = await res.json().catch(() => null);
      const canonical = body?.record;
      setRegistros(prev => prev.map(r =>
        r.id === editRecord.id ? (canonical ? { ...r, ...canonical } : { ...r, ...data }) : r
      ));
      setEditRecord(null);
      showToast('Registro actualizado.');
    } catch {
      showToast('Error al actualizar.', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────
  const exportXLSX = () => {
    const rows = displayData.map(r => [
      r.fecha, r.loteNombre || '', r.bloque || '',
      r.plantas, r.densidad,
      r.areaCalculada || '',
      r.materialNombre || '', r.variedad || '',
      r.cerrado ? 'Sí' : 'No',
      r.fechaCierre ? formatFecha(r.fechaCierre) : '',
      r.responsableNombre || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows]);
    ws['!cols'] = EXPORT_HEADERS.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siembras');
    XLSX.writeFile(wb, `siembras_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── Render row (delegated to AuroraDataTable) ────────────────────────────
  const renderRow = (r, vc) => (
    <>
      {vc.fecha       && <td className="aur-td-readonly">{formatFecha(r.fecha)}</td>}
      {vc.lote        && <td>{r.loteNombre}</td>}
      {vc.bloque      && <td>{r.bloque || '—'}</td>}
      {vc.plantas     && <td className="aur-td-num">{r.plantas?.toLocaleString()}</td>}
      {vc.densidad    && <td className="aur-td-num">{r.densidad?.toLocaleString()}</td>}
      {vc.area        && <td className="aur-td-strong">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>}
      {vc.material    && <td>{r.materialNombre || '—'}</td>}
      {vc.variedad    && <td>{r.variedad || '—'}</td>}
      {vc.responsable && <td className="aur-td-readonly">{r.responsableNombre || '—'}</td>}
      {vc.fcierre     && <td className="aur-td-readonly">{r.fechaCierre ? formatFecha(r.fechaCierre) : '—'}</td>}
    </>
  );

  const trailingCell = (r) => (
    <td data-col="menu" className="print-hide">
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
  );

  return (
    <div className="shp-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}
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
          onExportXLSX={exportXLSX}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}

      {loading ? (
        <div className="shp-loading" />
      ) : (
        <div className="aur-sheet shp-historial">

          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h2 className="aur-sheet-title">Historial de siembra</h2>
              <p className="aur-sheet-subtitle">
                Consulta, filtra, exporta y comparte los registros guardados.
              </p>
            </div>
            <div className="aur-sheet-header-actions">
              <button type="button" className="aur-chip aur-chip--ghost" onClick={() => setShowPreview(true)} title="Compartir, imprimir o exportar">
                <FiShare2 size={12} /> <span className="shp-btn-label">Compartir</span>
              </button>
              <Link to="/siembra" state={{ openForm: true }} className="aur-btn-pill aur-btn-pill--sm" title="Crear nuevo registro de siembra">
                <FiPlus size={14} /> Nuevo registro
              </Link>
            </div>
          </header>

          <section className="aur-section">
            <div className="shp-stats">
              <div className="shp-stat shp-stat--hide-mobile">
                <span className="shp-stat-value">{displayData.length}</span>
                <span className="shp-stat-label">Registros</span>
              </div>
              <div className="shp-stat">
                <span className="shp-stat-value">{stats.totalPlantas.toLocaleString()}</span>
                <span className="shp-stat-label">Plantas totales</span>
              </div>
              <div className="shp-stat">
                <span className="shp-stat-value">{stats.totalArea} ha</span>
                <span className="shp-stat-label">Área calculada</span>
              </div>
              <div className="shp-stat shp-stat--hide-mobile">
                <span className="shp-stat-value shp-stat-value--accent">{stats.cerrados}</span>
                <span className="shp-stat-label">Bloques cerrados</span>
              </div>
            </div>
          </section>

          <AuroraDataTable
            columns={COLUMNS}
            data={registros}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            renderRow={renderRow}
            trailingCell={trailingCell}
            rowClassName={r => r.cerrado ? 'row-cerrado' : ''}
            onDisplayDataChange={setDisplayData}
            emptyIcon={registros.length === 0 ? null : undefined}
            emptyText={
              registros.length === 0
                ? 'Aún no hay registros que mostrar. Crea el primero en "Nuevo Registro"'
                : 'No hay registros con los filtros aplicados.'
            }
          />

        </div>
      )}

      {/* ── Kebab dropdown portal: renders above all overflow/z-index containers ── */}
      {rowMenu !== null && (() => {
        const r = registros.find(x => x.id === rowMenu);
        if (!r) return null;
        // "Abrir bloque" requiere supervisor — defensa secundaria al gate
        // del backend (planting/siembras.js). Para "Cerrar bloque" no hay
        // restricción de rol más allá del gate de la página.
        const esSupervisor = hasMinRole(currentUser?.rol, 'supervisor');
        const showToggleCerrado = !r.cerrado || esSupervisor;
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
            {showToggleCerrado && (
              <button className="hist-kebab-item" onClick={() => { setRowMenu(null); toggleCerrado(r); }}>
                {r.cerrado ? <FiCircle size={13} /> : <FiCheckCircle size={13} />}
                {r.cerrado ? 'Abrir bloque' : 'Cerrar bloque'}
              </button>
            )}
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
