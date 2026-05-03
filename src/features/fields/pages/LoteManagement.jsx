import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import '../styles/lote-management.css';
import { FiEdit, FiTrash2, FiPlus, FiCalendar, FiLayers, FiPackage, FiChevronRight, FiArrowLeft, FiFilter, FiSliders, FiX, FiEye, FiShare2, FiPrinter } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ── Module helpers ───────────────────────────────────────────────────────────
const formatDateLong = (date) => {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

// ── Table helpers ─────────────────────────────────────────────────────────────
function compare(a, b, field) {
  const av = a[field] ?? '';
  const bv = b[field] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}
function multiSort(records, sorts) {
  const active = sorts.filter(s => s.field);
  if (!active.length) return [...records];
  return [...records].sort((a, b) => {
    for (const s of active) {
      const r = compare(a, b, s.field);
      if (r !== 0) return s.dir === 'desc' ? -r : r;
    }
    return 0;
  });
}
const LOTE_BLOQUE_COLS = [
  { id: 'grupo',    label: 'Grupo'    },
  { id: 'bloque',   label: 'Bloque'   },
  { id: 'ha',       label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',  label: 'Plantas', filterType: 'number' },
  { id: 'material', label: 'Material' },
];

// ── Draft persistence ─────────────────────────────────────────────────────────
const DRAFT_LS = 'aurora_draft_lote-nuevo';
const DRAFT_SS = 'aurora_draftActive_lote-nuevo';
const EMPTY_FORM = { id: null, codigoLote: '', nombreLote: '', fechaCreacion: '' };

function loadLoteDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_LS)); } catch { return null; } }
function saveLoteDraft(data) {
  try {
    localStorage.setItem(DRAFT_LS, JSON.stringify(data));
    sessionStorage.setItem(DRAFT_SS, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function clearLoteDraft() {
  try {
    localStorage.removeItem(DRAFT_LS);
    sessionStorage.removeItem(DRAFT_SS);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function isLoteDraftMeaningful(d) { return d && (d.codigoLote || d.nombreLote || d.fechaCreacion); }

// ── Main Component ────────────────────────────────────────────────────────────
function LoteManagement() {
  const apiFetch = useApiFetch();
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [selectedLote, setSelectedLote] = useState(null);
  const [view, setView] = useState('hub'); // 'hub' | 'form'
  const [isEditing, setIsEditing] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [siembras, setSiembras] = useState([]);
  const [bloqueSorts,      setBloqueSorts]      = useState([{ field: 'grupo', dir: 'asc' }]);
  const [bloqueColFilters, setBloqueColFilters] = useState({});
  const [bloqueFilterPop,  setBloqueFilterPop]  = useState(null);
  const [bloqueHiddenCols, setBloqueHiddenCols] = useState(new Set());
  const [bloqueColMenu,    setBloqueColMenu]     = useState(null);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [previewLote,   setPreviewLote]   = useState(null);
  const carouselRef = useRef(null);
  const docRef      = useRef(null);

  // Centra la burbuja activa en el carousel cuando cambia el lote seleccionado
  useEffect(() => {
    if (!selectedLote || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedLote]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchLotes = useCallback(() => {
    return apiFetch('/api/lotes').then(res => res.json()).then(data => {
      setLotes(data);
      return data;
    }).catch(console.error);
  }, [apiFetch]);

  const fetchPackages = useCallback(() => {
    apiFetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error);
  }, [apiFetch]);

  useEffect(() => {
    fetchLotes();
    fetchPackages();
    apiFetch('/api/grupos').then(res => res.json()).then(setGrupos).catch(console.error);
    apiFetch('/api/siembras').then(res => res.json()).then(d => setSiembras(Array.isArray(d) ? d : [])).catch(console.error);
    apiFetch('/api/config').then(res => res.json()).then(setEmpresaConfig).catch(console.error);
  }, []);

  // Restore draft on mount (survives navigation and tab close)
  useEffect(() => {
    const draft = loadLoteDraft();
    if (!isLoteDraftMeaningful(draft)) return;
    setFormData({ ...EMPTY_FORM, codigoLote: draft.codigoLote || '', nombreLote: draft.nombreLote || '', fechaCreacion: draft.fechaCreacion || '' });
    setView('form');
    setIsEditing(false);
    try { sessionStorage.setItem(DRAFT_SS, '1'); window.dispatchEvent(new CustomEvent('aurora-draft-change')); } catch {}
  }, []);

  // Save draft on every change to the creation form
  useEffect(() => {
    if (isEditing || view !== 'form') return;
    const { codigoLote, nombreLote, fechaCreacion } = formData;
    if (codigoLote || nombreLote || fechaCreacion) {
      saveLoteDraft({ codigoLote, nombreLote, fechaCreacion });
    } else {
      clearLoteDraft();
    }
  }, [formData, isEditing, view]);

  // ── Table data ────────────────────────────────────────────────────────────
  const loteTableRows = useMemo(() => {
    if (!selectedLote || !siembras.length) return [];
    const loteSiembras = siembras.filter(s => s.loteId === selectedLote.id);
    if (!loteSiembras.length) return [];
    const bloqueData = new Map();
    for (const s of loteSiembras) {
      const key = s.bloque || 'Sin bloque';
      if (!bloqueData.has(key)) bloqueData.set(key, { plantas: 0, ha: 0, materiales: new Set() });
      const d = bloqueData.get(key);
      d.plantas += s.plantas || 0;
      d.ha      += parseFloat(s.areaCalculada) || 0;
      if (s.materialNombre) {
        const mat = s.materialNombre + (s.variedad ? ` · ${s.variedad}` : '');
        d.materiales.add(mat);
      }
    }
    const siembraIds     = new Set(loteSiembras.map(s => s.id));
    const siembraToBloque = new Map(loteSiembras.map(s => [s.id, s.bloque || 'Sin bloque']));
    const bloqueToGrupo  = new Map();
    for (const g of grupos) {
      for (const sid of (g.bloques || [])) {
        if (siembraIds.has(sid)) {
          const label = siembraToBloque.get(sid);
          if (!bloqueToGrupo.has(label)) bloqueToGrupo.set(label, g.nombreGrupo);
        }
      }
    }
    return [...bloqueData.entries()].map(([bloque, d]) => ({
      id:       bloque,
      grupo:    bloqueToGrupo.get(bloque) || 'Sin grupo',
      bloque,
      ha:       d.ha,
      plantas:  d.plantas,
      material: [...d.materiales].join(' / ') || '',
    }));
  }, [selectedLote, siembras, grupos]);

  const loteBloquesFiltered = useMemo(() => {
    const active = Object.entries(bloqueColFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    if (!active.length) return loteTableRows;
    return loteTableRows.filter(r => {
      for (const [field, filter] of active) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [loteTableRows, bloqueColFilters]);

  const loteBloqueSorted  = useMemo(() => multiSort(loteBloquesFiltered, bloqueSorts), [loteBloquesFiltered, bloqueSorts]);
  const filtTotalHa       = loteBloqueSorted.reduce((s, b) => s + (b.ha || 0), 0);
  const filtTotalPlantas  = loteBloqueSorted.reduce((s, b) => s + (b.plantas || 0), 0);

  const groupedBloques = useMemo(() => {
    const map = new Map();
    for (const row of loteBloqueSorted) {
      if (!map.has(row.grupo)) map.set(row.grupo, []);
      map.get(row.grupo).push(row);
    }
    return [...map.entries()].map(([grupo, rows]) => ({
      grupo,
      rows,
      totalHa:      rows.reduce((s, b) => s + (b.ha || 0), 0),
      totalPlantas: rows.reduce((s, b) => s + (b.plantas || 0), 0),
    }));
  }, [loteBloqueSorted]);

  // ── Preview (PDF / print) ───────────────────────────────────────────────
  const previewGrouped = useMemo(() => {
    if (!previewLote) return [];
    const map = new Map();
    for (const row of loteTableRows) {
      if (!map.has(row.grupo)) map.set(row.grupo, []);
      map.get(row.grupo).push(row);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
      .map(([grupo, rows]) => ({
        grupo,
        rows: [...rows].sort((a, b) => (a.bloque || '').localeCompare(b.bloque || '', 'es', { numeric: true })),
        totalHa:      rows.reduce((s, b) => s + (b.ha || 0), 0),
        totalPlantas: rows.reduce((s, b) => s + (b.plantas || 0), 0),
      }));
  }, [previewLote, loteTableRows]);

  const pvTotalHa      = previewGrouped.reduce((s, g) => s + g.totalHa, 0);
  const pvTotalPlantas = previewGrouped.reduce((s, g) => s + g.totalPlantas, 0);

  const handleCompartirLote = async () => {
    if (!docRef.current) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Lote-${previewLote?.codigoLote || 'doc'}.pdf`;
      const blob     = pdf.output('blob');
      const file     = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      showToast('No se pudo generar el PDF.', 'error');
    }
  };

  const setBloqueColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setBloqueColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  const handleBloqueColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setBloqueColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const formatDateForInput = (timestamp) => {
    const date = new Date(timestamp._seconds * 1000);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toISOString().split('T')[0];
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const d = timestamp._seconds ? new Date(timestamp._seconds * 1000) : new Date(timestamp);
    return d.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    if (!isEditing) clearLoteDraft();
    setIsEditing(false);
    setFormData(EMPTY_FORM);
    setView('hub');
  };

  const handleSelectLote = (lote) => {
    setSelectedLote(lote);
    setView('hub');
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNewLote = () => {
    const draft = loadLoteDraft();
    setIsEditing(false);
    setFormData(isLoteDraftMeaningful(draft)
      ? { ...EMPTY_FORM, codigoLote: draft.codigoLote || '', nombreLote: draft.nombreLote || '', fechaCreacion: draft.fechaCreacion || '' }
      : EMPTY_FORM
    );
    setView('form');
    setSelectedLote(null);
  };

  const handleEdit = (lote) => {
    setIsEditing(true);
    setFormData({
      id: lote.id,
      codigoLote: lote.codigoLote || '',
      nombreLote: lote.nombreLote || '',
      fechaCreacion: formatDateForInput(lote.fechaCreacion),
    });
    setView('form');
  };

  const handleDeleteClick = async (lote) => {
    try {
      const res = await apiFetch(`/api/lotes/${lote.id}/task-count`);
      const { count } = await res.json();
      setConfirmModal({ loteId: lote.id, loteName: lote.nombreLote || lote.codigoLote, taskCount: count });
    } catch {
      showToast('Error al verificar las tareas del lote.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/lotes/${confirmModal.loteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      if (selectedLote?.id === confirmModal.loteId) setSelectedLote(null);
      setConfirmModal(null);
      await fetchLotes();
      showToast('Lote eliminado correctamente');
    } catch {
      showToast('Error al eliminar el lote.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/lotes/${formData.id}` : '/api/lotes';
    const method = isEditing ? 'PUT' : 'POST';
    const { id, ...payload } = formData;
    try {
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEditing ? formData : payload),
      });
      if (!res.ok) throw new Error('Error al guardar el lote');
      const saved = await res.json();
      const newLotes = await fetchLotes();
      const savedId = isEditing ? formData.id : saved.id;
      if (savedId && newLotes) {
        const found = newLotes.find(l => l.id === savedId);
        if (found) setSelectedLote(found);
      }
      resetForm();
      showToast(isEditing ? 'Lote actualizado correctamente' : 'Lote creado y tareas programadas');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // ── BloqueSortTh ──────────────────────────────────────────────────────────
  const BloqueSortTh = ({ field, children, filterType = 'text' }) => {
    const active    = bloqueSorts[0].field === field;
    const dir       = active ? bloqueSorts[0].dir : null;
    const f         = bloqueColFilters[field];
    const hasFilter = f ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim()) : false;
    return (
      <th
        className={`aur-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-filter' : ''}`}
        onClick={() => setBloqueSorts(prev => {
          const next = [...prev];
          next[0] = next[0].field === field ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' };
          return next;
        })}
      >
        <span className="aur-th-content">
          {children}
          <span className="aur-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
          <span
            className={`aur-th-funnel${hasFilter ? ' is-active' : ''}`}
            title="Filtrar columna"
            onClick={e => {
              e.stopPropagation();
              if (bloqueFilterPop?.field === field) { setBloqueFilterPop(null); return; }
              const th   = e.currentTarget.closest('th') ?? e.currentTarget;
              const rect = th.getBoundingClientRect();
              setBloqueFilterPop({ field, x: rect.left, y: rect.bottom + 4, filterType });
            }}
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  // ── Hub panel ─────────────────────────────────────────────────────────────
  const pkg = selectedLote ? packages.find(p => p.id === selectedLote.paqueteId) : null;

  const renderRightPanel = () => {
    if (view === 'form') {
      return (
        <div className="aur-sheet">
          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h1 className="aur-sheet-title">{isEditing ? 'Editar Lote' : 'Crear Nuevo Lote'}</h1>
            </div>
          </header>
          <form onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="codigoLote">Código del Lote</label>
                  <input
                    id="codigoLote"
                    name="codigoLote"
                    className="aur-input"
                    value={formData.codigoLote}
                    onChange={handleInputChange}
                    placeholder="Ej: L2604"
                    maxLength={16}
                    required
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="nombreLote">
                    Nombre amigable <span className="aur-field-hint">(opcional)</span>
                  </label>
                  <input
                    id="nombreLote"
                    name="nombreLote"
                    className="aur-input"
                    value={formData.nombreLote}
                    onChange={handleInputChange}
                    placeholder="Ej: 4, Lote de Aurora"
                    maxLength={32}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="fechaCreacion">Fecha de Creación</label>
                  <input
                    id="fechaCreacion"
                    name="fechaCreacion"
                    className="aur-input"
                    value={formData.fechaCreacion}
                    onChange={handleInputChange}
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    required
                  />
                </div>
              </div>
            </section>

            <div className="aur-form-actions">
              <button type="button" onClick={resetForm} className="aur-btn-text">
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill">
                <FiPlus size={14} />
                {isEditing ? 'Actualizar Lote' : 'Crear Lote'}
              </button>
            </div>
          </form>
        </div>
      );
    }

    if (!selectedLote) {
      return null;
    }

    return (
      <div className="lote-hub">
        <button className="lote-hub-back" onClick={() => setSelectedLote(null)}>
          <FiArrowLeft size={13} /> Todos los lotes
        </button>
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedLote.codigoLote}</h2>
            {selectedLote.nombreLote && selectedLote.nombreLote !== selectedLote.codigoLote && (
              <span className="hub-lote-name">{selectedLote.nombreLote}</span>
            )}
          </div>
          <div className="hub-header-actions">
            <button onClick={() => setPreviewLote(selectedLote)} className="aur-icon-btn" title="Vista previa / PDF">
              <FiEye size={16} />
            </button>
            <button onClick={() => handleEdit(selectedLote)} className="aur-icon-btn" title="Editar lote">
              <FiEdit size={16} />
            </button>
            <button onClick={() => handleDeleteClick(selectedLote)} className="aur-icon-btn aur-icon-btn--danger" title="Eliminar lote">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          <span className="aur-badge">
            <FiCalendar size={13} />
            Siembra: {formatDate(selectedLote.fechaCreacion)}
          </span>
          {selectedLote.hectareas && (
            <span className="aur-badge aur-badge--green">
              <FiLayers size={13} />
              {selectedLote.hectareas} ha
            </span>
          )}
          {pkg && (
            <span className="aur-badge aur-badge--blue">
              <FiPackage size={13} />
              {pkg.nombrePaquete}
            </span>
          )}
          {!selectedLote.paqueteId && (
            <span className="aur-badge">Sin paquete técnico</span>
          )}
        </div>

        <div className="grupo-hub-bloques-header">
          <p className="grupo-hub-bloques-title">Bloques</p>
          {Object.values(bloqueColFilters).some(f => f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())) && (
            <button className="aur-btn-text" onClick={() => setBloqueColFilters({})}>
              <FiX size={11} /> Limpiar filtros
            </button>
          )}
        </div>
        {loteTableRows.length === 0 ? (
          <p className="empty-state">No hay registros de siembra para este lote.</p>
        ) : (
          <div className="aur-table-wrap">
            <table className="aur-table grupo-hub-table">
              <thead>
                <tr>
                  {!bloqueHiddenCols.has('grupo')    && <BloqueSortTh field="grupo">Grupo</BloqueSortTh>}
                  {!bloqueHiddenCols.has('bloque')   && <BloqueSortTh field="bloque">Bloque</BloqueSortTh>}
                  {!bloqueHiddenCols.has('ha')       && <BloqueSortTh field="ha" filterType="number">Ha.</BloqueSortTh>}
                  {!bloqueHiddenCols.has('plantas')  && <BloqueSortTh field="plantas" filterType="number">Plantas</BloqueSortTh>}
                  {!bloqueHiddenCols.has('material') && <BloqueSortTh field="material">Material</BloqueSortTh>}
                  <th className="aur-th-col-menu">
                    <button
                      className={`aur-col-menu-trigger${bloqueHiddenCols.size > 0 ? ' is-active' : ''}`}
                      onClick={handleBloqueColBtnClick}
                      title="Personalizar columnas visibles"
                    >
                      <FiSliders size={12} />
                      {bloqueHiddenCols.size > 0 && <span className="aur-col-hidden-badge">{bloqueHiddenCols.size}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedBloques.map(({ grupo, rows, totalHa, totalPlantas }) => (
                  <Fragment key={grupo}>
                    {rows.map(b => (
                      <tr key={b.id}>
                        {!bloqueHiddenCols.has('grupo')    && <td>{b.grupo}</td>}
                        {!bloqueHiddenCols.has('bloque')   && <td>{b.bloque}</td>}
                        {!bloqueHiddenCols.has('ha')       && <td className="aur-td-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>}
                        {!bloqueHiddenCols.has('plantas')  && <td className="aur-td-num">{b.plantas?.toLocaleString() ?? '—'}</td>}
                        {!bloqueHiddenCols.has('material') && <td>{b.material || '—'}</td>}
                        <td />
                      </tr>
                    ))}
                    <tr className="lote-subtotal-row">
                      {!bloqueHiddenCols.has('grupo')    && <td className="lote-subtotal-label">{grupo}</td>}
                      {!bloqueHiddenCols.has('bloque')   && <td />}
                      {!bloqueHiddenCols.has('ha')       && <td className="aur-td-num">{totalHa.toFixed(4)}</td>}
                      {!bloqueHiddenCols.has('plantas')  && <td className="aur-td-num">{totalPlantas.toLocaleString()}</td>}
                      {!bloqueHiddenCols.has('material') && <td />}
                      <td />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
              {loteBloqueSorted.length > 0 && (
                <tfoot>
                  <tr>
                    {!bloqueHiddenCols.has('grupo')    && <td><strong>Totales</strong></td>}
                    {!bloqueHiddenCols.has('bloque')   && <td />}
                    {!bloqueHiddenCols.has('ha')       && <td className="aur-td-num"><strong>{filtTotalHa.toFixed(4)}</strong></td>}
                    {!bloqueHiddenCols.has('plantas')  && <td className="aur-td-num"><strong>{filtTotalPlantas.toLocaleString()}</strong></td>}
                    {!bloqueHiddenCols.has('material') && <td />}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`lote-page${selectedLote && view === 'hub' ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar "${confirmModal.loteName}"?`}
          body={
            confirmModal.taskCount > 0
              ? `Esta acción eliminará permanentemente el lote y sus ${confirmModal.taskCount} tarea(s) programada(s). No se puede deshacer.`
              : 'Este lote no tiene tareas asociadas. Solo se eliminará el registro del lote. No se puede deshacer.'
          }
          confirmLabel="Eliminar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {/* ── Mobile sticky carousel ── */}
      {selectedLote && view === 'hub' && (
        <div className="lote-carousel" ref={carouselRef}>
          {lotes.map(lote => (
            <button
              key={lote.id}
              className={`lote-bubble${selectedLote?.id === lote.id ? ' lote-bubble--active' : ''}`}
              onClick={() => selectedLote?.id === lote.id ? setSelectedLote(null) : handleSelectLote(lote)}
            >
              <span className="lote-bubble-avatar">
                {(lote.nombreLote && lote.nombreLote !== lote.codigoLote ? lote.nombreLote : lote.codigoLote).slice(0, 4)}
              </span>
              <span className="lote-bubble-label">{lote.codigoLote}</span>
            </button>
          ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNewLote}>
            <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      {view !== 'form' && (
        <div className="lote-page-header">
          <div className="lote-page-title-block">
            <h2 className="lote-page-title">Lotes Activos</h2>
            <p className="lote-page-hint">
              Espacios físicos donde viven tus cultivos y la unidad básica para registrar actividades y costos.
            </p>
          </div>
          <button onClick={handleNewLote} className="aur-btn-pill">
            <FiPlus size={14} /> Nuevo Lote
          </button>
        </div>
      )}

      <div className="lote-management-layout">
        {/* ── Left: form or hub ── */}
        {renderRightPanel()}

        {/* ── Right: lote list ── */}
        {bloqueFilterPop && (
          bloqueFilterPop.filterType !== 'text' ? (
            <AuroraFilterPopover
              x={bloqueFilterPop.x}
              y={bloqueFilterPop.y}
              filterType="number"
              fromValue={bloqueColFilters[bloqueFilterPop.field]?.from || ''}
              toValue={bloqueColFilters[bloqueFilterPop.field]?.to || ''}
              onFromChange={(from) => setBloqueColFilter(bloqueFilterPop.field, { type: 'range', from, to: bloqueColFilters[bloqueFilterPop.field]?.to || '' })}
              onToChange={(to) => setBloqueColFilter(bloqueFilterPop.field, { type: 'range', from: bloqueColFilters[bloqueFilterPop.field]?.from || '', to })}
              onClear={() => setBloqueColFilter(bloqueFilterPop.field, null)}
              onClose={() => setBloqueFilterPop(null)}
            />
          ) : (
            <AuroraFilterPopover
              x={bloqueFilterPop.x}
              y={bloqueFilterPop.y}
              filterType="text"
              textValue={bloqueColFilters[bloqueFilterPop.field]?.value || ''}
              onTextChange={(value) => setBloqueColFilter(bloqueFilterPop.field, { type: 'text', value })}
              onClear={() => setBloqueColFilter(bloqueFilterPop.field, null)}
              onClose={() => setBloqueFilterPop(null)}
            />
          )
        )}
      {bloqueColMenu && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={() => setBloqueColMenu(null)} />
          <div className="aur-col-menu" style={{ left: bloqueColMenu.x, top: bloqueColMenu.y }}>
            <div className="aur-col-menu-title">Columnas visibles</div>
            {LOTE_BLOQUE_COLS.map(col => (
              <label key={col.id} className="aur-col-menu-item">
                <input
                  type="checkbox"
                  checked={!bloqueHiddenCols.has(col.id)}
                  onChange={() => setBloqueHiddenCols(prev => {
                    const next = new Set(prev);
                    next.has(col.id) ? next.delete(col.id) : next.add(col.id);
                    return next;
                  })}
                />
                <span>{col.label}</span>
              </label>
            ))}
            {bloqueHiddenCols.size > 0 && (
              <button className="aur-col-menu-reset" onClick={() => { setBloqueHiddenCols(new Set()); setBloqueColMenu(null); }}>
                Mostrar todas
              </button>
            )}
          </div>
        </>,
        document.body
      )}

      {view !== 'form' && <div className="lote-list-panel">

          {lotes.length === 0
          ? (
            <div className="grupo-cta">
              <div className="grupo-cta-icon"><FiPlus size={24} /></div>
              <p className="grupo-cta-title">Sin lotes creados</p>
            </div>
          )
          : (
            <ul className="lote-list">
              {lotes.map(lote => (
                <li
                  key={lote.id}
                  className={`lote-list-item ${selectedLote?.id === lote.id && view === 'hub' ? 'active' : ''}`}
                  onClick={() => selectedLote?.id === lote.id && view === 'hub' ? setSelectedLote(null) : handleSelectLote(lote)}
                >
                  <div className="lote-list-info">
                    <span className="lote-list-code">{lote.codigoLote}</span>
                    {lote.nombreLote && lote.nombreLote !== lote.codigoLote && (
                      <span className="lote-list-name">{lote.nombreLote}</span>
                    )}
                    <span className="lote-list-date">
                      {formatDate(lote.fechaCreacion)}
                    </span>
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              ))}
            </ul>
          )
        }
        </div>}
      </div>

      {/* ── Preview modal (PDF / impresión) ── */}
      {previewLote && createPortal(
        <div className="gp-preview-backdrop">
          <div className="gp-preview-toolbar">
            <button className="aur-chip gp-toolbar-icon-btn" onClick={() => setPreviewLote(null)}>
              <FiArrowLeft size={15} /> <span className="gp-toolbar-btn-text">Volver</span>
            </button>
            <span className="gp-preview-toolbar-title">Lote — {previewLote.codigoLote}</span>
            <div className="gp-preview-toolbar-actions">
              <button className="aur-chip gp-toolbar-icon-btn" onClick={handleCompartirLote}>
                <FiShare2 size={15} /> <span className="gp-toolbar-btn-text">Compartir</span>
              </button>
              <button className="aur-chip gp-toolbar-icon-btn" onClick={() => window.print()}>
                <FiPrinter size={15} /> <span className="gp-toolbar-btn-text">Imprimir</span>
              </button>
            </div>
          </div>

          <div className="gp-doc-wrap">
            <div className="gp-document" ref={docRef}>
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

              <div className="gp-doc-grupo-info">
                <div className="gp-doc-grupo-title">
                  LOTE: {previewLote.codigoLote}
                  {previewLote.nombreLote && previewLote.nombreLote !== previewLote.codigoLote && ` — ${previewLote.nombreLote}`}
                </div>
                <div className="gp-doc-grupo-meta">
                  <span><strong>Fecha de siembra:</strong> {formatDateLong(previewLote.fechaCreacion?._seconds ? new Date(previewLote.fechaCreacion._seconds * 1000) : new Date(previewLote.fechaCreacion))}</span>
                  {previewLote.hectareas && <span><strong>Hectáreas:</strong> {previewLote.hectareas} ha</span>}
                  {packages.find(p => p.id === previewLote.paqueteId) && (
                    <span><strong>Paquete técnico:</strong> {packages.find(p => p.id === previewLote.paqueteId).nombrePaquete}</span>
                  )}
                </div>
              </div>

              <table className="gp-doc-table">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Bloque</th>
                    <th className="gp-col-num">Ha.</th>
                    <th className="gp-col-num">Plantas</th>
                    <th>Material</th>
                  </tr>
                </thead>
                <tbody>
                  {previewGrouped.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '12px', color: '#999' }}>Sin bloques</td></tr>
                  )}
                  {previewGrouped.map(({ grupo, rows, totalHa, totalPlantas }) => (
                    <Fragment key={grupo}>
                      {rows.map(b => (
                        <tr key={b.id}>
                          <td>{b.grupo}</td>
                          <td>{b.bloque}</td>
                          <td className="gp-col-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>
                          <td className="gp-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                          <td>{b.material || '—'}</td>
                        </tr>
                      ))}
                      <tr className="gp-doc-subtotal-row">
                        <td className="gp-doc-subtotal-label">{grupo}</td>
                        <td />
                        <td className="gp-col-num">{totalHa.toFixed(4)}</td>
                        <td className="gp-col-num">{totalPlantas.toLocaleString()}</td>
                        <td />
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
                {previewGrouped.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={2}><strong>Totales</strong></td>
                      <td className="gp-col-num"><strong>{pvTotalHa.toFixed(4)}</strong></td>
                      <td className="gp-col-num"><strong>{pvTotalPlantas.toLocaleString()}</strong></td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>

              <div className="gp-doc-footer">
                Documento generado por Sistema Aurora
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default LoteManagement;
