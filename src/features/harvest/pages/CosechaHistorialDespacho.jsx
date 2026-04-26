import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiDollarSign } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import HarvestDataTable from '../components/HarvestDataTable';
import '../styles/harvest.css';

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'consecutivo', label: 'Consec.',     type: 'text'   },
  { key: 'fecha',       label: 'Fecha',       type: 'date'   },
  { key: 'lote',        label: 'Lote',        type: 'text'   },
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

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' });
};
const num = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString('es-ES');
};

function getColVal(d, key) {
  switch (key) {
    case 'consecutivo': return (d.consecutivo || '').toLowerCase();
    case 'fecha':       return d.fecha?.slice(0, 10) || '';
    case 'lote':        return (d.loteNombre || '').toLowerCase();
    case 'operario':    return (d.operarioCamionNombre || '').toLowerCase();
    case 'placa':       return (d.placaCamion || '').toLowerCase();
    case 'cantidad':    return d.cantidad || 0;
    case 'unidad':      return (d.unidad || '').toLowerCase();
    case 'despachador': return (d.despachadorNombre || '').toLowerCase();
    case 'encargado':   return (d.encargadoNombre || '').toLowerCase();
    case 'boletas':     return (d.boletas?.map(b => b.consecutivo || '').join(', ') || '').toLowerCase();
    case 'nota':        return (d.nota || '').toLowerCase();
    case 'estado':      return (d.estado || '').toLowerCase();
    default:            return '';
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CosechaHistorialDespacho() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [despachos, setDespachos]                 = useState([]);
  const [loading,   setLoading]                   = useState(true);
  const [toast,     setToast]                     = useState(null);
  const [linkedDispatchIds, setLinkedDispatchIds] = useState(new Set());

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const loadLinkedIncome = () => {
    apiFetch('/api/income')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        const ids = new Set();
        for (const inc of data) {
          if (Array.isArray(inc.despachoIds)) {
            for (const d of inc.despachoIds) if (d?.id) ids.add(d.id);
          }
          if (inc.despachoId) ids.add(inc.despachoId);
        }
        setLinkedDispatchIds(ids);
      })
      .catch(() => {});
  };

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => setDespachos(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial de despachos.', 'error'))
      .finally(() => setLoading(false));
    loadLinkedIncome();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const renderRow = (d, visibleCols) => (
    <>
      {visibleCols.consecutivo && <td className="harvest-td-consec">{d.consecutivo || '—'}</td>}
      {visibleCols.fecha       && <td>{fmt(d.fecha)}</td>}
      {visibleCols.lote        && <td>{d.loteNombre           || '—'}</td>}
      {visibleCols.operario    && <td>{d.operarioCamionNombre || '—'}</td>}
      {visibleCols.placa       && <td>{d.placaCamion          || '—'}</td>}
      {visibleCols.cantidad    && <td className="aur-td-num">{num(d.cantidad)}</td>}
      {visibleCols.unidad      && <td>{d.unidad               || '—'}</td>}
      {visibleCols.despachador && <td>{d.despachadorNombre    || '—'}</td>}
      {visibleCols.encargado   && <td>{d.encargadoNombre      || '—'}</td>}
      {visibleCols.boletas     && <td>{d.boletas?.length ? d.boletas.map(b => b.consecutivo || '?').join(', ') : '—'}</td>}
      {visibleCols.nota        && <td><span className="harvest-nota"><span className="harvest-nota-text" title={d.nota || ''}>{d.nota || '—'}</span></span></td>}
      {visibleCols.estado      && (
        <td>
          {d.estado === 'anulado'
            ? <span className="harvest-badge harvest-badge--anulado">Anulado</span>
            : <span className="harvest-badge harvest-badge--activo">Activo</span>}
        </td>
      )}
    </>
  );

  const trailingCell = (d) => {
    const linked = linkedDispatchIds.has(d.id);
    return (
      <td>
        {linked && (
          <span className="harvest-badge harvest-badge--linked" title="Este despacho ya tiene un ingreso registrado">
            <FiDollarSign size={12} /> Ingreso registrado
          </span>
        )}
      </td>
    );
  };

  return (
    <div className="harvest-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Historial de despachos</h1>
            <p className="aur-sheet-subtitle">
              {loading ? 'Cargando…' : `${despachos.length} despacho${despachos.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => navigate('/cosecha/despacho')}
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
            <p>Los despachos aparecen aquí una vez creados desde Despacho de Cosecha.</p>
          </div>
        ) : (
          <HarvestDataTable
            columns={COLUMNS}
            data={despachos}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            renderRow={renderRow}
            trailingCell={trailingCell}
            rowClassName={(d) => d.estado === 'anulado' ? 'harvest-row--anulado' : ''}
          />
        )}
      </div>
    </div>
  );
}
