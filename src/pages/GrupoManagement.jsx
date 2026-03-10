import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import './GrupoManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiEye, FiShare2, FiPrinter, FiX } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';

// ── Helpers ───────────────────────────────────────────────────────────────────
const formatDateLong = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

const tsToDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp._seconds) return new Date(timestamp._seconds * 1000);
  return new Date(timestamp);
};

const calcFechaCosecha = (grupo, config) => {
  const etapa   = (grupo.etapa   || '').toLowerCase();
  const cosecha = (grupo.cosecha || '').toLowerCase();
  let dias;
  if (etapa.includes('postforza') || etapa.includes('post forza')) {
    dias = config.diasPostForza ?? 150;
  } else if (cosecha.includes('ii') || cosecha.includes('2')) {
    dias = config.diasIIDesarrollo ?? 215;
  } else {
    dias = config.diasIDesarrollo ?? 250;
  }
  const base = tsToDate(grupo.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + dias);
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
function GrupoManagement() {
  const apiFetch = useApiFetch();
  const [grupos,       setGrupos]       = useState([]);
  const [siembras,     setSiembras]     = useState([]);
  const [packages,     setPackages]     = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [isEditing,    setIsEditing]    = useState(false);
  const [toast,        setToast]        = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting,     setDeleting]     = useState(false);
  const [previewGrupo, setPreviewGrupo] = useState(null);
  const docRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [formData, setFormData] = useState({
    id: null, nombreGrupo: '', cosecha: '', etapa: '',
    fechaCreacion: '', bloques: [], paqueteId: '',
  });

  const fetchAll = () => {
    apiFetch('/api/grupos').then(r => r.json()).then(setGrupos).catch(console.error);
    apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])).catch(console.error);
    apiFetch('/api/packages').then(r => r.json()).then(setPackages).catch(console.error);
    apiFetch('/api/config').then(r => r.json()).then(setEmpresaConfig).catch(console.error);
  };

  useEffect(() => { fetchAll(); }, []);

  // ── Bloques eligibles ─────────────────────────────────────────────────────
  const cerradoSiembras = useMemo(() => siembras.filter(s => s.cerrado), [siembras]);

  const assignedIds = useMemo(() => {
    const editingId = isEditing ? formData.id : null;
    return new Set(
      grupos.filter(g => g.id !== editingId)
            .flatMap(g => Array.isArray(g.bloques) ? g.bloques : [])
    );
  }, [grupos, isEditing, formData.id]);

  const availableSiembras = useMemo(() =>
    cerradoSiembras.filter(s => !assignedIds.has(s.id)),
  [cerradoSiembras, assignedIds]);

  const byLote = useMemo(() =>
    availableSiembras.reduce((acc, s) => {
      const key = s.loteNombre || s.loteId;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    }, {}),
  [availableSiembras]);

  // ── Paquetes filtrados ────────────────────────────────────────────────────
  const cosechas = useMemo(() => [...new Set(packages.map(p => p.tipoCosecha).filter(Boolean))], [packages]);
  const etapas   = useMemo(() => [...new Set(
    packages.filter(p => !formData.cosecha || p.tipoCosecha === formData.cosecha)
            .map(p => p.etapaCultivo).filter(Boolean)
  )], [packages, formData.cosecha]);

  const filteredPackages = useMemo(() =>
    packages.filter(p =>
      (!formData.cosecha || p.tipoCosecha === formData.cosecha) &&
      (!formData.etapa   || p.etapaCultivo === formData.etapa)
    ),
  [packages, formData.cosecha, formData.etapa]);

  // ── Handlers form ─────────────────────────────────────────────────────────
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'cosecha') { next.etapa = ''; next.paqueteId = ''; }
      if (name === 'etapa')   { next.paqueteId = ''; }
      return next;
    });
  };

  const toggleBloque = (siembraId) =>
    setFormData(prev => ({
      ...prev,
      bloques: prev.bloques.includes(siembraId)
        ? prev.bloques.filter(id => id !== siembraId)
        : [...prev.bloques, siembraId],
    }));

  const resetForm = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '' });
  };

  const formatDateForInput = (ts) => {
    const date = tsToDate(ts);
    if (!date) return '';
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const handleEdit = (grupo) => {
    setIsEditing(true);
    setFormData({
      id:           grupo.id,
      nombreGrupo:  grupo.nombreGrupo  || '',
      cosecha:      grupo.cosecha      || '',
      etapa:        grupo.etapa        || '',
      fechaCreacion: grupo.fechaCreacion ? formatDateForInput(grupo.fechaCreacion) : '',
      bloques:      Array.isArray(grupo.bloques) ? grupo.bloques : [],
      paqueteId:    grupo.paqueteId    || '',
    });
    window.scrollTo(0, 0);
  };

  const handleDeleteClick    = (grupo) => setConfirmModal({ grupoId: grupo.id, grupoName: grupo.nombreGrupo });
  const handleDeleteConfirm  = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/grupos/${confirmModal.grupoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmModal(null);
      fetchAll();
      showToast('Grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.bloques.length === 0) { showToast('Selecciona al menos un bloque.', 'error'); return; }
    const url    = isEditing ? `/api/grupos/${formData.id}` : '/api/grupos';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
      if (!res.ok) throw new Error();
      fetchAll();
      resetForm();
      showToast(isEditing ? 'Grupo actualizado correctamente' : formData.paqueteId ? 'Grupo creado y tareas programadas' : 'Grupo creado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // ── Preview ───────────────────────────────────────────────────────────────
  const handleCompartir = async () => {
    if (!docRef.current) return;
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
      const filename = `Grupo-${previewGrupo?.nombreGrupo || 'doc'}.pdf`;
      const blob     = pdf.output('blob');
      const file     = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        showToast('PDF descargado');
      }
    } catch {
      showToast('No se pudo generar el PDF.', 'error');
    }
  };

  // Enrich bloques of preview grupo with siembra data
  const previewBloques = useMemo(() => {
    if (!previewGrupo) return [];
    return (previewGrupo.bloques || [])
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [previewGrupo, siembras]);

  const previewFechaCosecha  = previewGrupo ? calcFechaCosecha(previewGrupo, empresaConfig) : null;
  const previewFechaCreacion = previewGrupo ? tsToDate(previewGrupo.fechaCreacion) : null;

  const pvTotalHa      = previewBloques.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0);
  const pvTotalPlantas = previewBloques.reduce((s, b) => s + (b.plantas || 0), 0);
  const pvTotalKg      = pvTotalPlantas * 1.6;

  const getPackageName = (id) => packages.find(p => p.id === id)?.nombrePaquete || '—';

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && (
        <ConfirmModal
          title={`¿Eliminar "${confirmModal.grupoName}"?`}
          message="Esta acción eliminará permanentemente el grupo. No se puede deshacer."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {/* ── FORMULARIO ── */}
      <div className="form-card">
        <h2>{isEditing ? 'Editando Grupo' : 'Crear Nuevo Grupo'}</h2>
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombreGrupo">Nombre de Grupo</label>
              <input id="nombreGrupo" name="nombreGrupo" value={formData.nombreGrupo} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="fechaCreacion">Fecha de Creación</label>
              <input id="fechaCreacion" name="fechaCreacion" type="date" value={formData.fechaCreacion} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="cosecha">Cosecha</label>
              <select id="cosecha" name="cosecha" value={formData.cosecha} onChange={handleInputChange}>
                <option value="">-- Seleccionar Cosecha --</option>
                {cosechas.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="etapa">Etapa</label>
              <select id="etapa" name="etapa" value={formData.etapa} onChange={handleInputChange}>
                <option value="">-- Seleccionar Etapa --</option>
                {etapas.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="form-control" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="paqueteId">Paquete de Aplicaciones</label>
              <select id="paqueteId" name="paqueteId" value={formData.paqueteId} onChange={handleInputChange} disabled={filteredPackages.length === 0}>
                <option value="">{filteredPackages.length === 0 ? '-- Sin paquetes para esta cosecha/etapa --' : '-- Seleccionar Paquete --'}</option>
                {filteredPackages.map(p => <option key={p.id} value={p.id}>{p.nombrePaquete}</option>)}
              </select>
            </div>
          </div>

          {/* BLOQUES */}
          <div className="bloques-section">
            <div className="bloques-header">
              <span className="bloques-title">Bloques</span>
              <span className="bloques-count">{formData.bloques.length} seleccionado(s)</span>
            </div>
            {Object.keys(byLote).length === 0 ? (
              <p className="bloques-empty">
                {cerradoSiembras.length === 0
                  ? 'No hay bloques cerrados. Ciérralos desde el Historial de Siembra.'
                  : 'Todos los bloques cerrados ya están asignados a un grupo.'}
              </p>
            ) : (
              Object.entries(byLote).map(([loteNombre, registros]) => (
                <div key={loteNombre} className="bloque-lote-group">
                  <div className="bloque-lote-label">{loteNombre}</div>
                  {registros.map(s => (
                    <label key={s.id} className={`bloque-checkbox-row${formData.bloques.includes(s.id) ? ' checked' : ''}`}>
                      <input type="checkbox" checked={formData.bloques.includes(s.id)} onChange={() => toggleBloque(s.id)} />
                      <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                      <span className="bloque-meta">
                        {s.plantas?.toLocaleString()} plantas
                        {s.areaCalculada ? ` · ${s.areaCalculada} ha` : ''}
                        {s.variedad ? ` · ${s.variedad}` : ''}
                      </span>
                    </label>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiPlus /> {isEditing ? 'Actualizar Grupo' : 'Crear Grupo'}
            </button>
            {isEditing && <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>}
          </div>
        </form>
      </div>

      {/* ── LISTA ── */}
      <div className="list-card">
        <h2>Grupos Existentes</h2>
        <ul className="info-list">
          {grupos.map(grupo => (
            <li key={grupo.id}>
              <div>
                <div className="item-main-text">{grupo.nombreGrupo}</div>
                <div className="item-sub-text">
                  {[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}
                  {grupo.bloques?.length ? ` · ${grupo.bloques.length} bloque(s)` : ''}
                </div>
                {grupo.paqueteId && <div className="item-sub-text">{getPackageName(grupo.paqueteId)}</div>}
              </div>
              <div className="lote-actions">
                <button onClick={() => setPreviewGrupo(grupo)} className="icon-btn" title="Ver">
                  <FiEye size={18} />
                </button>
                <button onClick={() => handleEdit(grupo)} className="icon-btn" title="Editar">
                  <FiEdit size={18} />
                </button>
                <button onClick={() => handleDeleteClick(grupo)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {grupos.length === 0 && <p className="empty-state">No hay grupos creados.</p>}
      </div>

      {/* ── PREVIEW MODAL ── */}
      {previewGrupo && createPortal(
        <div className="gp-preview-backdrop" onClick={() => setPreviewGrupo(null)}>
          <div className="gp-preview-container" onClick={e => e.stopPropagation()}>

            {/* Toolbar */}
            <div className="gp-preview-toolbar">
              <span className="gp-preview-toolbar-title">Vista previa — {previewGrupo.nombreGrupo}</span>
              <div className="gp-preview-toolbar-actions">
                <button className="btn btn-secondary" onClick={handleCompartir}>
                  <FiShare2 size={15} /> Compartir
                </button>
                <button className="btn btn-secondary" onClick={() => window.print()}>
                  <FiPrinter size={15} /> Imprimir
                </button>
                <button className="btn btn-secondary" onClick={() => setPreviewGrupo(null)}>
                  <FiX size={15} /> Cerrar
                </button>
              </div>
            </div>

            {/* Documento */}
            <div className="gp-doc-wrap">
              <div className="gp-document" ref={docRef}>

                {/* Encabezado empresa */}
                <div className="gp-doc-header">
                  <div className="gp-doc-brand">
                    {empresaConfig.logoUrl
                      ? <img src={empresaConfig.logoUrl} alt="Logo" className="gp-doc-logo-img" />
                      : <div className="gp-doc-logo">AU</div>}
                    <div className="gp-doc-brand-info">
                      <div className="gp-doc-brand-name">{empresaConfig.nombreEmpresa || 'Finca Aurora'}</div>
                      {empresaConfig.identificacion && <div className="gp-doc-brand-sub">Cédula: {empresaConfig.identificacion}</div>}
                      {empresaConfig.whatsapp       && <div className="gp-doc-brand-sub">Tel: {empresaConfig.whatsapp}</div>}
                      {empresaConfig.correo         && <div className="gp-doc-brand-sub">{empresaConfig.correo}</div>}
                      {empresaConfig.direccion      && <div className="gp-doc-brand-sub">{empresaConfig.direccion}</div>}
                    </div>
                  </div>
                  <div className="gp-doc-date">
                    Fecha: <strong>{formatDateLong(new Date())}</strong>
                  </div>
                </div>

                <hr className="gp-doc-divider" />

                {/* Info del grupo */}
                <div className="gp-doc-grupo-info">
                  <div className="gp-doc-grupo-title">GRUPO: {previewGrupo.nombreGrupo}</div>
                  <div className="gp-doc-grupo-meta">
                    <span><strong>Fecha de creación:</strong> {formatDateLong(previewFechaCreacion)}</span>
                    <span><strong>Fecha estimada de cosecha:</strong> {previewFechaCosecha ? formatDateLong(previewFechaCosecha) : '—'}</span>
                    {(previewGrupo.cosecha || previewGrupo.etapa) && (
                      <span><strong>Cosecha / Etapa:</strong> {[previewGrupo.cosecha, previewGrupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                </div>

                {/* Tabla de bloques */}
                <table className="gp-doc-table">
                  <thead>
                    <tr>
                      <th>Lote</th>
                      <th>Bloque</th>
                      <th className="gp-col-num">Ha.</th>
                      <th className="gp-col-num">Plantas</th>
                      <th>Material</th>
                      <th className="gp-col-num">Kg Estimados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewBloques.length === 0 && (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '12px', color: '#999' }}>Sin bloques</td></tr>
                    )}
                    {previewBloques.map(b => (
                      <tr key={b.id}>
                        <td>{b.loteNombre || '—'}</td>
                        <td>{b.bloque || '—'}</td>
                        <td className="gp-col-num">{b.areaCalculada ?? '—'}</td>
                        <td className="gp-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                        <td>{b.materialNombre || b.variedad || '—'}</td>
                        <td className="gp-col-num">{b.plantas ? (b.plantas * 1.6).toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {previewBloques.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Totales</strong></td>
                        <td className="gp-col-num"><strong>{pvTotalHa.toFixed(4)}</strong></td>
                        <td className="gp-col-num"><strong>{pvTotalPlantas.toLocaleString()}</strong></td>
                        <td></td>
                        <td className="gp-col-num"><strong>{pvTotalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>
                      </tr>
                    </tfoot>
                  )}
                </table>

                <div className="gp-doc-footer">
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

export default GrupoManagement;
