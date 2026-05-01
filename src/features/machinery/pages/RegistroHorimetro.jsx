import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  FiClock, FiPlus, FiX, FiCheck, FiCamera, FiUpload, FiCpu,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraCombobox from '../../../components/AuroraCombobox';
import AuroraTimePicker from '../../../components/AuroraTimePicker';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import '../styles/machinery.css';

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

const TODAY = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = {
  id: null,
  fecha: TODAY(),
  tractorId: '',
  tractorNombre: '',
  implementoId: '',
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

// Activos labels para los comboboxes
const tractorLabel = (m) => m ? (m.codigo ? `${m.codigo} — ${m.descripcion}` : m.descripcion) : '';
const laborLabel   = (l) => l ? (l.codigo ? `${l.codigo} · ${l.descripcion}`  : l.descripcion) : '';
const userLabel    = (u) => u ? u.nombre : '';

function RegistroHorimetro() {
  const apiFetch = useApiFetch();
  const { currentUser: _ } = useUser(); // eslint-disable-line no-unused-vars
  const location = useLocation();

  // Scan state
  const scanFileRef = useRef(null);
  const [scanStep,   setScanStep]    = useState(null);
  const [scanImage,  setScanImage]   = useState(null);
  const [scanRows,   setScanRows]    = useState([]);
  const [scanning,   setScanning]    = useState(false);
  const [scanError,  setScanError]   = useState(null);
  const [savingBatch, setSavingBatch] = useState(false);

  // Catalog data
  const [tractores,  setTractores]  = useState([]);
  const [lotes,      setLotes]      = useState([]);
  const [usuarios,   setUsuarios]   = useState([]);
  const [grupos,     setGrupos]     = useState([]);
  const [siembras,   setSiembras]   = useState([]);
  const [labores,    setLabores]    = useState([]);
  const [records,    setRecords]    = useState([]);
  const [toast,      setToast]      = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Tasas de combustible (cargadas una vez al montar, desde la bodega configurada)
  const fuelBodegaId = localStorage.getItem('aurora_fuel_bodegaId') || '';
  const [tasasCombustible, setTasasCombustible] = useState({});

  // Form — abre por defecto al montar, restaura draft si existe
  const _draft = loadDraft();
  const [showForm, setShowForm]   = useState(true);
  const [form, setForm]           = useState(_draft?.form     ?? EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(_draft?.isEditing ?? false);
  const [saving, setSaving]       = useState(false);

  const [rangeConfirm,        setRangeConfirm]        = useState(null);
  const [horimetroConfirm,    setHorimetroConfirm]    = useState(null);
  const [lastHorimetroFinal,  setLastHorimetroFinal]  = useState(null);
  const [pendingLines,        setPendingLines]        = useState([]);

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore sidebar draft badge if a cross-session draft exists
  useEffect(() => {
    if (loadDraft()) {
      sessionStorage.setItem(DRAFT_ACTIVE_KEY, '1');
      window.dispatchEvent(new Event('aurora-draft-change'));
    }
  }, []);

  // Cargar tasas de combustible (bodega configurada en MaquinariaList)
  useEffect(() => {
    if (!fuelBodegaId) return;
    apiFetch(`/api/maquinaria/tasas-combustible?bodegaId=${fuelBodegaId}`)
      .then(r => r.json())
      .then(data => setTasasCombustible(data.tasas || {}))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const getLastHorimetroFinal = useCallback((tractorId) => {
    if (!tractorId) return null;
    const tRecords = records
      .filter(r => r.tractorId === tractorId && r.horimetroFinal != null && r.horimetroFinal !== '')
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    if (!tRecords.length) return null;
    const val = parseFloat(tRecords[0].horimetroFinal);
    return isNaN(val) ? null : val;
  }, [records]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name } = e.target;
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => {
      const next = { ...prev, [name]: value };
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
      saveDraft(next, isEditing);
      return next;
    });
  };

  const handleTractorChange = (id) => {
    const lastFin = !isEditing && id ? getLastHorimetroFinal(id) : null;
    if (!isEditing) setLastHorimetroFinal(lastFin);
    const t = tractores.find(x => x.id === id);
    setForm(prev => {
      const next = {
        ...prev,
        tractorId: id,
        tractorNombre: t ? t.descripcion : '',
      };
      if (!isEditing && lastFin != null) {
        next.horimetroInicial = String(lastFin);
        next.horimetroFinal   = String(lastFin);
      }
      saveDraft(next, isEditing);
      return next;
    });
  };

  const handleImplementoChange = (id) => {
    const t = tractores.find(x => x.id === id);
    setForm(prev => {
      const next = { ...prev, implementoId: id, implemento: t ? t.descripcion : '' };
      saveDraft(next, isEditing);
      return next;
    });
  };

  const handleOperarioChange = (id) => {
    const u = usuarios.find(x => x.id === id);
    setForm(prev => {
      const next = { ...prev, operarioId: id, operarioNombre: u ? u.nombre : '' };
      saveDraft(next, isEditing);
      return next;
    });
  };

  const handleLaborChange = (id) => {
    const l = labores.find(x => x.id === id);
    setForm(prev => {
      const next = { ...prev, labor: l ? l.descripcion : '' };
      saveDraft(next, isEditing);
      return next;
    });
  };

  const handleTimeChange = (field) => (val) => {
    handleChange({ target: { name: field, value: val } });
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

  // ── Save logic ────────────────────────────────────────────────────────────
  const buildCombustiblePayload = (line) => {
    const tasa = fuelBodegaId ? (tasasCombustible[line.tractorId] ?? null) : null;
    const ini  = parseFloat(line.horimetroInicial);
    const fin  = parseFloat(line.horimetroFinal);
    const horas = (!isNaN(ini) && !isNaN(fin) && fin > ini) ? parseFloat((fin - ini).toFixed(1)) : null;
    if (!tasa?.tasaLH || !horas) return null;
    return {
      bodegaId:        fuelBodegaId,
      tasaLH:          tasa.tasaLH,
      precioUnitario:  tasa.precioUnitario,
      litrosEstimados: parseFloat((tasa.tasaLH * horas).toFixed(2)),
      costoEstimado:   parseFloat((tasa.tasaLH * horas * tasa.precioUnitario).toFixed(2)),
    };
  };

  const doSave = async () => {
    setSaving(true);
    try {
      if (isEditing) {
        const combustible = buildCombustiblePayload(form);
        const payload = { ...form, ...(combustible ? { combustible } : {}) };
        const res = await apiFetch(`/api/horimetro/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        showToast('Registro actualizado.');
      } else {
        const allLines = [...pendingLines, form];
        for (const line of allLines) {
          const combustible = buildCombustiblePayload(line);
          const payload = { ...line, ...(combustible ? { combustible } : {}) };
          const res = await apiFetch('/api/horimetro', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
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
          body: `El rango de horas trabajadas es de ${(diffMin / 60).toFixed(1)} h. ¿Es correcto?`,
          onConfirm: () => { setRangeConfirm(null); doSave(); },
        });
        return;
      }
    }
    doSave();
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.fecha || !form.tractorId) {
      showToast('Fecha y tractor son obligatorios.', 'error');
      return;
    }
    if (form.fecha > TODAY()) {
      showToast('La fecha no puede ser futura.', 'error');
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
        body: `El horímetro inicial y final son iguales (${ini}). Esto puede indicar que el activo no operó (ej. mantenimiento). ¿Desea continuar?`,
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
        body: `El rango del horímetro es de ${(fin - ini).toFixed(1)} h. ¿Es correcto?`,
        onConfirm: () => { setRangeConfirm(null); checkMismatchAndSave(); },
      });
      return;
    }
    checkMismatchAndSave();
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
      implementoId:    prev.implementoId,
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
      siembras.filter(s => s.loteId === form.loteId).map(s => s.id),
    );
    return grupos.filter(g =>
      Array.isArray(g.bloques) && g.bloques.some(bid => siembraIds.has(bid)),
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

  const grupoLabel = (g) => {
    const bloqueNums = [...new Set(
      (g.bloques || [])
        .map(id => siembras.find(s => s.id === id)?.bloque)
        .filter(Boolean),
    )].sort((a, b) => parseInt(a) - parseInt(b));
    return bloqueNums.length
      ? `${g.nombreGrupo} (${bloqueNums.join(', ')})`
      : g.nombreGrupo;
  };

  const gruposParaFila = (loteId) => {
    if (!loteId) return grupos;
    const ids = new Set(siembras.filter(s => s.loteId === loteId).map(s => s.id));
    return grupos.filter(g => Array.isArray(g.bloques) && g.bloques.some(b => ids.has(b)));
  };

  // labor value es ID derivado de la descripcion guardada en form.labor
  const laborValue = useMemo(() => {
    if (!form.labor) return '';
    return labores.find(l => l.descripcion === form.labor)?.id || '';
  }, [form.labor, labores]);

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
      if (field === 'implementoId') {
        const t = implementosLista.find(x => x.id === value);
        row.implemento = t ? t.descripcion : '';
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

  // ── Inline validation ─────────────────────────────────────────────────────
  const errHorimetro = (() => {
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    return !isNaN(ini) && !isNaN(fin) && ini > fin;
  })();
  const errHora = !!(form.horaInicio && form.horaFinal && form.horaInicio >= form.horaFinal && !form.diaSiguiente);

  // ── Costo estimado de combustible ─────────────────────────────────────────
  const tasaMaquina = form.tractorId ? (tasasCombustible[form.tractorId] ?? null) : null;
  const horasForm   = (() => {
    const ini = parseFloat(form.horimetroInicial);
    const fin = parseFloat(form.horimetroFinal);
    return (!isNaN(ini) && !isNaN(fin) && fin > ini) ? parseFloat((fin - ini).toFixed(1)) : null;
  })();
  const costoEstCombustible = (tasaMaquina?.tasaLH && horasForm)
    ? parseFloat((tasaMaquina.tasaLH * horasForm * tasaMaquina.precioUnitario).toFixed(2))
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  const sheetTitle = scanStep === 'upload' ? 'Escanear formulario'
                  : scanStep === 'review' ? 'Revisar registros extraídos'
                  : isEditing             ? 'Editar registro de horímetro'
                  :                          'Registro de horímetro';

  const sheetSubtitle = scanStep === 'upload' ? 'Carga una foto del formulario y deja que la IA extraiga las filas.'
                      : scanStep === 'review' ? `${scanRows.length} fila${scanRows.length !== 1 ? 's' : ''} extraída${scanRows.length !== 1 ? 's' : ''}. Revísalas antes de guardar.`
                      : isEditing             ? 'Modifica los datos del registro existente.'
                      :                          'Captura horas trabajadas, ubicación y combustible para un activo.';

  return (
    <div className="machinery-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {rangeConfirm && (
        <AuroraConfirmModal
          title={rangeConfirm.title}
          body={rangeConfirm.body}
          confirmLabel="Sí, es correcto"
          onConfirm={rangeConfirm.onConfirm}
          onCancel={() => setRangeConfirm(null)}
        />
      )}
      {horimetroConfirm && (
        <AuroraConfirmModal
          title="Horímetro inicial distinto al anterior"
          body={`El horímetro inicial ingresado (${parseFloat(form.horimetroInicial)}) es distinto al último horímetro final registrado para este activo (${lastHorimetroFinal}). ¿Desea continuar de todas formas?`}
          confirmLabel="Aceptar"
          onConfirm={horimetroConfirm.onConfirm}
          onCancel={() => setHorimetroConfirm(null)}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">{sheetTitle}</h1>
            <p className="aur-sheet-subtitle">{sheetSubtitle}</p>
          </div>
          <div className="aur-sheet-header-actions">
            {scanStep === null && !isEditing && (
              <button
                type="button"
                className="aur-chip"
                onClick={() => { resetForm(); setShowForm(false); setScanStep('upload'); setScanImage(null); setScanError(null); }}
                title="Leer formulario con IA"
              >
                <FiCpu size={12} /> Leer con IA
              </button>
            )}
            <Link to="/operaciones/horimetro/historial" className="aur-chip">
              <FiClock size={12} /> Historial
            </Link>
            {(scanStep === 'upload' || scanStep === 'review') && (
              <button
                type="button"
                className="aur-icon-btn"
                onClick={() => { setScanStep(null); setScanImage(null); setScanError(null); setShowForm(true); }}
                title="Cancelar"
              >
                <FiX size={16} />
              </button>
            )}
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════
             FORM MODE
             ═══════════════════════════════════════════════════════════════════ */}
        {showForm && scanStep === null && (
          <form onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Fecha y operario</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-fecha">Fecha</label>
                  <input
                    id="rh-fecha"
                    type="date"
                    name="fecha"
                    className="aur-input"
                    value={form.fecha}
                    onChange={handleChange}
                    max={TODAY()}
                    required
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Operario</label>
                  <AuroraCombobox
                    value={form.operarioId}
                    onChange={handleOperarioChange}
                    items={usuarios}
                    labelFn={userLabel}
                    placeholder="— Buscar operario —"
                  />
                </div>
              </div>
            </section>

            {pendingLines.length > 0 && (
              <section className="aur-section">
                <div className="aur-section-header">
                  <span className="aur-section-num">·</span>
                  <h3 className="aur-section-title">Líneas pendientes</h3>
                  <span className="aur-section-count">{pendingLines.length}</span>
                </div>
                <div className="machinery-pending-list">
                  {pendingLines.map((line, idx) => (
                    <div key={idx} className="machinery-pending-item">
                      <span className="machinery-pending-num">{idx + 1}</span>
                      <span className="machinery-pending-detail">
                        {[line.labor, line.loteNombre, line.grupo].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="machinery-pending-times">
                        {line.horimetroInicial}–{line.horimetroFinal}
                        {(line.horaInicio || line.horaFinal) && ` · ${line.horaInicio || '?'}–${line.horaFinal || '?'}`}
                      </span>
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                        onClick={() => setPendingLines(prev => prev.filter((_, i) => i !== idx))}
                        title="Quitar línea"
                      >
                        <FiX size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Maquinaria</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label">Tractor</label>
                  <AuroraCombobox
                    value={form.tractorId}
                    onChange={handleTractorChange}
                    items={tractoresLista}
                    labelFn={tractorLabel}
                    placeholder="— Seleccionar tractor —"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Implemento</label>
                  <AuroraCombobox
                    value={form.implementoId}
                    onChange={handleImplementoChange}
                    items={implementosLista}
                    labelFn={tractorLabel}
                    placeholder="— Sin implemento —"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-hor-ini">Horímetro inicial</label>
                  <input
                    id="rh-hor-ini"
                    type="number"
                    name="horimetroInicial"
                    className={`aur-input aur-input--num${errHorimetro ? ' aur-input--error' : ''}`}
                    value={form.horimetroInicial}
                    onChange={handleChange}
                    min="0"
                    max="99999"
                    step="0.1"
                    placeholder="0.0"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-hor-fin">Horímetro final</label>
                  <input
                    id="rh-hor-fin"
                    type="number"
                    name="horimetroFinal"
                    className={`aur-input aur-input--num${errHorimetro ? ' aur-input--error' : ''}`}
                    value={form.horimetroFinal}
                    onChange={handleChange}
                    min="0"
                    max="99999"
                    step="0.1"
                    placeholder="0.0"
                  />
                </div>
                {errHorimetro && (
                  <div className="aur-row aur-row--multiline">
                    <span className="aur-row-label" />
                    <span className="aur-field-error">El horímetro final debe ser mayor que el inicial.</span>
                  </div>
                )}
              </div>
            </section>

            {fuelBodegaId && form.tractorId && (
              <div className={`machinery-fuel-strip${costoEstCombustible !== null ? '' : ' machinery-fuel-strip--na'}`}>
                {costoEstCombustible !== null ? (
                  <>
                    <span className="machinery-fuel-strip-item">
                      <span className="machinery-fuel-strip-label">Tasa</span>
                      <span className="machinery-fuel-strip-val">{tasaMaquina.tasaLH.toFixed(2)} L/H</span>
                    </span>
                    <span className="machinery-fuel-strip-sep">·</span>
                    <span className="machinery-fuel-strip-item">
                      <span className="machinery-fuel-strip-label">Precio</span>
                      <span className="machinery-fuel-strip-val">₡{tasaMaquina.precioUnitario.toLocaleString('es-CR', { maximumFractionDigits: 0 })}/L</span>
                    </span>
                    <span className="machinery-fuel-strip-sep">·</span>
                    <span className="machinery-fuel-strip-item">
                      <span className="machinery-fuel-strip-label">Litros est.</span>
                      <span className="machinery-fuel-strip-val">{(tasaMaquina.tasaLH * horasForm).toFixed(1)} L</span>
                    </span>
                    <span className="machinery-fuel-strip-sep">·</span>
                    <span className="machinery-fuel-strip-item machinery-fuel-strip-total">
                      <span className="machinery-fuel-strip-label">Costo est.</span>
                      <span className="machinery-fuel-strip-val">₡{costoEstCombustible.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</span>
                    </span>
                  </>
                ) : (
                  <span className="machinery-fuel-strip-na">
                    {!tasaMaquina
                      ? 'Sin datos de consumo en los últimos 30 días para este activo.'
                      : 'Ingrese horímetro inicial y final para calcular costo de combustible.'}
                  </span>
                )}
              </div>
            )}

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Ubicación</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-lote">Lote</label>
                  <select
                    id="rh-lote"
                    name="loteId"
                    className="aur-select"
                    value={form.loteId}
                    onChange={handleChange}
                  >
                    <option value="">— Seleccionar —</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-grupo">Grupo</label>
                  <select
                    id="rh-grupo"
                    name="grupo"
                    className="aur-select"
                    value={form.grupo}
                    onChange={handleChange}
                    disabled={!form.loteId}
                  >
                    <option value="">{form.loteId ? '— Sin grupo —' : '— Seleccione un lote primero —'}</option>
                    {gruposDelLote.map(g => (
                      <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                    ))}
                  </select>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label">Bloques</label>
                  <div className="machinery-bloques-list">
                    {!form.grupo ? (
                      <p className="machinery-bloques-empty">Seleccione un grupo primero.</p>
                    ) : bloquesDelGrupo.length === 0 ? (
                      <p className="machinery-bloques-empty">Este grupo no tiene bloques.</p>
                    ) : bloquesDelGrupo.map(s => {
                      const val = s.bloque || s.id;
                      return (
                        <label key={s.id} className="machinery-bloques-row">
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
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Labor y horas</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label">Labor</label>
                  <AuroraCombobox
                    value={laborValue}
                    onChange={handleLaborChange}
                    items={labores}
                    labelFn={laborLabel}
                    placeholder="— Buscar labor —"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-h-ini">Hora inicial</label>
                  <AuroraTimePicker
                    id="rh-h-ini"
                    name="horaInicio"
                    value={form.horaInicio}
                    onChange={handleTimeChange('horaInicio')}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="rh-h-fin">Hora final</label>
                  <AuroraTimePicker
                    id="rh-h-fin"
                    name="horaFinal"
                    value={form.horaFinal}
                    onChange={handleTimeChange('horaFinal')}
                    hasError={errHora}
                  />
                </div>
                {errHora && (
                  <div className="aur-row aur-row--multiline">
                    <span className="aur-row-label" />
                    <span className="aur-field-error">La hora final debe ser mayor que la inicial.</span>
                  </div>
                )}
                {form.horaInicio && form.horaFinal && form.horaFinal < form.horaInicio && (
                  <div className="aur-row">
                    <span className="aur-row-label" />
                    <label className="machinery-toggle-label">
                      <input
                        type="checkbox"
                        name="diaSiguiente"
                        checked={!!form.diaSiguiente}
                        onChange={handleChange}
                      />
                      <span>Finaliza el día siguiente</span>
                    </label>
                  </div>
                )}
              </div>

              {form.diaSiguiente && form.horaInicio && form.horaFinal && form.horaFinal < form.horaInicio && (() => {
                const [hI, mI] = form.horaInicio.split(':').map(Number);
                const [hF, mF] = form.horaFinal.split(':').map(Number);
                const diff = ((hF * 60 + mF) - (hI * 60 + mI) + 24 * 60) % (24 * 60);
                const h = Math.floor(diff / 60), m = diff % 60;
                return (
                  <p className="machinery-nocturno-info">
                    Turno nocturno · finaliza el día siguiente · {h}h {m > 0 ? `${m}m` : ''} de trabajo
                  </p>
                );
              })()}
            </section>

            <div className="aur-form-actions">
              {!isEditing && (
                <button type="button" className="aur-btn-text" onClick={handleAddLine}>
                  <FiPlus size={14} /> Agregar línea
                </button>
              )}
              <button type="button" className="aur-btn-text" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : pendingLines.length > 0 ? `Guardar ${pendingLines.length + 1} líneas` : 'Registrar'}
              </button>
            </div>
          </form>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
             SCAN UPLOAD MODE
             ═══════════════════════════════════════════════════════════════════ */}
        {scanStep === 'upload' && (
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">·</span>
              <h3 className="aur-section-title"><FiCamera size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Cargar imagen del formulario</h3>
            </div>
            <div
              className={`machinery-scan-dropzone${scanImage ? ' has-image' : ''}`}
              onDrop={handleScanDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => !scanImage && scanFileRef.current?.click()}
            >
              {scanImage ? (
                <div className="machinery-scan-preview-wrap">
                  <img src={scanImage.previewUrl} alt="Formulario" className="machinery-scan-preview" />
                  <button
                    type="button"
                    className="aur-chip"
                    onClick={(e) => { e.stopPropagation(); setScanImage(null); }}
                  >
                    <FiX size={12} /> Cambiar imagen
                  </button>
                </div>
              ) : (
                <div className="machinery-scan-hint">
                  <FiUpload size={28} />
                  <p>Arrastra la foto del formulario aquí o <strong>haz clic para seleccionar</strong></p>
                  <span>JPG, PNG, WEBP</span>
                </div>
              )}
            </div>
            <input
              ref={scanFileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleScanFile}
            />
            {scanError && <p className="aur-field-error" style={{ marginTop: 12 }}>{scanError}</p>}
            <div className="aur-form-actions">
              <button
                type="button"
                className="aur-btn-text"
                onClick={() => { setScanStep(null); setScanImage(null); setScanError(null); setShowForm(true); }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleScan}
                disabled={!scanImage || scanning}
              >
                <FiCpu size={14} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
              </button>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
             SCAN REVIEW MODE — batch-editable table
             ═══════════════════════════════════════════════════════════════════ */}
        {scanStep === 'review' && (
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">·</span>
              <h3 className="aur-section-title">Filas extraídas</h3>
              <span className="aur-section-count">{scanRows.length}</span>
            </div>
            <div className="aur-table-wrap machinery-batch-wrap">
              <table className="aur-table machinery-batch-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th>Tractor</th>
                    <th>Implemento</th>
                    <th style={{ textAlign: 'right' }}>Hor. ini</th>
                    <th style={{ textAlign: 'right' }}>Hor. fin</th>
                    <th>Lote</th>
                    <th>Grupo</th>
                    <th>Labor</th>
                    <th>H. inicio</th>
                    <th>H. final</th>
                    <th>Operario</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scanRows.map((row, idx) => (
                    <tr key={idx} className={!row.tractorId ? 'machinery-batch-row-warn' : ''}>
                      <td className="machinery-td-num">{idx + 1}</td>
                      <td>
                        <input type="date" className="machinery-batch-input" value={row.fecha || ''} max={TODAY()} onChange={e => updateScanRow(idx, 'fecha', e.target.value)} />
                      </td>
                      <td>
                        <select className="machinery-batch-select" value={row.tractorId || ''} onChange={e => updateScanRow(idx, 'tractorId', e.target.value)}>
                          <option value="">—</option>
                          {tractoresLista.map(t => <option key={t.id} value={t.id}>{tractorLabel(t)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="machinery-batch-select" value={row.implementoId || ''} onChange={e => updateScanRow(idx, 'implementoId', e.target.value)}>
                          <option value="">—</option>
                          {implementosLista.map(t => <option key={t.id} value={t.id}>{tractorLabel(t)}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" className="machinery-batch-input machinery-batch-num" value={row.horimetroInicial ?? ''} onChange={e => updateScanRow(idx, 'horimetroInicial', e.target.value === '' ? null : parseFloat(e.target.value))} step="0.1" />
                      </td>
                      <td>
                        <input type="number" className="machinery-batch-input machinery-batch-num" value={row.horimetroFinal ?? ''} onChange={e => updateScanRow(idx, 'horimetroFinal', e.target.value === '' ? null : parseFloat(e.target.value))} step="0.1" />
                      </td>
                      <td>
                        <select className="machinery-batch-select" value={row.loteId || ''} onChange={e => updateScanRow(idx, 'loteId', e.target.value)}>
                          <option value="">—</option>
                          {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="machinery-batch-select" value={row.grupo || ''} onChange={e => updateScanRow(idx, 'grupo', e.target.value)}>
                          <option value="">—</option>
                          {gruposParaFila(row.loteId).map(g => <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="machinery-batch-select machinery-batch-select-wide" value={row.labor || ''} onChange={e => updateScanRow(idx, 'labor', e.target.value)}>
                          <option value="">—</option>
                          {labores.map(l => <option key={l.id} value={l.descripcion}>{laborLabel(l)}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="time" className="machinery-batch-input" value={row.horaInicio || ''} onChange={e => updateScanRow(idx, 'horaInicio', e.target.value)} />
                      </td>
                      <td>
                        <input type="time" className="machinery-batch-input" value={row.horaFinal || ''} onChange={e => updateScanRow(idx, 'horaFinal', e.target.value)} />
                      </td>
                      <td>
                        <select className="machinery-batch-select" value={row.operarioId || ''} onChange={e => updateScanRow(idx, 'operarioId', e.target.value)}>
                          <option value="">—</option>
                          {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => removeScanRow(idx)}
                          title="Eliminar fila"
                        >
                          <FiX size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="machinery-batch-hint">
              Las filas en magenta requieren seleccionar un tractor para guardarse.
            </p>
            {scanError && <p className="aur-field-error">{scanError}</p>}
            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={() => setScanStep('upload')}>
                ← Volver
              </button>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={handleBatchSave}
                disabled={savingBatch || scanRows.length === 0}
              >
                <FiCheck size={14} /> {savingBatch ? 'Guardando…' : `Registrar ${scanRows.filter(r => r.tractorId).length} registro(s)`}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default RegistroHorimetro;
