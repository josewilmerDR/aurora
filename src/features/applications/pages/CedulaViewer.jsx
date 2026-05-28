import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiShare2, FiPrinter, FiCheckCircle } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { useToast } from '../../../contexts/ToastContext';
import { translateApiError } from '../../../lib/errorMessages';
import { tsToDate } from '../lib/cedulas-helpers';
import CedulaDocumento from '../components/CedulaDocumento';
import CedulaFlowAction from '../components/CedulaFlowAction';
import MezclaListaModal from '../components/MezclaListaModal';
import AplicadaModal from '../components/AplicadaModal';
import '../styles/cedulas.css';
import '../styles/cedula-viewer.css';

// ── StatusBadge ──────────────────────────────────────────────────────────────
// Badge "estado de la cédula" para el meta del header. Antes el viewer
// hardcodeaba "Aplicada" en verde — el rótulo mentía cuando el viewer se
// llegaba por deep-link sobre una cédula pendiente / en tránsito / anulada,
// engañando al regente en una decisión regulatoria. Punto #1 audit.
function StatusBadge({ status }) {
  switch (status) {
    case 'aplicada_en_campo':
      return <span className="aur-badge aur-badge--green"><FiCheckCircle size={11} /> Aplicada</span>;
    case 'en_transito':
      return <span className="aur-badge aur-badge--blue">En Tránsito</span>;
    case 'pendiente':
      return <span className="aur-badge aur-badge--yellow">Pendiente</span>;
    case 'anulada':
      return <span className="aur-badge aur-badge--magenta">Anulada</span>;
    default:
      return null;
  }
}

