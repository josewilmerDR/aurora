import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import '../styles/grupo-management.css';
import { FiEdit, FiTrash2, FiPlus, FiEye, FiShare2, FiPrinter, FiX, FiArrowLeft, FiCalendar, FiLayers, FiPackage, FiChevronRight, FiFilter, FiSliders } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import ConfirmModal from '../../../components/ConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';

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

// ── Tabla de bloques: helpers de ordenamiento / filtrado ─────────────────────
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
const BLOQUE_COLS = [
  { id: 'loteNombre', label: 'Lote'     },
  { id: 'bloque',     label: 'Bloque'   },
  { id: 'ha',         label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',    label: 'Plantas', filterType: 'number' },
  { id: 'material',   label: 'Material' },
  { id: 'kg',         label: 'Kg Est.', filterType: 'number' },
];

// ── New catalog value modal (cosecha / etapa) ───────────────────────────────
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
            maxLength={32}
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
  const [grupos,            setGrupos]            = useState([]);
  const [siembras,          setSiembras]          = useState([]);
  const [packages,          setPackages]          = useState([]);
  const [monitoreoPackages, setMonitoreoPackages] = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [selectedGrupo, setSelectedGrupo] = useState(null);
  const [showForm,      setShowForm]      = useState(false);
  const [showLibres,    setShowLibres]    = useState(false);
  const [isEditing,     setIsEditing]     = useState(false);
  const [catalogModal,  setCatalogModal]  = useState(null);
  const [localCosechas, setLocalCosechas] = useState([]);
  const [localEtapas,   setLocalEtapas]   = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [toast,         setToast]         = useState(null);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteModal,   setDeleteModal]   = useState(null);
  const [previewGrupo,     setPreviewGrupo]     = useState(null);
  const [bloqueSorts,      setBloqueSorts]      = useState([{ field: 'loteNombre', dir: 'asc' }]);
  const [bloqueColFilters, setBloqueColFilters] = useState({});
  const [bloqueFilterPop,  setBloqueFilterPop]  = useState(null);
  const [bloqueHiddenCols, setBloqueHiddenCols] = useState(new Set());
  const [bloqueColMenu,    setBloqueColMenu]     = useState(null);
  const docRef      = useRef(null);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const [formData, setFormData] = useState({
    id: null, nombreGrupo: '', cosecha: '', etapa: '',
    fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '',
  });

  const fetchAll = () => {
    const gruposP = apiFetch('/api/grupos').then(r => r.json()).then(data => { setGrupos(data); return data; }).catch(console.error).finally(() => setLoading(false));
    apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])).catch(console.error);
    apiFetch('/api/packages').then(r => r.json()).then(setPackages).catch(console.error);
    apiFetch('/api/monitoreo/paquetes').then(r => r.json()).then(setMonitoreoPackages).catch(console.error);
    apiFetch('/api/config').then(r => r.json()).then(setEmpresaConfig).catch(console.error);
    return gruposP;
  };

  useEffect(() => { fetchAll(); }, []);

  // Centra la burbuja activa en el carousel cuando cambia el grupo seleccionado
  useEffect(() => {
    if (!selectedGrupo || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedGrupo]);

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

  // ── Datos del grupo seleccionado (hub) ────────────────────────────────────
  const selectedBloques = useMemo(() => {
    if (!selectedGrupo) return [];
    return (selectedGrupo.bloques || [])
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [selectedGrupo, siembras]);

  const selectedFechaCosecha = useMemo(
    () => selectedGrupo ? calcFechaCosecha(selectedGrupo, empresaConfig) : null,
    [selectedGrupo, empresaConfig]
  );

  const selectedTotalHa      = selectedBloques.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0);
  const selectedTotalPlantas = selectedBloques.reduce((s, b) => s + (b.plantas || 0), 0);
  const selectedTotalKg      = selectedTotalPlantas * 1.6;

  // ── Tabla de bloques: normalizar, filtrar, ordenar ────────────────────────
  const selectedBloquesNorm = useMemo(() =>
    selectedBloques.map(b => ({
      ...b,
      ha:       parseFloat(b.areaCalculada) || 0,
      material: b.materialNombre || b.variedad || '',
      kg:       (b.plantas || 0) * 1.6,
    })),
  [selectedBloques]);

  const bloqueFiltered = useMemo(() => {
    const active = Object.entries(bloqueColFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    if (!active.length) return selectedBloquesNorm;
    return selectedBloquesNorm.filter(r => {
      for (const [field, filter] of active) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (filter.from !== '' && filter.from != null && num < Number(filter.from)) return false;
            if (filter.to   !== '' && filter.to   != null && num > Number(filter.to))   return false;
          } else {
            const str = String(cell);
            if (filter.from && str < filter.from) return false;
            if (filter.to   && str > filter.to)   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(filter.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [selectedBloquesNorm, bloqueColFilters]);

  const bloqueSorted = useMemo(() => multiSort(bloqueFiltered, bloqueSorts), [bloqueFiltered, bloqueSorts]);

  const filtTotalHa      = bloqueSorted.reduce((s, b) => s + (b.ha || 0), 0);
  const filtTotalPlantas = bloqueSorted.reduce((s, b) => s + (b.plantas || 0), 0);
  const filtTotalKg      = filtTotalPlantas * 1.6;

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

  const BloqueSortTh = ({ field, children, filterType = 'text' }) => {
    const active    = bloqueSorts[0].field === field;
    const dir       = active ? bloqueSorts[0].dir : null;
    const f         = bloqueColFilters[field];
    const hasFilter = f ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim()) : false;
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
        onClick={() => setBloqueSorts(prev => {
          const next = [...prev];
          next[0] = next[0].field === field ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' };
          return next;
        })}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span
          className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`}
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
      </th>
    );
  };

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
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '' });
  };

  const handleNewGrupo = () => {
    setIsEditing(false);
    setFormData({ id: null, nombreGrupo: '', cosecha: '', etapa: '', fechaCreacion: '', bloques: [], paqueteId: '', paqueteMuestreoId: '' });
    setShowForm(true);
    setSelectedGrupo(null);
  };

  const handleSelectGrupo = (grupo) => {
    setSelectedGrupo(grupo);
    setShowForm(false);
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
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
      id:            grupo.id,
      nombreGrupo:   grupo.nombreGrupo  || '',
      cosecha:       grupo.cosecha      || '',
      etapa:         grupo.etapa        || '',
      fechaCreacion: grupo.fechaCreacion ? formatDateForInput(grupo.fechaCreacion) : '',
      bloques:       Array.isArray(grupo.bloques) ? grupo.bloques : [],
      paqueteId:         grupo.paqueteId         || '',
      paqueteMuestreoId: grupo.paqueteMuestreoId || '',
    });
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
      if (selectedGrupo?.id === confirmModal.grupoId) setSelectedGrupo(null);
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
      if (selectedGrupo?.id === deleteModal.grupoId) setSelectedGrupo(null);
      setDeleteModal(null);
      fetchAll();
      showToast('Cédulas anuladas y grupo eliminado correctamente');
    } catch (err) {
      showToast(err.message || 'Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nombre = formData.nombreGrupo.trim();
    if (!nombre || nombre.length > 16) { showToast('El nombre del grupo debe tener entre 1 y 16 caracteres.', 'error'); return; }
    if (!formData.fechaCreacion) { showToast('La fecha de creación es requerida.', 'error'); return; }
    const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 15); maxDate.setHours(23, 59, 59, 999);
    if (new Date(formData.fechaCreacion) > maxDate) { showToast('La fecha no puede superar 15 días en el futuro.', 'error'); return; }
    if (formData.bloques.length === 0) { showToast('Selecciona al menos un bloque.', 'error'); return; }
    const url    = isEditing ? `/api/grupos/${formData.id}` : '/api/grupos';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const { id: _id, ...payload } = formData;
      payload.nombreGrupo = payload.nombreGrupo.trim();
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      const saved     = await res.json();
      const newGrupos = await fetchAll();
      const savedId   = isEditing ? formData.id : saved.id;
      if (savedId && newGrupos) {
        const found = newGrupos.find(g => g.id === savedId);
        if (found) setSelectedGrupo(found);
      }
      resetForm();
      showToast(isEditing ? 'Grupo actualizado correctamente' : formData.paqueteId ? 'Grupo creado y tareas programadas' : 'Grupo creado correctamente');
    } catch {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  // ── Preview (PDF / print) ────────────────────────────────────────────────
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
  const getMonitoreoPackageName = (id) => monitoreoPackages.find(p => p.id === id)?.nombrePaquete || '—';

  // ── Panel principal (hub o formulario) ───────────────────────────────────
  const renderPanel = () => {
    if (showForm) {
      return (
        <div className="form-card">
          <h2>{isEditing ? 'Editar Grupo' : 'Crear Nuevo Grupo'}</h2>
          <form onSubmit={handleSubmit} className="lote-form">
            <div className="form-grid">
              <div className="form-control">
                <label htmlFor="nombreGrupo">Nombre de Grupo</label>
                <input id="nombreGrupo" name="nombreGrupo" value={formData.nombreGrupo} onChange={handleInputChange} required maxLength={16} />
              </div>
              <div className="form-control">
                <label htmlFor="fechaCreacion">Fecha de Creación</label>
                <input id="fechaCreacion" name="fechaCreacion" type="date" value={formData.fechaCreacion} onChange={handleInputChange} required max={(() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().split('T')[0]; })()} />
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
              <div className="form-control" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="paqueteMuestreoId">Paquete de Muestreos</label>
                <select id="paqueteMuestreoId" name="paqueteMuestreoId" value={formData.paqueteMuestreoId} onChange={handleInputChange} disabled={monitoreoPackages.length === 0}>
                  <option value="">{monitoreoPackages.length === 0 ? '-- Sin paquetes de muestreo --' : '-- Seleccionar Paquete --'}</option>
                  {monitoreoPackages.map(p => <option key={p.id} value={p.id}>{p.nombrePaquete}</option>)}
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
        </div>
      );
    }

    if (!selectedGrupo) return null;

    return (
      <div className="grupo-hub">
        <button className="grupo-hub-back" onClick={() => setSelectedGrupo(null)}>
          <FiArrowLeft size={13} /> Todos los grupos
        </button>
        <div className="hub-header">
          <div className="hub-title-block">
            <h2 className="hub-lote-code">{selectedGrupo.nombreGrupo}</h2>
          </div>
          <div className="hub-header-actions">
            <button onClick={() => setPreviewGrupo(selectedGrupo)} className="icon-btn" title="Vista previa / PDF">
              <FiEye size={16} />
            </button>
            <button onClick={() => handleEdit(selectedGrupo)} className="icon-btn" title="Editar">
              <FiEdit size={16} />
            </button>
            <button onClick={() => handleDeleteClick(selectedGrupo)} className="icon-btn delete" title="Eliminar">
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>

        <div className="hub-info-pills">
          <span className="hub-pill">
            <FiCalendar size={13} />
            {formatDateLong(tsToDate(selectedGrupo.fechaCreacion))}
          </span>
          {selectedGrupo.cosecha && <span className="hub-pill">{selectedGrupo.cosecha}</span>}
          {selectedGrupo.etapa   && <span className="hub-pill">{selectedGrupo.etapa}</span>}
          {selectedBloques.length > 0 && (
            <span className="hub-pill">
              <FiLayers size={13} />
              {selectedBloques.length} bloque(s)
            </span>
          )}
          {selectedGrupo.paqueteId && (
            <span className="hub-pill">
              <FiPackage size={13} />
              {getPackageName(selectedGrupo.paqueteId)}
            </span>
          )}
          {selectedGrupo.paqueteMuestreoId && (
            <span className="hub-pill">
              <FiPackage size={13} />
              {getMonitoreoPackageName(selectedGrupo.paqueteMuestreoId)}
            </span>
          )}
          {selectedFechaCosecha && (
            <span className="hub-pill hub-pill-muted">
              Cosecha est.: {formatDateLong(selectedFechaCosecha)}
            </span>
          )}
        </div>

        <div className="grupo-hub-bloques-header">
          <p className="grupo-hub-bloques-title">Bloques</p>
          {Object.values(bloqueColFilters).some(f => f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())) && (
            <button className="historial-clear-col-filters" onClick={() => setBloqueColFilters({})}>
              <FiX size={11} /> Limpiar filtros
            </button>
          )}
        </div>
        {selectedBloques.length === 0 ? (
          <p className="empty-state">Este grupo no tiene bloques asignados.</p>
        ) : (
          <div className="hor-table-wrap">
            <table className="hor-table grupo-hub-table">
              <thead>
                <tr>
                  {!bloqueHiddenCols.has('loteNombre') && <BloqueSortTh field="loteNombre">Lote</BloqueSortTh>}
                  {!bloqueHiddenCols.has('bloque')     && <BloqueSortTh field="bloque">Bloque</BloqueSortTh>}
                  {!bloqueHiddenCols.has('ha')         && <BloqueSortTh field="ha" filterType="number">Ha.</BloqueSortTh>}
                  {!bloqueHiddenCols.has('plantas')    && <BloqueSortTh field="plantas" filterType="number">Plantas</BloqueSortTh>}
                  {!bloqueHiddenCols.has('material')   && <BloqueSortTh field="material">Material</BloqueSortTh>}
                  {!bloqueHiddenCols.has('kg')         && <BloqueSortTh field="kg" filterType="number">Kg Est.</BloqueSortTh>}
                  <th className="hor-th-settings">
                    <button
                      className={`hor-col-toggle-btn${bloqueHiddenCols.size > 0 ? ' hor-col-toggle-btn--active' : ''}`}
                      onClick={handleBloqueColBtnClick}
                      title="Personalizar columnas visibles"
                    >
                      <FiSliders size={12} />
                      {bloqueHiddenCols.size > 0 && <span className="hor-col-hidden-badge">{bloqueHiddenCols.size}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bloqueSorted.map(b => (
                  <tr key={b.id}>
                    {!bloqueHiddenCols.has('loteNombre') && <td>{b.loteNombre || '—'}</td>}
                    {!bloqueHiddenCols.has('bloque')     && <td>{b.bloque || '—'}</td>}
                    {!bloqueHiddenCols.has('ha')         && <td className="hor-td-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>}
                    {!bloqueHiddenCols.has('plantas')    && <td className="hor-td-num">{b.plantas?.toLocaleString() ?? '—'}</td>}
                    {!bloqueHiddenCols.has('material')   && <td>{b.material || '—'}</td>}
                    {!bloqueHiddenCols.has('kg')         && <td className="hor-td-num">{b.kg ? b.kg.toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>}
                    <td />
                  </tr>
                ))}
              </tbody>
              {bloqueSorted.length > 0 && (
                <tfoot>
                  <tr>
                    {!bloqueHiddenCols.has('loteNombre') && <td><strong>Totales</strong></td>}
                    {!bloqueHiddenCols.has('bloque')     && <td />}
                    {!bloqueHiddenCols.has('ha')         && <td className="hor-td-num"><strong>{filtTotalHa.toFixed(4)}</strong></td>}
                    {!bloqueHiddenCols.has('plantas')    && <td className="hor-td-num"><strong>{filtTotalPlantas.toLocaleString()}</strong></td>}
                    {!bloqueHiddenCols.has('material')   && <td />}
                    {!bloqueHiddenCols.has('kg')         && <td className="hor-td-num"><strong>{filtTotalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>}
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
    <div className={`grupo-page${selectedGrupo && !showForm ? ' grupo-page--selected' : ''}${showForm ? ' grupo-page--form' : ''}`}>
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

      {/* ── Spinner de carga ── */}
      {loading && <div className="grupo-page-loading" />}

      {/* ── Estado vacío ── */}
      {!loading && grupos.length === 0 && !showForm && (
        <div className="grupo-empty-state">
          <FiLayers size={36} />
          <p>No hay grupos de producción creados aún.</p>
          <button className="btn btn-primary" onClick={handleNewGrupo}>
            <FiPlus size={15} /> Crear el primero
          </button>
        </div>
      )}

      {/* ── Mobile sticky carousel ── */}
      {selectedGrupo && !showForm && (
        <div className="lote-carousel" ref={carouselRef}>
          {grupos.map(grupo => (
            <button
              key={grupo.id}
              className={`lote-bubble${selectedGrupo?.id === grupo.id ? ' lote-bubble--active' : ''}`}
              onClick={() => selectedGrupo?.id === grupo.id ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
            >
              <span className="lote-bubble-avatar">{grupo.nombreGrupo.slice(0, 4)}</span>
              <span className="lote-bubble-label">{grupo.nombreGrupo}</span>
            </button>
          ))}
          <button className="lote-bubble lote-bubble--add" onClick={handleNewGrupo}>
            <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      {!loading && grupos.length > 0 && !showForm && (
        <div className="lote-page-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Grupos</h2>
          <button className="btn btn-primary" onClick={handleNewGrupo}>
            <FiPlus size={15} /> Nuevo Grupo
          </button>
        </div>
      )}

      {!loading && (grupos.length > 0 || showForm) && <div className="lote-management-layout">

        {/* Hub o formulario */}
        {renderPanel()}

        {/* Lista compacta */}
        <div className="lote-list-panel">
          {grupos.length === 0 ? (
            <div className="grupo-cta">
              <div className="grupo-cta-icon"><FiPlus size={24} /></div>
              <p className="grupo-cta-title">Sin grupos creados</p>
              <p className="grupo-cta-desc">
                Organiza los bloques de siembra cerrados en grupos de producción
                para gestionar aplicaciones, cosechas y reportes.
              </p>
              <button className="btn btn-primary btn-full" onClick={handleNewGrupo}>
                <FiPlus size={15} /> Crear primer grupo
              </button>
            </div>
          ) : (
            <ul className="lote-list">
              {grupos.map(grupo => (
                <li
                  key={grupo.id}
                  className={`lote-list-item${selectedGrupo?.id === grupo.id && !showForm ? ' active' : ''}`}
                  onClick={() => selectedGrupo?.id === grupo.id && !showForm ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
                >
                  <div className="lote-list-info">
                    <span className="lote-list-code">{grupo.nombreGrupo}</span>
                    {(grupo.cosecha || grupo.etapa) && (
                      <span className="lote-list-name">{[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>}

      {/* ── Preview modal (PDF / impresión) ── */}
      {previewGrupo && createPortal(
        <div className="gp-preview-backdrop">

          <div className="gp-preview-toolbar">
            <button className="btn btn-secondary gp-toolbar-icon-btn" onClick={() => setPreviewGrupo(null)}>
              <FiArrowLeft size={15} /> <span className="gp-toolbar-btn-text">Volver</span>
            </button>
            <span className="gp-preview-toolbar-title">Grupo — {previewGrupo.nombreGrupo}</span>
            <div className="gp-preview-toolbar-actions">
              <button className="btn btn-secondary gp-toolbar-icon-btn" onClick={handleCompartir}>
                <FiShare2 size={15} /> <span className="gp-toolbar-btn-text">Compartir</span>
              </button>
              <button className="btn btn-secondary gp-toolbar-icon-btn" onClick={() => window.print()}>
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
                  <div className="gp-doc-grupo-title">GRUPO: {previewGrupo.nombreGrupo}</div>
                  <div className="gp-doc-grupo-meta">
                    <span><strong>Fecha de creación:</strong> {formatDateLong(previewFechaCreacion)}</span>
                    <span><strong>Fecha estimada de cosecha:</strong> {previewFechaCosecha ? formatDateLong(previewFechaCosecha) : '—'}</span>
                    {(previewGrupo.cosecha || previewGrupo.etapa) && (
                      <span><strong>Cosecha / Etapa:</strong> {[previewGrupo.cosecha, previewGrupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                </div>

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
          </div>,
          document.body
      )}

      {/* ── Filter popover (tabla de bloques) ── */}
      {bloqueFilterPop && createPortal(
        <>
          <div className="historial-filter-backdrop" onClick={() => setBloqueFilterPop(null)} />
          <div
            className={`historial-filter-popover${bloqueFilterPop.filterType !== 'text' ? ' historial-filter-popover--range' : ''}`}
            style={{ left: bloqueFilterPop.x, top: bloqueFilterPop.y }}
          >
            <FiFilter size={13} className="historial-filter-popover-icon" />
            {bloqueFilterPop.filterType !== 'text' ? (
              <>
                <div className="historial-filter-range">
                  <div className="historial-filter-range-row">
                    <span className="historial-filter-range-label">De</span>
                    <input
                      autoFocus
                      type={bloqueFilterPop.filterType}
                      className="historial-filter-input"
                      value={bloqueColFilters[bloqueFilterPop.field]?.from || ''}
                      onChange={e => setBloqueColFilter(bloqueFilterPop.field, {
                        type: 'range',
                        from: e.target.value,
                        to: bloqueColFilters[bloqueFilterPop.field]?.to || '',
                      })}
                      onKeyDown={e => { if (e.key === 'Escape') setBloqueFilterPop(null); }}
                    />
                  </div>
                  <div className="historial-filter-range-row">
                    <span className="historial-filter-range-label">A</span>
                    <input
                      type={bloqueFilterPop.filterType}
                      className="historial-filter-input"
                      value={bloqueColFilters[bloqueFilterPop.field]?.to || ''}
                      onChange={e => setBloqueColFilter(bloqueFilterPop.field, {
                        type: 'range',
                        from: bloqueColFilters[bloqueFilterPop.field]?.from || '',
                        to: e.target.value,
                      })}
                      onKeyDown={e => { if (e.key === 'Escape') setBloqueFilterPop(null); }}
                    />
                  </div>
                </div>
                {(bloqueColFilters[bloqueFilterPop.field]?.from || bloqueColFilters[bloqueFilterPop.field]?.to) && (
                  <button className="historial-filter-clear" title="Limpiar filtro"
                    onClick={() => { setBloqueColFilter(bloqueFilterPop.field, null); setBloqueFilterPop(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            ) : (
              <>
                <input
                  autoFocus
                  className="historial-filter-input"
                  placeholder="Filtrar…"
                  value={bloqueColFilters[bloqueFilterPop.field]?.value || ''}
                  onChange={e => setBloqueColFilter(bloqueFilterPop.field, { type: 'text', value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setBloqueFilterPop(null); }}
                />
                {bloqueColFilters[bloqueFilterPop.field]?.value && (
                  <button className="historial-filter-clear" title="Limpiar filtro"
                    onClick={() => { setBloqueColFilter(bloqueFilterPop.field, null); setBloqueFilterPop(null); }}>
                    <FiX size={13} />
                  </button>
                )}
              </>
            )}
          </div>
        </>,
        document.body
      )}

      {/* ── Column menu (tabla de bloques) ── */}
      {bloqueColMenu && createPortal(
        <>
          <div className="hor-col-menu-backdrop" onClick={() => setBloqueColMenu(null)} />
          <div className="hor-col-menu" style={{ left: bloqueColMenu.x, top: bloqueColMenu.y }}>
            <div className="hor-col-menu-title">Columnas visibles</div>
            {BLOQUE_COLS.map(col => (
              <button
                key={col.id}
                className={`hor-col-menu-item${bloqueHiddenCols.has(col.id) ? ' is-hidden' : ''}`}
                onClick={() => setBloqueHiddenCols(prev => {
                  const next = new Set(prev);
                  next.has(col.id) ? next.delete(col.id) : next.add(col.id);
                  return next;
                })}
              >
                <span className="hor-col-menu-check" />
                {col.label}
              </button>
            ))}
            {bloqueHiddenCols.size > 0 && (
              <button className="hor-col-menu-reset" onClick={() => { setBloqueHiddenCols(new Set()); setBloqueColMenu(null); }}>
                Mostrar todas
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

export default GrupoManagement;
