import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, Link } from 'react-router-dom';
import {
  FiClock, FiPlus, FiX, FiCheck,
  FiCamera, FiUpload, FiCpu, FiSearch,
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
  diaSiguiente: false,
  operarioId: '',
  operarioNombre: '',
};

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

// ── Combobox operario ─────────────────────────────────────────────────────────
function OperarioCombobox({ value, onChange, usuarios }) {
  const nameFor = useCallback((id) => usuarios.find(u => u.id === id)?.nombre || '', [usuarios]);

  const [text, setText]       = useState(() => nameFor(value));
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(nameFor(value));
  }, [value, nameFor]);

  const filtered = usuarios.filter(u =>
    !text || u.nombre.toLowerCase().includes(text.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (u) => {
    setText(u.nombre);
    setOpen(false);
    setHi(0);
    onChange(u.id);
  };

  const handleTextChange = (e) => {
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
        value={text}
        autoComplete="off"
        placeholder="— Seleccionar —"
        onChange={handleTextChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="hor-combobox-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((u, i) => (
            <li
              key={u.id}
              className={`hor-combobox-item${i === hi ? ' hor-combobox-item--active' : ''}`}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHi(i)}
            >
              {u.nombre}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

function RegistroHorimetro() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const location = useLocation();

  // Labor combobox
  const laborRef = useRef(null);
  const [laborQuery, setLaborQuery] = useState('');
  const [laborOpen, setLaborOpen] = useState(false);
  const timeDropdownRef = useRef(null);
  const clockBtnRefs   = useRef({});
  const [timeDropdown, setTimeDropdown] = useState(null);
  const [dropdownPos,  setDropdownPos]  = useState({ top: 0, right: 0 });

  // Scan state
  const scanFileRef = useRef(null);
  const [scanStep, setScanStep] = useState(null);
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
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Form — always open on mount (restore draft fields if present)
  const _draft = loadDraft();
  const [showForm, setShowForm]   = useState(true);
  const [form, setForm]           = useState(_draft?.form     ?? EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(_draft?.isEditing ?? false);
  const [saving, setSaving]       = useState(false);

  const [rangeConfirm,      setRangeConfirm]      = useState(null);
  const [horimetroConfirm,  setHorimetroConfirm]  = useState(null);
  const [lastHorimetroFinal, setLastHorimetroFinal] = useState(null);
  const [pendingLines,      setPendingLines]      = useState([]);

  const fetchRecords = () =>
    apiFetch('/api/horimetro')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => {});

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
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setLabores(Array.isArray(laboresData) ? laboresData : []);
    }).catch(() => {});
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
  }, [location.state?.horimetroDraft]);

  // Pre-fill from Historial "Editar" button
  useEffect(() => {
    const rec = location.state?.editRecord;
    if (!rec) return;
    window.history.replaceState({}, '');
    const editForm = { ...EMPTY_FORM, ...rec };
    saveDraft(editForm, true);
    setForm(editForm);
    setIsEditing(true);
    setShowForm(true);
  }, [location.state?.editRecord]);

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

  // Close time dropdown on outside click
  useEffect(() => {
    if (!timeDropdown) return;
    const handler = (e) => {
      const inDropdown = timeDropdownRef.current?.contains(e.target);
      const inBtn = Object.values(clockBtnRefs.current).some(r => r?.contains(e.target));
      if (!inDropdown && !inBtn) setTimeDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [timeDropdown]);

  const getLastHorimetroFinal = (tractorId) => {
    if (!tractorId) return null;
    const tRecords = records
      .filter(r => r.tractorId === tractorId && r.horimetroFinal != null && r.horimetroFinal !== '')
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    if (!tRecords.length) return null;
    const val = parseFloat(tRecords[0].horimetroFinal);
    return isNaN(val) ? null : val;
  };

  const handleChange = (e) => {
    const { name } = e.target;
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    let autoLastFinal = undefined;
    if (name === 'tractorId' && !isEditing) {
      autoLastFinal = value ? getLastHorimetroFinal(value) : null;
      setLastHorimetroFinal(autoLastFinal);
    }
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'tractorId') {
        const t = tractores.find(x => x.id === value);
        next.tractorNombre = t ? t.descripcion : '';
        if (!isEditing && autoLastFinal != null) {
          next.horimetroInicial = String(autoLastFinal);
          next.horimetroFinal   = String(autoLastFinal);
        }
      }
      if (name === 'horimetroInicial') {
        if (!prev.horimetroFinal || prev.horimetroFinal === prev.horimetroInicial) {
          next.horimetroFinal = value;
        }
      }
      if (name === 'horaInicio') {
        if (!prev.horaFinal || prev.horaFinal === prev.horaInicio) {
          next.horaFinal = value;
        }
      }
      if (name === 'horaInicio' || name === 'horaFinal') {
        const ini = name === 'horaInicio' ? value : next.horaInicio;
        const fin = name === 'horaFinal'  ? value : next.horaFinal;
        if (ini && fin && fin < ini) next.diaSiguiente = true;
      }
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.grupo = '';
        next.bloques = [];
      }
      if (name === 'grupo') {
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

  const handleOperarioChange = (id) => {
    setForm(prev => {
      const u = usuarios.find(x => x.id === id);
      const next = { ...prev, operarioId: id, operarioNombre: u ? u.nombre : '' };
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
    setPendingLines([]);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      if (isEditing) {
        const res = await apiFetch(`/api/horimetro/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error();
        showToast('Registro actualizado.');
      } else {
        const allLines = [...pendingLines, form];
        for (const line of allLines) {
          const res = await apiFetch('/api/horimetro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(line),
          });
          if (!res.ok) throw new Error();
        }
        showToast(allLines.length > 1 ? `${allLines.length} registros guardados.` : 'Registro guardado.');
      }
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
      const rawDiff  = (hF * 60 + mF) - (hI * 60 + mI);
      const diffMin  = form.diaSiguiente && rawDiff <= 0 ? rawDiff + 24 * 60 : rawDiff;
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
    if (!isNaN(ini) && !isNaN(fin) && ini > fin) {
      showToast('El horímetro inicial no puede ser mayor que el final.', 'error');
      return;
    }
    if (!isNaN(ini) && !isNaN(fin) && ini === fin) {
      setRangeConfirm({
        title: 'Horímetro sin variación',
        message: `El horímetro inicial y final son iguales (${ini}). Esto puede indicar que el activo no operó (ej. mantenimiento). ¿Desea continuar?`,
        onConfirm: () => { setRangeConfirm(null); checkMismatchAndSave(); },
      });
      return;
    }
    if (form.horaInicio && form.horaFinal && form.horaInicio >= form.horaFinal && !form.diaSiguiente) {
      showToast('La hora de inicio debe ser menor que la hora final.', 'error');
      return;
    }
    if (!isNaN(ini) && !isNaN(fin) && (fin - ini) > 12) {
      setRangeConfirm({
        title: 'Rango inusual de horímetro',
        message: `El rango del horímetro es de ${(fin - ini).toFixed(1)} h. ¿Es correcto?`,
        onConfirm: () => { setRangeConfirm(null); checkMismatchAndSave(); },
      });
      return;
    }
    checkMismatchAndSave();
  };

  const checkMismatchAndSave = () => {
    const ini = parseFloat(form.horimetroInicial);
    if (!isEditing && lastHorimetroFinal !== null && !isNaN(ini) && ini !== lastHorimetroFinal) {
      setHorimetroConfirm({
        onConfirm: () => { setHorimetroConfirm(null); checkHoraAndSave(); },
      });
      return;
    }
    checkHoraAndSave();
  };

  const handleAddLine = () => {
    if (!form.fecha || !form.tractorId) {
      showToast('Fecha y tractor son obligatorios.', 'error');
      return;
    }
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    if (!isNaN(ini) && !isNaN(fin) && ini > fin) {
      showToast('El horímetro inicial no puede ser mayor que el final.', 'error');
      return;
    }
    setPendingLines(prev => [...prev, { ...form }]);
    setForm(prev => ({
      ...EMPTY_FORM,
      fecha:           prev.fecha,
      tractorId:       prev.tractorId,
      tractorNombre:   prev.tractorNombre,
      implemento:      prev.implemento,
      operarioId:      prev.operarioId,
      operarioNombre:  prev.operarioNombre,
      horimetroInicial: prev.horimetroFinal ?? '',
      horimetroFinal:   prev.horimetroFinal ?? '',
      horaInicio:      prev.horaFinal ?? '',
      horaFinal:       prev.horaFinal ?? '',
      diaSiguiente:    prev.diaSiguiente ?? false,
    }));
  };

  // ── Time helpers ──────────────────────────────────────────────────────────
  const applyOffset = (fieldName, hours) => {
    setForm(prev => {
      const now = () => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      };
      const base = prev[fieldName] || now();
      const isFinWithOvernight = fieldName === 'horaFinal' && prev.diaSiguiente;
      const [hB, mB] = base.split(':').map(Number);
      const baseAbsMin = isFinWithOvernight ? hB * 60 + mB + 24 * 60 : hB * 60 + mB;
      const totalMin   = baseAbsMin + Math.round(hours * 60);
      const finMin     = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
      const value      = `${String(Math.floor(finMin / 60)).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}`;
      const next = { ...prev, [fieldName]: value };
      if (fieldName === 'horaFinal' && prev.horaInicio) {
        next.diaSiguiente = totalMin >= 24 * 60;
      }
      saveDraft(next, isEditing);
      return next;
    });
  };

  const setNow = (fieldName) => {
    const d = new Date();
    const value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    setForm(prev => {
      const next = { ...prev, [fieldName]: value };
      saveDraft(next, isEditing);
      return next;
    });
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
    const seen = new Set();
    return grupoSel.bloques
      .map(id => siembras.find(s => s.id === id))
      .filter(s => {
        if (!s) return false;
        const key = s.bloque || s.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => parseInt(a.bloque || a.id) - parseInt(b.bloque || b.id));
  }, [grupos, siembras, form.grupo]);

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

  const gruposParaFila = (loteId) => {
    if (!loteId) return grupos;
    const ids = new Set(siembras.filter(s => s.loteId === loteId).map(s => s.id));
    return grupos.filter(g => Array.isArray(g.bloques) && g.bloques.some(b => ids.has(b)));
  };

  const grupoLabel = (g) => {
    const bloqueNums = [...new Set(
      (g.bloques || [])
        .map(id => siembras.find(s => s.id === id)?.bloque)
        .filter(Boolean)
    )].sort((a, b) => parseInt(a) - parseInt(b));
    return bloqueNums.length
      ? `${g.nombreGrupo} (${bloqueNums.join(', ')})`
      : g.nombreGrupo;
  };

  // ── Inline validation ─────────────────────────────────────────────────────
  const errHorimetro = (() => {
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    return !isNaN(ini) && !isNaN(fin) && ini > fin;
  })();
  const errHora = !!(form.horaInicio && form.horaFinal && form.horaInicio >= form.horaFinal && !form.diaSiguiente);

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
      {horimetroConfirm && (
        <ConfirmModal
          title="Horímetro inicial distinto al anterior"
          message={`El horímetro inicial ingresado (${parseFloat(form.horimetroInicial)}) es distinto al último horímetro final registrado para este activo (${lastHorimetroFinal}). ¿Desea continuar de todas formas?`}
          confirmLabel="Aceptar"
          onConfirm={horimetroConfirm.onConfirm}
          onCancel={() => setHorimetroConfirm(null)}
        />
      )}

      {/* ── Top bar ── */}
      <div className="hor-toolbar">
        <h1 className="hor-page-title">Registro de Horímetros</h1>
        <Link to="/operaciones/horimetro/historial" className="btn btn-secondary">
          <FiClock size={14} /> Historial
        </Link>
      </div>

      {/* ── Form card ── */}
      {showForm ? (
        <div className="hor-form-card">
          <div className="hor-form-header">
            <span>{isEditing ? 'Editar Registro' : 'Nuevo Registro de Horímetro'}</span>
            <div className="hor-form-header-right">
              {!isEditing && (
                <button
                  type="button"
                  className="btn btn-ia hor-scan-header-btn"
                  onClick={() => { resetForm(); setShowForm(false); setScanStep('upload'); setScanImage(null); setScanError(null); }}
                >
                  <FiCpu size={14} /> Leer con IA
                </button>
              )}
              <button className="hor-close-btn" onClick={resetForm} title="Cancelar">
                <FiX size={16} />
              </button>
            </div>
          </div>

          <form className="hor-form" onSubmit={handleSubmit}>

            <div className="hor-global-section">
              <div className="hor-form-grid">
                <div className="hor-field">
                  <label>Fecha <span className="hor-req">*</span></label>
                  <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
                </div>
                <div className="hor-field">
                  <label>Operario</label>
                  <OperarioCombobox
                    value={form.operarioId}
                    onChange={handleOperarioChange}
                    usuarios={usuarios}
                  />
                </div>
              </div>
            </div>

            {pendingLines.length > 0 && (
              <div className="hor-pending-lines">
                <p className="hor-pending-title">
                  <FiCheck size={13} /> {pendingLines.length} línea{pendingLines.length > 1 ? 's' : ''} lista{pendingLines.length > 1 ? 's' : ''} para guardar
                </p>
                {pendingLines.map((line, idx) => (
                  <div key={idx} className="hor-pending-row">
                    <span className="hor-pending-num">{idx + 1}</span>
                    <span className="hor-pending-detail">
                      {[line.labor, line.loteNombre, line.grupo].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <span className="hor-pending-times">
                      {line.horimetroInicial}–{line.horimetroFinal}
                      {(line.horaInicio || line.horaFinal) && ` · ${line.horaInicio || '?'}–${line.horaFinal || '?'}`}
                    </span>
                    <button
                      type="button" className="hor-pending-del"
                      onClick={() => setPendingLines(prev => prev.filter((_, i) => i !== idx))}
                      title="Quitar línea"
                    >
                      <FiX size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="hor-section-label">Maquinaria</p>
            <div className="hor-form-grid hor-grid-4">
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

            </div>

            <p className="hor-section-label">Ubicación y Labor</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Lote</label>
                <select name="loteId" value={form.loteId} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Grupo</label>
                <select name="grupo" value={form.grupo} onChange={handleChange} disabled={!form.loteId}>
                  <option value="">{form.loteId ? '— Sin grupo —' : '— Seleccione un lote primero —'}</option>
                  {gruposDelLote.map(g => (
                    <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                  ))}
                </select>
              </div>

              <div className="hor-field hor-field--full">
                <label>Bloques</label>
                <div className="hor-check-list">
                  {!form.grupo ? (
                    <p className="hor-check-empty">Seleccione un grupo primero.</p>
                  ) : bloquesDelGrupo.length === 0 ? (
                    <p className="hor-check-empty">Este grupo no tiene bloques.</p>
                  ) : bloquesDelGrupo.map(s => {
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
              </div>

            </div>

            <div className="hor-form-grid hor-labor-hora-grid">
              <div className="hor-field hor-field--labor">
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
              {['horaInicio', 'horaFinal'].map(field => (
                <div key={field} className="hor-field">
                  <label>{field === 'horaInicio' ? 'Hora de Inicio' : 'Hora Final'}</label>
                  <div className="hor-time-row" ref={timeDropdown === field ? timeDropdownRef : null}>
                    <input
                      type="time" name={field} value={form[field]} onChange={handleChange}
                      className={errHora && field === 'horaFinal' ? 'hor-input-error' : ''}
                    />
                    <div className="hor-time-dd-wrap">
                      <button
                        type="button"
                        ref={el => { clockBtnRefs.current[field] = el; }}
                        className={`hor-now-btn${timeDropdown === field ? ' hor-now-btn--active' : ''}`}
                        onClick={() => {
                          if (timeDropdown === field) { setTimeDropdown(null); return; }
                          const btn = clockBtnRefs.current[field];
                          if (btn) {
                            const r = btn.getBoundingClientRect();
                            setDropdownPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
                          }
                          setTimeDropdown(field);
                        }}
                        title="Opciones de hora"
                      >
                        <FiClock size={13} />
                      </button>
                    </div>
                  </div>
                  {errHora && field === 'horaFinal' && <span className="hor-field-error">La hora final debe ser mayor que la inicial</span>}
                </div>
              ))}
            </div>
            {form.horaInicio && form.horaFinal && form.horaFinal < form.horaInicio && (
              <label className="hor-dia-siguiente-label">
                <input
                  type="checkbox" name="diaSiguiente"
                  checked={!!form.diaSiguiente} onChange={handleChange}
                />
                Finaliza el día siguiente
              </label>
            )}
            {form.diaSiguiente && form.horaInicio && form.horaFinal && form.horaFinal < form.horaInicio && (() => {
              const [hI, mI] = form.horaInicio.split(':').map(Number);
              const [hF, mF] = form.horaFinal.split(':').map(Number);
              const diff = ((hF * 60 + mF) - (hI * 60 + mI) + 24 * 60) % (24 * 60);
              const h = Math.floor(diff / 60), m = diff % 60;
              return (
                <p className="hor-nocturno-info">
                  Turno nocturno · finaliza el día siguiente · {h}h {m > 0 ? `${m}m` : ''} de trabajo
                </p>
              );
            })()}

            {!isEditing && (
              <div className="hor-add-line-wrap">
                <button type="button" className="btn btn-secondary" onClick={handleAddLine}>
                  <FiPlus size={14} /> Agregar línea
                </button>
              </div>
            )}

            <div className="hor-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : pendingLines.length > 0 ? `Guardar ${pendingLines.length + 1} líneas` : 'Registrar'}
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
              <button className="btn btn-secondary" onClick={() => { setScanStep(null); setScanImage(null); setScanError(null); setShowForm(true); }}>Cancelar</button>
              <button className="btn btn-ia" onClick={handleScan} disabled={!scanImage || scanning}>
                <FiCpu size={14} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
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
                          <FiX size={13} />
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
      ) : null}
    </div>

    {timeDropdown && createPortal(
      <div
        ref={timeDropdownRef}
        className="hor-time-dropdown"
        style={{ position: 'fixed', top: dropdownPos.top, right: dropdownPos.right, left: 'auto', zIndex: 9999 }}
      >
        <button type="button" className="hor-tdd-item hor-tdd-now"
          onClick={() => { setNow(timeDropdown); setTimeDropdown(null); }}>
          Hora actual
        </button>
        <div className="hor-tdd-divider" />
        {[{ h: 1/60, label: '+1m' }, { h: 1/12, label: '+5m' }, { h: 0.25, label: '+15m' }, { h: 0.5, label: '+30m' }, { h: 1, label: '+1h' }].map(({ h, label }) => (
          <button key={label} type="button" className="hor-tdd-item hor-tdd-pos"
            onClick={() => applyOffset(timeDropdown, h)}>
            {label}
          </button>
        ))}
        <div className="hor-tdd-divider" />
        {[{ h: -1/60, label: '-1m' }, { h: -1/12, label: '-5m' }, { h: -0.25, label: '-15m' }, { h: -0.5, label: '-30m' }, { h: -1, label: '-1h' }].map(({ h, label }) => (
          <button key={label} type="button" className="hor-tdd-item hor-tdd-neg"
            onClick={() => applyOffset(timeDropdown, h)}>
            {label}
          </button>
        ))}
        <div className="hor-tdd-divider" />
        <button type="button" className="hor-tdd-item hor-tdd-close"
          onClick={() => setTimeDropdown(null)}>
          Cerrar
        </button>
      </div>,
      document.body
    )}
    </>
  );
}

export default RegistroHorimetro;
