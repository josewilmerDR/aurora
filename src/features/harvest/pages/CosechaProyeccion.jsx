import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiAlertTriangle, FiTrendingUp, FiLayers } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraDataTable from '../../../components/AuroraDataTable';
import Toast from '../../../components/Toast';
import EmptyState from '../../../components/ui/EmptyState';
import { calcFechaCosecha } from '../../fields/lib/grupo-bloques-helpers';
import { DEFAULTS as PARAM_DEFAULTS } from '../../admin/lib/parameters';
import { toLocalISODate } from '../lib/dates';
import { fmt, num } from '../lib/format';
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

// Sentinel para mandar las filas sin fecha al final del sort ascendente, en vez
// de amontonarlas arriba mezcladas con fechas reales. Punto #19 audit.
const SORT_FECHA_NULA = '9999-12-31';

// ── Helpers ──────────────────────────────────────────────────────────────────
// Clasifica el tipo de cosecha en 'I' | 'II' con la MISMA regla que usa
// calcFechaCosecha (fields/lib) para la fecha: II si el texto menciona "ii" o
// "2", I en cualquier otro caso. Así fecha y rendimiento nunca se contradicen
// (#11). III no se modela aparte — producto lo dejó fuera hasta tener el modelo
// multi-cosecha calibrado (#12); "III cosecha" cae en II, igual que en el
// cálculo de fecha del lib ('iii' contiene 'ii').
function clasificarCosecha(grupo) {
  const c = (grupo.cosecha || '').toLowerCase();
  return (c.includes('ii') || c.includes('2')) ? 'II' : 'I';
}

// ¿El texto de cosecha declara un tipo reconocible? Si no, igual proyectamos
// (como I) pero marcamos la fila para no descartarla en silencio. Punto #10.
function cosechaReconocida(grupo) {
  const c = (grupo.cosecha || '').toLowerCase();
  return /cosecha|\b(i{1,3}|[123])\b/.test(c);
}

