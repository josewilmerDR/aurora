import { useState, useEffect, useMemo } from 'react';
import { useApiFetch } from '../../../hooks/useApiFetch';
import HarvestDataTable from '../components/HarvestDataTable';
import '../styles/harvest.css';

const PAGE_SIZE = 50;

// ── Column definitions ───────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'fechaCosecha',     label: 'F. Programada',      type: 'date'   },
  { key: 'loteNombre',       label: 'Lote',               type: 'text'   },
  { key: 'grupoNombre',      label: 'Grupo',              type: 'text'   },
  { key: 'bloque',           label: 'Bloque',             type: 'text'   },
  { key: 'cosecha',          label: 'Cosecha',            type: 'text'   },
  { key: 'etapa',            label: 'Etapa',              type: 'text'   },
  { key: 'plantas',          label: 'Plantas',            type: 'number', align: 'right' },
  { key: 'totalKgEsperados', label: 'Total Kg Esperados', type: 'number', align: 'right' },
  { key: 'kgPrimera',        label: 'Kg Primera',         type: 'number', align: 'right' },
  { key: 'kgSegunda',        label: 'Kg Segunda',         type: 'number', align: 'right' },
  { key: 'cajas',            label: 'Cajas',              type: 'number', align: 'right' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
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
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v, dec = 0) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return dec > 0 ? n.toFixed(dec) : n.toLocaleString('es-ES');
};

function getColVal(row, key) {
  if (key === 'fechaCosecha') {
    const d = row.fechaCosecha;
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toISOString().slice(0, 10);
  }
  const v = row[key];
  if (v == null) return COLUMNS.find(c => c.key === key)?.type === 'number' ? 0 : '';
  return typeof v === 'number' ? v : String(v).toLowerCase();
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CosechaProyeccion() {
  const apiFetch = useApiFetch();

  const [grupos,   setGrupos]   = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [config,   setConfig]   = useState({});
  const [loading,  setLoading]  = useState(true);

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generación automática de filas ─────────────────────────────────────────
  // Una fila por bloque (siembra) que pertenezca a un grupo.
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

        const plantas = siembra.plantas || 0;

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
          fechaCosecha,
          loteNombre:   siembra.loteNombre || '—',
          grupoNombre:  grupo.nombreGrupo  || '—',
          bloque:       siembra.bloque     || '—',
          cosecha:      grupo.cosecha      || '—',
          etapa:        grupo.etapa        || '—',
          plantas,
          totalKgEsperados,
          kgPrimera,
          kgSegunda:    totalKgEsperados - kgPrimera,
          cajas:        (config.kgPorCaja ?? 12) > 0 ? kgPrimera / (config.kgPorCaja ?? 12) : null,
          // Cost/Kg: sin fuente de datos por ahora
        });
      }
    }

    return result;
  }, [grupos, siembras, config]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="harvest-page-loading" />;
  }

  const renderRow = (row, visibleCols) => (
    <>
      {visibleCols.fechaCosecha     && <td>{fmt(row.fechaCosecha)}</td>}
      {visibleCols.loteNombre       && <td>{row.loteNombre}</td>}
      {visibleCols.grupoNombre      && <td>{row.grupoNombre}</td>}
      {visibleCols.bloque           && <td>{row.bloque}</td>}
      {visibleCols.cosecha          && <td>{row.cosecha}</td>}
      {visibleCols.etapa            && <td>{row.etapa}</td>}
      {visibleCols.plantas          && <td className="aur-td-num">{num(row.plantas)}</td>}
      {visibleCols.totalKgEsperados && <td className="aur-td-num">{num(row.totalKgEsperados, 0)}</td>}
      {visibleCols.kgPrimera        && <td className="aur-td-num">{num(row.kgPrimera, 0)}</td>}
      {visibleCols.kgSegunda        && <td className="aur-td-num">{num(row.kgSegunda, 0)}</td>}
      {visibleCols.cajas            && <td className="aur-td-num">{num(row.cajas, 0)}</td>}
    </>
  );

  return (
    <div className="harvest-page">
      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Proyección de cosecha</h1>
            <p className="aur-sheet-subtitle">
              Estimación automática a partir de grupos, siembras y parámetros de configuración.
            </p>
          </div>
        </header>

        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="item-main-text">Sin grupos con bloques registrados</p>
            <p>Las proyecciones se generan automáticamente desde el módulo Grupos.</p>
          </div>
        ) : (
          <HarvestDataTable
            columns={COLUMNS}
            data={rows}
            getColVal={getColVal}
            initialSort={{ field: 'fechaCosecha', dir: 'asc' }}
            firstClickDir="asc"
            pageSize={PAGE_SIZE}
            resultLabel={(filtered, total) =>
              filtered === total
                ? `${total} proyecciones`
                : `${filtered} de ${total} proyecciones`
            }
            renderRow={renderRow}
            trailingHead={<th className="harvest-th-na">Cost/Kg</th>}
            trailingCell={() => <td className="harvest-td-na">—</td>}
          />
        )}
      </div>
    </div>
  );
}
