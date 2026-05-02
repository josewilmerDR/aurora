import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  FiClock, FiPlus, FiX, FiCheck, FiCpu, FiEdit2,
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

  // Refs
  const scanFileRef = useRef(null);
  const lineasSectionRef = useRef(null);
  const [scanning, setScanning] = useState(false);

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

  // Form — restaura draft si existe
  const _draft = loadDraft();
  // Cada línea (form + pending) lleva un `_no` estable asignado al momento de
  // crearla — preserva el orden de entrada aunque el usuario haga swap-edit.
  const [form, setForm]           = useState(_draft?.form     ?? { ...EMPTY_FORM, _no: 1 });
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

  // Pre-fill from Aurora chat "Revisar en formulario" (passed via router state).
  // Carga 1+ filas directamente en el form: la primera queda activa, el resto
  // como líneas pendientes — mismo flujo que el escaneo IA.
  useEffect(() => {
    const draft = location.state?.horimetroDraft;
    if (!draft) return;
    window.history.replaceState({}, '');
    const filas = Array.isArray(draft) ? draft : [draft];
    loadFilasIntoForm(filas);
  }, [location.state?.horimetroDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill from Historial "Editar" button
  useEffect(() => {
    const rec = location.state?.editRecord;
    if (!rec) return;
    window.history.replaceState({}, '');
    const editForm = { ...EMPTY_FORM, ...rec, _no: 1 };
    saveDraft(editForm, true);
    setForm(editForm);
    setIsEditing(true);
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
    const t = tractores.find(x => x.id === id);

    // Línea inmediatamente previa en la sesión actual (mayor _no entre las
    // pendientes con _no menor al del form). Si su tractor coincide, sus
    // valores de cierre se usan como apertura del form.
    const previousLine = !isEditing && id
      ? pendingLines
          .filter(l => (l._no || 0) < (form._no || 0))
          .reduce((best, cur) => (!best || (cur._no || 0) > (best._no || 0)) ? cur : best, null)
      : null;
    const sessionMatch = !!(previousLine && previousLine.tractorId === id);

    // Fallback histórico: si no hay match de sesión, busca el último horímetro
    // final guardado para este tractor.
    const lastFin = !isEditing && id && !sessionMatch ? getLastHorimetroFinal(id) : null;
    if (!isEditing) setLastHorimetroFinal(lastFin);

    setForm(prev => {
      const next = {
        ...prev,
        tractorId: id,
        tractorNombre: t ? t.descripcion : '',
      };
      if (sessionMatch) {
        if (previousLine.horimetroFinal !== '' && previousLine.horimetroFinal != null) {
          next.horimetroInicial = String(previousLine.horimetroFinal);
          next.horimetroFinal   = String(previousLine.horimetroFinal);
        }
        if (previousLine.horaFinal) {
          next.horaInicio = previousLine.horaFinal;
          next.horaFinal  = previousLine.horaFinal;
        }
      } else if (!isEditing && lastFin != null) {
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
    setForm({ ...EMPTY_FORM, _no: 1 });
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
        const { _no: _ignore, ...formPayload } = form;
        const payload = { ...formPayload, ...(combustible ? { combustible } : {}) };
        const res = await apiFetch(`/api/horimetro/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        showToast('Registro actualizado.');
      } else {
        // Filtra líneas sin tractor — pueden ser resultado de "Limpiar línea"
        // sobre una línea que el usuario decidió descartar.
        const allLines = [...pendingLines, form].filter(line => line.tractorId);
        if (allLines.length === 0) {
          showToast('No hay líneas con datos para guardar.', 'error');
          return;
        }
        for (const line of allLines) {
          const combustible = buildCombustiblePayload(line);
          const { _no: _ignore, ...linePayload } = line;
          const payload = { ...linePayload, ...(combustible ? { combustible } : {}) };
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
    // Caso: la línea activa está vacía (resultado de "Limpiar línea" cuando el
    // usuario decidió descartarla). Si hay líneas pendientes válidas, saltamos
    // la validación del form y guardamos solo las pendientes — doSave filtra
    // las vacías. Si tampoco hay pendientes, error.
    if (!form.tractorId) {
      if (pendingLines.length === 0) {
        showToast('Fecha y tractor son obligatorios.', 'error');
        return;
      }
      doSave();
      return;
    }
    if (!form.fecha) {
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

  // Trae una línea pendiente de vuelta al form activo y deja en su slot
  // el contenido actual del form (swap in-place — preserva orden visual).
  const handleEditPendingLine = (idx) => {
    const lineToEdit = pendingLines[idx];
    if (!lineToEdit) return;
    const currentForm = { ...form };
    setPendingLines(prev => prev.map((line, i) => i === idx ? currentForm : line));
    setForm(lineToEdit);
    saveDraft(lineToEdit, isEditing);
  };

  // Descarta la línea activa.
  // - Si es la única línea: la deja vacía (preservando _no y fecha) — el
  //   botón "Limpiar" del footer es lo que limpia todo.
  // - Si hay otras líneas: elimina la activa y promueve la pendiente más
  //   reciente (mayor _no) al form. Evita dejar un form en blanco "fantasma"
  //   en la lista cuando hay otras líneas legítimas.
  const handleClearActiveLine = () => {
    if (pendingLines.length === 0) {
      setForm(prev => {
        const cleared = { ...EMPTY_FORM, fecha: prev.fecha, _no: prev._no };
        saveDraft(cleared, isEditing);
        return cleared;
      });
      return;
    }
    const newest = pendingLines.reduce((a, b) => ((a._no || 0) > (b._no || 0) ? a : b));
    setPendingLines(prev => prev.filter(l => l._no !== newest._no));
    setForm(newest);
    saveDraft(newest, isEditing);
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
    const maxNo = Math.max(form._no || 0, ...pendingLines.map(l => l._no || 0));
    setPendingLines(prev => [...prev, { ...form }]);
    // Form en blanco — solo preservamos la fecha (típicamente compartida en una
    // jornada). El carryover de tractor/horímetros/horas ahora vive en
    // handleTractorChange: cuando el usuario seleccione el mismo tractor que la
    // línea anterior, se autollena el horímetro inicial y la hora inicial.
    setForm(prev => ({
      ...EMPTY_FORM,
      fecha: prev.fecha,
      _no:   maxNo + 1,
    }));
    // Scroll a la sección "Líneas" para que el usuario vea la línea anterior
    // minimizada y la nueva línea con la marca "Editando ahora".
    requestAnimationFrame(() => {
      lineasSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // ── Derived asset lists ────────────────────────────────────────────────────
  // Si ningún activo califica como "tractor" (por tipo mal etiquetado o vacío),
  // mostramos toda la lista de activos en vez de un combobox vacío que bloquearía
  // el form.
  const tractoresLista = useMemo(() => {
    const matches = tractores.filter(t => /tractor/i.test(t.tipo) || /otra maquinaria/i.test(t.tipo));
    return matches.length > 0 ? matches : tractores;
  }, [tractores]);

  const implementosLista = useMemo(() => {
    const matches = tractores.filter(t => /implemento/i.test(t.tipo));
    return matches.length > 0 ? matches : tractores;
  }, [tractores]);

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

  // labor value es ID derivado de la descripcion guardada en form.labor
  const laborValue = useMemo(() => {
    if (!form.labor) return '';
    return labores.find(l => l.descripcion === form.labor)?.id || '';
  }, [form.labor, labores]);

  // ── Scan IA: pipeline directo (sin pantalla intermedia) ───────────────────
  // Hidrata los nombres de display (tractor/implemento/lote/operario) cuando la
  // IA solo devuelve los IDs.
  const enrichLine = (fila) => {
    const next = { ...EMPTY_FORM, ...fila, id: null };
    if (next.tractorId) {
      const t = tractoresLista.find(x => x.id === next.tractorId);
      if (t) next.tractorNombre = t.descripcion;
    }
    if (next.implementoId) {
      const t = implementosLista.find(x => x.id === next.implementoId);
      if (t) next.implemento = t.descripcion;
    }
    if (next.loteId) {
      const l = lotes.find(x => x.id === next.loteId);
      if (l) next.loteNombre = l.nombreLote;
    }
    if (next.operarioId) {
      const u = usuarios.find(x => x.id === next.operarioId);
      if (u) next.operarioNombre = u.nombre;
    }
    return next;
  };

  // Carga 1+ filas en form (la primera) + pendingLines (el resto).
  const loadFilasIntoForm = (filas) => {
    if (!Array.isArray(filas) || filas.length === 0) return;
    const lines = filas.map((f, i) => ({ ...enrichLine(f), _no: i + 1 }));
    const [first, ...rest] = lines;
    setForm(first);
    setPendingLines(rest);
    saveDraft(first, false);
  };

  // Click "Leer con IA" → file picker → auto procesa → carga en form.
  const handleScanFile = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    setScanning(true);
    try {
      const imageData = await compressImage(file);
      const res = await apiFetch('/api/horimetro/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageData.base64, mediaType: imageData.mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error del servidor');
      const filas = data.filas || [];
      if (filas.length === 0) {
        showToast('La IA no encontró filas en la imagen.', 'error');
        return;
      }
      loadFilasIntoForm(filas);
      showToast(`${filas.length} fila(s) cargadas. Revisa los datos y guarda.`);
    } catch (err) {
      showToast(err.message || 'Error al escanear el formulario.', 'error');
    } finally {
      setScanning(false);
    }
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
  const sheetTitle = isEditing ? 'Editar registro de horímetro' : 'Registro de horímetro';
  const sheetSubtitle = isEditing
    ? 'Modifica los datos del registro existente.'
    : 'Captura horas trabajadas, ubicación y combustible para un activo.';

  return (
    <div className="machinery-page machinery-registro-page">
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
            <Link to="/operaciones/horimetro/historial" className="aur-chip aur-chip--ghost">
              <FiClock size={12} /> Historial
            </Link>
            {!isEditing && (
              <>
                <button
                  type="button"
                  className="aur-chip aur-chip--ai"
                  onClick={() => scanFileRef.current?.click()}
                  disabled={scanning || saving}
                  title="Leer formulario con IA"
                >
                  <FiCpu size={12} /> {scanning ? 'Leyendo…' : 'Leer con IA'}
                </button>
                <input
                  ref={scanFileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleScanFile}
                />
              </>
            )}
          </div>
        </header>

        {/* ═══════════════════════════════════════════════════════════════════
             FORM MODE
             ═══════════════════════════════════════════════════════════════════ */}
        <form onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Fecha y operario</h3>
              </div>
              <div className="machinery-form-grid">
                <div className="machinery-field machinery-field--no-label">
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
                <div className="machinery-field machinery-field--no-label">
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

            {pendingLines.length > 0 && (() => {
              // Lista combinada (pending + form) ordenada por _no estable.
              // El número visible es la posición en la lista — siempre 1..N.
              const allLines = [...pendingLines, form].sort((a, b) => (a._no || 0) - (b._no || 0));
              return (
                <section className="aur-section" ref={lineasSectionRef}>
                  <div className="aur-section-header">
                    <span className="aur-section-num">·</span>
                    <h3 className="aur-section-title">Líneas</h3>
                    <span className="aur-section-count">{allLines.length}</span>
                  </div>
                  <div className="machinery-pending-list">
                    {allLines.map((line, displayIdx) => {
                      const isActive = line._no === form._no;
                      const pendingIdx = isActive ? -1 : pendingLines.findIndex(p => p._no === line._no);
                      return (
                        <div
                          key={line._no ?? displayIdx}
                          className={`machinery-pending-item${isActive ? ' machinery-pending-item--active' : ''}`}
                        >
                          <span className="machinery-pending-num">{displayIdx + 1}</span>
                          {isActive ? (
                            <span className="machinery-pending-detail machinery-pending-detail--active">
                              Editando ahora
                            </span>
                          ) : (
                            <>
                              <span className="machinery-pending-detail">
                                {[line.labor, line.loteNombre, line.grupo].filter(Boolean).join(' · ') || '—'}
                              </span>
                              <span className="machinery-pending-times">
                                {line.horimetroInicial}–{line.horimetroFinal}
                                {(line.horaInicio || line.horaFinal) && ` · ${line.horaInicio || '?'}–${line.horaFinal || '?'}`}
                              </span>
                              <button
                                type="button"
                                className="aur-icon-btn aur-icon-btn--sm"
                                onClick={() => handleEditPendingLine(pendingIdx)}
                                title="Editar línea"
                              >
                                <FiEdit2 size={12} />
                              </button>
                              <button
                                type="button"
                                className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                                onClick={() => setPendingLines(prev => prev.filter((_, i) => i !== pendingIdx))}
                                title="Quitar línea"
                              >
                                <FiX size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Maquinaria</h3>
              </div>
              <div className="machinery-form-grid">
                <div className="machinery-field machinery-field--no-label">
                  <AuroraCombobox
                    value={form.tractorId}
                    onChange={handleTractorChange}
                    items={tractoresLista}
                    labelFn={tractorLabel}
                    placeholder="— Seleccionar tractor —"
                  />
                </div>
                <div className="machinery-field machinery-field--no-label">
                  <AuroraCombobox
                    value={form.implementoId}
                    onChange={handleImplementoChange}
                    items={implementosLista}
                    labelFn={tractorLabel}
                    placeholder="— Seleccionar implemento —"
                  />
                </div>
                <div className="machinery-field machinery-field--no-label">
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
                    placeholder="Horímetro inicial"
                  />
                </div>
                <div className="machinery-field machinery-field--no-label">
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
                    placeholder="Horímetro final"
                  />
                  {errHorimetro && (
                    <span className="machinery-field-error">El horímetro final debe ser mayor que el inicial.</span>
                  )}
                </div>
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
              <div className="machinery-form-grid">
                <div className="machinery-field machinery-field--no-label">
                  <select
                    id="rh-lote"
                    name="loteId"
                    className="aur-select"
                    value={form.loteId}
                    onChange={handleChange}
                  >
                    <option value="">— Seleccionar lote —</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                </div>
                <div className="machinery-field machinery-field--no-label">
                  <select
                    id="rh-grupo"
                    name="grupo"
                    className={`aur-select${!form.loteId ? ' machinery-select--locked' : ''}`}
                    value={form.grupo}
                    onChange={handleChange}
                    onMouseDown={(e) => {
                      if (!form.loteId) {
                        e.preventDefault();
                        showToast('Selecciona un lote primero', 'error');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (!form.loteId && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault();
                        showToast('Selecciona un lote primero', 'error');
                      }
                    }}
                  >
                    <option value="">— Selecciona un grupo —</option>
                    {gruposDelLote.map(g => (
                      <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                    ))}
                  </select>
                </div>
                <div className="machinery-field machinery-field--full machinery-field--no-label">
                  <div className="machinery-bloques-list">
                    {!form.grupo ? (
                      <p className="machinery-bloques-empty">Selecciona un grupo para ver sus bloques.</p>
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
              <div className="machinery-form-grid">
                <div className="machinery-field machinery-field--full machinery-field--no-label">
                  <AuroraCombobox
                    value={laborValue}
                    onChange={handleLaborChange}
                    items={labores}
                    labelFn={laborLabel}
                    placeholder="— Buscar labor —"
                  />
                </div>
                <div className="machinery-field machinery-field--inline">
                  <label className="machinery-field-label" htmlFor="rh-h-ini">Hora inicial:</label>
                  <div className="machinery-field-input-group">
                    <AuroraTimePicker
                      id="rh-h-ini"
                      name="horaInicio"
                      value={form.horaInicio}
                      onChange={handleTimeChange('horaInicio')}
                    />
                  </div>
                </div>
                <div className="machinery-field machinery-field--inline">
                  <label className="machinery-field-label" htmlFor="rh-h-fin">Hora final:</label>
                  <div className="machinery-field-input-group">
                    <AuroraTimePicker
                      id="rh-h-fin"
                      name="horaFinal"
                      value={form.horaFinal}
                      onChange={handleTimeChange('horaFinal')}
                      hasError={errHora}
                    />
                    {errHora && (
                      <span className="machinery-field-error">La hora final debe ser mayor que la inicial.</span>
                    )}
                  </div>
                </div>
                {form.horaInicio && form.horaFinal && form.horaFinal < form.horaInicio && (
                  <div className="machinery-field machinery-field--full">
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

            {!isEditing && (
              <div className="machinery-row-actions">
                <button type="button" className="machinery-add-row" onClick={handleAddLine}>
                  <FiPlus size={14} /> Agregar fila
                </button>
                <button type="button" className="machinery-add-row" onClick={handleClearActiveLine}>
                  <FiX size={14} /> {pendingLines.length > 0 ? 'Eliminar línea' : 'Limpiar línea'}
                </button>
              </div>
            )}

            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={resetForm}>
                Limpiar
              </button>
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : pendingLines.length > 0 ? `Guardar ${pendingLines.length + 1} líneas` : 'Registrar'}
              </button>
            </div>
        </form>
      </div>
    </div>
  );
}

export default RegistroHorimetro;
