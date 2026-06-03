import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiSearch, FiX, FiArrowUp, FiArrowDown, FiInbox, FiAlertTriangle } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { usePageTitle } from '../../../hooks/usePageTitle';
import { useTableColumnPreset } from '../../../hooks/useTableColumnPreset';
import AuroraDataTable from '../../../components/AuroraDataTable';
import {
  formatDate,
  formatCantidad,
  refDeMovimiento,
  getColsForTab,
  makeGetColVal,
  buildProdMap,
  esEgreso,
  COLS_CONSOLIDADO,
  COLS_INGRESOS,
  COLS_EGRESOS,
} from '../lib/movimientos';
import '../styles/agroquimicos.css';
import '../../planting/styles/siembra-historial.css';

const E = () => <span className="hist-empty">—</span>;

// Backend GET /api/movimientos topea a 500 docs (sin cursor). Si llegan 500
// exactos asumimos truncado: el kardex (opening = stockActual − netTotal) se
// vuelve aproximado porque faltan movimientos viejos. Lo señalizamos en el
// hint en vez de mostrar un saldo silenciosamente errado.
const MOVIMIENTOS_CAP = 500;

// IDs de columnas por tab para el preset persistido. El preset arranca en
// modo 'full' (defaultMode) — el usuario puede ocultar columnas y se recuerda.
const COMPACT_IDS = {
  consolidado: COLS_CONSOLIDADO.map(c => c.key),
  ingresos:    COLS_INGRESOS.map(c => c.key),
  egresos:     COLS_EGRESOS.map(c => c.key),
};

