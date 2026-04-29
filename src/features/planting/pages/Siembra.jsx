import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { FiPlus, FiTrash2, FiClock, FiCpu, FiCopy, FiSettings } from 'react-icons/fi';
import { useUser } from '../../../contexts/UserContext';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/siembra.css';
import '../styles/siembra-form.css';

const HOY = new Date().toISOString().slice(0, 10);

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
        className="aur-input psb-lote-input"
        value={text}
        autoComplete="off"
        placeholder="— Lote —"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="psb-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`psb-combo-option${i === hi ? ' psb-combo-option--active' : ''}`}
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
    <div className="aur-modal-backdrop" onPointerDown={() => !saving && onCancel?.()}>
      <div className="aur-modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiPlus size={16} />
          </span>
          <span className="aur-modal-title">Nuevo material de siembra</span>
        </div>
        <div className="psb-mat-modal-fields">
          <label className="psb-mat-modal-label">
            Nombre <span className="psb-required">*</span>
            <input
              className="aur-input"
              placeholder="Ej. Semilla híbrida X"
              value={nombre}
              maxLength={32}
              onChange={e => setNombre(e.target.value)}
              autoFocus
              disabled={saving}
            />
          </label>
          <label className="psb-mat-modal-label">
            Rango de pesos
            <input
              className="aur-input"
              placeholder="Ej. 200g – 300g"
              value={rango}
              maxLength={32}
              onChange={e => setRango(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="psb-mat-modal-label">
            Variedad
            <input
              className="aur-input"
              placeholder="Ej. MD2"
              value={variedad}
              maxLength={32}
              onChange={e => setVariedad(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <div className="aur-modal-actions">
          <button
            type="button"
            className="aur-btn-text"
            onClick={onCancel}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="aur-btn-pill"
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

  const fileInputRef                = useRef(null);
  const swipeState                  = useRef({});

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
        hintLeft:  e.currentTarget.querySelector('.psb-row-hint-left'),
        hintRight: e.currentTarget.querySelector('.psb-row-hint-right'),
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

  // ── Draft: save on every change, restore badge on mount ──────────────────
  useEffect(() => {
    if (isDraftMeaningful(fecha, rows)) saveDraft(fecha, rows);
    else clearDraft();
  }, [fecha, rows]);

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
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmModal && <AuroraConfirmModal {...confirmModal} onCancel={() => setConfirmModal(null)} />}
      {matModal && <NuevoMaterialModal initial={matModal} onConfirm={handleMatModalConfirm} onCancel={handleMatModalCancel} />}

      {/* ── Spinner de carga inicial ──────────────────────────────────── */}
      {loading && <div className="siembra-page-loading" />}

      {!loading && (registros.length > 0 || showForm) && (
        <form
          className="aur-sheet psb-sheet"
          noValidate
          onSubmit={(e) => { e.preventDefault(); handleGuardar(); }}
        >
          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h2 className="aur-sheet-title">Registro de siembra</h2>
            </div>
            <div className="aur-sheet-header-actions">
              <Link to="/siembra/historial" className="aur-chip aur-chip--ghost">
                <FiClock size={12} /> Historial
              </Link>
              <button
                type="button"
                className="aur-chip aur-chip--ai"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning || saving}
                title="Carga una foto del formulario y se extraen las filas."
              >
                <FiCpu size={12} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
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
          </header>

          {draftRestored && (
            <div className="psb-draft-banner">
              <FiClock size={12} />
              <span>Borrador restaurado · tienes cambios sin guardar.</span>
              <button type="button" className="psb-draft-discard" onClick={() => setDraftRestored(false)}>
                Cerrar
              </button>
            </div>
          )}

          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">01</span>
              <h3>Fecha</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="psb-fecha">Fecha de siembra</label>
                <input
                  id="psb-fecha"
                  type="date"
                  className="aur-input"
                  value={fecha}
                  onChange={e => setFecha(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">02</span>
              <h3>Filas de siembra</h3>
              <span className="aur-section-count">{rows.length}</span>
            </div>

            <ul className="psb-row-list">
              {rows.map((row, idx) => (
                <li key={idx} className="psb-row-card" {...getSwipeHandlers(idx)}>
                  <span className="psb-row-hint psb-row-hint-left" aria-hidden="true">
                    <FiTrash2 size={16} />
                  </span>
                  <span className="psb-row-hint psb-row-hint-right" aria-hidden="true">
                    <FiCopy size={16} />
                  </span>

                  <div className="psb-row-head">
                    <div className="psb-row-num">
                      <span className="psb-row-num-val">{idx + 1}</span>
                      <span className="psb-row-num-suffix">fila</span>
                    </div>
                    <div className="psb-row-lote">
                      <LoteCombobox
                        value={row.loteId}
                        onChange={v => updateRow(idx, 'loteId', v)}
                        lotes={lotes}
                      />
                    </div>
                    <div className="psb-row-actions">
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--sm"
                        title="Duplicar fila"
                        onClick={() => setRows(prev => { const next = [...prev]; next.splice(idx + 1, 0, { ...prev[idx], bloque: '', cerrado: false }); return next; })}
                      >
                        <FiCopy size={14} />
                      </button>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          title="Eliminar fila"
                          onClick={() => removeRow(idx)}
                        >
                          <FiTrash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="psb-row-grid">
                    <div className="psb-row-field">
                      <label>Bloque</label>
                      <input
                        className="aur-input"
                        placeholder="A"
                        value={row.bloque}
                        maxLength={4}
                        onChange={e => updateRow(idx, 'bloque', e.target.value)}
                      />
                    </div>
                    <div className="psb-row-field">
                      <label>Plantas</label>
                      <input
                        className={`aur-input aur-input--num${rowPlantasInvalid(row) ? ' aur-input--error' : ''}`}
                        type="number"
                        min="0"
                        max="199999"
                        placeholder="0"
                        value={row.plantas}
                        onChange={e => updateRow(idx, 'plantas', e.target.value)}
                      />
                      {rowPlantasInvalid(row) && <span className="psb-row-error">0 – 199 999</span>}
                    </div>
                    <div className="psb-row-field">
                      <label>Densidad <span className="psb-row-hint-text">pl/ha</span></label>
                      <input
                        className={`aur-input aur-input--num${rowDensidadInvalid(row) ? ' aur-input--error' : ''}`}
                        type="number"
                        min="0"
                        max="199999"
                        placeholder="65000"
                        value={row.densidad}
                        onChange={e => updateRow(idx, 'densidad', e.target.value)}
                      />
                      {rowDensidadInvalid(row) && <span className="psb-row-error">0 – 199 999</span>}
                    </div>
                    <div className="psb-row-field psb-row-field--readonly">
                      <label>Área</label>
                      <div className="psb-row-area">{areaCalc(row)}</div>
                    </div>
                  </div>

                  <div className="psb-row-foot">
                    <select
                      className="aur-select psb-row-mat-select"
                      value={row.materialId}
                      onChange={e => {
                        if (e.target.value === '__nuevo__') {
                          setMatModal({ idx, nombre: '', rango: '', variedad: '' });
                        } else {
                          updateRow(idx, 'materialId', e.target.value);
                        }
                      }}
                      aria-label="Material"
                    >
                      <option value="">Material</option>
                      {materiales.map(m => {
                        const extra = [m.rangoPesos, m.variedad].filter(Boolean).join(' · ');
                        return <option key={m.id} value={m.id}>{m.nombre}{extra ? ` — ${extra}` : ''}</option>;
                      })}
                      <option value="__nuevo__">+ Nuevo material</option>
                    </select>
                    <label
                      className={`aur-toggle${!Number(row.plantas) ? ' aur-toggle--disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={row.cerrado}
                        disabled={!Number(row.plantas)}
                        onChange={e => handleCerradoChange(idx, e.target.checked)}
                      />
                      <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
                      <span className="aur-toggle-label">Cerrado</span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={addRow}
              disabled={scanning}
              className="psb-add-row"
            >
              <FiPlus size={14} />
              Agregar fila
            </button>
          </section>

          <footer className="psb-form-actions">
            <Link to="/siembra/materiales" className="aur-btn-text">
              <FiSettings size={11} /> Gestionar materiales
            </Link>
            <button
              type="submit"
              className="aur-btn-pill"
              disabled={saving || scanning}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </footer>
        </form>
      )}
    </>
  );
}

export default Siembra;
