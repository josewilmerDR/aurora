import { useEffect, useState } from 'react';
import { FiSend, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

const MAX_SUPPLIERS = 20;
const MONEDAS = ['CRC', 'USD', 'EUR'];

function todayYmd() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function RfqCreateForm({ onCreated, onClose }) {
  const apiFetch = useApiFetch();
  const [productos, setProductos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [unidad, setUnidad] = useState('');
  const [currency, setCurrency] = useState('CRC');
  const [deadline, setDeadline] = useState('');
  const [maxLeadTimeDays, setMaxLeadTimeDays] = useState('');
  const [notas, setNotas] = useState('');
  const [selectedSuppliers, setSelectedSuppliers] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [outcomes, setOutcomes] = useState(null);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/productos').then(r => r.json()),
      apiFetch('/api/proveedores').then(r => r.json()),
    ])
      .then(([prods, provs]) => {
        setProductos(Array.isArray(prods) ? prods : []);
        setProveedores(Array.isArray(provs) ? provs : []);
      })
      .catch(() => setLoadError('No se pudo cargar productos o proveedores.'))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const selectedProduct = productos.find(p => p.id === productoId) || null;

  const handleProductChange = (id) => {
    setProductoId(id);
    const p = productos.find(x => x.id === id);
    if (p && p.unidad) setUnidad(p.unidad);
  };

  const toggleSupplier = (id) => {
    setSelectedSuppliers(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      if (prev.length >= MAX_SUPPLIERS) return prev;
      return [...prev, id];
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!productoId) { setError('Selecciona un producto.'); return; }
    const qty = Number(cantidad);
    if (!(qty > 0)) { setError('La cantidad debe ser mayor a cero.'); return; }
    if (!unidad.trim()) { setError('Unidad requerida.'); return; }
    if (!deadline) { setError('Fecha de cierre requerida.'); return; }
    if (selectedSuppliers.length === 0) { setError('Selecciona al menos un proveedor.'); return; }

    setBusy(true);
    try {
      const body = {
        productoId,
        nombreComercial: selectedProduct?.nombreComercial || '',
        cantidad: qty,
        unidad: unidad.trim(),
        deadline,
        currency,
        maxLeadTimeDays: maxLeadTimeDays === '' ? null : Number(maxLeadTimeDays),
        notas: notas.trim(),
        supplierIds: selectedSuppliers,
      };
      const r = await apiFetch('/api/rfqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(msg || 'Error al crear la cotización.');
      }
      const data = await r.json();
      setOutcomes(data);
      onCreated?.();
    } catch (err) {
      setError(err.message || 'No se pudo crear la cotización.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aur-modal-backdrop" onPointerDown={busy ? undefined : onClose}>
      <div className="aur-modal aur-modal--lg" onPointerDown={e => e.stopPropagation()}>
        <header className="aur-modal-header">
          <span className="aur-modal-icon"><FiSend size={16} /></span>
          <h3 className="aur-modal-title">Nueva cotización</h3>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            <FiX size={16} />
          </button>
        </header>

        {loading && (
          <div className="aur-modal-content">
            <p className="rfq-create-loading">Cargando…</p>
          </div>
        )}

        {loadError && (
          <div className="aur-modal-content">
            <div className="aur-banner aur-banner--danger">{loadError}</div>
          </div>
        )}

        {!loading && !loadError && !outcomes && (
          <form onSubmit={submit} style={{ display: 'contents' }}>
            <div className="aur-modal-content">
              <section className="aur-section">
                <header className="aur-section-header">
                  <span className="aur-section-num">01</span>
                  <h3 className="aur-section-title">Producto y cantidad</h3>
                </header>
                <ul className="aur-list">
                  <li className="aur-row">
                    <span className="aur-row-label">Producto</span>
                    <select
                      className="aur-select"
                      value={productoId}
                      onChange={e => handleProductChange(e.target.value)}
                      required
                    >
                      <option value="">— Seleccionar —</option>
                      {productos.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.nombreComercial} {p.idProducto ? `(${p.idProducto})` : ''}
                        </option>
                      ))}
                    </select>
                  </li>
                  <li className="aur-row">
                    <span className="aur-row-label">Cantidad</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="aur-input aur-input--num"
                      value={cantidad}
                      onChange={e => setCantidad(e.target.value)}
                      required
                    />
                  </li>
                  <li className="aur-row">
                    <span className="aur-row-label">Unidad</span>
                    <input
                      type="text"
                      className="aur-input"
                      value={unidad}
                      onChange={e => setUnidad(e.target.value)}
                      maxLength={20}
                      required
                    />
                  </li>
                  <li className="aur-row">
                    <span className="aur-row-label">Moneda</span>
                    <select
                      className="aur-select"
                      value={currency}
                      onChange={e => setCurrency(e.target.value)}
                    >
                      {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </li>
                </ul>
              </section>

              <section className="aur-section">
                <header className="aur-section-header">
                  <span className="aur-section-num">02</span>
                  <h3 className="aur-section-title">Plazos</h3>
                </header>
                <ul className="aur-list">
                  <li className="aur-row">
                    <span className="aur-row-label">Fecha de cierre</span>
                    <input
                      type="date"
                      className="aur-input"
                      value={deadline}
                      min={todayYmd()}
                      onChange={e => setDeadline(e.target.value)}
                      required
                    />
                  </li>
                  <li className="aur-row">
                    <span className="aur-row-label">Plazo máx. entrega (días)</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="aur-input aur-input--num"
                      value={maxLeadTimeDays}
                      onChange={e => setMaxLeadTimeDays(e.target.value)}
                    />
                  </li>
                </ul>
              </section>

              <section className="aur-section">
                <header className="aur-section-header">
                  <span className="aur-section-num">03</span>
                  <h3 className="aur-section-title">Notas</h3>
                </header>
                <ul className="aur-list">
                  <li className="aur-row aur-row--multiline">
                    <span className="aur-row-label">Mensaje al proveedor</span>
                    <textarea
                      rows={2}
                      className="aur-textarea"
                      value={notas}
                      onChange={e => setNotas(e.target.value)}
                      maxLength={500}
                      placeholder="opcional — contexto para el proveedor"
                    />
                  </li>
                </ul>
              </section>

              <section className="aur-section">
                <header className="aur-section-header">
                  <span className="aur-section-num">04</span>
                  <h3 className="aur-section-title">Proveedores a contactar</h3>
                  <span className="aur-section-count">
                    {selectedSuppliers.length}/{Math.min(proveedores.length, MAX_SUPPLIERS)}
                  </span>
                </header>
                {proveedores.length === 0 ? (
                  <p className="rfq-create-empty">No hay proveedores registrados.</p>
                ) : (
                  <ul className="aur-list rfq-supplier-list">
                    {proveedores.map(p => {
                      const checked = selectedSuppliers.includes(p.id);
                      const disabled = !checked && selectedSuppliers.length >= MAX_SUPPLIERS;
                      return (
                        <li key={p.id} className="aur-row rfq-supplier-row">
                          <label className="rfq-supplier-label">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleSupplier(p.id)}
                            />
                            <span className="rfq-supplier-name">
                              <strong>{p.nombre}</strong>
                              {p.telefono && <span className="rfq-supplier-meta"> · {p.telefono}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {error && <div className="aur-banner aur-banner--danger">{error}</div>}
            </div>

            <div className="aur-modal-actions">
              <button type="button" className="aur-btn-text" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill" disabled={busy}>
                <FiSend size={14} /> {busy ? 'Enviando…' : 'Crear y enviar'}
              </button>
            </div>
          </form>
        )}

        {outcomes && (
          <>
            <div className="aur-modal-content">
              <section className="aur-section">
                <header className="aur-section-header">
                  <h3 className="aur-section-title">Cotización creada</h3>
                  <span className={`aur-badge ${outcomes.estado === 'sent' ? 'aur-badge--green' : 'aur-badge--gray'}`}>
                    {outcomes.estado === 'sent' ? 'Enviada' : 'Sin envío'}
                  </span>
                </header>
                <ul className="aur-list">
                  {(outcomes.suppliersContacted || []).map(o => (
                    <li key={o.supplierId} className="aur-row">
                      <span className="aur-row-label">{o.supplierName}</span>
                      <span className={`rfq-outcome ${o.sent ? 'rfq-outcome--ok' : 'rfq-outcome--fail'}`}>
                        {o.sent ? 'enviado' : (o.reason || 'no enviado')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="aur-modal-actions">
              <button type="button" className="aur-btn-pill" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default RfqCreateForm;
