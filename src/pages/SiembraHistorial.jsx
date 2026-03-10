import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  FiTrash2, FiCheckCircle, FiCircle, FiAlertCircle,
  FiDownload, FiPrinter, FiFilter, FiChevronLeft, FiX,
} from 'react-icons/fi';
import { useUser, hasMinRole } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import Toast from '../components/Toast';
import './Siembra.css';
import './SiembraHistorial.css';

// ── Sort utilities (same as Siembra.jsx) ─────────────────────────────────────
const SORT_FIELDS = [
  { value: 'fecha',    label: 'Fecha' },
  { value: 'lote',     label: 'Lote' },
  { value: 'bloque',   label: 'Bloque' },
  { value: 'plantas',  label: 'Plantas' },
  { value: 'area',     label: 'Área' },
  { value: 'material', label: 'Material' },
  { value: 'variedad', label: 'Variedad' },
  { value: 'cerrado',  label: 'Cerrado' },
];

function getSortVal(r, field) {
  switch (field) {
    case 'fecha':    return r.fecha || '';
    case 'lote':     return (r.loteNombre || '').toLowerCase();
    case 'bloque':   return (r.bloque || '').toLowerCase();
    case 'plantas':  return r.plantas || 0;
    case 'area':     return r.areaCalculada || 0;
    case 'material': return (r.materialNombre || '').toLowerCase();
    case 'variedad': return (r.variedad || '').toLowerCase();
    case 'cerrado':  return r.cerrado ? 1 : 0;
    default:         return '';
  }
}

