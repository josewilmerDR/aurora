import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../styles/grupo-management.css';
import { FiPlus, FiX, FiAlertTriangle, FiRefreshCw, FiCheck, FiChevronRight } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraModal from '../../../components/AuroraModal';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import GrupoHub from '../components/GrupoHub';
import GrupoFormSheet from '../components/GrupoFormSheet';
import GrupoPreviewModal from '../components/GrupoPreviewModal';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ─────────────────────────────────────────────────────────────────────────────
// El estado del form sheet vive en GrupoFormSheet — el padre solo decide
// cuándo montarlo y cómo reaccionar al éxito/cancel.
//
// Helpers de dominio:
//  - lib/lotes-helpers           — formatters de fecha + multiSort.
//  - lib/grupo-bloques-helpers   — consolidateSiembrasByBloque + calcFechaCosecha.
//
// Componentes hijos:
//  - components/GrupoHub          + hooks/useGrupoBloqueTable (panel del grupo).
//  - components/GrupoFormSheet                                 (crear/editar).
//  - components/GrupoPreviewModal                              (PDF / impresión).
//  - components/NuevoCatalogModal                              (nueva cosecha/etapa).
//  - components/BloqueSortTh                                   (cabecera ordenable).
//
function GrupoManagement() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [grupos,            setGrupos]            = useState([]);
  const [siembras,          setSiembras]          = useState([]);
  const [bloquesDisponibles, setBloquesDisponibles] = useState([]);
  const [packages,          setPackages]          = useState([]);
  const [monitoreoPackages, setMonitoreoPackages] = useState([]);
  const [empresaConfig, setEmpresaConfig] = useState({});
  const [selectedGrupo, setSelectedGrupo] = useState(null);
  // formMode = null | { mode: 'create', preloadIds?, preloadLoteCode? }
  //                 | { mode: 'edit',   grupo }
  // Reemplaza el par showForm + isEditing + formData previo, alineado al
  // patrón modalState de LoteManagement.
  const [formMode,      setFormMode]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [loadError,     setLoadError]     = useState(null);
  const [toast,         setToast]         = useState(null);
  // Banner persistente post-save. Reemplaza el toast efímero como evidencia
  // visual del guardado — vive hasta que el usuario lo cierre, clickee Abrir,
  // o arranque otro flujo de crear/editar. Shape:
  //   { id, label, action: 'created' | 'updated', tasksGenerated: boolean }
  const [lastSavedGrupo, setLastSavedGrupo] = useState(null);
  const [confirmModal,  setConfirmModal]  = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [deleteModal,   setDeleteModal]   = useState(null);
  const [previewGrupo,     setPreviewGrupo]     = useState(null);
  const carouselRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const showForm = formMode !== null;

  // Carga inicial de los 6 recursos en paralelo. Promise.allSettled deja
  // que un fetch caído no bloquee al resto — el usuario ve lo que sí llegó
  // y un banner persistente con CTA Reintentar. Antes los errores se
  // tragaban en console.error y la página mostraba un falso "Sin grupos
  // creados" cuando en realidad la red estaba caída. Patrón portado de
  // LoteManagement.reloadAll.
  const reloadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const results = await Promise.allSettled([
      apiFetch('/api/grupos').then(r => r.json()).then(setGrupos),
      apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])),
      apiFetch('/api/siembras/disponibles').then(r => r.json()).then(d => setBloquesDisponibles(Array.isArray(d) ? d : [])),
      apiFetch('/api/packages').then(r => r.json()).then(setPackages),
      apiFetch('/api/muestreos/paquetes').then(r => r.json()).then(setMonitoreoPackages),
      apiFetch('/api/config').then(r => r.json()).then(setEmpresaConfig),
    ]);
    const failed = results.filter(r => r.status === 'rejected').length;
    setLoadError(failed > 0
      ? `No se pudieron cargar ${failed} de ${results.length} recursos. La información mostrada puede estar incompleta.`
      : null);
    setLoading(false);
  }, [apiFetch]);

  // Refresh post-save/post-delete: solo los recursos volátiles (grupos +
  // siembras + bloques disponibles). No toca loading porque la página ya
  // está montada y visible — sería un flash UI raro. Devuelve el array de
  // grupos para que los handlers puedan auto-seleccionar el doc guardado.
  const refreshAfterMutation = useCallback(async () => {
    const [gRes] = await Promise.allSettled([
      apiFetch('/api/grupos').then(r => r.json()).then(d => { setGrupos(d); return d; }),
      apiFetch('/api/siembras').then(r => r.json()).then(d => setSiembras(Array.isArray(d) ? d : [])),
      apiFetch('/api/siembras/disponibles').then(r => r.json()).then(d => setBloquesDisponibles(Array.isArray(d) ? d : [])),
    ]);
    return gRes.status === 'fulfilled' ? gRes.value : null;
  }, [apiFetch]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Deep-link entrante (e.g. desde el modal de dependencias en /packages,
  // o desde el panel de cobertura del hub de un lote en /lotes):
  //   - state.selectGrupoId      → auto-seleccionar ese grupo al cargar
  //   - state.preloadSiembraIds  → abrir el form de nuevo grupo con esos
  //                                 siembraIds ya marcados como bloques
  //                                 (flujo "Crear grupo con estos bloques")
  // La ref evita re-aplicar el deep-link si `grupos` se refetchea después,
  // y el navigate(replace) limpia el history entry: sin eso, navegar a otra
  // ruta y volver con back re-disparaba el preload con bloques fantasma.
  const location = useLocation();
  const incomingSelectGrupoId  = location.state?.selectGrupoId;
  const incomingPreloadIds     = location.state?.preloadSiembraIds;
  const incomingPreloadLote    = location.state?.preloadLoteCode;
  const deepLinkProcessedRef = useRef(false);
  useEffect(() => {
    if (deepLinkProcessedRef.current) return;
    if (incomingSelectGrupoId) {
      if (!Array.isArray(grupos) || grupos.length === 0) return;
      const found = grupos.find(g => g.id === incomingSelectGrupoId);
      if (!found) return;
      deepLinkProcessedRef.current = true;
      setSelectedGrupo(found);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }
    if (Array.isArray(incomingPreloadIds) && incomingPreloadIds.length > 0) {
      // No esperamos a `bloquesDisponibles` — el form preselecciona por id y
      // tolera ids que el picker aún no listó (se renderean cuando llega la
      // data). Si algún id fue movido a otro grupo mientras tanto, el move
      // modal del propio form maneja el conflicto al guardar.
      deepLinkProcessedRef.current = true;
      setSelectedGrupo(null);
      setFormMode({
        mode: 'create',
        preloadIds: incomingPreloadIds,
        preloadLoteCode: incomingPreloadLote || null,
      });
      navigate(location.pathname, { replace: true, state: {} });
      // El toast informativo lo dispara GrupoFormSheet al montar cuando
      // recibe preloadIds + preloadLoteCode — evitamos duplicarlo acá.
    }
  }, [grupos, incomingSelectGrupoId, incomingPreloadIds, incomingPreloadLote, location.pathname, navigate]);

  // Centra la burbuja activa en el carousel cuando cambia el grupo seleccionado
  useEffect(() => {
    if (!selectedGrupo || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.lote-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedGrupo]);

  // ── Índices id → doc para lookup O(1). Los consumen GrupoHub (vía
  // useGrupoBloqueTable), GrupoPreviewModal y GrupoFormSheet — cada uno
  // resuelve siembraIds del grupo. Sin el índice serían O(N·M) por render,
  // perceptible como lag al filtrar/ordenar la tabla del hub.
  const siembrasById = useMemo(
    () => new Map(siembras.map(s => [s.id, s])),
    [siembras]
  );
  const bloquesDisponiblesById = useMemo(
    () => new Map(bloquesDisponibles.map(b => [b.id, b])),
    [bloquesDisponibles]
  );

  // Iniciar un flujo nuevo invalida el banner del save previo — es
  // intención nueva del usuario, no queremos mezclar evidencias.
  const handleNewGrupo = () => {
    setLastSavedGrupo(null);
    setFormMode({ mode: 'create' });
    setSelectedGrupo(null);
  };

  const handleSelectGrupo = (grupo) => {
    setSelectedGrupo(grupo);
    setFormMode(null);
    if (window.innerWidth <= 768)
      document.querySelector('.content-area')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEdit = (grupo) => {
    setLastSavedGrupo(null);
    setFormMode({ mode: 'edit', grupo });
  };

  // Invocado por GrupoFormSheet tras un POST/PUT exitoso. Hacemos
  // refreshAfterMutation, auto-seleccionamos el grupo guardado y armamos
  // el banner persistente con los datos que el form nos pasó.
  const handleFormSuccess = async ({ savedId, action, tasksGenerated }) => {
    const newGrupos = await refreshAfterMutation();
    let foundGrupo = null;
    if (savedId && newGrupos) {
      foundGrupo = newGrupos.find(g => g.id === savedId) || null;
      if (foundGrupo) setSelectedGrupo(foundGrupo);
    }
    setFormMode(null);
    if (foundGrupo) {
      setLastSavedGrupo({
        id: foundGrupo.id,
        label: foundGrupo.nombreGrupo || savedId,
        action,
        tasksGenerated,
      });
    }
  };

  const handleDeleteClick = async (grupo) => {
    try {
      const res = await apiFetch(`/api/grupos/${grupo.id}/delete-check`);
      const data = await res.json();
      if (data.cedulasAplicadas.length > 0) {
        setDeleteModal({ type: 'aplicada', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: data.cedulasAplicadas, cedulasEnTransito: [] });
      } else if (data.cedulasEnTransito.length > 0) {
        setDeleteModal({ type: 'en_transito', grupoId: grupo.id, grupoName: grupo.nombreGrupo, cedulasAplicadas: [], cedulasEnTransito: data.cedulasEnTransito });
      } else {
        setConfirmModal({ grupoId: grupo.id, grupoName: grupo.nombreGrupo });
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/grupos/${confirmModal.grupoId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      if (selectedGrupo?.id === confirmModal.grupoId) setSelectedGrupo(null);
      setConfirmModal(null);
      refreshAfterMutation();
      showToast('Grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  // Una sola request al endpoint server-side que anula las cédulas en
  // tránsito (con reversión de inventario) y elimina el grupo en batches
  // transaccionales. Reemplaza el flujo previo de N PUT /anular + 1 DELETE
  // que dejaba estado parcialmente mutado si fallaba a mitad.
  const handleAnularYEliminar = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/grupos/${deleteModal.grupoId}/anular-y-eliminar`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // CEDULA_APLICADA: race entre el delete-check del modal y este POST
        // (alguien aplicó una cédula entre medio). Invitar a recargar para
        // ver el modal correcto ("No es posible eliminar — hay aplicadas").
        const msg = body?.code === 'CEDULA_APLICADA'
          ? 'Alguna cédula fue aplicada en campo desde que abriste este modal. Recargá para ver el estado actualizado.'
          : 'Error al eliminar el grupo.';
        showToast(msg, 'error');
        return;
      }
      if (selectedGrupo?.id === deleteModal.grupoId) setSelectedGrupo(null);
      setDeleteModal(null);
      refreshAfterMutation();
      showToast('Cédulas anuladas y grupo eliminado correctamente');
    } catch {
      showToast('Error al eliminar el grupo.', 'error');
    } finally { setDeleting(false); }
  };

  // ── Panel principal (hub o formulario) ───────────────────────────────────
  const renderPanel = () => {
    if (formMode) {
      return (
        <GrupoFormSheet
          mode={formMode.mode}
          grupoToEdit={formMode.mode === 'edit' ? formMode.grupo : null}
          preloadIds={formMode.mode === 'create' ? formMode.preloadIds : null}
          preloadLoteCode={formMode.mode === 'create' ? formMode.preloadLoteCode : null}
          apiFetch={apiFetch}
          siembras={siembras}
          bloquesDisponibles={bloquesDisponibles}
          bloquesDisponiblesById={bloquesDisponiblesById}
          grupos={grupos}
          packages={packages}
          monitoreoPackages={monitoreoPackages}
          showToast={showToast}
          onSuccess={handleFormSuccess}
          onCancel={() => setFormMode(null)}
        />
      );
    }

    if (!selectedGrupo) return null;

    return (
      <GrupoHub
        grupo={selectedGrupo}
        siembrasById={siembrasById}
        packages={packages}
        monitoreoPackages={monitoreoPackages}
        empresaConfig={empresaConfig}
        onBack={() => setSelectedGrupo(null)}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onPreview={setPreviewGrupo}
      />
    );
  };


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`grupo-page${selectedGrupo && !showForm ? ' grupo-page--selected' : ''}${showForm ? ' grupo-page--form' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* catalogModal y moveModal viven dentro de GrupoFormSheet — son
          modales anidados del flujo de crear/editar. */}

      {confirmModal && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar "${confirmModal.grupoName}"?`}
          body="Al eliminar este grupo, sus bloques quedarán libres y podrán asignarse a otros grupos. Ten en cuenta que los registros históricos (cédulas de aplicación y actividades completadas) que hacen referencia a este grupo seguirán mostrando su nombre. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={deleting}
        />
      )}

      {/* Migrado de modal hand-rolled a AuroraModal — hereda focus trap,
          ESC (con preventClose durante el anular), focus restore al cerrar,
          backdrop close robusto y aria-labelledby auto-generado. Antes el
          contenedor era un <div className="aur-modal-backdrop"> manual que
          dejaba el foco tabular fuera del modal hacia la página de atrás. */}
      {deleteModal?.type === 'aplicada' && (
        <AuroraModal
          title="No es posible eliminar este grupo"
          icon={<FiX size={18} />}
          iconVariant="danger"
          size="wide"
          showCloseButton={false}
          onClose={() => setDeleteModal(null)}
          footer={
            <button className="aur-btn-pill" onClick={() => setDeleteModal(null)}>
              Entendido
            </button>
          }
        >
          <div className="aur-modal-body">
            <p>
              El grupo <strong>"{deleteModal.grupoName}"</strong> tiene cédulas ya <strong>aplicadas en campo</strong>.
              Estas forman parte del registro fitosanitario y no pueden eliminarse.
            </p>
            <p className="grupo-delete-modal__section-label">Cédulas aplicadas</p>
            <ul className="grupo-delete-modal__list">
              {deleteModal.cedulasAplicadas.map(c => (
                <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
              ))}
            </ul>
          </div>
        </AuroraModal>
      )}

      {deleteModal?.type === 'en_transito' && (
        <AuroraModal
          title="Hay cédulas pendientes de resolución"
          icon={<FiAlertTriangle size={16} />}
          iconVariant="warn"
          size="wide"
          showCloseButton={false}
          preventClose={deleting}
          onClose={() => setDeleteModal(null)}
          footer={
            <>
              <button className="aur-btn-text" onClick={() => setDeleteModal(null)} disabled={deleting}>
                Cancelar
              </button>
              <button
                className="aur-btn-text"
                onClick={() => { setDeleteModal(null); navigate('/aplicaciones/cedulas'); }}
                disabled={deleting}
              >
                Ir a Cédulas
              </button>
              <button
                className="aur-btn-pill aur-btn-pill--danger"
                onClick={handleAnularYEliminar}
                disabled={deleting}
              >
                {deleting ? 'Anulando…' : 'Anular y eliminar'}
              </button>
            </>
          }
        >
          <div className="aur-modal-body">
            <p>
              Las siguientes cédulas del grupo <strong>"{deleteModal.grupoName}"</strong> están en estado <strong>Mezcla lista</strong>.
              Debes resolverlas antes de poder eliminar el grupo.
            </p>
            <p className="grupo-delete-modal__section-label">Cédulas en Mezcla lista</p>
            <ul className="grupo-delete-modal__list">
              {deleteModal.cedulasEnTransito.map(c => (
                <li key={c.id}>{c.consecutivo}{c.lote ? ` — ${c.lote}` : ''}</li>
              ))}
            </ul>
            <p className="grupo-delete-modal__hint">
              Puedes anularlas ahora (se revertirá el inventario descontado) o ir a Cédulas de Aplicación para marcarlas como aplicadas en campo.
            </p>
          </div>
        </AuroraModal>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="grupo-page-loading" />}

      {/* ── Mobile sticky carousel ── */}
      {selectedGrupo && !showForm && (
        <div className="lote-carousel" ref={carouselRef} aria-label="Grupos">
          {grupos.map(grupo => {
            const isActive = selectedGrupo?.id === grupo.id;
            // Fallback defensivo: el backend valida nombreGrupo 1-16 chars
            // con Zod, pero docs pre-migración o ediciones manuales en
            // Firestore pueden quedar con null/undefined. Sin esto,
            // `.slice()` crashea la página entera al renderizar el avatar.
            const nombre = grupo.nombreGrupo || '?';
            return (
              <button
                key={grupo.id}
                className={`lote-bubble${isActive ? ' lote-bubble--active' : ''}`}
                onClick={() => isActive ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
                aria-pressed={isActive}
                aria-label={`Grupo ${nombre}${isActive ? ' (seleccionado, clic para cerrar)' : ''}`}
              >
                <span className="lote-bubble-avatar" aria-hidden="true">{nombre.slice(0, 4)}</span>
                <span className="lote-bubble-label">{nombre}</span>
              </button>
            );
          })}
          <button className="lote-bubble lote-bubble--add" onClick={handleNewGrupo} aria-label="Crear nuevo grupo">
            <span className="lote-bubble-avatar lote-bubble-avatar--add" aria-hidden="true">+</span>
            <span className="lote-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {/* ── Banner de error de carga (algún fetch inicial falló) ── */}
      {loadError && (
        <div className="grupo-load-error" role="alert">
          <FiAlertTriangle size={14} aria-hidden="true" />
          <span className="grupo-load-error-msg">{loadError}</span>
          <button
            type="button"
            className="grupo-load-error-retry"
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
          por una señal estable con acceso directo al grupo recién guardado.
          Portado de LoteManagement.lote-save-banner. */}
      {!loading && lastSavedGrupo && (
        <div className="grupo-save-banner" role="status" aria-live="polite">
          <FiCheck size={14} aria-hidden="true" />
          <span className="grupo-save-banner-msg">
            Grupo <strong>"{lastSavedGrupo.label}"</strong>{' '}
            {lastSavedGrupo.action === 'created'
              ? (lastSavedGrupo.tasksGenerated ? 'creado y tareas programadas.' : 'creado.')
              : 'actualizado.'}
          </span>
          <button
            type="button"
            className="grupo-save-banner-action"
            onClick={() => {
              const grupo = grupos.find(g => g.id === lastSavedGrupo.id);
              setLastSavedGrupo(null);
              if (grupo) handleSelectGrupo(grupo);
            }}
          >
            Abrir →
          </button>
          <button
            type="button"
            className="grupo-save-banner-close"
            onClick={() => setLastSavedGrupo(null)}
            aria-label="Cerrar"
          >
            <FiX size={14} />
          </button>
        </div>
      )}

      {/* ── Page header ── */}
      {!loading && !showForm && (
        <div className="lote-page-header">
          <div className="lote-page-title-block">
            <h2 className="lote-page-title">Grupos</h2>
            <p className="lote-page-hint">
              Organiza los bloques de siembra cerrados en grupos de producción para gestionar aplicaciones, cosechas y costos de producción.
            </p>
          </div>
          <button className="aur-btn-pill" onClick={handleNewGrupo}>
            <FiPlus size={14} /> Nuevo Grupo
          </button>
        </div>
      )}

      {!loading && <div className="lote-management-layout">

        {/* Hub o formulario */}
        {renderPanel()}

        {/* Lista compacta */}
        {!showForm && <div className="lote-list-panel">
          {grupos.length === 0 ? (
            // Si hubo error de carga no mostramos el empty-state — sería
            // falso, no sabemos si la finca está vacía o si la red murió.
            // El banner de arriba ya explica qué pasó y tiene Reintentar.
            loadError ? null : (
              <div className="grupo-cta">
                <div className="grupo-cta-icon"><FiPlus size={24} /></div>
                <p className="grupo-cta-title">Sin grupos creados</p>
              </div>
            )
          ) : (
            <ul className="lote-list">
              {grupos.map(grupo => (
                <li
                  key={grupo.id}
                  className={`lote-list-item${selectedGrupo?.id === grupo.id && !showForm ? ' active' : ''}`}
                  onClick={() => selectedGrupo?.id === grupo.id && !showForm ? setSelectedGrupo(null) : handleSelectGrupo(grupo)}
                >
                  <div className="lote-list-info">
                    <span className="lote-list-code">{grupo.nombreGrupo}</span>
                    {(grupo.cosecha || grupo.etapa) && (
                      <span className="lote-list-name">{[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <FiChevronRight size={14} className="lote-list-arrow" />
                </li>
              ))}
            </ul>
          )}
        </div>}

      </div>}

      {previewGrupo && (
        <GrupoPreviewModal
          grupo={previewGrupo}
          siembrasById={siembrasById}
          empresaConfig={empresaConfig}
          onClose={() => setPreviewGrupo(null)}
          onShareError={() => showToast('No se pudo generar el PDF.', 'error')}
        />
      )}

      {/* El filter popover y el column menu del hub ahora viven dentro
          de GrupoHub — sus state se gestionan en useGrupoBloqueTable. */}
    </div>
  );
}

export default GrupoManagement;