function getColVal(row, key) {
  if (key === 'fechaCosecha') {
    const d = row.fechaCosecha;
    if (!(d instanceof Date) || isNaN(d)) return SORT_FECHA_NULA;
    // Local, no UTC: el sort/filter se alinea con lo que muestra fmt(), que
    // también es local. Sin esto, en GMT-6 una fila se corría un día. Punto #7.
    return toLocalISODate(d);
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
  const [error,    setError]    = useState(false);
  const [toast,    setToast]    = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Guard contra setState tras unmount (los fetch no se cancelaban). Punto #26.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── Carga inicial (reutilizable para reintentar) ────────────────────────────
  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ])
      .then(([grp, sie, cfg]) => {
        if (!mountedRef.current) return;
        setGrupos(Array.isArray(grp) ? grp : []);
        setSiembras(Array.isArray(sie) ? sie : []);
        setConfig(cfg && typeof cfg === 'object' ? cfg : {});
      })
      .catch(() => {
        // Error de red explícito: sin esto, un fetch fallido se disfrazaba de
        // "Sin grupos" y mandaba al usuario a crear grupos que ya existen. #5.
        if (mountedRef.current) { setError(true); showToast('Error al cargar la proyección.', 'error'); }
      })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // El backend devuelve {id, fincaId, ...} si la finca tiene config; {} si no
  // (o si el fetch reventó). Sin config, las fechas y Kg caen a defaults
  // genéricos: lo avisamos en vez de presentarlos como autoritativos. Punto #2.
  const configLoaded = !!config?.id;

  // ── Generación automática de filas ─────────────────────────────────────────
  // Una fila por bloque (siembra) que pertenezca a un grupo.
  const rows = useMemo(() => {
    const siembraMap = new Map(siembras.map(s => [s.id, s]));
    const result = [];

    for (const grupo of grupos) {
      // Dedup: un grupo podría listar el mismo bloque dos veces → dos filas con
      // la misma key y warning de React. Punto #28.
      const bloqueIds = [...new Set(Array.isArray(grupo.bloques) ? grupo.bloques : [])];
      if (bloqueIds.length === 0) continue;

      const fechaCosecha = calcFechaCosecha(grupo, config);
      const tipo         = clasificarCosecha(grupo);
      const reconocida   = cosechaReconocida(grupo);

      // Parámetros de rendimiento por tipo, con default canónico de
      // admin/lib/parameters (única fuente, no más copias hardcoded). Punto #3.
      let mortalidad, kgXPlanta, rechazo;
      if (tipo === 'II') {
        mortalidad = (config.mortalidadIICosecha ?? PARAM_DEFAULTS.mortalidadIICosecha) / 100;
        kgXPlanta  = config.kgPorPlantaII       ?? PARAM_DEFAULTS.kgPorPlantaII;
        rechazo    = (config.rechazoIICosecha   ?? PARAM_DEFAULTS.rechazoIICosecha) / 100;
      } else {
        mortalidad = (config.mortalidadICosecha ?? PARAM_DEFAULTS.mortalidadICosecha) / 100;
        kgXPlanta  = config.kgPorPlanta         ?? PARAM_DEFAULTS.kgPorPlanta;
        rechazo    = (config.rechazoICosecha    ?? PARAM_DEFAULTS.rechazoICosecha) / 100;
      }
      const kgPorCaja = config.kgPorCaja ?? PARAM_DEFAULTS.kgPorCaja;

      // Tooltip con los parámetros aplicados: el usuario decide cuántas cajas /
      // cuadrilla sobre números derivados que de otro modo no puede auditar. #8.
      const calcHint =
        `Cosecha ${tipo} · mortalidad ${mortalidad * 100}% · rechazo ${rechazo * 100}% · ${kgXPlanta} kg/planta`;

      for (const bloqueId of bloqueIds) {
        const siembra = siembraMap.get(bloqueId);
        if (!siembra) continue;

        const plantas          = siembra.plantas || 0;
        const totalKgEsperados = plantas * (1 - mortalidad) * kgXPlanta;
        const kgPrimera        = totalKgEsperados * (1 - rechazo);

        result.push({
          _id:          `${grupo.id}-${bloqueId}`,
          fechaCosecha,
          loteNombre:   siembra.loteNombre || '—',
          grupoNombre:  grupo.nombreGrupo  || '—',
          bloque:       siembra.bloque     || '—',
          cosecha:      grupo.cosecha      || '—',
          cosechaReconocida: reconocida,
          etapa:        grupo.etapa        || '—',
          plantas,
          totalKgEsperados,
          kgPrimera,
          kgSegunda:    totalKgEsperados - kgPrimera,
          cajas:        kgPorCaja > 0 ? kgPrimera / kgPorCaja : null,
          _calcHint:    calcHint,
        });
      }
    }

    return result;
  }, [grupos, siembras, config]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderRow = (row, visibleCols) => (
    <>
      {visibleCols.fechaCosecha     && <td>{fmt(row.fechaCosecha)}</td>}
      {visibleCols.loteNombre       && <td>{row.loteNombre}</td>}
      {visibleCols.grupoNombre      && <td>{row.grupoNombre}</td>}
      {visibleCols.bloque           && <td>{row.bloque}</td>}
      {visibleCols.cosecha          && (
        <td>
          {row.cosecha}
          {!row.cosechaReconocida && (
            <span
              className="harvest-cosecha-flag"
              title="Tipo de cosecha no reconocido — se proyecta como I Cosecha. Usá un rótulo con I / II / 'cosecha'."
            >
              {' '}<FiAlertTriangle size={11} aria-label="tipo de cosecha no reconocido" />
            </span>
          )}
        </td>
      )}
      {visibleCols.etapa            && <td>{row.etapa}</td>}
      {visibleCols.plantas          && <td className="aur-td-num">{num(row.plantas)}</td>}
      {visibleCols.totalKgEsperados && <td className="aur-td-num" title={row._calcHint}>{num(row.totalKgEsperados, 0)}</td>}
      {visibleCols.kgPrimera        && <td className="aur-td-num" title={row._calcHint}>{num(row.kgPrimera, 0)}</td>}
      {visibleCols.kgSegunda        && <td className="aur-td-num" title={row._calcHint}>{num(row.kgSegunda, 0)}</td>}
      {visibleCols.cajas            && (
        <td className="aur-td-num">
          {row.cajas == null
            ? <span className="harvest-td-empty" title="Configurá Kg/Caja mayor a 0 para estimar cajas">—</span>
            : <span title={row._calcHint}>{num(row.cajas, 1)}</span>}
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
            <h1 className="aur-sheet-title">Proyección de cosecha</h1>
            <p className="aur-sheet-subtitle">
              Estimación automática a partir de grupos, siembras y los parámetros de cultivo
              (ajustables en <Link to="/config/cuenta">Ajustes de cuenta</Link>).
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            <Link to="/grupos" className="aur-btn-pill aur-btn-pill--sm">
              <FiLayers size={14} /> Gestionar grupos
            </Link>
          </div>
        </header>

        {!loading && !error && !configLoaded && (
          <div className="aur-banner aur-banner--warn">
            <FiAlertTriangle size={15} />
            <span>
              Configuración de cultivo no cargada — las fechas y cantidades usan valores por
              defecto (150/215/250 días, mortalidad y rechazo genéricos), no calibrados para tu
              finca. <Link to="/config/cuenta">Ajustá los parámetros</Link> para una proyección real.
            </span>
          </div>
        )}

        {loading ? (
          <div className="empty-state" role="status">
            <p className="item-main-text">Cargando proyecciones…</p>
          </div>
        ) : error ? (
          <div className="aur-banner aur-banner--danger">
            <FiAlertTriangle size={15} />
            <span>
              No se pudo cargar la proyección. <button type="button" className="aur-btn-text" onClick={load}>Reintentar</button>
            </span>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FiTrendingUp}
            title="Sin grupos con bloques registrados"
            subtitle="Las proyecciones se generan automáticamente desde el módulo Grupos."
            action={<Link to="/grupos" className="aur-btn-pill aur-btn-pill--sm">Ir a Grupos</Link>}
          />
        ) : (
          <AuroraDataTable
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
          />
        )}
      </div>
    </div>
  );
}
