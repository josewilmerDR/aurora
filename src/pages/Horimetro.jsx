import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  FiClock, FiPlus, FiX, FiCheck, FiEdit, FiTrash2, FiFilter, FiSliders,
  FiCamera, FiUpload, FiZap, FiSearch,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';
import './Horimetro.css';


const DRAFT_KEY        = 'aurora_horimetro_draft';
const DRAFT_ACTIVE_KEY = 'aurora_draftActive_horimetro-registro';

const saveDraft = (form, isEditing) => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, isEditing }));
  sessionStorage.setItem(DRAFT_ACTIVE_KEY, '1');
  window.dispatchEvent(new Event('aurora-draft-change'));
};
const clearDraft = () => {
  localStorage.removeItem(DRAFT_KEY);
  sessionStorage.removeItem(DRAFT_ACTIVE_KEY);
  window.dispatchEvent(new Event('aurora-draft-change'));
};
const loadDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; } };

const EMPTY_FORM = {
  id: null,
  fecha: new Date().toISOString().slice(0, 10),
  tractorId: '',
  tractorNombre: '',
  implemento: '',
  horimetroInicial: '',
  horimetroFinal: '',
  loteId: '',
  loteNombre: '',
  grupo: '',
  bloques: [],
  labor: '',
  horaInicio: '',
  horaFinal: '',
  operarioId: '',
  operarioNombre: '',
};

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

function horasUsadas(rec) {
  const ini = parseFloat(rec.horimetroInicial);
  const fin = parseFloat(rec.horimetroFinal);
  if (!isNaN(ini) && !isNaN(fin) && fin >= ini) return (fin - ini).toFixed(1);
  return null;
}

