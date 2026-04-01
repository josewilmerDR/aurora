import { useState, useEffect, useMemo } from 'react';
import { FiSearch, FiX, FiArrowUp, FiArrowDown } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './ProductManagement.css';

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

const E = () => <span className="hist-empty">—</span>;

function MovimientosHistorial() {
  const apiFetch = useApiFetch();
  const [movimientos, setMovimientos] = useState([]);
  const [productos,   setProductos]   = useState([]);
  const [loading,     setLoading]     = useState(true);

  const [tab,        setTab]        = useState('consolidado'); // 'consolidado' | 'ingresos' | 'egresos'
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

  // Map: Firestore doc ID → product
  const prodMap = useMemo(() => {
    const m = {};
    productos.forEach(p => { m[p.id] = p; });
    return m;
  }, [productos]);

  // Base filter (sin tipo) — para tabs y para saldo
  const baseFiltered = useMemo(() => {
    return movimientos.filter(m => {
      if (searchProd) {
        const q    = searchProd.toLowerCase();
        const prod = prodMap[m.productoId];
        const idOk   = (m.idProducto || prod?.idProducto || '').toLowerCase().includes(q);
        const nameOk = (m.nombreComercial || '').toLowerCase().includes(q);
        if (!idOk && !nameOk) return false;
      }
      if (fechaDesde && new Date(m.fecha) < new Date(fechaDesde + 'T00:00:00')) return false;
      if (fechaHasta && new Date(m.fecha) > new Date(fechaHasta + 'T23:59:59')) return false;
      return true;
    });
  }, [movimientos, searchProd, fechaDesde, fechaHasta, prodMap]);

  const filtered = useMemo(() => {
    if (tab === 'consolidado') return [...baseFiltered].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return baseFiltered.filter(m => tab === 'ingresos' ? m.tipo === 'ingreso' : m.tipo === 'egreso');
  }, [baseFiltered, tab]);

  const ingresosCount = useMemo(() => movimientos.filter(m => m.tipo === 'ingreso').length, [movimientos]);
  const egresosCount  = useMemo(() => movimientos.filter(m => m.tipo === 'egreso').length,  [movimientos]);

  // ── Saldo (Kardex) ──────────────────────────────────────────────────────────
  // Solo se calcula cuando el filtro activo deja un único productoId visible.
  const uniqueProductoIds = useMemo(
    () => [...new Set(baseFiltered.map(m => m.productoId))],
    [baseFiltered],
  );
  const isSingleProduct = uniqueProductoIds.length === 1;

  // saldoMap: movimientoId → saldo acumulado después de ese movimiento
  const saldoMap = useMemo(() => {
    if (!isSingleProduct) return {};

    const productoId = uniqueProductoIds[0];
    const producto   = prodMap[productoId];
    const stockActual = parseFloat(producto?.stockActual) || 0;

    // Todos los movimientos del producto en orden ASC (sin filtro de fecha)
    const todos = movimientos
      .filter(m => m.productoId === productoId)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    // Saldo de apertura = stockActual − neto de todos los movimientos conocidos
    const netTotal = todos.reduce((s, m) => {
      const cant = parseFloat(m.cantidad) || 0;
      return m.tipo === 'ingreso' ? s + cant : s - cant;
    }, 0);
    const opening = stockActual - netTotal;

    // Recorrer ASC acumulando saldo
    const map = {};
    let balance = opening;
    for (const m of todos) {
      const cant = parseFloat(m.cantidad) || 0;
      balance += m.tipo === 'ingreso' ? cant : -cant;
      map[m.id] = balance;
    }
    return map;
  }, [isSingleProduct, uniqueProductoIds, movimientos, prodMap]);

  const hasFilters = searchProd || fechaDesde || fechaHasta;

  if (loading) return <div className="mhist-loading">Cargando movimientos…</div>;

  return (
    <div className="lote-management-layout">
      <div className="list-card">

        {/* ── Encabezado + filtros ── */}
        <div className="mhist-header">
          <h2>Historial de Movimientos</h2>
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
            <label className="mhist-date-label">Desde</label>
            <input type="date" className="mhist-date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
            <label className="mhist-date-label">Hasta</label>
            <input type="date" className="mhist-date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
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
        {tab === 'consolidado' && isSingleProduct && (
          <div className="mhist-saldo-hint">
            Mostrando kardex para <strong>{prodMap[uniqueProductoIds[0]]?.nombreComercial || uniqueProductoIds[0]}</strong>.
            Saldo calculado a partir del stock actual registrado.
          </div>
        )}

        {/* ── Contenido ── */}
        {filtered.length === 0 ? (
          <p className="empty-state">
            No hay movimientos{hasFilters ? ' con los filtros actuales' : ''}.
          </p>
        ) : tab === 'consolidado' ? (
          <ConsolidadoTable rows={filtered} prodMap={prodMap} saldoMap={saldoMap} showSaldo={isSingleProduct} />
        ) : tab === 'ingresos' ? (
          <IngresoTable rows={filtered} />
        ) : (
          <EgresoTable rows={filtered} prodMap={prodMap} />
        )}

      </div>
    </div>
  );
}

