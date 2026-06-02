import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiDollarSign, FiSlash, FiInbox } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import AuroraDataTable from '../../../components/AuroraDataTable';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import CosechaDespachoModal from '../components/CosechaDespachoModal';
import NotaCell from '../components/NotaCell';
import { fmt, num } from '../lib/format';
import { translateApiError } from '../../../lib/errorMessages';
import { buildDispatchIncomeMap } from '../../finance/lib/linkedDispatches';
import '../styles/harvest.css';

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'consecutivo', label: 'Consec.',     type: 'text'   },
  { key: 'fecha',       label: 'Fecha',       type: 'date'   },
  { key: 'lote',        label: 'Lote',        type: 'text'   },
  { key: 'comprador',   label: 'Comprador',   type: 'text'   },
  { key: 'operario',    label: 'Op. camión',  type: 'text'   },
  { key: 'placa',       label: 'Placa',       type: 'text'   },
  { key: 'cantidad',    label: 'Cantidad',    type: 'number', align: 'right' },
  { key: 'unidad',      label: 'Unidad',      type: 'text'   },
  { key: 'despachador', label: 'Despachador', type: 'text'   },
  { key: 'encargado',   label: 'Encargado',   type: 'text'   },
  { key: 'boletas',     label: 'Boletas',     type: 'text'   },
  { key: 'nota',        label: 'Nota',        type: 'text'   },
  { key: 'estado',      label: 'Estado',      type: 'text'   },
];

// Columnas que sobreviven en mobile (≤768px); el resto arranca oculto y el
// usuario las habilita desde el col-menu. Evita el scroll-x ciego de 13
// columnas en 360px. Punto #15 audit.
const MOBILE_COLS = new Set(['consecutivo', 'fecha', 'lote', 'comprador', 'cantidad', 'estado']);

// ── Helpers ──────────────────────────────────────────────────────────────────
function getColVal(d, key) {
  switch (key) {
    case 'consecutivo': return (d.consecutivo || '').toLowerCase();
    // String() defensivo: docs legacy podrían traer fecha como Timestamp y no
    // como ISO string; sin esto slice() rompía sort/filter. Punto #18 audit.
    case 'fecha':       return String(d.fecha || '').slice(0, 10);
    case 'lote':        return (d.loteNombre || '').toLowerCase();
    case 'comprador':   return (d.buyerName || '').toLowerCase();
    case 'operario':    return (d.operarioCamionNombre || '').toLowerCase();
    case 'placa':       return (d.placaCamion || '').toLowerCase();
    case 'cantidad':    return d.cantidad || 0;
    case 'unidad':      return (d.unidad || '').toLowerCase();
    case 'despachador': return (d.despachadorNombre || '').toLowerCase();
    case 'encargado':   return (d.encargadoNombre || '').toLowerCase();
    // Precomputado en fetch para no rehacer map().join() por fila en cada
    // sort/filter. Punto #27 audit.
    case 'boletas':     return d._boletasStr || '';
    case 'nota':        return (d.nota || '').toLowerCase();
    case 'estado':      return (d.estado || '').toLowerCase();
    default:            return '';
  }
}

// Aplana boletas a un string buscable una sola vez al cargar.
const withDerived = (arr) =>
  arr.map(d => ({
    ...d,
    _boletasStr: (d.boletas?.map(b => b.consecutivo || '').join(', ') || '').toLowerCase(),
  }));

