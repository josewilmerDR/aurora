import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiPlus, FiTrash2, FiPrinter, FiArrowLeft, FiSearch, FiX, FiSave, FiCheck,
} from 'react-icons/fi';
import '../styles/oc-desde-solicitud.css';
import { useApiFetch } from '../../../hooks/useApiFetch';

const generatePoNumber = () => {
  const now = new Date();
  const yy = now.getFullYear();
  const seq = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return `OC-${yy}-${seq}-${String(Math.floor(Math.random() * 900) + 100)}`;
};

const formatDateLong = (dateStr) => {
  if (!dateStr) return '___________________________';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
};

function ProveedorCombobox({ value, onChange, proveedores }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = proveedores.filter(p =>
    !value || p.nombre.toLowerCase().includes(value.toLowerCase())
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (p) => {
    onChange(p.nombre);
    setOpen(false);
    setHi(0);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="aur-input"
        value={value}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); openDropdown(); }}
        onFocus={openDropdown}
        onBlur={() => setTimeout(() => { if (document.activeElement !== inputRef.current) setOpen(false); }, 150)}
        onKeyDown={handleKeyDown}
        placeholder="Nombre del proveedor"
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="proveedor-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`proveedor-dropdown-item${i === hi ? ' proveedor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              {p.nombre}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