/* ── Tabla Consolidada (Kardex) ───────────────────────────────────────────── */
function ConsolidadoTable({ rows, prodMap, saldoMap, showSaldo }) {
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Referencia</th>
            <th>Detalle</th>
            <th>ID Producto</th>
            <th>Nombre Comercial</th>
            <th>UM</th>
            <th className="hist-col-num mhist-col-entrada">Entrada</th>
            <th className="hist-col-num mhist-col-salida">Salida</th>
            {showSaldo && <th className="hist-col-num mhist-col-saldo">Saldo</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const prod       = prodMap[m.productoId];
            const idProducto = m.idProducto || prod?.idProducto || '';
            const cant       = parseFloat(m.cantidad) || 0;
            const isIngreso  = m.tipo === 'ingreso';

            // Referencia: factura (ingreso) | consecutivo (egreso)
            const referencia = isIngreso
              ? (m.facturaNumero || m.ocPoNumber || <E />)
              : (m.cedulaConsecutivo || (m.tareaId ? `T-${m.tareaId.slice(-6).toUpperCase()}` : <E />));

            // Detalle: proveedor (ingreso) | aplicación + fuente (egreso)
            const fuenteEgreso = m.loteNombre || m.grupoNombre || '';
            const detalle = isIngreso
              ? (m.proveedor || <E />)
              : (m.motivo ? (fuenteEgreso ? `${m.motivo} · ${fuenteEgreso}` : m.motivo) : <E />);

            const saldo = saldoMap[m.id];

            return (
              <tr key={m.id} className={isIngreso ? 'mhist-row-ingreso' : 'mhist-row-egreso'}>
                <td className="hist-col-fecha">{formatDate(m.fecha)}</td>
                <td>
                  <span className={`mhist-tipo-badge mhist-tipo-badge--${m.tipo}`}>
                    {isIngreso
                      ? <><FiArrowDown size={11} /> Ingreso</>
                      : <><FiArrowUp   size={11} /> Egreso</>}
                  </span>
                </td>
                <td className="mhist-col-ref">{referencia}</td>
                <td className="mhist-col-detalle">{detalle}</td>
                <td>{idProducto || <E />}</td>
                <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>
                <td>{m.unidad || prod?.unidad || <E />}</td>
                <td className="hist-col-num mhist-col-entrada">
                  {isIngreso
                    ? <span className="mhist-val-entrada">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
                    : <E />}
                </td>
                <td className="hist-col-num mhist-col-salida">
                  {!isIngreso
                    ? <span className="mhist-val-salida">{cant.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</span>
                    : <E />}
                </td>
                {showSaldo && (
                  <td className="hist-col-num mhist-col-saldo">
                    {saldo !== undefined
                      ? <span className={saldo < 0 ? 'mhist-saldo-neg' : 'mhist-saldo-pos'}>
                          {saldo.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                        </span>
                      : <E />}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tabla Ingresos ───────────────────────────────────────────────────────── */
function IngresoTable({ rows }) {
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Factura</th>
            <th>Proveedor</th>
            <th>OC</th>
            <th>ID Producto</th>
            <th>Nombre Comercial</th>
            <th>UM</th>
            <th className="hist-col-num">Cantidad</th>
            <th className="hist-col-num">Precio Unit.</th>
            <th className="hist-col-num">IVA</th>
            <th className="hist-col-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
            const precioUnit = parseFloat(m.precioUnitario) || 0;
            const cant       = parseFloat(m.cantidad)       || 0;
            const iva        = parseFloat(m.iva)            || 0;
            const total      = cant * precioUnit * (1 + iva / 100);
            return (
              <tr key={m.id}>
                <td className="hist-col-fecha">{formatDate(m.fecha)}</td>
                <td>{m.facturaNumero || <E />}</td>
                <td>{m.proveedor     || <E />}</td>
                <td>{m.ocPoNumber    || <E />}</td>
                <td>{m.idProducto    || <E />}</td>
                <td className="hist-col-name">{m.nombreComercial || <E />}</td>
                <td>{m.unidad || <E />}</td>
                <td className="hist-col-num">{cant.toLocaleString('es-CR')}</td>
                <td className="hist-col-num">
                  {precioUnit > 0
                    ? precioUnit.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                    : <E />}
                </td>
                <td className="hist-col-num">{iva > 0 ? `${iva}%` : <E />}</td>
                <td className="hist-col-num hist-col-total">
                  {total > 0
                    ? total.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : <E />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Tabla Egresos ────────────────────────────────────────────────────────── */
function EgresoTable({ rows, prodMap }) {
  return (
    <div className="hist-table-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Consecutivo</th>
            <th>Aplicación</th>
            <th>Lote</th>
            <th>Grupo</th>
            <th>ID Producto</th>
            <th>Nombre Comercial</th>
            <th>UM</th>
            <th className="hist-col-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => {
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
              <tr key={m.id}>
                <td className="hist-col-fecha">{formatDate(m.fecha)}</td>
                <td className="mhist-col-consec">{consecutivo}</td>
                <td>{m.motivo       || <E />}</td>
                <td>{loteDisplay   || <E />}</td>
                <td>{grupoDisplay  || <E />}</td>
                <td>{idProducto    || <E />}</td>
                <td className="hist-col-name">{m.nombreComercial || prod?.nombreComercial || <E />}</td>
                <td>{m.unidad || prod?.unidad || <E />}</td>
                <td className="hist-col-num hist-col-egreso">
                  {(parseFloat(m.cantidad) || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default MovimientosHistorial;
