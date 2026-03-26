import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { useLocation } from 'react-router-dom';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiCheck, FiX, FiShare2, FiDownload, FiEye, FiEdit2, FiThumbsUp, FiCheckCircle, FiFileText } from 'react-icons/fi';
import { useUser } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { useDraft, markDraftActive, clearDraftActive } from '../hooks/useDraft';
import Toast from '../components/Toast';
import './HR.css';
import './HrPlanillaPorUnidad.css';

const DRAFT_FORM_KEY = 'hr-planilla-unidad';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  return '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newSegId() {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
}

function newSegmento() {
  return { id: newSegId(), loteId: '', loteNombre: '', labor: '', grupo: '', avanceHa: '', unidad: '-', costoUnitario: '' };
}

const LaborCombobox = forwardRef(function LaborCombobox({ value, onChange, labores, onAfterSelect, onTabDown }, ref) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const filtered = labores.filter(l => {
    const q = (value || '').toLowerCase();
    return !q || String(l.codigo).includes(q) || (l.descripcion || '').toLowerCase().includes(q);
  });

  const selectOption = (labor) => {
    onChange(`${labor.codigo} - ${labor.descripcion}`);
    setOpen(false);
    setHighlighted(0);
    onAfterSelect?.();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); setHighlighted(0); e.preventDefault(); return; }
      if (e.key === 'Tab' && onTabDown) { onTabDown(e); return; }
      return;
    }
    if (e.key === 'Tab') { setOpen(false); if (onTabDown) onTabDown(e); return; }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => {
        const next = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => {
        const next = Math.max(h - 1, 0);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted]) { selectOption(filtered[highlighted]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="ut-ctrl"
        value={value}
        autoComplete="off"
        placeholder="Ej: Deshierva"
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} className="labor-dropdown">
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`labor-dropdown-item${i === highlighted ? ' labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(l)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="labor-dropdown-code">{l.codigo}</span>
              <span className="labor-dropdown-desc">{l.descripcion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const GrupoCombobox = forwardRef(function GrupoCombobox({ value, onChange, grupos, onAfterSelect, onTabDown }, ref) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const filtered = grupos.filter(g => {
    const q = (value || '').toLowerCase();
    return !q || (g.nombreGrupo || '').toLowerCase().includes(q);
  });

  const selectOption = (grupo) => {
    onChange(grupo.nombreGrupo);
    setOpen(false);
    setHighlighted(0);
    onAfterSelect?.();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); setHighlighted(0); e.preventDefault(); return; }
      if (e.key === 'Tab' && onTabDown) { onTabDown(e); return; }
      return;
    }
    if (e.key === 'Tab') { setOpen(false); if (onTabDown) onTabDown(e); return; }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => {
        const next = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => {
        const next = Math.max(h - 1, 0);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted]) { selectOption(filtered[highlighted]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="ut-ctrl"
        value={value}
        autoComplete="off"
        placeholder="Buscar grupo…"
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} className="labor-dropdown">
          {filtered.map((g, i) => (
            <li
              key={g.id}
              className={`labor-dropdown-item${i === highlighted ? ' labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(g)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="labor-dropdown-desc">{g.nombreGrupo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const UnidadCombobox = forwardRef(function UnidadCombobox({ value, onChange, unidades, onAfterSelect, onTabDown }, ref) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const filtered = unidades.filter(u => {
    const q = (value || '').toLowerCase();
    return !q || u.toLowerCase().includes(q);
  });

  const selectOption = (u) => {
    onChange(u);
    setOpen(false);
    setHighlighted(0);
    onAfterSelect?.();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); setHighlighted(0); e.preventDefault(); return; }
      if (e.key === 'Tab' && onTabDown) { onTabDown(e); return; }
      return;
    }
    if (e.key === 'Tab') { setOpen(false); if (onTabDown) onTabDown(e); return; }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => {
        const next = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => {
        const next = Math.max(h - 1, 0);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted] !== undefined) { selectOption(filtered[highlighted]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="ut-ctrl"
        value={value === '-' ? '' : value}
        autoComplete="off"
        placeholder="Buscar unidad…"
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} className="labor-dropdown">
          {filtered.map((u, i) => (
            <li
              key={u}
              className={`labor-dropdown-item${i === highlighted ? ' labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(u)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="labor-dropdown-desc">{u}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function HrPlanillaPorHora() {
  const { currentUser } = useUser();
  const apiFetch = useApiFetch();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const canAprobar = ['supervisor', 'administrador', 'rrhh'].includes(currentUser?.rol);
  const canPagar   = ['administrador', 'rrhh'].includes(currentUser?.rol);

  const [fecha, setFecha, clearFechaDraft] = useDraft('hr-planilla-fecha', todayStr);
  const [observaciones, setObservaciones, clearObsDraft] = useDraft('hr-planilla-observaciones', '');
  const [segmentos, setSegmentos, clearSegsDraft] = useDraft('hr-planilla-segmentos', () => [newSegmento()]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [cantidades, setCantidades, clearCantsDraft] = useDraft('hr-planilla-cantidades', {});
  const [fillAll, setFillAll] = useState({});
  const [lotes, setLotes] = useState([]);
  const [gruposCat, setGruposCat] = useState([]);
  const [laboresCat, setLaboresCat] = useState([]);
  const [unidadesCat, setUnidadesCat] = useState([]);
  const loteRefs = useRef({});
  const grupoRefs = useRef({});
  const laborRefs = useRef({});
  const avanceRefs = useRef({});
  const unidadRefs = useRef({});
  const costoRefs = useRef({});
  const cantidadRefs = useRef({});
  const nuevoSegmentoRef = useRef(null);
  const pendingFocusSegId = useRef(null);
  const [companyConfig, setCompanyConfig] = useState({ nombreEmpresa: '', logoUrl: '', identificacion: '', whatsapp: '', direccion: '' });
  const [guardando, setGuardando] = useState(false);
  const [planillaId, setPlanillaId] = useState(null);
  const [consecutivo, setConsecutivo] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [previewPlanilla, setPreviewPlanilla] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const previewRef = useRef(null);
  const [removedWorkerIds, setRemovedWorkerIds] = useState([]);
  const [historialTab, setHistorialTab] = useState('pendientes');
  const [plantillas, setPlantillas] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showSavePlantilla, setShowSavePlantilla] = useState(false);
  const [nombrePlantilla, setNombrePlantilla] = useState('');
  const [savingPlantilla, setSavingPlantilla] = useState(false);

  // Mark / clear the draft badge whenever form content changes
  useEffect(() => {
    const hasContent =
      observaciones.trim() !== '' ||
      segmentos.some(s => s.loteId || s.labor || s.grupo || s.avanceHa !== '' || s.costoUnitario !== '') ||
      Object.values(cantidades).some(segMap => Object.values(segMap || {}).some(v => v !== ''));
    if (hasContent) markDraftActive(DRAFT_FORM_KEY);
    else clearDraftActive(DRAFT_FORM_KEY);
  }, [observaciones, segmentos, cantidades]);

  const fetchHistorial = useCallback(() => {
    apiFetch('/api/hr/planilla-unidad')
      .then(r => r.json())
      .then(data => setHistorial(data.filter(p => p.estado !== 'pagada').slice(0, 12)))
      .catch(console.error);
  }, []);

  const fetchPlantillas = useCallback(() => {
    const encId = currentUser?.userId || currentUser?.uid;
    if (!encId) return;
    apiFetch(`/api/hr/plantillas-planilla?encargadoId=${encId}`)
      .then(r => r.json())
      .then(setPlantillas)
      .catch(console.error);
  }, [currentUser?.userId, currentUser?.uid]);

  useEffect(() => {
    apiFetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    apiFetch('/api/grupos').then(r => r.json()).then(setGruposCat).catch(console.error);
    apiFetch('/api/labores').then(r => r.json()).then(setLaboresCat).catch(console.error);
    apiFetch('/api/unidades-medida').then(r => r.json()).then(data => setUnidadesCat(Array.isArray(data) ? data.map(u => u.nombre) : [])).catch(console.error);
    apiFetch('/api/config').then(r => r.json()).then(data => setCompanyConfig({ nombreEmpresa: data.nombreEmpresa || '', logoUrl: data.logoUrl || '', identificacion: data.identificacion || '', whatsapp: data.whatsapp || '', direccion: data.direccion || '' })).catch(console.error);
    fetchHistorial();
  }, []);

  useEffect(() => { fetchPlantillas(); }, [fetchPlantillas]);

  // Load planilla draft from Aurora chat navigation state
  useEffect(() => {
    const draft = location.state?.planillaDraft;
    if (!draft) return;
    setSegmentos(draft.segmentos?.length ? draft.segmentos : [newSegmento()]);
    setFecha(draft.fecha || todayStr());
    setObservaciones(draft.observaciones || '');
    setPlanillaId(null);
    setConsecutivo(null);
    setFillAll({});
    setRemovedWorkerIds([]);
    // Rebuild cantidades from draft data keyed by trabajadorId
    setCantidades(prev => {
      const next = { ...prev };
      (draft.trabajadores || []).forEach(t => {
        if (t.trabajadorId) next[t.trabajadorId] = t.cantidades || {};
      });
      return next;
    });
    markDraftActive(DRAFT_FORM_KEY);
    setShowForm(true);
    showToast('Planilla cargada desde Aurora. Revisa y guarda cuando esté lista.');
    // Clear state so reload doesn't re-apply
    window.history.replaceState({}, '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const isAdmin = currentUser?.rol === 'administrador';
    if (!isAdmin && !currentUser?.userId) return;
    const url = isAdmin
      ? '/api/users'
      : `/api/hr/subordinados?encargadoId=${currentUser.userId}`;
    apiFetch(url)
      .then(r => r.json())
      .then(data => {
        const empleados = isAdmin ? data.filter(u => u.empleadoPlanilla) : data;
        setTrabajadores([...empleados].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es')));
        setCantidades(prev => {
          const next = { ...prev };
          empleados.forEach(t => { if (!next[t.id]) next[t.id] = {}; });
          return next;
        });
      })
      .catch(console.error);
  }, [currentUser?.userId, currentUser?.rol]);

  // Moves focus to the same field in the next/prev segment (horizontal — kept for worker rows)
  const makeTabHandler = (segId, refsObj) => (e) => {
    if (e.key !== 'Tab') return;
    const idx = segmentos.findIndex(s => s.id === segId);
    const next = segmentos[e.shiftKey ? idx - 1 : idx + 1];
    if (next) { e.preventDefault(); refsObj.current[next.id]?.focus(); }
  };

  // Moves focus vertically within the same segment column (Tab = down, Shift+Tab = up)
  const makeColTabHandler = (segId, prevRefsObj, nextRefsObj) => (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    if (e.shiftKey) prevRefsObj?.current[segId]?.focus();
    else nextRefsObj?.current[segId]?.focus();
  };

  const addSegmento = (focusNew = false) => {
    const seg = newSegmento();
    if (focusNew) pendingFocusSegId.current = seg.id;
    setSegmentos(prev => [...prev, seg]);
    setCantidades(prev => {
      const next = { ...prev };
      trabajadores.forEach(t => { next[t.id] = { ...(next[t.id] || {}), [seg.id]: '' }; });
      return next;
    });
  };

  useEffect(() => {
    if (pendingFocusSegId.current && loteRefs.current[pendingFocusSegId.current]) {
      loteRefs.current[pendingFocusSegId.current].focus();
      pendingFocusSegId.current = null;
    }
  }, [segmentos]);

  const removeSegmento = (segId) => {
    setSegmentos(prev => prev.filter(s => s.id !== segId));
    setCantidades(prev => {
      const next = {};
      Object.keys(prev).forEach(tId => {
        const { [segId]: _, ...rest } = prev[tId] || {};
        next[tId] = rest;
      });
      return next;
    });
  };

  const updSeg = (segId, field, value) => {
    setSegmentos(prev => prev.map(s => {
      if (s.id !== segId) return s;
      const u = { ...s, [field]: value };
      if (field === 'loteId') { u.loteNombre = lotes.find(l => l.id === value)?.nombreLote || ''; u.grupo = ''; }
      return u;
    }));
  };

  const setCantidad = (tId, segId, raw) => {
    setCantidades(prev => ({ ...prev, [tId]: { ...(prev[tId] || {}), [segId]: raw } }));
  };

  const visibleWorkers = trabajadores.filter(t => !removedWorkerIds.includes(t.id));

  const applyFillAll = (segId) => {
    const val = fillAll[segId];
    if (val === '' || val === undefined) return;
    setCantidades(prev => {
      const next = { ...prev };
      visibleWorkers.forEach(t => {
        next[t.id] = { ...(next[t.id] || {}), [segId]: val };
      });
      return next;
    });
  };

  const getCant = (tId, segId) => {
    const v = cantidades[tId]?.[segId];
    return v === '' || v === undefined ? 0 : Number(v);
  };

  const workerTotal = (tId) =>
    segmentos.reduce((sum, seg) => sum + getCant(tId, seg.id) * (Number(seg.costoUnitario) || 0), 0);

  const segCantTotal = (segId) =>
    visibleWorkers.reduce((sum, t) => sum + getCant(t.id, segId), 0);

  const totalGeneral = () => visibleWorkers.reduce((sum, t) => sum + workerTotal(t.id), 0);

  const handleGuardar = async (estado) => {
    const encId = currentUser?.userId || currentUser?.uid;
    if (!encId) {
      showToast('Tu cuenta no está vinculada a un perfil de empleado en el sistema.', 'error');
      return;
    }
    setGuardando(true);
    const body = {
      fecha,
      encargadoId: encId,
      encargadoNombre: currentUser.nombre || '',
      segmentos,
      trabajadores: visibleWorkers.map(t => ({
        trabajadorId: t.id, trabajadorNombre: t.nombre,
        cantidades: cantidades[t.id] || {}, total: workerTotal(t.id),
      })),
      totalGeneral: totalGeneral(),
      estado, observaciones,
    };
    try {
      let res;
      if (planillaId) {
        res = await apiFetch(`/api/hr/planilla-unidad/${planillaId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        res = await apiFetch('/api/hr/planilla-unidad', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          setPlanillaId(data.id);
          setConsecutivo(data.consecutivo);
        }
      }
      if (!res.ok) throw new Error();
      clearSegsDraft();
      clearCantsDraft();
      clearFechaDraft();
      clearObsDraft();
      clearDraftActive(DRAFT_FORM_KEY);
      setPlanillaId(null);
      setConsecutivo(null);
      setFillAll({});
      setRemovedWorkerIds([]);
      showToast(estado === 'borrador' ? 'Borrador guardado.' : 'Planilla guardada correctamente.');
      setShowForm(false);
      fetchHistorial();
    } catch {
      showToast('Error al guardar la planilla.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const generatePlanillaPdf = async (action) => {
    if (!previewRef.current || !previewPlanilla) return;
    setPdfLoading(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const docEl = previewRef.current;
      const headerEl = docEl.querySelector('.pu-pdoc-header');
      const [canvas, headerCanvas] = await Promise.all([
        html2canvas(docEl, {
          scale: 2, useCORS: true, backgroundColor: '#ffffff',
          width: docEl.scrollWidth, height: docEl.scrollHeight,
          windowWidth: docEl.scrollWidth, windowHeight: docEl.scrollHeight,
        }),
        headerEl ? html2canvas(headerEl, {
          scale: 2, useCORS: true, backgroundColor: '#ffffff',
          width: headerEl.scrollWidth, height: headerEl.scrollHeight,
        }) : Promise.resolve(null),
      ]);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      const headerH = headerCanvas ? (headerCanvas.height * pageW) / headerCanvas.width : 0;
      const headerImgData = headerCanvas ? headerCanvas.toDataURL('image/png') : null;

      // Page 1 fits pageH of content; subsequent pages fit (pageH - headerH) each
      const totalPages = imgH <= pageH ? 1 : 1 + Math.ceil((imgH - pageH) / (pageH - headerH));

      // Page 1 — full width, content from top
      pdf.addImage(imgData, 'PNG', 0, 0, pageW, imgH);
      pdf.setFontSize(8); pdf.setTextColor(150);
      pdf.text(`1 / ${totalPages} páginas`, pageW - 4, pageH - 3, { align: 'right' });

      // Pages 2+
      let contentY = pageH;
      let pageNum = 2;
      while (contentY < imgH) {
        pdf.addPage();
        // Content first (shifted so contentY appears just below the header)
        pdf.addImage(imgData, 'PNG', 0, headerH - contentY, pageW, imgH);
        // Header drawn on top to cover any overlap
        if (headerImgData) pdf.addImage(headerImgData, 'PNG', 0, 0, pageW, headerH);
        pdf.setFontSize(8); pdf.setTextColor(150);
        pdf.text(`${pageNum} / ${totalPages} páginas`, pageW - 4, pageH - 3, { align: 'right' });
        contentY += pageH - headerH;
        pageNum++;
      }
      const filename = `Planilla-${previewPlanilla.consecutivo || 'sin-numero'}.pdf`;
      if (action === 'save') {
        pdf.save(filename);
      } else {
        const blob = pdf.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename }); } catch {}
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename; a.click();
          URL.revokeObjectURL(url);
          showToast('PDF descargado');
        }
      }
    } catch {
      showToast('No se pudo generar el PDF.', 'error');
    } finally {
      setPdfLoading(false);
    }
  };

  const EDITABLE_STATES = ['borrador', 'pendiente'];

  const handleAprobar = async (p, e) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/hr/planilla-unidad/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'aprobada' }),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla aprobada.');
      fetchHistorial();
    } catch {
      showToast('Error al aprobar la planilla.', 'error');
    }
  };

  const handlePagar = async (p, e) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/hr/planilla-unidad/${p.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'pagada' }),
      });
      if (!res.ok) throw new Error();
      showToast('Planilla marcada como pagada.');
      fetchHistorial();
    } catch {
      showToast('Error al pagar la planilla.', 'error');
    }
  };

  const handleEliminar = async (p, e) => {
    e.stopPropagation();
    if (!window.confirm(`¿Eliminar la planilla ${p.consecutivo || ''}? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await apiFetch(`/api/hr/planilla-unidad/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      // Si la planilla eliminada estaba cargada en el formulario, limpiar
      if (planillaId === p.id) {
        clearSegsDraft(); clearCantsDraft(); clearFechaDraft(); clearObsDraft();
        clearDraftActive(DRAFT_FORM_KEY);
        setPlanillaId(null); setConsecutivo(null); setFillAll({}); setRemovedWorkerIds([]);
      }
      showToast('Planilla eliminada.');
      fetchHistorial();
    } catch {
      showToast('Error al eliminar la planilla.', 'error');
    }
  };

  const handleGuardarPlantilla = async () => {
    const nombre = nombrePlantilla.trim();
    const encId = currentUser?.userId || currentUser?.uid;
    if (!nombre || !encId) return;
    setSavingPlantilla(true);
    try {
      const res = await apiFetch('/api/hr/plantillas-planilla', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        nombre,
        segmentos,
        trabajadores: visibleWorkers.map(t => ({ trabajadorId: t.id, cantidades: cantidades[t.id] || {} })),
        encargadoId: encId,
      }),
      });
      if (!res.ok) throw new Error();
      setNombrePlantilla('');
      setShowSavePlantilla(false);
      showToast('Plantilla guardada.');
      fetchPlantillas();
    } catch {
      showToast('Error al guardar plantilla.', 'error');
    } finally {
      setSavingPlantilla(false);
    }
  };

  const handleEliminarPlantilla = async (p) => {
    if (!window.confirm(`¿Eliminar la plantilla "${p.nombre}"?`)) return;
    try {
      const res = await apiFetch(`/api/hr/plantillas-planilla/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Plantilla eliminada.');
      fetchPlantillas();
    } catch {
      showToast('Error al eliminar plantilla.', 'error');
    }
  };

  const applyPlantilla = (p) => {
    // Reassign new IDs and build a map old→new for remapping cantidades
    const idMap = {};
    const newSegs = (p.segmentos || []).map(s => {
      const newId = newSegId();
      idMap[s.id] = newId;
      return { ...s, id: newId };
    });
    setSegmentos(newSegs);
    const newCantidades = {};
    trabajadores.forEach(t => {
      const saved = (p.trabajadores || []).find(pt => pt.trabajadorId === t.id);
      newCantidades[t.id] = {};
      newSegs.forEach(s => {
        // Find which old segment ID maps to this new one
        const oldId = Object.keys(idMap).find(k => idMap[k] === s.id);
        newCantidades[t.id][s.id] = saved?.cantidades?.[oldId] ?? '';
      });
    });
    setCantidades(newCantidades);
    setFillAll({});
    setRemovedWorkerIds([]);
    markDraftActive(DRAFT_FORM_KEY);
    setShowForm(true);
    showToast(`Plantilla "${p.nombre}" cargada.`);
  };

  const loadPlanilla = (p) => {
    setSegmentos(p.segmentos || [newSegmento()]);
    // Rebuild cantidades keyed by current worker ids; fall back to saved data
    const newCantidades = {};
    trabajadores.forEach(t => {
      const saved = (p.trabajadores || []).find(pt => pt.trabajadorId === t.id);
      newCantidades[t.id] = saved?.cantidades || {};
    });
    setCantidades(newCantidades);
    setFecha(p.fecha ? p.fecha.split('T')[0] : todayStr());
    setObservaciones(p.observaciones || '');
    setPlanillaId(p.id);
    setConsecutivo(p.consecutivo);
    setFillAll({});
    setRemovedWorkerIds([]);
    markDraftActive(DRAFT_FORM_KEY);
    setShowForm(true);
  };

  const CONFIG_ROWS = 6; // lote, labor, grupo, avance, unidad, costo

  const ESTADO_LABEL = { borrador: 'Borrador', pendiente: 'Pendiente', aprobada: 'Aprobada', pagada: 'Pagada' };
  const ESTADO_CLASS = { borrador: 'otro', pendiente: 'pendiente', aprobada: 'aprobado', pagada: 'active' };

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Vista previa de planilla ── */}
      {previewPlanilla && (
        <div className="pu-preview-overlay" onClick={e => { if (e.target === e.currentTarget) setPreviewPlanilla(null); }}>
          <div className="pu-preview-modal">
            <div className="pu-preview-modal-header">
              <div className="pu-preview-modal-title">
                Vista previa
                {previewPlanilla.consecutivo && (
                  <span className="pu-preview-consec">{previewPlanilla.consecutivo}</span>
                )}
              </div>
              <div className="pu-preview-modal-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => generatePlanillaPdf('share')} disabled={pdfLoading}>
                  <FiShare2 size={14} /> Compartir
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => generatePlanillaPdf('save')} disabled={pdfLoading}>
                  <FiDownload size={14} /> {pdfLoading ? 'Generando…' : 'Guardar PDF / Imprimir'}
                </button>
                <button className="icon-btn" onClick={() => setPreviewPlanilla(null)} title="Cerrar">
                  <FiX size={18} />
                </button>
              </div>
            </div>

            <div className="pu-preview-scroll">
              <div className="pu-preview-document" ref={previewRef}>
                {/* Encabezado */}
                <div className="pu-pdoc-header">
                  <div className="pu-pdoc-brand">
                    <div className="pu-pdoc-logo">
                      {companyConfig.logoUrl
                        ? <img src={companyConfig.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 4 }} />
                        : (companyConfig.nombreEmpresa
                            ? companyConfig.nombreEmpresa.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                            : 'AU')}
                    </div>
                    <div className="pu-pdoc-brand-info">
                      <div className="pu-pdoc-brand-name">{companyConfig.nombreEmpresa || 'Finca Aurora'}</div>
                      {companyConfig.identificacion && <div className="pu-pdoc-brand-detail">Identificación: {companyConfig.identificacion}</div>}
                      {companyConfig.whatsapp && <div className="pu-pdoc-brand-detail">Teléfono: {companyConfig.whatsapp}</div>}
                      {companyConfig.direccion && <div className="pu-pdoc-brand-detail">Dirección: {companyConfig.direccion}</div>}
                    </div>
                  </div>
                  <div className="pu-pdoc-title-block">
                    <div className="pu-pdoc-title">Planilla por Unidad / Hora</div>
                    <table className="pu-pdoc-meta-table">
                      <tbody>
                        <tr><td>N°:</td><td><strong>{previewPlanilla.consecutivo || '—'}</strong></td></tr>
                        <tr>
                          <td>Fecha:</td>
                          <td><strong>{previewPlanilla.fecha ? new Date(previewPlanilla.fecha).toLocaleDateString('es-CR') : '—'}</strong></td>
                        </tr>
                        <tr>
                          <td>Encargado:</td>
                          <td><strong>{previewPlanilla.encargadoNombre || '—'}</strong></td>
                        </tr>
                        <tr>
                          <td>Estado:</td>
                          <td>
                            <span className={`pu-pdoc-estado pu-pdoc-estado--${previewPlanilla.estado}`}>
                              {ESTADO_LABEL[previewPlanilla.estado] || previewPlanilla.estado}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Tabla unificada — misma disposición que el formulario */}
                {(() => {
                  const segs = previewPlanilla.segmentos || [];
                  const workers = (previewPlanilla.trabajadores || [])
                    .filter(t => Object.values(t.cantidades || {}).some(v => v && Number(v) !== 0));
                  const compactLabor = segs.length > 4;
                  // Parse "220 - GUARDA DE SEGURIDAD" → { codigo: '220', descripcion: 'GUARDA DE SEGURIDAD' }
                  const parsedLabores = segs.map(seg => {
                    const raw = seg.labor || '';
                    const dash = raw.indexOf(' - ');
                    return dash !== -1
                      ? { codigo: raw.slice(0, dash).trim(), descripcion: raw.slice(dash + 3).trim() }
                      : { codigo: raw, descripcion: '' };
                  });
                  // Unique labores for the legend (deduplicated by codigo)
                  const laborLegend = compactLabor
                    ? [...new Map(parsedLabores.filter(l => l.codigo).map(l => [l.codigo, l])).values()]
                    : [];
                  return (
                    <>
                    <table className="pu-pdoc-table pu-pdoc-unified">
                      <colgroup>
                        <col className="pu-pdoc-col-label" />
                        {segs.map((_, i) => <col key={i} />)}
                        <col className="pu-pdoc-col-total" />
                      </colgroup>
                      <tbody>
                        {/* LOTE */}
                        <tr>
                          <td className="pu-pdoc-label-cell">LOTE</td>
                          {segs.map((seg, i) => <td key={i}>{seg.loteNombre || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* GRUPO */}
                        <tr>
                          <td className="pu-pdoc-label-cell">GRUPO</td>
                          {segs.map((seg, i) => <td key={i}>{seg.grupo || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* LABOR */}
                        <tr>
                          <td className="pu-pdoc-label-cell">LABOR</td>
                          {parsedLabores.map((l, i) => (
                            <td key={i}>
                              {l.codigo
                                ? compactLabor ? l.codigo : `${l.codigo} - ${l.descripcion}`
                                : '—'}
                            </td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* AVANCE */}
                        <tr>
                          <td className="pu-pdoc-label-cell">AVANCE (Ha)</td>
                          {segs.map((seg, i) => (
                            <td key={i}>{seg.avanceHa !== '' && seg.avanceHa != null ? seg.avanceHa : '—'}</td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* UNIDAD */}
                        <tr>
                          <td className="pu-pdoc-label-cell">UNIDAD</td>
                          {segs.map((seg, i) => <td key={i}>{seg.unidad || '—'}</td>)}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* COSTO UNITARIO */}
                        <tr className="pu-pdoc-row-config-last">
                          <td className="pu-pdoc-label-cell">COSTO UNITARIO</td>
                          {segs.map((seg, i) => (
                            <td key={i}>{seg.costoUnitario ? fmtMoney(seg.costoUnitario) : '—'}</td>
                          ))}
                          <td className="pu-pdoc-label-cell" />
                        </tr>

                        {/* Encabezado de trabajadores */}
                        <tr className="pu-pdoc-row-workers-hdr">
                          <td className="pu-pdoc-label-cell pu-pdoc-workers-label">NOMBRE</td>
                          {segs.map((_, i) => (
                            <td key={i} className="pu-pdoc-workers-qty-hdr">CANTIDAD</td>
                          ))}
                          <td className="pu-pdoc-workers-total-hdr">TOTAL GENERAL</td>
                        </tr>

                        {/* Trabajadores */}
                        {workers.map(t => (
                          <tr key={t.trabajadorId} className="pu-pdoc-row-worker">
                            <td className="pu-pdoc-worker-name">{t.trabajadorNombre}</td>
                            {segs.map((seg, i) => (
                              <td key={i} className="pu-pdoc-td-center">
                                {t.cantidades?.[seg.id] || '—'}
                              </td>
                            ))}
                            <td className="pu-pdoc-td-right pu-pdoc-td-bold">{fmtMoney(t.total)}</td>
                          </tr>
                        ))}

                        {/* Totales */}
                        <tr className="pu-pdoc-row-totals">
                          <td className="pu-pdoc-label-cell">TOTALES</td>
                          {segs.map((seg, i) => {
                            const sum = workers.reduce((acc, t) => {
                              const v = t.cantidades?.[seg.id];
                              return acc + (v && Number(v) !== 0 ? Number(v) : 0);
                            }, 0);
                            return (
                              <td key={i} className="pu-pdoc-td-center">
                                {sum > 0 ? sum.toLocaleString('es-CR', { maximumFractionDigits: 2 }) : '—'}
                              </td>
                            );
                          })}
                          <td className="pu-pdoc-td-right pu-pdoc-td-bold pu-pdoc-grand-total-cell">
                            {fmtMoney(previewPlanilla.totalGeneral)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {compactLabor && laborLegend.length > 0 && (
                      <div className="pu-pdoc-labor-legend">
                        <span className="pu-pdoc-labor-legend-title">Labores: </span>
                        {laborLegend.map((l, i) => (
                          <span key={l.codigo} className="pu-pdoc-labor-legend-item">
                            <strong>{l.codigo}</strong>{l.descripcion ? `: ${l.descripcion}` : ''}
                            {i < laborLegend.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    </>
                  );
                })()}

                {/* Observaciones */}
                {previewPlanilla.observaciones && (
                  <div style={{ marginTop: 14 }}>
                    <div className="pu-pdoc-section-label">Observaciones</div>
                    <p className="pu-pdoc-obs-text">{previewPlanilla.observaciones}</p>
                  </div>
                )}

                <div className="pu-pdoc-footer">
                  Generado por Aurora · {new Date().toLocaleDateString('es-CR')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <FiPlus size={15} /> Nueva planilla
          </button>
        )}
      </div>

      <div className="pu-page-layout">
      {/* ── Columna principal (3/4) ── */}
      {!showForm && (
        <div className="pu-main-col">
          <div className="form-card pu-empty-state-card">
            <FiFileText size={36} style={{ opacity: 0.2, marginBottom: 12 }} />
            <p style={{ margin: 0, opacity: 0.5, fontSize: '0.95rem' }}>
              Edita una planilla existente o crea una nueva en el botón <strong>"Nueva planilla"</strong>.
            </p>
          </div>
        </div>
      )}
      {showForm && <div className="pu-main-col">

      {/* ── Sección 1: Encabezado (Fecha + Encargado) ── */}
      <div className="form-card pu-section-card pu-section-header-card">
        <div className="pu-section-title-row">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            Planilla por Unidad / Hora
            {consecutivo && <span className="status-badge status-badge--pendiente" style={{ marginLeft: 10 }}>{consecutivo}</span>}
          </h2>
        </div>
        {currentUser && !currentUser.userId && currentUser.rol !== 'administrador' && (
          <div className="pu-warning">
            Tu cuenta no está vinculada a un perfil de empleado. Pide a un administrador que registre tu usuario con el mismo correo.
          </div>
        )}
        <div className="pu-header-fields">
          <div className="pu-hf-row">
            <span className="pu-hf-label">FECHA</span>
            <input
              className="ut-ctrl ut-ctrl--date"
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
            />
          </div>
          <div className="pu-hf-row">
            <span className="pu-hf-label">ENCARGADO</span>
            <input className="ut-ctrl input-readonly" value={currentUser?.nombre || '—'} readOnly />
          </div>
        </div>
      </div>

      {/* ── Sección 2: Cuerpo de segmentos ── */}
      <div className="form-card pu-table-card pu-section-card pu-section-body-card">
        <div className="pu-table-toolbar">
          <button ref={nuevoSegmentoRef} className="btn btn-secondary btn-sm" onClick={() => addSegmento(true)}>
            <FiPlus size={14} /> Agregar segmento
          </button>
        </div>

        <div className="unidad-table-wrap">
          <table className="unidad-table">
            <colgroup>
              <col style={{ width: 170 }} />
              {segmentos.map(s => <col key={s.id} style={{ minWidth: 150 }} />)}
              <col style={{ width: 130 }} />
            </colgroup>
            <tbody>

              {/* ── Encabezados de segmentos ── */}
              <tr className="ut-row-seg-title">
                <td className="ut-label-cell" />
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className="ut-seg-title-cell">
                    <span className="ut-seg-num">#{idx + 1}</span>
                    {segmentos.length > 1 && (
                      <button className="icon-btn delete ut-del-btn" onClick={() => removeSegmento(seg.id)} title="Eliminar segmento">
                        <FiTrash2 size={13} />
                      </button>
                    )}
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LOTE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LOTE</td>
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className={"ut-config-cell"}>
                    <select
                      ref={el => { loteRefs.current[seg.id] = el; }}
                      className="ut-ctrl" value={seg.loteId}
                      onKeyDown={makeColTabHandler(seg.id, null, grupoRefs)}
                      onChange={e => {
                        updSeg(seg.id, 'loteId', e.target.value);
                        grupoRefs.current[seg.id]?.focus();
                      }}>
                      <option value="">— Seleccionar —</option>
                      {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                    </select>
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── GRUPO ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">GRUPO</td>
                {segmentos.map((seg, idx) => {
                  const paqueteId = lotes.find(l => l.id === seg.loteId)?.paqueteId;
                  const gruposFiltrados = paqueteId
                    ? gruposCat.filter(g => g.paqueteId === paqueteId)
                    : gruposCat;
                  return (
                    <td key={seg.id} className="ut-config-cell">
                      <GrupoCombobox
                        ref={el => { grupoRefs.current[seg.id] = el; }}
                        value={seg.grupo}
                        grupos={gruposFiltrados}
                        onChange={v => updSeg(seg.id, 'grupo', v)}
                        onAfterSelect={() => laborRefs.current[seg.id]?.focus()}
                        onTabDown={makeColTabHandler(seg.id, loteRefs, laborRefs)}
                      />
                    </td>
                  );
                })}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LABOR ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LABOR</td>
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className={"ut-config-cell"}>
                    <LaborCombobox
                      ref={el => { laborRefs.current[seg.id] = el; }}
                      value={seg.labor}
                      labores={laboresCat}
                      onChange={v => updSeg(seg.id, 'labor', v)}
                      onAfterSelect={() => avanceRefs.current[seg.id]?.focus()}
                      onTabDown={makeColTabHandler(seg.id, grupoRefs, avanceRefs)}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── AVANCE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">AVANCE (Ha)</td>
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className={"ut-config-cell"}>
                    <input
                      ref={el => { avanceRefs.current[seg.id] = el; }}
                      className="ut-ctrl" type="number" min="0" step="0.01"
                      value={seg.avanceHa} onChange={e => updSeg(seg.id, 'avanceHa', e.target.value)}
                      placeholder="0.00"
                      onKeyDown={e => {
                        if (e.key === 'Tab') { makeColTabHandler(seg.id, laborRefs, unidadRefs)(e); return; }
                        if (e.key === 'Enter') { e.preventDefault(); unidadRefs.current[seg.id]?.focus(); }
                      }}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── UNIDAD ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">UNIDAD</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <UnidadCombobox
                      ref={el => { unidadRefs.current[seg.id] = el; }}
                      value={seg.unidad}
                      unidades={unidadesCat}
                      onChange={v => updSeg(seg.id, 'unidad', v)}
                      onAfterSelect={() => costoRefs.current[seg.id]?.focus()}
                      onTabDown={makeColTabHandler(seg.id, avanceRefs, costoRefs)}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── COSTO UNITARIO ── */}
              <tr className="ut-row-config ut-row-config--last">
                <td className="ut-label-cell">COSTO UNITARIO</td>
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className={"ut-config-cell"}>
                    <input
                      ref={el => { costoRefs.current[seg.id] = el; }}
                      className="ut-ctrl" type="number" min="0" step="any"
                      value={seg.costoUnitario} onChange={e => updSeg(seg.id, 'costoUnitario', e.target.value)}
                      placeholder="0"
                      onKeyDown={e => {
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          if (e.shiftKey) { unidadRefs.current[seg.id]?.focus(); return; }
                          const firstT = visibleWorkers[0];
                          if (firstT) cantidadRefs.current[seg.id]?.[firstT.id]?.focus();
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const firstT = visibleWorkers[0];
                          if (firstT) cantidadRefs.current[seg.id]?.[firstT.id]?.focus();
                        }
                      }}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── Encabezado de sección trabajadores ── */}
              <tr className="ut-row-workers-header">
                <td className="ut-label-cell">NOMBRE</td>
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className={"ut-workers-col-header"}>
                    <div className="ut-col-header-label">Cantidad</div>
                    <div className="ut-fill-all">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="= todos"
                        className="ut-fill-input"
                        value={fillAll[seg.id] ?? ''}
                        onChange={e => setFillAll(prev => ({ ...prev, [seg.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            applyFillAll(seg.id);
                            cantidadRefs.current[seg.id]?.[visibleWorkers[0]?.id]?.focus();
                          }
                        }}
                      />
                      <button
                        className="ut-fill-btn"
                        title="Aplicar a todos"
                        onClick={() => applyFillAll(seg.id)}
                      >
                        <FiCheck size={11} />
                      </button>
                    </div>
                  </td>
                ))}
                <td className="ut-workers-col-header ut-total-col-header">TOTAL GENERAL</td>
              </tr>

              {/* ── Trabajadores ── */}
              {trabajadores.length === 0 ? (
                <tr>
                  <td colSpan={segmentos.length + 2} className="ut-empty-row">
                    No hay trabajadores asignados. Ve a <strong>Gestión de Usuarios</strong> y selecciona este encargado en la ficha de cada trabajador.
                  </td>
                </tr>
              ) : visibleWorkers.length === 0 ? (
                <tr>
                  <td colSpan={segmentos.length + 2} className="ut-empty-row">
                    Todos los trabajadores están ocultos.
                  </td>
                </tr>
              ) : (
                visibleWorkers.map(t => (
                  <tr key={t.id} className="ut-row-worker">
                    <td className="ut-worker-name">
                      <div className="ut-worker-name-inner">
                        <button
                          className="ut-remove-worker-btn"
                          title="Quitar de esta planilla"
                          onClick={() => setRemovedWorkerIds(prev => [...prev, t.id])}
                        >
                          <FiX size={10} />
                        </button>
                        {t.nombre}
                      </div>
                    </td>
                    {segmentos.map((seg, idx) => (
                      <td key={seg.id} className={"ut-cant-cell"}>
                        <input
                          ref={el => {
                            if (!cantidadRefs.current[seg.id]) cantidadRefs.current[seg.id] = {};
                            cantidadRefs.current[seg.id][t.id] = el;
                          }}
                          type="number" min="0" step="0.01"
                          value={cantidades[t.id]?.[seg.id] ?? ''}
                          onChange={e => setCantidad(t.id, seg.id, e.target.value)}
                          onKeyDown={e => {
                            const idx = visibleWorkers.findIndex(w => w.id === t.id);
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              if (!e.shiftKey) {
                                // TAB → siguiente trabajador (misma columna)
                                const next = visibleWorkers[idx + 1];
                                if (next) cantidadRefs.current[seg.id]?.[next.id]?.focus();
                              } else {
                                // Shift+TAB → trabajador anterior (misma columna)
                                const prev = visibleWorkers[idx - 1];
                                if (prev) cantidadRefs.current[seg.id]?.[prev.id]?.focus();
                              }
                            } else if (e.key === 'Enter') {
                              e.preventDefault();
                              const nextWorker = visibleWorkers[idx + 1];
                              if (nextWorker) {
                                cantidadRefs.current[seg.id]?.[nextWorker.id]?.focus();
                              } else {
                                const segIdx = segmentos.findIndex(s => s.id === seg.id);
                                const nextSeg = segmentos[segIdx + 1];
                                if (nextSeg) {
                                  loteRefs.current[nextSeg.id]?.focus();
                                } else {
                                  nuevoSegmentoRef.current?.focus();
                                }
                              }
                            }
                          }}
                          className="ut-cant-input"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="ut-worker-total">{fmtMoney(workerTotal(t.id))}</td>
                  </tr>
                ))
              )}

              {/* ── Fila de totales ── */}
              {visibleWorkers.length > 0 && (
                <tr className="ut-row-totals">
                  <td className="ut-label-cell">TOTALES</td>
                  {segmentos.map((seg, idx) => (
                    <td key={seg.id} className={"ut-cant-cell ut-total-cant"}>
                      {segCantTotal(seg.id) > 0
                        ? segCantTotal(seg.id).toLocaleString('es-CR', { maximumFractionDigits: 2 })
                        : '—'}
                    </td>
                  ))}
                  <td className="ut-worker-total ut-grand-total">{fmtMoney(totalGeneral())}</td>
                </tr>
              )}

            </tbody>
          </table>
        </div>

        {removedWorkerIds.length > 0 && (
          <div className="ut-hidden-workers-bar">
            <span>
              {removedWorkerIds.length} trabajador{removedWorkerIds.length !== 1 ? 'es' : ''} oculto{removedWorkerIds.length !== 1 ? 's' : ''}
            </span>
            <button className="ut-restore-btn" onClick={() => setRemovedWorkerIds([])}>
              Restaurar todos
            </button>
          </div>
        )}

      </div>{/* /pu-section-body-card */}

      {/* ── Sección 3: Observaciones + acciones ── */}
      <div className="form-card pu-section-card pu-section-footer-card">
        <div className="form-control">
          <label>Observaciones</label>
          <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Notas adicionales..." rows={3} />
        </div>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => handleGuardar('borrador')} disabled={guardando}>
            Guardar borrador
          </button>
          <button className="btn btn-primary" onClick={() => handleGuardar('pendiente')} disabled={guardando || trabajadores.length === 0}>
            <FiSave size={15} />
            {guardando ? 'Guardando…' : 'Guardar planilla'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              clearSegsDraft();
              clearCantsDraft();
              clearFechaDraft();
              clearObsDraft();
              clearDraftActive(DRAFT_FORM_KEY);
              setPlanillaId(null);
              setConsecutivo(null);
              setFillAll({});
              setRemovedWorkerIds([]);
              setShowForm(false);
            }}
            disabled={guardando}
          >
            Cancelar
          </button>
        </div>
      </div>
      </div>}{/* /pu-main-col */}

      {/* ── Panel lateral: Historial / Plantillas ── */}
      <div className="pu-history-col">
        <div className="form-card pu-history-card">

          {/* Tabs */}
          <div className="pu-panel-tabs">
            <button
              className={`pu-panel-tab${historialTab === 'pendientes' ? ' pu-panel-tab--active' : ''}`}
              onClick={() => setHistorialTab('pendientes')}
            >
              Pendientes
            </button>
            <button
              className={`pu-panel-tab${historialTab === 'plantillas' ? ' pu-panel-tab--active' : ''}`}
              onClick={() => setHistorialTab('plantillas')}
            >
              Plantillas
            </button>
            {historialTab === 'pendientes' && (
              <button className="icon-btn" onClick={fetchHistorial} title="Actualizar" style={{ marginLeft: 'auto' }}>
                <FiRefreshCw size={14} />
              </button>
            )}
          </div>

          {/* ── Tab Pendientes ── */}
          {historialTab === 'pendientes' && (
            historial.length === 0 ? (
              <p className="empty-state" style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>
                No hay planillas para editar. Crea una dando click en el botón "Nueva planilla".
              </p>
            ) : (
              <ul className="pu-history-list">
                {historial.map(p => {
                  const editable = EDITABLE_STATES.includes(p.estado);
                  return (
                  <li
                    key={p.id}
                    className={`pu-history-item${editable ? ' pu-history-item--editable' : ''}${planillaId === p.id ? ' pu-history-item--active' : ''}`}
                    onClick={editable ? () => loadPlanilla(p) : undefined}
                    title={editable ? 'Clic para cargar y editar' : undefined}
                  >
                    <div className="pu-history-top">
                      <span className="pu-history-consec">{p.consecutivo || '—'}</span>
                      <span className={`status-badge status-badge--${ESTADO_CLASS[p.estado] || 'pendiente'}`}>
                        {ESTADO_LABEL[p.estado] || p.estado}
                      </span>
                      {editable && <FiEdit2 size={11} className="pu-history-edit-icon" />}
                    </div>
                    <div className="pu-history-encargado">{p.encargadoNombre || '—'}</div>
                    <div className="pu-history-meta">
                      {p.fecha ? new Date(p.fecha).toLocaleDateString('es-CR') : '—'}
                      {' · '}
                      {p.segmentos?.length || 0} segmento{p.segmentos?.length !== 1 ? 's' : ''}
                      {' · '}
                      {p.trabajadores?.length || 0} trab.
                    </div>
                    <div className="pu-history-bottom">
                      <span className="pu-history-total">
                        ₡{Number(p.totalGeneral || 0).toLocaleString('es-CR')}
                      </span>
                      <div className="pu-history-actions">
                        {editable && (
                          <button
                            className="pu-history-delete-btn"
                            onClick={e => handleEliminar(p, e)}
                            title="Eliminar planilla"
                          >
                            <FiTrash2 size={13} />
                          </button>
                        )}
                        {p.estado === 'pendiente' && canAprobar && (
                          <button
                            className="pu-history-preview-btn"
                            style={{ color: '#5599ff', borderColor: 'rgba(51,153,255,0.3)' }}
                            onClick={e => handleAprobar(p, e)}
                            title="Aprobar planilla"
                          >
                            <FiThumbsUp size={13} /> Aprobar
                          </button>
                        )}
                        {p.estado === 'aprobada' && canPagar && (
                          <button
                            className="pu-history-preview-btn"
                            style={{ color: 'var(--aurora-green)', borderColor: 'rgba(51,255,153,0.3)' }}
                            onClick={e => handlePagar(p, e)}
                            title="Pagar planilla"
                          >
                            <FiCheckCircle size={13} /> Pagar
                          </button>
                        )}
                        <button
                          className="pu-history-preview-btn"
                          onClick={e => { e.stopPropagation(); setPreviewPlanilla(p); }}
                          title="Ver vista previa"
                        >
                          <FiEye size={13} /> Ver
                        </button>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )
          )}

          {/* ── Tab Plantillas ── */}
          {historialTab === 'plantillas' && (
            <div className="pu-plantillas-tab">
              {!showSavePlantilla ? (
                <button
                  className="pu-save-plantilla-btn"
                  onClick={() => setShowSavePlantilla(true)}
                >
                  <FiPlus size={13} /> Guardar segmentos actuales como plantilla
                </button>
              ) : (
                <div className="pu-plantilla-name-form">
                  <input
                    className="pu-plantilla-name-input"
                    placeholder="Nombre de la plantilla…"
                    value={nombrePlantilla}
                    onChange={e => setNombrePlantilla(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleGuardarPlantilla();
                      if (e.key === 'Escape') { setShowSavePlantilla(false); setNombrePlantilla(''); }
                    }}
                    autoFocus
                  />
                  <div className="pu-plantilla-name-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleGuardarPlantilla}
                      disabled={!nombrePlantilla.trim() || savingPlantilla}
                    >
                      {savingPlantilla ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setShowSavePlantilla(false); setNombrePlantilla(''); }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {plantillas.length === 0 ? (
                <p className="empty-state" style={{ fontSize: '0.82rem' }}>
                  No hay plantillas guardadas.
                </p>
              ) : (
                <ul className="pu-plantilla-list">
                  {plantillas.map(p => (
                    <li key={p.id} className="pu-plantilla-item">
                      <div className="pu-plantilla-nombre">{p.nombre}</div>
                      <div className="pu-plantilla-meta">
                        {p.segmentos?.length || 0} segmento{p.segmentos?.length !== 1 ? 's' : ''}
                      </div>
                      <div className="pu-plantilla-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => applyPlantilla(p)}
                        >
                          Usar plantilla
                        </button>
                        <button
                          className="pu-history-delete-btn"
                          onClick={() => handleEliminarPlantilla(p)}
                          title="Eliminar plantilla"
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

        </div>
      </div>

      </div>{/* /pu-page-layout */}
    </div>
  );
}

export default HrPlanillaPorHora;
