import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ── Modal nuevo valor de catálogo (cosecha / etapa) ──────────────────────────
function NuevoCatalogModal({ field, onConfirm, onCancel }) {
  const [nombre, setNombre] = useState('');
  const label = field === 'cosecha' ? 'cosecha' : 'etapa';
  const placeholder = field === 'cosecha' ? 'Ej. Cosecha I 2024' : 'Ej. Desarrollo';
  return createPortal(
    <div className="grupo-catalog-backdrop">
      <div className="grupo-catalog-modal">
        <div className="grupo-catalog-header">
          <FiPlus size={16} />
          <span>Nueva {label}</span>
        </div>
        <label className="grupo-catalog-label">
          Nombre <span className="grupo-catalog-required">*</span>
          <input
            className="grupo-catalog-input"
            placeholder={placeholder}
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && nombre.trim()) onConfirm(nombre.trim()); }}
          />
        </label>
        <div className="grupo-catalog-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={!nombre.trim()}
            onClick={() => onConfirm(nombre.trim())}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function GrupoManagement() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [grupos,       setGrupos]       = useState([]);
  const [siembras,     setSiembras]     = useState([]);
  const [packages,     setPackages]     = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [showForm,     setShowForm]     = useState(false);
  const [showLibres,   setShowLibres]   = useState(false);
  const [isEditing,    setIsEditing]    = useState(false);
  const [catalogModal, setCatalogModal] = useState(null); // null | { field: 'cosecha'|'etapa' }
  const [localCosechas, setLocalCosechas] = useState([]);
  const [localEtapas,   setLocalEtapas]   = useState([]);
  const [toast,        setToast]        = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting,     setDeleting]     = useState(false);
  const [deleteModal,  setDeleteModal]  = useState(null); // { type: 'aplicada'|'en_transito', grupoId, grupoName, cedulasAplicadas, cedulasEnTransito }
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

  // Consolidate available siembras by loteId+bloque so each block appears once
  const consolidatedBloques = useMemo(() => {
    const map = new Map();
    for (const s of availableSiembras) {
      const key = `${s.loteId}__${s.bloque}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          ids: [],
          loteId: s.loteId,
          loteNombre: s.loteNombre || s.loteId,
          bloque: s.bloque,
          plantas: 0,
          areaCalculada: 0,
          variedad: s.variedad || '',
          materialNombre: s.materialNombre || '',
        });
      }
      const entry = map.get(key);
      entry.ids.push(s.id);
      entry.plantas += (s.plantas || 0);
      entry.areaCalculada += (parseFloat(s.areaCalculada) || 0);
    }
    return [...map.values()];
  }, [availableSiembras]);

  const byLoteSeleccionados = useMemo(() => {
    const sel = consolidatedBloques.filter(b => b.ids.some(id => formData.bloques.includes(id)));
    return sel.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [consolidatedBloques, formData.bloques]);

  const byLoteLibres = useMemo(() => {
    const lib = consolidatedBloques.filter(b => !b.ids.some(id => formData.bloques.includes(id)));
    return lib.reduce((acc, s) => { if (!acc[s.loteNombre]) acc[s.loteNombre] = []; acc[s.loteNombre].push(s); return acc; }, {});
  }, [consolidatedBloques, formData.bloques]);

  const selectedBlockCount = useMemo(() => {
    const keys = new Set();
    for (const id of formData.bloques) {
      const s = siembras.find(s => s.id === id);
      if (s) keys.add(`${s.loteId}__${s.bloque}`);
    }
    return keys.size;
  }, [formData.bloques, siembras]);

  // ── Paquetes filtrados ────────────────────────────────────────────────────
  const cosechasCatalog = useMemo(() =>
    [...new Set([
      ...grupos.map(g => g.cosecha).filter(Boolean),
      ...packages.map(p => p.tipoCosecha).filter(Boolean),
      ...localCosechas,
    ])].sort(),
  [grupos, packages, localCosechas]);

  const etapasCatalog = useMemo(() =>
    [...new Set([
      ...grupos.map(g => g.etapa).filter(Boolean),
      ...packages.map(p => p.etapaCultivo).filter(Boolean),
      ...localEtapas,
    ])].sort(),
  [grupos, packages, localEtapas]);

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
      if (name === 'cosecha' || name === 'etapa') next.paqueteId = '';
      return next;
    });
  };

  const toggleBloque = (ids) =>
    setFormData(prev => {
      const allSelected = ids.every(id => prev.bloques.includes(id));
      if (allSelected) {
        return { ...prev, bloques: prev.bloques.filter(id => !ids.includes(id)) };
      }
      const newIds = ids.filter(id => !prev.bloques.includes(id));
      return { ...prev, bloques: [...prev.bloques, ...newIds] };
    });

  const resetForm = () => {
    setIsEditing(false);
    setShowForm(false);
    setShowLibres(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '' });
  };

  const handleNewGrupo = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '' });
    setShowForm(true);
  };

  const handleCatalogConfirm = (nombre) => {
    const { field } = catalogModal;
    if (field === 'cosecha') {
      setLocalCosechas(prev => [...new Set([...prev, nombre])]);
      setFormData(prev => ({ ...prev, cosecha: nombre, paqueteId: '' }));
    } else {
      setLocalEtapas(prev => [...new Set([...prev, nombre])]);
      setFormData(prev => ({ ...prev, etapa: nombre, paqueteId: '' }));
    }
    setCatalogModal(null);
  };

  const formatDateForInput = (ts) => {
    const date = tsToDate(ts);
    if (!date) return '';
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const handleEdit = (grupo) => {
    setIsEditing(true);
    setShowForm(true);
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

  const handleDeleteClick = async (grupo) => {
    try {
      const res = await apiFetch(`/api/grupos/${grupo.id}/delete-check`);
      const data = await res.json();
      if (data.cedulasAplicadas.length > 0) {
        setDeleteModal({ type: 'aplicada', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: data.cedulasAplicadas, cedulasEnTransito: [] });
      } else if (data.cedulasEnTransito.length > 0) {
        setDeleteModal({ type: 'en_transito', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: [], cedulasEnTransito: data.cedulasEnTransito });
      } else {
        setConfirmModal({ grupoId: grupo.id, grupoName: grupo.nombreGrupo });
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
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

  const handleAnularYEliminar = async () => {
    setDeleting(true);
    try {
      for (const cedula of deleteModal.cedulasEnTransito) {
        const res = await apiFetch(`/api/cedulas/${cedula.id}/anular`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'Anulada por eliminación de grupo' }) });
        if (!res.ok) throw new Error(`No se pudo anular la cédula ${cedula.consecutivo}`);
      }
      const res = await apiFetch(`/api/grupos/${deleteModal.grupoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setDeleteModal(null);
      fetchAll();
      showToast('Cédulas anuladas y grupo eliminado correctamente');
    } catch (err) {
      showToast(err.message || 'Error al eliminar el grupo.', 'error');
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
    <div className="grupo-page-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {catalogModal && (
        <NuevoCatalogModal
          field={catalogModal.field}
          onConfirm={handleCatalogConfirm}
          onCancel={() => setCatalogModal(null)}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          title={`¿Eliminar "${confirmModal.grupoName}"?`}
          message="Al eliminar este grupo, sus bloques quedarán libres y podrán asignarse a otros grupos. Ten en cuenta que los registros históricos (cédulas de aplicación y actividades completadas) que hacen referencia a este grupo seguirán mostrando su nombre. Esta acción no se puede deshacer."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {deleteModal && (
        <div className="grupo-delete-overlay" onClick={() => !deleting && setDeleteModal(null)}>
          <div className="grupo-delete-modal" onClick={e => e.stopPropagation()}>
            {deleteModal.type === 'aplicada' ? (
              <>
                <h3 className="grupo-delete-modal__title grupo-delete-modal__title--block">
                  No es posible eliminar este grupo
                </h3>
                <p>
                  El grupo <strong>"{deleteModal.grupoName}"</strong> tiene cédulas ya <strong>aplicadas en campo</strong>.
                  Estas forman parte del registro fitosanitario y no pueden eliminarse.
                </p>
                <p className="grupo-delete-modal__section-label">Cédulas aplicadas</p>
                <ul className="grupo-delete-modal__list">
                  {deleteModal.cedulasAplicadas.map(c => (
                    <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
                  ))}
                </ul>
                <div className="grupo-delete-modal__actions">
                  <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>Entendido</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="grupo-delete-modal__title grupo-delete-modal__title--warn">
                  Hay cédulas pendientes de resolución
                </h3>
                <p>
                  Las siguientes cédulas del grupo <strong>"{deleteModal.grupoName}"</strong> están en estado <strong>Mezcla lista</strong>.
                  Debes resolverlas antes de poder eliminar el grupo.
                </p>
                <p className="grupo-delete-modal__section-label">Cédulas en Mezcla lista</p>
                <ul className="grupo-delete-modal__list">
                  {deleteModal.cedulasEnTransito.map(c => (
                    <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
                  ))}
                </ul>
                <p className="grupo-delete-modal__hint">
                  Puedes anularlas ahora (se revertirá el inventario descontado) o ir a Cédulas de Aplicación para marcarlas como aplicadas en campo.
                </p>
                <div className="grupo-delete-modal__actions">
                  <button className="btn btn-danger" onClick={handleAnularYEliminar} disabled={deleting}>
                    {deleting ? 'Anulando...' : 'Anular cédulas y eliminar grupo'}
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setDeleteModal(null); navigate('/aplicaciones/cedulas'); }} disabled={deleting}>
                    Ir a Cédulas de Aplicación
                  </button>
                  <button className="btn btn-ghost" onClick={() => setDeleteModal(null)} disabled={deleting}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Encabezado de página con botón ── */}
      <div className="grupo-page-header">
        {grupos.length > 0 && !showForm && (
          <button className="btn btn-primary" onClick={handleNewGrupo}>
            <FiPlus size={15} /> Nuevo Grupo
          </button>
        )}
      </div>

      <div className="lote-management-layout">

      {/* ── FORMULARIO / CTA ── */}
      <div className={`form-card${!showForm ? ' form-card--cta' : ''}`}>
        {showForm ? (
          <>
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
              <select
                id="cosecha"
                name="cosecha"
                value={formData.cosecha}
                onChange={e => {
                  if (e.target.value === '__nueva__') {
                    setCatalogModal({ field: 'cosecha' });
                  } else {
                    handleInputChange(e);
                  }
                }}
              >
                <option value="">-- Seleccionar --</option>
                {cosechasCatalog.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__nueva__">＋ Nueva cosecha</option>
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="etapa">Etapa</label>
              <select
                id="etapa"
                name="etapa"
                value={formData.etapa}
                onChange={e => {
                  if (e.target.value === '__nueva__') {
                    setCatalogModal({ field: 'etapa' });
                  } else {
                    handleInputChange(e);
                  }
                }}
              >
                <option value="">-- Seleccionar --</option>
                {etapasCatalog.map(e => <option key={e} value={e}>{e}</option>)}
                <option value="__nueva__">＋ Nueva etapa</option>
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

          {/* ── Sección 1: Bloques del grupo ── */}
          <div className="bloques-section">
            <div className="bloques-header">
              <span className="bloques-title">Bloques del grupo</span>
              <span className="bloques-count">{selectedBlockCount} bloque(s) asignado(s)</span>
            </div>

            {Object.entries(byLoteSeleccionados).map(([loteNombre, registros]) => (
              <div key={loteNombre} className="bloque-lote-group">
                <div className="bloque-lote-label">{loteNombre}</div>
                {registros.map(s => (
                  <div key={s.key} className="bloque-checkbox-row checked">
                    <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                    <span className="bloque-meta">
                      {s.plantas?.toLocaleString()} plantas
                      {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
                      {s.variedad ? ` · ${s.variedad}` : ''}
                    </span>
                    <button type="button" className="bloque-btn-quitar" onClick={() => toggleBloque(s.ids)}>
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {/* Estado vacío: botón "Agregar bloques" DENTRO cuando no hay bloques */}
            {selectedBlockCount === 0 && (
              <div className="bloques-empty-wrap">
                <p className="bloques-empty">
                  {consolidatedBloques.length === 0
                    ? cerradoSiembras.length === 0
                      ? 'No hay bloques cerrados. Ciérralos desde el Historial de Siembra.'
                      : 'Todos los bloques cerrados ya están asignados a otros grupos.'
                    : 'Sin bloques asignados aún.'}
                </p>
                {Object.keys(byLoteLibres).length > 0 && (
                  <button
                    type="button"
                    className={`btn bloques-agregar-btn${showLibres ? ' bloques-agregar-btn--open' : ''}`}
                    onClick={() => setShowLibres(v => !v)}
                  >
                    <FiPlus size={13} /> {showLibres ? 'Cerrar' : 'Agregar bloques'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Botón "Agregar bloques" FUERA cuando ya hay bloques */}
          {selectedBlockCount > 0 && Object.keys(byLoteLibres).length > 0 && (
            <div className="bloques-agregar-wrap">
              <button
                type="button"
                className={`btn bloques-agregar-btn${showLibres ? ' bloques-agregar-btn--open' : ''}`}
                onClick={() => setShowLibres(v => !v)}
              >
                <FiPlus size={13} /> {showLibres ? 'Cerrar' : 'Agregar bloques'}
              </button>
            </div>
          )}

          {/* ── Sección 2: Lotes y bloques sin agrupar (condicional) ── */}
          {showLibres && Object.keys(byLoteLibres).length > 0 && (
            <div className="bloques-section bloques-section--libres">
              <div className="bloques-header bloques-header--muted">
                <span className="bloques-title">Lotes y bloques sin agrupar</span>
                <span className="bloques-count">
                  {Object.values(byLoteLibres).reduce((sum, arr) => sum + arr.length, 0)} disponible(s)
                </span>
              </div>

              {Object.entries(byLoteLibres).map(([loteNombre, registros]) => (
                <div key={loteNombre} className="bloque-lote-group">
                  <div className="bloque-lote-label">{loteNombre}</div>
                  {registros.map(s => (
                    <div key={s.key} className="bloque-checkbox-row">
                      <span className="bloque-nombre">Bloque {s.bloque || '—'}</span>
                      <span className="bloque-meta">
                        {s.plantas?.toLocaleString()} plantas
                        {s.areaCalculada ? ` · ${s.areaCalculada.toFixed(4)} ha` : ''}
                        {s.variedad ? ` · ${s.variedad}` : ''}
                      </span>
                      <button type="button" className="bloque-btn-agregar" onClick={() => toggleBloque(s.ids)}>
                        Agregar
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiPlus /> {isEditing ? 'Actualizar Grupo' : 'Crear Grupo'}
            </button>
            <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
          </div>
        </form>
          </>
        ) : grupos.length === 0 ? (
          /* CTA: primer grupo */
          <div className="grupo-cta">
            <div className="grupo-cta-icon"><FiPlus size={28} /></div>
            <p className="grupo-cta-title">Aún no hay grupos creados</p>
            <p className="grupo-cta-desc">
              Organiza los bloques de siembra cerrados en grupos de producción
              para gestionar aplicaciones, cosechas y reportes.
            </p>
            <button className="btn btn-primary" onClick={handleNewGrupo}>
              <FiPlus size={15} /> Crear primer grupo
            </button>
          </div>
        ) : (
          /* CTA: grupos existentes */
          <div className="grupo-cta grupo-cta--secondary">
            <div className="grupo-cta-icon"><FiEdit size={24} /></div>
            <p className="grupo-cta-title">Selecciona un grupo para editarlo</p>
            <p className="grupo-cta-desc">
              Elige un grupo de la lista para modificar sus bloques, cosecha
              o paquete de aplicaciones.
            </p>
          </div>
        )}
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
      </div>{/* lote-management-layout */}
    </div>
  );
}

export default GrupoManagement;