// ── Main Component ───────────────────────────────────────────────────────────
export default function CosechaDespachos() {
  const apiFetch = useApiFetch();

  const [despachos, setDespachos]               = useState([]);
  const [loading,   setLoading]                 = useState(true);
  const [toast,     setToast]                   = useState(null);
  const [modalOpen, setModalOpen]               = useState(false);
  const [dispatchIncome, setDispatchIncome]     = useState(new Map());
  const [prereqs,   setPrereqs]                 = useState(null);
  const [anularTarget, setAnularTarget]         = useState(null);
  const [anularNota, setAnularNota]             = useState('');
  const [anularSaving, setAnularSaving]         = useState(false);
  const [highlightId, setHighlightId]           = useState(null);

  // Evita setState sobre componente desmontado (los fetch no se cancelaban).
  // Punto #12 audit.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // initialVisibleCols sólo se evalúa al montar (mobile vs desktop). Punto #15.
  const initialVisibleCols = useMemo(() => {
    const isMobile = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 768px)').matches;
    if (!isMobile) return undefined; // desktop: todas visibles
    return Object.fromEntries(COLUMNS.map(c => [c.key, MOBILE_COLS.has(c.key)]));
  }, []);

  const fetchDespachos = () => {
    setLoading(true);
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => { if (mountedRef.current) setDespachos(withDerived(Array.isArray(data) ? data : [])); })
      .catch(() => { if (mountedRef.current) showToast('Error al cargar el historial de despachos.', 'error'); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  };

  const loadLinkedIncome = () => {
    apiFetch('/api/income')
      .then(r => r.json())
      .then(data => { if (mountedRef.current) setDispatchIncome(buildDispatchIncomeMap(data)); })
      .catch(() => {});
  };

  // Prefetch en paralelo de los catálogos del modal "Nuevo despacho",
  // para que al abrirlo se renderice instantáneo en vez de esperar 4 fetches.
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users/lite').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/cosecha/registros').then(r => r.json()),
    ]).then(([lotesData, usersData, unidadesData, registrosData]) => {
      if (!alive) return;
      setPrereqs({
        lotes:            Array.isArray(lotesData)     ? lotesData     : [],
        usuarios:         Array.isArray(usersData)     ? usersData.filter(u => u.empleadoPlanilla) : [],
        unidades:         Array.isArray(unidadesData)  ? unidadesData  : [],
        registrosCosecha: Array.isArray(registrosData) ? registrosData : [],
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchDespachos();
    loadLinkedIncome();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resalta la fila recién creada unos segundos. Punto #11 audit.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => { if (mountedRef.current) setHighlightId(null); }, 4000);
    return () => clearTimeout(t);
  }, [highlightId]);

  const handleAnular = async () => {
    if (!anularTarget || anularSaving) return;
    if (!anularNota.trim()) return;
    setAnularSaving(true);
    try {
      const res = await apiFetch(`/api/cosecha/despachos/${anularTarget.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'anulado', notaAnulacion: anularNota.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(translateApiError(body, 'No se pudo anular el despacho.'));
      }
      setAnularTarget(null);
      setAnularNota('');
      showToast('Despacho anulado.');
      fetchDespachos();
    } catch (err) {
      showToast(err.message || 'No se pudo anular el despacho.', 'error');
    } finally {
      if (mountedRef.current) setAnularSaving(false);
    }
  };

  const renderRow = (d, visibleCols) => (
    <>
      {visibleCols.consecutivo && <td className="harvest-td-consec">{d.consecutivo || '—'}</td>}
      {visibleCols.fecha       && <td>{fmt(d.fecha)}</td>}
      {visibleCols.lote        && <td>{d.loteNombre           || '—'}</td>}
      {visibleCols.comprador   && <td>{d.buyerName            || '—'}</td>}
      {visibleCols.operario    && <td>{d.operarioCamionNombre || '—'}</td>}
      {visibleCols.placa       && <td>{d.placaCamion          || '—'}</td>}
      {visibleCols.cantidad    && <td className="aur-td-num">{num(d.cantidad)}</td>}
      {visibleCols.unidad      && <td>{d.unidad               || '—'}</td>}
      {visibleCols.despachador && <td>{d.despachadorNombre    || '—'}</td>}
      {visibleCols.encargado   && <td>{d.encargadoNombre      || '—'}</td>}
      {visibleCols.boletas     && <td>{d.boletas?.length ? d.boletas.map(b => b.consecutivo || '?').join(', ') : '—'}</td>}
      {visibleCols.nota        && <td><NotaCell text={d.nota} /></td>}
      {visibleCols.estado      && (
        <td>
          {d.estado === 'anulado'
            ? <span className="harvest-badge harvest-badge--anulado" title={d.notaAnulacion || 'Despacho anulado'}>Anulado</span>
            : <span className="harvest-badge harvest-badge--activo">Activo</span>}
        </td>
      )}
    </>
  );

  const trailingCell = (d) => {
    const linked = dispatchIncome.has(d.id);
    return (
      <td className="harvest-actions-cell">
        {linked ? (
          <Link
            to="/finance/income"
            className="harvest-badge harvest-badge--linked"
            title="Este despacho ya tiene un ingreso registrado — abrir Ingresos"
          >
            <FiDollarSign size={12} /> Ingreso registrado
          </Link>
        ) : d.estado !== 'anulado' ? (
          <button
            type="button"
            className="aur-btn-text aur-btn-text--danger harvest-anular-btn"
            onClick={() => { setAnularTarget(d); setAnularNota(''); }}
          >
            <FiSlash size={13} /> Anular
          </button>
        ) : null}
      </td>
    );
  };

  return (
    <div className="harvest-page harvest-despacho-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Despacho de cosecha</h1>
            <p className="aur-sheet-subtitle">
              Visualiza el histórico de despacho o registra uno nuevo. Útil para justificar los ingresos de la organización.
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setModalOpen(true)}
            >
              <FiPlus size={14} /> Nuevo despacho
            </button>
          </div>
        </header>

        {loading ? (
          <div className="empty-state"><p className="item-main-text">Cargando historial…</p></div>
        ) : despachos.length === 0 ? (
          <div className="empty-state">
            <p className="item-main-text">Sin despachos registrados</p>
            <p>Los despachos aparecen aquí una vez creados desde el botón "Nuevo despacho".</p>
          </div>
        ) : (
          <AuroraDataTable
            columns={COLUMNS}
            data={despachos}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            initialVisibleCols={initialVisibleCols}
            renderRow={renderRow}
            trailingHead={<th>Acciones</th>}
            trailingCell={trailingCell}
            rowClassName={(d) => {
              const cls = [];
              if (d.estado === 'anulado') cls.push('harvest-row--anulado');
              if (d.id === highlightId) cls.push('harvest-row--new');
              return cls.join(' ');
            }}
            emptyIcon={<FiInbox size={26} />}
            emptyText="No hay despachos con los filtros aplicados."
            emptySubtitle="Ajustá o limpiá los filtros de columna para ver más resultados."
          />
        )}
      </div>

      {modalOpen && (
        <CosechaDespachoModal
          apiFetch={apiFetch}
          prereqs={prereqs}
          existingDespachos={despachos}
          onSuccess={(created) => {
            showToast('Despacho registrado.');
            if (created?.id) setHighlightId(created.id);
            fetchDespachos();
            loadLinkedIncome();
          }}
          onClose={() => setModalOpen(false)}
        />
      )}

      {anularTarget && (
        <AuroraConfirmModal
          danger
          title="Anular despacho"
          body={
            <>
              Vas a anular el despacho <strong>{anularTarget.consecutivo}</strong>
              {anularTarget.loteNombre ? <> del lote <strong>{anularTarget.loteNombre}</strong></> : null}
              {anularTarget.cantidad != null
                ? <> por <strong>{num(anularTarget.cantidad)} {anularTarget.unidad || ''}</strong></>
                : null}
              {anularTarget.buyerName ? <> a <strong>{anularTarget.buyerName}</strong></> : null}.
              Sus boletas vuelven a quedar disponibles y deja de contar como
              despacho activo. La acción es reversible reactivándolo.
            </>
          }
          confirmLabel="Anular despacho"
          loadingLabel="Anulando…"
          loading={anularSaving}
          confirmDisabled={!anularNota.trim()}
          onConfirm={handleAnular}
          onCancel={() => { if (!anularSaving) { setAnularTarget(null); setAnularNota(''); } }}
        >
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="anular-nota">Motivo de anulación</label>
            <textarea
              id="anular-nota"
              className="aur-textarea"
              value={anularNota}
              onChange={(e) => setAnularNota(e.target.value)}
              placeholder="¿Por qué se anula este despacho?"
              rows={2}
              maxLength={288}
              autoFocus
            />
          </div>
        </AuroraConfirmModal>
      )}
    </div>
  );
}
