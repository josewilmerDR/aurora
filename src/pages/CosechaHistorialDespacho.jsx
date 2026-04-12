import { useState, useEffect, useMemo } from 'react';
import { FiSearch, FiX, FiChevronUp, FiChevronDown } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import Toast from '../components/Toast';
import './CosechaHistorial.css';
import './DespachosCosecha.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString('es-ES');
};

// ── Subcomponente: encabezado de columna ordenable ──────────────────────────
const Th = ({ field, label, className = '', sortField, sortDir, onSort }) => (
  <th
    className={`ch-th ch-th-sortable ${className}`}
    onClick={() => onSort(field)}
  >
    {label}
    {sortField === field
      ? (sortDir === 'asc'
          ? <FiChevronUp   className="ch-sort-icon ch-sort-active" />
          : <FiChevronDown className="ch-sort-icon ch-sort-active" />)
      : <FiChevronUp className="ch-sort-icon ch-sort-inactive" />}
  </th>
);

// ── Main Component ────────────────────────────────────────────────────────────
export default function CosechaHistorialDespacho() {
  const apiFetch = useApiFetch();

  const [despachos, setDespachos] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [sortField, setSortField] = useState('consecutivo');
  const [sortDir,   setSortDir]   = useState('desc');

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // ── Carga ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => setDespachos(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar el historial de despachos.', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtrado y ordenamiento ───────────────────────────────────────────────
  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return despachos
      .filter(d =>
        !q ||
        (d.consecutivo          || '').toLowerCase().includes(q) ||
        (d.loteNombre           || '').toLowerCase().includes(q) ||
        (d.operarioCamionNombre || '').toLowerCase().includes(q) ||
        (d.placaCamion          || '').toLowerCase().includes(q) ||
        (d.despachadorNombre    || '').toLowerCase().includes(q) ||
        (d.encargadoNombre      || '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const av = a[sortField] ?? '';
        const bv = b[sortField] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [despachos, search, sortField, sortDir]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cosecha-page">

      {/* ── Encabezado ──────────────────────────────────────────────────── */}
      <div className="ch-header">
        <div>
          <h1 className="ch-title">Historial de Despachos</h1>
          <p className="ch-subtitle">
            {loading ? 'Cargando…' : `${filtered.length} despacho${filtered.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* ── Buscador ────────────────────────────────────────────────────── */}
      <div className="ch-search-wrap">
        <FiSearch className="ch-search-icon" size={16} />
        <input
          className="ch-search"
          placeholder="Buscar por consecutivo, lote, operario, placa, despachador…"
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
          <p className="item-main-text">{search ? 'Sin resultados para la búsqueda' : 'Sin despachos registrados'}</p>
          {!search && (
            <p>Los despachos aparecen aquí una vez creados desde <strong>Despacho de Cosecha</strong>.</p>
          )}
        </div>
      ) : (
        <div className="ch-table-wrap">
          <table className="ch-table">
            <thead>
              <tr>
                <Th field="consecutivo"          label="Consec."      sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="fecha"                label="Fecha"        sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="loteNombre"           label="Lote"         sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="operarioCamionNombre" label="Op. camión"   sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="placaCamion"          label="Placa"        sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="cantidad"             label="Cantidad"     sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="ch-th-num" />
                <Th field="unidad"               label="Unidad"       sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="despachadorNombre"    label="Despachador"  sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <Th field="encargadoNombre"      label="Encargado"    sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="ch-th">Boletas</th>
                <th className="ch-th">Nota</th>
                <Th field="estado"               label="Estado"       sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className={`ch-tr${d.estado === 'anulado' ? ' dsp-item--anulado' : ''}`}>
                  <td className="ch-td ch-consec">{d.consecutivo || '—'}</td>
                  <td className="ch-td ch-nowrap">{fmt(d.fecha)}</td>
                  <td className="ch-td">{d.loteNombre           || '—'}</td>
                  <td className="ch-td">{d.operarioCamionNombre || '—'}</td>
                  <td className="ch-td">{d.placaCamion          || '—'}</td>
                  <td className="ch-td ch-num">{num(d.cantidad)}</td>
                  <td className="ch-td">{d.unidad               || '—'}</td>
                  <td className="ch-td">{d.despachadorNombre    || '—'}</td>
                  <td className="ch-td">{d.encargadoNombre      || '—'}</td>
                  <td className="ch-td">
                    {d.boletas?.length
                      ? d.boletas.map(b => b.consecutivo || '?').join(', ')
                      : '—'}
                  </td>
                  <td className="ch-td ch-nota" title={d.nota || ''}>{d.nota || '—'}</td>
                  <td className="ch-td">
                    {d.estado === 'anulado'
                      ? <span className="dsp-badge dsp-badge--anulado">Anulado</span>
                      : <span className="dsp-badge dsp-badge--activo">Activo</span>}
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
