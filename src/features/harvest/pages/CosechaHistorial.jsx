import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiCheck, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import Toast from '../../../components/Toast';
import HarvestDataTable from '../components/HarvestDataTable';
import '../styles/harvest.css';

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

function getColVal(r, key) {
  switch (key) {
    case 'consecutivo': return (r.consecutivo || '').toLowerCase();
    case 'fecha':       return r.fecha?.slice(0, 10) || '';
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

// ── Nota cell con expand/collapse ────────────────────────────────────────────
function NotaCell({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped]   = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  if (!text) return <span className="harvest-td-empty">—</span>;

  return (
    <span className="harvest-nota">
      <span ref={textRef} className={`harvest-nota-text${expanded ? ' harvest-nota-text--open' : ''}`}>
        {text}
      </span>
      {(clamped || expanded) && (
        <button type="button" className="harvest-nota-toggle" onClick={() => setExpanded(p => !p)}>
          {expanded ? 'ver menos' : 'ver más'}
        </button>
      )}
    </span>
  );
}

// ── Cell editable inline para cantidadRecibidaPlanta ─────────────────────────
function InlineRecibido({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [val, setVal]         = useState('');
  const inputRef              = useRef(null);

  const open   = () => { setVal(value ?? ''); setEditing(true); };
  const cancel = () => setEditing(false);
  const save   = async () => {
    if (saving) return;
    setSaving(true);
    try { await onSave(val); } finally { setSaving(false); setEditing(false); }
  };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <span className="harvest-inline-edit">
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className="harvest-inline-input"
          disabled={saving}
        />
        <button
          type="button"
          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success"
          onClick={save}
          title="Guardar"
          disabled={saving}
        >
          <FiCheck size={13} />
        </button>
        <button
          type="button"
          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
          onClick={cancel}
          title="Cancelar"
          disabled={saving}
        >
          <FiX size={13} />
        </button>
      </span>
    );
  }

  const isPending = !(value != null && value !== '');
  return (
    <span
      className={`harvest-inline-cell${isPending ? ' harvest-inline-cell--pending' : ''}`}
      onClick={open}
      title="Clic para ingresar el valor recibido en planta"
    >
      {isPending ? 'Pendiente' : num(value)}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function CosechaHistorial() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const fetchRegistros = () => {
    setLoading(true);
    apiFetch('/api/cosecha/registros')
      .then(r => r.json())
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRegistros(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Inline update de cantidadRecibidaPlanta
  const handleRecibido = async (reg, rawVal) => {
    const parsed = rawVal !== '' ? parseFloat(rawVal) : null;
    const cantidadRecibidaPlanta = parsed != null && !isNaN(parsed) ? parsed : null;
    try {
      const res = await apiFetch(`/api/cosecha/registros/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidadRecibidaPlanta }),
      });
      if (!res.ok) throw new Error();
      setRegistros(prev =>
        prev.map(r => r.id === reg.id ? { ...r, cantidadRecibidaPlanta } : r),
      );
      showToast('Cantidad recibida en planta actualizada.');
    } catch {
      showToast('Error al guardar.', 'error');
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
          <InlineRecibido
            value={reg.cantidadRecibidaPlanta}
            onSave={(v) => handleRecibido(reg, v)}
          />
        </td>
      )}
    </>
  );

  return (
    <div className="harvest-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Historial de cosecha</h1>
            <p className="aur-sheet-subtitle">
              {loading ? 'Cargando…' : `${registros.length} registro${registros.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => navigate('/cosecha/registro')}
            >
              <FiPlus size={14} /> Nuevo registro
            </button>
          </div>
        </header>

        {loading ? (
          <div className="empty-state"><p className="item-main-text">Cargando historial…</p></div>
        ) : registros.length === 0 ? (
          <div className="empty-state">
            <p className="item-main-text">Sin registros de cosecha</p>
            <p>Los registros aparecen aquí una vez creados desde Registro de Cosecha.</p>
          </div>
        ) : (
          <HarvestDataTable
            columns={COLUMNS}
            data={registros}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            renderRow={renderRow}
          />
        )}
      </div>
    </div>
  );
}
