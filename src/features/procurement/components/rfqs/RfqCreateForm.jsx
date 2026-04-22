import { useEffect, useState } from 'react';
import { FiSend, FiX } from 'react-icons/fi';
import { useApiFetch } from '../../../../hooks/useApiFetch';

// Modal form to create a new RFQ. Hits POST /api/rfqs which fans out a
// WhatsApp message to every selected supplier. On success we show the
// delivery outcomes so the user sees which contacts landed.

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
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="rfq-create-card" onClick={e => e.stopPropagation()}>
        <div className="rfq-create-header">
          <h3><FiSend /> Nueva cotización</h3>
          <button className="rfq-create-close" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <FiX size={18} />
          </button>
        </div>

        {loading && <div className="empty-state">Cargando…</div>}
        {loadError && <div className="fin-widget-error">{loadError}</div>}

        {!loading && !loadError && !outcomes && (
          <form onSubmit={submit} className="rfq-create-form">
            <div className="rfq-create-row">
              <label>
                Producto
                <select value={productoId} onChange={e => handleProductChange(e.target.value)} required>
                  <option value="">— Seleccionar —</option>
                  {productos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombreComercial} {p.idProducto ? `(${p.idProducto})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="rfq-create-row">
              <label>
                Cantidad
                <input type="number" step="any" min="0" value={cantidad}
                  onChange={e => setCantidad(e.target.value)} required />
              </label>
              <label>
                Unidad
                <input type="text" value={unidad} onChange={e => setUnidad(e.target.value)}
                  maxLength={20} required />
              </label>
              <label>
                Moneda
                <select value={currency} onChange={e => setCurrency(e.target.value)}>
                  {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>

            <div className="rfq-create-row">
              <label>
                Fecha de cierre
                <input type="date" value={deadline} min={todayYmd()}
                  onChange={e => setDeadline(e.target.value)} required />
              </label>
              <label>
                Plazo máx. entrega (días, opcional)
                <input type="number" min="0" step="1" value={maxLeadTimeDays}
                  onChange={e => setMaxLeadTimeDays(e.target.value)} />
              </label>
            </div>

            <label>
              Notas
              <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
                maxLength={500} placeholder="opcional — contexto para el proveedor" />
            </label>

            <div className="rfq-create-suppliers">
              <div className="rfq-create-suppliers-head">
                <span>Proveedores a contactar</span>
                <span className="fin-widget-sub">
                  {selectedSuppliers.length}/{Math.min(proveedores.length, MAX_SUPPLIERS)} seleccionado(s)
                </span>
              </div>
              {proveedores.length === 0 ? (
                <div className="empty-state">No hay proveedores registrados.</div>
              ) : (
                <ul className="rfq-create-supplier-list">
                  {proveedores.map(p => {
                    const checked = selectedSuppliers.includes(p.id);
                    const disabled = !checked && selectedSuppliers.length >= MAX_SUPPLIERS;
                    return (
                      <li key={p.id}>
                        <label>
                          <input type="checkbox" checked={checked} disabled={disabled}
                            onChange={() => toggleSupplier(p.id)} />
                          <span>
                            <strong>{p.nombre}</strong>
                            {p.telefono && <span className="fin-widget-sub"> · {p.telefono}</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error && <div className="fin-widget-error">{error}</div>}

            <div className="rfq-create-actions">
              <button type="button" className="btn-modal-cancel" onClick={onClose} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="rfq-primary-btn" disabled={busy}>
                <FiSend size={12} /> {busy ? 'Enviando…' : 'Crear y enviar'}
              </button>
            </div>
          </form>
        )}

        {outcomes && (
          <div className="rfq-create-outcomes">
            <h4>Cotización creada</h4>
            <p className="fin-widget-sub">
              Estado: <strong>{outcomes.estado === 'sent' ? 'Enviada' : 'Sin envío'}</strong>
            </p>
            <ul className="info-list">
              {(outcomes.suppliersContacted || []).map(o => (
                <li key={o.supplierId}>
                  <strong>{o.supplierName}</strong>
                  {' — '}
                  {o.sent ? 'enviado' : `no enviado (${o.reason || 'sin motivo'})`}
                </li>
              ))}
            </ul>
            <div className="rfq-create-actions">
              <button type="button" className="rfq-primary-btn" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RfqCreateForm;
