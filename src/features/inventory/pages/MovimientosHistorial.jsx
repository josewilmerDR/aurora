import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FiSearch, FiX, FiArrowUp, FiArrowDown } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraDataTable from '../../../components/AuroraDataTable';
import '../styles/agroquimicos.css';
import '../../planting/styles/siembra-historial.css';

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const E = () => <span className="hist-empty">—</span>;

// ── Column definitions per tab ──────────────────────────────────────────────
const COLS_CONSOLIDADO = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'tipo',            label: 'Tipo',             type: 'text'   },
  { key: 'referencia',      label: 'Referencia',       type: 'text'   },
  { key: 'detalle',         label: 'Detalle',          type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'entrada',         label: 'Entrada',          type: 'number', align: 'right' },
  { key: 'salida',          label: 'Salida',           type: 'number', align: 'right' },
];

const COLS_INGRESOS = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'recepcion',       label: 'Recepción',        type: 'text'   },
  { key: 'facturaNumero',   label: 'Factura',          type: 'text'   },
  { key: 'proveedor',       label: 'Proveedor',        type: 'text'   },
  { key: 'ocPoNumber',      label: 'OC',               type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'cantidad',        label: 'Cantidad',         type: 'number', align: 'right' },
  { key: 'precioUnitario',  label: 'Precio Unit.',     type: 'number', align: 'right' },
  { key: 'iva',             label: 'IVA',              type: 'number', align: 'right' },
  { key: 'total',           label: 'Total',            type: 'number', align: 'right' },
];

const COLS_EGRESOS = [
  { key: 'fecha',           label: 'Fecha',            type: 'date'   },
  { key: 'consecutivo',     label: 'Consecutivo',      type: 'text'   },
  { key: 'motivo',          label: 'Aplicación',       type: 'text'   },
  { key: 'lote',            label: 'Lote',             type: 'text'   },
  { key: 'grupo',           label: 'Grupo',            type: 'text'   },
  { key: 'idProducto',      label: 'ID Producto',      type: 'text'   },
  { key: 'nombreComercial', label: 'Nombre Comercial', type: 'text'   },
  { key: 'unidad',          label: 'UM',               type: 'text'   },
  { key: 'totalEgreso',     label: 'Total',            type: 'number', align: 'right' },
];

function getColsForTab(tab) {
  if (tab === 'ingresos') return COLS_INGRESOS;
  if (tab === 'egresos')  return COLS_EGRESOS;
  return COLS_CONSOLIDADO;
}

// ── Value extractors for sort / filter ──────────────────────────────────────
function makeGetColVal(prodMap) {
  return (m, key) => {
    const prod = prodMap[m.productoId];
    switch (key) {
      case 'fecha':           return m.fecha?.slice(0, 10) || '';
      case 'tipo':            return m.tipo || '';
      case 'referencia': {
        if (m.tipo === 'ingreso') return (m.facturaNumero || m.ocPoNumber || '').toLowerCase();
        return (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '')).toLowerCase();
      }
      case 'detalle': {
        if (m.tipo === 'ingreso') return (m.proveedor || '').toLowerCase();
        const fuente = m.loteNombre || m.grupoNombre || '';
        return (m.motivo ? (fuente ? `${m.motivo} · ${fuente}` : m.motivo) : '').toLowerCase();
      }
      case 'idProducto':      return (m.idProducto || prod?.idProducto || '').toLowerCase();
      case 'nombreComercial': return (m.nombreComercial || prod?.nombreComercial || '').toLowerCase();
      case 'unidad':          return (m.unidad || prod?.unidad || '').toLowerCase();
      case 'entrada':         return m.tipo === 'ingreso' ? (parseFloat(m.cantidad) || 0) : 0;
      case 'salida':          return (m.tipo === 'egreso' || m.tipo === 'anulacion_ingreso') ? (parseFloat(m.cantidad) || 0) : 0;
      case 'recepcion':       return (m.recepcionId || '').toLowerCase();
      case 'facturaNumero':   return (m.facturaNumero || '').toLowerCase();
      case 'proveedor':       return (m.proveedor || '').toLowerCase();
      case 'ocPoNumber':      return (m.ocPoNumber || '').toLowerCase();
      case 'cantidad':        return parseFloat(m.cantidad) || 0;
      case 'precioUnitario':  return parseFloat(m.precioUnitario) || 0;
      case 'iva':             return parseFloat(m.iva) || 0;
      case 'total': {
        const cant = parseFloat(m.cantidad) || 0;
        const pu   = parseFloat(m.precioUnitario) || 0;
        const iv   = parseFloat(m.iva) || 0;
        return cant * pu * (1 + iv / 100);
      }
      case 'consecutivo':
        return (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '')).toLowerCase();
      case 'motivo':          return (m.motivo || '').toLowerCase();
      case 'lote':
        return m.grupoId ? '' : (m.loteNombre || '').toLowerCase();
      case 'grupo':
        return (m.grupoId ? (m.grupoNombre || m.loteNombre || '') : (m.grupoNombre || '')).toLowerCase();
      case 'totalEgreso':     return parseFloat(m.cantidad) || 0;
      default:                return '';
    }
  };
}