export default function CedulaViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const toast = useToast();
  const docRef = useRef(null);

  const [cedula, setCedula]   = useState(null);
  const [config, setConfig]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Catálogos lazy para las acciones del flujo (MezclaLista / Aplicada en
  // Campo). Solo se cargan si el status de la cédula permite alguna acción —
  // un viewer de cédula ya aplicada o anulada no necesita /api/productos ni
  // /api/users ni /api/lotes. Punto #5 audit.
  const [actionProductos, setActionProductos] = useState([]);
  const [actionUsers,     setActionUsers]     = useState([]);
  const [actionLotes,     setActionLotes]     = useState([]);

  // Modales del flujo + Set de acciones en vuelo. El Set se mantiene por
  // consistencia con CedulaFlowAction (que ya espera un Set indexado por
  // cedulaId), aunque acá solo hay una cédula activa.
  const [mezclaModal,   setMezclaModal]   = useState(null);
  const [aplicadaModal, setAplicadaModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(() => new Set());
  const addLoading    = (i) => setActionLoading(prev => { const n = new Set(prev); n.add(i); return n; });
  const removeLoading = (i) => setActionLoading(prev => { if (!prev.has(i)) return prev; const n = new Set(prev); n.delete(i); return n; });

  useEffect(() => {
    const load = async () => {
      try {
        const [cRes, cfRes] = await Promise.all([
          apiFetch(`/api/cedulas/${id}`),
          apiFetch('/api/config'),
        ]);
        if (!cRes.ok) { setError('Cédula no encontrada o sin acceso.'); return; }
        const [c, cf] = await Promise.all([cRes.json(), cfRes.json().catch(() => ({}))]);
        setCedula(c);
        setConfig(cf || {});
      } catch {
        setError('Error al cargar la cédula.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy load de productos/users/lotes — solo si el status habilita alguna
  // acción que vaya a abrir un modal. Cualquier 4xx degrada silenciosamente
  // (los modales manejan arrays vacíos como "sin opciones para autocompletar").
  useEffect(() => {
    if (!cedula) return;
    const needs = cedula.status === 'pendiente' || cedula.status === 'en_transito';
    if (!needs) return;
    let cancelled = false;
    const safe = (url) => apiFetch(url)
      .then(r => r.ok ? r.json() : [])
      .catch(() => []);
    Promise.all([
      safe('/api/productos'),
      safe('/api/users/lite'),
      safe('/api/lotes'),
    ]).then(([prods, users, lotes]) => {
      if (cancelled) return;
      setActionProductos(Array.isArray(prods) ? prods : []);
      setActionUsers(Array.isArray(users)    ? users  : []);
      setActionLotes(Array.isArray(lotes)    ? lotes  : []);
    });
    return () => { cancelled = true; };
  }, [cedula?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Adapter cedula → props CedulaDocumento ────────────────────────────────
  // El cuerpo del documento (~360 LOC) ahora vive en CedulaDocumento. El
  // viewer adapta la cédula del backend (snap_* fields) a la shape que el
  // componente consume desde el preview, y pasa `snapOverrides` para que el
  // papel impreso refleje los valores históricos exactos en lugar de
  // re-derivarlos desde el catálogo / config actual (la receta original ya
  // quedó congelada al lock-in). Punto #2 audit.
  const docProps = useMemo(() => {
    if (!cedula) return null;
    const productosSource = (Array.isArray(cedula.snap_productos) && cedula.snap_productos.length > 0)
      ? cedula.snap_productos
      : (Array.isArray(cedula.productosAplicados) && cedula.productosAplicados.length > 0)
        ? cedula.productosAplicados
        : (Array.isArray(cedula.productosOriginales) ? cedula.productosOriginales : []);

    // Catálogo sintético: el viewer no carga /api/productos para la vista
    // (solo si hay acciones disponibles, ver lazy useEffect arriba), pero
    // snap_productos ya trae id/nombre/ingrediente/períodos/unidad
    // inlineados. Devolvemos esa info en la shape que CedulaDocumento espera
    // (catalogo.periodoACosecha == snap.periodoCarencia, mismo dato distinto
    // naming entre dominios).
    const byProductoId = new Map(
      productosSource.filter(p => p?.productoId).map(p => [p.productoId, p])
    );
    const getProductoCatalog = (productoId) => {
      const p = byProductoId.get(productoId);
      if (!p) return null;
      return {
        idProducto:        p.idProducto,
        nombreComercial:   p.nombreComercial,
        ingredienteActivo: p.ingredienteActivo,
        periodoACosecha:   p.periodoCarencia,
        periodoReingreso:  p.periodoReingreso,
        unidad:            p.unidad,
      };
    };

    // Calibración: el backend resuelve `calibracion` + `calibracionAplicador`
    // + `calibracionTractor` por lookup de snap_calibracionId. Pero el
    // volumen / litros del momento de aplicación pueden diferir si la
    // calibración fue editada desde entonces — preferimos los snap_*.
    const baseCal = cedula.calibracion || null;
    const previewCal = baseCal ? {
      ...baseCal,
      volumen: cedula.snap_volumenPorHa ?? baseCal.volumen,
      nombre:  cedula.snap_calibracionNombre || baseCal.nombre,
    } : (cedula.snap_calibracionNombre ? { nombre: cedula.snap_calibracionNombre } : null);
    const previewCalAplicador = cedula.calibracionAplicador ? {
      ...cedula.calibracionAplicador,
      capacidad: cedula.snap_litrosAplicador ?? cedula.calibracionAplicador.capacidad,
    } : (cedula.snap_litrosAplicador != null ? { capacidad: cedula.snap_litrosAplicador } : null);

    const areaHa = parseFloat(cedula.snap_areaHa) || 0;

    return {
      config,
      previewTask: {
        activityName:  cedula.snap_activityName || 'Cédula de aplicación',
        dueDate:       cedula.snap_dueDate,
        isDraft:       false,
        loteName:      cedula.snap_sourceName || null,
        loteHectareas: areaHa,
        activity:      { productos: productosSource, calibracionId: cedula.snap_calibracionId },
      },
      activeCedula:  cedula,
      previewSource: {
        fechaCreacion: cedula.snap_fechaCreacionGrupo,
        cosecha:       cedula.snap_cosecha,
        etapa:         cedula.snap_etapa,
        paqueteId:     null,
      },
      previewPkg:                null,
      previewPackageName:        cedula.snap_paqueteTecnico || null,
      previewTecnicoResponsable: cedula.supAplicaciones || null,
      previewProductos:          productosSource,
      previewBloques:            Array.isArray(cedula.snap_bloques) ? cedula.snap_bloques : [],
      pvTotalHa:                 areaHa,
      previewCal,
      previewCalAplicador,
      previewCalTractor: cedula.calibracionTractor || null,
      getProductoCatalog,
      snapOverrides: {
        // tsToDate cae a null si snap_fechaCosecha no existe → formatDateLong
        // devuelve '—', mismo comportamiento que el render original.
        fechaCosecha:        tsToDate(cedula.snap_fechaCosecha),
        totalPlantas:        cedula.snap_totalPlantas        ?? undefined,
        totalBoones:         cedula.snap_totalBoones         ?? undefined,
        periodoCarenciaMax:  cedula.snap_periodoCarenciaMax  ?? undefined,
        periodoReingresoMax: cedula.snap_periodoReingresoMax ?? undefined,
      },
    };
  }, [cedula, config]);

  // ── Action handlers ──────────────────────────────────────────────────────
  const handleMezclaLista = (cedulaId) => {
    setMezclaModal({ cedulaId });
  };

  const submitMezclaLista = async (cedulaId, payload) => {
    addLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/mezcla-lista`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Re-throw para que el modal muestre el error inline en vez de cerrarse.
        throw new Error(translateApiError(data, 'Error al actualizar la cédula.'));
      }
      setCedula(prev => prev ? {
        ...prev,
        status:             'en_transito',
        mezclaListaAt:      data.mezclaListaAt || new Date().toISOString(),
        mezclaListaNombre:  data.mezclaListaNombre ?? payload.nombre ?? prev.mezclaListaNombre ?? null,
        ...(data.productosAplicados            ? { productosAplicados:    data.productosAplicados }    : {}),
        ...(data.huboCambios          !== undefined ? { huboCambios:          data.huboCambios }          : {}),
        ...(data.observacionesMezcla  !== undefined ? { observacionesMezcla:  data.observacionesMezcla }  : {}),
        ...(data.modificadaEnMezclaAt          ? { modificadaEnMezclaAt:  data.modificadaEnMezclaAt }  : {}),
        ...(data.modificadaEnMezclaPor         ? { modificadaEnMezclaPor: data.modificadaEnMezclaPor } : {}),
      } : prev);
      setMezclaModal(null);
    } finally {
      removeLoading(cedulaId);
    }
  };

  const handleAplicada = (cedulaId) => {
    setAplicadaModal({
      cedulaId,
      metodoAplicacion: cedula?.metodoAplicacion       || cedula?.calibracion?.metodo || '',
      encargadoFinca:   config?.administrador           || '',
      encargadoBodega:  cedula?.mezclaListaNombre       || '',
      supAplicaciones:  cedula?.supAplicaciones         || '',
    });
  };

  const submitAplicada = async (cedulaId, data) => {
    setAplicadaModal(null);
    addLoading(cedulaId);
    try {
      const res = await apiFetch(`/api/cedulas/${cedulaId}/aplicada`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(translateApiError(err, 'Error al registrar la aplicación.'));
        return;
      }
      setCedula(prev => prev ? {
        ...prev,
        status:     'aplicada_en_campo',
        aplicadaAt: new Date().toISOString(),
        ...data,
      } : prev);
      toast.success('Aplicación registrada.');
    } finally {
      removeLoading(cedulaId);
    }
  };

  // ── PDF share (sin cambios funcionales — sigue siendo el mismo flujo) ────
  const handleShare = async () => {
    if (!docRef.current || !cedula) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Cedula-${cedula.consecutivo || cedula.id}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      console.error('Error generando PDF:', e);
    }
  };

  if (loading) return (
    <div className="aur-sheet aur-sheet--empty">
      <p className="cv-state-text">Cargando cédula…</p>
    </div>
  );
  if (error) return (
    <div className="aur-sheet aur-sheet--empty">
      <div className="cv-state">
        <p className="cv-state-text cv-state-text--error">{error}</p>
        <button type="button" className="aur-btn-pill" onClick={() => navigate(-1)}>
          <FiArrowLeft size={14} /> Volver
        </button>
      </div>
    </div>
  );

  return (
    <div className="cedula-viewer">

      {/* ── Toolbar (chrome — Apple-styled) ── */}
      <header className="cv-toolbar no-print">
        <button
          type="button"
          className="aur-chip aur-chip--ghost cv-toolbar-back"
          onClick={() => navigate(-1)}
        >
          <FiArrowLeft size={12} /> Volver
        </button>
        <div className="cv-toolbar-info">
          <h2 className="cv-toolbar-title">{cedula.snap_activityName || 'Cédula de aplicación'}</h2>
          <div className="cv-toolbar-meta">
            <span className="cv-toolbar-consecutivo">{cedula.consecutivo}</span>
            <StatusBadge status={cedula.status} />
          </div>
        </div>
        <div className="cv-toolbar-actions">
          {/* CedulaFlowAction comparte la chrome de acciones con el preview
              modal del listing. Para aplicada / anulada no rendea nada acá
              (el StatusBadge ya comunica el estado terminal); para
              pendiente / en_transito muestra el botón de avanzar el flujo
              respetando el rol del usuario. Punto #5 audit. */}
          {cedula.status !== 'aplicada_en_campo' && cedula.status !== 'anulada' && (
            <CedulaFlowAction
              cedula={cedula}
              actionLoading={actionLoading}
              currentUser={currentUser}
              onMezclaLista={handleMezclaLista}
              onAplicada={handleAplicada}
            />
          )}
          <button type="button" className="aur-chip" onClick={handleShare}>
            <FiShare2 size={12} /> Compartir
          </button>
          <button type="button" className="aur-chip" onClick={() => window.print()}>
            <FiPrinter size={12} /> Imprimir
          </button>
        </div>
      </header>

      {/* ── Documento (delegado a CedulaDocumento — punto #2 audit) ── */}
      {docProps && <CedulaDocumento ref={docRef} {...docProps} />}

      {/* ── Modales del flujo (montados solo cuando se abren) ── */}
      {mezclaModal && (
        <MezclaListaModal
          mode="mezcla-lista"
          cedula={cedula}
          task={null}
          productos={actionProductos}
          currentUser={currentUser}
          onClose={() => setMezclaModal(null)}
          onConfirm={(payload) => submitMezclaLista(mezclaModal.cedulaId, payload)}
        />
      )}
      {aplicadaModal && (
        <AplicadaModal
          lotes={actionLotes}
          users={actionUsers}
          currentUser={currentUser}
          prefill={aplicadaModal}
          onClose={() => setAplicadaModal(null)}
          onConfirm={(data) => submitAplicada(aplicadaModal.cedulaId, data)}
        />
      )}
    </div>
  );
}
