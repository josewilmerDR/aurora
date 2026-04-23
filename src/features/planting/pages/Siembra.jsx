import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { FiPlus, FiTrash2, FiAlertTriangle, FiClock, FiCpu, FiMoreVertical, FiCopy, FiEdit2, FiSettings } from 'react-icons/fi';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/siembra.css';

const HOY = new Date().toISOString().slice(0, 10);

// ── Sort utilities ────────────────────────────────────────────────────────────
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
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Draft persistence ─────────────────────────────────────────────────────────
const DRAFT_LS  = 'aurora_draft_siembra';
const DRAFT_SS  = 'aurora_draftActive_siembra-registro';

function loadDraft()  { try { return JSON.parse(localStorage.getItem(DRAFT_LS)); } catch { return null; } }
function saveDraft(fecha, rows)  {
  try {
    localStorage.setItem(DRAFT_LS, JSON.stringify({ fecha, rows }));
    sessionStorage.setItem(DRAFT_SS, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_LS);
    sessionStorage.removeItem(DRAFT_SS);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
function isDraftMeaningful(fecha, rows) {
  return fecha !== HOY || rows.some(r => r.loteId || r.plantas);
}

const EMPTY_ROW = {
  loteId: '', loteNuevoNombre: '',
  bloque: '', plantas: '', densidad: '65000',
  materialId: '', matNuevoNombre: '', matNuevoRangoPesos: '', matNuevoVariedad: '',
  cerrado: false,
};

// ── Combobox lote ────────────────────────────────────────────────────────────
function LoteCombobox({ value, onChange, lotes }) {
  const nameFor = useCallback((id) => lotes.find(l => l.id === id)?.nombreLote || '', [lotes]);

  const [text, setText]     = useState(() => nameFor(value));
  const [open, setOpen]     = useState(false);
  const [hi,   setHi]       = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef            = useRef(null);
  const listRef             = useRef(null);
  const userTyping          = useRef(false);

  // Sync display text when parent changes value (e.g. form reset)
  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(nameFor(value));
  }, [value, nameFor]);

  const filtered = lotes.filter(l =>
    !text || l.nombreLote.toLowerCase().includes(text.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (lote) => {
    setText(lote.nombreLote);
    setOpen(false);
    setHi(0);
    onChange(lote.id);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
    if (value) onChange('');
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setOpen(false);
        setText(nameFor(value));
      }
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
        className="td-input"
        value={text}
        autoComplete="off"
        placeholder="-- Lote --"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="lote-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`lote-dropdown-item${i === hi ? ' lote-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(l)}
              onMouseEnter={() => setHi(i)}
            >
              {l.nombreLote}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

// ── Modal nuevo material ──────────────────────────────────────────────────────
function NuevoMaterialModal({ initial, onConfirm, onCancel }) {
  const [nombre,   setNombre]   = useState(initial.nombre   || '');
  const [rango,    setRango]    = useState(initial.rango    || '');
  const [variedad, setVariedad] = useState(initial.variedad || '');
  const [saving,   setSaving]   = useState(false);

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm({ nombre: nombre.trim(), rango: rango.trim(), variedad: variedad.trim() });
    setSaving(false);
  };

  return createPortal(
    <div className="param-modal-backdrop">
      <div className="param-modal">
        <div className="param-modal-header">
          <FiPlus size={16} />
          <span>Nuevo material de siembra</span>
        </div>
        <div className="mat-modal-fields">
          <label className="mat-modal-label">
            Nombre <span className="mat-modal-required">*</span>
            <input
              className="mat-modal-input"
              placeholder="Ej: Semilla híbrida X"
              value={nombre}
              maxLength={32}
              onChange={e => setNombre(e.target.value)}
              autoFocus
              disabled={saving}
            />
          </label>
          <label className="mat-modal-label">
            Rango de pesos
            <input
              className="mat-modal-input"
              placeholder="Ej: 200g–300g"
              value={rango}
              maxLength={32}
              onChange={e => setRango(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="mat-modal-label">
            Variedad
            <input
              className="mat-modal-input"
              placeholder="Ej: MD2"
              value={variedad}
              maxLength={32}
              onChange={e => setVariedad(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
          <button
            className="btn btn-primary"
            disabled={!nombre.trim() || saving}
            onClick={handleConfirm}
          >
            {saving ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Close/reopen confirmation modal ──────────────────────────────────────────
function ConfirmCerrarModal({ config, onCancel }) {
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

function Siembra() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const location = useLocation();
  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [fecha, setFecha]           = useState(() => loadDraft()?.fecha || HOY);
  const [rows, setRows]             = useState(() => { const d = loadDraft(); return d?.rows?.length ? d.rows : [{ ...EMPTY_ROW }]; });
  const [draftRestored, setDraftRestored] = useState(() => {
    const d = loadDraft();
    return !!(d && (d.fecha !== HOY || (d.rows || []).some(r => r.loteId || r.plantas)));
  });
  const [registros, setRegistros]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [showForm, setShowForm]     = useState(() => {
    const d = loadDraft();
    return !!(d && (d.fecha !== HOY || (d.rows || []).some(r => r.loteId || r.plantas)));
  });
  const [scanning, setScanning]     = useState(false);
  const [toast, setToast]           = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [matModal, setMatModal]         = useState(null); // { idx, nombre, rango, variedad } | null
  const [sortConfig, setSortConfig] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc'  },
  ]);

  const updateSort = (idx, key, value) =>
    setSortConfig(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));

const fileInputRef                = useRef(null);
  const swipeState                  = useRef({});
  const [rowMenu, setRowMenu]           = useState(null);
  const [histRowMenu, setHistRowMenu]   = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [editRecord, setEditRecord]     = useState(null);
  const [editSaving, setEditSaving]     = useState(false);
  const toggleExpanded = (id) => setExpandedRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [rowMenu]);
  useEffect(() => {
    if (histRowMenu === null) return;
    const close = () => setHistRowMenu(null);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [histRowMenu]);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    if (location.state?.openForm) setShowForm(true);
  }, []);

  useEffect(() => {
    apiFetch('/api/lotes').then(r => r.json()).then(d => setLotes(Array.isArray(d) ? d : [])).catch(console.error);
    apiFetch('/api/materiales-siembra').then(r => r.json()).then(d => setMateriales(Array.isArray(d) ? d : [])).catch(console.error);
    cargarRegistros();
  }, []);

  const cargarRegistros = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/siembras').then(r => r.json());
      setRegistros(Array.isArray(data) ? data : []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  // Open the form automatically when there are no records
  useEffect(() => {
    if (!loading && registros.length === 0) setShowForm(true);
  }, [loading, registros.length]);

  // ── Row helpers ──────────────────────────────────────────────────────────
  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  // ── Swipe gestures en filas del formulario ────────────────────────────────
  const SWIPE_THRESHOLD = 80;
  const getSwipeHandlers = (idx) => ({
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('input, select, button, a')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      swipeState.current[idx] = {
        startX: e.clientX, startY: e.clientY, el: e.currentTarget, dx: 0, locked: false, cancelled: false,
        hintLeft:  e.currentTarget.querySelector('.swipe-hint-left'),
        hintRight: e.currentTarget.querySelector('.swipe-hint-right'),
      };
    },
    onPointerMove(e) {
      const s = swipeState.current[idx];
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
        if (s.hintLeft)  s.hintLeft.style.opacity  = ratio;
        if (s.hintRight) s.hintRight.style.opacity = 0;
      } else {
        s.el.style.background = `rgba(51, 255, 153, ${ratio * 0.18})`;
        if (s.hintRight) s.hintRight.style.opacity = ratio;
        if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
      }
    },
    onPointerUp(e) {
      const s = swipeState.current[idx];
      if (!s) return;
      delete swipeState.current[idx];
      s.el.style.transition = 'transform 0.22s ease, background 0.22s ease';
      s.el.style.transform = 'translateX(0)';
      s.el.style.background = '';
      s.el.style.userSelect = '';
      if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
      if (s.hintRight) s.hintRight.style.opacity = 0;
      if (s.cancelled || !s.locked) return;
      if (s.dx < -SWIPE_THRESHOLD) {
        if (rows.length > 1) removeRow(idx);
        else setRows([{ ...EMPTY_ROW }]);
      } else if (s.dx > SWIPE_THRESHOLD) {
        setRows(prev => { const next = [...prev]; next.splice(idx + 1, 0, { ...prev[idx], bloque: '', cerrado: false }); return next; });
      }
    },
    onPointerCancel(e) {
      const s = swipeState.current[idx];
      if (!s) return;
      delete swipeState.current[idx];
      s.el.style.transition = 'transform 0.22s ease, background 0.22s ease';
      s.el.style.transform = 'translateX(0)';
      s.el.style.background = '';
      s.el.style.userSelect = '';
      if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
      if (s.hintRight) s.hintRight.style.opacity = 0;
    },
  });

  const getHistSwipeHandlers = (r) => ({
    onPointerDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      swipeState.current['h-' + r.id] = {
        startX: e.clientX, startY: e.clientY, el: e.currentTarget, dx: 0, locked: false, cancelled: false,
        hintLeft: null, hintRight: null,
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
        if (s.hintLeft)  s.hintLeft.style.opacity  = ratio;
        if (s.hintRight) s.hintRight.style.opacity = 0;
      } else {
        s.el.style.background = `rgba(51, 255, 153, ${ratio * 0.18})`;
        if (s.hintRight) s.hintRight.style.opacity = ratio;
        if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
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
      if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
      if (s.hintRight) s.hintRight.style.opacity = 0;
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
      if (s.hintLeft)  s.hintLeft.style.opacity  = 0;
      if (s.hintRight) s.hintRight.style.opacity = 0;
    },
  });

  // Verifica si un lote+bloque ya tiene un registro cerrado
  const isBloqueadoCerrado = (loteId, bloque) =>
    bloque.trim() !== '' && registros.some(r => r.loteId === loteId && r.bloque === bloque.trim() && r.cerrado);

  // "Cerrado" checkbox in the form: ask for confirmation before marking
  const handleCerradoChange = (idx, checked) => {
    if (checked) {
      setConfirmModal({
        title: '¿Marcar este bloque como cerrado?',
        body: 'Esto indica que la siembra del bloque está completa y no se podrán agregar nuevos registros. Solo un supervisor puede revertir esta acción.',
        confirmLabel: 'Cerrar bloque',
        onConfirm: () => { updateRow(idx, 'cerrado', true); setConfirmModal(null); },
      });
      return;
    }
    updateRow(idx, 'cerrado', checked);
  };

  const materialFor = (id) => materiales.find(m => m.id === id);

  const rowPlantasInvalid  = (row) => { const v = Number(row.plantas) || 0; return v < 0 || v > 199999; };
  const rowDensidadInvalid = (row) => { const v = Number(row.densidad) || 0; return v < 0 || v > 199999; };

  const areaCalc = (row) => {
    const p = parseInt(row.plantas);
    const d = parseFloat(row.densidad);
    if (!p || !d) return '—';
    return (p / d).toFixed(2) + ' ha';
  };

  // ── Scan physical form with AI ───────────────────────────────────────────
  const handleScanFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setScanning(true);
    try {
      const imageData = await compressImage(file);
      const res = await apiFetch('/api/siembras/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageData.base64, mediaType: imageData.mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error del servidor');

      const newRows = (data.filas || []).map(f => ({
        loteId:           f.loteId || (f.loteNombre ? '__nuevo__' : ''),
        loteNuevoNombre:  f.loteId ? '' : (f.loteNombre || ''),
        bloque:           f.bloque || '',
        plantas:          f.plantas ? String(f.plantas) : '',
        densidad:         f.densidad ? String(f.densidad) : '65000',
        materialId:       f.materialId || (f.materialNombre ? '__nuevo__' : ''),
        matNuevoNombre:   f.materialId ? '' : (f.materialNombre || ''),
        matNuevoRangoPesos: f.materialId ? '' : (f.rangoPesos || ''),
        matNuevoVariedad: f.materialId ? '' : (f.variedad || ''),
        cerrado: false,
      }));

      if (newRows.length > 0) {
        setRows(newRows);
        showToast(`${newRows.length} fila(s) cargadas desde la imagen. Revisa los datos y guarda.`);
      } else {
        showToast('La IA no encontró filas de siembra en la imagen.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Error al escanear el formulario.', 'error');
    } finally {
      setScanning(false);
    }
  };

  // ── Guardar todos los rows ───────────────────────────────────────────────
  const handleGuardar = async () => {
    const validos = rows.filter(r => (r.loteId || r.loteNuevoNombre.trim()) && r.plantas && r.densidad);
    if (!validos.length) {
      showToast('Completa al menos una fila con lote, plantas y densidad.', 'error');
      return;
    }

    // Validar rango de plantas y densidad
    const fueraDeRango = validos.some(r => rowPlantasInvalid(r) || rowDensidadInvalid(r));
    if (fueraDeRango) {
      showToast('Plantas y densidad deben estar entre 0 y 199 999.', 'error');
      return;
    }

    // Validate that no lote+bloque is closed
    for (const row of validos) {
      if (row.loteId && row.loteId !== '__nuevo__' && isBloqueadoCerrado(row.loteId, row.bloque)) {
        const loteNombre = lotes.find(l => l.id === row.loteId)?.nombreLote || row.loteId;
        showToast(
          `El bloque "${row.bloque}" del lote "${loteNombre}" ya está cerrado. Corrija la información antes de guardar.`,
          'error'
        );
        return;
      }
    }

    setSaving(true);
    let errores = 0;

    // Mapas para evitar crear duplicados dentro del mismo guardado
    const createdLoteMap = {};   // nombreLote -> { id, nombreLote }
    const createdMatMap  = {};   // nombreMat   -> { id, nombre, rangoPesos, variedad }

    for (const row of validos) {
      try {
        let loteId = row.loteId;
        let loteNombre = '';

        // Crear nuevo lote si es necesario (solo una vez por nombre)
        if (loteId === '__nuevo__' && row.loteNuevoNombre.trim()) {
          const nombre = row.loteNuevoNombre.trim();
          if (createdLoteMap[nombre]) {
            loteId     = createdLoteMap[nombre].id;
            loteNombre = nombre;
          } else {
            const res = await apiFetch('/api/lotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombreLote: nombre, fechaCreacion: fecha }),
            });
            if (!res.ok) throw new Error('No se pudo crear el lote.');
            const created = await res.json();
            loteId     = created.id;
            loteNombre = nombre;
            createdLoteMap[nombre] = { id: loteId, nombreLote: nombre };
            setLotes(prev => [...prev, { id: loteId, nombreLote: nombre }]);
          }
        } else {
          loteNombre = lotes.find(l => l.id === loteId)?.nombreLote || '';
        }

        // Crear nuevo material si es necesario (solo una vez por nombre)
        let mat = materialFor(row.materialId);
        let materialId = row.materialId || '';
        if (row.materialId === '__nuevo__' && row.matNuevoNombre.trim()) {
          const nombre = row.matNuevoNombre.trim();
          if (createdMatMap[nombre]) {
            mat        = createdMatMap[nombre];
            materialId = mat.id;
          } else {
            const mRes = await apiFetch('/api/materiales-siembra', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nombre,
                rangoPesos: row.matNuevoRangoPesos || '',
                variedad:   row.matNuevoVariedad   || '',
              }),
            });
            if (!mRes.ok) throw new Error('No se pudo crear el material.');
            const mCreated = await mRes.json();
            mat        = { id: mCreated.id, nombre, rangoPesos: row.matNuevoRangoPesos || '', variedad: row.matNuevoVariedad || '' };
            materialId = mCreated.id;
            createdMatMap[nombre] = mat;
            setMateriales(prev => [...prev, mat]);
          }
        }

        await apiFetch('/api/siembras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loteId, loteNombre,
            bloque: row.bloque,
            plantas: parseInt(row.plantas),
            densidad: parseFloat(row.densidad),
            materialId,
            materialNombre: mat?.nombre || '',
            rangoPesos: mat?.rangoPesos || '',
            variedad: mat?.variedad || '',
            cerrado: row.cerrado,
            fecha,
            responsableId: currentUser?.id || '',
            responsableNombre: currentUser?.nombre || '',
          }),
        });
      } catch {
        errores++;
      }
    }

    setSaving(false);
    if (errores > 0) {
      showToast(`${errores} fila(s) no pudieron guardarse.`, 'error');
    } else {
      showToast(`${validos.length} registro(s) guardados correctamente.`);
      setRows([{ ...EMPTY_ROW }]);
      setFecha(HOY);
      setDraftRestored(false);
      clearDraft();
      cargarRegistros();
    }
  };

  // ── Toggle cerrado en registros existentes ───────────────────────────────
  const toggleCerrado = (reg) => {
    const esSupervisor = hasMinRole(currentUser?.rol, 'supervisor');

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

    // Desmarcar cerrado: solo supervisor+
    if (reg.cerrado) {
      if (!esSupervisor) {
        showToast('Solo un supervisor puede reabrir un bloque cerrado.', 'error');
        return;
      }
      setConfirmModal({
        title: `¿Reabrir el bloque "${reg.bloque || '(sin bloque)'}"?`,
        body: `Lote: "${reg.loteNombre}". Se podrán volver a agregar registros de siembra en este bloque.`,
        confirmLabel: 'Reabrir bloque',
        onConfirm: () => doToggle(false),
      });
      return;
    }

    // Mark as closed: ask for confirmation
    setConfirmModal({
      title: `¿Cerrar el bloque "${reg.bloque || '(sin bloque)'}"?`,
      body: `Lote: "${reg.loteNombre}". Esto indica que la siembra del bloque está completa y no se podrán agregar nuevos registros. Solo un supervisor puede revertir esta acción.`,
      confirmLabel: 'Cerrar bloque',
      onConfirm: () => doToggle(true),
    });
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

  const formatFecha = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso.slice(0, 10) + 'T12:00:00');
    const day   = d.getDate().toString().padStart(2, '0');
    const month = d.toLocaleDateString('es-CR', { month: 'short' });
    const year  = String(d.getFullYear()).slice(2);
    return `${day} ${month} ${year}`;
  };

  // ── Draft: save on every change, restore badge on mount ──────────────────
  useEffect(() => {
    if (isDraftMeaningful(fecha, rows)) saveDraft(fecha, rows);
    else clearDraft();
  }, [fecha, rows]);

  const discardDraft = () => {
    setFecha(HOY);
    setRows([{ ...EMPTY_ROW }]);
    setDraftRestored(false);
    clearDraft();
  };

  const handleMatModalConfirm = async ({ nombre, rango, variedad }) => {
    const { idx } = matModal;
    try {
      const res = await apiFetch('/api/materiales-siembra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, rangoPesos: rango, variedad }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      const newMat = { id: created.id, nombre, rangoPesos: rango, variedad };
      setMateriales(prev => [...prev, newMat]);
      setRows(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], materialId: created.id, matNuevoNombre: '', matNuevoRangoPesos: '', matNuevoVariedad: '' };
        return next;
      });
      setMatModal(null);
    } catch {
      showToast('No se pudo crear el material.', 'error');
    }
  };

  const handleMatModalCancel = () => {
    if (!rows[matModal.idx].matNuevoNombre) updateRow(matModal.idx, 'materialId', '');
    setMatModal(null);
  };

  return (
    <div className="siembra-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <ConfirmCerrarModal config={confirmModal} onCancel={() => setConfirmModal(null)} />}
      {matModal && <NuevoMaterialModal initial={matModal} onConfirm={handleMatModalConfirm} onCancel={handleMatModalCancel} />}
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

      {/* ── Barra superior ───────────────────────────────────────────── */}
      <div className="siembra-top-bar">
        <h2 className="siembra-page-title">Registro de siembra</h2>
        <Link to="/siembra/historial" className="btn btn-secondary">
          <FiClock size={14} /> Historial
        </Link>
      </div>

      {/* ── Spinner de carga inicial ──────────────────────────────────── */}
      {loading && <div className="siembra-page-loading" />}


      {/* ── Contenido principal ──────────────────────────────────────── */}
      {!loading && (registros.length > 0 || showForm) && <>

      {draftRestored && (
        <div className="siembra-draft-banner">
          <FiClock size={13} />
          <span>Borrador restaurado — tienes cambios sin guardar.</span>
          <button className="siembra-draft-discard" onClick={() => setDraftRestored(false)}>Cerrar</button>
        </div>
      )}

      {/* ── Formulario de entrada ─────────────────────────────────────── */}
      <div className="form-card siembra-form-card">
        <div className="siembra-header-row">
          <div className="siembra-fecha-group">
            <label htmlFor="fecha">Fecha de siembra</label>
            <div className="siembra-fecha-controls">
              <input id="fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-ia" style={{ alignSelf: 'flex-end', marginLeft: 'auto' }} onClick={() => fileInputRef.current?.click()} disabled={scanning || saving}>
            <FiCpu size={15} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleScanFile}
          />
        </div>

        {/* Tabla de filas */}
        <div className="siembra-table-wrapper">
          <table className="siembra-table siembra-table-entrada">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Bloque</th>
                <th>Plantas</th>
                <th>Densidad<span className="th-hint">(pl/ha)</span></th>
                <th>Área calc.</th>
                <th>Material</th>
                <th className="th-center">Cerrado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const mat = materialFor(row.materialId);
                return (
                  <tr key={idx} {...getSwipeHandlers(idx)}>
                    <td className="swipe-hint swipe-hint-left"  aria-hidden="true"><FiTrash2 size={18} /></td>
                    <td className="swipe-hint swipe-hint-right" aria-hidden="true"><FiCopy   size={18} /></td>
                    {/* Lote */}
                    <td className="td-lote" data-col="lote" data-label="Lote">
                      <LoteCombobox
                        value={row.loteId}
                        onChange={v => updateRow(idx, 'loteId', v)}
                        lotes={lotes}
                      />
                    </td>

                    {/* Bloque */}
                    <td data-col="bloque" data-label="Bloque">
                      <input className="td-input" placeholder="Ej: A" value={row.bloque}
                        maxLength={4}
                        onChange={e => updateRow(idx, 'bloque', e.target.value)} />
                    </td>

                    {/* Plantas */}
                    <td data-col="plantas" data-label="Plantas">
                      <input className={`td-input td-num${rowPlantasInvalid(row) ? ' td-input-error' : ''}`} type="number" min="0" max="199999" placeholder="0"
                        value={row.plantas} onChange={e => updateRow(idx, 'plantas', e.target.value)} />
                      {rowPlantasInvalid(row) && <span className="td-error-hint">0 – 199 999</span>}
                    </td>

                    {/* Densidad */}
                    <td data-col="densidad" data-label="Densidad">
                      <input className={`td-input td-num${rowDensidadInvalid(row) ? ' td-input-error' : ''}`} type="number" min="0" max="199999" placeholder="65000"
                        value={row.densidad} onChange={e => updateRow(idx, 'densidad', e.target.value)} />
                      {rowDensidadInvalid(row) && <span className="td-error-hint">0 – 199 999</span>}
                    </td>

                    {/* Área calculada */}
                    <td className="td-calc" data-col="area" data-label="Área calc.">{areaCalc(row)}</td>

                    {/* Material */}
                    <td className="td-mat" data-col="mat" data-label="Material">
                      <select
                        className="td-select"
                        value={row.materialId}
                        onChange={e => {
                          if (e.target.value === '__nuevo__') {
                            setMatModal({ idx, nombre: '', rango: '', variedad: '' });
                          } else {
                            updateRow(idx, 'materialId', e.target.value);
                          }
                        }}
                      >
                        <option value="">-- Material --</option>
                        {materiales.map(m => {
                          const extra = [m.rangoPesos, m.variedad].filter(Boolean).join(' · ');
                          return <option key={m.id} value={m.id}>{m.nombre}{extra ? ` — ${extra}` : ''}</option>;
                        })}
                        <option value="__nuevo__">＋ Nuevo material</option>
                      </select>
                    </td>

                    {/* Cerrado */}
                    <td className="td-center" data-col="cerrado" data-label="Cerrado">
                      <input type="checkbox" checked={row.cerrado}
                        disabled={!Number(row.plantas)}
                        onChange={e => handleCerradoChange(idx, e.target.checked)} />
                    </td>

                    {/* Acciones de fila */}
                    <td data-col="del">
                      {/* Desktop: duplicar + eliminar */}
                      <div className="row-actions-desktop">
                        <button className="sm-btn-icon" title="Duplicar fila"
                          onClick={() => setRows(prev => { const next = [...prev]; next.splice(idx + 1, 0, { ...prev[idx], bloque: '', cerrado: false }); return next; })}>
                          <FiCopy size={14} />
                        </button>
                        {rows.length > 1 && (
                          <button className="sm-btn-icon sm-btn-danger" title="Eliminar fila" onClick={() => removeRow(idx)}>
                            <FiTrash2 size={14} />
                          </button>
                        )}
                      </div>
                      {/* Mobile: menú ⋮ */}
                      <div className="row-menu-wrap" onPointerDown={e => e.stopPropagation()}>
                        <button className="row-menu-btn" onClick={() => setRowMenu(rowMenu === idx ? null : idx)}>
                          <FiMoreVertical size={16} />
                        </button>
                        {rowMenu === idx && (
                          <div className="row-menu-dropdown">
                            <button className="row-menu-item" onClick={() => { setRows(prev => { const next = [...prev]; next.splice(idx + 1, 0, { ...prev[idx], bloque: '', cerrado: false }); return next; }); setRowMenu(null); }}>
                              <FiCopy size={13} /> Duplicar
                            </button>
                            {rows.length > 1 && (
                              <button className="row-menu-item row-menu-item-danger" onClick={() => { removeRow(idx); setRowMenu(null); }}>
                                <FiTrash2 size={13} /> Eliminar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="siembra-form-actions">
          <button className="btn btn-secondary" onClick={addRow} disabled={scanning}>
            <FiPlus size={15} /> Agregar fila
          </button>
          <button className="btn btn-primary" onClick={handleGuardar} disabled={saving || scanning}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <Link to="/siembra/materiales" className="siembra-materiales-link" style={{ marginLeft: 'auto' }}>
            <FiSettings size={11} />
            Gestionar materiales
          </Link>
        </div>
      </div>

      </>}
    </div>
  );
}

export default Siembra;
