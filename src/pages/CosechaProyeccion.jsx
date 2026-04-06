import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiFilter, FiX } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './CosechaProyeccion.css';

const PAGE_SIZE = 50;

// ── Helpers (idénticos a GrupoManagement) ────────────────────────────────────
const tsToDate = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return new Date(ts._seconds * 1000);
  return new Date(ts);
};

const calcFechaCosecha = (grupo, config = {}) => {
  const etapa   = (grupo.etapa   || '').toLowerCase();
  const cosecha = (grupo.cosecha || '').toLowerCase();
  let dias;
  if (etapa.includes('postforza') || etapa.includes('post forza')) {
    dias = config.diasPostForza ?? 150;
  } else if (cosecha.includes('ii') || cosecha.includes('2')) {
    dias = config.diasIIDesarrollo ?? 215;
  } else {
    dias = config.diasIDesarrollo ?? 250;
  }
  const base = tsToDate(grupo.fechaCreacion);
  if (!base) return null;
  const result = new Date(base);
  result.setDate(result.getDate() + dias);
  return result;
};

const fmt = (date) => {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v, dec = 0) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return dec > 0 ? n.toFixed(dec) : n.toLocaleString('es-ES');
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CosechaProyeccion() {
  const apiFetch = useApiFetch();

  const [grupos,   setGrupos]   = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [config,   setConfig]   = useState({});
  const [loading,  setLoading]  = useState(true);

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo,   setFilterTo]   = useState('');

  const [sorts, setSorts] = useState([{ field: 'fechaCosecha', dir: 'asc' }]);
  const [page,  setPage]  = useState(1);

  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null);

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ])
      .then(([grp, sie, cfg]) => {
        setGrupos(Array.isArray(grp) ? grp : []);
        setSiembras(Array.isArray(sie) ? sie : []);
        setConfig(cfg && typeof cfg === 'object' ? cfg : {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Generación de filas automáticas ───────────────────────────────────────
  // Una fila por cada bloque (siembra) que pertenece a un grupo.
  const rows = useMemo(() => {
    const siembraMap = new Map(siembras.map(s => [s.id, s]));
    const result = [];

    for (const grupo of grupos) {
      const bloqueIds = Array.isArray(grupo.bloques) ? grupo.bloques : [];
      if (bloqueIds.length === 0) continue;

      const fechaCosecha = calcFechaCosecha(grupo, config);

      for (const bloqueId of bloqueIds) {
        const siembra = siembraMap.get(bloqueId);
        if (!siembra) continue;

        const cosechaLower = (grupo.cosecha || '').toLowerCase();
        const esIIICosecha = cosechaLower.includes('iii cosecha');
        const esIICosecha  = !esIIICosecha && cosechaLower.includes('ii cosecha');
        const esICosecha   = !esIIICosecha && !esIICosecha && cosechaLower.includes('i cosecha');
        if (!esICosecha && !esIICosecha && !esIIICosecha) continue;

        const plantas  = siembra.plantas || 0;

        let mortalidad, kgXPlanta, rechazo;
        if (esIIICosecha) {
          mortalidad = (config.mortalidadIIICosecha ?? 20) / 100;
          kgXPlanta  = config.kgPorPlantaIII ?? 1.5;
          rechazo    = (config.rechazoIIICosecha ?? 20) / 100;
        } else if (esIICosecha) {
          mortalidad = (config.mortalidadIICosecha ?? 10) / 100;
          kgXPlanta  = config.kgPorPlantaII ?? 1.6;
          rechazo    = (config.rechazoIICosecha ?? 20) / 100;
        } else {
          mortalidad = (config.mortalidadICosecha ?? 2) / 100;
          kgXPlanta  = config.kgPorPlanta ?? 1.8;
          rechazo    = (config.rechazoICosecha ?? 10) / 100;
        }
        const totalKgEsperados = plantas * (1 - mortalidad) * kgXPlanta;
        const kgPrimera        = totalKgEsperados * (1 - rechazo);

        result.push({
          _id:          `${grupo.id}-${bloqueId}`,
          fechaCosecha,                              // F. Programada
          loteNombre:   siembra.loteNombre || '—',  // Lote
          grupoNombre:  grupo.nombreGrupo  || '—',  // Grupo
          bloque:       siembra.bloque     || '—',  // Bloque
          cosecha:      grupo.cosecha      || '—',  // Cosecha
          etapa:        grupo.etapa        || '—',  // Etapa
          plantas,                                  // Plantas
          totalKgEsperados,                         // Plantas × (1-Mortalidad) × Kg/planta
          kgPrimera,                                // totalKgEsperados × (1-Rechazo)
          kgSegunda:        totalKgEsperados - kgPrimera, // totalKgEsperados × Rechazo
          cajas:            (config.kgPorCaja ?? 12) > 0 ? kgPrimera / (config.kgPorCaja ?? 12) : null,
          // Cost/Kg: sin fuente de datos aún
        });
      }
    }

    return result;
  }, [grupos, siembras, config]);

  // ── Filtros de fecha ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const activeCols = Object.entries(colFilters).filter(([, v]) => v.trim());
    return rows.filter(row => {
      if (filterFrom || filterTo) {
        if (!row.fechaCosecha) return false;
        const d = row.fechaCosecha;
        if (filterFrom && d < new Date(filterFrom + 'T00:00:00')) return false;
        if (filterTo   && d > new Date(filterTo   + 'T23:59:59')) return false;
      }
      for (const [field, val] of activeCols) {
        const cell = row[field];
        if (cell == null) return false;
        if (!String(cell).toLowerCase().includes(val.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filterFrom, filterTo, colFilters]);

  // ── Ordenamiento ───────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const active = sorts.filter(s => s.field);
    if (!active.length) return filtered;
    return [...filtered].sort((a, b) => {
      for (const { field, dir } of active) {
        let va = a[field];
        let vb = b[field];
        let cmp;
        if (va instanceof Date && vb instanceof Date) {
          cmp = va - vb;
        } else if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          va = String(va ?? '');
          vb = String(vb ?? '');
          cmp = va.localeCompare(vb, 'es');
        }
        if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }, [filtered, sorts]);

  const visible = useMemo(() => sorted.slice(0, page * PAGE_SIZE), [sorted, page]);
  const hasMore = visible.length < sorted.length;

  // ── Sort / filter helpers ──────────────────────────────────────────────────
  const handleThSort = (field) => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
    setPage(1);
  };

  const openFilter = (e, field) => {
    e.stopPropagation();
    e.preventDefault();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th   = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, x: rect.left, y: rect.bottom + 4 });
  };

  const setColFilter = (field, val) => {
    setColFilters(prev => val
      ? { ...prev, [field]: val }
      : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field)));
    setPage(1);
  };

  // ── SortTh ─────────────────────────────────────────────────────────────────
  const SortTh = ({ field, children, className, align }) => {
    const active    = sorts[0].field === field;
    const dir       = active ? sorts[0].dir : null;
    const hasFilter = !!(colFilters[field]?.trim());
    return (
      <th
        className={`historial-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}${className ? ' ' + className : ''}`}
        style={align === 'right' ? { textAlign: 'right' } : undefined}
        onClick={() => handleThSort(field)}
        onContextMenu={e => openFilter(e, field)}
      >
        {children}
        <span className="historial-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span className={`historial-th-funnel${hasFilter ? ' is-active' : ''}`} onClick={e => openFilter(e, field)} title="Filtrar columna">
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <div className="empty-state">Cargando proyecciones…</div>;

  return (
    <>
      <div className="historial-wrap">

        {/* ── Controles de fecha ── */}
        <div className="historial-controls">
          <div className="historial-control-block">
            <div className="historial-control-row">
              <label className="historial-ctrl-label">F. Programada de</label>
              <input type="date" className="historial-date-input" value={filterFrom}
                onChange={e => { setFilterFrom(e.target.value); setPage(1); }} />
              <label className="historial-ctrl-label">a</label>
              <input type="date" className="historial-date-input" value={filterTo}
                onChange={e => { setFilterTo(e.target.value); setPage(1); }} />
              {(filterFrom || filterTo) && (
                <button className="btn btn-secondary historial-clear-btn"
                  onClick={() => { setFilterFrom(''); setFilterTo(''); setPage(1); }}>
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Contador ── */}
        <div className="historial-count">
          {sorted.length === 0
            ? 'Sin proyecciones para los filtros aplicados.'
            : `${visible.length} de ${sorted.length} fila${sorted.length !== 1 ? 's' : ''}`}
          {Object.values(colFilters).some(v => v.trim()) && (
            <button className="historial-clear-col-filters" onClick={() => { setColFilters({}); setPage(1); }}>
              <FiX size={11} /> Limpiar filtros de columna
            </button>
          )}
        </div>

        {/* ── Tabla ── */}
        {sorted.length > 0 ? (
          <>
            <div className="historial-table-wrap">
              <table className="historial-table proyeccion-table">
                <thead>
                  <tr>
                    <SortTh field="fechaCosecha">F. Programada</SortTh>
                    <SortTh field="loteNombre">Lote</SortTh>
                    <SortTh field="grupoNombre">Grupo</SortTh>
                    <SortTh field="bloque">Bloque</SortTh>
                    <SortTh field="cosecha">Cosecha</SortTh>
                    <SortTh field="etapa">Etapa</SortTh>
                    <SortTh field="plantas" align="right">Plantas</SortTh>
                    <SortTh field="totalKgEsperados" align="right">Total Kg Esperados</SortTh>
                    <SortTh field="kgPrimera" align="right">Kg Primera</SortTh>
                    <SortTh field="kgSegunda" align="right">Kg Segunda</SortTh>
                    <SortTh field="cajas" align="right">Cajas</SortTh>
                    <th className="proyeccion-th-na">Cost/Kg</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <tr key={row._id}>
                      <td className="historial-td-nowrap">{fmt(row.fechaCosecha)}</td>
                      <td className="historial-td-nowrap">{row.loteNombre}</td>
                      <td className="historial-td-nowrap">{row.grupoNombre}</td>
                      <td>{row.bloque}</td>
                      <td className="historial-td-nowrap">{row.cosecha}</td>
                      <td>{row.etapa}</td>
                      <td className="proyeccion-td-num">{num(row.plantas)}</td>
                      <td className="proyeccion-td-num">{num(row.totalKgEsperados, 0)}</td>
                      <td className="proyeccion-td-num">{num(row.kgPrimera, 0)}</td>
                      <td className="proyeccion-td-num">{num(row.kgSegunda, 0)}</td>
                      <td className="proyeccion-td-num">{num(row.cajas, 0)}</td>
                      <td className="proyeccion-td-na">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="historial-load-more">
                <button className="btn btn-secondary" onClick={() => setPage(p => p + 1)}>
                  Ver más — {sorted.length - visible.length} restante{sorted.length - visible.length !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <p className="item-main-text">Sin grupos con bloques registrados</p>
            <p>Las proyecciones se generan automáticamente desde el módulo Grupos.</p>
          </div>
        )}

      </div>

      {/* ── Popover filtro de columna ── */}
      {filterPopover && createPortal(
        <>
          <div className="historial-filter-backdrop" onClick={() => setFilterPopover(null)} />
          <div className="historial-filter-popover" style={{ left: filterPopover.x, top: filterPopover.y }}>
            <FiFilter size={13} className="historial-filter-popover-icon" />
            <input
              autoFocus
              className="historial-filter-input"
              placeholder="Filtrar…"
              value={colFilters[filterPopover.field] || ''}
              onChange={e => setColFilter(filterPopover.field, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
            />
            {colFilters[filterPopover.field] && (
              <button className="historial-filter-clear" onClick={() => { setColFilter(filterPopover.field, ''); setFilterPopover(null); }}>
                <FiX size={13} />
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
