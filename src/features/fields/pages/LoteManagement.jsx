import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import '../styles/lote-management.css';
import { FiPlus, FiChevronRight, FiLayers, FiX, FiSearch, FiAlertTriangle, FiRefreshCw, FiCheck, FiFilter } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import PageHeader from '../../../components/PageHeader';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { translateApiError } from '../../../lib/errorMessages';
import LoteFormModal from '../components/LoteFormModal';
import LoteHub from '../components/LoteHub';
import { formatDate } from '../lib/lotes-helpers';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recientes' },
  { value: 'oldest', label: 'Más antiguos' },
  { value: 'alpha',  label: 'Alfabético' },
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
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState(null);
  // Banner persistente post-save. Reemplaza al toast efímero como evidencia
  // visual de que el guardado pasó. Vive hasta que el usuario lo cierre,
  // haga clic en Abrir, o arranque otro flujo de crear/editar.
  // Shape: { id, label, action: 'created' | 'updated' } | null
  const [lastSavedLote, setLastSavedLote] = useState(null);
  const carouselRef = useRef(null);

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

  // Cualquier interacción del usuario con la selección consume el deep-link
  // pendiente. Antes, si `lotes` resolvía después de que el usuario eligió
  // algo manualmente, el efecto de deep-link pisaba la elección. Acepta
  // `null` para soportar el flujo de deselect (back button + toggle).
  //
  // En mobile siempre scrolleamos `.content-area` al top, tanto en select
  // como en deselect: al deseleccionar el hub desaparece y la lista vuelve
  // a aparecer; si el usuario había scrolleado dentro del hub, sin este
  // scroll se queda con el header fuera de viewport.
  const handleSelectLote = (lote) => {
    deepLinkProcessedRef.current = true;
    setSelectedLote(lote);
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Abrir un nuevo flujo de crear/editar invalida el banner del save previo —
  // es intención nueva del usuario, no queremos mezclar evidencias visuales.
  const handleNewLote = () => { setLastSavedLote(null); setModalState({ mode: 'create' }); };
  const handleEdit = (lote) => {
    setLastSavedLote(null);
    setModalState({ mode: 'edit', lote });
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
      if (!res.ok) {
        // Antes el handler hacía `await res.json()` sin chequear res.ok y
        // accedía a `count` que venía undefined cuando el backend devolvía un
        // error (403/404/429). El toast hardcoded ocultaba la razón real;
        // ahora se traduce vía translateApiError leyendo el `code` del body.
        const body = await res.json().catch(() => null);
        showToast(translateApiError(body, 'Error al verificar las tareas del lote.'), 'error');
        return;
      }
      const { count } = await res.json();
      setConfirmModal({ mode: 'delete', loteId: lote.id, loteName, taskCount: count });
    } catch {
      showToast('Error de conexión al verificar las tareas del lote.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/lotes/${confirmModal.loteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        showToast(translateApiError(body, 'Error al eliminar el lote.'), 'error');
        return;
      }
      if (selectedLote?.id === confirmModal.loteId) setSelectedLote(null);
      setConfirmModal(null);
      await fetchLotes();
      showToast('Lote eliminado correctamente');
    } catch {
      showToast('Error de conexión al eliminar el lote.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`lote-page${selectedLote ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modalState && (
        <LoteFormModal
          mode={modalState.mode}
          loteToEdit={modalState.lote}
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
              onClick={() => handleSelectLote(selectedLote?.id === lote.id ? null : lote)}
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
        {/* ── Left: hub del lote seleccionado ── */}
        {selectedLote && (
          <LoteHub
            lote={selectedLote}
            siembras={siembras}
            grupos={grupos}
            packages={packages}
            empresaConfig={empresaConfig}
            onBack={() => handleSelectLote(null)}
            onEdit={handleEdit}
            onDelete={handleDeleteClick}
            onPreviewError={() => showToast('No se pudo generar el PDF.', 'error')}
          />
        )}

        {/* ── Right: lote list ── */}
      <div className="lote-list-panel">

          {lotes.length > 0 && (
            <div className="lote-list-toolbar">
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
              <div className="lote-list-sort-wrap">
                <button
                  type="button"
                  className={`lote-list-sort-trigger${sortMode !== 'recent' ? ' is-active' : ''}`}
                  onClick={() => setSortMenuOpen(o => !o)}
                  aria-haspopup="menu"
                  aria-expanded={sortMenuOpen}
                  title="Ordenar lotes"
                >
                  <FiFilter size={14} />
                </button>
                {sortMenuOpen && (
                  <>
                    <div className="aur-filter-backdrop" onClick={() => setSortMenuOpen(false)} />
                    <div className="lote-list-sort-menu" role="menu">
                      <div className="lote-list-sort-menu-title">Ordenar por</div>
                      {SORT_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={sortMode === opt.value}
                          className={`lote-list-sort-menu-item${sortMode === opt.value ? ' is-active' : ''}`}
                          onClick={() => { setSortMode(opt.value); setSortMenuOpen(false); }}
                        >
                          <span>{opt.label}</span>
                          {sortMode === opt.value && <FiCheck size={12} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
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
                  onClick={() => handleSelectLote(selectedLote?.id === lote.id ? null : lote)}
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

    </div>
  );
}

export default LoteManagement;
