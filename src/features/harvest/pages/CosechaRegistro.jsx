import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FiPlus, FiTrash2, FiAlertTriangle, FiInbox } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import CosechaRegistroModal from '../components/CosechaRegistroModal';
import NotaCell from '../components/NotaCell';
import InlineNumberEdit from '../components/InlineNumberEdit';
import { fmt, num } from '../lib/format';
import { translateApiError } from '../../../lib/errorMessages';
import '../styles/harvest.css';

// Tope de cantidad recibida en planta (espejo del backend: < 16384). #22.
const RECIBIDO_MAX = 16384;

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'consecutivo',    label: 'Consec.',          type: 'text'   },
  { key: 'fecha',          label: 'Fecha',            type: 'date'   },
  { key: 'lote',           label: 'Lote',             type: 'text'   },
  { key: 'grupo',          label: 'Grupo',            type: 'text'   },
  { key: 'bloque',         label: 'Bloque',           type: 'text'   },
  { key: 'cantidad',       label: 'Cant. campo',      type: 'number', align: 'right' },
  { key: 'unidad',         label: 'Unidad',           type: 'text'   },
  { key: 'operario',       label: 'Operario',         type: 'text'   },
  { key: 'activo',         label: 'Activo',           type: 'text'   },
  { key: 'implemento',     label: 'Implemento',       type: 'text'   },
  { key: 'nota',           label: 'Nota',             type: 'text'   },
  { key: 'recibido',       label: 'Recibido planta',  type: 'number', align: 'right' },
];

// Columnas que sobreviven en mobile (≤768px); el resto arranca oculto y el
// usuario las habilita desde el col-menu. Evita el scroll-x ciego de 12
// columnas en 360px. Punto #7 audit.
const MOBILE_COLS = new Set(['consecutivo', 'fecha', 'lote', 'cantidad', 'unidad', 'recibido']);

