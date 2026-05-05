import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FiBox, FiTool, FiTruck, FiDroplet, FiPackage,
  FiPlus, FiEdit2, FiTrash2, FiArrowUp, FiArrowDown,
  FiX, FiAlertTriangle, FiList, FiArchive, FiPaperclip,
  FiFilter, FiSliders,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/bodega-generica.css';

// ── Icon map ──────────────────────────────────────────────────────────────────
const ICON_MAP = { FiBox, FiTool, FiTruck, FiDroplet, FiPackage };
const BodegaIcon = ({ iconKey, size = 20 }) => {
  const Icon = ICON_MAP[iconKey] || FiBox;
  return <Icon size={size} />;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString('es', { maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const EMPTY_ITEM     = { nombre: '', unidad: '', stockActual: '', stockMinimo: '', descripcion: '', total: '', moneda: 'CRC' };
const EMPTY_MOV      = { itemId: '', tipo: 'salida', cantidad: '', nota: '', loteId: '', laborId: '', activoId: '', operarioId: '' };
const EMPTY_ENTRADA  = { itemId: '', tipo: 'entrada', cantidad: '', factura: '', oc: '', total: '' };

const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    resolve({ base64: dataUrl.split(',')[1], mediaType: file.type });
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// ── Opciones predefinidas de unidad ──────────────────────────────────────────
const UNIDAD_OPTIONS = [
  'litros', 'galones', 'kg', 'gramos', 'libras', 'unidades',
  'metros', 'pies', 'pulgadas', 'rollos', 'cajas', 'sacos',
  'toneladas', 'quintales', 'bolsas', 'pares', 'juegos',
];

// ── Combobox unidad ──────────────────────────────────────────────────────────
function UnidadCombobox({ value, onChange }) {
  const [text, setText]       = useState(value || '');
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(value || '');
  }, [value]);

  const filtered = useMemo(() =>
    UNIDAD_OPTIONS.filter(u =>
      !text || u.toLowerCase().includes(text.toLowerCase())
    ), [text]);

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (u) => {
    setText(u);
    setOpen(false);
    setHi(0);
    onChange(u);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
    onChange(e.target.value);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) setOpen(false);
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="aur-input"
        value={text}
        autoComplete="off"
        placeholder="Ej: litros, kg, unidades"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="bg-unidad-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((u, i) => (
            <li
              key={u}
              className={`bg-unidad-dropdown-item${i === hi ? ' bg-unidad-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHi(i)}
            >
              {u}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

// ── Columnas de movimientos ───────────────────────────────────────────────────
const MOV_COLUMNS = [
  { key: 'fecha',       label: 'Fecha',           type: 'date'   },
  { key: 'producto',    label: 'Producto',        type: 'text'   },
  { key: 'tipo',        label: 'Tipo',            type: 'text'   },
  { key: 'cantidad',    label: 'Cantidad',        type: 'number', align: 'right' },
  { key: 'stockAntes',  label: 'Stock anterior',  type: 'number', align: 'right' },
  { key: 'stockDesp',   label: 'Stock resultante',type: 'number', align: 'right' },
  { key: 'factura',     label: 'Factura',         type: 'text'   },
  { key: 'oc',          label: 'OC',              type: 'text'   },
  { key: 'total',       label: 'Total',           type: 'number', align: 'right' },
  { key: 'totalSalida', label: 'Total salida',    type: 'number', align: 'right' },
  { key: 'activo',      label: 'Activo',          type: 'text'   },
  { key: 'operario',    label: 'Operario',        type: 'text'   },
  { key: 'lote',        label: 'Lote',            type: 'text'   },
  { key: 'labor',       label: 'Labor',           type: 'text'   },
  { key: 'nota',        label: 'Nota',            type: 'text'   },
];
const ALL_MOV_COLS = Object.fromEntries(MOV_COLUMNS.map(c => [c.key, true]));

function getMovVal(m, key) {
  switch (key) {
    case 'fecha':       return m.timestamp?.slice?.(0, 10) || m.timestamp || '';
    case 'producto':    return (m.itemNombre || '').toLowerCase();
    case 'tipo':        return (m.tipo || '').toLowerCase();
    case 'cantidad':    return m.cantidad || 0;
    case 'stockAntes':  return m.stockAntes || 0;
    case 'stockDesp':   return m.stockDespues || 0;
    case 'factura':     return (m.factura || '').toLowerCase();
    case 'oc':          return (m.oc || '').toLowerCase();
    case 'total':       return m.total ?? 0;
    case 'totalSalida': return m.totalSalida ?? 0;
    case 'activo':      return (m.activoNombre || '').toLowerCase();
    case 'operario':    return (m.operarioNombre || '').toLowerCase();
    case 'lote':        return (m.loteNombre || '').toLowerCase();
    case 'labor':       return (m.laborNombre || '').toLowerCase();
    case 'nota':        return (m.nota || '').toLowerCase();
    default:            return '';
  }
}

// ── ColMenu movimientos ──────────────────────────────────────────────────────
function MovColMenu({ x, y, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) onClose(); };
    const onKey  = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return createPortal(
    <div ref={menuRef} className="bgm-col-menu" style={{ position: 'fixed', top: y, left: x }}>
      <div className="bgm-col-menu-title">Columnas visibles</div>
      {MOV_COLUMNS.map(col => {
        const checked = visibleCols[col.key];
        const isLast  = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label key={col.key} className={`bgm-col-menu-item${isLast ? ' bgm-col-menu-item--disabled' : ''}`}>
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

function BodegaCombustibles() {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();

  const [bodega,   setBodega]   = useState(null);
  const [items,    setItems]    = useState([]);
  const [movs,     setMovs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState('existencias');

  const bodegaId = bodega?.id;

  // Datos para selects del formulario de movimientos
  const [lotes,      setLotes]      = useState([]);
  const [usuarios,   setUsuarios]   = useState([]);
  const [fichas,     setFichas]     = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [labores,    setLabores]    = useState([]);

  // Modals
  const [itemModal,  setItemModal]  = useState(null);  // null | {mode:'create'|'edit', data}
  const [movModal,   setMovModal]   = useState(null);  // null | {itemId, tipo:'entrada'|'salida'}
  const [confirmDel, setConfirmDel] = useState(null);  // null | {type:'item'|'mov', id, label}

  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // ── Movimientos: sort / filter / column visibility ────────────────────────
  const [movSortField, setMovSortField] = useState('fecha');
  const [movSortDir,   setMovSortDir]   = useState('desc');
  const [movColFilters, setMovColFilters] = useState({});
  const [movFilterPop,  setMovFilterPop]  = useState(null);
  const [movVisibleCols, setMovVisibleCols] = useState(ALL_MOV_COLS);
  const [movColMenu,     setMovColMenu]     = useState(null);

  const handleMovSort = (field) => {
    if (movSortField !== field) { setMovSortField(field); setMovSortDir('desc'); }
    else if (movSortDir === 'desc') { setMovSortDir('asc'); }
    else { setMovSortField(null); setMovSortDir(null); }
  };

  const openMovFilter = (e, field, type) => {
    e.stopPropagation();
    if (movFilterPop?.field === field) { setMovFilterPop(null); return; }
    const rect = (e.currentTarget.closest('th') ?? e.currentTarget).getBoundingClientRect();
    setMovFilterPop({ field, type, x: rect.left, y: rect.bottom + 4 });
  };

  const setMovColFilter = (field, type, key, val) => {
    setMovColFilters(prev => {
      const cur = prev[field] || (type === 'text' ? { text: '' } : { from: '', to: '' });
      const updated = { ...cur, [key]: val };
      const isEmpty = type === 'text' ? !updated.text : !updated.from && !updated.to;
      if (isEmpty) { const { [field]: _, ...rest } = prev; return rest; }
      return { ...prev, [field]: updated };
    });
  };

  const toggleMovCol = (key) => setMovVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  const handleMovColBtn = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMovColMenu({ x: r.right - 185, y: r.bottom + 4 });
  };

  const MovSortTh = ({ col, children }) => {
    const isSort  = movSortField === col.key;
    const hasFilt = !!movColFilters[col.key];
    if (!movVisibleCols[col.key]) return null;
    return (
      <th
        className={`bgm-th-sortable${isSort ? ' is-sorted' : ''}${hasFilt ? ' has-col-filter' : ''}${col.align === 'right' ? ' text-right' : ''}`}
        onClick={() => handleMovSort(col.key)}
      >
        <span className="bgm-th-content">
          {children}
          <span className="bgm-th-arrow">{isSort ? (movSortDir === 'desc' ? '↓' : '↑') : '↕'}</span>
          <span
            className={`bgm-th-funnel${hasFilt ? ' is-active' : ''}`}
            onClick={e => openMovFilter(e, col.key, col.type)}
            title="Filtrar columna"
          >
            <FiFilter size={10} />
          </span>
        </span>
      </th>
    );
  };

  const displayMovs = useMemo(() => {
    let data = [...movs];
    // filters
    const active = Object.entries(movColFilters).filter(([, fv]) =>
      fv.text !== undefined ? fv.text.trim() : fv.from || fv.to
    );
    if (active.length) {
      data = data.filter(r => {
        for (const [key, fv] of active) {
          const col = MOV_COLUMNS.find(c => c.key === key);
          if (!col) continue;
          const val = getMovVal(r, key);
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
    // sort
    if (movSortField && movSortDir) {
      data.sort((a, b) => {
        const av = getMovVal(a, movSortField);
        const bv = getMovVal(b, movSortField);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return movSortDir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [movs, movColFilters, movSortField, movSortDir]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = () => {
    setLoading(true);
    return apiFetch('/api/bodegas').then(r => r.json())
      .then(async (bodegas) => {
        const b = Array.isArray(bodegas) ? bodegas.find(x => x.tipo === 'combustibles') : null;
        if (!b) { navigate('/'); return; }
        setBodega(b);
        const [itemsData, lotesData, usuariosData, fichasData, maquinariaData, laboresData] =
          await Promise.all([
            apiFetch(`/api/bodegas/${b.id}/items`).then(r => r.json()),
            apiFetch('/api/lotes').then(r => r.json()),
            apiFetch('/api/users').then(r => r.json()),
            apiFetch('/api/hr/fichas').then(r => r.json()),
            apiFetch('/api/maquinaria').then(r => r.json()),
            apiFetch('/api/labores').then(r => r.json()),
          ]);
        setItems(Array.isArray(itemsData) ? itemsData : []);
        setLotes(Array.isArray(lotesData) ? lotesData : []);
        setUsuarios(Array.isArray(usuariosData) ? usuariosData : []);
        setFichas(Array.isArray(fichasData) ? fichasData : []);
        setMaquinaria(Array.isArray(maquinariaData) ? maquinariaData : []);
        setLabores(Array.isArray(laboresData) ? laboresData : []);
      })
      .catch(() => showToast('Error al cargar datos.', 'error'))
      .finally(() => setLoading(false));
  };

  const fetchMovs = () => {
    if (!bodegaId) return Promise.resolve();
    return apiFetch(`/api/bodegas/${bodegaId}/movimientos`)
      .then(r => r.json())
      .then(setMovs)
      .catch(() => showToast('Error al cargar movimientos.', 'error'));
  };

  useEffect(() => { fetchAll(); }, []);
  useEffect(() => { if (tab === 'movimientos' && bodegaId) fetchMovs(); }, [tab, bodegaId]);

  // ── Item CRUD ─────────────────────────────────────────────────────────────
  const handleSaveItem = async () => {
    const { mode, data } = itemModal;
    if (!data.nombre?.trim()) { showToast('El nombre es requerido.', 'error'); return; }
    if (data.nombre.trim().length > 200) { showToast('Nombre demasiado largo (máx 200).', 'error'); return; }
    if (data.descripcion && data.descripcion.length > 500) { showToast('Descripción demasiado larga (máx 500).', 'error'); return; }
    if (data.unidad && data.unidad.length > 50) { showToast('Unidad demasiado larga (máx 50).', 'error'); return; }
    const stockAct = parseFloat(data.stockActual);
    const stockMin = parseFloat(data.stockMinimo);
    const totalVal = data.total !== '' && data.total !== undefined ? parseFloat(data.total) : null;
    if (data.stockActual !== '' && (isNaN(stockAct) || stockAct < 0)) { showToast('Stock actual debe ser un número ≥ 0.', 'error'); return; }
    if (data.stockMinimo !== '' && (isNaN(stockMin) || stockMin < 0)) { showToast('Stock mínimo debe ser un número ≥ 0.', 'error'); return; }
    if (totalVal !== null && (isNaN(totalVal) || totalVal < 0)) { showToast('Total debe ser un número ≥ 0.', 'error'); return; }
    setSaving(true);
    try {
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const url = mode === 'edit'
        ? `/api/bodegas/${bodegaId}/items/${data.id}`
        : `/api/bodegas/${bodegaId}/items`;
      const res = await apiFetch(url, { method, body: JSON.stringify(data) });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast(mode === 'edit' ? 'Producto actualizado.' : 'Producto agregado.');
      setItemModal(null);
      await fetchAll();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = async (id) => {
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/items/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Producto eliminado.');
      await fetchAll();
    } catch {
      showToast('Error de conexión.', 'error');
    }
  };

  // ── Movimientos ───────────────────────────────────────────────────────────
  const [movForm,     setMovForm]     = useState(EMPTY_MOV);
  const [entradaForm, setEntradaForm] = useState(EMPTY_ENTRADA);
  const [facturaFile, setFacturaFile] = useState(null);

  const openMovModal = (itemId, tipo) => {
    // Reset both forms to prevent stale data leaking between modals
    setEntradaForm({ ...EMPTY_ENTRADA, itemId });
    setMovForm({ ...EMPTY_MOV, itemId });
    setFacturaFile(null);
    setMovModal({ itemId, tipo });
  };

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  const handleSaveEntrada = async () => {
    const cantNum = parseFloat(entradaForm.cantidad);
    if (!entradaForm.cantidad || isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      showToast('La cantidad debe ser un número positivo.', 'error');
      return;
    }
    if (entradaForm.factura && entradaForm.factura.length > 100) { showToast('Factura demasiado larga (máx 100).', 'error'); return; }
    if (entradaForm.oc && entradaForm.oc.length > 100) { showToast('OC demasiado larga (máx 100).', 'error'); return; }
    const totalVal = entradaForm.total !== '' && entradaForm.total !== undefined ? parseFloat(entradaForm.total) : null;
    if (totalVal !== null && (isNaN(totalVal) || totalVal < 0 || !isFinite(totalVal))) { showToast('Total debe ser un número ≥ 0.', 'error'); return; }
    if (facturaFile && facturaFile.size > MAX_FILE_SIZE) { showToast('Archivo demasiado grande (máx 5 MB).', 'error'); return; }
    setSaving(true);
    try {
      const payload = { ...entradaForm };
      if (facturaFile) {
        const { base64, mediaType } = await readFileAsBase64(facturaFile);
        payload.imageBase64 = base64;
        payload.mediaType   = mediaType;
      }
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Entrada registrada.');
      setMovModal(null);
      await fetchAll();
      if (tab === 'movimientos') await fetchMovs();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMov = async () => {
    const cantNum = parseFloat(movForm.cantidad);
    if (!movForm.cantidad || isNaN(cantNum) || cantNum <= 0 || !isFinite(cantNum)) {
      showToast('La cantidad debe ser un número positivo.', 'error');
      return;
    }
    if (movForm.nota && movForm.nota.length > 500) { showToast('Nota demasiado larga (máx 500).', 'error'); return; }
    if (!movForm.activoId) {
      showToast('El campo Activo es obligatorio.', 'error');
      return;
    }
    if (!movForm.operarioId) {
      showToast('El campo Operario es obligatorio.', 'error');
      return;
    }
    // Resolver nombres para guardar junto con los IDs
    const loteSeleccionado    = lotes.find(l => l.id === movForm.loteId);
    const laborSeleccionada   = labores.find(l => l.id === movForm.laborId);
    const activoSeleccionado  = maquinaria.find(m => m.id === movForm.activoId);
    const operarioSeleccionado = usuarios.find(u => u.id === movForm.operarioId);
    const payload = {
      ...movForm,
      loteNombre:    loteSeleccionado?.nombreLote || '',
      laborNombre:   laborSeleccionada ? `${laborSeleccionada.codigo ? laborSeleccionada.codigo + ' - ' : ''}${laborSeleccionada.descripcion}` : '',
      activoNombre:  activoSeleccionado?.descripcion || '',
      operarioNombre: operarioSeleccionado?.nombre || '',
    };
    setSaving(true);
    try {
      const res = await apiFetch(`/api/bodegas/${bodegaId}/movimientos`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.message, 'error');
        return;
      }
      showToast('Salida registrada.');
      setMovModal(null);
      await fetchAll();
      if (tab === 'movimientos') await fetchMovs();
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const activeItems = useMemo(() => items.filter(i => i.activo !== false), [items]);
  const lowStock    = useMemo(() => activeItems.filter(i => i.stockActual <= i.stockMinimo && i.stockMinimo > 0), [activeItems]);

  // Empleados = usuarios que tienen ficha registrada, ordenados por nombre
  const empleados = useMemo(() => {
    const fichaIds = new Set(fichas.map(f => f.userId));
    return usuarios
      .filter(u => fichaIds.has(u.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [fichas, usuarios]);

  if (loading) return <div className="aur-page-loading">Cargando bodega...</div>;
  if (!bodega) return null;

  const itemForMov = movModal ? items.find(i => i.id === movModal.itemId) : null;

  return (
    <div className="lm-container">
      {/* ── Header ── */}
      <div className="lm-header">
        <div className="lm-header-left">
          <div className="bg-header-icon">
            <BodegaIcon iconKey={bodega.icono} size={24} />
          </div>
          <div>
            <h2 className="lm-title">{bodega.nombre}</h2>
            {lowStock.length > 0 && (
              <span className="bg-low-alert">
                <FiAlertTriangle size={13} /> {lowStock.length} bajo stock mínimo
              </span>
            )}
          </div>
        </div>
        {tab === 'existencias' && (
          <button className="aur-btn-pill" onClick={() => setItemModal({ mode: 'create', data: { ...EMPTY_ITEM } })}>
            <FiPlus size={16} /> Agregar producto
          </button>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="bg-tabs">
        <button className={`bg-tab${tab === 'existencias' ? ' active' : ''}`} onClick={() => setTab('existencias')}>
          <FiArchive size={15} /> Existencias
        </button>
        <button className={`bg-tab${tab === 'movimientos' ? ' active' : ''}`} onClick={() => setTab('movimientos')}>
          <FiList size={15} /> Movimientos
        </button>
      </div>

      {/* ── Existencias ── */}
      {tab === 'existencias' && (
        activeItems.length === 0 ? (
          <div className="empty-state">
            <FiBox size={36} />
            <p>Sin combustibles registrados</p>
          </div>
        ) : (
          <div className="bg-table-wrap">
            <table className="bg-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Unidad</th>
                  <th className="text-right">Stock actual</th>
                  <th className="text-right">Stock mínimo</th>
                  <th>Moneda</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Precio unitario</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map(item => {
                  const low = item.stockMinimo > 0 && item.stockActual <= item.stockMinimo;
                  return (
                    <tr key={item.id} className={low ? 'bg-row-low' : ''}>
                      <td>
                        <span className="bg-item-name">{item.nombre}</span>
                        {item.descripcion && <span className="bg-item-desc">{item.descripcion}</span>}
                      </td>
                      <td>{item.unidad || '—'}</td>
                      <td className="text-right">
                        <span className={`bg-stock${low ? ' low' : ''}`}>{fmt(item.stockActual)}</span>
                        {low && <FiAlertTriangle size={12} className="bg-warn-icon" />}
                      </td>
                      <td className="text-right">{fmt(item.stockMinimo)}</td>
                      <td>{item.moneda || '—'}</td>
                      <td className="text-right">{item.total != null && item.total !== '' ? fmt(item.total) : '—'}</td>
                      <td className="text-right">
                        {item.total != null && item.total !== '' && item.stockActual > 0
                          ? fmt(item.total / item.stockActual)
                          : '—'}
                      </td>
                      <td>
                        <div className="bg-row-actions">
                          <button className="bg-btn-mov entrada" onClick={() => openMovModal(item.id, 'entrada')} title="Registrar entrada">
                            <FiArrowDown size={14} /> Entrada
                          </button>
                          <button className="bg-btn-mov salida" onClick={() => openMovModal(item.id, 'salida')} title="Registrar salida">
                            <FiArrowUp size={14} /> Salida
                          </button>
                          <button className="ba-btn-icon" onClick={() => setItemModal({ mode: 'edit', data: { ...item } })} title="Editar">
                            <FiEdit2 size={14} />
                          </button>
                          <button className="ba-btn-icon ba-btn-danger" onClick={() => setConfirmDel({ type: 'item', id: item.id, label: item.nombre })} title="Eliminar">
                            <FiTrash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Movimientos ── */}
      {tab === 'movimientos' && (
        movs.length === 0 ? (
          <div className="empty-state">
            <FiList size={36} />
            <p>No hay movimientos registrados aún.</p>
          </div>
        ) : (
          <>
          <div className="bg-table-wrap">
            {Object.keys(movColFilters).length > 0 && (
              <button className="bgm-clear-filters" onClick={() => setMovColFilters({})}>
                <FiX size={11} /> Limpiar filtros
              </button>
            )}
            <table className="bg-table bgm-table">
              <thead>
                <tr>
                  {MOV_COLUMNS.map(col => (
                    <MovSortTh key={col.key} col={col}>{col.label}</MovSortTh>
                  ))}
                  <th className="bgm-th-settings">
                    <button
                      className={`bgm-col-toggle-btn${Object.values(movVisibleCols).some(v => !v) ? ' bgm-col-toggle-btn--active' : ''}`}
                      onClick={handleMovColBtn}
                      title="Personalizar columnas"
                    >
                      <FiSliders size={12} />
                      {Object.values(movVisibleCols).filter(v => !v).length > 0 && (
                        <span className="bgm-col-hidden-badge">{Object.values(movVisibleCols).filter(v => !v).length}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayMovs.map(m => (
                  <tr key={m.id}>
                    {movVisibleCols.fecha      && <td className="bgm-cell-nowrap">{fmtDate(m.timestamp)}</td>}
                    {movVisibleCols.producto   && <td className="bgm-cell-nowrap">{m.itemNombre}</td>}
                    {movVisibleCols.tipo       && (
                      <td className="bgm-cell-nowrap">
                        <span className={`bg-badge ${m.tipo}`}>
                          {m.tipo === 'entrada' ? <FiArrowDown size={12} /> : <FiArrowUp size={12} />}
                          {m.tipo === 'entrada' ? 'Entrada' : 'Salida'}
                        </span>
                      </td>
                    )}
                    {movVisibleCols.cantidad   && <td className="text-right bgm-cell-nowrap">{fmt(m.cantidad)}</td>}
                    {movVisibleCols.stockAntes && <td className="text-right bgm-cell-nowrap">{fmt(m.stockAntes)}</td>}
                    {movVisibleCols.stockDesp  && <td className="text-right bgm-cell-nowrap">{fmt(m.stockDespues)}</td>}
                    {movVisibleCols.factura    && (
                      <td className="bgm-cell-nowrap">
                        {m.facturaUrl
                          ? <a href={m.facturaUrl} target="_blank" rel="noopener noreferrer" className="bg-link">{m.factura || 'Ver'}</a>
                          : (m.factura || '—')}
                      </td>
                    )}
                    {movVisibleCols.oc         && <td className="bgm-cell-nowrap">{m.oc || '—'}</td>}
                    {movVisibleCols.total      && <td className="text-right bgm-cell-nowrap">{m.total != null && m.total !== '' ? fmt(m.total) : '—'}</td>}
                    {movVisibleCols.totalSalida && <td className="text-right bgm-cell-nowrap">{m.totalSalida != null ? fmt(m.totalSalida) : '—'}</td>}
                    {movVisibleCols.activo     && <td className="bgm-cell-nowrap">{m.activoNombre || '—'}</td>}
                    {movVisibleCols.operario   && <td className="bgm-cell-nowrap">{m.operarioNombre || '—'}</td>}
                    {movVisibleCols.lote       && <td className="bgm-cell-nowrap">{m.loteNombre || '—'}</td>}
                    {movVisibleCols.labor      && <td className="bgm-cell-nowrap">{m.laborNombre || '—'}</td>}
                    {movVisibleCols.nota       && <td className="bgm-cell-nowrap">{m.nota || '—'}</td>}
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Filter popover */}
          {movFilterPop && createPortal(
            <>
              <div className="bgm-filter-backdrop" onClick={() => setMovFilterPop(null)} />
              <div className="bgm-filter-popover" style={{ left: movFilterPop.x, top: movFilterPop.y }}>
                {movFilterPop.type === 'text' ? (
                  <>
                    <FiFilter size={13} className="bgm-filter-icon" />
                    <input autoFocus className="bgm-filter-input" placeholder="Filtrar…"
                      value={movColFilters[movFilterPop.field]?.text || ''}
                      onChange={e => setMovColFilter(movFilterPop.field, 'text', 'text', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setMovFilterPop(null); }}
                    />
                    {movColFilters[movFilterPop.field]?.text && (
                      <button className="bgm-filter-clear" onClick={() => { setMovColFilter(movFilterPop.field, 'text', 'text', ''); setMovFilterPop(null); }}>
                        <FiX size={13} />
                      </button>
                    )}
                  </>
                ) : (
                  <div className="bgm-filter-range">
                    <span className="bgm-filter-range-label">De</span>
                    <input className="bgm-filter-input bgm-filter-input-range"
                      type={movFilterPop.type === 'date' ? 'date' : 'number'}
                      value={movColFilters[movFilterPop.field]?.from || ''}
                      onChange={e => setMovColFilter(movFilterPop.field, movFilterPop.type, 'from', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setMovFilterPop(null); }}
                    />
                    <span className="bgm-filter-range-label">A</span>
                    <input className="bgm-filter-input bgm-filter-input-range"
                      type={movFilterPop.type === 'date' ? 'date' : 'number'}
                      value={movColFilters[movFilterPop.field]?.to || ''}
                      onChange={e => setMovColFilter(movFilterPop.field, movFilterPop.type, 'to', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setMovFilterPop(null); }}
                    />
                    {(movColFilters[movFilterPop.field]?.from || movColFilters[movFilterPop.field]?.to) && (
                      <button className="bgm-filter-clear" onClick={() => { setMovColFilter(movFilterPop.field, movFilterPop.type, 'from', ''); setMovColFilter(movFilterPop.field, movFilterPop.type, 'to', ''); setMovFilterPop(null); }}>
                        <FiX size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>,
            document.body
          )}

          {/* Column menu */}
          {movColMenu && (
            <MovColMenu
              x={movColMenu.x} y={movColMenu.y}
              visibleCols={movVisibleCols}
              onToggle={toggleMovCol}
              onClose={() => setMovColMenu(null)}
            />
          )}
          </>
        )
      )}

      {/* ── Modal Ítem ── */}
      {itemModal && (
        <div className="aur-modal-backdrop" onPointerDown={() => setItemModal(null)}>
          <div className="aur-modal aur-modal--wide" onPointerDown={e => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">{itemModal.mode === 'edit' ? 'Editar producto' : 'Agregar producto'}</h2>
              <button className="aur-icon-btn aur-icon-btn--sm aur-modal-close" onClick={() => setItemModal(null)}><FiX size={16} /></button>
            </header>
            <div className="aur-modal-content">
              <div className="aur-field">
                <label className="aur-field-label">Nombre</label>
                <input
                  className="aur-input"
                  value={itemModal.data.nombre}
                  onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, nombre: e.target.value } }))}
                  placeholder="Ej: Diesel"
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div className="bg-form-row">
                <div className="aur-field">
                  <label className="aur-field-label">Unidad</label>
                  <UnidadCombobox
                    value={itemModal.data.unidad}
                    onChange={v => setItemModal(m => ({ ...m, data: { ...m.data, unidad: v } }))}
                  />
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">Stock actual</label>
                  <input
                    className="aur-input"
                    type="number"
                    min="0"
                    value={itemModal.data.stockActual}
                    onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockActual: e.target.value } }))}
                    placeholder="0"
                  />
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">Stock mínimo</label>
                  <input
                    className="aur-input"
                    type="number"
                    min="0"
                    value={itemModal.data.stockMinimo}
                    onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, stockMinimo: e.target.value } }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="aur-field">
                <label className="aur-field-label">Moneda</label>
                <select
                  className="aur-select"
                  value={itemModal.data.moneda || 'CRC'}
                  onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, moneda: e.target.value } }))}
                >
                  <option value="USD">USD</option>
                  <option value="CRC">CRC</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div className="aur-field">
                <label className="aur-field-label">Total (valor inventario)</label>
                <input
                  className="aur-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={itemModal.data.total}
                  onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, total: e.target.value } }))}
                  placeholder="0.00"
                />
              </div>
              <div className="aur-field">
                <label className="aur-field-label">Descripción <span className="aur-field-hint">(opcional)</span></label>
                <input
                  className="aur-input"
                  value={itemModal.data.descripcion}
                  onChange={e => setItemModal(m => ({ ...m, data: { ...m.data, descripcion: e.target.value } }))}
                  placeholder="Notas adicionales"
                  maxLength={500}
                />
              </div>
            </div>
            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={() => setItemModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveItem} disabled={saving}>
                {saving ? 'Guardando…' : (itemModal.mode === 'edit' ? 'Guardar' : 'Agregar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Entrada ── */}
      {movModal?.tipo === 'entrada' && (
        <div className="aur-modal-backdrop" onPointerDown={() => setMovModal(null)}>
          <div className="aur-modal" onPointerDown={e => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">
                <FiArrowDown size={16} /> Registrar Entrada
                {itemForMov && <span className="bg-modal-item"> — {itemForMov.nombre}</span>}
              </h2>
              <button className="aur-icon-btn aur-icon-btn--sm aur-modal-close" onClick={() => setMovModal(null)}><FiX size={16} /></button>
            </header>
            <div className="aur-modal-content">
              <div className="bg-form-row">
                <div className="aur-field">
                  <label className="aur-field-label">Factura</label>
                  <input
                    className="aur-input"
                    value={entradaForm.factura}
                    onChange={e => setEntradaForm(f => ({ ...f, factura: e.target.value }))}
                    placeholder="Nº de factura"
                    maxLength={100}
                    autoFocus
                  />
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">OC</label>
                  <input
                    className="aur-input"
                    value={entradaForm.oc}
                    onChange={e => setEntradaForm(f => ({ ...f, oc: e.target.value }))}
                    placeholder="Orden de compra"
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="bg-form-row">
                <div className="aur-field">
                  <label className="aur-field-label">
                    Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''}
                  </label>
                  <input
                    className="aur-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={entradaForm.cantidad}
                    onChange={e => setEntradaForm(f => ({ ...f, cantidad: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">Total</label>
                  <input
                    className="aur-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={entradaForm.total}
                    onChange={e => setEntradaForm(f => ({ ...f, total: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              {itemForMov && (
                <p className="bg-stock-hint">
                  Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
                </p>
              )}
              <div className="aur-field">
                <label className="aur-field-label">Adjuntar factura</label>
                <label className="bg-file-label">
                  <FiPaperclip size={15} />
                  {facturaFile ? facturaFile.name : 'Seleccionar archivo…'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    style={{ display: 'none' }}
                    onChange={e => setFacturaFile(e.target.files[0] || null)}
                  />
                </label>
                {facturaFile && (
                  <button
                    className="bg-file-clear"
                    type="button"
                    onClick={() => setFacturaFile(null)}
                  >
                    <FiX size={13} /> Quitar archivo
                  </button>
                )}
              </div>
            </div>
            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveEntrada} disabled={saving}>
                {saving ? 'Guardando…' : 'Registrar entrada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Salida ── */}
      {movModal?.tipo === 'salida' && (
        <div className="aur-modal-backdrop" onPointerDown={() => setMovModal(null)}>
          <div className="aur-modal" onPointerDown={e => e.stopPropagation()}>
            <header className="aur-modal-header">
              <h2 className="aur-modal-title">
                <FiArrowUp size={16} /> Registrar Salida
                {itemForMov && <span className="bg-modal-item"> — {itemForMov.nombre}</span>}
              </h2>
              <button className="aur-icon-btn aur-icon-btn--sm aur-modal-close" onClick={() => setMovModal(null)}><FiX size={16} /></button>
            </header>
            <div className="aur-modal-content">
              <div className="aur-field">
                <label className="aur-field-label">
                  Cantidad{itemForMov?.unidad ? ` (${itemForMov.unidad})` : ''}
                </label>
                <input
                  className="aur-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={movForm.cantidad}
                  onChange={e => setMovForm(f => ({ ...f, cantidad: e.target.value }))}
                  placeholder="0"
                  autoFocus
                />
              </div>
              {itemForMov && (
                <p className="bg-stock-hint">
                  Stock actual: <strong>{fmt(itemForMov.stockActual)} {itemForMov.unidad}</strong>
                </p>
              )}

              <div className="bg-form-row">
                <div className="aur-field">
                  <label className="aur-field-label">Activo</label>
                  <select
                    className="aur-select"
                    value={movForm.activoId}
                    onChange={e => setMovForm(f => ({ ...f, activoId: e.target.value }))}
                  >
                    <option value="">— Seleccionar —</option>
                    {maquinaria
                      .filter(m => m.tipo?.toUpperCase() !== 'IMPLEMENTO')
                      .map(m => (
                        <option key={m.id} value={m.id}>
                          {m.codigo ? `${m.codigo} - ` : ''}{m.descripcion}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">Operario</label>
                  <select
                    className="aur-select"
                    value={movForm.operarioId}
                    onChange={e => setMovForm(f => ({ ...f, operarioId: e.target.value }))}
                  >
                    <option value="">— Seleccionar —</option>
                    {empleados.map(u => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-form-row">
                <div className="aur-field">
                  <label className="aur-field-label">Lote</label>
                  <select
                    className="aur-select"
                    value={movForm.loteId}
                    onChange={e => setMovForm(f => ({ ...f, loteId: e.target.value }))}
                  >
                    <option value="">— Ninguno —</option>
                    {lotes.map(l => (
                      <option key={l.id} value={l.id}>{l.nombreLote}</option>
                    ))}
                  </select>
                </div>
                <div className="aur-field">
                  <label className="aur-field-label">Labor</label>
                  <select
                    className="aur-select"
                    value={movForm.laborId}
                    onChange={e => setMovForm(f => ({ ...f, laborId: e.target.value }))}
                  >
                    <option value="">— Ninguna —</option>
                    {labores.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.codigo ? `${l.codigo} - ` : ''}{l.descripcion}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="aur-field">
                <label className="aur-field-label">Nota <span className="aur-field-hint">(opcional)</span></label>
                <input
                  className="aur-input"
                  value={movForm.nota}
                  onChange={e => setMovForm(f => ({ ...f, nota: e.target.value }))}
                  placeholder="Motivo, proveedor, etc."
                  maxLength={500}
                />
              </div>
            </div>
            <div className="aur-modal-actions">
              <button className="aur-btn-text" onClick={() => setMovModal(null)} disabled={saving}>Cancelar</button>
              <button className="aur-btn-pill" onClick={handleSaveMov} disabled={saving}>
                {saving ? 'Guardando…' : 'Registrar salida'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <AuroraConfirmModal
          danger
          title="Eliminar producto"
          body={`¿Eliminar "${confirmDel.label}"? Solo es posible si no tiene movimientos registrados.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDeleteItem(confirmDel.id); setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default BodegaCombustibles;