function MovimientosHistorial() {
  usePageTitle('Historial de Movimientos');
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [movimientos, setMovimientos] = useState([]);
  const [productos,   setProductos]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (() => {
    const t = searchParams.get('tab');
    return ['consolidado', 'ingresos', 'egresos'].includes(t) ? t : 'consolidado';
  })();
  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'consolidado') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const [searchProd, setSearchProd] = useState('');
  // Búsqueda diferida: el input responde inmediato pero el filtrado pesado
  // (sobre miles de movimientos) se hace con prioridad baja. Punto #19.
  const deferredSearch = useDeferredValue(searchProd);
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch('/api/movimientos').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
    ])
      .then(([movs, prods]) => {
        setMovimientos(Array.isArray(movs) ? movs : []);
        setProductos(Array.isArray(prods) ? prods : []);
      })
      .catch((e) => {
        console.error(e);
        setError('No se pudo cargar el historial de movimientos.');
      })
      .finally(() => setLoading(false));
  };

  // `apiFetch` es una ref estable (useApiFetch); deps [apiFetch] no re-dispara.
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch]);

  const prodMap = useMemo(() => buildProdMap(productos), [productos]);

  // Enriquecemos cada movimiento con su producto resuelto una sola vez, para
  // que getColVal y los renderers accedan O(1) a `m._prod` sin relookup por
  // celda en cada sort/filter. Punto #13.
  const movimientosEnriched = useMemo(
    () => movimientos.map(m => ({ ...m, _prod: prodMap[m.productoId] })),
    [movimientos, prodMap],
  );

  const getColVal = useMemo(() => makeGetColVal(), []);

  // ── Base filter (search + date range) ─────────────────────────────────────
  const baseFiltered = useMemo(() => {
    return movimientosEnriched.filter(m => {
      if (deferredSearch) {
        const q    = deferredSearch.toLowerCase();
        const prod = m._prod;
        const idOk   = (m.idProducto || prod?.idProducto || '').toLowerCase().includes(q);
        // Fallback al prodMap para el nombre, igual que idOk. Punto #12.
        const nameOk = (m.nombreComercial || prod?.nombreComercial || '').toLowerCase().includes(q);
        if (!idOk && !nameOk) return false;
      }
      if (fechaDesde || fechaHasta) {
        const fechaStr = m.fecha?.slice(0, 10) || '';
        if (!fechaStr) return false;
        if (fechaDesde && fechaStr < fechaDesde) return false;
        if (fechaHasta && fechaStr > fechaHasta) return false;
      }
      return true;
    });
  }, [movimientosEnriched, deferredSearch, fechaDesde, fechaHasta]);

  // Tab-filtered data — lo que entra a AuroraDataTable, que aplica sus
  // col filters + sort internamente. Egresos incluye anulaciones (todo lo que
  // no es ingreso), coherente con el render y el Consolidado. Punto #2.
  const tabData = useMemo(() => {
    if (tab === 'consolidado') return baseFiltered;
    return baseFiltered.filter(m => tab === 'ingresos' ? m.tipo === 'ingreso' : esEgreso(m));
  }, [baseFiltered, tab]);

  const ingresosCount = useMemo(() => movimientos.filter(m => m.tipo === 'ingreso').length, [movimientos]);
  const egresosCount  = useMemo(() => movimientos.filter(m => esEgreso(m)).length,  [movimientos]);

  // ── Saldo (Kardex) ────────────────────────────────────────────────────────
  // El kardex solo se gatilla cuando el usuario reduce explícitamente a un
  // producto vía búsqueda (no por colateral del rango de fecha). Punto #3.
  const uniqueProductoIds = useMemo(
    () => [...new Set(baseFiltered.map(m => m.productoId))],
    [baseFiltered],
  );
  const isSingleProduct = uniqueProductoIds.length === 1;
  const showSaldo = tab === 'consolidado' && isSingleProduct && !!deferredSearch;

  // Saldo aproximado si el backend truncó el ledger a 500: faltarían los
  // movimientos más viejos del producto. Punto #16.
  const saldoTruncado = movimientos.length >= MOVIMIENTOS_CAP;

  const saldoMap = useMemo(() => {
    if (!showSaldo) return {};
    const productoId = uniqueProductoIds[0];
    const producto   = prodMap[productoId];
    const stockActual = parseFloat(producto?.stockActual) || 0;
    const todos = movimientos
      .filter(m => m.productoId === productoId)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    const netTotal = todos.reduce((s, m) => {
      const cant = parseFloat(m.cantidad) || 0;
      return m.tipo === 'ingreso' ? s + cant : s - cant;
    }, 0);
    const opening = stockActual - netTotal;
    const map = {};
    let balance = opening;
    for (const m of todos) {
      const cant = parseFloat(m.cantidad) || 0;
      balance += m.tipo === 'ingreso' ? cant : -cant;
      map[m.id] = balance;
    }
    return map;
  }, [showSaldo, uniqueProductoIds, movimientos, prodMap]);

  // ── Persistencia de columnas por tab ──────────────────────────────────────
  const uid = currentUser?.id || 'anon';
  const baseCols = getColsForTab(tab);
  const colsWithId = useMemo(() => baseCols.map(c => ({ ...c, id: c.key })), [baseCols]);
  const compactIds = COMPACT_IDS[tab];
  const { isVisible, toggleColumn } = useTableColumnPreset(
    colsWithId,
    compactIds,
    `aurora_movimientos_cols_${tab}_${uid}`,
    { defaultMode: 'full' },
  );

  // Si estamos en Consolidado con un solo producto, agregamos la columna
  // "Saldo" al final (no es sortable ni filtrable — es un cálculo derivado).
  const columns = useMemo(() => {
    const base = getColsForTab(tab);
    if (showSaldo) {
      return [
        ...base,
        {
          key: 'saldo',
          label: 'Saldo',
          sortable: false,
          align: 'right',
          title: 'Saldo acumulado, no ordenable',
        },
      ];
    }
    return base;
  }, [tab, showSaldo]);

  // Adaptador hook → Record<key, bool> para AuroraDataTable. La columna 'saldo'
  // (derivada, no parte del preset) siempre visible. Punto #4.
  const visibleCols = useMemo(() => {
    const rec = Object.fromEntries(baseCols.map(c => [c.key, isVisible(c.key)]));
    if (showSaldo) rec.saldo = true;
    return rec;
  }, [baseCols, isVisible, showSaldo]);

  // ── Render rows por tab ───────────────────────────────────────────────────
  const renderRowConsolidado = (m, vc) => {
    const prod       = m._prod;
    const idProducto = m.idProducto || prod?.idProducto || '';
    const cant       = parseFloat(m.cantidad) || 0;
    const isIngreso  = m.tipo === 'ingreso';
    const isAnulacion = m.tipo === 'anulacion_ingreso';
    // Tipo normalizado a un sufijo conocido para la clase del badge
    // (ingreso | egreso | anulacion). Punto #1.
    const tipoCls = isIngreso ? 'ingreso' : isAnulacion ? 'anulacion' : 'egreso';
    const referencia = isIngreso
      ? (m.facturaNumero || m.ocPoNumber || <E />)
      : (refDeMovimiento(m) || <E />);
    const fuenteEgreso = m.loteNombre || m.grupoNombre || '';
    const detalle = isIngreso
      ? (m.proveedor || <E />)
      : (m.motivo ? (fuenteEgreso ? `${m.motivo} · ${fuenteEgreso}` : m.motivo) : <E />);
    const saldo = saldoMap[m.id];

    return (
      <>
        {vc.fecha            && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
        {vc.tipo             && (
          <td>
            <span className={`mhist-tipo-badge mhist-tipo-badge--${tipoCls}`}>
              {isIngreso
                ? <><FiArrowDown size={11} /> Ingreso</>
                : isAnulacion
                  ? <><FiArrowUp size={11} /> Anulación</>
                  : <><FiArrowUp size={11} /> Egreso</>}
            </span>
          </td>
        )}
        {vc.referencia       && <td className="mhist-col-ref">{referencia}</td>}
        {vc.detalle          && <td className="mhist-col-detalle">{detalle}</td>}
        {vc.idProducto       && <td>{idProducto || <E />}</td>}
        {vc.nombreComercial  && <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>}
        {vc.unidad           && <td>{m.unidad || prod?.unidad || <E />}</td>}
        {vc.entrada          && (
          <td className="hist-col-num mhist-col-entrada">
            {isIngreso
              ? <span className="mhist-val-entrada">{formatCantidad(cant)}</span>
              : <E />}
          </td>
        )}
        {vc.salida           && (
          <td className="hist-col-num mhist-col-salida">
            {!isIngreso
              ? <span className="mhist-val-salida">{formatCantidad(cant)}</span>
              : <E />}
          </td>
        )}
        {showSaldo && vc.saldo && (
          <td className="hist-col-num mhist-col-saldo">
            {Number.isFinite(saldo)
              ? <span className={saldo < 0 ? 'mhist-saldo-neg' : 'mhist-saldo-pos'}>
                  {formatCantidad(saldo)}
                </span>
              : <E />}
          </td>
        )}
      </>
    );
  };

  const renderRowIngreso = (m, vc) => {
    const precioUnit = parseFloat(m.precioUnitario) || 0;
    const cant       = parseFloat(m.cantidad)       || 0;
    const iva        = parseFloat(m.iva)            || 0;
    const total      = cant * precioUnit * (1 + iva / 100);
    return (
      <>
        {vc.fecha           && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
        {vc.recepcion       && (
          <td>
            {m.recepcionId
              ? <Link
                  to={`/bodega/agroquimicos/recepciones/${m.recepcionId}`}
                  className="recv-link"
                  title={m.recepcionId}
                >
                  REC-{m.recepcionId.slice(-6).toUpperCase()}
                </Link>
              : <E />}
          </td>
        )}
        {vc.facturaNumero   && <td>{m.facturaNumero || <E />}</td>}
        {vc.proveedor       && <td>{m.proveedor || <E />}</td>}
        {vc.ocPoNumber      && <td>{m.ocPoNumber || <E />}</td>}
        {vc.idProducto      && <td>{m.idProducto || <E />}</td>}
        {vc.nombreComercial && <td className="hist-col-name">{m.nombreComercial || <E />}</td>}
        {vc.unidad          && <td>{m.unidad || <E />}</td>}
        {vc.cantidad        && <td className="hist-col-num">{formatCantidad(cant)}</td>}
        {vc.precioUnitario  && (
          <td className="hist-col-num">
            {precioUnit > 0
              ? precioUnit.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
              : <E />}
          </td>
        )}
        {vc.iva             && <td className="hist-col-num">{iva > 0 ? `${iva}%` : <E />}</td>}
        {vc.total           && (
          <td className="hist-col-num hist-col-total">
            {total > 0
              ? total.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : <E />}
          </td>
        )}
      </>
    );
  };

  const renderRowEgreso = (m, vc) => {
    const prod       = m._prod;
    const idProducto = m.idProducto || prod?.idProducto || '';
    const isGrupo    = !!m.grupoId;
    const loteDisplay  = isGrupo ? '' : (m.loteNombre || '');
    const grupoDisplay = isGrupo
      ? (m.grupoNombre || m.loteNombre || '')
      : (m.grupoNombre || '');
    const consecutivo = refDeMovimiento(m) || '—';
    return (
      <>
        {vc.fecha           && <td className="hist-col-fecha">{formatDate(m.fecha)}</td>}
        {vc.consecutivo     && <td className="mhist-col-consec">{consecutivo}</td>}
        {vc.motivo          && <td>{m.motivo || <E />}</td>}
        {vc.lote            && <td>{loteDisplay || <E />}</td>}
        {vc.grupo           && <td>{grupoDisplay || <E />}</td>}
        {vc.idProducto      && <td>{idProducto || <E />}</td>}
        {vc.nombreComercial && <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>}
        {vc.unidad          && <td>{m.unidad || prod?.unidad || <E />}</td>}
        {vc.totalEgreso     && (
          <td className="hist-col-num hist-col-egreso">
            {formatCantidad(parseFloat(m.cantidad) || 0)}
          </td>
        )}
      </>
    );
  };

  const renderRow = tab === 'ingresos'
    ? renderRowIngreso
    : tab === 'egresos'
      ? renderRowEgreso
      : renderRowConsolidado;

  // Color de la fila por tipo (solo aplica en Consolidado) + anulada.
  const rowClassName = (m) => {
    if (tab !== 'consolidado') return m.recepcionAnulada ? 'mhist-row-anulada' : '';
    const tipoCls = m.tipo === 'ingreso' ? 'mhist-row-ingreso' : 'mhist-row-egreso';
    return [tipoCls, m.recepcionAnulada ? 'mhist-row-anulada' : ''].filter(Boolean).join(' ');
  };
  // Nota: anulacion_ingreso comparte el tinte de egreso en la fila (resta
  // stock); el badge sí la distingue con paleta ámbar (mhist-tipo-badge--anulacion).

  const hasFilters = searchProd || fechaDesde || fechaHasta;
  const resetFilters = () => { setSearchProd(''); setFechaDesde(''); setFechaHasta(''); };

  const TABS = [
    { id: 'consolidado', label: 'Consolidado', count: null },
    { id: 'ingresos',    label: 'Ingresos',    count: ingresosCount },
    { id: 'egresos',     label: 'Egresos',     count: egresosCount },
  ];

  // Navegación con flechas entre tabs (WAI-ARIA tabs pattern).
  const onTabsKeyDown = (e) => {
    const idx = TABS.findIndex(t => t.id === tab);
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`mhist-tab-${TABS[next].id}`)?.focus();
  };

  if (loading) return <div className="pg-page-loading" />;

  if (error) {
    return (
      <div className="lote-management-layout">
        <div className="aur-sheet">
          <div className="mhist-error" role="alert">
            <FiAlertTriangle size={18} aria-hidden="true" />
            <span>{error}</span>
            <button type="button" className="aur-btn-pill" onClick={loadData}>
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lote-management-layout">
      <div className="aur-sheet">

        {/* ── Encabezado + filtros ── */}
        <div className="mhist-header">
          <div className="lote-page-title-block">
            <h2>Historial de Movimientos</h2>
            <p className="lote-page-hint">
              Rastrea cada entrada, salida y ajuste de existencias en bodega para auditar el movimiento de tus agroquímicos.{' '}
              <Link to="/bodega/agroquimicos/existencias">Ir a Existencias</Link>
            </p>
          </div>
          <div className="mhist-filters">
            <div className="mhist-search-wrap">
              <FiSearch size={14} className="mhist-search-icon" />
              <input
                className="mhist-search"
                value={searchProd}
                onChange={e => setSearchProd(e.target.value)}
                placeholder="Buscar producto…"
              />
              {searchProd && (
                <button className="mhist-clear" onClick={() => setSearchProd('')} title="Limpiar búsqueda">
                  <FiX size={13} />
                </button>
              )}
            </div>
            <div className="mhist-date-field">
              <label className="mhist-date-label">Desde</label>
              <input
                type="date"
                className="mhist-date"
                value={fechaDesde}
                max={fechaHasta || undefined}
                onChange={e => setFechaDesde(e.target.value)}
              />
            </div>
            <div className="mhist-date-field">
              <label className="mhist-date-label">Hasta</label>
              <input
                type="date"
                className="mhist-date"
                value={fechaHasta}
                min={fechaDesde || undefined}
                onChange={e => setFechaHasta(e.target.value)}
              />
            </div>
            {hasFilters && (
              <button className="mhist-reset" onClick={resetFilters}>
                <FiX size={13} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── Tabs (patrón WAI-ARIA: roving tabindex + flechas) ── */}
        <div className="mhist-tabs" role="tablist" aria-label="Tipo de movimiento" onKeyDown={onTabsKeyDown}>
          {TABS.map(({ id, label, count }) => (
            <button
              key={id}
              id={`mhist-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls="mhist-tabpanel"
              tabIndex={tab === id ? 0 : -1}
              className={`mhist-tab${tab === id ? ' mhist-tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {count != null && <span className="mhist-tab-count">{count}</span>}
            </button>
          ))}
        </div>

        {/* ── Hint de saldo ── */}
        {showSaldo && (
          <div className="mhist-saldo-hint" id="mhist-tabpanel-hint">
            Mostrando kardex para <strong>{prodMap[uniqueProductoIds[0]]?.nombreComercial || uniqueProductoIds[0]}</strong>.
            Saldo calculado a partir del stock actual registrado.
            {saldoTruncado && (
              <> El historial está topado a {MOVIMIENTOS_CAP} movimientos: el saldo es <strong>aproximado</strong> si el producto tiene registros más antiguos.</>
            )}
          </div>
        )}

        {/* ── Tabla con sort, filter, col-menu y kardex dinámico ──
            Sin `key={tab}`: dejamos que AuroraDataTable reconcilie en vez de
            remontar (preservaba peor el estado de sort/filtros). Punto #5. */}
        <div role="tabpanel" id="mhist-tabpanel" aria-labelledby={`mhist-tab-${tab}`}>
          <AuroraDataTable
            columns={columns}
            data={tabData}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            visibleCols={visibleCols}
            onToggleVisibleCol={toggleColumn}
            renderRow={renderRow}
            rowClassName={rowClassName}
            resetPaginationKey={tab}
            resultLabel={(f, t) => f === t
              ? `${f} movimiento${f === 1 ? '' : 's'}`
              : `${f} de ${t} movimiento${t === 1 ? '' : 's'}`}
            emptyIcon={FiInbox}
            emptyText={hasFilters ? 'Sin resultados para los filtros aplicados.' : 'Aún no hay movimientos registrados.'}
            emptySubtitle={hasFilters
              ? 'Probá ampliar el rango de fechas o limpiar la búsqueda.'
              : 'Los movimientos aparecen aquí al recibir compras o aplicar cédulas en campo.'}
            emptyAction={hasFilters
              ? (
                <button type="button" className="aur-btn-pill" onClick={resetFilters}>
                  <FiX size={14} /> Limpiar filtros
                </button>
              )
              : (
                <Link to="/bodega/agroquimicos/existencias" className="aur-btn-pill">
                  Ir a Existencias
                </Link>
              )}
            wrapClassName="hist-table-wrap"
            tableClassName="hist-table"
          />
        </div>
      </div>
    </div>
  );
}

export default MovimientosHistorial;
