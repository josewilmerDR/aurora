import { useState, useEffect, useMemo, useRef } from 'react';
import { FiSearch, FiX, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import Toast from '../components/Toast';
import './CosechaHistorial.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v) => (v != null && v !== '' ? Number(v).toLocaleString('es-ES') : '—');

// ── Inline-editable cell for cantidadRecibidaPlanta ──────────────────────────
function InlineRecibido({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState('');
  const inputRef              = useRef(null);

  const open   = () => { setVal(value ?? ''); setEditing(true); };
  const cancel = () => setEditing(false);
  const save   = () => { onSave(val); setEditing(false); };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <span className="ch-inline-edit">
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="0.01"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          className="ch-inline-input"
        />
        <button className="ch-inline-ok"     onClick={save}   title="Guardar">✓</button>
        <button className="ch-inline-cancel" onClick={cancel} title="Cancelar">✕</button>
      </span>
    );
  }

  return (
    <span
      className={`ch-inline-value${value != null && value !== '' ? '' : ' ch-inline-pending'}`}
      onClick={open}
      title="Clic para ingresar el valor recibido en planta"
    >
      {value != null && value !== '' ? num(value) : 'Pendiente'}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CosechaHistorial() {
  const apiFetch = useApiFetch();

  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [sortField, setSortField] = useState('consecutivo');
  const [sortDir,   setSortDir]   = useState('desc');

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // ── Carga ─────────────────────────────────────────────────────────────────
  const fetchRegistros = () => {
    setLoading(true);
    apiFetch('/api/cosecha/registros')
      .then(r => r.json())
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial.', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRegistros(); }, []);

  // ── Actualización inline de "recibido en planta" ──────────────────────────
  const handleRecibido = async (reg, rawVal) => {
    const cantidadRecibidaPlanta = rawVal !== '' ? parseFloat(rawVal) : null;
    try {
      const res = await apiFetch(`/api/cosecha/registros/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidadRecibidaPlanta }),
      });
      if (!res.ok) throw new Error();
      setRegistros(prev =>
        prev.map(r => r.id === reg.id ? { ...r, cantidadRecibidaPlanta } : r)
      );
      showToast('Cantidad recibida en planta actualizada.');
    } catch {
      showToast('Error al guardar.', 'error');
    }
  };

  // ── Filtrado y ordenamiento ───────────────────────────────────────────────
  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return registros
      .filter(r =>
        !q ||
        (r.consecutivo     || '').toLowerCase().includes(q) ||
        (r.loteNombre      || '').toLowerCase().includes(q) ||
        (r.grupo           || '').toLowerCase().includes(q) ||
        (r.bloque          || '').toLowerCase().includes(q) ||
        (r.operarioNombre  || '').toLowerCase().includes(q) ||
        (r.activoNombre    || '').toLowerCase().includes(q) ||
        (r.implementoNombre || '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const av = a[sortField] ?? '';
        const bv = b[sortField] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [registros, search, sortField, sortDir]);

  // ── Subcomponente: encabezado de columna ordenable ────────────────────────
  const Th = ({ field, label, className = '' }) => (
    <th
      className={`ch-th ch-th-sortable ${className}`}
      onClick={() => toggleSort(field)}
    >
      {label}
      {sortField === field
        ? (sortDir === 'asc'
            ? <FiChevronUp   className="ch-sort-icon ch-sort-active" />
            : <FiChevronDown className="ch-sort-icon ch-sort-active" />)
        : <FiChevronUp className="ch-sort-icon ch-sort-inactive" />}
    </th>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cosecha-page">

      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="ch-header">
        <div>
          <h1 className="ch-title">Historial de Cosecha</h1>
          <p className="ch-subtitle">
            {loading ? 'Cargando…' : `${filtered.length} registro${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* ── Buscador ────────────────────────────────────────────────────── */}
      <div className="ch-search-wrap">
        <FiSearch className="ch-search-icon" size={16} />
        <input
          className="ch-search"
          placeholder="Buscar por consecutivo, lote, grupo, bloque, operario, activo…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="ch-search-clear" onClick={() => setSearch('')}>
            <FiX size={14} />
          </button>
        )}
      </div>

      {/* ── Tabla ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="empty-state"><p className="item-main-text">Cargando historial…</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p className="item-main-text">{search ? 'Sin resultados para la búsqueda' : 'Sin registros de cosecha'}</p>
          {!search && (
            <p>Los registros aparecen aquí una vez creados desde <strong>Registro de Cosecha</strong>.</p>
          )}
        </div>
      ) : (
        <div className="ch-table-wrap">
          <table className="ch-table">
            <thead>
              <tr>
                <Th field="consecutivo"    label="Consec." />
                <Th field="fecha"          label="Fecha" />
                <Th field="loteNombre"     label="Lote" />
                <Th field="grupo"          label="Grupo" />
                <Th field="bloque"         label="Bloque" />
                <Th field="cantidad"       label="Cant. campo" className="ch-th-num" />
                <Th field="unidad"         label="Unidad" />
                <Th field="operarioNombre" label="Operario" />
                <Th field="activoNombre"   label="Activo" />
                <Th field="implementoNombre" label="Implemento" />
                <th className="ch-th">Nota</th>
                <th className="ch-th ch-th-recibido">Recibido en planta</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(reg => (
                <tr key={reg.id} className="ch-tr">
                  <td className="ch-td ch-consec">{reg.consecutivo || '—'}</td>
                  <td className="ch-td ch-nowrap">{fmt(reg.fecha)}</td>
                  <td className="ch-td">{reg.loteNombre || '—'}</td>
                  <td className="ch-td">{reg.grupo      || '—'}</td>
                  <td className="ch-td">{reg.bloque     || '—'}</td>
                  <td className="ch-td ch-num">{num(reg.cantidad)}</td>
                  <td className="ch-td">{reg.unidad     || '—'}</td>
                  <td className="ch-td">{reg.operarioNombre   || '—'}</td>
                  <td className="ch-td">{reg.activoNombre     || '—'}</td>
                  <td className="ch-td">{reg.implementoNombre || '—'}</td>
                  <td className="ch-td ch-nota" title={reg.nota || ''}>{reg.nota || '—'}</td>
                  <td className="ch-td ch-td-recibido">
                    <InlineRecibido
                      value={reg.cantidadRecibidaPlanta}
                      onSave={(v) => handleRecibido(reg, v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