// ── Helpers ──────────────────────────────────────────────────────────────────
function getColVal(r, key) {
  switch (key) {
    case 'consecutivo': return (r.consecutivo || '').toLowerCase();
    // String() defensivo: docs legacy podrían traer fecha como Timestamp y no
    // como string ISO; sin esto slice() rompía sort/filter. Punto #12 audit.
    case 'fecha':       return String(r.fecha || '').slice(0, 10);
    case 'lote':        return (r.loteNombre || '').toLowerCase();
    case 'grupo':       return (r.grupo || '').toLowerCase();
    case 'bloque':      return (r.bloque || '').toLowerCase();
    case 'cantidad':    return r.cantidad || 0;
    case 'unidad':      return (r.unidad || '').toLowerCase();
    case 'operario':    return (r.operarioNombre || '').toLowerCase();
    case 'activo':      return (r.activoNombre || '').toLowerCase();
    case 'implemento':  return (r.implementoNombre || '').toLowerCase();
    case 'nota':        return (r.nota || '').toLowerCase();
    case 'recibido':    return r.cantidadRecibidaPlanta || 0;
    default:            return '';
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CosechaRegistro() {
  const apiFetch = useApiFetch();

  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);
  const [toast,     setToast]     = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [prereqs,   setPrereqs]   = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [highlightId,  setHighlightId]  = useState(null);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Guard contra setState tras unmount (los fetch/PUT no se cancelaban). #10.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // initialVisibleCols sólo se evalúa al montar (mobile vs desktop). #7.
  const initialVisibleCols = useMemo(() => {
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches;
    if (!isMobile) return undefined; // desktop: todas visibles
    return Object.fromEntries(COLUMNS.map(c => [c.key, MOBILE_COLS.has(c.key)]));
  }, []);

  const fetchRegistros = useCallback(() => {
    setLoading(true);
    setError(false);
    apiFetch('/api/cosecha/registros')
      .then(r => r.json())
      .then(data => { if (mountedRef.current) setRegistros(Array.isArray(data) ? data : []); })
      .catch(() => {
        // Error de red explícito: sin esto un fetch fallido se disfrazaba de
        // "Sin registros" y mandaba al usuario a crear datos que ya existen. #9.
        if (mountedRef.current) { setError(true); showToast('Error al cargar el historial.', 'error'); }
      })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, [apiFetch]);

  // Prefetch en paralelo de los catálogos que necesita el modal "Nuevo registro",
  // para que al abrirlo se renderice instantáneo en vez de esperar 6 fetches.
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/users/lite').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ]).then(([lotes, grupos, siembras, unidades, usuarios, maquinaria]) => {
      if (!alive) return;
      setPrereqs({
        lotes:      Array.isArray(lotes)      ? lotes      : [],
        grupos:     Array.isArray(grupos)     ? grupos     : [],
        siembras:   Array.isArray(siembras)   ? siembras   : [],
        unidades:   Array.isArray(unidades)   ? unidades   : [],
        usuarios:   Array.isArray(usuarios)   ? usuarios.filter(u => u.empleadoPlanilla) : [],
        maquinaria: Array.isArray(maquinaria) ? maquinaria : [],
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchRegistros(); }, [fetchRegistros]);

  // Resalta la fila recién creada unos segundos. #4.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => { if (mountedRef.current) setHighlightId(null); }, 4000);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Inline update de cantidadRecibidaPlanta. Re-lanza en fallo para que el
  // editor inline quede abierto y permita reintentar (lo maneja InlineNumberEdit).
  const handleRecibido = async (reg, rawVal) => {
    const parsed = rawVal !== '' ? parseFloat(rawVal) : null;
    const cantidadRecibidaPlanta = parsed != null && !isNaN(parsed) ? parsed : null;
    try {
      const res = await apiFetch(`/api/cosecha/registros/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidadRecibidaPlanta }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(translateApiError(body, 'No se pudo guardar.'));
      }
      if (!mountedRef.current) return;
      setRegistros(prev =>
        prev.map(r => r.id === reg.id ? { ...r, cantidadRecibidaPlanta } : r),
      );
      showToast('Cantidad recibida en planta actualizada.');
    } catch (err) {
      if (mountedRef.current) showToast(err.message || 'Error al guardar.', 'error');
      throw err;
    }
  };

  // Borrado de registro con confirmación. El backend rechaza (409) si el
  // registro está usado como boleta en un despacho activo. #1.
  const handleDelete = async () => {
    if (!deleteTarget || deleteSaving) return;
    setDeleteSaving(true);
    try {
      const res = await apiFetch(`/api/cosecha/registros/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(translateApiError(body, 'No se pudo eliminar el registro.'));
      }
      if (!mountedRef.current) return;
      setDeleteTarget(null);
      showToast('Registro eliminado.');
      fetchRegistros();
    } catch (err) {
      if (mountedRef.current) showToast(err.message || 'No se pudo eliminar el registro.', 'error');
    } finally {
      if (mountedRef.current) setDeleteSaving(false);
    }
  };

  const renderRow = (reg, visibleCols) => (
    <>
      {visibleCols.consecutivo && <td className="harvest-td-consec">{reg.consecutivo || '—'}</td>}
      {visibleCols.fecha       && <td>{fmt(reg.fecha)}</td>}
      {visibleCols.lote        && <td>{reg.loteNombre      || '—'}</td>}
      {visibleCols.grupo       && <td>{reg.grupo           || '—'}</td>}
      {visibleCols.bloque      && <td>{reg.bloque          || '—'}</td>}
      {visibleCols.cantidad    && <td className="aur-td-num">{num(reg.cantidad)}</td>}
      {visibleCols.unidad      && <td>{reg.unidad          || '—'}</td>}
      {visibleCols.operario    && <td>{reg.operarioNombre  || '—'}</td>}
      {visibleCols.activo      && <td>{reg.activoNombre    || '—'}</td>}
      {visibleCols.implemento  && <td>{reg.implementoNombre || '—'}</td>}
      {visibleCols.nota        && <td><NotaCell text={reg.nota} /></td>}
      {visibleCols.recibido    && (
        <td className="aur-td-num">
          <InlineNumberEdit
            value={reg.cantidadRecibidaPlanta}
            onSave={(v) => handleRecibido(reg, v)}
            min={0}
            max={RECIBIDO_MAX}
            compareTo={reg.cantidad}
            compareLabel="merma"
            ariaLabel={`Cantidad recibida en planta del registro ${reg.consecutivo || ''}`.trim()}
            openHint="Clic para ingresar el valor recibido en planta"
          />
        </td>
      )}
    </>
  );

  const trailingCell = (reg) => (
    <td className="harvest-actions-cell">
      <button
        type="button"
        className="aur-btn-text aur-btn-text--danger harvest-anular-btn"
        onClick={() => setDeleteTarget(reg)}
      >
        <FiTrash2 size={13} /> Eliminar
      </button>
    </td>
  );

  return (
    <div className="harvest-page harvest-registro-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Registro de cosecha</h1>
            <p className="aur-sheet-subtitle">
              Visualiza el histórico de cosecha o registra una nueva. Útil para el cálculo del costo por lote o por kg.
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setModalOpen(true)}
            >
              <FiPlus size={14} /> Nuevo registro
            </button>
          </div>
        </header>

        {loading ? (
          <div className="empty-state" role="status"><p className="item-main-text">Cargando historial…</p></div>
        ) : error ? (
          <div className="aur-banner aur-banner--danger">
            <FiAlertTriangle size={15} />
            <span>
              No se pudo cargar el historial. <button type="button" className="aur-btn-text" onClick={fetchRegistros}>Reintentar</button>
            </span>
          </div>
        ) : registros.length === 0 ? (
          <div className="empty-state">
            <p className="item-main-text">Sin registros de cosecha</p>
            <p>Los registros aparecen aquí una vez creados desde el botón "Nuevo registro".</p>
          </div>
        ) : (
          <AuroraDataTable
            columns={COLUMNS}
            data={registros}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            initialVisibleCols={initialVisibleCols}
            renderRow={renderRow}
            trailingHead={<th>Acciones</th>}
            trailingCell={trailingCell}
            rowClassName={(r) => r.id === highlightId ? 'harvest-row--new' : ''}
            emptyIcon={<FiInbox size={26} />}
            emptyText="No hay registros con los filtros aplicados."
            emptySubtitle="Ajustá o limpiá los filtros de columna para ver más resultados."
          />
        )}
      </div>

      {modalOpen && (
        <CosechaRegistroModal
          apiFetch={apiFetch}
          prereqs={prereqs}
          onSuccess={(created) => {
            showToast('Registro guardado.');
            if (created?.id) setHighlightId(created.id);
            fetchRegistros();
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {deleteTarget && (
        <AuroraConfirmModal
          danger
          title="Eliminar registro de cosecha"
          body={
            <>
              Vas a eliminar el registro <strong>{deleteTarget.consecutivo || '—'}</strong>
              {deleteTarget.loteNombre ? <> del lote <strong>{deleteTarget.loteNombre}</strong></> : null}
              {deleteTarget.cantidad != null
                ? <> por <strong>{num(deleteTarget.cantidad)} {deleteTarget.unidad || ''}</strong></>
                : null}. Esta acción no se puede deshacer. Si el registro ya está usado
              como boleta en un despacho activo, el sistema lo va a impedir.
            </>
          }
          confirmLabel="Eliminar registro"
          loadingLabel="Eliminando…"
          loading={deleteSaving}
          onConfirm={handleDelete}
          onCancel={() => { if (!deleteSaving) setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}