function applySort(data, sortConfig) {
  const active = sortConfig.filter(s => s.field);
  if (!active.length) return [...data];
  return [...data].sort((a, b) => {
    for (const { field, dir } of active) {
      const av = getSortVal(a, field);
      const bv = getSortVal(b, field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

const EMPTY_FILTERS = {
  fechaDesde: '', fechaHasta: '',
  lote: '', bloque: '', material: '', variedad: '',
  cerrado: 'todos',
};

function applyFilters(data, f) {
  return data.filter(r => {
    if (f.fechaDesde && r.fecha < f.fechaDesde) return false;
    if (f.fechaHasta && r.fecha > f.fechaHasta) return false;
    if (f.lote     && !r.loteNombre?.toLowerCase().includes(f.lote.toLowerCase()))     return false;
    if (f.bloque   && !r.bloque?.toLowerCase().includes(f.bloque.toLowerCase()))       return false;
    if (f.material && !r.materialNombre?.toLowerCase().includes(f.material.toLowerCase())) return false;
    if (f.variedad && !r.variedad?.toLowerCase().includes(f.variedad.toLowerCase()))   return false;
    if (f.cerrado === 'cerrado' && !r.cerrado)  return false;
    if (f.cerrado === 'abierto' &&  r.cerrado)  return false;
    return true;
  });
}

const formatFecha = (iso) =>
  new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });

function SiembraHistorial() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [registros, setRegistros] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters,   setFilters]   = useState(EMPTY_FILTERS);
  const [sortConfig, setSortConfig] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc'  },
  ]);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const updateSort   = (idx, key, value) =>
    setSortConfig(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([k, v]) => k === 'cerrado' ? v !== 'todos' : v !== '').length,
  [filters]);

  useEffect(() => {
    apiFetch('/api/siembras')
      .then(r => r.json())
      .then(data => setRegistros(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar registros.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const displayData = useMemo(
    () => applySort(applyFilters(registros, filters), sortConfig),
    [registros, filters, sortConfig],
  );

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalPlantas = displayData.reduce((s, r) => s + (r.plantas || 0), 0);
    const totalArea    = displayData.reduce((s, r) => s + (r.areaCalculada || 0), 0);
    const cerrados     = displayData.filter(r => r.cerrado).length;
    return { totalPlantas, totalArea: totalArea.toFixed(4), cerrados };
  }, [displayData]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const toggleCerrado = async (reg) => {
    const esSupervisor = hasMinRole(currentUser?.rol, 'supervisor');
    if (reg.cerrado && !esSupervisor) {
      showToast('Solo un supervisor puede reabrir un bloque cerrado.', 'error');
      return;
    }
    const msg = reg.cerrado
      ? `¿Reabrir el bloque "${reg.bloque || '(sin bloque)'}" del lote "${reg.loteNombre}"?`
      : `¿Marcar el bloque "${reg.bloque || '(sin bloque)'}" del lote "${reg.loteNombre}" como cerrado?\n\nSolo un supervisor puede revertir esta acción.`;
    if (!window.confirm(msg)) return;
    try {
      await apiFetch(`/api/siembras/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cerrado: !reg.cerrado }),
      });
      setRegistros(prev => prev.map(r => r.id === reg.id ? { ...r, cerrado: !r.cerrado } : r));
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    try {
      await apiFetch(`/api/siembras/${id}`, { method: 'DELETE' });
      setRegistros(prev => prev.filter(r => r.id !== id));
      showToast('Registro eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // ── Export CSV ───────────────────────────────────────────────────────────
  const exportXLSX = () => {
    const headers = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'Responsable'];
    const rows = displayData.map(r => [
      r.fecha, r.loteNombre || '', r.bloque || '',
      r.plantas, r.densidad,
      r.areaCalculada || '',
      r.materialNombre || '', r.variedad || '',
      r.cerrado ? 'Sí' : 'No',
      r.responsableNombre || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Ajustar ancho de columnas automáticamente
    ws['!cols'] = headers.map((h, i) => ({
      wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)) + 2,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Siembras');
    XLSX.writeFile(wb, `siembras_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportCSV = () => {
    const headers = ['Fecha', 'Lote', 'Bloque', 'Plantas', 'Densidad', 'Área (ha)', 'Material', 'Variedad', 'Cerrado', 'Responsable'];
    const rows = displayData.map(r => [
      r.fecha, r.loteNombre || '', r.bloque || '',
      r.plantas, r.densidad,
      r.areaCalculada || '',
      r.materialNombre || '', r.variedad || '',
      r.cerrado ? 'Sí' : 'No',
      r.responsableNombre || '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `siembras_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  return (
    <div className="sh-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="sh-toolbar">
        <Link to="/siembra" className="sh-back-link">
          <FiChevronLeft size={15} /> Registro de Siembra
        </Link>

        <div className="sh-toolbar-actions">
          <button
            className={`btn btn-secondary sh-filter-btn${activeFilterCount ? ' sh-filter-active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
          >
            <FiFilter size={14} />
            Filtros
            {activeFilterCount > 0 && <span className="sh-filter-badge">{activeFilterCount}</span>}
          </button>
          <button className="btn btn-secondary" onClick={exportXLSX} title="Exportar a Excel">
            <FiDownload size={14} /> Exportar Excel
          </button>
          <button className="btn btn-secondary" onClick={exportCSV} title="Exportar a CSV">
            <FiDownload size={14} /> Exportar CSV
          </button>
          <button className="btn btn-secondary print-hide" onClick={handlePrint} title="Imprimir">
            <FiPrinter size={14} /> Imprimir
          </button>
        </div>
      </div>

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="sh-filter-panel">
          <div className="sh-filter-grid">
            <div className="form-control">
              <label>Fecha desde</label>
              <input type="date" value={filters.fechaDesde} onChange={e => updateFilter('fechaDesde', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Fecha hasta</label>
              <input type="date" value={filters.fechaHasta} onChange={e => updateFilter('fechaHasta', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Lote</label>
              <input placeholder="Ej: L2610" value={filters.lote} onChange={e => updateFilter('lote', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Bloque</label>
              <input placeholder="Ej: 2A" value={filters.bloque} onChange={e => updateFilter('bloque', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Material</label>
              <input placeholder="Ej: CP" value={filters.material} onChange={e => updateFilter('material', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Variedad</label>
              <input placeholder="Ej: MD2" value={filters.variedad} onChange={e => updateFilter('variedad', e.target.value)} />
            </div>
            <div className="form-control">
              <label>Estado</label>
              <select value={filters.cerrado} onChange={e => updateFilter('cerrado', e.target.value)}>
                <option value="todos">Todos</option>
                <option value="abierto">Abiertos</option>
                <option value="cerrado">Cerrados</option>
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button className="sh-clear-filters" onClick={clearFilters}>
              <FiX size={13} /> Limpiar filtros
            </button>
          )}
        </div>
      )}

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="sh-stats-bar">
        <div className="sh-stat">
          <span className="sh-stat-value">{displayData.length}</span>
          <span className="sh-stat-label">Registros</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{stats.totalPlantas.toLocaleString()}</span>
          <span className="sh-stat-label">Plantas totales</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value">{stats.totalArea} ha</span>
          <span className="sh-stat-label">Área calculada</span>
        </div>
        <div className="sh-stat-divider" />
        <div className="sh-stat">
          <span className="sh-stat-value sh-stat-green">{stats.cerrados}</span>
          <span className="sh-stat-label">Bloques cerrados</span>
        </div>
      </div>

      {/* ── Sort controls ──────────────────────────────────────────────────── */}
      <div className="siembra-historial sh-table-card">
        <div className="historial-top-row">
          <span className="sh-result-count print-hide">
            {displayData.length === registros.length
              ? `${registros.length} registros`
              : `${displayData.length} de ${registros.length} registros`}
          </span>
          <div className="historial-sort-row print-hide">
            {sortConfig.map((s, idx) => (
              <div key={idx} className="sort-group">
                <span className="sort-label">{idx === 0 ? 'Ordenar por' : 'Luego por'}</span>
                <select
                  className="sort-select"
                  value={s.field}
                  onChange={e => updateSort(idx, 'field', e.target.value)}
                >
                  <option value="">—</option>
                  {SORT_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <button
                  className={`sort-dir-btn${!s.field ? ' sort-dir-disabled' : ''}`}
                  disabled={!s.field}
                  onClick={() => updateSort(idx, 'dir', s.dir === 'asc' ? 'desc' : 'asc')}
                  title={s.dir === 'asc' ? 'Ascendente' : 'Descendente'}
                >
                  {s.dir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="empty-state">Cargando…</p>
        ) : displayData.length === 0 ? (
          <p className="empty-state">No hay registros con los filtros aplicados.</p>
        ) : (
          <div className="siembra-table-wrapper">
            <table className="siembra-table siembra-table-historial">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Lote</th>
                  <th>Bloque</th>
                  <th>Plantas</th>
                  <th>Densidad</th>
                  <th>Área</th>
                  <th>Material</th>
                  <th>Variedad</th>
                  <th>Responsable</th>
                  <th className="th-center">Cerrado</th>
                  <th className="print-hide"></th>
                </tr>
              </thead>
              <tbody>
                {displayData.map(r => (
                  <tr key={r.id} className={r.cerrado ? 'row-cerrado' : ''}>
                    <td className="td-readonly">{formatFecha(r.fecha)}</td>
                    <td>{r.loteNombre}</td>
                    <td>{r.bloque || '—'}</td>
                    <td className="td-num">{r.plantas?.toLocaleString()}</td>
                    <td className="td-num">{r.densidad?.toLocaleString()}</td>
                    <td className="td-calc">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>
                    <td>{r.materialNombre || '—'}</td>
                    <td>{r.variedad || '—'}</td>
                    <td className="td-readonly">{r.responsableNombre || '—'}</td>
                    <td className="td-center">
                      <button
                        className={`siembra-cerrado-btn${r.cerrado ? ' is-cerrado' : ''}`}
                        onClick={() => toggleCerrado(r)}
                        title={r.cerrado ? 'Marcar como abierto' : 'Marcar como cerrado'}
                      >
                        {r.cerrado ? <FiCheckCircle size={18} /> : <FiCircle size={18} />}
                      </button>
                    </td>
                    <td className="print-hide">
                      <button className="btn-icon btn-danger" onClick={() => handleDelete(r.id)}>
                        <FiTrash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {displayData.some(r => r.cerrado) && (
          <p className="siembra-cerrado-hint print-hide">
            <FiAlertCircle size={13} />
            Los bloques cerrados están listos para iniciar aplicaciones.
          </p>
        )}
      </div>
    </div>
  );
}

export default SiembraHistorial;