function MovimientosHistorial() {
  const apiFetch = useApiFetch();
  const [movimientos, setMovimientos] = useState([]);
  const [productos,   setProductos]   = useState([]);
  const [loading,     setLoading]     = useState(true);

  const location = useLocation();
  const initialTab = (() => {
    const t = new URLSearchParams(location.search).get('tab');
    return ['consolidado', 'ingresos', 'egresos'].includes(t) ? t : 'consolidado';
  })();
  const [tab,        setTab]        = useState(initialTab);
  const [searchProd, setSearchProd] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch('/api/movimientos').then(r => r.json()),
      apiFetch('/api/productos').then(r => r.json()),
    ])
      .then(([movs, prods]) => { setMovimientos(movs); setProductos(prods); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const prodMap = useMemo(() => {
    const m = {};
    productos.forEach(p => { m[p.id] = p; });
    return m;
  }, [productos]);

  const getColVal = useMemo(() => makeGetColVal(prodMap), [prodMap]);

  // ── Base filter (search + date range) ─────────────────────────────────────
  const baseFiltered = useMemo(() => {
    return movimientos.filter(m => {
      if (searchProd) {
        const q    = searchProd.toLowerCase();
        const prod = prodMap[m.productoId];
        const idOk   = (m.idProducto || prod?.idProducto || '').toLowerCase().includes(q);
        const nameOk = (m.nombreComercial || '').toLowerCase().includes(q);
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
  }, [movimientos, searchProd, fechaDesde, fechaHasta, prodMap]);

  // Tab-filtered data — lo que entra a AuroraDataTable, que aplica sus
  // col filters + sort internamente.
  const tabData = useMemo(() => {
    if (tab === 'consolidado') return baseFiltered;
    return baseFiltered.filter(m => tab === 'ingresos' ? m.tipo === 'ingreso' : m.tipo === 'egreso');
  }, [baseFiltered, tab]);

  const ingresosCount = useMemo(() => movimientos.filter(m => m.tipo === 'ingreso').length, [movimientos]);
  const egresosCount  = useMemo(() => movimientos.filter(m => m.tipo === 'egreso').length,  [movimientos]);

  // ── Saldo (Kardex) ────────────────────────────────────────────────────────
  const uniqueProductoIds = useMemo(
    () => [...new Set(baseFiltered.map(m => m.productoId))],
    [baseFiltered],
  );
  const isSingleProduct = uniqueProductoIds.length === 1;
  const showSaldo = tab === 'consolidado' && isSingleProduct;

  const saldoMap = useMemo(() => {
    if (!isSingleProduct) return {};
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
  }, [isSingleProduct, uniqueProductoIds, movimientos, prodMap]);

  // Si estamos en Consolidado con un solo producto, agregamos la columna
  // "Saldo" al final (no es sortable ni filtrable — es un cálculo derivado).
  const columns = useMemo(() => {
    const base = getColsForTab(tab);
    if (showSaldo) {
      return [
        ...base,
        { key: 'saldo', label: 'Saldo', sortable: false, align: 'right' },
      ];
    }
    return base;
  }, [tab, showSaldo]);

  // ── Render rows por tab ───────────────────────────────────────────────────
  const renderRowConsolidado = (m, vc) => {
    const prod       = prodMap[m.productoId];
    const idProducto = m.idProducto || prod?.idProducto || '';
    const cant       = parseFloat(m.cantidad) || 0;
    const isIngreso  = m.tipo === 'ingreso';
    const isAnulacion = m.tipo === 'anulacion_ingreso';
    const referencia = isIngreso
      ? (m.facturaNumero || m.ocPoNumber || <E />)
      : (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : <E />));
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
            <span className={`mhist-tipo-badge mhist-tipo-badge--${m.tipo}`}>
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
              ? <span className="mhist-val-entrada">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
              : <E />}
          </td>
        )}
        {vc.salida           && (
          <td className="hist-col-num mhist-col-salida">
            {!isIngreso
              ? <span className="mhist-val-salida">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
              : <E />}
          </td>
        )}
        {showSaldo && vc.saldo && (
          <td className="hist-col-num mhist-col-saldo">
            {saldo !== undefined
              ? <span className={saldo < 0 ? 'mhist-saldo-neg' : 'mhist-saldo-pos'}>
                  {saldo.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
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
        {vc.cantidad        && <td className="hist-col-num">{cant.toLocaleString('es-CR')}</td>}
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
    const prod       = prodMap[m.productoId];
    const idProducto = m.idProducto || prod?.idProducto || '';
    const isGrupo    = !!m.grupoId;
    const loteDisplay  = isGrupo ? '' : (m.loteNombre || '');
    const grupoDisplay = isGrupo
      ? (m.grupoNombre || m.loteNombre || '')
      : (m.grupoNombre || '');
    const consecutivo = m.cedulaConsecutivo
      || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : '—');
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
            {(parseFloat(m.cantidad) || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
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

  const hasFilters = searchProd || fechaDesde || fechaHasta;

  if (loading) return <div className="pg-page-loading" />;

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
              <input type="date" className="mhist-date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
            </div>
            <div className="mhist-date-field">
              <label className="mhist-date-label">Hasta</label>
              <input type="date" className="mhist-date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
            </div>
            {hasFilters && (
              <button className="mhist-reset" onClick={() => { setSearchProd(''); setFechaDesde(''); setFechaHasta(''); }}>
                <FiX size={13} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="mhist-tabs">
          <button className={`mhist-tab${tab === 'consolidado' ? ' mhist-tab--active' : ''}`} onClick={() => setTab('consolidado')}>
            Consolidado
          </button>
          <button className={`mhist-tab${tab === 'ingresos' ? ' mhist-tab--active' : ''}`} onClick={() => setTab('ingresos')}>
            Ingresos <span className="mhist-tab-count">{ingresosCount}</span>
          </button>
          <button className={`mhist-tab${tab === 'egresos' ? ' mhist-tab--active' : ''}`} onClick={() => setTab('egresos')}>
            Egresos <span className="mhist-tab-count">{egresosCount}</span>
          </button>
        </div>

        {/* ── Hint de saldo ── */}
        {showSaldo && (
          <div className="mhist-saldo-hint">
            Mostrando kardex para <strong>{prodMap[uniqueProductoIds[0]]?.nombreComercial || uniqueProductoIds[0]}</strong>.
            Saldo calculado a partir del stock actual registrado.
          </div>
        )}

        {/* ── Tabla con sort, filter, col-menu y kardex dinámico ── */}
        <AuroraDataTable
          key={tab}
          columns={columns}
          data={tabData}
          getColVal={getColVal}
          initialSort={{ field: 'fecha', dir: 'desc' }}
          firstClickDir="desc"
          renderRow={renderRow}
          rowClassName={rowClassName}
          resultLabel={(f, t) => f === t
            ? `${f} movimiento${f === 1 ? '' : 's'}`
            : `${f} de ${t} movimiento${t === 1 ? '' : 's'}`}
          emptyText={`No hay movimientos${hasFilters ? ' con los filtros actuales' : ''}.`}
          wrapClassName="hist-table-wrap"
          tableClassName="hist-table"
        />
      </div>
    </div>
  );
}

export default MovimientosHistorial;