const PurchaseOrder = () => {
  const apiFetch = useApiFetch();
  const { taskId } = useParams();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [catalogo, setCatalogo] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [solicitudId, setSolicitudId] = useState(null);
  const [savedOcId, setSavedOcId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState(null);

  const [poNumber] = useState(generatePoNumber);
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [proveedor, setProveedor] = useState('');
  const [direccionProveedor, setDireccionProveedor] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [elaboradoPor, setElaboradoPor] = useState('');
  const [notas, setNotas] = useState('');

  const [items, setItems] = useState([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [taskRes, prodRes, provRes] = await Promise.all([
          apiFetch(`/api/tasks/${taskId}`),
          apiFetch('/api/productos'),
          apiFetch('/api/proveedores'),
        ]);
        const task = await taskRes.json();
        const prods = await prodRes.json();
        setCatalogo(prods);
        setProveedores(await provRes.json());

        const taskItems = task.activity?.productos || [];
        setItems(taskItems.map(p => {
          const cat = prods.find(c => c.id === p.productoId);
          return {
            productoId: p.productoId,
            nombreComercial: p.nombreComercial,
            ingredienteActivo: cat?.ingredienteActivo || '',
            cantidad: p.cantidad ?? '',
            unidad: p.unidad || cat?.unidad || '',
            precioUnitario: cat?.precioUnitario ?? '',
            moneda: cat?.moneda || 'USD',
          };
        }));

        if (task.notas) setNotas(task.notas);
        if (task.solicitudId) setSolicitudId(task.solicitudId);
      } catch (e) {
        console.error('Error loading PO data', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [taskId]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  const updateItem = (idx, field, value) =>
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));

  const removeItem = (idx) =>
    setItems(prev => prev.filter((_, i) => i !== idx));

  const addFromCatalog = (producto) => {
    if (items.find(i => i.productoId === producto.id)) return;
    setItems(prev => [...prev, {
      productoId: producto.id,
      nombreComercial: producto.nombreComercial,
      ingredienteActivo: producto.ingredienteActivo || '',
      cantidad: '',
      unidad: producto.unidad || '',
      precioUnitario: producto.precioUnitario ?? '',
      moneda: producto.moneda || 'USD',
    }]);
    setSearchOpen(false);
    setSearchTerm('');
  };

  const filteredCatalog = catalogo.filter(p =>
    !items.find(i => i.productoId === p.id) &&
    (p.nombreComercial?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.idProducto?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.ingredienteActivo?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totalGeneral = items.reduce((sum, item) => {
    const qty = parseFloat(item.cantidad) || 0;
    const price = parseFloat(item.precioUnitario) || 0;
    return sum + qty * price;
  }, 0);

  const handlePrint = () => window.print();

  const handleSaveOC = async () => {
    const validItems = items.filter(i => i.nombreComercial);
    if (validItems.length === 0) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/ordenes-compra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber, fecha, fechaEntrega: fechaEntrega || null,
          proveedor, direccionProveedor, elaboradoPor, notas,
          items: validItems,
          taskId: taskId || null,
          solicitudId: solicitudId || null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSavedOcId(data.id);
      setSaveToast({ message: 'Orden guardada. Ya aparece en Recepción de Productos.', type: 'success' });
      setTimeout(() => setSaveToast(null), 4000);
    } catch {
      setSaveToast({ message: 'Error al guardar la orden.', type: 'error' });
      setTimeout(() => setSaveToast(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="po-loading">Cargando orden de compra…</div>;

  return (
    <div className="po-page">

      {saveToast && (
        <div className={`po-save-toast po-save-toast--${saveToast.type}`}>
          {saveToast.message}
        </div>
      )}

      <div className="po-topbar no-print">
        <button type="button" className="aur-btn-text" onClick={() => navigate(-1)}>
          <FiArrowLeft size={16} /> Volver
        </button>
        <span className="po-topbar-title">Editor — Orden de Compra</span>
        <div className="po-topbar-actions">
          {savedOcId ? (
            <span className="aur-badge aur-badge--green po-saved-indicator">
              <FiCheck size={12} /> OC guardada
            </span>
          ) : (
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={handleSaveOC}
              disabled={saving || items.length === 0}
            >
              <FiSave size={14} /> {saving ? 'Guardando…' : 'Guardar OC'}
            </button>
          )}
          <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handlePrint}>
            <FiPrinter size={14} /> Imprimir / PDF
          </button>
        </div>
      </div>

      <div className="po-layout">

        {/* ══ EDITOR PANEL ══ */}
        <aside className="po-editor no-print">

          <section className="aur-section">
            <header className="aur-section-header">
              <h3 className="aur-section-title">Encabezado</h3>
            </header>
            <ul className="aur-list">
              <li className="aur-row">
                <span className="aur-row-label">Proveedor</span>
                <ProveedorCombobox
                  value={proveedor}
                  onChange={setProveedor}
                  proveedores={proveedores}
                />
              </li>
              <li className="aur-row">
                <span className="aur-row-label">Dirección / Contacto</span>
                <input
                  className="aur-input"
                  value={direccionProveedor}
                  onChange={e => setDireccionProveedor(e.target.value)}
                  placeholder="Correo, teléfono o dirección"
                />
              </li>
              <li className="aur-row">
                <span className="aur-row-label">Fecha de la orden</span>
                <input className="aur-input" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
              </li>
              <li className="aur-row">
                <span className="aur-row-label">Fecha de entrega estimada</span>
                <input className="aur-input" type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} />
              </li>
              <li className="aur-row">
                <span className="aur-row-label">Elaborado por</span>
                <input
                  className="aur-input"
                  value={elaboradoPor}
                  onChange={e => setElaboradoPor(e.target.value)}
                  placeholder="Nombre del responsable"
                />
              </li>
            </ul>
          </section>

          <section className="aur-section">
            <header className="aur-section-header">
              <h3 className="aur-section-title">Líneas de producto</h3>
              <span className="aur-section-count">{items.length}</span>
            </header>

            {items.length === 0 && (
              <p className="po-empty-lines">No hay productos. Agrega uno abajo.</p>
            )}

            {items.map((item, idx) => (
              <div key={idx} className="po-line-editor">
                <div className="po-line-name">{item.nombreComercial}</div>
                <div className="po-line-controls">
                  <div className="po-line-field">
                    <label>Cantidad</label>
                    <input
                      className="aur-input aur-input--num"
                      type="number" min="0" step="0.1"
                      value={item.cantidad}
                      onChange={e => updateItem(idx, 'cantidad', e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="po-line-field">
                    <label>Unidad</label>
                    <input
                      className="aur-input"
                      value={item.unidad}
                      onChange={e => updateItem(idx, 'unidad', e.target.value)}
                    />
                  </div>
                  <div className="po-line-field">
                    <label>Precio unit.</label>
                    <input
                      className="aur-input aur-input--num"
                      type="number" min="0" step="0.01"
                      value={item.precioUnitario}
                      onChange={e => updateItem(idx, 'precioUnitario', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="po-line-field">
                    <label>Moneda</label>
                    <select
                      className="aur-select"
                      value={item.moneda}
                      onChange={e => updateItem(idx, 'moneda', e.target.value)}
                    >
                      <option value="USD">USD</option>
                      <option value="CRC">CRC</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                    onClick={() => removeItem(idx)}
                    title="Eliminar línea"
                  >
                    <FiTrash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {searchOpen ? (
              <div className="po-search-box" ref={searchRef}>
                <div className="po-search-input-wrap">
                  <FiSearch size={14} />
                  <input
                    autoFocus
                    placeholder="Buscar producto del catálogo…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm"
                    onClick={() => { setSearchOpen(false); setSearchTerm(''); }}
                  >
                    <FiX size={14} />
                  </button>
                </div>
                <div className="po-search-results">
                  {filteredCatalog.slice(0, 7).map(p => (
                    <button type="button" key={p.id} className="po-search-result" onClick={() => addFromCatalog(p)}>
                      <span className="po-sr-name">{p.nombreComercial}</span>
                      <span className="po-sr-meta">{p.unidad} · {p.ingredienteActivo}</span>
                    </button>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <p className="po-no-results">Sin resultados</p>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" className="po-btn-add-line" onClick={() => setSearchOpen(true)}>
                <FiPlus size={15} /> Agregar producto
              </button>
            )}
          </section>

          <section className="aur-section">
            <header className="aur-section-header">
              <h3 className="aur-section-title">Notas / Condiciones</h3>
            </header>
            <ul className="aur-list">
              <li className="aur-row aur-row--multiline">
                <span className="aur-row-label">Detalle</span>
                <textarea
                  className="aur-textarea"
                  rows={4}
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  placeholder="Condiciones de pago, urgencia, instrucciones de entrega…"
                />
              </li>
            </ul>
          </section>
        </aside>

        {/* ══ DOCUMENT (Apple-quality printable, brand-specific — sin tocar) ══ */}
        <div className="po-doc-wrap">
          <div className="po-document">

            <div className="po-doc-header">
              <div className="po-doc-brand">
                <div className="po-doc-logo">AU</div>
                <div>
                  <div className="po-doc-brand-name">FINCA AURORA</div>
                  <div className="po-doc-brand-sub">San José, Costa Rica</div>
                </div>
              </div>
              <div className="po-doc-title-block">
                <div className="po-doc-title">ORDEN DE COMPRA</div>
                <table className="po-doc-meta-table">
                  <tbody>
                    <tr><td>N°:</td><td><strong>{poNumber}</strong></td></tr>
                    <tr><td>Fecha:</td><td><strong>{formatDateLong(fecha)}</strong></td></tr>
                    {fechaEntrega && (
                      <tr><td>Entrega:</td><td><strong>{formatDateLong(fechaEntrega)}</strong></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="po-doc-parties">
              <div className="po-doc-party">
                <div className="po-doc-party-label">PROVEEDOR</div>
                <div className="po-doc-party-value">
                  {proveedor || '___________________________'}
                </div>
                {direccionProveedor && (
                  <div className="po-doc-party-contact">{direccionProveedor}</div>
                )}
              </div>
              <div className="po-doc-party">
                <div className="po-doc-party-label">COMPRADOR</div>
                <div className="po-doc-party-value">Finca Aurora</div>
                <div className="po-doc-party-contact">San José, Costa Rica</div>
              </div>
            </div>

            <table className="po-doc-table">
              <thead>
                <tr>
                  <th className="po-col-num">#</th>
                  <th className="po-col-product">Producto</th>
                  <th className="po-col-ai">Ingrediente Activo</th>
                  <th className="po-col-qty">Cantidad</th>
                  <th className="po-col-unit">Unidad</th>
                  <th className="po-col-price">Precio Unit.</th>
                  <th className="po-col-total">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="po-table-empty">
                      Agrega productos desde el editor
                    </td>
                  </tr>
                )}
                {items.map((item, idx) => {
                  const qty = parseFloat(item.cantidad) || 0;
                  const price = parseFloat(item.precioUnitario) || 0;
                  const total = qty * price;
                  return (
                    <tr key={idx}>
                      <td className="po-col-num">{idx + 1}</td>
                      <td className="po-col-product">{item.nombreComercial}</td>
                      <td className="po-col-ai">{item.ingredienteActivo || '—'}</td>
                      <td className="po-col-qty">{item.cantidad || '—'}</td>
                      <td className="po-col-unit">{item.unidad}</td>
                      <td className="po-col-price">
                        {price > 0 ? `${price.toFixed(2)} ${item.moneda}` : '—'}
                      </td>
                      <td className="po-col-total">
                        {total > 0 ? `${total.toFixed(2)} ${item.moneda}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {totalGeneral > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={6} className="po-total-label">TOTAL ESTIMADO</td>
                    <td className="po-total-value">
                      {totalGeneral.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>

            {notas && (
              <div className="po-doc-notes">
                <strong>Notas / Condiciones:</strong> {notas}
              </div>
            )}

            <div className="po-doc-signatures">
              <div className="po-sig">
                <div className="po-sig-line" />
                <div className="po-sig-role">Elaborado por</div>
                {elaboradoPor && <div className="po-sig-name">{elaboradoPor}</div>}
              </div>
              <div className="po-sig">
                <div className="po-sig-line" />
                <div className="po-sig-role">Aprobado por</div>
              </div>
              <div className="po-sig">
                <div className="po-sig-line" />
                <div className="po-sig-role">Recibido por / Fecha</div>
              </div>
            </div>

            <div className="po-doc-footer">
              Documento generado por Sistema Aurora · {poNumber}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrder;
