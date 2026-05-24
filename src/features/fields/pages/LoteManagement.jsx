import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import '../styles/lote-management.css';
import { FiEdit, FiTrash2, FiPlus, FiCalendar, FiLayers, FiPackage, FiChevronRight, FiArrowLeft, FiSliders, FiX, FiEye, FiShare2, FiPrinter, FiSearch, FiAlertTriangle, FiRefreshCw, FiCheck } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import PageHeader from '../../../components/PageHeader';
import { useApiFetch } from '../../../hooks/useApiFetch';
import LoteFormModal from '../components/LoteFormModal';
import BloqueSortTh from '../components/BloqueSortTh';
import { formatDate, formatDateLong, multiSort } from '../lib/lotes-helpers';

const LOTE_BLOQUE_COLS = [
  { id: 'grupo',    label: 'Grupo'    },
  { id: 'bloque',   label: 'Bloque'   },
  { id: 'ha',       label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',  label: 'Plantas', filterType: 'number' },
  { id: 'material', label: 'Material' },
];

// ── Main Component ────────────────────────────────────────────────────────────
function LoteManagement() {
  const apiFetch = useApiFetch();
  const [lotes, setLotes] = useState([]);
  const [packages, setPackages] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [selectedLote, setSelectedLote] = useState(null);
  // null | { mode: 'create' } | { mode: 'edit', lote }
  const [modalState, setModalState] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const [confirmModal, setConfirmModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [siembras, setSiembras] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode]   = useState('recent'); // 'recent' | 'oldest' | 'alpha'
  const [bloqueSorts,      setBloqueSorts]      = useState([{ field: 'grupo', dir: 'asc' }]);
  const [bloqueColFilters, setBloqueColFilters] = useState({});
  const [bloqueFilterPop,  setBloqueFilterPop]  = useState(null);
  const [bloqueHiddenCols, setBloqueHiddenCols] = useState(new Set());
  const [bloqueColMenu,    setBloqueColMenu]     = useState(null);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [previewLote,   setPreviewLote]   = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(null);
  // Banner persistente post-save. Reemplaza al toast efímero como evidencia
  // visual de que el guardado pasó. Vive hasta que el usuario lo cierre,
  // haga clic en Abrir, o arranque otro flujo de crear/editar.
  // Shape: { id, label, action: 'created' | 'updated' } | null
  const [lastSavedLote, setLastSavedLote] = useState(null);
  const carouselRef = useRef(null);
  const docRef      = useRef(null);

  // Centra la burbuja activa en el carousel cuando cambia el lote seleccionado
  useEffect(() => {
    if (!selectedLote || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedLote]);

  // ── Data fetching ─────────────────────────────────────────────────────────
  // `fetchLotes` se conserva separada porque los handlers de crear/eliminar
  // necesitan refrescar solo la lista de lotes y reusar el array devuelto
  // para encontrar el lote recién guardado y seleccionarlo.
  const fetchLotes = useCallback(() => {
    return apiFetch('/api/lotes').then(res => res.json()).then(data => {
      setLotes(data);
      return data;
    }).catch(console.error);
  }, [apiFetch]);

  // Carga inicial de los 5 recursos en paralelo. Promise.allSettled deja que
  // un fetch lento o caído no bloquee el resto — el usuario ve lo que sí
  // llegó y un banner de error con CTA para reintentar. Antes los errores
  // se tragaban en console.error y la página mostraba un falso "Sin lotes
  // creados" cuando en realidad la red estaba caída.
  const reloadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      apiFetch('/api/lotes').then(r => r.json()).then(setLotes),
      apiFetch('/api/packages').then(r => r.json()).then(setPackages),
      apiFetch('/api/grupos').then(r => r.json()).then(setGrupos),
      apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])),
      apiFetch('/api/config').then(r => r.json()).then(setEmpresaConfig),
    ]);
    const failed = results.filter(r => r.status === 'rejected').length;
    setLoadError(failed > 0
      ? `No se pudieron cargar ${failed} de ${results.length} recursos. La información mostrada puede estar incompleta.`
      : null);
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Deep-link entrante: si la navegación viene con `state.selectLoteId`
  // (e.g. desde el modal de dependencias del paquete que se intentó borrar),
  // auto-seleccionamos ese lote cuando los datos terminen de cargar. Si el
  // id no está en la lista (filtrado por finca, borrado, etc.) el state
  // queda silencioso — no rompemos la página. La ref evita re-seleccionar
  // si `lotes` se refetchea después por cualquier motivo.
  const location = useLocation();
  const incomingSelectLoteId = location.state?.selectLoteId;
  const deepLinkProcessedRef = useRef(false);

  useEffect(() => {
    if (deepLinkProcessedRef.current) return;
    if (!incomingSelectLoteId || !Array.isArray(lotes) || lotes.length === 0) return;
    const found = lotes.find(l => l.id === incomingSelectLoteId);
    if (!found) return;
    deepLinkProcessedRef.current = true;
    setSelectedLote(found);
  }, [lotes, incomingSelectLoteId]);

  // ── Lista filtrada + ordenada (sidebar + carousel mobile) ─────────────────
  // Filtra por código o nombre amigable (case-insensitive). El orden por
  // defecto es por fecha de siembra descendente — lo más reciente arriba —
  // porque es el caso de uso dominante (encargado abre la página para tocar
  // el lote que recién creó). El usuario puede cambiar a alfabético cuando
  // quiere encontrar uno viejo y solo recuerda el código.
  const displayedLotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? lotes.filter(l =>
          (l.codigoLote || '').toLowerCase().includes(q) ||
          (l.nombreLote || '').toLowerCase().includes(q))
      : lotes;
    const tsOf = (l) => l.fechaCreacion?._seconds ?? 0;
    const sorted = [...filtered];
    if (sortMode === 'recent')      sorted.sort((a, b) => tsOf(b) - tsOf(a));
    else if (sortMode === 'oldest') sorted.sort((a, b) => tsOf(a) - tsOf(b));
    else if (sortMode === 'alpha')  sorted.sort((a, b) =>
      (a.codigoLote || '').localeCompare(b.codigoLote || '', 'es', { numeric: true }));
    return sorted;
  }, [lotes, searchQuery, sortMode]);

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

  const handleSelectLote = (lote) => {
    setSelectedLote(lote);
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Abrir un nuevo flujo de crear/editar invalida el banner del save previo —
  // es intención nueva del usuario, no queremos mezclar evidencias visuales.
  const handleNewLote = () => { setLastSavedLote(null); setModalState({ mode: 'create' }); };
  const handleEdit = (lote, focus) => {
    setLastSavedLote(null);
    setModalState({ mode: 'edit', lote, ...(focus ? { focus } : {}) });
  };

  const handleModalSuccess = async (savedLote) => {
    const isEditing = modalState?.mode === 'edit';
    const targetId = isEditing ? modalState.lote.id : savedLote?.id;
    setModalState(null);
    const newLotes = await fetchLotes();
    let saved = null;
    if (targetId && newLotes) {
      saved = newLotes.find(l => l.id === targetId);
      if (saved) setSelectedLote(saved);
    }
    // Banner persistente en vez del toast de 3s — la evidencia de "creé este
    // lote" sobrevive hasta que el usuario decida. El toast de error vive
    // dentro del modal mismo, así que acá solo tratamos el éxito.
    if (saved) {
      const label = saved.nombreLote && saved.nombreLote !== saved.codigoLote
        ? `${saved.codigoLote} — ${saved.nombreLote}`
        : saved.codigoLote;
      setLastSavedLote({ id: saved.id, label, action: isEditing ? 'updated' : 'created' });
    }
  };

  const handleDeleteClick = async (lote) => {
    // Local-first: si hay siembras vinculadas, bloqueamos el delete sin
    // golpear el backend. Hoy `DELETE /api/lotes/:id` borra el lote y sus
    // scheduled_tasks pero NO toca siembras — sin este bloqueo, las
    // siembras quedarían huérfanas referenciando un loteId borrado. La
    // data de siembras ya está cargada en memoria, no hace falta roundtrip.
    const siembraCount = siembras.filter(s => s.loteId === lote.id).length;
    const loteName = lote.nombreLote || lote.codigoLote;
    if (siembraCount > 0) {
      setConfirmModal({ mode: 'blocked', loteName, siembraCount });
      return;
    }
    try {
      const res = await apiFetch(`/api/lotes/${lote.id}/task-count`);
      const { count } = await res.json();
      setConfirmModal({ mode: 'delete', loteId: lote.id, loteName, taskCount: count });
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

  // ── Hub panel ─────────────────────────────────────────────────────────────
  const pkg = selectedLote ? packages.find(p => p.id === selectedLote.paqueteId) : null;

  // Bundle de props compartidas para BloqueSortTh — todas las 5 columnas
  // necesitan acceso al mismo state de sort + filter + popover. Spread en
  // cada callsite mantiene los <th> legibles sin sacrificar el contrato
  // explícito del componente.
  const sortThProps = {
    sorts: bloqueSorts,
    setSorts: setBloqueSorts,
    colFilters: bloqueColFilters,
    filterPop: bloqueFilterPop,
    setFilterPop: setBloqueFilterPop,
  };

  const renderRightPanel = () => {
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
            <button
              type="button"
              className={`aur-badge aur-badge--blue lote-paquete-pill${pkg.archivedAt ? ' aur-badge--archived' : ''}`}
              title={pkg.archivedAt
                ? 'El paquete técnico asignado a este lote está archivado. Clic para reasignar.'
                : 'Clic para cambiar el paquete técnico.'}
              onClick={() => handleEdit(selectedLote, 'paquete')}
            >
              <FiPackage size={13} />
              {pkg.nombrePaquete}
              {pkg.archivedAt && <span className="aur-badge-archived-tag">archivado</span>}
            </button>
          )}
          {!selectedLote.paqueteId && (
            <button
              type="button"
              className="aur-badge lote-paquete-pill"
              title="Clic para asignar un paquete técnico a este lote."
              onClick={() => handleEdit(selectedLote, 'paquete')}
            >
              <FiPackage size={13} /> Asignar paquete técnico
            </button>
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
          <EmptyState
            variant="compact"
            icon={FiLayers}
            title="No hay registros de siembra para este lote"
            subtitle="Cuando registres una siembra para este lote aparecerán aquí los bloques sembrados."
          />
        ) : (
          <div className="aur-table-wrap">
            <table className="aur-table grupo-hub-table">
              <thead>
                <tr>
                  {!bloqueHiddenCols.has('grupo')    && <BloqueSortTh {...sortThProps} field="grupo">Grupo</BloqueSortTh>}
                  {!bloqueHiddenCols.has('bloque')   && <BloqueSortTh {...sortThProps} field="bloque">Bloque</BloqueSortTh>}
                  {!bloqueHiddenCols.has('ha')       && <BloqueSortTh {...sortThProps} field="ha" filterType="number">Ha.</BloqueSortTh>}
                  {!bloqueHiddenCols.has('plantas')  && <BloqueSortTh {...sortThProps} field="plantas" filterType="number">Plantas</BloqueSortTh>}
                  {!bloqueHiddenCols.has('material') && <BloqueSortTh {...sortThProps} field="material">Material</BloqueSortTh>}
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
    <div className={`lote-page${selectedLote ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modalState && (
        <LoteFormModal
          mode={modalState.mode}
          loteToEdit={modalState.lote}
          packages={packages}
          initialFocusField={modalState.focus || 'codigo'}
          apiFetch={apiFetch}
          onSuccess={handleModalSuccess}
          onClose={() => setModalState(null)}
        />
      )}
      {confirmModal?.mode === 'blocked' && (
        <AuroraConfirmModal
          title="No es posible eliminar este lote"
          body={
            <>
              El lote <strong>"{confirmModal.loteName}"</strong> tiene{' '}
              <strong>{confirmModal.siembraCount}</strong>{' '}
              {confirmModal.siembraCount === 1 ? 'siembra asociada' : 'siembras asociadas'}.
              Eliminá o reasigná {confirmModal.siembraCount === 1 ? 'la siembra' : 'las siembras'}{' '}
              antes de borrar el lote — si no, quedarían huérfanas apuntando a un lote que ya no existe.
            </>
          }
          showCancel={false}
          confirmLabel="Entendido"
          onConfirm={() => setConfirmModal(null)}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {confirmModal?.mode === 'delete' && (
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

      {/* ── Banner de error de carga (algún fetch inicial falló) ── */}
      {loadError && (
        <div className="lote-load-error" role="alert">
          <FiAlertTriangle size={14} aria-hidden="true" />
          <span className="lote-load-error-msg">{loadError}</span>
          <button
            type="button"
            className="lote-load-error-retry"
            onClick={reloadAll}
            disabled={loading}
          >
            <FiRefreshCw size={12} aria-hidden="true" />
            {loading ? 'Cargando…' : 'Reintentar'}
          </button>
        </div>
      )}

      {/* ── Banner persistente: confirmación de guardado ──
          Visible tras un save exitoso hasta que el usuario lo cierre, haga
          clic en Abrir, o arranque otro flujo. Reemplaza al toast efímero
          por una señal estable con acceso directo al lote recién guardado. */}
      {!loading && lastSavedLote && (
        <div className="lote-save-banner" role="status" aria-live="polite">
          <FiCheck size={14} aria-hidden="true" />
          <span className="lote-save-banner-msg">
            Lote <strong>"{lastSavedLote.label}"</strong>{' '}
            {lastSavedLote.action === 'created' ? 'creado.' : 'actualizado.'}
          </span>
          <button
            type="button"
            className="lote-save-banner-action"
            onClick={() => {
              const lote = lotes.find(l => l.id === lastSavedLote.id);
              setLastSavedLote(null);
              if (lote) handleSelectLote(lote);
            }}
          >
            Abrir →
          </button>
          <button
            type="button"
            className="lote-save-banner-close"
            onClick={() => setLastSavedLote(null)}
            aria-label="Cerrar"
          >
            <FiX size={14} />
          </button>
        </div>
      )}

      {/* ── Mobile sticky carousel ── */}
      {selectedLote && (
        <div className="lote-carousel" ref={carouselRef}>
          {displayedLotes.map(lote => (
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
          <button className="lote-bubble lote-bubble--add" onClick={handleNewLote} aria-label="Crear nuevo lote">
            <span className="lote-bubble-avatar lote-bubble-avatar--add" aria-hidden="true">
              <FiPlus size={22} />
            </span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      <PageHeader
        level={2}
        title="Lotes Activos"
        subtitle="Espacios físicos donde viven tus cultivos y la unidad básica para registrar actividades y costos."
        actions={
          <button onClick={handleNewLote} className="aur-btn-pill">
            <FiPlus size={14} /> Nuevo Lote
          </button>
        }
      />
      {/* En mobile, cuando hay un lote seleccionado el carousel sticky reemplaza
         visualmente al header — el header se oculta para no duplicar la barra
         de acciones. Equivalente al rule legacy en .lote-page-header. */}

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

      <div className="lote-list-panel">

          {lotes.length > 0 && (
            <>
              <div className="lote-list-search">
                <FiSearch size={13} aria-hidden="true" />
                <input
                  type="search"
                  className="lote-list-search-input"
                  placeholder="Buscar por código o nombre…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  aria-label="Buscar lote por código o nombre"
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="lote-list-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Limpiar búsqueda"
                  >
                    <FiX size={12} />
                  </button>
                )}
              </div>
              <div className="lote-list-sort">
                <label htmlFor="lote-sort-mode" className="lote-list-sort-label">Ordenar</label>
                <select
                  id="lote-sort-mode"
                  className="lote-list-sort-select"
                  value={sortMode}
                  onChange={e => setSortMode(e.target.value)}
                >
                  <option value="recent">Recientes</option>
                  <option value="oldest">Más antiguos</option>
                  <option value="alpha">Alfabético</option>
                </select>
              </div>
            </>
          )}

          {loading ? (
            <AuroraSkeleton variant="row" count={6} label="Cargando lotes…" />
          ) : lotes.length === 0 ? (
            // Si hubo error de carga no mostramos el empty state — sería
            // falso, no sabemos si está vacío o si la red murió. El banner
            // arriba ya explica qué pasó y tiene el botón Reintentar.
            loadError ? null : (
              <EmptyState
                variant="compact"
                icon={FiLayers}
                title="Aún no hay lotes"
                subtitle="Crea tu primer lote para empezar a registrar siembras y aplicaciones."
                action={
                  <button type="button" className="aur-btn-pill" onClick={handleNewLote}>
                    <FiPlus size={14} /> Crear primer lote
                  </button>
                }
              />
            )
          ) : displayedLotes.length === 0 ? (
            <p className="lote-list-no-results">
              Sin resultados para "{searchQuery}".{' '}
              <button type="button" className="aur-btn-text" onClick={() => setSearchQuery('')}>
                Limpiar
              </button>
            </p>
          ) : (
            <ul className="lote-list">
              {displayedLotes.map(lote => (
                <li
                  key={lote.id}
                  className={`lote-list-item ${selectedLote?.id === lote.id ? 'active' : ''}`}
                  onClick={() => selectedLote?.id === lote.id ? setSelectedLote(null) : handleSelectLote(lote)}
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
          )}
        </div>
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