const MAX_IMAGE_PX = 1600;
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_PX || height > MAX_IMAGE_PX) {
          const ratio = Math.min(MAX_IMAGE_PX / width, MAX_IMAGE_PX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const COLUMNS = [
  { id: 'fecha',            label: 'Fecha',             filterType: 'date'   },
  { id: 'tractorNombre',    label: 'Tractor'                                  },
  { id: 'implemento',       label: 'Implemento'                               },
  { id: 'horimetroInicial', label: 'Horímetro Inicial', filterType: 'number' },
  { id: 'horimetroFinal',   label: 'Horímetro Final',   filterType: 'number' },
  { id: 'horas',            label: 'Horas',             plain: true           },
  { id: 'loteNombre',       label: 'Lote'                                     },
  { id: 'grupo',            label: 'Grupo'                                    },
  { id: 'bloque',           label: 'Bloque',            plain: true           },
  { id: 'labor',            label: 'Labor'                                    },
  { id: 'horaInicio',       label: 'Hora Inicial'                             },
  { id: 'horaFinal',        label: 'Hora Final'                               },
  { id: 'operarioNombre',   label: 'Operario'                                 },
];

function Horimetro() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const location = useLocation();

  // Labor combobox
  const laborRef = useRef(null);
  const [laborQuery, setLaborQuery] = useState('');
  const [laborOpen, setLaborOpen] = useState(false);

  // Scan state
  const scanFileRef = useRef(null);
  const [scanStep, setScanStep] = useState(null); // null | 'upload' | 'review'
  const [scanImage, setScanImage] = useState(null);
  const [scanRows, setScanRows] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [savingBatch, setSavingBatch] = useState(false);

  // Catalog data
  const [tractores, setTractores] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [labores, setLabores] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Form — restore draft on mount
  const _draft = loadDraft();
  const [showForm, setShowForm]   = useState(!!_draft);
  const [form, setForm]           = useState(_draft?.form     ?? EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(_draft?.isEditing ?? false);
  const [saving, setSaving]       = useState(false);

  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [hiddenCols,    setHiddenCols]    = useState(new Set());
  const [colMenu,       setColMenu]       = useState(null);
  const [rangeConfirm,  setRangeConfirm]  = useState(null);
  const [sorts, setSorts] = useState([{ field: 'fecha', dir: 'desc' }]);

  const fetchRecords = () =>
    apiFetch('/api/horimetro')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar los registros.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    Promise.all([
      apiFetch('/api/maquinaria').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/labores').then(r => r.json()),
    ]).then(([maq, lotesData, usersData, gruposData, siembrasData, laboresData]) => {
      setTractores(Array.isArray(maq) ? maq : []);
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setLabores(Array.isArray(laboresData) ? laboresData : []);
    }).catch(() => { });
    fetchRecords();
  }, []);

  // Restore sidebar draft badge if a cross-session draft exists
  useEffect(() => {
    if (loadDraft()) {
      sessionStorage.setItem(DRAFT_ACTIVE_KEY, '1');
      window.dispatchEvent(new Event('aurora-draft-change'));
    }
  }, []);

  // Pre-fill from Aurora chat "Revisar en formulario" (passed via router state)
  useEffect(() => {
    const draft = location.state?.horimetroDraft;
    if (!draft) return;
    // Clear the state so refreshing the page won't re-apply it
    window.history.replaceState({}, '');
    if (Array.isArray(draft) && draft.length > 1) {
      setScanRows(draft);
      setScanStep('review');
      setShowForm(false);
    } else {
      const single = Array.isArray(draft) ? draft[0] : draft;
      setForm(prev => ({ ...prev, ...single, id: null }));
      setShowForm(true);
      setScanStep(null);
    }
  }, [location.state]);

  // Close labor combobox on outside click
  useEffect(() => {
    if (!laborOpen) return;
    const handler = (e) => {
      if (laborRef.current && !laborRef.current.contains(e.target)) {
        setLaborOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [laborOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'tractorId') {
        const t = tractores.find(x => x.id === value);
        next.tractorNombre = t ? t.descripcion : '';
      }
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.grupo = '';
        next.bloques = [];
      }
      if (name === 'grupo') {
        // auto-select all bloques of the chosen grupo
        const grupoSel = grupos.find(g => g.nombreGrupo === value);
        next.bloques = grupoSel?.bloques
          ?.map(id => siembras.find(s => s.id === id))
          .filter(Boolean)
          .map(s => s.bloque || s.id) ?? [];
      }
      if (name === 'operarioId') {
        const u = usuarios.find(x => x.id === value);
        next.operarioNombre = u ? u.nombre : '';
      }
      saveDraft(next, isEditing);
      return next;
    });
  };

  const toggleBloque = (val) => {
    setForm(prev => {
      const current = prev.bloques || [];
      const next = current.includes(val) ? current.filter(b => b !== val) : [...current, val];
      const newForm = { ...prev, bloques: next };
      saveDraft(newForm, isEditing);
      return newForm;
    });
  };

  const resetForm = () => {
    clearDraft();
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleNew = () => {
    const newForm = {
      ...EMPTY_FORM,
      operarioId: currentUser?.id || '',
      operarioNombre: currentUser?.nombre || '',
    };
    saveDraft(newForm, false);
    setForm(newForm);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleEdit = (rec) => {
    const editForm = { ...EMPTY_FORM, ...rec };
    saveDraft(editForm, true);
    setForm(editForm);
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro de horímetro?')) return;
    try {
      const res = await apiFetch(`/api/horimetro/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Registro eliminado.');
      fetchRecords();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const url    = isEditing ? `/api/horimetro/${form.id}` : '/api/horimetro';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Registro actualizado.' : 'Registro guardado.');
      resetForm();
      fetchRecords();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const checkHoraAndSave = () => {
    if (form.horaInicio && form.horaFinal) {
      const [hI, mI] = form.horaInicio.split(':').map(Number);
      const [hF, mF] = form.horaFinal.split(':').map(Number);
      const diffMin = (hF * 60 + mF) - (hI * 60 + mI);
      if (diffMin > 12 * 60) {
        setRangeConfirm({
          title: 'Rango inusual de horas',
          message: `El rango de horas trabajadas es de ${(diffMin / 60).toFixed(1)} h. ¿Es correcto?`,
          onConfirm: () => { setRangeConfirm(null); doSave(); },
        });
        return;
      }
    }
    doSave();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.fecha || !form.tractorId) {
      showToast('Fecha y tractor son obligatorios.', 'error');
      return;
    }
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    if (!isNaN(ini) && !isNaN(fin) && ini >= fin) {
      showToast('El horímetro inicial debe ser menor que el final.', 'error');
      return;
    }
    if (form.horaInicio && form.horaFinal && form.horaInicio >= form.horaFinal) {
      showToast('La hora de inicio debe ser menor que la hora final.', 'error');
      return;
    }
    if (!isNaN(ini) && !isNaN(fin) && (fin - ini) > 12) {
      setRangeConfirm({
        title: 'Rango inusual de horímetro',
        message: `El rango del horímetro es de ${(fin - ini).toFixed(1)} h. ¿Es correcto?`,
        onConfirm: () => { setRangeConfirm(null); checkHoraAndSave(); },
      });
      return;
    }
    checkHoraAndSave();
  };

  // ── Derived asset lists ────────────────────────────────────────────────────
  const tractoresLista = useMemo(() =>
    tractores.filter(t => /tractor/i.test(t.tipo) || /otra maquinaria/i.test(t.tipo)),
    [tractores]);

  const implementosLista = useMemo(() =>
    tractores.filter(t => /implemento/i.test(t.tipo)),
    [tractores]);

  const gruposDelLote = useMemo(() => {
    if (!form.loteId) return grupos;
    const siembraIds = new Set(
      siembras.filter(s => s.loteId === form.loteId).map(s => s.id)
    );
    return grupos.filter(g =>
      Array.isArray(g.bloques) && g.bloques.some(bid => siembraIds.has(bid))
    );
  }, [grupos, siembras, form.loteId]);

  const bloquesDelGrupo = useMemo(() => {
    const grupoSel = grupos.find(g => g.nombreGrupo === form.grupo);
    if (!grupoSel || !Array.isArray(grupoSel.bloques)) return [];
    return grupoSel.bloques
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [grupos, siembras, form.grupo]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const activeCol = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    return records.filter(r => {
      for (const [field, filter] of activeCol) {
        const cell = r[field];
        if (filter.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num) && cell !== '') {
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
  }, [records, colFilters]);

  const sorted = useMemo(() => multiSort(filtered, sorts), [filtered, sorts]);

  const handleThSort = (field) => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
  };

  const openFilter = (e, field, filterType = 'text') => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th   = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, x: rect.left, y: rect.bottom + 4, filterType });
  };

  const openColMenu = (e) => {
    e.preventDefault();
    setColMenu({ x: e.clientX, y: e.clientY });
  };

  const toggleCol = (id) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const hiddenCount = hiddenCols.size;

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  const setColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  // ── Scan handlers ──────────────────────────────────────────────────────────
  const handleScanFile = async (e) => {
    const file = e.target.files?.[0] || e.dataTransfer?.files?.[0];
    if (!file) return;
    setScanError(null);
    try { setScanImage(await compressImage(file)); }
    catch { setScanError('No se pudo procesar la imagen. Intenta con otro archivo.'); }
    if (e.target) e.target.value = '';
  };

  const handleScanDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleScanFile({ dataTransfer: e.dataTransfer });
  };

  const handleScan = async () => {
    if (!scanImage) return;
    setScanning(true); setScanError(null);
    try {
      const res = await apiFetch('/api/horimetro/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: scanImage.base64, mediaType: scanImage.mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error del servidor');
      setScanRows(data.filas || []);
      setScanStep('review');
    } catch (err) {
      setScanError(err.message || 'Error al escanear el formulario.');
    } finally {
      setScanning(false);
    }
  };

  const updateScanRow = (idx, field, value) => {
    setScanRows(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value };
      if (field === 'tractorId') {
        const t = tractoresLista.find(x => x.id === value);
        row.tractorNombre = t ? t.descripcion : '';
      }
      if (field === 'loteId') {
        const l = lotes.find(x => x.id === value);
        row.loteNombre = l ? l.nombreLote : '';
        row.grupo = '';
        row.bloques = [];
      }
      if (field === 'operarioId') {
        const u = usuarios.find(x => x.id === value);
        row.operarioNombre = u ? u.nombre : '';
      }
      next[idx] = row;
      return next;
    });
  };

  const removeScanRow = (idx) => setScanRows(prev => prev.filter((_, i) => i !== idx));

  const handleBatchSave = async () => {
    const validas = scanRows.filter(r => r.fecha && r.tractorId);
    if (!validas.length) { showToast('Ninguna fila tiene fecha y tractor.', 'error'); return; }
    setSavingBatch(true);
    let ok = 0, fail = 0;
    for (const row of validas) {
      try {
        const res = await apiFetch('/api/horimetro', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(row),
        });
        if (res.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setSavingBatch(false);
    showToast(`${ok} registro(s) guardado(s)${fail ? ` · ${fail} error(es)` : ''}.`, fail ? 'error' : 'success');
    if (ok) { setScanStep(null); setScanImage(null); setScanRows([]); fetchRecords(); }
  };

  // Grupos filtrados por lote para una fila del batch
  const gruposParaFila = (loteId) => {
    if (!loteId) return grupos;
    const ids = new Set(siembras.filter(s => s.loteId === loteId).map(s => s.id));
    return grupos.filter(g => Array.isArray(g.bloques) && g.bloques.some(b => ids.has(b)));
  };

  const grupoLabel = (g) => {
    const bloqueNums = (g.bloques || [])
      .map(id => siembras.find(s => s.id === id)?.bloque)
      .filter(Boolean)
      .sort((a, b) => parseInt(a) - parseInt(b));
    return bloqueNums.length
      ? `${g.nombreGrupo} (${bloqueNums.join(', ')})`
      : g.nombreGrupo;
  };

  // ── Inline validation ─────────────────────────────────────────────────────
  const errHorimetro = (() => {
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    return !isNaN(ini) && !isNaN(fin) && ini >= fin;
  })();
  const errHora = !!(form.horaInicio && form.horaFinal && form.horaInicio >= form.horaFinal);

  // ── Sort+filter column header ──────────────────────────────────────────────
  const SortTh = ({ field, children, filterType = 'text' }) => {
    const active = sorts[0].field === field;
    const dir    = active ? sorts[0].dir : null;
    const f      = colFilters[field];
    const hasFilter = f
      ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim())
      : false;
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(field)}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`} onClick={e => openFilter(e, field, filterType)} title="Filtrar columna (o clic derecho)">
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="hor-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {rangeConfirm && (
        <ConfirmModal
          title={rangeConfirm.title}
          message={rangeConfirm.message}
          confirmLabel="Sí, es correcto"
          onConfirm={rangeConfirm.onConfirm}
          onCancel={() => setRangeConfirm(null)}
        />
      )}

      {/* ── Form card ── */}
      {showForm ? (
        <div className="hor-form-card">
          <div className="hor-form-header">
            <span>{isEditing ? 'Editar Registro' : 'Nuevo Registro de Horímetro'}</span>
            <div className="hor-form-header-right">
              {!isEditing && (
                <button
                  type="button"
                  className="btn btn-secondary hor-scan-header-btn"
                  onClick={() => { resetForm(); setScanStep('upload'); setScanImage(null); setScanError(null); }}
                >
                  <FiCamera size={14} /> Escanear Formulario
                </button>
              )}
              <button className="hor-close-btn" onClick={resetForm} title="Cancelar">
                <FiX size={16} />
              </button>
            </div>
          </div>

          <form className="hor-form" onSubmit={handleSubmit}>

            <p className="hor-section-label">Maquinaria</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <label>Fecha <span className="hor-req">*</span></label>
                <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
              </div>

              <div className="hor-field">
                <label>Tractor <span className="hor-req">*</span></label>
                <select name="tractorId" value={form.tractorId} onChange={handleChange} required>
                  <option value="">— Seleccionar —</option>
                  {tractoresLista.map(t => <option key={t.id} value={t.id}>{t.codigo ? `${t.codigo} — ${t.descripcion}` : t.descripcion}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Implemento</label>
                <select name="implemento" value={form.implemento} onChange={handleChange}>
                  <option value="">— Sin implemento —</option>
                  {implementosLista.map(t => <option key={t.id} value={t.descripcion}>{t.codigo ? `${t.codigo} — ${t.descripcion}` : t.descripcion}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Horímetro Inicial</label>
                <input
                  type="number" name="horimetroInicial"
                  value={form.horimetroInicial} onChange={handleChange}
                  min="0" step="0.1" placeholder="0.0"
                  className={errHorimetro ? 'hor-input-error' : ''}
                />
              </div>

              <div className="hor-field">
                <label>Horímetro Final</label>
                <input
                  type="number" name="horimetroFinal"
                  value={form.horimetroFinal} onChange={handleChange}
                  min="0" step="0.1" placeholder="0.0"
                  className={errHorimetro ? 'hor-input-error' : ''}
                />
                {errHorimetro && <span className="hor-field-error">El final debe ser mayor que el inicial</span>}
              </div>

              <div className="hor-field">
                <label>Hora de Inicio</label>
                <input
                  type="time" name="horaInicio" value={form.horaInicio} onChange={handleChange}
                  className={errHora ? 'hor-input-error' : ''}
                />
              </div>

              <div className="hor-field">
                <label>Hora Final</label>
                <input
                  type="time" name="horaFinal" value={form.horaFinal} onChange={handleChange}
                  className={errHora ? 'hor-input-error' : ''}
                />
                {errHora && <span className="hor-field-error">La hora final debe ser mayor que la inicial</span>}
              </div>
            </div>

            <p className="hor-section-label">Ubicación y Labor</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <label>Lote</label>
                <select name="loteId" value={form.loteId} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Grupo</label>
                <select name="grupo" value={form.grupo} onChange={handleChange}>
                  <option value="">— Sin grupo —</option>
                  {gruposDelLote.map(g => (
                    <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                  ))}
                </select>
              </div>

              <div className="hor-field hor-field--full">
                <label>Bloques</label>
                {!form.grupo ? (
                  <p className="hor-check-empty">Seleccione un grupo primero.</p>
                ) : bloquesDelGrupo.length === 0 ? (
                  <p className="hor-check-empty">Este grupo no tiene bloques.</p>
                ) : (
                  <div className="hor-check-list">
                    {bloquesDelGrupo.map(s => {
                      const val = s.bloque || s.id;
                      return (
                        <label key={s.id} className="hor-check-row">
                          <input
                            type="checkbox"
                            checked={(form.bloques || []).includes(val)}
                            onChange={() => toggleBloque(val)}
                          />
                          <span>Bloque {s.bloque || s.id}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="hor-field hor-field--full">
                <label>Labor</label>
                <div className="hor-labor-combo" ref={laborRef}>
                  <div className="hor-labor-input-wrap" onClick={() => setLaborOpen(true)}>
                    <FiSearch size={13} />
                    <input
                      type="text"
                      placeholder={form.labor || '— Buscar labor —'}
                      value={laborOpen ? laborQuery : ''}
                      onChange={e => { setLaborQuery(e.target.value); setLaborOpen(true); }}
                      onFocus={() => setLaborOpen(true)}
                      className={form.labor && !laborOpen ? 'hor-labor-has-value' : ''}
                    />
                    {form.labor && (
                      <button type="button" onClick={e => { e.stopPropagation(); setForm(p => ({ ...p, labor: '' })); setLaborQuery(''); }}>
                        <FiX size={13} />
                      </button>
                    )}
                  </div>
                  {laborOpen && (
                    <div className="hor-labor-dropdown">
                      {labores
                        .filter(l => {
                          const q = laborQuery.toLowerCase();
                          return !q || l.descripcion?.toLowerCase().includes(q) || l.codigo?.toLowerCase().includes(q);
                        })
                        .map(l => (
                          <button
                            type="button"
                            key={l.id}
                            className="hor-labor-option"
                            onClick={() => {
                              setForm(p => ({ ...p, labor: l.descripcion }));
                              setLaborQuery('');
                              setLaborOpen(false);
                            }}
                          >
                            {l.codigo && <span className="hor-labor-code">{l.codigo}</span>}
                            <span className="hor-labor-desc">{l.descripcion}</span>
                          </button>
                        ))
                      }
                      {labores.filter(l => {
                        const q = laborQuery.toLowerCase();
                        return !q || l.descripcion?.toLowerCase().includes(q) || l.codigo?.toLowerCase().includes(q);
                      }).length === 0 && (
                        <p className="hor-labor-empty">Sin resultados</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <p className="hor-section-label">Operario</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <select name="operarioId" value={form.operarioId} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            </div>

            <div className="hor-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      ) : scanStep === 'upload' ? (
        <div className="hor-scan-card">
          <div className="hor-form-header">
            <span><FiCamera size={14} style={{ marginRight: 6 }} />Escanear Formulario de Horímetro</span>
            <button className="hor-close-btn" onClick={() => { setScanStep(null); setScanImage(null); setScanError(null); }}><FiX size={16} /></button>
          </div>
          <div className="hor-scan-body">
            <div
              className={`hor-drop-zone${scanImage ? ' has-image' : ''}`}
              onDrop={handleScanDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => !scanImage && scanFileRef.current?.click()}
            >
              {scanImage ? (
                <div className="hor-scan-preview-wrap">
                  <img src={scanImage.previewUrl} alt="Formulario" className="hor-scan-preview" />
                  <button className="hor-scan-clear" onClick={e => { e.stopPropagation(); setScanImage(null); }}>
                    <FiX size={14} /> Cambiar imagen
                  </button>
                </div>
              ) : (
                <div className="hor-drop-hint">
                  <FiUpload size={28} />
                  <p>Arrastra la foto del formulario aquí o <strong>haz clic para seleccionar</strong></p>
                  <span>JPG, PNG, WEBP</span>
                </div>
              )}
            </div>
            <input ref={scanFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleScanFile} />
            {scanError && <p className="hor-scan-error">{scanError}</p>}
            <div className="hor-scan-actions">
              <button className="btn btn-secondary" onClick={() => { setScanStep(null); setScanImage(null); setScanError(null); }}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleScan} disabled={!scanImage || scanning}>
                <FiZap size={14} /> {scanning ? 'Escaneando…' : 'Escanear'}
              </button>
            </div>
          </div>
        </div>
      ) : scanStep === 'review' ? (
        <div className="hor-scan-card">
          <div className="hor-form-header">
            <span>Revisar registros extraídos ({scanRows.length})</span>
            <button className="hor-close-btn" onClick={() => setScanStep('upload')}><FiX size={16} /></button>
          </div>
          <div className="hor-scan-body">
            <div className="hor-batch-wrap">
              <table className="hor-batch-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th>Tractor</th>
                    <th>Implemento</th>
                    <th>Hor.Ini</th>
                    <th>Hor.Fin</th>
                    <th>Lote</th>
                    <th>Grupo</th>
                    <th>Labor</th>
                    <th>H.Inicio</th>
                    <th>H.Final</th>
                    <th>Operario</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {scanRows.map((row, idx) => (
                    <tr key={idx} className={!row.tractorId ? 'hor-batch-row-warn' : ''}>
                      <td className="hor-batch-num">{idx + 1}</td>
                      <td>
                        <input type="date" className="hor-batch-input" value={row.fecha || ''} onChange={e => updateScanRow(idx, 'fecha', e.target.value)} />
                      </td>
                      <td>
                        <select className="hor-batch-select" value={row.tractorId || ''} onChange={e => updateScanRow(idx, 'tractorId', e.target.value)}>
                          <option value="">—</option>
                          {tractoresLista.map(t => <option key={t.id} value={t.id}>{t.codigo ? `${t.codigo} — ${t.descripcion}` : t.descripcion}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="hor-batch-select" value={row.implemento || ''} onChange={e => updateScanRow(idx, 'implemento', e.target.value)}>
                          <option value="">—</option>
                          {implementosLista.map(t => <option key={t.id} value={t.descripcion}>{t.codigo ? `${t.codigo} — ${t.descripcion}` : t.descripcion}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" className="hor-batch-input hor-batch-num-input" value={row.horimetroInicial ?? ''} onChange={e => updateScanRow(idx, 'horimetroInicial', e.target.value === '' ? null : parseFloat(e.target.value))} step="0.1" />
                      </td>
                      <td>
                        <input type="number" className="hor-batch-input hor-batch-num-input" value={row.horimetroFinal ?? ''} onChange={e => updateScanRow(idx, 'horimetroFinal', e.target.value === '' ? null : parseFloat(e.target.value))} step="0.1" />
                      </td>
                      <td>
                        <select className="hor-batch-select" value={row.loteId || ''} onChange={e => updateScanRow(idx, 'loteId', e.target.value)}>
                          <option value="">—</option>
                          {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="hor-batch-select" value={row.grupo || ''} onChange={e => updateScanRow(idx, 'grupo', e.target.value)}>
                          <option value="">—</option>
                          {gruposParaFila(row.loteId).map(g => <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="hor-batch-select hor-batch-select-wide" value={row.labor || ''} onChange={e => updateScanRow(idx, 'labor', e.target.value)}>
                          <option value="">—</option>
                          {labores.map(l => <option key={l.id} value={l.descripcion}>{l.codigo ? `${l.codigo} — ${l.descripcion}` : l.descripcion}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="time" className="hor-batch-input" value={row.horaInicio || ''} onChange={e => updateScanRow(idx, 'horaInicio', e.target.value)} />
                      </td>
                      <td>
                        <input type="time" className="hor-batch-input" value={row.horaFinal || ''} onChange={e => updateScanRow(idx, 'horaFinal', e.target.value)} />
                      </td>
                      <td>
                        <select className="hor-batch-select" value={row.operarioId || ''} onChange={e => updateScanRow(idx, 'operarioId', e.target.value)}>
                          <option value="">—</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="hor-btn-icon hor-btn-danger" onClick={() => removeScanRow(idx)} title="Eliminar fila">
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scanError && <p className="hor-scan-error">{scanError}</p>}
            <p className="hor-scan-hint">Las filas en amarillo requieren seleccionar un tractor para guardarse.</p>
            <div className="hor-scan-actions">
              <button className="btn btn-secondary" onClick={() => setScanStep('upload')}>← Volver</button>
              <button className="btn btn-primary" onClick={handleBatchSave} disabled={savingBatch || scanRows.length === 0}>
                <FiCheck size={14} /> {savingBatch ? 'Guardando…' : `Registrar ${scanRows.filter(r => r.tractorId).length} registro(s)`}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="hor-toolbar">
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nuevo
          </button>
        </div>
      )}

      {/* ── Historical table ── */}
      <section className="hor-section">
        <div className="hor-section-header">
          <FiClock size={14} />
          <span>Historial de Registros</span>
          {sorted.length > 0 && <span className="hor-count">{sorted.length}</span>}
          {Object.values(colFilters).some(f => f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())) && (
            <button className="historial-clear-col-filters" onClick={() => setColFilters({})}>
              <FiX size={11} />
              Limpiar filtros de columna
            </button>
          )}
          {showForm && (
            <button className="hor-add-inline" onClick={handleNew} title="Nuevo registro">
              <FiPlus size={13} />
            </button>
          )}
        </div>

        {loading ? (
          <p className="hor-empty">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="hor-empty-state">
            <FiClock size={32} />
            <p>
              {records.length === 0
                ? 'No hay registros aún.'
                : 'Sin resultados para los filtros activos.'}
            </p>
            {records.length === 0 && !showForm && (
              <button className="btn btn-primary" onClick={handleNew}>
                <FiPlus size={14} /> Crear el primero
              </button>
            )}
          </div>
        ) : (
          <div className="hor-table-wrap">
            <table className="hor-table">
              <thead>
                <tr onContextMenu={openColMenu}>
                  {COLUMNS.map(col => hiddenCols.has(col.id) ? null : col.plain
                    ? <th key={col.id}>{col.label}</th>
                    : <SortTh key={col.id} field={col.id} filterType={col.filterType}>{col.label}</SortTh>
                  )}
                  <th className="hor-th-settings">
                    <button
                      className={`hor-col-toggle-btn${hiddenCount > 0 ? ' hor-col-toggle-btn--active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas visibles"
                    >
                      <FiSliders size={12} />
                      {hiddenCount > 0 && <span className="hor-col-hidden-badge">{hiddenCount}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(rec => {
                  const hrs = horasUsadas(rec);
                  return (
                    <tr key={rec.id}>
                      {!hiddenCols.has('fecha')            && <td className="hor-td-date">{rec.fecha || '—'}</td>}
                      {!hiddenCols.has('tractorNombre')    && <td className="hor-td-maq">{rec.tractorNombre || '—'}</td>}
                      {!hiddenCols.has('implemento')       && <td>{rec.implemento || <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('horimetroInicial') && <td className="hor-td-num">{rec.horimetroInicial !== '' && rec.horimetroInicial != null ? rec.horimetroInicial : <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('horimetroFinal')   && <td className="hor-td-num">{rec.horimetroFinal   !== '' && rec.horimetroFinal   != null ? rec.horimetroFinal   : <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('horas')            && <td className={`hor-td-horas${hrs ? '' : ' hor-td-empty'}`}>{hrs ?? '—'}</td>}
                      {!hiddenCols.has('loteNombre')       && <td>{rec.loteNombre || <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('grupo')            && <td>{rec.grupo      || <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('bloque')           && <td>{rec.bloques?.length ? rec.bloques.join(', ') : (rec.bloque || <span className="hor-td-empty">—</span>)}</td>}
                      {!hiddenCols.has('labor')            && <td className="hor-td-labor">{rec.labor || <span className="hor-td-empty">—</span>}</td>}
                      {!hiddenCols.has('horaInicio')       && <td className="hor-td-time">{rec.horaInicio || '—'}</td>}
                      {!hiddenCols.has('horaFinal')        && <td className="hor-td-time">{rec.horaFinal  || '—'}</td>}
                      {!hiddenCols.has('operarioNombre')   && <td>{rec.operarioNombre || <span className="hor-td-empty">—</span>}</td>}
                      <td className="hor-td-actions">
                        <button className="hor-btn-icon" onClick={() => handleEdit(rec)} title="Editar">
                          <FiEdit size={13} />
                        </button>
                        <button className="hor-btn-icon hor-btn-danger" onClick={() => handleDelete(rec.id)} title="Eliminar">
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>

    {filterPopover && createPortal(
      <>
        <div className="historial-filter-backdrop" onClick={() => setFilterPopover(null)} />
        <div
          className={`historial-filter-popover${filterPopover.filterType !== 'text' ? ' historial-filter-popover--range' : ''}`}
          style={{ left: filterPopover.x, top: filterPopover.y }}
        >
          <FiFilter size={13} className="historial-filter-popover-icon" />
          {filterPopover.filterType !== 'text' ? (
            <>
              <div className="historial-filter-range">
                <div className="historial-filter-range-row">
                  <span className="historial-filter-range-label">De</span>
                  <input
                    autoFocus
                    type={filterPopover.filterType}
                    className="historial-filter-input"
                    value={colFilters[filterPopover.field]?.from || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: e.target.value,
                      to: colFilters[filterPopover.field]?.to || '',
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
                <div className="historial-filter-range-row">
                  <span className="historial-filter-range-label">A</span>
                  <input
                    type={filterPopover.filterType}
                    className="historial-filter-input"
                    value={colFilters[filterPopover.field]?.to || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: colFilters[filterPopover.field]?.from || '',
                      to: e.target.value,
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
              </div>
              {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                <button className="historial-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
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
                value={colFilters[filterPopover.field]?.value || ''}
                onChange={e => setColFilter(filterPopover.field, { type: 'text', value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
              />
              {colFilters[filterPopover.field]?.value && (
                <button className="historial-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </>,
      document.body
    )}

    {colMenu && createPortal(
      <>
        <div className="hor-col-menu-backdrop" onClick={() => setColMenu(null)} />
        <div className="hor-col-menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <div className="hor-col-menu-title">Columnas visibles</div>
          {COLUMNS.map(col => (
            <button
              key={col.id}
              className={`hor-col-menu-item${hiddenCols.has(col.id) ? ' is-hidden' : ''}`}
              onClick={() => toggleCol(col.id)}
            >
              <span className="hor-col-menu-check" />
              {col.label}
            </button>
          ))}
          {hiddenCols.size > 0 && (
            <button className="hor-col-menu-reset" onClick={() => { setHiddenCols(new Set()); setColMenu(null); }}>
              Mostrar todas
            </button>
          )}
        </div>
      </>,
      document.body
    )}
    </>
  );
}

export default Horimetro;
